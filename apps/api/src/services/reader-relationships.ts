import {
  CALC_CONTRACT_ID, CALC_CONTRACT_VERSION, contentHash, cycleHash, sha256Hex,
  type AuthorizedReaderUnit, type BirthTimeAccuracy, type PatternResponseV7,
  type ReaderDailyTarget, type ReaderRelationshipSourceResponse,
  type ReaderRelationshipsResponse, type ReaderRelationshipTargetResponse, type ReaderTimingDetail,
  type ReaderTimingTarget,
} from "@patternlike/shared";
import { computePhase } from "@patternlike/reading-engine";
import { projectPublicPattern } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadReadableReadingById, type PublishedReading } from "../db/readings.js";
import { getReadingSaveState } from "../db/reading-saves.js";
import { loadReaderRelationshipSupport } from "../db/reader-relationship-supports.js";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { parseStoredCycle, type CycleInstanceRow } from "../db/timing.js";
import { isStoredReadingV5 } from "./stored-reading.js";
import { projectReadingResponse } from "./reading-product-projection.js";
import { buildPatternState, loadActivePatternDocument, decryptPatternDocument } from "./pattern-state.js";
import { readerTimingUnits } from "./reader-relationship-support.js";
import { exactReaderUnit, readerTargetKey, resolveReaderRelationships } from "./reader-relationship-resolver.js";

const CANDIDATE_LIMIT = 50;
type ProductReading = ReturnType<typeof projectReadingResponse>;
export type RelationshipTargetResponse = ReaderRelationshipTargetResponse<ProductReading, PatternResponseV7>;
interface AuthorizedDaily { target: ReaderDailyTarget; published: PublishedReading; units: AuthorizedReaderUnit[] }
interface ReaderChart {
  id: string;
  fingerprint: string;
  birth_accuracy: BirthTimeAccuracy;
  uncertainty_json: string;
  contract_id: string;
  contract_version: string;
}
interface CycleRow extends CycleInstanceRow { horizon_version: string }

function hasChart(unit: AuthorizedReaderUnit, chart: string): boolean {
  return unit.features.every((feature) => feature.chart === chart)
    && unit.participants.every((participant) => participant.chart === chart)
    && (!unit.day || unit.day.chart === chart) && (!unit.occurrence || unit.occurrence.chart === chart);
}

async function loadDaily(
  env: Env, identity: UserIdentity, readingId: string, revision?: number, paragraphId?: string,
): Promise<AuthorizedDaily | null> {
  const published = await loadReadableReadingById(env, identity, readingId);
  if (!published) return null;
  const { record, stored } = published;
  if (stored.reading.reading_id !== record.id || stored.reading.revision !== record.revision
    || stored.evidence_header.reading_id !== record.id || stored.evidence_header.revision !== record.revision
    || (revision !== undefined && revision !== record.revision)) return null;
  const paragraph = paragraphId === undefined ? stored.reading.paragraphs[0]
    : stored.reading.paragraphs.find((entry) => entry.paragraph_id === paragraphId);
  if (!paragraph) return null;
  const hash = isStoredReadingV5(stored) ? stored.evidence_header.content_hash
    : await contentHash(JSON.stringify(stored.reading));
  const target: ReaderDailyTarget = {
    kind: "daily", reading_id: record.id, revision: record.revision,
    content_hash: hash, paragraph_id: paragraph.paragraph_id,
  };
  const support = await loadReaderRelationshipSupport(env, identity, {
    documentKind: "daily", documentId: record.id, revisionKey: String(record.revision), contentHash: hash,
  });
  const chart = await hashChartFingerprint(record.chartFingerprint);
  const paragraphs = new Set(stored.reading.paragraphs.map((entry) => entry.paragraph_id));
  const units = (support?.units ?? []).filter((unit) => unit.target.kind === "daily"
    && unit.target.reading_id === target.reading_id && unit.target.revision === target.revision
    && unit.target.content_hash === hash && paragraphs.has(unit.target.paragraph_id)
    && hasChart(unit, chart) && (!unit.day || unit.day.local_date === record.localDate))
    .map((unit) => ({ ...unit, eligible: true }));
  return { target, published, units };
}

export async function loadReaderRelationshipSource(
  env: Env, identity: UserIdentity, readingId: string, revision: number, paragraphId: string,
): Promise<ReaderRelationshipSourceResponse> {
  const daily = await loadDaily(env, identity, readingId, revision, paragraphId);
  return { schema_version: "reader-relationship-source/v1", status: daily ? "available" : "unavailable", source: daily?.target ?? null };
}

async function loadCurrentReaderChart(env: Env, userId: string): Promise<ReaderChart | null> {
  return env.DB.prepare(
    `SELECT c.id, c.fingerprint, c.birth_accuracy, c.uncertainty_json, c.contract_id, c.contract_version FROM chart_snapshots c
     JOIN birth_profiles b ON b.user_id = c.user_id AND b.version = c.profile_version AND b.status = 'active'
     WHERE c.user_id = ? AND c.status = 'active' ORDER BY c.calculated_at DESC LIMIT 1`,
  ).bind(userId).first<ReaderChart>();
}

