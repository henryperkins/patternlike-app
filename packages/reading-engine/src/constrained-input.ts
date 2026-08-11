/**
 * The one eligibility-and-identity entry point for constrained-model readings.
 *
 * V5 removed deterministic prose assembly. It did not remove deterministic
 * ELIGIBILITY, and this file is where that survives: every fact the model may
 * cite, every consented context lane it may be shaped by, and the exact bytes
 * that identify the frozen input all come from here. Enqueue runs it to build a
 * command; execute runs it again over the reconstructed inputs and compares the
 * two hashes before any provider call. A caller that reached past it — to a
 * lower-level identity builder, or to its own copy of the eligibility partition
 * — would make that comparison meaningless.
 *
 * Purity contract, inherited from the package: no fetch, no D1, no `Date.now()`,
 * no crypto. Content-addressed handles are therefore SUPPLIED, and both
 * canonical strings are returned as text for the caller to hash.
 */

import {
  M5_SCHEMA_VERSION,
  M5_SUPPORTED_USES,
  isM5SupportedUse,
  type AiConsentDataCategory,
  type AspectType,
  type CelestialBody,
  type DailySkyFact,
  type FactAttributes,
  type LaneRank,
  type M5AllowedUse,
  type M5FactClass,
  type PriorReadingExcerpt,
  type ReadingComposition,
  type ReadingGenerationRequest,
  type RequestContext,
  type RequestFact,
  type ZodiacSignName,
  GENERATED_PARAGRAPH_ROLES,
} from "@patternlike/shared";

import { partitionContext, factSuppressionReason } from "./eligibility.js";
import { localDayMidpoint, projectUncertainty } from "./identity.js";
import { computePhase } from "./phase.js";
import { jcsCanonicalize } from "./jcs.js";
import {
  GENERATION_INPUT_IDENTITY_PROFILE,
  GENERATION_INPUT_MANIFEST_PROFILE,
  HEADLINE_MAX_CHARS,
  LEAD_MAX_CHARS,
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_TEXT_BYTES,
  MAX_FEEDBACK_RECORDS,
  MAX_PRIOR_READINGS,
  PARAGRAPH_MAX_CHARS,
  REFLECTION_MAX_CHARS,
  SELECTION_POLICY_ID,
  type ConstrainedContextContent,
  type ConstrainedContextRef,
  type ConstrainedContextSignalInput,
  type ConstrainedContextSourceInput,
  type ConstrainedFact,
  type ConstrainedNatalFactInput,
  type ConstrainedPriorReading,
  type ConstrainedReadingInput,
  type PreparedConstrainedReadingInput,
} from "./constrained-types.js";
import type {
  AssemblyFactInput,
  NormalizedCycle,
  NormalizedContextSignal,
  Rejection,
} from "./types.js";

export class ConstrainedInputError extends Error {
  readonly code = "constrained_input_invalid";
  constructor(message: string) {
    super(message);
    this.name = "ConstrainedInputError";
  }
}

// ---------------------------------------------------------------------------
// Byte arithmetic
// ---------------------------------------------------------------------------

/**
 * UTF-8 length without a `TextEncoder`.
 *
 * Written out rather than delegated because the ceilings this feeds are
 * contractual: the 2,048-byte excerpt cap and the packet ceiling both have to
 * mean the same thing in a Worker, in `node:test`, and in a Python fixture
 * check. A lone surrogate is counted as the replacement character, which is
 * what an encoder would emit for it.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/**
 * NFC-normalize, then cut to `MAX_CONTEXT_TEXT_BYTES` on a code-point boundary.
 *
 * Both halves matter. Without normalization the same visible sentence occupies a
 * different number of bytes depending on which keyboard produced it, so an
 * execution-time re-read could truncate differently and change the packet.
 * Without the code-point boundary the cut could land inside a multi-byte
 * sequence and produce text that is no longer valid UTF-8.
 */
