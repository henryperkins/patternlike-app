import {
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
  sha256Hex,
  type AnchorResolution,
  type AspectType,
  type BirthTimeAccuracy,
  type CelestialBody,
  type ChartSnapshot,
  type DailySkyFact,
  type DailySkyResponseSuccess,
  type LifeDomain,
  type NormalizedCycle,
  type ReadingGenerationRequest,
  type ZodiacSignName,
} from "@patternlike/shared";
import {
  ConstrainedInputError,
  prepareConstrainedReadingInput,
  SELECTION_POLICY_VERSION,
  VALIDATION_POLICY_VERSION,
  type AssemblyUncertaintyInput,
  type ConstrainedContextRef,
  type ConstrainedNatalFactInput,
  type ConstrainedPriorReading,
  type PreparedConstrainedReadingInput,
} from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { deriveCycles, type PersistedCycle } from "../db/cycles.js";
import { loadAiSynthesisGrant, type AiSynthesisGrant } from "../db/consents.js";
import { buildCycleRequest, invokeCycles } from "./cycle-client.js";
import {
  buildDailySkyRequest,
  dailySkyFailureCode,
  invokeDailySky,
  DailySkyRequestError,
} from "./daily-sky-client.js";
import { resolveDailySkyWindow } from "./local-day.js";
import { loadConstrainedContext } from "./context-compiler.js";
import {
  resolvePublisherConfiguration,
  type PublisherConfigPin,
} from "./reading-publisher.js";
import { toAssemblyUncertainty } from "./generation-command.js";
import type { GenerateDailyReadingCommandV1 } from "./generation-command.js";
import type { V5ReplacementReason } from "./generation-failures.js";

/**
 * Freeze every input a constrained-model reading will ever be generated from.
 *
 * One consistent read at enqueue, then nothing mutable is consulted again. Two
 * things make this harder than the V1 command and both are deliberate: the
 * packet the model will see is computed HERE, by the one pure entry point, so
 * execution can recompute it and compare; and both calculation calls are pinned
 * by request and response digest, so a mid-flight redeploy of the calculation
 * service is a visible failure rather than a quietly different reading.
 */

// ---------------------------------------------------------------------------
// Command shape
// ---------------------------------------------------------------------------

export type ReservationReason =
  | "first_open"
  | "scheduled"
  | "internal"
  | "automatic_replacement"
  | "manual_reissue"
  | "fact_repair";

export type RevisionReasonV2 =
  | "initial"
  | "chart_recalculated"
  | "consent_revoked"
  | "safety_correction"
  | "defect_repair";

export interface AiConsentPin {
  consent_id: string;
  kind: "ai_synthesis";
  status: "granted";
  policy_version: string;
  categories: string[];
  validated_at: string;
}

export interface V5CalculationPin {
  request_id: string;
  request_digest: string;
  response_digest: string;
  policy_id: string;
  policy_version: string;
  orb_policy_id: string | null;
  orb_policy_version: string | null;
  container_digest: string;
  ephemeris_data_version: string;
}

export interface CyclePinV2 {
  cycle_id: string;
  pass_ids: string[];
  cycle_hash: string;
}

export interface DailySkyFactPin {
  fact_id: string;
  content_digest: string;
}

export interface V5ChartPin {
  snapshot_id: string;
  fingerprint: string;
  profile_version: number;
  contract_id: string;
  contract_version: string;
  container_digest: string;
  effective_accuracy: BirthTimeAccuracy;
  uncertainty: AssemblyUncertaintyInput;
}

/**
 * One selected signal/use pair, plus the exact value the compiler selected.
 *
 * The snapshot is PLAINTEXT, which is safe only because the whole command lives
 * inside the user's DEK envelope. Nothing here may be copied out of it
 * unencrypted, and no second AAD identity is introduced for it: nested
 * ciphertext inside an already-encrypted blob buys nothing and adds a key
 * nobody rotates.
 */
export interface ContextPinV2 {
  context_ref: string;
  signal_id: string;
  source_id: string;
  category: string;
  normalized_hash: string;
  allowed_use: string;
  evidence_lane: string;
  consent_id: string;
  consent_version: number;
  permission_state: "active";
  freshness_status: "fresh" | "stale";
  observed_at: string;
  snapshot: { kind: "text"; text: string } | { kind: "structured"; value: Record<string, unknown> };
}

