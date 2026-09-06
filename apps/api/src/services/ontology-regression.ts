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
import {
  evaluatePatternPublicationSafety,
  findSuppressedWriterLeak,
  findUnqualifiedProhibitedClaim,
  hasSuppressedPacketFeatureLeak,
  hasSuppressedWriterLeak,
} from "./pattern-publication-safety.js";
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
  ontologyRegressionPatternPin,
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
  return evaluatePatternPublicationSafety({
    ...input,
    features: input.fixture.features,
  }).failures.map((failure) => failure.code);
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
