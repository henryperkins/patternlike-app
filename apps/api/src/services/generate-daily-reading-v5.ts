import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  ConstrainedInputError,
  SELECTION_POLICY_VERSION,
  VALIDATION_POLICY_VERSION,
  prepareConstrainedReadingInput,
  validateReadingCandidate,
  type CandidateFailure,
  type ConstrainedContextSignalInput,
  type ConstrainedContextSourceInput,
} from "@patternlike/reading-engine";
import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  DAILY_SKY_POLICY_ID,
  DAILY_SKY_POLICY_VERSION,
  LOCAL_DAY_RESOLUTION_POLICY_VERSION,
  M5_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  canonicalJson,
  contentHash,
  newId,
  type ChartSnapshot,
  type DailyReadingV5,
  type DailySkyFact,
  type ParagraphEvidenceV5,
} from "@patternlike/shared";
import outputSchema from "../../../../contracts/m5/reading-generation-output.schema.json";
import type { Env } from "../env.js";
import { asCryptoSubject } from "../crypto.js";
import { loadContextSourceGrants } from "../db/consents.js";
import { deriveCycles } from "../db/cycles.js";
import {
  completeReading,
  type Claim,
  type EvidenceRow,
} from "../db/generation.js";
import { encryptPayload, type UserIdentity } from "../db/users.js";
import { buildCycleRequest, invokeCycles } from "./cycle-client.js";
import {
  buildDailySkyRequest,
  dailySkyFailureCode,
  invokeDailySky,
} from "./daily-sky-client.js";
import type { ExecutionOutcome } from "./generate-daily-reading.js";
import {
  renderGenerationInputId,
  projectNatalFacts,
  type ContextPinV2,
  type GenerateDailyReadingCommandV2,
} from "./generation-command-v2.js";
import { leaseDisposition, type V5FailureCode } from "./generation-failures.js";
import { currentAiConsentMatches } from "./reading-current-owner.js";
import { createCodexReadingPublisher } from "./codex-reading-publisher.js";
import { CODEX_PROVIDER_TIMEOUT_MS } from "./codex-provider-contract.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  OPENAI_READING_REASONING,
  READING_CONTEXT_MAX_BYTES,
  READING_PUBLISHER_PROVIDER,
} from "./reading-publisher.js";
import { READING_PROMPT_VERSION } from "./reading-prompt.js";
import { safeLog } from "./safe-log.js";
import type { StoredReadingV5 } from "./stored-reading.js";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateOutputSchema = ajv.compile(outputSchema);

/**
 * The reader-facing statement of what wrote this reading.
 *
 * Names Codex as the generation service and OpenAI as the operator, because
 * both are true and the consent screen separates them the same way. Readings
 * published before the move keep their own sentence: a stored artifact is never
 * restated.
 */
const DISCLOSURE =
  "Generated with Codex by OpenAI from your calculated chart and enabled context.";

/**
 * Lease headroom this executor still needs after the packet is built.
 *
 * Sealing one envelope, committing one row, and either releasing or publishing.
 * Deliberately small: the provider deadline moved outside the lease, and
 * `leaseDisposition` adds its own sixty-second publication margin on top.
 */
const READING_PROVIDER_ENQUEUE_BUDGET_MS = 30_000;

interface ChartRow {
  id: string;
  profile_version: number;
  fingerprint: string;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  snapshot_json: string;
  uncertainty_json: string;
}

interface SignalEligibilityRow {
  source_id: string;
  evidence_lane: string;
  allowed_uses_json: string;
  permission_state: string;
  conflict_status: string;
  freshness_status: string;
  normalized_hash: string;
  consent_id: string | null;
  observed_at: string;
  expires_at: string | null;
  is_current: number;
}

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}