export interface PriorReadingPin {
  local_date: string;
  headline: string;
  lead: string;
  reflection_prompt: string;
}

export interface GenerateDailyReadingCommandV2 {
  command_version: "v2";
  schema_version: typeof M5_SCHEMA_VERSION;
  generation_id: string;
  generation_input_id: string;
  input_manifest_hash: string;
  reading_id: string;
  reading_key: string;
  revision: number;
  revision_reason: RevisionReasonV2;
  supersedes_reading_id: string | null;
  reservation_reason: ReservationReason;
  command_generation: number;
  replaces_job_id: string | null;
  command_replacement_reason: V5ReplacementReason | null;
  target_local_date: string;
  target_timezone: string;
  timezone_source: "device_derived" | "user_confirmed";
  timezone_revision: number;
  day_start_at: string;
  day_end_at: string;
  anchor_at: string;
  anchor_resolution: AnchorResolution;
  tzdb_version: string;
  local_day_resolution_policy_version: typeof LOCAL_DAY_RESOLUTION_POLICY_VERSION;
  /** The freeze instant, published as the reading's `generated_at`. */
  generation_anchor: string;
  locale: string;
  locale_source: "device_derived" | "user_confirmed";
  locale_updated_at: string;
  domain_preference: LifeDomain | null;
  output_schema: "daily-reading-v5";
  assembly_mode: "constrained_model";
  ai_consent: AiConsentPin;
  chart: V5ChartPin;
  cycle_scan: V5CalculationPin & { selected: CyclePinV2[] };
  daily_sky: V5CalculationPin & { selected: DailySkyFactPin[] };
  context: ContextPinV2[];
  prior_readings: PriorReadingPin[];
  publisher: PublisherConfigPin;
}

/** The discriminated union every storage and execution path now speaks. */
export type GenerateDailyReadingCommand =
  | GenerateDailyReadingCommandV1
  | GenerateDailyReadingCommandV2;

export function isCommandV2(
  command: GenerateDailyReadingCommand,
): command is GenerateDailyReadingCommandV2 {
  return (command as { command_version?: unknown }).command_version === "v2";
}

// ---------------------------------------------------------------------------
// Reading key
// ---------------------------------------------------------------------------

/**
 * `reading-v5:<user_id>:<YYYY-MM-DD>:r<revision>`.
 *
 * The literal namespace is what makes this disjoint from the legacy
 * `user:<id>:<date>:<release>:r<n>` grammar under the retained global UNIQUE,
 * and 0003 enforces the split with a CHECK rather than trusting it. Stable
 * across command-generation replacement, and never placed in a provider packet.
 */
export function buildV5ReadingKey(
  userId: string,
  localDate: string,
  revision: number,
): string {
  return `reading-v5:${userId}:${localDate}:r${revision}`;
}

// ---------------------------------------------------------------------------
// Natal facts
// ---------------------------------------------------------------------------

const NATAL_FACT_IDENTITY_PROFILE = "patternlike.natal-fact-id.v1";

interface NatalFactPreimage {
  identity_profile: typeof NATAL_FACT_IDENTITY_PROFILE;
  schema_version: typeof M5_SCHEMA_VERSION;
  fact_class: "natal_position" | "natal_aspect";
  body: string;
  target: string | null;
  aspect: string | null;
  sign: string | null;
  degree_deg: number | null;
  house: number | null;
  contract_id: string;
  contract_version: string;
  container_digest: string;
}

const ZODIAC: ReadonlySet<string> = new Set([
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
]);

/**
 * Stable natal context, with content-addressed handles.
 *
 * Computed here rather than in the reading engine because the engine's purity
 * contract has no crypto — the same reason `dsf_` handles are sealed by the
 * calculation service. Both enqueue and execute call this function, so the two
 * cannot derive different handles for one chart.
 */