function suppressedFeatures(chart: ReaderChart): string[] | null {
  try {
    const uncertainty = JSON.parse(chart.uncertainty_json) as { accuracy?: unknown; suppressed_features?: unknown };
    if (uncertainty.accuracy !== chart.birth_accuracy || !Array.isArray(uncertainty.suppressed_features)) return null;
    const values: string[] = [];
    for (const item of uncertainty.suppressed_features) {
      if (!item || typeof item.feature_class !== "string") return null;
      values.push(item.feature_class);
    }
    return values;
  } catch { return null; }
}

async function loadPattern(env: Env, identity: UserIdentity, chart: ReaderChart) {
  const state = await buildPatternState(env, identity);
  if (!state.pattern) return null;
  const chartHash = await hashChartFingerprint(chart.fingerprint);
  const row = await loadActivePatternDocument(env, identity.userId, chartHash);
  if (!row || row.id !== state.pattern.pattern_id || row.generated_at !== state.pattern.generated_at) return null;
  const internal = await decryptPatternDocument(env, identity, row);
  if (await contentHash(JSON.stringify(internal)) !== row.content_hash) return null;
  const pattern = projectPublicPattern(internal, row.generated_at);
  const revision = `${pattern.schema_version}:${pattern.pattern_id}:${pattern.generated_at}`;
  const support = await loadReaderRelationshipSupport(env, identity, {
    documentKind: "pattern", documentId: row.id, revisionKey: revision, contentHash: row.content_hash,
  });
  const units: AuthorizedReaderUnit[] = [];
  for (const unit of support?.units ?? []) {
    if (unit.target.kind !== "pattern" || unit.target.pattern_id !== row.id
      || unit.target.document_revision !== revision || unit.target.content_hash !== row.content_hash
      || !hasChart(unit, chartHash)) continue;
    const chapter = pattern.core_chapters[unit.target.chapter_index];
    if (!chapter || !Number.isInteger(unit.target.chapter_index) || unit.target.chapter_index < 0) continue;
    const source = JSON.stringify({
      title: chapter.title, summary: chapter.summary, sections: chapter.sections.map((part) => part.text),
      tensions: chapter.tensions.map((part) => part.text), resources: chapter.resources.map((part) => part.text),
      counterExpression: chapter.counter_expression.text,
    });
    if (await sha256Hex(source) !== unit.target.chapter_source_sha256) continue;
    units.push({ ...unit, eligible: true });
  }
  return { pattern, units };
}

async function timingUnits(chart: ReaderChart, row: CycleRow, timeZone: string) {
  if (chart.contract_id !== CALC_CONTRACT_ID || chart.contract_version !== CALC_CONTRACT_VERSION) return null;
  const cycle = parseStoredCycle(row);
  const suppressed = suppressedFeatures(chart);
  if (!cycle || suppressed === null || !row.horizon_version) return null;
  const units = await readerTimingUnits({
    cycle, chartFingerprintHash: await hashChartFingerprint(chart.fingerprint), effectiveAccuracy: chart.birth_accuracy,
    suppressedFeatures: suppressed, timeZone, policyVersion: row.horizon_version,
  });
  return { cycle, units };
}

export async function loadReaderTimingDetail(
  env: Env, identity: UserIdentity, request: Pick<ReaderTimingTarget, "cycle_id" | "cycle_hash" | "pass_index" | "local_date" | "time_zone">,
): Promise<ReaderTimingDetail | null> {
  const chart = await loadCurrentReaderChart(env, identity.userId);
  if (!chart) return null;
  const row = await env.DB.prepare(
    `SELECT id, end_at, cycle_json, horizon_version FROM cycle_instances
     WHERE id = ? AND user_id = ? AND chart_id = ? AND status = 'active'`,
  ).bind(request.cycle_id, identity.userId, chart.id).first<CycleRow>();
  if (!row) return null;
  const loaded = await timingUnits(chart, row, request.time_zone);
  if (!loaded || await cycleHash(loaded.cycle) !== request.cycle_hash) return null;
  const unit = loaded.units.find((entry) => entry.target.kind === "timing"
    && entry.target.pass_index === request.pass_index && entry.target.local_date === request.local_date);
  if (!unit || unit.target.kind !== "timing") return null;
  return {
    target: unit.target, technique: "transit", body: loaded.cycle.body, natal_target: loaded.cycle.target,
    aspect: loaded.cycle.aspect, phase: computePhase(loaded.cycle, unit.target.exact_at), orb_deg: loaded.cycle.orb_deg,
    passes: loaded.cycle.passes.map(({ pass_index, direction, exact_at }) => ({ pass_index, direction, exact_at })),
  };
}

