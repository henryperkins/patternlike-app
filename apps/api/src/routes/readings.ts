import { Hono } from "hono";
import { M3_SCHEMA_VERSION, M5_SCHEMA_VERSION } from "@patternlike/shared";
import type { DailyReadingV5 } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { localDateIn } from "../services/local-day.js";
import {
  hasActiveChart,
  loadPublishedReadingForDate,
  loadReadingEvidence,
  type PublishedReading,
  type ReadingEvidence,
  type ReadingRecord,
} from "../db/readings.js";
import type { DailyReading } from "@patternlike/reading-engine";
import { isStoredReadingV5 } from "../services/stored-reading.js";
import { loadLatestFeedback, parseFeedbackRequest, storeReadingFeedback } from "../db/feedback.js";
import { ensureTodayReading } from "../services/ensure-today-reading.js";
import { resumePausedV2ForFirstOpen } from "../db/generation.js";
import { dispatch, resolveV5TargetDate } from "../services/enqueue.js";
import { readReadingV5Rollout, rolloutAllows } from "../services/reading-rollout.js";
import { safeLog } from "../services/safe-log.js";
import {
  assertM5EvidenceResponse,
  assertM5TodayResponse,
} from "../services/m5-product-contract.js";

/**
 * The two read surfaces for a generated daily reading.
 *
 * Every field that reaches the wire is projected by name below rather than
 * spread from the decrypted artifact. `reading_enc` is written once and never
 * rewritten, so the response shape would otherwise be the union of every engine
 * version that ever wrote a row — against a schema that is
 * `additionalProperties: false`, and along a code path no test can author.
 * Projection makes the response a function of this file; the guards in
 * `db/readings.ts` make a row that cannot be projected fail closed instead of
 * emitting a quietly invalid 200.
 */
export const readingRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

/** Relative, per the contract. Built from the column the evidence route matches on. */
function evidenceUrl(record: ReadingRecord): string {
  return `/v1/readings/${record.id}/evidence`;
}

function projectReading(reading: DailyReading) {
  return {
    schema_version: reading.schema_version,
    output_schema: reading.output_schema,
    reading_id: reading.reading_id,
    local_date: reading.local_date,
    generated_at: reading.generated_at,
    assembly_mode: reading.assembly_mode,
    revision: reading.revision,
    locale: reading.locale,
    domain_preference: reading.domain_preference ?? null,
    paragraphs: reading.paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      text: paragraph.text,
    })),
    fallback_used: reading.fallback_used,
  };
}

/**
 * The v5 artifact.
 *
 * No `release_version` and no `fallback_used`: v5 has neither, and a projection
 * that emitted them would be describing an editorial pipeline that did not
 * produce this reading. `disclosure` is required rather than optional — a reader
 * cannot consent to model synthesis and then not be told when it happened.
 */
function projectReadingV5(reading: DailyReadingV5) {
  return {
    schema_version: reading.schema_version,
    output_schema: reading.output_schema,
    reading_id: reading.reading_id,
    local_date: reading.local_date,
    generated_at: reading.generated_at,
    assembly_mode: reading.assembly_mode,
    revision: reading.revision,
    locale: reading.locale,
    domain_preference: reading.domain_preference ?? null,
    headline: reading.headline,
    disclosure: reading.disclosure,
    paragraphs: reading.paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      text: paragraph.text,
    })),
  };
}

function projectTodayResponse(published: PublishedReading) {
  // Never null in either format: completeReading refuses to commit a publication
  // whose reading_sources count is wrong, and neither publisher emits zero
  // paragraphs. The null in the contract is headroom, not a case, so this does
  // not spend a COUNT(*) per request to rediscover it.
  const evidence_url = evidenceUrl(published.record);
  if (isStoredReadingV5(published.stored)) {
    const response = {
      schema_version: M5_SCHEMA_VERSION,
      reading: projectReadingV5(published.stored.reading),
      evidence_url,
    };
    assertM5TodayResponse(response);
    return response;
  }
  return {
    schema_version: M3_SCHEMA_VERSION,
    reading: projectReading(published.stored.reading),
    evidence_url,
  };
}

