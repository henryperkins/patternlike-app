import {
  ASSEMBLY_POLICY_ID,
  ASSEMBLY_POLICY_VERSION,
  SCHEMA_VERSION as ENGINE_SCHEMA_VERSION,
  assembleReading,
  contextRejection,
  renderAssemblyId,
  type AssemblyInput,
  type AssemblyUncertaintyInput,
  type NormalizedContextSignal,
  type VerifiedBundle,
} from "@patternlike/reading-engine";
import {
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  M3_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  newId,
  sha256Hex,
  type BirthTimeAccuracy,
  type LongitudePosition,
  type NormalizedCycle,
  type UncertaintyReport,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { loadPreferences } from "../db/preferences.js";
import { deriveCycles, type PersistedCycle } from "../db/cycles.js";
import { getActiveRelease } from "../db/content-releases.js";
import { invokeCycles, buildCycleRequest } from "./cycle-client.js";
import { loadReleaseBundle } from "./release-bundle.js";
import { resolveLocalDay, type LocalDayWindow } from "./local-day.js";

/**
 * Freeze every input a daily reading will ever be assembled from.
 *
 * One consistent read at enqueue, then nothing mutable is consulted again.
 * Cloudflare Queues is at-least-once, so a retry that re-resolved "today" or
 * "active" would produce a different reading under the same identity — which is
 * the failure this whole object exists to prevent.
 */

/** The M3 generation command. Mirrors contracts/m3/generation-command.schema.json. */
export interface CyclePin {
  cycle_id: string;
  pass_ids: string[];
  cycle_hash: string;
}

export interface ChartPin {
  snapshot_id: string;
  fingerprint: string;
  profile_version: number;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  tzdb_version: string | null;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
}

export interface CycleScanPin {
  cycles: CyclePin[];
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  container_digest: string;
  ephemeris_data_version: string;
}

export interface ContextPin {
  signal_id: string;
  source_id: string;
  normalized_hash: string;
  allowed_use: string;
  evidence_lane: string;
  consent_id: string;
  consent_version: number;
  permission_state: string;
  freshness_status: string;
}

export interface GenerateDailyReadingCommandV1 {
  command_version: "v1";
  schema_version: string;
  reading_id: string;
  reading_key: string;
  revision: number;
  revision_reason: string;
  supersedes_reading_id: string | null;
  command_generation: number;
  replaces_job_id: string | null;
  command_replacement_reason: string | null;
  target_local_date: string;
  target_timezone: string;
  timezone_revision: number;
  day_start_at: string;
  day_end_at: string;
  generation_anchor: string;
  locale: string;
  domain_preference: string | null;
  identity_profile: "patternlike.assembly-id.v1";
  output_schema: "daily-reading-v3";
  assembly_policy_id: string;
  assembly_policy_version: string;
  chart: ChartPin;
  cycle_scan: CycleScanPin;
  release_version: string;
  release_bundle_hash: string;
  context: ContextPin[];
  assembly_id: string;
}

export type RevisionReason =
  | "initial"
  | "chart_recalculated"
  | "consent_revoked"
  | "safety_correction"
  | "defect_repair";

export type CommandReplacementReason =
  | "calc_unavailable"
  | "release_unreadable"
  | "context_minimized"
  | "policy_upgraded"
  | "defect_repair";

/**
 * Why a command could not be frozen.
 *
 * `calc_unavailable` and `release_unreadable` are the two the scheduler is
 * allowed to retry unattended, and they are named to match
 * `commandReplacementReason` exactly so the replacement path does not have to
 * translate.
 */
export type CommandBuildFailure =
  | "timezone_confirmation_required"
  | "locale_confirmation_required"
  | "chart_not_found"
  | "release_not_active"
  | "release_unreadable"
  | "release_hash_mismatch"
  | "calc_unavailable"
  | "cycle_scan_refused"
  | "assembly_failed";

export interface CommandBuildContext {
  readingId: string;
  revision: number;
  revisionReason: RevisionReason;
  supersedesReadingId: string | null;
  commandGeneration: number;
  replacesJobId: string | null;
  commandReplacementReason: CommandReplacementReason | null;
  /** The trusted enqueue instant. Never a client value, never a later attempt's clock. */
  now: Date;
}

export type CommandBuild =
  | {
      ok: true;
      command: GenerateDailyReadingCommandV1;
      /** Carried out so the caller can persist the scan it just paid for. */
      chartId: string;
      cycles: NormalizedCycle[];
      day: LocalDayWindow;
    }
  | { ok: false; reason: CommandBuildFailure; detail: string };

interface ChartRow {
  id: string;
  profile_version: number;
  fingerprint: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  tzdb_version: string | null;
  birth_accuracy: BirthTimeAccuracy;
  snapshot_json: string;
  uncertainty_json: string;
}

interface ContextRow {
  id: string;
  source_id: string;
  normalized_hash: string;
  allowed_uses_json: string;
  consent_allowed_uses_json: string;
  evidence_lane: string;
  consent_id: string;
  consent_version: number;
  consent_source_id: string | null;
  permission_state: string;
  freshness_status: string;
}

const SUPPRESSED_FEATURE_CLASSES = new Set([
  "houses",
  "angles",
  "angle_transits",
  "moon_time_sensitive",
]);

function parseStoredChart(chart: ChartRow): {
  uncertainty: UncertaintyReport;
  positions: LongitudePosition[];
} | null {
  try {
    const parsedUncertainty = JSON.parse(chart.uncertainty_json) as unknown;
    const snapshot = JSON.parse(chart.snapshot_json) as { positions?: unknown };
    if (
      !parsedUncertainty ||
      typeof parsedUncertainty !== "object" ||
      !Array.isArray(snapshot?.positions)
    ) {
      return null;
    }
    const report = parsedUncertainty as Record<string, unknown>;
    if (
      typeof report.accuracy !== "string" ||
      !["exact", "approximate", "unknown"].includes(report.accuracy) ||
      !Array.isArray(report.suppressed_features) ||
      !report.suppressed_features.every(
        (feature) =>
          feature !== null &&
          typeof feature === "object" &&
          typeof (feature as Record<string, unknown>).feature_class === "string" &&
          SUPPRESSED_FEATURE_CLASSES.has(
            (feature as Record<string, unknown>).feature_class as string,
          ) &&
          typeof (feature as Record<string, unknown>).reason === "string" &&
          ((feature as Record<string, unknown>).feature_id === undefined ||
            (feature as Record<string, unknown>).feature_id === null ||
            typeof (feature as Record<string, unknown>).feature_id === "string"),
      ) ||
      !Array.isArray(report.qualified_features) ||
      !report.qualified_features.every(
        (feature) =>
          feature !== null &&
          typeof feature === "object" &&
          typeof (feature as Record<string, unknown>).feature_id === "string" &&
          typeof (feature as Record<string, unknown>).qualification === "string",
      ) ||
      !(
        report.window === null ||
        (report.window !== undefined && typeof report.window === "object")
      )
    ) {
      return null;
    }
    const positions = snapshot.positions;
    if (
      !positions.every(
        (position) =>
          position !== null &&
          typeof position === "object" &&
          typeof (position as { body?: unknown }).body === "string" &&
          typeof (position as { longitude_deg?: unknown }).longitude_deg === "number" &&
          Number.isFinite((position as { longitude_deg: number }).longitude_deg),
      )
    ) {
      return null;
    }
    return {
      uncertainty: report as unknown as UncertaintyReport,
      positions: positions as LongitudePosition[],
    };
  } catch {
    return null;
  }
}

/**
 * `user:<user_id>:<local_date>:<release_version>:r<revision>`.
 *
 * Still matches the frozen M0 pattern, whose trailing `.+` absorbs the revision
 * suffix, and stays unambiguous because `users.id` excludes `:` by CHECK.
 */
export function buildReadingKey(
  userId: string,
  localDate: string,
  releaseVersion: string,
  revision: number,
): string {
  return `user:${userId}:${localDate}:${releaseVersion}:r${revision}`;
}

/**
 * Project the stored uncertainty report into the closed assembly input.
 *
 * `user_facing_summary` is dropped here rather than by the engine: it is
 * free-form prose that never passes editorial review, so it must not be able to
 * change a reviewed artifact's identity.
 */
export function toAssemblyUncertainty(
  report: UncertaintyReport,
): AssemblyUncertaintyInput {
  return {
    accuracy: report.accuracy,
    window_plus_minus_minutes: report.window?.plus_minus_minutes ?? null,
    suppressed_features: report.suppressed_features.map((feature) => ({
      feature_class: feature.feature_class as AssemblyUncertaintyInput["suppressed_features"][number]["feature_class"],
      feature_id: feature.feature_id ?? null,
      reason: feature.reason as AssemblyUncertaintyInput["suppressed_features"][number]["reason"],
    })),
    qualified_features: report.qualified_features.map((feature) => ({
      feature_id: feature.feature_id as AssemblyUncertaintyInput["qualified_features"][number]["feature_id"],
      qualification:
        feature.qualification as AssemblyUncertaintyInput["qualified_features"][number]["qualification"],
    })),
  };
}

/**
 * Natal longitudes for the scan, and nothing else.
 *
 * Angles are included only when the chart actually has them: an unknown-time
 * chart suppresses `angles`, and sending an Ascendant longitude computed from a
 * synthesized noon would let the scanner return angle contacts the uncertainty
 * report says are unavailable.
 */
export function natalPositionsForScan(
  positions: LongitudePosition[],
  uncertainty: UncertaintyReport,
): Array<{ body: LongitudePosition["body"]; longitude_deg: number }> {
  const suppressed = new Set(uncertainty.suppressed_features.map((f) => f.feature_class));
  const anglesSuppressed = suppressed.has("angles") || suppressed.has("angle_transits");
  return positions
    .filter((position) => {
      if (position.body === "ascendant" || position.body === "midheaven") {
        return !anglesSuppressed;
      }
      return true;
    })
    .map((position) => ({ body: position.body, longitude_deg: position.longitude_deg }));
}

async function readEligibleContext(env: Env, userId: string): Promise<ContextRow[]> {
  // Nothing writes context_signals yet — the ingestion surfaces are M4 — so this
  // is empty in practice today. It is still read rather than hardcoded to []
  // because the command must pin the exact state under which each signal was
  // eligible, and a later reader has to be able to tell "no signals" from "this
  // code never looked".
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.source_id, s.normalized_hash, s.allowed_uses_json,
            c.allowed_uses_json AS consent_allowed_uses_json,
            s.evidence_lane, s.consent_id, c.version AS consent_version,
            c.source_id AS consent_source_id,
            s.permission_state, s.freshness_status
     FROM context_signals s
     JOIN consents c ON c.id = s.consent_id AND c.user_id = s.user_id
     WHERE s.user_id = ?
       AND s.permission_state = 'active'
       AND s.conflict_status = 'none'
       AND s.freshness_status = 'fresh'
       AND c.status = 'granted'
     ORDER BY s.source_id, s.id`,
  )
    .bind(userId)
    .all<ContextRow>();
  return results;
}

function toContextPins(rows: ContextRow[]): ContextPin[] {
  return rows.flatMap((row) => {
    let allowedUses: unknown;
    let consentAllowedUses: unknown;
    try {
      allowedUses = JSON.parse(row.allowed_uses_json);
      consentAllowedUses = JSON.parse(row.consent_allowed_uses_json);
    } catch {
      return [];
    }
    if (!Array.isArray(allowedUses) || !Array.isArray(consentAllowedUses)) return [];
    if (row.consent_source_id !== row.source_id) return [];
    const consentSet = new Set(
      consentAllowedUses.filter((use): use is string => typeof use === "string"),
    );
    const allowedUse = allowedUses.find((use): use is string => {
      if (typeof use !== "string" || !consentSet.has(use)) return false;
      const signal: NormalizedContextSignal = {
        signal_id: row.id,
        source_id: row.source_id,
        normalized_hash: row.normalized_hash,
        allowed_use: use,
        evidence_lane: row.evidence_lane as NormalizedContextSignal["evidence_lane"],
        permission_state:
          row.permission_state as NormalizedContextSignal["permission_state"],
        freshness_status:
          row.freshness_status as NormalizedContextSignal["freshness_status"],
      };
      return contextRejection(signal) === null;
    });
    if (!allowedUse) return [];
    return [
      {
        signal_id: row.id,
        source_id: row.source_id,
        normalized_hash: row.normalized_hash,
        allowed_use: allowedUse,
        evidence_lane: row.evidence_lane,
        consent_id: row.consent_id,
        consent_version: row.consent_version,
        permission_state: row.permission_state,
        freshness_status: row.freshness_status,
      },
    ];
  });
}

function toEngineContext(pins: ContextPin[]): NormalizedContextSignal[] {
  return pins.map((pin) => ({
    signal_id: pin.signal_id,
    source_id: pin.source_id,
    allowed_use: pin.allowed_use,
    evidence_lane: pin.evidence_lane as NormalizedContextSignal["evidence_lane"],
    normalized_hash: pin.normalized_hash,
    permission_state: pin.permission_state as NormalizedContextSignal["permission_state"],
    freshness_status: pin.freshness_status as NormalizedContextSignal["freshness_status"],
  }));
}

/**
 * Build the `AssemblyInput` the engine consumes.
 *
 * Exported because the executor builds the identical object from the frozen
 * command and must not be able to build a subtly different one — a second copy
 * of this shape is a second definition of what a reading is.
 */
export function buildAssemblyInput(args: {
  readingId: string;
  revision: number;
  localDate: string;
  targetTimezone: string;
  generationAnchor: string;
  dayStartAt: string;
  dayEndAt: string;
  fingerprint: string;
  effectiveAccuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
  cycles: NormalizedCycle[];
  release: VerifiedBundle;
  context: NormalizedContextSignal[];
  locale: string;
  domainPreference: AssemblyInput["domain_preference"];
}): AssemblyInput {
  return {
    identity_profile: "patternlike.assembly-id.v1",
    schema_version: ENGINE_SCHEMA_VERSION,
    output_schema: "daily-reading-v3",
    assembly_policy_id: ASSEMBLY_POLICY_ID,
    assembly_policy_version: ASSEMBLY_POLICY_VERSION,
    reading_id: args.readingId,
    revision: args.revision,
    local_date: args.localDate,
    target_timezone: args.targetTimezone,
    generation_anchor: args.generationAnchor,
    day_start_at: args.dayStartAt,
    day_end_at: args.dayEndAt,
    chart: {
      fingerprint: args.fingerprint,
      effective_accuracy: args.effectiveAccuracy,
      uncertainty: args.uncertainty,
    },
    cycles: args.cycles,
    release: args.release,
    context: args.context,
    locale: args.locale,
    domain_preference: args.domainPreference,
  };
}

/**
 * Hash the identity preimage into an `asm_` handle.
 *
 * Runs the whole assembler rather than calling `buildAssemblyIdentity` directly.
 * The identity is built from the ELIGIBLE fact and context sets, which the
 * assembler partitions internally; re-deriving that partition here would be a
 * second implementation of eligibility, and any drift between the two would
 * surface as an identity mismatch on a real reader's reading rather than in a
 * test. The engine is pure and synchronous, so running it twice costs nothing
 * that matters.
 */
export async function computeAssemblyId(input: AssemblyInput): Promise<string> {
  const outcome = assembleReading(input);
  return renderAssemblyId(await sha256Hex(outcome.identity_canonical));
}

export async function buildGenerationCommand(
  env: Env,
  userId: string,
  ctx: CommandBuildContext,
): Promise<CommandBuild> {
  const preferences = await loadPreferences(env, userId);
  if (!preferences) {
    return { ok: false, reason: "chart_not_found", detail: "user does not exist" };
  }
  // Generation is withheld until both are owned values. A server default nobody
  // chose would decide which local day is generated and which reviewed prose the
  // reader is shown.
  if (preferences.timezoneSource === "default_unconfirmed") {
    return {
      ok: false,
      reason: "timezone_confirmation_required",
      detail: "scheduling timezone is still the unconfirmed server default",
    };
  }
  if (preferences.localeSource === "default_unconfirmed") {
    return {
      ok: false,
      reason: "locale_confirmation_required",
      detail: "content locale is still the unconfirmed server default",
    };
  }

  const day = resolveLocalDay(preferences.timezone, ctx.now);

  const chart = await env.DB.prepare(
    `SELECT id, profile_version, fingerprint, contract_id, contract_version,
            container_digest, tzdb_version, birth_accuracy, snapshot_json, uncertainty_json
     FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<ChartRow>();
  if (!chart) {
    return { ok: false, reason: "chart_not_found", detail: "no active chart snapshot" };
  }

  const storedChart = parseStoredChart(chart);
  if (!storedChart) {
    return {
      ok: false,
      reason: "chart_not_found",
      detail: "active chart snapshot is malformed",
    };
  }
  const { uncertainty, positions } = storedChart;
  // The recomputed effective accuracy, never the label the caller supplied.
  const effectiveAccuracy = uncertainty.accuracy;

  const releaseRow = await getActiveRelease(env);
  if (!releaseRow) {
    return { ok: false, reason: "release_not_active", detail: "no active content release" };
  }
  const release = await loadReleaseBundle(env, releaseRow.version, null);
  if (!release.ok) {
    return { ok: false, reason: release.reason, detail: release.detail };
  }

  const scan = await invokeCycles(
    env,
    buildCycleRequest({
      requestId: newId("req"),
      chartFingerprint: chart.fingerprint,
      natalAccuracy: effectiveAccuracy,
      suppressedFeatures: uncertainty.suppressed_features.map((f) => f.feature_class),
      natalPositions: natalPositionsForScan(positions, uncertainty),
      window: { from: day.dayStartAt, to: day.dayEndAt },
      contractId: chart.contract_id,
      contractVersion: chart.contract_version,
    }),
  );
  if (!scan.ok) {
    return scan.kind === "unavailable"
      ? { ok: false, reason: "calc_unavailable", detail: scan.detail }
      : {
          ok: false,
          reason: "cycle_scan_refused",
          detail: `cycle scan refused: ${scan.failure.error_class}`,
        };
  }

  const cycles = scan.response.cycles;
  const derived: PersistedCycle[] = await deriveCycles(cycles);
  const contextRows = await readEligibleContext(env, userId);
  const contextPins = toContextPins(contextRows);

  const assemblyInput = buildAssemblyInput({
    readingId: ctx.readingId,
    revision: ctx.revision,
    localDate: day.targetLocalDate,
    targetTimezone: preferences.timezone,
    generationAnchor: ctx.now.toISOString(),
    dayStartAt: day.dayStartAt,
    dayEndAt: day.dayEndAt,
    fingerprint: chart.fingerprint,
    effectiveAccuracy,
    uncertainty: toAssemblyUncertainty(uncertainty),
    cycles,
    release: release.verified,
    context: toEngineContext(contextPins),
    locale: preferences.locale,
    domainPreference: null,
  });

  let assemblyId: string;
  try {
    assemblyId = await computeAssemblyId(assemblyInput);
  } catch (err) {
    return {
      ok: false,
      reason: "assembly_failed",
      detail: err instanceof Error ? err.message : "assembly failed",
    };
  }

  const command: GenerateDailyReadingCommandV1 = {
    command_version: "v1",
    schema_version: M3_SCHEMA_VERSION,
    reading_id: ctx.readingId,
    reading_key: buildReadingKey(
      userId,
      day.targetLocalDate,
      releaseRow.version,
      ctx.revision,
    ),
    revision: ctx.revision,
    revision_reason: ctx.revisionReason,
    supersedes_reading_id: ctx.supersedesReadingId,
    command_generation: ctx.commandGeneration,
    replaces_job_id: ctx.replacesJobId,
    command_replacement_reason: ctx.commandReplacementReason,
    target_local_date: day.targetLocalDate,
    target_timezone: preferences.timezone,
    timezone_revision: preferences.timezoneRevision,
    day_start_at: day.dayStartAt,
    day_end_at: day.dayEndAt,
    generation_anchor: assemblyInput.generation_anchor,
    locale: preferences.locale,
    domain_preference: null,
    identity_profile: "patternlike.assembly-id.v1",
    output_schema: "daily-reading-v3",
    assembly_policy_id: ASSEMBLY_POLICY_ID,
    assembly_policy_version: ASSEMBLY_POLICY_VERSION,
    chart: {
      snapshot_id: chart.id,
      fingerprint: chart.fingerprint,
      profile_version: chart.profile_version,
      contract_id: chart.contract_id,
      contract_version: chart.contract_version,
      container_digest: chart.container_digest,
      tzdb_version: chart.tzdb_version,
      effective_accuracy: effectiveAccuracy,
      uncertainty: assemblyInput.chart.uncertainty,
    },
    cycle_scan: {
      cycles: derived.map((cycle) => ({
        cycle_id: cycle.cycleId,
        pass_ids: cycle.passIds,
        cycle_hash: cycle.hash,
      })),
      cycle_policy_id: CYCLE_POLICY_ID,
      cycle_policy_version: CYCLE_POLICY_VERSION,
      orb_policy_id: TRANSIT_ORB_POLICY_ID,
      orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
      container_digest: scan.response.container_digest,
      ephemeris_data_version: scan.response.ephemeris_data_version,
    },
    release_version: releaseRow.version,
    release_bundle_hash: releaseRow.bundle_hash,
    context: contextPins,
    assembly_id: assemblyId,
  };

  return { ok: true, command, chartId: chart.id, cycles, day };
}
