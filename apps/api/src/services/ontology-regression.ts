import {
  contentHash,
  type BirthTimeAccuracy,
  type ChartSnapshot,
  type NatalFeature,
  type PatternFactPacket,
  type PatternOntologyRecord,
  type PatternPlan,
  type PatternResponseV7,
  type PatternSelectionManifest,
  type PatternSemanticVerdict,
  type PatternWriterOutput,
} from "@patternlike/shared";
import {
  projectPublicPattern,
  selectPatternEvidence,
  validatePatternCandidate,
  validatePatternPlan,
  type PatternSelectionResult,
} from "@patternlike/pattern-engine";

import {
  PATTERN_PACKET_LIMITS_DEFAULT,
  buildCorrectionDocument,
  buildPlannerInput,
  buildVerifierInput,
  buildWriterInput,
  type PatternCorrectionDocument,
} from "./pattern-packet.js";
import type {
  PatternPassProvenance,
  PatternStageClass,
} from "./pattern-publisher.js";
import {
  OPENAI_PATTERN_PLANNER_TIMEOUT_MS,
  OPENAI_PATTERN_VERIFIER_TIMEOUT_MS,
  OPENAI_PATTERN_WRITER_TIMEOUT_MS,
  patternProviderDisplayName,
} from "./pattern-publisher.js";
import { narrowPlannerOutput } from "./pattern-execute.js";
import { findSemanticVerdictProblem } from "./pattern-semantic.js";
import {
  ONTOLOGY_REGRESSION_FIXTURE_COUNT,
  ONTOLOGY_REGRESSION_PATTERN_PIN,
  OntologyRegressionError,
  type OntologyRegressionFixtureResult,
  type OntologyRegressionHardGateFailure,
} from "./ontology-regression-report.js";

export {
  ONTOLOGY_REGRESSION_FIXTURE_COUNT,
  ONTOLOGY_REGRESSION_MAXIMUM_ARITHMETIC,
  ONTOLOGY_REGRESSION_MAXIMUM_BILLABLE_TOKEN_UNITS,
  ONTOLOGY_REGRESSION_MAXIMUM_CALLS_PER_FIXTURE,
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS,
  ONTOLOGY_REGRESSION_MAXIMUM_INPUT_TOKENS_PER_CALL,
  ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS,
  ONTOLOGY_REGRESSION_MAXIMUM_PROVIDER_CALLS,
  ONTOLOGY_REGRESSION_PATTERN_PIN,
  OntologyRegressionError,
  createCanonicalOntologyRegressionReport,
  evaluateOntologyRegressionThresholds,
  ontologyRegressionConfigurationHash,
  type OntologyRegressionFailureReason,
  type OntologyRegressionFixtureResult,
  type OntologyRegressionHardGateFailure,
  type OntologyRegressionThresholdResult,
} from "./ontology-regression-report.js";

import manifestDocument from "../../../../contracts/m7/fixtures/corpus/manifest.json";
import exact01 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-01.json";
import exact02 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-02.json";
import exact03 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-03.json";
import exact04 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-04.json";
import exact05 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-05.json";
import exact06 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-06.json";
import exact07 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-07.json";
import exact08 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-08.json";
import exact09 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-09.json";
import exact10 from "../../../../contracts/m7/fixtures/corpus/en-US/exact-10.json";
import approximate01 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-01.json";
import approximate02 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-02.json";
import approximate03 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-03.json";
import approximate04 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-04.json";
import approximate05 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-05.json";
import approximate06 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-06.json";
import approximate07 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-07.json";
import approximate08 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-08.json";
import approximate09 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-09.json";
import approximate10 from "../../../../contracts/m7/fixtures/corpus/en-US/approximate-10.json";
import unknown01 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-01.json";
import unknown02 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-02.json";
import unknown03 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-03.json";
import unknown04 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-04.json";
import unknown05 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-05.json";
import unknown06 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-06.json";
import unknown07 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-07.json";
import unknown08 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-08.json";
import unknown09 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-09.json";
import unknown10 from "../../../../contracts/m7/fixtures/corpus/en-US/unknown-10.json";