/**
 * The v5 provenance graph.
 *
 * Smaller than the v3 one, and deliberately so: it carries no reading key and no
 * user id. Those are trusted-plane fields the v3 graph inherited from M0, and a
 * new document had no reason to reintroduce them.
 */
function projectEvidenceV5(evidence: Extract<ReadingEvidence, { schemaVersion: "0.5.0" }>) {
  const { header, paragraphs } = evidence;
  return {
    schema_version: header.schema_version,
    reading_id: header.reading_id,
    revision: header.revision,
    revision_reason: header.revision_reason,
    generated_at: header.generated_at,
    generation_input_id: header.generation_input_id,
    input_manifest_hash: header.input_manifest_hash,
    content_hash: header.content_hash,
    provider_response_hash: header.provider_response_hash,
    calculation: {
      chart_contract_id: header.calculation.chart_contract_id,
      cycle_policy_version: header.calculation.cycle_policy_version,
      daily_sky_policy_version: header.calculation.daily_sky_policy_version,
      ephemeris_data_version: header.calculation.ephemeris_data_version,
      container_digest: header.calculation.container_digest,
      tzdb_version: header.calculation.tzdb_version,
      local_day_resolution_policy_version:
        header.calculation.local_day_resolution_policy_version,
    },
    model: {
      provider: header.model.provider,
      model: header.model.model,
      prompt_version: header.model.prompt_version,
      selection_policy_version: header.model.selection_policy_version,
      validation_policy_version: header.model.validation_policy_version,
      provider_request_id: header.model.provider_request_id,
      input_tokens: header.model.input_tokens,
      output_tokens: header.model.output_tokens,
    },
    paragraphs: paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      fact_refs: paragraph.fact_refs.map((ref) => ({
        fact_id: ref.fact_id,
        fact_class: ref.fact_class,
        label: ref.label,
        scope: ref.scope,
      })),
      context_refs: paragraph.context_refs.map((ref) => ({
        private_ref: ref.private_ref,
        category: ref.category,
        allowed_use: ref.allowed_use,
      })),
    })),
    validation: {
      status: header.validation.status,
      policy_version: header.validation.policy_version,
      checks: header.validation.checks.map((check) => ({
        code: check.code,
        passed: check.passed,
      })),
    },
  };
}

function projectEvidenceV3(evidence: Extract<ReadingEvidence, { schemaVersion: "0.3.0" }>) {
  const { record, header, paragraphs } = evidence;
  return {
    schema_version: header.schema_version,
    reading_id: record.id,
    // The trusted-plane object may name the user: this is the provenance
    // record, not the reading. The product response strips both of these.
    reading_key: record.readingKey,
    user_id: record.userId,
    local_date: record.localDate,
    release_version: record.releaseVersion,
    chart_fingerprint: record.chartFingerprint,
    contract_id: record.contractId,
    assembly_mode: record.assemblyMode,
    assembly_id: header.assembly_id,
    assembly_policy_version: header.assembly_policy_version,
    revision: record.revision,
    revision_reason: record.revisionReason,
    supersedes_reading_id: record.supersedesReadingId,
    primary_theme: header.primary_theme,
    supporting_theme: header.supporting_theme,
    paragraphs: paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      role: paragraph.role,
      order: paragraph.order,
      evidence_lane: paragraph.evidence_lane,
      text_hash: paragraph.text_hash,
      facts: paragraph.facts.map((fact) => ({
        id: fact.id,
        fact_type: fact.fact_type,
        phase: fact.phase,
        orb_deg: fact.orb_deg,
        chart_fingerprint: fact.chart_fingerprint,
        technique: fact.technique,
        pass_index: fact.pass_index,
      })),
      content: paragraph.content.map((ref) => ({
        fragment_id: ref.fragment_id,
        content_version: ref.content_version,
        release_version: ref.release_version,
        content_type: ref.content_type,
        bundle_hash: ref.bundle_hash,
      })),
      context_signals: paragraph.context_signals.map((signal) => ({
        signal_id: signal.signal_id,
        source_id: signal.source_id,
        allowed_use: signal.allowed_use,
        evidence_lane: signal.evidence_lane,
        label: signal.label,
      })),
      ranking_factors: (paragraph.ranking_factors ?? []).map((factor) => ({
        factor: factor.factor,
        weight: factor.weight,
        reason: factor.reason,
      })),
      model_output: paragraph.model_output,
    })),
    validation: {
      passed: header.validation.passed,
      fallback_used: header.validation.fallback_used,
      checks: header.validation.checks.map((check) => ({
        check: check.check,
        result: check.result,
        detail_code: check.detail_code,
      })),
    },
    created_at: header.created_at,
  };
}