function parseStringArray(raw: string): string[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseChart(row: ChartRow): ChartSnapshot | null {
  try {
    const snapshot = JSON.parse(row.snapshot_json) as ChartSnapshot;
    const uncertainty = JSON.parse(row.uncertainty_json) as ChartSnapshot["uncertainty"];
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !Array.isArray(snapshot.positions) ||
      !uncertainty ||
      typeof uncertainty !== "object" ||
      !Array.isArray(uncertainty.suppressed_features) ||
      !Array.isArray(uncertainty.qualified_features)
    ) {
      return null;
    }
    return {
      ...snapshot,
      contract_id: row.contract_id,
      contract_version: row.contract_version,
      container_digest: row.container_digest,
      fingerprint: row.fingerprint,
      aspects: Array.isArray(snapshot.aspects) ? snapshot.aspects : [],
      uncertainty,
    };
  } catch {
    return null;
  }
}

function supportedCommand(command: GenerateDailyReadingCommandV2): boolean {
  return (
    command.schema_version === M5_SCHEMA_VERSION &&
    command.output_schema === "daily-reading-v5" &&
    command.assembly_mode === "constrained_model" &&
    command.chart.contract_id === CALC_CONTRACT_ID &&
    command.chart.contract_version === CALC_CONTRACT_VERSION &&
    command.cycle_scan.policy_id === CYCLE_POLICY_ID &&
    command.cycle_scan.policy_version === CYCLE_POLICY_VERSION &&
    command.cycle_scan.orb_policy_id === TRANSIT_ORB_POLICY_ID &&
    command.cycle_scan.orb_policy_version === TRANSIT_ORB_POLICY_VERSION &&
    command.daily_sky.policy_id === DAILY_SKY_POLICY_ID &&
    command.daily_sky.policy_version === DAILY_SKY_POLICY_VERSION &&
    command.daily_sky.orb_policy_id === null &&
    command.daily_sky.orb_policy_version === null &&
    command.local_day_resolution_policy_version ===
      LOCAL_DAY_RESOLUTION_POLICY_VERSION &&
    command.publisher.provider === READING_PUBLISHER_PROVIDER &&
    command.publisher.model === OPENAI_READING_MODEL &&
    command.publisher.reasoning_effort === OPENAI_READING_REASONING &&
    command.publisher.prompt_version === READING_PROMPT_VERSION &&
    command.publisher.output_schema === "daily-reading-v5" &&
    command.publisher.selection_policy_version === SELECTION_POLICY_VERSION &&
    command.publisher.validation_policy_version === VALIDATION_POLICY_VERSION &&
    command.publisher.max_output_tokens === OPENAI_READING_MAX_OUTPUT_TOKENS &&
    command.publisher.context_max_bytes === READING_CONTEXT_MAX_BYTES
  );
}

async function pinnedFeedbackEligible(
  env: Env,
  userId: string,
  pin: ContextPinV2,
): Promise<boolean> {
  // reading_feedback is not a context_signals row. The compiler uses the row
  // id as normalized_hash because the structured value never changes after
  // insert. Execute must look in the same table or every USR-12 pin would fail
  // closed and block the reading.
  const row = await env.DB.prepare(
    `SELECT id, resonance, relevance_labels_json, created_at
     FROM reading_feedback WHERE id = ? AND user_id = ?`,
  )
    .bind(pin.signal_id, userId)
    .first<{
      id: string;
      resonance: string | null;
      relevance_labels_json: string;
      created_at: string;
    }>();
  if (
    !row ||
    row.id !== pin.normalized_hash ||
    row.created_at !== pin.observed_at ||
    pin.expires_at !== null ||
    pin.freshness_status !== "fresh" ||
    pin.snapshot.kind !== "structured"
  ) {
    return false;
  }
  const labels = parseStringArray(row.relevance_labels_json);
  const snapshot = pin.snapshot.value;
  return (
    snapshot.resonance === row.resonance &&
    JSON.stringify(snapshot.relevance_labels ?? []) === JSON.stringify(labels)
  );
}