export function ontologyRegressionPassTimeoutMs(
  pass: PatternStageClass,
): number {
  return pass === "planner"
    ? OPENAI_PATTERN_PLANNER_TIMEOUT_MS
    : pass === "writer"
      ? OPENAI_PATTERN_WRITER_TIMEOUT_MS
      : OPENAI_PATTERN_VERIFIER_TIMEOUT_MS;
}

export function ontologyRegressionPassMaximumOutputTokens(
  pass: PatternStageClass,
): number {
  return ONTOLOGY_REGRESSION_PATTERN_PIN[`${pass}_max_output_tokens`];
}

export interface OntologyRegressionFixture {
  schema_version: "ontology-regression-fixture/v1";
  fixture_id: string;
  locale: "en-US";
  effective_accuracy: BirthTimeAccuracy;
  declared_outcome: "accepted" | "refused";
  axes: string[];
  chart_snapshot: ChartSnapshot;
  feature_set_hash: string;
  features: NatalFeature[];
  chain: {
    selection_manifest: PatternSelectionManifest;
    fact_packet: PatternFactPacket;
    plan: PatternPlan;
    writer: PatternWriterOutput;
    verdict: PatternSemanticVerdict;
    public_projection: PatternResponseV7;
  };
}

export interface OntologyRegressionManifest {
  home: string;
  schema_version: "0.7.0";
  corpus_version: string;
  corpus_identity_hash: string;
  status: "authored";
  locale: "en-US";
  note: string;
  required_axes: string[];
  axis_assignments: Record<string, string[]>;
  reference_source_fragments: Array<{ id: string }>;
  reference_ontology_records: PatternOntologyRecord[];
  authored_chains: Array<{
    fixture_id: string;
    path: string;
    accuracy: BirthTimeAccuracy;
    axes: string[];
    sha256: string;
  }>;
}

export interface LoadedOntologyRegressionCorpus {
  manifest: OntologyRegressionManifest;
  manifest_hash: string;
  fixtures: OntologyRegressionFixture[];
  source_fragment_ids: ReadonlySet<string>;
}

const fixtureDocuments = [
  exact01,
  exact02,
  exact03,
  exact04,
  exact05,
  exact06,
  exact07,
  exact08,
  exact09,
  exact10,
  approximate01,
  approximate02,
  approximate03,
  approximate04,
  approximate05,
  approximate06,
  approximate07,
  approximate08,
  approximate09,
  approximate10,
  unknown01,
  unknown02,
  unknown03,
  unknown04,
  unknown05,
  unknown06,
  unknown07,
  unknown08,
  unknown09,
  unknown10,
] as unknown as OntologyRegressionFixture[];

/** Static imports make the Worker bundle, rather than a runtime filesystem, own the corpus. */
export function loadOntologyRegressionCorpus(): LoadedOntologyRegressionCorpus {
  const manifest = manifestDocument as unknown as OntologyRegressionManifest;
  if (
    manifest.status !== "authored" ||
    manifest.authored_chains.length !== ONTOLOGY_REGRESSION_FIXTURE_COUNT ||
    fixtureDocuments.length !== ONTOLOGY_REGRESSION_FIXTURE_COUNT ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.corpus_identity_hash)
  ) {
    throw new Error("ontology regression corpus is not the authored M7 freeze");
  }
  return {
    manifest,
    manifest_hash: manifest.corpus_identity_hash,
    fixtures: fixtureDocuments,
    source_fragment_ids: new Set(
      manifest.reference_source_fragments.map((fragment) => fragment.id),
    ),
  };
}

function writerLedgerUnits(writer: PatternWriterOutput): Array<{
  text: string;
  feature_aliases: string[];
  ontology_rule_ids: string[];
}> {
  const units: Array<{
    text: string;
    feature_aliases: string[];
    ontology_rule_ids: string[];
  }> = [];
  for (const chapter of writer.chapters) {
    units.push(...chapter.sections, ...chapter.tensions, ...chapter.resources);
    units.push(chapter.counter_expression);
  }
  for (const signature of writer.additional_signatures) units.push(signature);
  if (writer.uncertainty_note) units.push(writer.uncertainty_note);
  return units;
}