function projectEvidence(evidence: ReadingEvidence) {
  if (evidence.schemaVersion === "0.5.0") {
    const response = projectEvidenceV5(evidence);
    assertM5EvidenceResponse(response);
    return response;
  }
  return projectEvidenceV3(evidence);
}

readingRoutes.put("/v1/readings/today", async (c) => {
  const requestId = c.get("requestId");
  const identity: UserIdentity = {
    userId: c.get("userId"),
    cryptoSubject: c.get("cryptoSubject"),
  };

  // A first-open request may advance only this authenticated owner's durable
  // rollout pause. It never claims or decrypts here; dispatch remains an opaque
  // nudge and the Queue consumer rechecks the rollout before execution.
  const rollout = readReadingV5Rollout(c.env);
  if (rollout && rolloutAllows(rollout, "first_open")) {
    const preferences = await loadPreferences(c.env, identity.userId);
    const localDate = preferences
      ? resolveV5TargetDate(preferences.timezone, new Date())
      : null;
    if (localDate) {
      const resumed = await resumePausedV2ForFirstOpen(
        c.env,
        identity.userId,
        localDate,
      );
      if (resumed) {
        await dispatch(c.env, {
          job_id: resumed.jobId,
          reading_id: resumed.readingId,
        });
      }
    }
  }
  const outcome = await ensureTodayReading(c.env, identity, {
    generationMode: "v5",
    rolloutEntry: "first_open",
  });

  if (outcome.ok) {
    if (outcome.status === "ready") {
      return c.json(projectTodayResponse(outcome.published), 200);
    }
    return c.json(
      {
        schema_version: outcome.schemaVersion ?? M5_SCHEMA_VERSION,
        status: "preparing" as const,
        local_date: outcome.localDate,
      },
      202,
    );
  }

  safeLog({ event: "ensure_today_failed", reason: outcome.reason });

  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  switch (outcome.reason) {
    case "unauthorized":
      return c.json(errorBody("unauthorized", "Authentication required"), 401);
    case "chart_not_found":
      return c.json(errorBody("chart_not_found", "No active chart for user"), 404);
    case "timezone_confirmation_required":
      return c.json(
        errorBody(
          "timezone_confirmation_required",
          "Confirm your scheduling time zone before a daily reading can be generated",
        ),
        409,
      );
    case "locale_confirmation_required":
      return c.json(
        errorBody(
          "locale_confirmation_required",
          "Confirm your content locale before a daily reading can be generated",
        ),
        409,
      );
    case "ai_synthesis_consent_required":
      return c.json(
        errorBody(
          "ai_synthesis_consent_required",
          "Grant AI synthesis consent before a daily reading can be generated",
        ),
        409,
      );
    // Two arms, deliberately, where there was one code. Both are 503
    // retryable:false, so collapsing them cost the caller nothing — but it made
    // the state an operator resolves by flipping one variable indistinguishable
    // from the state that means a deploy is broken, and `ensure_today_failed`
    // projected no reason either, so neither the response nor the log could say
    // which had happened.
    //
    // `reading_generation_disabled`: READING_V5_ROLLOUT does not admit this
    // entry point. Nothing is wrong; the feature is off on purpose, and `off`
    // admits no entry point at all.
    case "rollout_disabled":
      return c.json(
        {
          error: {
            ...errorBody(
              "reading_generation_disabled",
              "Daily reading generation is turned off",
            ).error,
            retryable: false,
          },
        },
        503,
      );
    // `publisher_not_configured`: the rollout DID admit the entry point and the
    // publisher configuration behind it is incomplete. configGuard runs ahead of
    // this route (index.ts) and refuses a non-`off` rollout whose publisher
    // values are missing with 503 configuration_error, so this arm is the
    // narrow residue that guard cannot see — not the everyday "generation is
    // off" answer it used to also serve.
    case "publisher_not_configured":
      return c.json(
        {
          error: {
            ...errorBody(
              "publisher_not_configured",
              "Daily reading generation is not configured",
            ).error,
            retryable: false,
          },
        },
        503,
      );
    case "calc_unavailable":
      return c.json(
        {
          error: {
            ...errorBody(
              "calc_unavailable",
              "The calculation service is unavailable",
            ).error,
            retryable: true,
          },
        },
        503,
      );
    case "daily_sky_unavailable":
      return c.json(
        {
          error: {
            ...errorBody(
              "daily_sky_unavailable",
              "The daily sky calculation is unavailable",
            ).error,
            retryable: true,
          },
        },
        503,
      );
    case "policy_unsupported":
      return c.json(
        {
          error: {
            ...errorBody(
              "policy_unsupported",
              "The configured calculation policy is unsupported",
            ).error,
            retryable: false,
          },
        },
        503,
      );
    case "publisher_budget_exhausted":
      return c.json(
        {
          error: {
            ...errorBody(
              "publisher_budget_exhausted",
              "Daily reading capacity is temporarily exhausted",
            ).error,
            retryable: false,
          },
        },
        503,
      );
    case "internal_error":
      return c.json(errorBody("internal_error", "Unexpected server error"), 500);
    default:
      return c.json(
        {
          error: {
            ...errorBody(
              "reading_generation_failed",
              "Today's reading could not be prepared",
            ).error,
            retryable: false,
          },
        },
        424,
      );
  }
});