export function normalizeExcerpt(text: string): string {
  const normalized = text.normalize("NFC");
  if (utf8ByteLength(normalized) <= MAX_CONTEXT_TEXT_BYTES) return normalized;
  let out = "";
  let bytes = 0;
  for (const codePoint of normalized) {
    const size = utf8ByteLength(codePoint);
    if (bytes + size > MAX_CONTEXT_TEXT_BYTES) break;
    out += codePoint;
    bytes += size;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BODY_LABEL: Readonly<Record<CelestialBody, string>> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  true_node: "True Node",
  ascendant: "Ascendant",
  midheaven: "Midheaven",
};

const SIGN_LABEL: Readonly<Record<ZodiacSignName, string>> = {
  aries: "Aries",
  taurus: "Taurus",
  gemini: "Gemini",
  cancer: "Cancer",
  leo: "Leo",
  virgo: "Virgo",
  libra: "Libra",
  scorpio: "Scorpio",
  sagittarius: "Sagittarius",
  capricorn: "Capricorn",
  aquarius: "Aquarius",
  pisces: "Pisces",
};

const ASPECT_LABEL: Readonly<Record<AspectType, string>> = {
  conjunction: "conjunct",
  sextile: "sextile",
  square: "square",
  trine: "trine",
  opposition: "opposite",
};

const KNOWN_BODIES: ReadonlySet<string> = new Set(Object.keys(BODY_LABEL));

function asBody(value: string | null | undefined): CelestialBody | null {
  return value && KNOWN_BODIES.has(value) ? (value as CelestialBody) : null;
}

/** Two decimals, matching how the calculation service renders its own labels. */
function degrees(value: number): string {
  return value.toFixed(2);
}

function dateOf(instant: string): string {
  return instant.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Fact lanes
// ---------------------------------------------------------------------------

/**
 * Deterministic reading priority: 1 active personalized cycles, 2 personalized
 * daily contacts and placements, 3 collective daily sky, 4 stable natal
 * context.
 *
 * `house_placement` sits in lane 2 rather than 3 because it is a fact about the
 * reader's own chart. Lane rank orders the packet; `scope` is what stops a
 * paragraph describing a collective sky as personal, and the two answer
 * different questions.
 */
const LANE_RANK: Readonly<Record<M5FactClass, LaneRank>> = {
  cycle_instance: 1,
  transit_natal_contact: 2,
  house_placement: 2,
  anchor_position: 3,
  lunar_phase: 3,
  sign_ingress: 3,
  collective_exact_aspect: 3,
  natal_position: 4,
  natal_aspect: 4,
};

const FACT_CATEGORY: Readonly<Record<M5FactClass, AiConsentDataCategory>> = {
  cycle_instance: "active_calculated_cycles",
  transit_natal_contact: "calculated_daily_sky",
  house_placement: "calculated_daily_sky",
  anchor_position: "calculated_daily_sky",
  lunar_phase: "calculated_daily_sky",
  sign_ingress: "calculated_daily_sky",
  collective_exact_aspect: "calculated_daily_sky",
  natal_position: "calculated_natal_facts",
  natal_aspect: "calculated_natal_facts",
};

function emptyAttributes(): FactAttributes {
  return { bodies: [], signs: [], houses: [], degrees: [], timestamps: [], dates: [] };
}

function uniqueSorted<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : 1,
  );
}

// ---------------------------------------------------------------------------
// Fact projection
// ---------------------------------------------------------------------------

function projectCycleFact(cycle: NormalizedCycle, midpoint: string): ConstrainedFact {
  const body = asBody(cycle.body);
  const target = asBody(cycle.target);
  const phase = computePhase(cycle, midpoint);
  const attributes = emptyAttributes();
  attributes.bodies = uniqueSorted([body, target].filter((b): b is CelestialBody => b !== null));
  attributes.aspect = cycle.aspect;
  attributes.degrees = [cycle.orb_deg];
  attributes.dates = uniqueSorted([
    dateOf(cycle.start_at),
    ...cycle.passes.map((p) => dateOf(p.exact_at)),
    dateOf(cycle.end_at),
  ]);
  if (phase) attributes.phase = phase;

  const bodyLabel = body ? BODY_LABEL[body] : cycle.body;
  const targetLabel = target ? BODY_LABEL[target] : cycle.target;
  const label =
    `${bodyLabel} ${ASPECT_LABEL[cycle.aspect]} your ${targetLabel}` +
    (phase ? `, ${phase}` : "");

  return {
    fact_id: cycle.id,
    fact_class: "cycle_instance",
    scope: "personalized",
    lane_rank: LANE_RANK.cycle_instance,
    label,
    attributes,
    origin: "cycle_scan",
    content_digest: null,
    category: FACT_CATEGORY.cycle_instance,
  };
}