/**
 * One prose unit a text gate reads, tagged with the key that addresses it.
 *
 * These used to be `"\n"`-joined into one string per gate, which cost two
 * things. A title carries no terminal punctuation, so the prohibited-claim
 * splitter merged it with the next unit's first sentence and let an unrelated
 * heading decide whether a trigger word met its qualifier. And a gate that
 * fires on the joined string cannot say *which* unit tripped it, so the
 * writer-correctable retry had nowhere to point: candidate 0.1.16 spent its
 * entire three-call writer budget on fixture 0 re-answering "there is a
 * prohibited claim somewhere in this document". See
 * `docs/reviews/2026-08-24-ontology-regression-0.1.16-diagnosis.md`.
 *
 * `key` is null where no `CORRECTION_KEY_SHAPE` key addresses the unit -- the
 * document title and the uncertainty note. Those still gate; they just cannot
 * be pointed at, and the correction falls back to the code alone.
 */
interface KeyedWriterUnit {
  key: string | null;
  text: string;
}

/** The chapter-scoped units, in document order. The suppression gate's scope. */
function coreWriterUnits(writer: PatternWriterOutput): KeyedWriterUnit[] {
  return writer.chapters.flatMap((chapter) => [
    { key: chapter.chapter_key, text: chapter.title },
    { key: chapter.chapter_key, text: chapter.summary },
    ...chapter.sections.map((section) => ({
      key: section.section_key,
      text: section.text,
    })),
    ...chapter.tensions.map((unit) => ({
      key: chapter.chapter_key,
      text: unit.text,
    })),
    ...chapter.resources.map((unit) => ({
      key: chapter.chapter_key,
      text: unit.text,
    })),
    { key: chapter.chapter_key, text: chapter.counter_expression.text },
  ]);
}

/** Every unit, in document order. The prohibited-claim gate's scope. */
function allWriterUnits(writer: PatternWriterOutput): KeyedWriterUnit[] {
  return [
    { key: null, text: writer.title },
    ...coreWriterUnits(writer),
    ...writer.additional_signatures.flatMap((signature) => [
      { key: signature.signature_key, text: signature.title },
      { key: signature.signature_key, text: signature.text },
    ]),
    { key: null, text: writer.uncertainty_note?.text ?? "" },
  ];
}

function hasSuppressedPacketFeatureLeak(packet: PatternFactPacket): boolean {
  const suppressed = new Set(packet.uncertainty.suppressed_classes);
  if (
    suppressed.has("houses") &&
    packet.features.some((feature) =>
      feature.feature_class === "house_cusp" ||
      (feature.feature_class === "position" && feature.fact.house !== null))
  ) {
    return true;
  }
  if (
    suppressed.has("angles") &&
    packet.features.some((feature) => feature.feature_class === "angle")
  ) {
    return true;
  }
  return false;
}

/**
 * The first chapter unit that uses a withheld calculation, with its key.
 *
 * Per unit rather than over the joined chapter text, which is the same
 * decision: the joined form split on `\n+` as well, so no sentence ever
 * spanned two units and no `[^.!?\n]{0,80}` window ever crossed one. Iterating
 * only changes what the gate can *report*.
 */
function findSuppressedWriterLeak(
  packet: PatternFactPacket,
  writer: PatternWriterOutput,
): KeyedWriterUnit | null {
  const suppressed = new Set(packet.uncertainty.suppressed_classes);
  for (const unit of coreWriterUnits(writer)) {
    if (suppressedUnitLeaks(suppressed, unit.text)) return unit;
  }
  return null;
}