async function pinnedContextEligible(
  env: Env,
  userId: string,
  pins: readonly ContextPinV2[],
  now = new Date(),
): Promise<boolean> {
  if (pins.length === 0) return true;
  const grants = new Map(
    (await loadContextSourceGrants(env, userId)).map((grant) => [grant.source_id, grant]),
  );
  for (const pin of pins) {
    const grant = grants.get(pin.source_id);
    if (
      !grant ||
      grant.permission_state !== "active" ||
      grant.permission_consent_id !== pin.consent_id ||
      grant.consent_id !== pin.consent_id ||
      grant.consent_source_id !== pin.source_id ||
      grant.consent_status !== "granted" ||
      grant.consent_version !== pin.consent_version ||
      !grant.permission_allowed_uses.includes(pin.allowed_use) ||
      !grant.consent_allowed_uses.includes(pin.allowed_use)
    ) {
      return false;
    }

    if (pin.source_id === "USR-12" || pin.category === "reading_feedback") {
      if (!(await pinnedFeedbackEligible(env, userId, pin))) return false;
      continue;
    }

    const row = await env.DB.prepare(
      `SELECT source_id, evidence_lane, allowed_uses_json, permission_state,
              conflict_status, freshness_status, normalized_hash, consent_id,
              observed_at, expires_at, is_current
       FROM context_signals WHERE id = ? AND user_id = ?`,
    )
      .bind(pin.signal_id, userId)
      .first<SignalEligibilityRow>();
    const uses = row ? parseStringArray(row.allowed_uses_json) : null;
    if (
      !row ||
      row.source_id !== pin.source_id ||
      row.evidence_lane !== pin.evidence_lane ||
      row.permission_state !== "active" ||
      row.conflict_status !== "none" ||
      row.freshness_status !== pin.freshness_status ||
      row.is_current !== 1 ||
      row.normalized_hash !== pin.normalized_hash ||
      row.consent_id !== pin.consent_id ||
      row.observed_at !== pin.observed_at ||
      row.expires_at !== pin.expires_at ||
      (row.expires_at !== null && Date.parse(row.expires_at) <= now.getTime()) ||
      !uses?.includes(pin.allowed_use)
    ) {
      return false;
    }
  }
  return true;
}

function frozenContext(
  pins: readonly ContextPinV2[],
): {
  sources: ConstrainedContextSourceInput[];
  signals: ConstrainedContextSignalInput[];
} {
  const sourceGroups = new Map<
    string,
    { pin: ContextPinV2; uses: Set<string> }
  >();
  const signalGroups = new Map<
    string,
    { pin: ContextPinV2; uses: Set<string> }
  >();
  for (const pin of pins) {
    const source = sourceGroups.get(pin.source_id) ?? { pin, uses: new Set<string>() };
    source.uses.add(pin.allowed_use);
    sourceGroups.set(pin.source_id, source);
    const signal = signalGroups.get(pin.signal_id) ?? { pin, uses: new Set<string>() };
    signal.uses.add(pin.allowed_use);
    signalGroups.set(pin.signal_id, signal);
  }
  return {
    sources: [...sourceGroups.values()].map(({ pin, uses }) => ({
      source_id: pin.source_id,
      permission_state: "active",
      permission_allowed_uses: [...uses],
      permission_consent_id: pin.consent_id,
      consent_id: pin.consent_id,
      consent_source_id: pin.source_id,
      consent_status: "granted",
      consent_version: pin.consent_version,
      consent_allowed_uses: [...uses],
    })),
    signals: [...signalGroups.values()].map(({ pin, uses }) => ({
      signal_id: pin.signal_id,
      source_id: pin.source_id,
      category: pin.category as ConstrainedContextSignalInput["category"],
      allowed_uses: [...uses],
      evidence_lane: pin.evidence_lane as ConstrainedContextSignalInput["evidence_lane"],
      normalized_hash: pin.normalized_hash,
      freshness_status: pin.freshness_status,
      observed_at: pin.observed_at,
      expires_at: pin.expires_at,
      content: pin.snapshot,
    })),
  };
}