function projectSkyFact(fact: DailySkyFact): ConstrainedFact {
  const attributes = emptyAttributes();
  const detail = fact.detail;

  switch (fact.kind) {
    case "anchor_position": {
      const d = detail as Extract<DailySkyFact["detail"], { sign_degree_deg: number }>;
      attributes.bodies = [d.body];
      attributes.signs = [d.sign];
      attributes.degrees = [d.sign_degree_deg];
      break;
    }
    case "lunar_phase": {
      const d = detail as Extract<DailySkyFact["detail"], { illuminated_fraction: number }>;
      attributes.bodies = ["moon", "sun"];
      attributes.lunar_phase = d.phase;
      break;
    }
    case "transit_natal_contact": {
      const d = detail as Extract<DailySkyFact["detail"], { natal_target: CelestialBody }>;
      attributes.bodies = uniqueSorted([d.transiting_body, d.natal_target]);
      attributes.aspect = d.aspect;
      attributes.timestamps = [fact.effective_at];
      break;
    }
    case "sign_ingress": {
      const d = detail as Extract<DailySkyFact["detail"], { from_sign: ZodiacSignName }>;
      attributes.bodies = [d.body];
      attributes.signs = uniqueSorted([d.from_sign, d.to_sign]);
      attributes.timestamps = [fact.effective_at];
      break;
    }
    case "collective_exact_aspect": {
      const d = detail as Extract<DailySkyFact["detail"], { other_body: CelestialBody }>;
      attributes.bodies = uniqueSorted([d.body, d.other_body]);
      attributes.aspect = d.aspect;
      attributes.timestamps = [fact.effective_at];
      break;
    }
    case "house_placement": {
      const d = detail as Extract<DailySkyFact["detail"], { house: number }>;
      attributes.bodies = [d.body];
      attributes.houses = [d.house];
      break;
    }
  }

  return {
    fact_id: fact.fact_id,
    fact_class: fact.kind,
    scope: fact.scope,
    lane_rank: LANE_RANK[fact.kind],
    label: fact.label,
    attributes,
    origin: "daily_sky",
    content_digest: fact.content_digest,
    category: FACT_CATEGORY[fact.kind],
  };
}