function suppressedUnitLeaks(
  suppressed: ReadonlySet<string>,
  text: string,
): boolean {
  const core = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) =>
      // Naming the withheld classes as a limitation is the required
      // uncertainty disclosure, not use of the withheld calculation. Keep the
      // exemption deliberately narrow: specific Ascendant/Midheaven, house
      // number, degree, longitude, or Moon claims still flow to the leak gate.
      !(
        /\bbirth[- ]time accuracy\b.*\bbounds? what can be said about houses and angles\b/i
          .test(sentence) &&
        !/\b(?:ascendant|midheaven|house\s+\d|degrees?|longitude|moon(?:'s)?\s+(?:degree|longitude|house))\b/i
          .test(sentence)
      ))
    .join("\n");
  const angleTransitLeak =
    /\b(?:angle|angular)[ _-]?transits?\b/i.test(core) ||
    /\btransits?\b[^.!?\n]{0,80}\b(?:ascendant|midheaven|chart angles?)\b/i
      .test(core) ||
    /\b(?:ascendant|midheaven|chart angles?)\b[^.!?\n]{0,80}\btransits?\b/i
      .test(core);
  const moonTimeSensitiveLeak =
    /\bmoon(?:'s)?\s+(?:degree|longitude|house|sign)\b/i.test(core) ||
    /\bmoon\s+(?:in|at)\s+(?:aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces|\d)/i
      .test(core) ||
    /\b(?:aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\s+moon\b/i
      .test(core) ||
    /\btime[ -]?sensitive\s+moon\b/i.test(core);
  return (
    (suppressed.has("houses") && /\b(?:houses?|house[ _-]?cusps?)\b/i.test(core)) ||
    (suppressed.has("angles") && /\b(?:ascendant|midheaven|chart angles?)\b/i.test(core)) ||
    (suppressed.has("angle_transits") && angleTransitLeak) ||
    (suppressed.has("moon_time_sensitive") && moonTimeSensitiveLeak)
  );
}

function hasSuppressedWriterLeak(
  packet: PatternFactPacket,
  writer: PatternWriterOutput,
): boolean {
  return findSuppressedWriterLeak(packet, writer) !== null;
}

function hasSuppressedLeak(
  packet: PatternFactPacket,
  writer: PatternWriterOutput,
): boolean {
  return hasSuppressedPacketFeatureLeak(packet) ||
    hasSuppressedWriterLeak(packet, writer);
}

function sourceDependenciesFail(
  writer: PatternWriterOutput,
  ontology: readonly PatternOntologyRecord[],
  sourceFragmentIds: ReadonlySet<string>,
): boolean {
  const byId = new Map(ontology.map((record) => [record.id, record]));
  const visiting = new Set<string>();
  const resolved = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false;
    const record = byId.get(id);
    if (!record) return false;
    visiting.add(id);
    const ok = record.meaning_class === "source_supported"
      ? record.source_fragment_ids.length > 0 &&
        record.source_fragment_ids.every((sourceId) =>
          sourceFragmentIds.has(sourceId))
      : record.meaning_class === "derived_synthesis" &&
        record.input_meaning_ids.length >= 2 &&
        record.input_meaning_ids.every(visit);
    visiting.delete(id);
    resolved.set(id, ok);
    return ok;
  };
  return writerLedgerUnits(writer).some((unit) =>
    unit.ontology_rule_ids.some((id) => !visit(id)));
}

const PROHIBITED_CLAIM_TRIGGER =
  /\b(?:diagnos(?:is|ed?)|predict(?:ion|ed|s)?|fate(?:d)?|biograph(?:y|ical)|guarantees?|inevitab(?:le|ly))\b/i;

/**
 * Negators that qualify a trigger word into a permitted statement.
 *
 * This was `not|never|cannot|can't|does not|isn't|rather than|without`, which
 * recognised `does not` and `isn't` but not `doesn't`, `no`, `nothing`, `none`,
 * `neither`, `won't` or `avoid`. Eight of twelve ordinary hedged sentences --
 * "Nothing here is fated", "This doesn't predict your future", "There are no
 * guarantees here" -- were therefore gated as prohibited claims, and a corpus
 * that teaches "describe patterns, do not predict" pushes the writer into
 * exactly that register. The gate was punishing the writer for complying.
 *
 * Widened deliberately, with the scope that makes it safe: this function is
 * reachable only from the ontology regression harness and never runs on a
 * reader-serving path. Neither regex carries `g`, so `.test` is stateless.
 */
const PROHIBITED_CLAIM_QUALIFIER =
  /\b(?:not|never|no|none|nothing|neither|nor|cannot|can't|does not|doesn't|don't|won't|aren't|isn't|avoid|rather than|without)\b/i;

function hasUnqualifiedProhibitedClaim(text: string): boolean {
  return text.split(/(?<=[.!?])\s+/).some((sentence) =>
    PROHIBITED_CLAIM_TRIGGER.test(sentence) &&
    !PROHIBITED_CLAIM_QUALIFIER.test(sentence));
}

/** The first unit carrying an unqualified prohibited claim, with its key. */
function findUnqualifiedProhibitedClaim(
  writer: PatternWriterOutput,
): KeyedWriterUnit | null {
  return allWriterUnits(writer)
    .find((unit) => hasUnqualifiedProhibitedClaim(unit.text)) ?? null;
}

function isOntologyRegressionMandatoryFeature(feature: NatalFeature): boolean {
  return feature.feature_class === "uncertainty" ||
    (feature.feature_class === "position" &&
      (feature.body === "sun" || feature.body === "moon")) ||
    (feature.feature_class === "aspect" && feature.orb <= 6 &&
      [feature.body_a, feature.body_b].some((body) =>
        body === "sun" || body === "moon"));
}

function mandatoryAccountingFails(
  fixture: OntologyRegressionFixture,
  manifest: PatternSelectionManifest,
): boolean {
  const byFeature = new Map(manifest.accounting.map((entry) => [entry.feature_id, entry]));
  return fixture.features.some((feature) => {
    if (!isOntologyRegressionMandatoryFeature(feature)) return false;
    const accounting = byFeature.get(feature.feature_id);
    return !accounting ||
      (feature.feature_class === "uncertainty"
        ? accounting.coverage !== "mandatory_any"
        : accounting.coverage !== "mandatory_core");
  });
}

const privateProjectionKeys = new Set([
  "feature_aliases",
  "ontology_rule_ids",
  "derived_synthesis_ids",
  "claim_class",
  "plan_hash",
  "candidate_hash",
  "semantic_verdict_hash",
]);

function publicProjectionLeaks(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(publicProjectionLeaks);
  if (typeof value === "string") return /\b(?:nft|ont|pgen)_[a-z0-9]+\b/i.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    privateProjectionKeys.has(key) || publicProjectionLeaks(child));
}

