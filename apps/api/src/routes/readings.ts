import { Hono } from "hono";
import { M3_SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { localDateIn } from "../services/local-day.js";
import {
  hasActiveChart,
  loadPublishedReadingForDate,
  loadReadingEvidence,
  type ReadingEvidence,
  type ReadingRecord,
} from "../db/readings.js";
import type { DailyReading } from "@patternlike/reading-engine";

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

function projectEvidence(evidence: ReadingEvidence) {
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
    console.error("local_day_unresolvable", {
      request_id: requestId,
      code: err instanceof Error ? err.name : "unknown",
    });
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

  return c.json({
    schema_version: M3_SCHEMA_VERSION,
    reading: projectReading(published.stored.reading),
    // Never null in M3: completeReading refuses to commit a publication whose
    // reading_sources count is wrong, and the assembler never emits zero
    // paragraphs. The null in the contract is headroom, not a case, so this
    // does not spend a COUNT(*) per request to rediscover it.
    evidence_url: evidenceUrl(published.record),
  });
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