export async function loadReaderRelationships(
  env: Env, identity: UserIdentity, source: ReaderDailyTarget,
): Promise<ReaderRelationshipsResponse> {
  const unavailable: ReaderRelationshipsResponse = {
    schema_version: "reader-relationships/v1", source, status: "unavailable", items: [], truncated: false,
  };
  const daily = await loadDaily(env, identity, source.reading_id, source.revision, source.paragraph_id);
  if (!daily || readerTargetKey(daily.target) !== readerTargetKey(source)) return unavailable;
  const root = exactReaderUnit(source, daily.units);
  if (!root) return { ...unavailable, status: "no_supported_connection" };
  const units = [root];
  const chart = await loadCurrentReaderChart(env, identity.userId);
  if (!chart || chart.fingerprint !== daily.published.record.chartFingerprint) {
    return { ...unavailable, status: "no_supported_connection" };
  }
  const pattern = await loadPattern(env, identity, chart);
  if (pattern) units.push(...pattern.units);
  const savedRows = await env.DB.prepare(
    `SELECT r.id FROM reading_saves s JOIN daily_readings r ON r.id = s.reading_id AND r.user_id = s.user_id
     WHERE r.user_id = ? AND r.chart_fingerprint = ? AND r.local_date < ? AND r.reading_enc IS NOT NULL
       AND r.status IN ('published', 'superseded', 'invalidated')
     ORDER BY r.local_date DESC, r.id ASC LIMIT ?`,
  ).bind(identity.userId, chart.fingerprint, daily.published.record.localDate, CANDIDATE_LIMIT + 1).all<{ id: string }>();
  const saved = await Promise.all(savedRows.results.slice(0, CANDIDATE_LIMIT).map((row) => loadDaily(env, identity, row.id)));
  // A dated relationship identifies one exact saved edition. Its first supported
  // actual paragraph is the destination, rather than one duplicate edge per paragraph.
  for (const item of saved) if (item?.units[0]) units.push(item.units[0]);
  const allZones = [...new Set(units.flatMap((unit) => [
    ...(unit.day ? [unit.day.time_zone] : []), ...(unit.cycle_refs ?? []).map((ref) => ref.time_zone),
  ]))];
  const zones = allZones.slice(0, 8);
  const referencedCycles = [...new Set(units.flatMap((unit) => (unit.cycle_refs ?? []).map((ref) => ref.cycle_id)))];
  const cycleRows = await env.DB.prepare(
    `SELECT id, end_at, cycle_json, horizon_version FROM cycle_instances
     WHERE user_id = ? AND chart_id = ? AND status = 'active'
     ORDER BY CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 0 ELSE 1 END,
       ABS(julianday(exact_at) - julianday(?)), id ASC LIMIT ?`,
  ).bind(identity.userId, chart.id, JSON.stringify(referencedCycles.slice(0, CANDIDATE_LIMIT)),
    daily.published.record.localDate, CANDIDATE_LIMIT + 1).all<CycleRow>();
  for (const row of cycleRows.results.slice(0, CANDIDATE_LIMIT)) {
    for (const zone of zones) {
      const loaded = await timingUnits(chart, row, zone);
      if (loaded) units.push(...loaded.units);
    }
  }
  const graph = await resolveReaderRelationships(source, units);
  return {
    schema_version: "reader-relationships/v1", ...graph,
    truncated: graph.truncated || savedRows.results.length > CANDIDATE_LIMIT || cycleRows.results.length > CANDIDATE_LIMIT
      || allZones.length > zones.length || referencedCycles.length > CANDIDATE_LIMIT,
  };
}

export async function loadReaderRelationshipTarget(
  env: Env, identity: UserIdentity, source: ReaderDailyTarget, relationshipId: string,
): Promise<RelationshipTargetResponse> {
  const unavailable: RelationshipTargetResponse = { schema_version: "reader-relationship-target/v1", status: "unavailable" };
  const graph = await loadReaderRelationships(env, identity, source);
  const edge = graph.items.find((entry) => entry.id === relationshipId);
  if (!edge) return unavailable;
  const target = edge.to;
  if (target.kind === "daily") {
    const saved = await getReadingSaveState(env, identity.userId, target.reading_id);
    const daily = saved?.saved ? await loadDaily(env, identity, target.reading_id, target.revision, target.paragraph_id) : null;
    if (!daily || readerTargetKey(daily.target) !== readerTargetKey(target)) return unavailable;
    const status = daily.published.record.status;
    if (status !== "published" && status !== "superseded" && status !== "invalidated") return unavailable;
    return { schema_version: "reader-relationship-target/v1", status: "available", kind: "daily", target, reading: projectReadingResponse(daily.published), reading_status: status };
  }
  if (target.kind === "pattern") {
    const chart = await loadCurrentReaderChart(env, identity.userId);
    const pattern = chart ? await loadPattern(env, identity, chart) : null;
    if (!pattern || !exactReaderUnit(target, pattern.units)) return unavailable;
    return { schema_version: "reader-relationship-target/v1", status: "available", kind: "pattern", target, pattern: pattern.pattern };
  }
  const timing = await loadReaderTimingDetail(env, identity, target);
  if (!timing || readerTargetKey(timing.target) !== readerTargetKey(target)) return unavailable;
  return { schema_version: "reader-relationship-target/v1", status: "available", kind: "timing", target, timing };
}