export function evaluateOntologyRegressionHardGates(input: {
  fixture: OntologyRegressionFixture;
  selectionManifest: PatternSelectionManifest;
  packet: PatternFactPacket;
  plan: PatternPlan;
  writer: PatternWriterOutput;
  verdict: PatternSemanticVerdict;
  publicProjection: PatternResponseV7;
  ontology: readonly PatternOntologyRecord[];
  sourceFragmentIds: ReadonlySet<string>;
}): OntologyRegressionHardGateFailure[] {
  const failures = new Set<OntologyRegressionHardGateFailure>();
  const units = writerLedgerUnits(input.writer);
  if (hasSuppressedLeak(input.packet, input.writer)) {
    failures.add("suppressed_feature_leak");
  }
  if (units.some((unit) =>
    unit.feature_aliases.length === 0 || unit.ontology_rule_ids.length === 0)) {
    failures.add("uncited_astrological_claim");
  }
  if (sourceDependenciesFail(
    input.writer,
    input.ontology,
    input.sourceFragmentIds,
  )) {
    failures.add("source_dependency_failure");
  }
  if (findUnqualifiedProhibitedClaim(input.writer)) {
    failures.add("prohibited_claim");
  }
  if (mandatoryAccountingFails(input.fixture, input.selectionManifest)) {
    failures.add("mandatory_feature_omission");
  }
  if (publicProjectionLeaks(input.publicProjection)) {
    failures.add("private_projection_leak");
  }
  if (input.verdict.verdict !== "pass") failures.add("semantic_refusal");
  void input.plan;
  return [...failures].sort();
}

/**
 * Where a writer-correctable hard gate fired, as a correction locator.
 *
 * `buildCorrectionDocument` reads a deterministic failure's `message` as a key
 * and discards anything that is not `CORRECTION_KEY_SHAPE`, so the previous
 * `message: ""` produced `target_key: null` -- a correction naming a code and
 * nothing else. Three rewrites against that carry no more information than one,
 * which is how candidate 0.1.16 burned its whole writer budget on one fixture
 * without converging.
 *
 * Returns "" when the offending unit has no addressable key (the document title
 * or the uncertainty note), which reproduces the old null and keeps the gate
 * itself unchanged.
 */
function writerCorrectableHardGateTargetKey(
  gate: OntologyRegressionHardGateFailure,
  packet: PatternFactPacket,
  writer: PatternWriterOutput,
): string {
  const unit = gate === "prohibited_claim"
    ? findUnqualifiedProhibitedClaim(writer)
    : findSuppressedWriterLeak(packet, writer);
  return unit?.key ?? "";
}

