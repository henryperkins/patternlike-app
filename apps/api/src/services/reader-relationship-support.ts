import {
  CALC_CONTRACT_ID, CALC_CONTRACT_VERSION, ZODIAC_SIGNS, canonicalAspectPair, canonicalJson, cycleHash, sha256Hex,
  type AuthorizedReaderUnit, type BirthTimeAccuracy, type CalculatedFeature, type CelestialBody,
  type DailyReadingV5, type NatalParticipant, type NormalizedCycle, type ParagraphEvidenceV5,
  type PatternDocumentInternal, type PatternFactPacket, type PatternPlan, type ReaderRelationshipSupport,
} from "@patternlike/shared";
import type { ConstrainedFact, ConstrainedNatalFactInput } from "@patternlike/reading-engine";
import { hashChartFingerprint } from "../db/pattern-claims.js";
import { localDateIn } from "./local-day.js";

const POLICY = "reader-coordinate/v1";
const FRAME = "tropical_geocentric" as const;
const BODIES = new Set(["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "true_node", "ascendant", "midheaven"]);
const body = (value: unknown): value is CelestialBody => typeof value === "string" && BODIES.has(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const angle = (value: string) => value === "ascendant" || value === "midheaven";
const timeSensitive = (value: string) => angle(value) || value === "moon";

interface ChartContext {
  chartFingerprintHash: string;
  effectiveAccuracy: BirthTimeAccuracy;
  suppressedFeatures: readonly string[];
}

function bodyAvailable(value: string, context: ChartContext): boolean {
  if (timeSensitive(value) && context.effectiveAccuracy !== "exact") return false;
  if (value === "moon" && context.suppressedFeatures.includes("moon_time_sensitive")) return false;
  return !angle(value) || !context.suppressedFeatures.some((kind) => kind === "angles" || kind === "angle_transits");
}

function participant(value: string, role: NatalParticipant["role"], context: ChartContext): NatalParticipant {
  return { chart: context.chartFingerprintHash, body: value, frame: FRAME, policy: POLICY, role,
    requires_birth_time: timeSensitive(value) };
}

function feature(
  kind: CalculatedFeature["kind"], participants: CalculatedFeature["participants"], coordinate: unknown,
  context: ChartContext, requiresTime = false,
): CalculatedFeature {
  return {
    chart: context.chartFingerprintHash, policy: POLICY, kind, frame: FRAME, participants,
    coordinate: canonicalJson(coordinate), uncertainty_policy: `reader-uncertainty/v1:${context.effectiveAccuracy}`,
    requires_birth_time: requiresTime || participants.some((entry) => entry.role !== "transiting" && timeSensitive(entry.body)),
  };
}

function natalSupport(
  value: { body: string; longitude?: number; position?: { sign_index: number; degree_deg: number };
    house?: number | null; target?: string; aspect?: string; orb?: number },
  context: ChartContext,
): Pick<AuthorizedReaderUnit, "features" | "participants"> {
  const result: Pick<AuthorizedReaderUnit, "features" | "participants"> = { features: [], participants: [] };
  if (!body(value.body) || !bodyAvailable(value.body, context)) return result;
  if (value.target && (!body(value.target) || !bodyAvailable(value.target, context))) return result;
  result.participants.push(participant(value.body, "natal_interpretation", context));
  if (value.target) {
    result.participants.push(participant(value.target, "natal_interpretation", context));
    if (value.aspect && finite(value.orb) && body(value.target)) {
      // Natal aspects are symmetric; use the same canonical body pair as M4.
      // Transit roles below remain explicitly ordered and never use this rule.
      const [first, second] = canonicalAspectPair(value.body, value.target);
      result.features.push(feature("natal_aspect", [
        { body: first, role: "natal_subject" }, { body: second, role: "natal_object" },
      ], { aspect: value.aspect, orb_deg: value.orb }, context));
    }
  } else {
    // Daily has already performed this exact within-sign arithmetic. Applying
    // it to Pattern's longitude avoids a lossy reconstruct-and-compare step.
    const position = value.position ?? (finite(value.longitude) && value.longitude >= 0 && value.longitude < 360
      ? { sign_index: Math.floor(value.longitude / 30), degree_deg: ((value.longitude % 30) + 30) % 30 } : undefined);
    if (position) result.features.push(feature("natal_position",
      [{ body: value.body, role: "natal_subject" }], position, context));
    if (Number.isInteger(value.house) && Number(value.house) >= 1 && Number(value.house) <= 12 &&
      context.effectiveAccuracy === "exact" && !context.suppressedFeatures.includes("houses")) {
      result.features.push(feature("natal_house", [{ body: value.body, role: "natal_subject" }], { house: value.house }, context, true));
    }
  }
  return result;
}

function dailyNatalSupport(value: ConstrainedNatalFactInput, context: ChartContext) {
  if (value.fact_class === "natal_aspect") return natalSupport({
    body: value.body, target: value.target ?? undefined, aspect: value.aspect ?? undefined,
    orb: value.degree_deg ?? undefined,
  }, context);
  const signIndex = value.sign === null ? -1 : ZODIAC_SIGNS.indexOf(value.sign);
  const position = signIndex >= 0 && finite(value.degree_deg) && value.degree_deg >= 0 && value.degree_deg < 30
    ? { sign_index: signIndex, degree_deg: value.degree_deg } : undefined;
  return natalSupport({ body: value.body, position, house: value.house }, context);
}

function transitSupport(transiting: string, target: string, aspect: string, exactAt: string, context: ChartContext) {
  if (!body(transiting) || !body(target) || !bodyAvailable(target, context) || !Number.isFinite(Date.parse(exactAt))) {
    return { features: [], participants: [] };
  }
  return {
    features: [feature("transit_aspect", [
      { body: transiting, role: "transiting" }, { body: target, role: "natal_target" },
    ], { aspect, exact_at: exactAt }, context)],
    participants: [participant(target, "transit_target", context)],
  };
}

/** Caller has verified the stored cycle, owner, current chart, and supported contract. */
export async function readerTimingUnits(input: ChartContext & {
  cycle: NormalizedCycle;
  timeZone: string;
  policyVersion: string;
}): Promise<AuthorizedReaderUnit[]> {
  const { cycle } = input;
  if (cycle.technique !== "transit" || !body(cycle.body) || !body(cycle.target) || !bodyAvailable(cycle.target, input) ||
    cycle.pass_count !== cycle.passes.length || cycle.passes.length === 0 ||
    cycle.passes.some((pass, index) => pass.pass_index !== index + 1 ||
      !Number.isFinite(Date.parse(pass.exact_at)) || Date.parse(pass.exact_at) < Date.parse(cycle.start_at) ||
      Date.parse(pass.exact_at) > Date.parse(cycle.end_at))) return [];
  const hash = await cycleHash(cycle);
  return cycle.passes.map((pass) => ({
    target: {
      kind: "timing", cycle_id: cycle.id, cycle_hash: hash, pass_index: pass.pass_index,
      starts_at: cycle.start_at, ends_at: cycle.end_at, exact_at: pass.exact_at,
      local_date: localDateIn(input.timeZone, new Date(pass.exact_at)), time_zone: input.timeZone,
      policy_version: input.policyVersion,
    },
    eligible: true, birth_time: input.effectiveAccuracy,
    ...transitSupport(cycle.body, cycle.target, cycle.aspect, pass.exact_at, input),
    occurrence: { chart: input.chartFingerprintHash, exact_at: pass.exact_at },
  }));
}

const distinct = <T>(values: T[]): T[] => [...new Map(values.map((value) => [canonicalJson(value), value])).values()];

/** Accepted per-paragraph refs are the only joins to the frozen selected facts. */
export async function deriveDailyReaderRelationshipSupport(input: {
  reading: DailyReadingV5;
  contentHash: string;
  paragraphEvidence: readonly ParagraphEvidenceV5[];
  selectedFacts: readonly ConstrainedFact[];
  chartFingerprint: string;
  contractId: string;
  contractVersion: string;
  effectiveAccuracy: BirthTimeAccuracy;
  suppressedFeatures: readonly string[];
  timeZone: string;
  dayStartAt: string;
  dayEndAt: string;
  cyclePolicyVersion: string;
}): Promise<ReaderRelationshipSupport> {
  const support: ReaderRelationshipSupport = { schema_version: "reader-relationship-support/v1", units: [] };
  if (input.contractId !== CALC_CONTRACT_ID || input.contractVersion !== CALC_CONTRACT_VERSION) return support;
  const context: ChartContext = { ...input, chartFingerprintHash: await hashChartFingerprint(input.chartFingerprint) };
  const facts = new Map(input.selectedFacts.map((fact) => [fact.fact_id, fact]));
  const paragraphs = new Set(input.reading.paragraphs.map((paragraph) => paragraph.paragraph_id));
  for (const paragraph of input.paragraphEvidence) {
    if (!paragraphs.has(paragraph.paragraph_id)) continue;
    const unit: AuthorizedReaderUnit = {
      target: { kind: "daily", reading_id: input.reading.reading_id, revision: input.reading.revision,
        content_hash: input.contentHash, paragraph_id: paragraph.paragraph_id },
      eligible: true, birth_time: input.effectiveAccuracy, features: [], participants: [], cycle_refs: [],
      day: { chart: context.chartFingerprintHash, local_date: input.reading.local_date, time_zone: input.timeZone,
        starts_at: input.dayStartAt, ends_at: input.dayEndAt },
    };
    for (const ref of paragraph.fact_refs) {
      const fact = facts.get(ref.fact_id);
      if (!fact || fact.fact_class !== ref.fact_class) continue;
      if (fact.support.kind === "natal") {
        const derived = dailyNatalSupport(fact.support.value, context);
        unit.features.push(...derived.features);
        unit.participants.push(...derived.participants);
      } else if (fact.support.kind === "cycle" && body(fact.support.value.body)) {
        const cycleUnits = await readerTimingUnits({ ...context, cycle: { ...fact.support.value, body: fact.support.value.body },
          timeZone: input.timeZone, policyVersion: input.cyclePolicyVersion });
        for (const cycle of cycleUnits) {
          unit.features.push(...cycle.features);
          unit.participants.push(...cycle.participants);
          if (cycle.target.kind === "timing") unit.cycle_refs!.push(cycle.target);
        }
      } else if (fact.support.kind === "daily_sky") {
        const value = fact.support.value;
        if (value.kind === "transit_natal_contact" && value.scope === "personalized" &&
          "transiting_body" in value.detail && "natal_target" in value.detail) {
          const derived = transitSupport(value.detail.transiting_body, value.detail.natal_target,
            value.detail.aspect, value.effective_at, context);
          unit.features.push(...derived.features);
          unit.participants.push(...derived.participants);
        }
      }
    }
    unit.features = distinct(unit.features);
    unit.participants = distinct(unit.participants);
    unit.cycle_refs = distinct(unit.cycle_refs!);
    support.units.push(unit);
  }
  return support;
}

/** Same canonical chapter-source serialization used by the existing portrait binding. */
export function readerPatternChapterSource(chapter: PatternDocumentInternal["artifact"]["chapters"][number]): string {
  return JSON.stringify({ title: chapter.title, summary: chapter.summary,
    sections: chapter.sections.map((unit) => unit.text), tensions: chapter.tensions.map((unit) => unit.text),
    resources: chapter.resources.map((unit) => unit.text), counterExpression: chapter.counter_expression.text });
}

/** Source packet and accepted writer are already bound by the publication proof. */
export async function derivePatternReaderRelationshipSupport(input: {
  document: PatternDocumentInternal;
  generatedAt: string;
  contentHash: string;
  chartFingerprintHash: string;
  contractId: string;
  contractVersion: string;
  packet: PatternFactPacket;
  plan: PatternPlan;
}): Promise<ReaderRelationshipSupport> {
  const support: ReaderRelationshipSupport = { schema_version: "reader-relationship-support/v1", units: [] };
  if (input.contractId !== CALC_CONTRACT_ID || input.contractVersion !== CALC_CONTRACT_VERSION) return support;
  const context: ChartContext = { chartFingerprintHash: input.chartFingerprintHash,
    effectiveAccuracy: input.packet.effective_accuracy, suppressedFeatures: input.packet.uncertainty.suppressed_classes };
  const packet = new Map(input.packet.features.map((fact) => [fact.alias, fact]));
  for (const [index, chapter] of input.document.artifact.chapters.entries()) {
    const planned = input.plan.chapters.find((entry) => entry.chapter_key === chapter.chapter_key);
    if (!planned) continue;
    const acceptedUnits = [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression];
    const aliases = new Set(acceptedUnits.flatMap((unit) => unit.feature_aliases)
      .filter((alias) => planned.feature_aliases.includes(alias)));
    const unit: AuthorizedReaderUnit = {
      target: { kind: "pattern", pattern_id: input.document.pattern_id,
        document_revision: `${input.document.schema_version}:${input.document.pattern_id}:${input.generatedAt}`,
        content_hash: input.contentHash, chapter_index: index,
        chapter_source_sha256: await sha256Hex(readerPatternChapterSource(chapter)) },
      eligible: true, birth_time: context.effectiveAccuracy, features: [], participants: [],
    };
    for (const alias of aliases) {
      const selected = packet.get(alias);
      if (!selected) continue;
      const fact = selected.fact;
      let derived: Pick<AuthorizedReaderUnit, "features" | "participants"> = { features: [], participants: [] };
      if (selected.feature_class === "position" && body(fact.body)) {
        derived = natalSupport({ body: fact.body, longitude: finite(fact.longitude) ? fact.longitude : undefined,
          house: typeof fact.house === "number" ? fact.house : null }, context);
      } else if (selected.feature_class === "aspect" && body(fact.body_a) && body(fact.body_b) &&
        typeof fact.aspect === "string" && finite(fact.orb)) {
        derived = natalSupport({ body: fact.body_a, target: fact.body_b, aspect: fact.aspect, orb: fact.orb }, context);
      } else if (selected.feature_class === "angle" && body(fact.angle)) {
        derived = natalSupport({ body: fact.angle, longitude: finite(fact.longitude) ? fact.longitude : undefined }, context);
      } else if (selected.feature_class === "pattern" && Array.isArray(fact.member_bodies)) {
        derived.participants = fact.member_bodies.filter(body).filter((value) => bodyAvailable(value, context))
          .map((value) => participant(value, "natal_interpretation", context));
      }
      unit.features.push(...derived.features);
      unit.participants.push(...derived.participants);
    }
    unit.features = distinct(unit.features);
    unit.participants = distinct(unit.participants);
    support.units.push(unit);
  }
  return support;
}