readingRoutes.get("/v1/readings/today", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  const userId = c.get("userId");
  const identity: UserIdentity = { userId, cryptoSubject: c.get("cryptoSubject") };

  const preferences = await loadPreferences(c.env, userId);
  if (!preferences) {
    return c.json(errorBody("unauthorized", "Authentication required"), 401);
  }

  // Both gates run before the day is resolved, and that ordering is the point.
  // `default_unconfirmed` still carries a usable zone — identity creation writes
  // 'UTC' — so resolving anyway would find no reading, find a chart, and answer
  // `reading_not_generated`: "check back", to a user for whom generation is
  // withheld outright by buildGenerationCommand. Only the 409 names the action
  // that unblocks it. Timezone first, matching the writer's own order.
  if (preferences.timezoneSource === "default_unconfirmed") {
    return c.json(
      errorBody(
        "timezone_confirmation_required",
        "Confirm your scheduling time zone before a daily reading can be generated",
      ),
      409,
    );
  }
  if (preferences.localeSource === "default_unconfirmed") {
    return c.json(
      errorBody(
        "locale_confirmation_required",
        "Confirm your content locale before a daily reading can be generated",
      ),
      409,
    );
  }

  let localDate: string;
  try {
    localDate = localDateIn(preferences.timezone, new Date());
  } catch (err) {
    // A stored zone Intl now rejects means a tzdata regression or direct
    // database manipulation, not a state the reader can fix: the preference
    // writer validates with isValidIanaZone before it stores anything. Mapping
    // this to the 409 would tell the client to rewrite what it already wrote and
    // would hide the regression. Logged here rather than in onError because
    // LocalDayError interpolates the zone, which is location-adjacent.
    safeLog({ event: "local_day_unresolvable" });
    return c.json(errorBody("internal_error", "Unexpected server error"), 500);
  }

  const published = await loadPublishedReadingForDate(c.env, identity, localDate);
  if (!published) {
    // Only reached on a miss. Running the chart probe on the hit path would be
    // slower and wrong: a reading generated from a chart that has since been
    // superseded is still a valid artifact.
    //
    // Nothing here enqueues. Generation is scheduled work against a frozen
    // command; a read that writes would let a client drive generation timing and
    // fight the reservation guards.
    if (!(await hasActiveChart(c.env, userId))) {
      return c.json(
        errorBody("chart_not_found", "No active chart for user"),
        404,
      );
    }
    return c.json(
      {
        error: {
          code: "reading_not_generated",
          message: "No reading has been published for today",
          request_id: requestId,
          // The date the client is being told to check back on. Without it the
          // only honest copy is "not ready", because the reader's local day is
          // resolved here and nowhere the client can see.
          details: { local_date: localDate },
        },
      },
      404,
    );
  }

  return c.json(projectTodayResponse(published));
});