async function loadFrozenChart(
  env: Env,
  userId: string,
  command: GenerateDailyReadingCommandV2,
): Promise<ChartSnapshot | null> {
  const row = await env.DB.prepare(
    `SELECT id, profile_version, fingerprint, contract_id, contract_version,
            container_digest, snapshot_json, uncertainty_json
     FROM chart_snapshots WHERE id = ? AND user_id = ?`,
  )
    .bind(command.chart.snapshot_id, userId)
    .first<ChartRow>();
  if (
    !row ||
    row.profile_version !== command.chart.profile_version ||
    row.fingerprint !== command.chart.fingerprint ||
    row.contract_id !== command.chart.contract_id ||
    row.contract_version !== command.chart.contract_version ||
    row.container_digest !== command.chart.container_digest
  ) {
    return null;
  }
  return parseChart(row);
}

function providerLimit(env: Env): number | null {
  const raw = env.READING_DAILY_PROVIDER_CALL_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Execute one frozen constrained-model command.
 *
 * All mutable eligibility is checked both before and after the expensive
 * calculation replay. The provider boundary is reached only after the same
 * compiler reproduces both frozen identities, the lease still has room, and
 * the UTC-day budget admits this one call.
 */
export async function generateDailyReadingV5(
  env: Env,
  claim: Claim & { command: GenerateDailyReadingCommandV2 },
): Promise<ExecutionOutcome> {
  const { command, userId } = claim;
  const fail = (reason: V5FailureCode, detail: string): ExecutionOutcome => ({
    ok: false,
    reason,
    detail,
  });

  // Before the packet, before any calculation replay, and before R2 is touched.
  // Narrowed to the one known previous transport rather than "anything that is
  // not current": an unrecognised provider is a policy problem for
  // `supportedCommand` below, and calling it superseded would invite the
  // scheduler to replace a command nobody can explain.
  // A command whose own pin names the direct OpenAI transport is honest and
  // simply cannot be executed here: running it through Codex would publish
  // prose that falsifies its own provenance, and the reader would be told a
  // different service wrote it than actually did. Terminalize with a safe class
  // so the scheduler's existing bounded replacement path can freeze a new
  // command under current configuration. The frozen command is never edited.
  if (
    command.publisher.provider !== READING_PUBLISHER_PROVIDER &&
    command.publisher.provider === "openai"
  ) {
    return fail("publisher_superseded", "publisher_not_configured");
  }
  if (!supportedCommand(command)) {
    return fail("policy_unsupported", "the frozen V2 policy tuple is not implemented");
  }
  if (!(await currentAiConsentMatches(env, userId, command))) {
    return fail("ai_synthesis_consent_required", "consent_not_active");
  }
  if (!(await pinnedContextEligible(env, userId, command.context))) {
    return fail("context_ineligible", "context_not_eligible");
  }

  const chart = await loadFrozenChart(env, userId, command);
  if (!chart) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }

  const suppressedFeatures = command.chart.uncertainty.suppressed_features.map(
    (feature) => feature.feature_class,
  );
  const suppressed = new Set(suppressedFeatures);
  const cycleRequest = buildCycleRequest({
    requestId: command.cycle_scan.request_id,
    chartFingerprint: command.chart.fingerprint,
    natalAccuracy: command.chart.effective_accuracy,
    suppressedFeatures,
    natalPositions: chart.positions
      .filter((position) => {
        if (position.body === "ascendant" || position.body === "midheaven") {
          return !(suppressed.has("angles") || suppressed.has("angle_transits"));
        }
        return true;
      })
      .map((position) => ({
        body: position.body,
        longitude_deg: position.longitude_deg,
      })),
    window: { from: command.day_start_at, to: command.day_end_at },
    contractId: command.chart.contract_id,
    contractVersion: command.chart.contract_version,
  });
  if ((await contentHash(canonicalJson(cycleRequest))) !== command.cycle_scan.request_digest) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }
  const cycleResult = await invokeCycles(env, cycleRequest);
  if (!cycleResult.ok) {
    return cycleResult.kind === "unavailable"
      ? fail("calc_unavailable", "calculation_transport_unavailable")
      : fail("policy_unsupported", "calculation_policy_refused");
  }
  if (
    (await contentHash(canonicalJson(cycleResult.response))) !==
      command.cycle_scan.response_digest ||
    cycleResult.response.container_digest !== command.cycle_scan.container_digest ||
    cycleResult.response.ephemeris_data_version !==
      command.cycle_scan.ephemeris_data_version
  ) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }
  const derived = await deriveCycles(cycleResult.response.cycles);
  const cycleById = new Map(cycleResult.response.cycles.map((cycle) => [cycle.id, cycle]));
  const derivedById = new Map(derived.map((cycle) => [cycle.cycleId, cycle]));
  const selectedCycles = [];
  for (const pin of command.cycle_scan.selected) {
    const cycle = cycleById.get(pin.cycle_id);
    const identity = derivedById.get(pin.cycle_id);
    if (
      !cycle ||
      !identity ||
      identity.hash !== pin.cycle_hash ||
      identity.passIds.length !== pin.pass_ids.length ||
      identity.passIds.some((id, index) => id !== pin.pass_ids[index])
    ) {
      return fail("generation_input_id_mismatch", "input_integrity_mismatch");
    }
    selectedCycles.push(cycle);
  }

  let dailySkyRequest;
  try {
    dailySkyRequest = buildDailySkyRequest({
      requestId: command.daily_sky.request_id,
      window: {
        targetLocalDate: command.target_local_date,
        dayStartAt: command.day_start_at,
        dayEndAt: command.day_end_at,
        anchorAt: command.anchor_at,
        anchorResolution: command.anchor_resolution,
        tzdbVersion: command.tzdb_version,
        localDayResolutionPolicyVersion:
          command.local_day_resolution_policy_version,
      },
      chart,
      ephemerisDataVersion: command.cycle_scan.ephemeris_data_version,
      calculationPolicyId: command.cycle_scan.policy_id,
      calculationPolicyVersion: command.cycle_scan.policy_version,
    });
  } catch {
    return fail("policy_unsupported", "calculation_policy_refused");
  }
  if (
    (await contentHash(canonicalJson(dailySkyRequest))) !==
    command.daily_sky.request_digest
  ) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }
  const skyResult = await invokeDailySky(env, dailySkyRequest);
  if (!skyResult.ok) {
    if (skyResult.kind === "unavailable") {
      return fail("daily_sky_unavailable", "calculation_transport_unavailable");
    }
    return dailySkyFailureCode(skyResult.failure) === "daily_sky_unavailable"
      ? fail("daily_sky_unavailable", "calculation_transport_unavailable")
      : fail("policy_unsupported", "calculation_policy_refused");
  }
  if (
    (await contentHash(canonicalJson(skyResult.response))) !==
      command.daily_sky.response_digest ||
    skyResult.response.container_digest !== command.daily_sky.container_digest ||
    skyResult.response.ephemeris_data_version !== command.daily_sky.ephemeris_data_version
  ) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }
  const skyById = new Map(skyResult.response.facts.map((fact) => [fact.fact_id, fact]));
  const selectedSky: DailySkyFact[] = [];
  for (const pin of command.daily_sky.selected) {
    const fact = skyById.get(pin.fact_id);
    if (!fact || fact.content_digest !== pin.content_digest) {
      return fail("generation_input_id_mismatch", "input_integrity_mismatch");
    }
    selectedSky.push(fact);
  }

  const context = frozenContext(command.context);
  let prepared;
  try {
    prepared = prepareConstrainedReadingInput({
      schema_version: M5_SCHEMA_VERSION,
      prompt_version: command.publisher.prompt_version,
      output_schema: command.output_schema,
      selection_policy_version: command.publisher.selection_policy_version,
      validation_policy_version: command.publisher.validation_policy_version,
      context_max_bytes: command.publisher.context_max_bytes,
      target_local_date: command.target_local_date,
      target_timezone: command.target_timezone,
      locale: command.locale,
      generation_anchor: command.generation_anchor,
      revision: command.revision,
      domain_preference: command.domain_preference,
      consent_categories:
        command.ai_consent.categories as Parameters<
          typeof prepareConstrainedReadingInput
        >[0]["consent_categories"],
      day: {
        day_start_at: command.day_start_at,
        day_end_at: command.day_end_at,
        anchor_at: command.anchor_at,
        anchor_resolution: command.anchor_resolution,
        tzdb_version: command.tzdb_version,
        local_day_resolution_policy_version:
          command.local_day_resolution_policy_version,
      },
      chart: {
        fingerprint: command.chart.fingerprint,
        contract_id: command.chart.contract_id,
        contract_version: command.chart.contract_version,
        container_digest: command.chart.container_digest,
        effective_accuracy: command.chart.effective_accuracy,
        uncertainty: command.chart.uncertainty,
      },
      cycle_scan: command.cycle_scan,
      cycles: selectedCycles,
      daily_sky: command.daily_sky,
      daily_sky_facts: selectedSky,
      natal_facts: await projectNatalFacts(chart),
      context_sources: context.sources,
      context_signals: context.signals,
      prior_readings: command.prior_readings,
    });
  } catch (error) {
    return fail(
      error instanceof ConstrainedInputError
        ? "generation_input_id_mismatch"
        : "policy_unsupported",
      "input_integrity_mismatch",
    );
  }

  if (
    (await renderGenerationInputId(prepared.identity_canonical)) !==
      command.generation_input_id ||
    (await contentHash(prepared.input_manifest_canonical)) !==
      command.input_manifest_hash
  ) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }

  // The second read is intentional TOCTOU defense. Calculation calls are the
  // longest pre-provider interval and a revocation during them must win.
  if (!(await currentAiConsentMatches(env, userId, command))) {
    return fail("ai_synthesis_consent_required", "consent_not_active");
  }
  if (!(await pinnedContextEligible(env, userId, command.context))) {
    return fail("context_ineligible", "context_not_eligible");
  }

  // What still has to happen inside this lease is bounded and local: seal one
  // request envelope, commit one provider row, and either hand the lease back
  // or validate and publish an adopted candidate. The fifteen-minute provider
  // deadline is NOT part of it any more — the external call outlives this
  // delivery by design — so demanding room for it here would refuse work the
  // lease can comfortably finish.
  const remainingMs = Date.parse(claim.leaseExpiresAt) - Date.now();
  const lease = leaseDisposition(
    claim.attempts,
    remainingMs,
    READING_PROVIDER_ENQUEUE_BUDGET_MS,
  );
  if (lease === "lease_retry_305s") {
    return {
      ok: false,
      reason: "insufficient_lease",
      detail: "execution_window_exhausted",
    };
  }
  if (lease === "terminal_calc_unavailable") {
    return fail("calc_unavailable", "execution_window_exhausted");
  }

  const limit = providerLimit(env);
  if (limit === null) {
    return fail("publisher_not_configured", "publisher_not_configured");
  }
  // No budget is consumed here, and that is deliberate. The UTC-day ceiling
  // bounds actual model invocations, and the invocation happens when the RUNNER
  // claims this job — long after this delivery has ended. Charging on
  // create-or-adopt would bill a duplicate Queue delivery, a reclaimed lease,
  // and a job nobody ever ran.
  const providerStartedAt = Date.now();
  const publisher = await createCodexReadingPublisher(env).publish(prepared.request, {
    requestId: newId("req"),
    timeoutMs: CODEX_PROVIDER_TIMEOUT_MS,
    configuration: command.publisher,
    codexJob: {
      pipeline: "reading",
      ownerId: claim.jobId,
      userId,
      stageGeneration: command.command_generation,
      // Zero-based, and derived from the ACTUAL attempt rather than from a
      // counter of deliveries: a `publisher_pending` reacquisition returns to
      // the same coordinate and adopts, while a genuine retry lands on the
      // next one.
      stageAttempt: claim.attempts - 1,
      dailyCallLimit: limit,
    },
  });
  if (!publisher.ok && publisher.code === "publisher_pending") {
    // Not a failure. The Queue handler hands the Daily lease back and stops
    // holding a delivery open for a call that may take fifteen minutes.
    return {
      ok: false,
      reason: "publisher_pending",
      detail: "codex_provider_pending",
      providerJobId: publisher.job_id,
    };
  }
  if (!publisher.ok) {
    safeLog({
      event: "publisher_attempt_failed",
      provider: READING_PUBLISHER_PROVIDER,
      model: command.publisher.model,
      prompt_version: command.publisher.prompt_version,
      latency_ms: Math.max(0, Date.now() - providerStartedAt),
      failure_class: publisher.code,
      safe_detail_code: publisher.safe_detail_code,
    });
    return fail(publisher.code, publisher.safe_detail_code);
  }
  safeLog({
    event: "publisher_call_completed",
    provider: publisher.metadata.provider,
    model: publisher.metadata.model,
    prompt_version: command.publisher.prompt_version,
    latency_ms: Math.max(0, Date.now() - providerStartedAt),
    input_tokens: publisher.metadata.input_tokens,
    output_tokens: publisher.metadata.output_tokens,
    provider_response_hash: publisher.metadata.provider_response_hash,
  });
  // The queue persists only the broad failure class, and terminal Daily
  // exchanges are purged. Preserve the validator's content-free codes here,
  // correlated to the completed call by its existing response hash.
  const logRejection = (failures: readonly CandidateFailure[]): void => {
    safeLog({
      event: "reading_candidate_rejected",
      provider: publisher.metadata.provider,
      model: publisher.metadata.model,
      prompt_version: command.publisher.prompt_version,
      validation_policy_version: command.publisher.validation_policy_version,
      provider_response_hash: publisher.metadata.provider_response_hash,
      failures,
    });
  };
  if (!validateOutputSchema(publisher.candidate)) {
    logRejection([{ code: "schema_shape", detail_code: "schema_mismatch" }]);
    return fail("publisher_output_invalid", "schema_mismatch");
  }
  const validated = validateReadingCandidate(publisher.candidate, prepared);
  if (!validated.ok) {
    logRejection(validated.failures);
    const detail = validated.failures[0];
    return fail(
      "publisher_output_invalid",
      detail ? `${detail.code}_${detail.detail_code}` : "schema_mismatch",
    );
  }

  const identityRow = await env.DB.prepare(
    "SELECT crypto_subject FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ crypto_subject: string }>();
  if (!identityRow) {
    return fail("generation_input_id_mismatch", "input_integrity_mismatch");
  }
  const identity: UserIdentity = {
    userId,
    cryptoSubject: asCryptoSubject(identityRow.crypto_subject),
  };

  const paragraphs: DailyReadingV5["paragraphs"] = [];
  const paragraphEvidence: ParagraphEvidenceV5[] = [];
  for (const unit of validated.units) {
    const paragraphId = newId("par");
    paragraphs.push({
      paragraph_id: paragraphId,
      role: unit.role,
      order: unit.order,
      text: unit.text,
    });
    paragraphEvidence.push({
      paragraph_id: paragraphId,
      role: unit.role,
      order: unit.order,
      fact_refs: unit.fact_refs,
      context_refs: unit.context_refs,
    });
  }

  const reading: DailyReadingV5 = {
    schema_version: M5_SCHEMA_VERSION,
    output_schema: "daily-reading-v5",
    reading_id: command.reading_id,
    local_date: command.target_local_date,
    generated_at: command.generation_anchor,
    assembly_mode: "constrained_model",
    revision: command.revision,
    locale: command.locale,
    domain_preference: command.domain_preference,
    headline: publisher.candidate.headline,
    disclosure: DISCLOSURE,
    paragraphs,
  };
  const content_hash = await contentHash(canonicalJson(publisher.candidate));
  const evidenceHeader: StoredReadingV5["evidence_header"] = {
    schema_version: M5_SCHEMA_VERSION,
    reading_id: command.reading_id,
    revision: command.revision,
    revision_reason: command.revision_reason,
    generated_at: command.generation_anchor,
    generation_input_id: command.generation_input_id,
    input_manifest_hash: command.input_manifest_hash,
    content_hash,
    provider_response_hash: publisher.metadata.provider_response_hash,
    calculation: {
      chart_contract_id: command.chart.contract_id,
      cycle_policy_version: command.cycle_scan.policy_version,
      daily_sky_policy_version: command.daily_sky.policy_version,
      ephemeris_data_version: command.daily_sky.ephemeris_data_version,
      container_digest: command.daily_sky.container_digest,
      tzdb_version: command.tzdb_version,
      local_day_resolution_policy_version:
        command.local_day_resolution_policy_version,
    },
    model: {
      provider: publisher.metadata.provider,
      model: publisher.metadata.model,
      prompt_version: command.publisher.prompt_version,
      selection_policy_version: command.publisher.selection_policy_version,
      validation_policy_version: command.publisher.validation_policy_version,
      provider_request_id: publisher.metadata.provider_request_id,
      input_tokens: publisher.metadata.input_tokens,
      output_tokens: publisher.metadata.output_tokens,
    },
    validation: validated.validation,
  };
  const stored: StoredReadingV5 = {
    schema_version: M5_SCHEMA_VERSION,
    reading,
    evidence_header: evidenceHeader,
    invalidation: null,
  };

  const sealedReading = await encryptPayload(env, identity, stored, {
    subject: identity.cryptoSubject,
    field: "daily_readings.reading_enc",
    recordId: command.reading_id,
  });
  const evidenceRows: EvidenceRow[] = [];
  for (const paragraph of paragraphEvidence) {
    const rowId = newId("rsc");
    const sealed = await encryptPayload(env, identity, paragraph, {
      subject: identity.cryptoSubject,
      field: "reading_sources.evidence_enc",
      recordId: rowId,
    });
    evidenceRows.push({
      id: rowId,
      paragraphId: paragraph.paragraph_id,
      paragraphOrder: paragraph.order,
      ciphertext: bytes(sealed.ciphertext),
      keyVersion: sealed.keyVersion,
      nonce: sealed.nonce,
    });
  }

  const published = await completeReading(env, {
    identity,
    readingId: command.reading_id,
    jobId: claim.jobId,
    claimToken: claim.claimToken,
    commandGeneration: command.command_generation,
    predecessor: command.supersedes_reading_id
      ? command.reservation_reason === "fact_repair"
        ? { kind: "retain_invalidated", readingId: command.supersedes_reading_id }
        : { kind: "supersede_published", readingId: command.supersedes_reading_id }
      : { kind: "none" },
    reading: {
      ciphertext: bytes(sealedReading.ciphertext),
      keyVersion: sealedReading.keyVersion,
      nonce: sealedReading.nonce,
    },
    evidence: evidenceRows,
  });
  if (!published.ok) {
    if (published.reason === "stale_claim") {
      return { ok: false, reason: "duplicate", detail: "publication claim was stale" };
    }
    throw new Error("V5 publication transaction did not commit");
  }

  return { ok: true, readingId: command.reading_id, fallbackUsed: false };
}