function projectNatalFact(fact: ConstrainedNatalFactInput): ConstrainedFact {
  const body = asBody(fact.body);
  const target = asBody(fact.target);
  const attributes = emptyAttributes();
  attributes.bodies = uniqueSorted(
    [body, target].filter((b): b is CelestialBody => b !== null),
  );
  if (fact.aspect) attributes.aspect = fact.aspect;
  if (fact.sign) attributes.signs = [fact.sign];
  if (fact.house !== null) attributes.houses = [fact.house];
  if (fact.degree_deg !== null) attributes.degrees = [fact.degree_deg];

  const bodyLabel = body ? BODY_LABEL[body] : fact.body;
  let label: string;
  if (fact.fact_class === "natal_aspect" && fact.aspect && target) {
    label = `Natal ${bodyLabel} ${ASPECT_LABEL[fact.aspect]} natal ${BODY_LABEL[target]}`;
  } else if (fact.sign && fact.degree_deg !== null) {
    label = `Natal ${bodyLabel} at ${degrees(fact.degree_deg)} degrees ${SIGN_LABEL[fact.sign]}`;
  } else if (fact.sign) {
    label = `Natal ${bodyLabel} in ${SIGN_LABEL[fact.sign]}`;
  } else {
    label = `Natal ${bodyLabel}`;
  }

  return {
    fact_id: fact.fact_id,
    fact_class: fact.fact_class,
    scope: "personalized",
    lane_rank: LANE_RANK[fact.fact_class],
    label,
    attributes,
    origin: "natal",
    content_digest: null,
    category: FACT_CATEGORY[fact.fact_class],
  };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * The uncertainty gate, expressed as one `AssemblyFactInput` per candidate so
 * `factSuppressionReason()` stays the single owner of the angle and Moon rules.
 *
 * Suppression already happens at the source — the calculation service never
 * computes an angle contact under an unknown birth time — so reaching a
 * suppressed fact here means something upstream leaked. It is still checked,
 * because "the other layer handles it" is how the unknown-birth-time invariant
 * gets reintroduced one layer up.
 */
function suppressionReason(
  fact: ConstrainedFact,
  suppressed: ReadonlySet<string>,
): string | null {
  if (fact.attributes.houses.length > 0 && suppressed.has("houses")) {
    return "uncertainty_houses_suppressed";
  }
  for (const body of fact.attributes.bodies) {
    const probe: AssemblyFactInput = {
      id: fact.fact_id,
      fact_class: "cycle_instance",
      technique: null,
      body: null,
      target: body,
      aspect: null,
      phase: null,
      orb_deg: null,
      first_exact_at: null,
      pass_count: null,
    };
    const reason = factSuppressionReason(probe, suppressed);
    // A collective fact about the sky's own Moon is not a claim about the
    // reader's birth-time-sensitive Moon; only personalized facts are gated.
    if (reason && (fact.scope === "personalized" || !reason.includes("moon"))) {
      return reason;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PendingPin {
  signal: ConstrainedContextSignalInput;
  source: ConstrainedContextSourceInput;
  allowed_use: M5AllowedUse;
}

function sameUseSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

function sourceRejection(source: ConstrainedContextSourceInput): string | null {
  if (source.permission_state !== "active") return "context_permission_inactive";
  if (source.consent_status !== "granted") return "context_source_consent_not_granted";
  if (
    source.permission_consent_id !== source.consent_id ||
    source.consent_source_id !== source.source_id ||
    !sameUseSet(source.permission_allowed_uses, source.consent_allowed_uses)
  ) {
    return "context_source_consent_disagreement";
  }
  return null;
}

function compareSignals(
  a: ConstrainedContextSignalInput,
  b: ConstrainedContextSignalInput,
): number {
  if (a.observed_at !== b.observed_at) return a.observed_at < b.observed_at ? 1 : -1;
  return a.signal_id < b.signal_id ? -1 : a.signal_id > b.signal_id ? 1 : 0;
}

/**
 * Expand every eligible signal into one pin per permitted lane, then run the
 * shared partition over the expansion.
 *
 * The intersection is exact: `signal.allowed_uses ∩ source-consent.allowed_uses
 * ∩ M5_SUPPORTED_USES`. `ai_synthesis` is the outer purpose consent and appears
 * nowhere in it — it can never make an otherwise ineligible signal eligible.
 */
function expandContext(
  input: ConstrainedReadingInput,
  rejections: Rejection[],
): PendingPin[] {
  const granted = new Set(input.consent_categories);
  const sources = new Map<string, ConstrainedContextSourceInput>();

  for (const source of [...input.context_sources].sort((a, b) =>
    a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0,
  )) {
    const reason = sourceRejection(source);
    if (reason) {
      rejections.push({
        subject_kind: "source",
        subject_id: source.source_id,
        reason_code: reason,
        detail: `source ${source.source_id}`,
      });
      continue;
    }
    sources.set(source.source_id, source);
  }

  const candidates: NormalizedContextSignal[] = [];
  const byKey = new Map<string, PendingPin>();

  for (const signal of [...input.context_signals].sort(compareSignals)) {
    if (!granted.has(signal.category)) {
      rejections.push({
        subject_kind: "context",
        subject_id: signal.signal_id,
        reason_code: "consent_category_not_granted",
        detail: `category ${signal.category}`,
      });
      continue;
    }
    const source = sources.get(signal.source_id);
    if (!source) {
      rejections.push({
        subject_kind: "context",
        subject_id: signal.signal_id,
        reason_code: "context_source_not_permitted",
        detail: `source ${signal.source_id}`,
      });
      continue;
    }
    const consented = new Set(source.consent_allowed_uses);
    const uses = [...new Set(signal.allowed_uses)]
      .filter((use) => consented.has(use) && isM5SupportedUse(use))
      .sort() as M5AllowedUse[];
    if (uses.length === 0) {
      rejections.push({
        subject_kind: "context",
        subject_id: signal.signal_id,
        reason_code: "context_no_supported_use",
        detail: `source ${signal.source_id}`,
      });
      continue;
    }
    for (const use of uses) {
      const key = `${signal.signal_id}|${use}`;
      byKey.set(key, { signal, source, allowed_use: use });
      candidates.push({
        signal_id: signal.signal_id,
        source_id: signal.source_id,
        allowed_use: use,
        evidence_lane: signal.evidence_lane,
        normalized_hash: signal.normalized_hash,
        permission_state: "active",
        freshness_status: signal.freshness_status,
      });
    }
  }

  const { eligible, rejections: partitionRejections } = partitionContext(candidates);
  rejections.push(...partitionRejections);

  const pins: PendingPin[] = [];
  for (const signal of eligible) {
    const pin = byKey.get(`${signal.signal_id}|${signal.allowed_use}`);
    if (pin) pins.push(pin);
  }
  return pins;
}

/**
 * Feedback is capped by RECORD, not by pin: twenty signals may carry more than
 * twenty lanes between them, and the cap the design states is about how much
 * history the model sees.
 */
function capFeedback(pins: PendingPin[], rejections: Rejection[]): PendingPin[] {
  const feedbackSignals = new Map<string, ConstrainedContextSignalInput>();
  for (const pin of pins) {
    if (pin.signal.category === "reading_feedback") {
      feedbackSignals.set(pin.signal.signal_id, pin.signal);
    }
  }
  if (feedbackSignals.size <= MAX_FEEDBACK_RECORDS) return pins;

  const keep = new Set(
    [...feedbackSignals.values()]
      .sort(compareSignals)
      .slice(0, MAX_FEEDBACK_RECORDS)
      .map((s) => s.signal_id),
  );
  const kept: PendingPin[] = [];
  for (const pin of pins) {
    if (pin.signal.category === "reading_feedback" && !keep.has(pin.signal.signal_id)) {
      rejections.push({
        subject_kind: "context",
        subject_id: pin.signal.signal_id,
        reason_code: "feedback_record_limit",
        detail: `limit ${MAX_FEEDBACK_RECORDS}`,
      });
      continue;
    }
    kept.push(pin);
  }
  return kept;
}

/**
 * Reserve the newest signal of every source, then fill round-robin.
 *
 * Reservation first is what stops one chatty source from crowding every other
 * source out of the packet; the round-robin fill then spends what remains
 * evenly rather than depth-first.
 */
function orderPins(pins: readonly PendingPin[]): PendingPin[] {
  const bySource = new Map<string, PendingPin[]>();
  for (const pin of pins) {
    const list = bySource.get(pin.source.source_id) ?? [];
    list.push(pin);
    bySource.set(pin.source.source_id, list);
  }

  const sourceIds = [...bySource.keys()].sort();
  const queues = new Map<string, PendingPin[]>();
  const reserved: PendingPin[] = [];

  for (const sourceId of sourceIds) {
    const list = [...bySource.get(sourceId)!].sort((a, b) => {
      const bySignal = compareSignals(a.signal, b.signal);
      if (bySignal !== 0) return bySignal;
      return a.allowed_use < b.allowed_use ? -1 : a.allowed_use > b.allowed_use ? 1 : 0;
    });
    const newestSignalId = list[0]!.signal.signal_id;
    const head: PendingPin[] = [];
    const tail: PendingPin[] = [];
    for (const pin of list) {
      (pin.signal.signal_id === newestSignalId ? head : tail).push(pin);
    }
    reserved.push(...head);
    queues.set(sourceId, tail);
  }

  const filled: PendingPin[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const sourceId of sourceIds) {
      const queue = queues.get(sourceId)!;
      const next = queue.shift();
      if (next) {
        filled.push(next);
        remaining = remaining || queue.length > 0;
      }
    }
  }

  return [...reserved, ...filled];
}

function toSnapshot(content: ConstrainedContextContent): ConstrainedContextContent {
  return content.kind === "text"
    ? { kind: "text", text: normalizeExcerpt(content.text) }
    : { kind: "structured", value: content.value };
}

function toRequestContent(snapshot: ConstrainedContextContent): RequestContext["content"] {
  return snapshot.kind === "text"
    ? { kind: "untrusted_text", text: snapshot.text }
    : { kind: "structured", value: snapshot.value };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function buildComposition(
  facts: readonly ConstrainedFact[],
  uncertaintyNoteRequired: boolean,
): ReadingComposition {
  const hasPhase = facts.some(
    (f) => f.attributes.phase != null || f.attributes.lunar_phase != null,
  );
  const hasTiming = facts.some(
    (f) => f.attributes.timestamps.length > 0 || f.attributes.dates.length > 0,
  );
  const hasCollective = facts.some((f) => f.scope === "collective");

  const allowed = GENERATED_PARAGRAPH_ROLES.filter((role) => {
    if (role === "supporting_theme") return true;
    if (role === "phase_context") return hasPhase;
    if (role === "timing") return hasTiming;
    return hasCollective;
  });

  return {
    allowed_paragraph_roles: [...allowed],
    min_paragraphs: 1,
    max_paragraphs: allowed.length,
    headline_max_chars: HEADLINE_MAX_CHARS,
    lead_max_chars: LEAD_MAX_CHARS,
    paragraph_max_chars: PARAGRAPH_MAX_CHARS,
    reflection_max_chars: REFLECTION_MAX_CHARS,
    uncertainty_note_required: uncertaintyNoteRequired,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function toRequestFact(fact: ConstrainedFact): RequestFact {
  return {
    fact_id: fact.fact_id,
    fact_class: fact.fact_class,
    scope: fact.scope,
    lane_rank: fact.lane_rank,
    label: fact.label,
    attributes: fact.attributes,
  };
}

function toRequestContext(ref: ConstrainedContextRef): RequestContext {
  return {
    context_ref: ref.context_ref,
    category: ref.category,
    allowed_use: ref.allowed_use,
    observed_on: dateOf(ref.observed_at),
    content: toRequestContent(ref.snapshot),
  };
}

function packetBytes(request: ReadingGenerationRequest): number {
  return utf8ByteLength(jcsCanonicalize(request));
}

/** Whole days between two ISO dates, positive when `earlier` precedes `later`. */
function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new ConstrainedInputError(`local dates are not parseable: ${earlier} .. ${later}`);
  }
  return Math.round((b - a) / 86_400_000);
}

export function prepareConstrainedReadingInput(
  input: ConstrainedReadingInput,
): PreparedConstrainedReadingInput {
  const rejections: Rejection[] = [];
  const uncertainty = projectUncertainty(input.chart.uncertainty);

  // Two disagreeing copies of one decision is how an unknown-time chart
  // acquires an exact-time reading.
  if (input.chart.effective_accuracy !== uncertainty.accuracy) {
    throw new ConstrainedInputError(
      `effective_accuracy ${input.chart.effective_accuracy} disagrees with ` +
        `uncertainty.accuracy ${uncertainty.accuracy}`,
    );
  }
  if (!input.consent_categories.includes("birth_accuracy_and_uncertainty")) {
    throw new ConstrainedInputError(
      "the AI-synthesis grant must cover birth_accuracy_and_uncertainty: the packet " +
        "cannot describe what it may not say without it",
    );
  }
  if (input.context_max_bytes < 1024) {
    throw new ConstrainedInputError("context_max_bytes must be at least 1024");
  }

  const midpoint = localDayMidpoint(input.day.day_start_at, input.day.day_end_at);
  const suppressed = new Set(uncertainty.suppressed_features.map((f) => f.feature_class));
  const granted = new Set(input.consent_categories);

  const projected: ConstrainedFact[] = [
    ...input.cycles.map((cycle) => projectCycleFact(cycle, midpoint)),
    ...input.daily_sky_facts.map(projectSkyFact),
    ...input.natal_facts.map(projectNatalFact),
  ];

  const facts: ConstrainedFact[] = [];
  for (const fact of projected) {
    if (!granted.has(fact.category)) {
      rejections.push({
        subject_kind: "fact",
        subject_id: fact.fact_id,
        reason_code: "consent_category_not_granted",
        detail: `category ${fact.category}`,
      });
      continue;
    }
    const reason = suppressionReason(fact, suppressed);
    if (reason) {
      rejections.push({
        subject_kind: "fact",
        subject_id: fact.fact_id,
        reason_code: reason,
        detail: `fact_class ${fact.fact_class}`,
      });
      continue;
    }
    facts.push(fact);
  }

  if (facts.length === 0) {
    throw new ConstrainedInputError(
      "a constrained reading needs at least one calculated fact; a factless packet " +
        "could only produce invented prose",
    );
  }

  facts.sort((a, b) =>
    a.lane_rank !== b.lane_rank
      ? a.lane_rank - b.lane_rank
      : a.fact_id < b.fact_id
        ? -1
        : a.fact_id > b.fact_id
          ? 1
          : 0,
  );

  const suppressedFeatures = uniqueSorted(
    uncertainty.suppressed_features.map((f) => f.feature_class),
  );
  const composition = buildComposition(
    facts,
    uncertainty.suppressed_features.length > 0 || uncertainty.qualified_features.length > 0,
  );

  const request: ReadingGenerationRequest = {
    schema_version: M5_SCHEMA_VERSION,
    prompt_version: input.prompt_version,
    selection_policy_version: input.selection_policy_version,
    output_schema: input.output_schema,
    local_date: input.target_local_date,
    locale: input.locale,
    birth_time_accuracy: input.chart.effective_accuracy,
    suppressed_features: suppressedFeatures,
    domain_preference: input.domain_preference,
    facts: facts.map(toRequestFact),
    context: [],
    prior_readings: [],
    composition,
  };

  let bytes = packetBytes(request);
  if (bytes > input.context_max_bytes) {
    throw new ConstrainedInputError(
      `the mandatory packet is ${bytes} bytes and the ceiling is ${input.context_max_bytes}; ` +
        "a reading cannot be produced by dropping a calculated fact",
    );
  }

  // Prior readings: newest first, and only when the grant names them.
  const selectedPriorReadings: ConstrainedPriorReading[] = [];
  if (granted.has("prior_reading_excerpts")) {
    const ordered = [...input.prior_readings]
      .sort((a, b) => (a.local_date < b.local_date ? 1 : a.local_date > b.local_date ? -1 : 0))
      .filter((prior) => {
        const daysAgo = daysBetween(prior.local_date, input.target_local_date);
        return daysAgo >= 1 && daysAgo <= MAX_PRIOR_READINGS;
      })
      .slice(0, MAX_PRIOR_READINGS);

    for (const prior of ordered) {
      const excerpt: PriorReadingExcerpt = {
        days_ago: daysBetween(prior.local_date, input.target_local_date),
        headline: normalizeExcerpt(prior.headline),
        lead: normalizeExcerpt(prior.lead),
        reflection_prompt: normalizeExcerpt(prior.reflection_prompt),
      };
      request.prior_readings.push(excerpt);
      const next = packetBytes(request);
      if (next > input.context_max_bytes) {
        request.prior_readings.pop();
        rejections.push({
          subject_kind: "context",
          subject_id: prior.local_date,
          reason_code: "prior_reading_budget_exhausted",
          detail: `ceiling ${input.context_max_bytes}`,
        });
        break;
      }
      bytes = next;
      selectedPriorReadings.push(prior);
    }
  } else {
    for (const prior of input.prior_readings) {
      rejections.push({
        subject_kind: "context",
        subject_id: prior.local_date,
        reason_code: "consent_category_not_granted",
        detail: "category prior_reading_excerpts",
      });
    }
  }

  // Context: expand, partition, cap, order, then spend what is left.
  const ordered = orderPins(capFeedback(expandContext(input, rejections), rejections));
  const selectedContext: ConstrainedContextRef[] = [];
  let exhausted = false;

  for (const pin of ordered) {
    if (exhausted || selectedContext.length >= MAX_CONTEXT_ITEMS) {
      rejections.push({
        subject_kind: "context",
        subject_id: pin.signal.signal_id,
        reason_code: exhausted ? "context_budget_exhausted" : "context_item_limit",
        detail: `lane ${pin.allowed_use}`,
      });
      continue;
    }
    const ref: ConstrainedContextRef = {
      context_ref: `ctx_${selectedContext.length + 1}`,
      signal_id: pin.signal.signal_id,
      source_id: pin.signal.source_id,
      category: pin.signal.category,
      allowed_use: pin.allowed_use,
      evidence_lane: pin.signal.evidence_lane,
      normalized_hash: pin.signal.normalized_hash,
      consent_id: pin.source.consent_id,
      consent_version: pin.source.consent_version,
      permission_state: "active",
      freshness_status: "fresh",
      observed_at: pin.signal.observed_at,
      snapshot: toSnapshot(pin.signal.content),
    };
    request.context.push(toRequestContext(ref));
    const next = packetBytes(request);
    if (next > input.context_max_bytes) {
      request.context.pop();
      exhausted = true;
      rejections.push({
        subject_kind: "context",
        subject_id: pin.signal.signal_id,
        reason_code: "context_budget_exhausted",
        detail: `ceiling ${input.context_max_bytes}`,
      });
      continue;
    }
    bytes = next;
    selectedContext.push(ref);
  }

  const calculation = (pin: ConstrainedReadingInput["cycle_scan"]) => ({
    policy_id: pin.policy_id,
    policy_version: pin.policy_version,
    orb_policy_id: pin.orb_policy_id,
    orb_policy_version: pin.orb_policy_version,
    request_digest: pin.request_digest,
    response_digest: pin.response_digest,
    container_digest: pin.container_digest,
    ephemeris_data_version: pin.ephemeris_data_version,
  });

  /**
   * Everything that defines the frozen eligible input, and nothing that
   * describes what was NOT selected.
   *
   * Rejections are deliberately absent. Execution re-runs this entry point over
   * the command's frozen SUBSET, which no longer contains the corpus the
   * rejections were about, so a preimage that named them could never be
   * reproduced — and the mismatch would look like an integrity defect rather
   * than the tautology it is.
   */
  const selection = {
    facts: facts.map((fact) => ({
      fact_id: fact.fact_id,
      fact_class: fact.fact_class,
      scope: fact.scope,
      lane_rank: fact.lane_rank,
      origin: fact.origin,
      content_digest: fact.content_digest,
      label: fact.label,
      attributes: fact.attributes,
    })),
    context: selectedContext.map((ref) => ({
      context_ref: ref.context_ref,
      signal_id: ref.signal_id,
      source_id: ref.source_id,
      category: ref.category,
      allowed_use: ref.allowed_use,
      evidence_lane: ref.evidence_lane,
      normalized_hash: ref.normalized_hash,
      consent_id: ref.consent_id,
      consent_version: ref.consent_version,
      observed_at: ref.observed_at,
      snapshot_kind: ref.snapshot.kind,
    })),
    prior_readings: request.prior_readings.map((prior) => ({
      days_ago: prior.days_ago,
      headline: prior.headline,
      lead: prior.lead,
      reflection_prompt: prior.reflection_prompt,
    })),
  };

  const common = {
    schema_version: M5_SCHEMA_VERSION,
    selection_policy_id: SELECTION_POLICY_ID,
    selection_policy_version: input.selection_policy_version,
    validation_policy_version: input.validation_policy_version,
    prompt_version: input.prompt_version,
    output_schema: input.output_schema,
    local_date: input.target_local_date,
    target_timezone: input.target_timezone,
    locale: input.locale,
    generation_anchor: input.generation_anchor,
    revision: input.revision,
    domain_preference: input.domain_preference,
    consent_categories: [...input.consent_categories],
    day: {
      day_start_at: input.day.day_start_at,
      day_end_at: input.day.day_end_at,
      anchor_at: input.day.anchor_at,
      anchor_resolution: input.day.anchor_resolution,
      tzdb_version: input.day.tzdb_version,
      local_day_resolution_policy_version: input.day.local_day_resolution_policy_version,
    },
    chart: {
      fingerprint: input.chart.fingerprint,
      contract_id: input.chart.contract_id,
      contract_version: input.chart.contract_version,
      container_digest: input.chart.container_digest,
      effective_accuracy: input.chart.effective_accuracy,
      uncertainty,
    },
    cycle_scan: calculation(input.cycle_scan),
    daily_sky: calculation(input.daily_sky),
    composition,
    ...selection,
  };

  const identity_canonical = jcsCanonicalize({
    identity_profile: GENERATION_INPUT_IDENTITY_PROFILE,
    ...common,
  });
  const input_manifest_canonical = jcsCanonicalize({
    manifest_profile: GENERATION_INPUT_MANIFEST_PROFILE,
    context_max_bytes: input.context_max_bytes,
    packet_bytes: bytes,
    fact_count: facts.length,
    context_count: selectedContext.length,
    prior_reading_count: request.prior_readings.length,
    supported_uses: [...M5_SUPPORTED_USES],
    ...common,
  });

  return {
    selected_facts: facts,
    selected_context: selectedContext,
    selected_prior_readings: selectedPriorReadings,
    rejections,
    request,
    packet_bytes: bytes,
    input_manifest_canonical,
    identity_canonical,
  };
}