export interface OntologyRegressionFixtureState {
  schema_version: "ontology-regression-state/v1";
  fixture_index: number;
  fixture_id: string;
  accuracy: BirthTimeAccuracy;
  phase: PatternStageClass | "complete";
  planner_calls: number;
  writer_calls: number;
  verifier_calls_for_candidate: number;
  provider_calls: number;
  input_tokens: number;
  output_tokens: number;
  plan: PatternPlan | null;
  candidate: PatternWriterOutput | null;
  correction: PatternCorrectionDocument | null;
  complete: boolean;
  result: Omit<OntologyRegressionFixtureResult, "result_hash"> & {
    plan_hash: string | null;
    candidate_hash: string | null;
    verdict_hash: string | null;
    public_projection_hash: string | null;
  } | null;
}

export interface PreparedOntologyRegressionPass {
  pass: PatternStageClass;
  document: unknown;
  serialized: string;
  selection: PatternSelectionResult;
}

export function createOntologyRegressionFixtureState(
  fixtureIndex: number,
  fixture: OntologyRegressionFixture,
): OntologyRegressionFixtureState {
  if (
    !Number.isSafeInteger(fixtureIndex) ||
    fixtureIndex < 0 ||
    fixtureIndex >= ONTOLOGY_REGRESSION_FIXTURE_COUNT
  ) {
    throw new OntologyRegressionError("regression_failed");
  }
  return {
    schema_version: "ontology-regression-state/v1",
    fixture_index: fixtureIndex,
    fixture_id: fixture.fixture_id,
    accuracy: fixture.effective_accuracy,
    phase: "planner",
    planner_calls: 0,
    writer_calls: 0,
    verifier_calls_for_candidate: 0,
    provider_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    plan: null,
    candidate: null,
    correction: null,
    complete: false,
    result: null,
  };
}

function selectForRegression(
  fixture: OntologyRegressionFixture,
  ontology: readonly PatternOntologyRecord[],
): PatternSelectionResult {
  try {
    return selectPatternEvidence({
      locale: fixture.locale,
      effectiveAccuracy: fixture.effective_accuracy,
      featureSetHash: fixture.feature_set_hash,
      features: fixture.features,
      ontology,
    });
  } catch {
    throw new OntologyRegressionError("regression_failed");
  }
}

export function prepareOntologyRegressionPass(input: {
  state: OntologyRegressionFixtureState;
  fixture: OntologyRegressionFixture;
  ontology: readonly PatternOntologyRecord[];
  inputMaxBytes: number;
}): PreparedOntologyRegressionPass {
  const { state, fixture, ontology } = input;
  if (
    state.complete ||
    state.phase === "complete" ||
    state.fixture_id !== fixture.fixture_id ||
    state.accuracy !== fixture.effective_accuracy
  ) {
    throw new OntologyRegressionError("regression_failed");
  }
  const selection = selectForRegression(fixture, ontology);
  const limits = {
    maxBytes: input.inputMaxBytes,
    bounds: PATTERN_PACKET_LIMITS_DEFAULT.bounds,
  };
  const built = state.phase === "planner"
    ? buildPlannerInput(selection.packet, ontology, limits)
    : state.phase === "writer" && state.plan
      ? buildWriterInput(
          state.plan,
          selection.packet,
          ontology,
          limits,
          state.correction ?? undefined,
        )
      : state.phase === "verifier" && state.plan && state.candidate
        ? buildVerifierInput(
            state.candidate,
            state.plan,
            selection.packet,
            ontology,
            limits,
          )
        : null;
  if (!built?.ok) throw new OntologyRegressionError("regression_failed");
  return {
    pass: state.phase,
    document: built.document,
    serialized: built.serialized,
    selection,
  };
}

function phaseMaximum(phase: PatternStageClass): number {
  return phase === "planner" ? 2 : phase === "writer" ? 3 : 2;
}

function currentPhaseCalls(state: OntologyRegressionFixtureState): number {
  return state.phase === "planner"
    ? state.planner_calls
    : state.phase === "writer"
      ? state.writer_calls
      : state.verifier_calls_for_candidate;
}

export function ontologyRegressionPassCanAttempt(
  state: OntologyRegressionFixtureState,
  deliveryAttempt: number,
): boolean {
  return !state.complete &&
    state.phase !== "complete" &&
    Number.isSafeInteger(deliveryAttempt) &&
    deliveryAttempt >= 0 &&
    currentPhaseCalls(state) + deliveryAttempt + 1 <= phaseMaximum(state.phase);
}