export async function projectNatalFacts(
  chart: ChartSnapshot,
): Promise<ConstrainedNatalFactInput[]> {
  const suppressed = new Set(chart.uncertainty.suppressed_features.map((f) => f.feature_class));
  const anglesSuppressed = suppressed.has("angles") || suppressed.has("angle_transits");
  const moonSuppressed = suppressed.has("moon_time_sensitive");
  const housesSuppressed = suppressed.has("houses");

  const facts: ConstrainedNatalFactInput[] = [];

  for (const position of chart.positions) {
    if (position.body === "ascendant" || position.body === "midheaven") {
      if (anglesSuppressed) continue;
    }
    if (position.body === "moon" && moonSuppressed) continue;

    const sign = typeof position.sign === "string" && ZODIAC.has(position.sign)
      ? (position.sign as ZodiacSignName)
      : null;
    const house = !housesSuppressed && typeof position.house === "number" ? position.house : null;
    // The degree WITHIN the sign, which is what a reader recognises. The raw
    // ecliptic longitude is not reader vocabulary and would license a number
    // no label ever states.
    const degree = sign ? ((position.longitude_deg % 30) + 30) % 30 : null;
    const preimage: NatalFactPreimage = {
      identity_profile: NATAL_FACT_IDENTITY_PROFILE,
      schema_version: M5_SCHEMA_VERSION,
      fact_class: "natal_position",
      body: position.body,
      target: null,
      aspect: null,
      sign,
      degree_deg: degree,
      house,
      contract_id: chart.contract_id,
      contract_version: chart.contract_version,
      container_digest: chart.container_digest,
    };
    facts.push({
      fact_id: `nat_${(await sha256Hex(canonicalJson(preimage))).slice(0, 32)}`,
      fact_class: "natal_position",
      body: position.body,
      target: null,
      aspect: null,
      sign,
      degree_deg: degree,
      house,
    });
  }

  for (const aspect of chart.aspects) {
    if (moonSuppressed && (aspect.body_a === "moon" || aspect.body_b === "moon")) continue;
    if (
      anglesSuppressed &&
      ["ascendant", "midheaven"].some((angle) => aspect.body_a === angle || aspect.body_b === angle)
    ) {
      continue;
    }
    const preimage: NatalFactPreimage = {
      identity_profile: NATAL_FACT_IDENTITY_PROFILE,
      schema_version: M5_SCHEMA_VERSION,
      fact_class: "natal_aspect",
      body: aspect.body_a,
      target: aspect.body_b,
      aspect: aspect.aspect,
      sign: null,
      degree_deg: aspect.orb_deg,
      house: null,
      contract_id: chart.contract_id,
      contract_version: chart.contract_version,
      container_digest: chart.container_digest,
    };
    facts.push({
      fact_id: `nat_${(await sha256Hex(canonicalJson(preimage))).slice(0, 32)}`,
      fact_class: "natal_aspect",
      body: aspect.body_a as CelestialBody,
      target: aspect.body_b as CelestialBody,
      aspect: aspect.aspect as AspectType,
      sign: null,
      degree_deg: aspect.orb_deg,
      house: null,
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const GENERATION_INPUT_DOMAIN = "patternlike.generation-input-id.v1 ";

/**
 * `gin_sha256_` plus the FULL 64-hex digest of the domain-separated identity.
 *
 * Not truncated, unlike `dsf_` and `cyc_`: those name a fact inside one packet,
 * this names the whole eligible input and is what execution compares before it
 * is allowed to spend money.
 */
export async function renderGenerationInputId(identityCanonical: string): Promise<string> {
  return `gin_sha256_${await sha256Hex(`${GENERATION_INPUT_DOMAIN}${identityCanonical}`)}`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type CommandBuildFailureV2 =
  | "timezone_confirmation_required"
  | "locale_confirmation_required"
  | "chart_not_found"
  | "ai_synthesis_consent_required"
  | "publisher_not_configured"
  | "calc_unavailable"
  | "daily_sky_unavailable"
  | "policy_unsupported"
  | "context_ineligible"
  | "skipped_local_date";

export interface CommandBuildContextV2 {
  readingId: string;
  revision: number;
  revisionReason: RevisionReasonV2;
  supersedesReadingId: string | null;
  reservationReason: ReservationReason;
  commandGeneration: number;
  replacesJobId: string | null;
  commandReplacementReason: V5ReplacementReason | null;
  /**
   * Explicit rather than derived. The scheduler reserves TOMORROW's edition
   * before its local day begins, and re-deriving "today" would give a
   * pre-generated command a different day than the one it was built for.
   */
  targetLocalDate: string;
  /** The trusted freeze instant. Never a client value, never a later attempt's clock. */
  now: Date;
}

export type CommandBuildV2 =
  | {
      ok: true;
      command: GenerateDailyReadingCommandV2;
      chartId: string;
      cycles: NormalizedCycle[];
      prepared: PreparedConstrainedReadingInput;
      request: ReadingGenerationRequest;
    }
  | { ok: false; reason: CommandBuildFailureV2; detail: string };

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

function parseChartSnapshot(row: ChartRow): ChartSnapshot | null {
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
    // The stored uncertainty column is authoritative over whatever the snapshot
    // blob happens to carry: it is the one the rest of the pipeline reads.
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

function toContextPins(refs: ConstrainedContextRef[]): ContextPinV2[] {
  return refs.map((ref) => ({
    context_ref: ref.context_ref,
    signal_id: ref.signal_id,
    source_id: ref.source_id,
    category: ref.category,
    normalized_hash: ref.normalized_hash,
    allowed_use: ref.allowed_use,
    evidence_lane: ref.evidence_lane,
    consent_id: ref.consent_id,
    consent_version: ref.consent_version,
    permission_state: ref.permission_state,
    freshness_status: ref.freshness_status,
    observed_at: ref.observed_at,
    snapshot: ref.snapshot,
  }));
}

function toPriorPins(readings: ConstrainedPriorReading[]): PriorReadingPin[] {
  return readings.map((reading) => ({
    local_date: reading.local_date,
    headline: reading.headline,
    lead: reading.lead,
    reflection_prompt: reading.reflection_prompt,
  }));
}

export async function buildGenerationCommandV2(
  env: Env,
  identity: UserIdentity,
  ctx: CommandBuildContextV2,
): Promise<CommandBuildV2> {
  const publisher = resolvePublisherConfiguration(env);
  if (!publisher.ok || !publisher.config) {
    return {
      ok: false,
      reason: "publisher_not_configured",
      detail: publisher.ok ? "the reading publisher is off" : publisher.message,
    };
  }
  const config = publisher.config;

  const preferences = await loadPreferences(env, identity.userId);
  if (!preferences) {
    return { ok: false, reason: "chart_not_found", detail: "user does not exist" };
  }
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

  const resolution = resolveDailySkyWindow(preferences.timezone, ctx.targetLocalDate);
  if (!resolution.ok) {
    return {
      ok: false,
      reason: "skipped_local_date",
      detail: `${ctx.targetLocalDate} does not exist in ${preferences.timezone}`,
    };
  }
  const day = resolution.window;

  const grant = await loadAiSynthesisGrant(env, identity.userId);
  if (!grant) {
    return {
      ok: false,
      reason: "ai_synthesis_consent_required",
      detail: "no current ai_synthesis grant under a supported policy version",
    };
  }

  const chartRow = await env.DB.prepare(
    `SELECT id, profile_version, fingerprint, contract_id, contract_version,
            container_digest, snapshot_json, uncertainty_json
     FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(identity.userId)
    .first<ChartRow>();
  if (!chartRow) {
    return { ok: false, reason: "chart_not_found", detail: "no active chart snapshot" };
  }
  const chart = parseChartSnapshot(chartRow);
  if (!chart) {
    return { ok: false, reason: "chart_not_found", detail: "active chart snapshot is malformed" };
  }
  const uncertainty = toAssemblyUncertainty(chart.uncertainty);
  const effectiveAccuracy = uncertainty.accuracy;

  // Cycle scan first: its answer names the ephemeris vintage the daily-sky call
  // is then required to match, so one freeze cannot straddle two data versions.
  const cycleRequest = buildCycleRequest({
    requestId: newId("req"),
    chartFingerprint: chart.fingerprint,
    natalAccuracy: effectiveAccuracy,
    suppressedFeatures: uncertainty.suppressed_features.map((f) => f.feature_class),
    natalPositions: chart.positions
      .filter((position) => {
        const suppressed = new Set(uncertainty.suppressed_features.map((f) => f.feature_class));
        if (position.body === "ascendant" || position.body === "midheaven") {
          return !(suppressed.has("angles") || suppressed.has("angle_transits"));
        }
        return true;
      })
      .map((position) => ({ body: position.body, longitude_deg: position.longitude_deg })),
    window: { from: day.dayStartAt, to: day.dayEndAt },
    contractId: chart.contract_id,
    contractVersion: chart.contract_version,
  });
  const scan = await invokeCycles(env, cycleRequest);
  if (!scan.ok) {
    return scan.kind === "unavailable"
      ? { ok: false, reason: "calc_unavailable", detail: scan.detail }
      : {
          ok: false,
          reason: "policy_unsupported",
          detail: `cycle scan refused: ${scan.failure.error_class}`,
        };
  }

  let skyRequest;
  try {
    skyRequest = buildDailySkyRequest({
      requestId: newId("req"),
      window: day,
      chart,
      ephemerisDataVersion: scan.response.ephemeris_data_version,
      calculationPolicyId: CYCLE_POLICY_ID,
      calculationPolicyVersion: CYCLE_POLICY_VERSION,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "policy_unsupported",
      detail: err instanceof DailySkyRequestError ? err.message : "daily-sky request invalid",
    };
  }
  const sky = await invokeDailySky(env, skyRequest);
  if (!sky.ok) {
    if (sky.kind === "unavailable") {
      return { ok: false, reason: "daily_sky_unavailable", detail: sky.detail };
    }
    const code = dailySkyFailureCode(sky.failure);
    return {
      ok: false,
      reason: code === "daily_sky_unavailable" ? "daily_sky_unavailable" : "policy_unsupported",
      detail: `daily-sky refused: ${sky.failure.error_class}`,
    };
  }
  const skyResponse: DailySkyResponseSuccess = sky.response;

  const context = await loadConstrainedContext(env, identity, ctx.targetLocalDate);
  const natalFacts = await projectNatalFacts(chart);
  const cycles = scan.response.cycles;
  const derived: PersistedCycle[] = await deriveCycles(cycles);

  const cyclePin: V5CalculationPin = {
    request_id: cycleRequest.request_id,
    request_digest: await contentHash(canonicalJson(cycleRequest)),
    response_digest: await contentHash(canonicalJson(scan.response)),
    policy_id: CYCLE_POLICY_ID,
    policy_version: CYCLE_POLICY_VERSION,
    orb_policy_id: TRANSIT_ORB_POLICY_ID,
    orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
    container_digest: scan.response.container_digest,
    ephemeris_data_version: scan.response.ephemeris_data_version,
  };
  const skyPin: V5CalculationPin = {
    request_id: skyRequest.request_id,
    request_digest: await contentHash(canonicalJson(skyRequest)),
    response_digest: await contentHash(canonicalJson(skyResponse)),
    policy_id: DAILY_SKY_POLICY_ID,
    policy_version: DAILY_SKY_POLICY_VERSION,
    orb_policy_id: null,
    orb_policy_version: null,
    container_digest: skyResponse.container_digest,
    ephemeris_data_version: skyResponse.ephemeris_data_version,
  };

  const pin: PublisherConfigPin = {
    ...config.pin,
    selection_policy_version: SELECTION_POLICY_VERSION,
    validation_policy_version: VALIDATION_POLICY_VERSION,
  };

  let prepared: PreparedConstrainedReadingInput;
  try {
    prepared = prepareConstrainedReadingInput({
      schema_version: M5_SCHEMA_VERSION,
      prompt_version: pin.prompt_version,
      output_schema: "daily-reading-v5",
      selection_policy_version: pin.selection_policy_version,
      validation_policy_version: pin.validation_policy_version,
      context_max_bytes: pin.context_max_bytes,
      target_local_date: ctx.targetLocalDate,
      target_timezone: preferences.timezone,
      locale: preferences.locale,
      generation_anchor: ctx.now.toISOString(),
      revision: ctx.revision,
      // Preserved when a stored preference exists. The current product has no
      // writer, so null is the honest value rather than an invented default.
      domain_preference: null,
      consent_categories: grant.categories,
      day: {
        day_start_at: day.dayStartAt,
        day_end_at: day.dayEndAt,
        anchor_at: day.anchorAt,
        anchor_resolution: day.anchorResolution,
        tzdb_version: day.tzdbVersion,
        local_day_resolution_policy_version: day.localDayResolutionPolicyVersion,
      },
      chart: {
        fingerprint: chart.fingerprint,
        contract_id: chart.contract_id,
        contract_version: chart.contract_version,
        container_digest: chart.container_digest,
        effective_accuracy: effectiveAccuracy,
        uncertainty,
      },
      cycle_scan: cyclePin,
      cycles,
      daily_sky: skyPin,
      daily_sky_facts: skyResponse.facts as DailySkyFact[],
      natal_facts: natalFacts,
      context_sources: context.sources,
      context_signals: context.signals,
      prior_readings: context.priorReadings,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "context_ineligible",
      detail: err instanceof ConstrainedInputError ? err.message : "constrained input invalid",
    };
  }

  const command: GenerateDailyReadingCommandV2 = {
    command_version: "v2",
    schema_version: M5_SCHEMA_VERSION,
    generation_id: newId("gen"),
    generation_input_id: await renderGenerationInputId(prepared.identity_canonical),
    input_manifest_hash: await contentHash(prepared.input_manifest_canonical),
    reading_id: ctx.readingId,
    reading_key: buildV5ReadingKey(identity.userId, ctx.targetLocalDate, ctx.revision),
    revision: ctx.revision,
    revision_reason: ctx.revisionReason,
    supersedes_reading_id: ctx.supersedesReadingId,
    reservation_reason: ctx.reservationReason,
    command_generation: ctx.commandGeneration,
    replaces_job_id: ctx.replacesJobId,
    command_replacement_reason: ctx.commandReplacementReason,
    target_local_date: ctx.targetLocalDate,
    target_timezone: preferences.timezone,
    timezone_source: preferences.timezoneSource as "device_derived" | "user_confirmed",
    timezone_revision: preferences.timezoneRevision,
    day_start_at: day.dayStartAt,
    day_end_at: day.dayEndAt,
    anchor_at: day.anchorAt,
    anchor_resolution: day.anchorResolution,
    tzdb_version: day.tzdbVersion,
    local_day_resolution_policy_version: LOCAL_DAY_RESOLUTION_POLICY_VERSION,
    generation_anchor: ctx.now.toISOString(),
    locale: preferences.locale,
    locale_source: preferences.localeSource as "device_derived" | "user_confirmed",
    locale_updated_at: preferences.localeUpdatedAt ?? ctx.now.toISOString(),
    domain_preference: null,
    output_schema: "daily-reading-v5",
    assembly_mode: "constrained_model",
    ai_consent: {
      consent_id: grant.consentId,
      kind: "ai_synthesis",
      status: "granted",
      policy_version: grant.policyVersion,
      categories: grant.categories,
      validated_at: ctx.now.toISOString(),
    },
    chart: {
      snapshot_id: chartRow.id,
      fingerprint: chart.fingerprint,
      profile_version: chartRow.profile_version,
      contract_id: chart.contract_id,
      contract_version: chart.contract_version,
      container_digest: chart.container_digest,
      effective_accuracy: effectiveAccuracy,
      uncertainty,
    },
    cycle_scan: {
      ...cyclePin,
      selected: derived
        .filter((cycle) =>
          prepared.selected_facts.some((fact) => fact.fact_id === cycle.cycleId),
        )
        .map((cycle) => ({
          cycle_id: cycle.cycleId,
          pass_ids: cycle.passIds,
          cycle_hash: cycle.hash,
        })),
    },
    daily_sky: {
      ...skyPin,
      selected: skyResponse.facts
        .filter((fact) => prepared.selected_facts.some((f) => f.fact_id === fact.fact_id))
        .map((fact) => ({ fact_id: fact.fact_id, content_digest: fact.content_digest })),
    },
    context: toContextPins(prepared.selected_context),
    prior_readings: toPriorPins(prepared.selected_prior_readings),
    publisher: pin,
  };

  return { ok: true, command, chartId: chartRow.id, cycles, prepared, request: prepared.request };
}

/** The grant a caller already validated, re-exported for the execute path. */
export type { AiSynthesisGrant };