readingRoutes.get("/v1/readings/:id/evidence", async (c) => {
  const requestId = c.get("requestId");
  const identity: UserIdentity = {
    userId: c.get("userId"),
    cryptoSubject: c.get("cryptoSubject"),
  };

  // No length check on the path parameter: an id too short to be real matches no
  // row and already produces this exact answer. A second way to say the same
  // thing is a second thing to keep in step.
  const evidence = await loadReadingEvidence(c.env, identity, c.req.param("id"));
  if (!evidence) {
    // Unknown id and another account's id are the same answer, because
    // ownership is a query predicate rather than a comparison. There is no
    // branch here that could answer 403 or confirm the id exists.
    return c.json(
      {
        error: {
          code: "reading_not_found",
          message: "No such reading",
          request_id: requestId,
        },
      },
      404,
    );
  }

  return c.json(projectEvidence(evidence));
});

readingRoutes.get("/v1/readings/:id/feedback", async (c) => {
  const requestId = c.get("requestId");
  const identity: UserIdentity = {
    userId: c.get("userId"),
    cryptoSubject: c.get("cryptoSubject"),
  };
  const record = await loadLatestFeedback(c.env, identity, c.req.param("id"));
  if (!record) {
    return c.json(
      {
        error: {
          code: "feedback_not_found",
          message: "No feedback recorded for this reading",
          request_id: requestId,
        },
      },
      404,
    );
  }
  return c.json(record, 200);
});

readingRoutes.post("/v1/readings/:id/feedback", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });
  const identity: UserIdentity = {
    userId: c.get("userId"),
    cryptoSubject: c.get("cryptoSubject"),
  };

  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    value = null;
  }
  const request = parseFeedbackRequest(value);
  if (!request) {
    return c.json(
      errorBody(
        "invalid_body",
        "resonance must be helpful, neutral, not_helpful, or off",
      ),
      400,
    );
  }

  const result = await storeReadingFeedback(
    c.env,
    identity,
    c.req.param("id"),
    c.req.header("idempotency-key") ?? null,
    request,
  );
  if (!result.ok) {
    if (result.reason === "missing_idempotency_key") {
      return c.json(
        errorBody("missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"),
        400,
      );
    }
    if (result.reason === "reading_not_found") {
      return c.json(errorBody("reading_not_found", "No such reading"), 404);
    }
    return c.json(
      errorBody(
        "idempotency_conflict",
        "Idempotency-Key was already used for different feedback",
      ),
      409,
    );
  }
  return c.json(result.response, 201);
});