async function finishRegressionFixture(
  state: OntologyRegressionFixtureState,
  fixture: OntologyRegressionFixture,
  accepted: boolean,
  hardGateFailures: OntologyRegressionHardGateFailure[],
  hashes: {
    planHash?: string | null;
    candidateHash?: string | null;
    verdictHash?: string | null;
    publicProjectionHash?: string | null;
  } = {},
): Promise<OntologyRegressionFixtureState> {
  return {
    ...state,
    phase: "complete",
    complete: true,
    candidate: null,
    correction: null,
    result: {
      fixture_id: fixture.fixture_id,
      accuracy: fixture.effective_accuracy,
      accepted,
      declared_outcome: fixture.declared_outcome,
      provider_calls: state.provider_calls,
      input_tokens: state.input_tokens,
      output_tokens: state.output_tokens,
      hard_gate_failures: hardGateFailures,
      plan_hash: hashes.planHash ?? state.plan?.plan_hash ?? null,
      candidate_hash: hashes.candidateHash ?? null,
      verdict_hash: hashes.verdictHash ?? null,
      public_projection_hash: hashes.publicProjectionHash ?? null,
    },
  };
}

function withUsage(
  state: OntologyRegressionFixtureState,
  metadata: PatternPassProvenance,
  deliveryAttempt: number,
): OntologyRegressionFixtureState {
  if (
    !Number.isSafeInteger(deliveryAttempt) ||
    deliveryAttempt < 0 ||
    metadata.pass !== state.phase
  ) {
    throw new OntologyRegressionError("regression_failed");
  }
  const attemptedCalls = deliveryAttempt + 1;
  const phaseCalls = currentPhaseCalls(state) + attemptedCalls;
  if (phaseCalls > phaseMaximum(state.phase as PatternStageClass)) {
    throw new OntologyRegressionError("regression_budget_exceeded");
  }
  return {
    ...state,
    planner_calls: state.phase === "planner" ? phaseCalls : state.planner_calls,
    writer_calls: state.phase === "writer" ? phaseCalls : state.writer_calls,
    verifier_calls_for_candidate: state.phase === "verifier"
      ? phaseCalls
      : state.verifier_calls_for_candidate,
    provider_calls: state.provider_calls + attemptedCalls,
    input_tokens: state.input_tokens + (metadata.input_tokens ?? 0),
    output_tokens: state.output_tokens + (metadata.output_tokens ?? 0),
  };
}

export async function applyOntologyRegressionPass(input: {
  state: OntologyRegressionFixtureState;
  fixture: OntologyRegressionFixture;
  ontology: readonly PatternOntologyRecord[];
  sourceFragmentIds: ReadonlySet<string>;
  pass: PatternStageClass;
  value: unknown;
  deliveryAttempt: number;
  metadata: PatternPassProvenance;
  ontologyVersion: string;
}): Promise<OntologyRegressionFixtureState> {
  if (
    input.state.complete ||
    input.state.phase !== input.pass ||
    input.metadata.pass !== input.pass
  ) {
    throw new OntologyRegressionError("regression_failed");
  }
  let state = withUsage(
    input.state,
    input.metadata,
    input.deliveryAttempt,
  );
  const selection = selectForRegression(input.fixture, input.ontology);

  if (input.pass === "planner") {
    let planner;
    let valid = false;
    try {
      planner = narrowPlannerOutput(input.value as never);
      valid = validatePatternPlan(
        planner,
        selection.packet,
        input.ontology,
      ).ok;
    } catch {
      valid = false;
    }
    if (!valid || !planner) {
      return state.planner_calls < 2
        ? state
        : finishRegressionFixture(state, input.fixture, false, []);
    }
    const planHash = await contentHash(JSON.stringify(planner));
    return {
      ...state,
      phase: "writer",
      plan: {
        ...planner,
        plan_hash: planHash,
        sparse_pattern: selection.packet.selection_constraints.sparse_pattern,
      },
      correction: null,
    };
  }

  if (input.pass === "writer") {
    if (!state.plan) throw new OntologyRegressionError("regression_failed");
    let writerCheck;
    try {
      writerCheck = validatePatternCandidate(
        input.value as PatternWriterOutput,
        state.plan,
        selection.packet,
        input.ontology,
      );
    } catch {
      writerCheck = { ok: false, failures: [{ code: "candidate_shape", message: "candidate" }] };
    }
    if (!writerCheck.ok) {
      if (state.writer_calls >= 3) {
        return finishRegressionFixture(state, input.fixture, false, []);
      }
      return {
        ...state,
        phase: "writer",
        candidate: null,
        correction: buildCorrectionDocument(
          state.plan,
          { deterministic: writerCheck.failures },
          state.writer_calls,
        ),
      };
    }
    return {
      ...state,
      phase: "verifier",
      candidate: input.value as PatternWriterOutput,
      correction: null,
      verifier_calls_for_candidate: 0,
    };
  }

  if (!state.plan || !state.candidate) {
    throw new OntologyRegressionError("regression_failed");
  }
  const verdict = input.value as PatternSemanticVerdict;
  if (findSemanticVerdictProblem(verdict)) {
    return state.verifier_calls_for_candidate < 2
      ? state
      : finishRegressionFixture(state, input.fixture, false, []);
  }
  const candidateHash = await contentHash(JSON.stringify(state.candidate));
  const verdictHash = await contentHash(JSON.stringify(verdict));
  if (verdict.verdict !== "pass") {
    if (state.writer_calls >= 3) {
      return finishRegressionFixture(state, input.fixture, false, [], {
        candidateHash,
        verdictHash,
      });
    }
    return {
      ...state,
      phase: "writer",
      candidate: null,
      correction: buildCorrectionDocument(
        state.plan,
        { semantic: verdict.findings },
        state.writer_calls,
      ),
      verifier_calls_for_candidate: 0,
    };
  }

  const patternId = input.fixture.chain.public_projection.pattern_id;
  const internal = {
    schema_version: "0.7.0" as const,
    pattern_id: patternId,
    generation_id: patternId.replace(/^pat_/, "pgen_"),
    locale: input.fixture.locale,
    effective_accuracy: input.fixture.effective_accuracy,
    plan_hash: state.plan.plan_hash,
    candidate_hash: candidateHash,
    semantic_verdict_hash: verdictHash,
    artifact: state.candidate,
    compact_provenance: {
      assembly_mode: "constrained_model" as const,
      provider: patternProviderDisplayName(input.metadata.provider),
      model_family: input.metadata.model,
      raw_birth_details_sent: false as const,
      ontology_version: input.ontologyVersion,
      selection_policy_version: "1.0.0",
    },
  };
  const projection = projectPublicPattern(
    internal,
    input.fixture.chain.public_projection.generated_at,
  );
  const hardGateFailures = evaluateOntologyRegressionHardGates({
    fixture: input.fixture,
    selectionManifest: selection.manifest,
    packet: selection.packet,
    plan: state.plan,
    writer: state.candidate,
    verdict,
    publicProjection: projection,
    ontology: input.ontology,
    sourceFragmentIds: input.sourceFragmentIds,
  });
  const writerCorrectableHardGate = hardGateFailures.length === 1 &&
    (hardGateFailures[0] === "prohibited_claim" ||
      (hardGateFailures[0] === "suppressed_feature_leak" &&
        !hasSuppressedPacketFeatureLeak(selection.packet) &&
        hasSuppressedWriterLeak(selection.packet, state.candidate)))
    ? hardGateFailures[0]
    : null;
  if (writerCorrectableHardGate && state.writer_calls < 3) {
    return {
      ...state,
      phase: "writer",
      candidate: null,
      correction: buildCorrectionDocument(
        state.plan,
        {
          deterministic: [{
            code: writerCorrectableHardGate,
            // Read as a locator, not as prose: `buildCorrectionDocument` keeps
            // it only if it is a chapter/section/signature key.
            message: writerCorrectableHardGateTargetKey(
              writerCorrectableHardGate,
              selection.packet,
              state.candidate,
            ),
          }],
        },
        state.writer_calls,
      ),
      verifier_calls_for_candidate: 0,
    };
  }
  return finishRegressionFixture(
    state,
    input.fixture,
    hardGateFailures.length === 0,
    hardGateFailures,
    {
      candidateHash,
      verdictHash,
      publicProjectionHash: await contentHash(JSON.stringify(projection)),
    },
  );
}
