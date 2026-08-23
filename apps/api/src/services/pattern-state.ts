import {
  M7_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
  type PatternResponseV7,
  type PatternStateDocument,
} from "@patternlike/shared";
import { projectPublicPattern } from "@patternlike/pattern-engine";
import type { Env } from "../env.js";
import { b64 } from "../crypto.js";
import type { UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import {
  loadAnyClaim,
  loadClaimForFingerprint,
  hashChartFingerprint,
  type PatternClaimRow,
} from "../db/pattern-claims.js";
import { loadPatternGenerationGrant, patternConsentDocument } from "../db/pattern-consents.js";
import { isOntologyRecalled, loadActiveOntology, ontologyServesAccount } from "../db/pattern-ontology.js";
import { decryptUnderContentKey, unwrapContentKey } from "./pattern-crypto.js";
import {
  patternFailureIsRetryable,
} from "./pattern-command.js";
import {
  publicFailureStageFor,
  publicStageFor,
  type PatternDomainStage,
} from "./pattern-stage-protocol.js";
import {
  isInternalPatternAccount,
  readPatternAiRollout,
} from "./pattern-rollout.js";
import { getActiveRelease } from "../db/content-releases.js";
import type { PatternDocumentInternal } from "@patternlike/shared";

interface DocumentRow {
  id: string;
  claim_id: string;
  generation_id: string;
  locale: string;
  effective_accuracy: "exact" | "approximate" | "unknown";
  document_enc: ArrayBuffer;
  document_nonce: string;
  wrapped_document_key_enc: ArrayBuffer;
  wrapped_document_key_version: number;
  wrapped_document_key_nonce: string;
  generated_at: string;
  chart_fingerprint_hash: string;
  compact_provenance_json: string;
  ontology_version: string;
}

export async function loadActiveChart(
  env: Env,
  userId: string,
): Promise<{ id: string; fingerprint: string; birth_accuracy: "exact" | "approximate" | "unknown" } | null> {
  return env.DB.prepare(
    `SELECT id, fingerprint, birth_accuracy FROM chart_snapshots
     WHERE user_id = ? AND status = 'active' ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string; fingerprint: string; birth_accuracy: "exact" | "approximate" | "unknown" }>();
}

/** Any document for the user. Chart-correction cleanup needs the stale row. */
export async function loadAnyPatternDocument(
  env: Env,
  userId: string,
): Promise<DocumentRow | null> {
  return env.DB.prepare(
    `SELECT id, claim_id, generation_id, locale, effective_accuracy, document_enc, document_nonce,
            wrapped_document_key_enc, wrapped_document_key_version, wrapped_document_key_nonce,
            generated_at, chart_fingerprint_hash, compact_provenance_json, ontology_version
     FROM pattern_documents WHERE user_id = ?`,
  )
    .bind(userId)
    .first<DocumentRow>();
}

export async function loadActivePatternDocument(
  env: Env,
  userId: string,
  fingerprintHash: string,
): Promise<DocumentRow | null> {
  return env.DB.prepare(
    `SELECT id, claim_id, generation_id, locale, effective_accuracy, document_enc, document_nonce,
            wrapped_document_key_enc, wrapped_document_key_version, wrapped_document_key_nonce,
            generated_at, chart_fingerprint_hash, compact_provenance_json, ontology_version
     FROM pattern_documents WHERE user_id = ? AND chart_fingerprint_hash = ?`,
  )
    .bind(userId, fingerprintHash)
    .first<DocumentRow>();
}

export async function decryptPatternDocument(
  env: Env,
  identity: UserIdentity,
  row: DocumentRow,
): Promise<PatternDocumentInternal> {
  const key = await unwrapContentKey(
    env,
    identity,
    row.id,
    "pattern_documents.wrapped_document_key_enc",
    {
      key_version: row.wrapped_document_key_version,
      nonce: row.wrapped_document_key_nonce,
      ciphertext: b64(row.wrapped_document_key_enc),
    },
  );
  const aad = new TextEncoder().encode(
    JSON.stringify(["patternlike.pattern-document", 1, row.id, row.generation_id]),
  );
  return decryptUnderContentKey<PatternDocumentInternal>(
    new Uint8Array(row.document_enc),
    key,
    Uint8Array.from(atob(row.document_nonce), (ch) => ch.charCodeAt(0)),
    aad,
  );
}

export async function projectPatternResponse(
  env: Env,
  identity: UserIdentity,
  row: DocumentRow,
): Promise<PatternResponseV7> {
  const internal = await decryptPatternDocument(env, identity, row);
  return projectPublicPattern(internal, row.generated_at);
}

/**
 * Which Pattern a reader is shown. Shared by GET /v1/pattern-state and
 * GET /v1/pattern so the two surfaces can never disagree: the client renders
 * the M4 catalogue only for `editorial_catalog`, so a state document that
 * moves ahead of the read route makes published chapters vanish from the UI
 * while the route would still serve them.
 *
 * Design spec 19.6 dispatches on the durable claim, and 25.5 says `first_open`
 * leaves existing editorial-cohort accounts editorial until they opt in while
 * `enabled` gives every eligible account the AI first-open state. Granting is
 * what mints the claim -- pattern-enqueue writes the consent row and the
 * reservation in one batch -- so a claim IS the record of an explicit opt-in.
 *
 * `first_open` therefore admits only accounts with no editorial Pattern to
 * lose. Reading it as "everyone" collapsed the mode that admits new readers
 * into the mode that switches the whole product over, and moved every existing
 * account out of the reviewed M4 chapters on the request after the flag moved.
 */
export async function isPatternAiCohort(
  env: Env,
  userId: string,
  anyClaim: boolean,
): Promise<boolean> {
  if (anyClaim) return true;
  const rollout = readPatternAiRollout(env) ?? "off";
  if (rollout === "off") return false;
  if (rollout === "internal") return isInternalPatternAccount(env, userId);
  if (rollout === "enabled") return true;
  return !(await getActiveRelease(env));
}

export async function buildPatternState(
  env: Env,
  identity: UserIdentity,
  now = new Date(),
): Promise<PatternStateDocument> {
  const consent = patternConsentDocument(await loadPatternGenerationGrant(env, identity.userId, now));
  const chart = await loadActiveChart(env, identity.userId);

  const anyClaim = await loadAnyClaim(env, identity.userId);
  const aiCohort = await isPatternAiCohort(env, identity.userId, !!anyClaim);

  if (!aiCohort) {
    return {
      schema_version: M7_SCHEMA_VERSION,
      state: "editorial_catalog",
      chart: chart
        ? {
            chart_id: chart.id,
            effective_accuracy: chart.birth_accuracy,
            feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
          }
        : null,
      consent,
      generation: null,
      pattern: null,
    };
  }

  if (!chart) {
    return {
      schema_version: M7_SCHEMA_VERSION,
      state: "chart_required",
      chart: null,
      consent,
      generation: null,
      pattern: null,
    };
  }

  const preferences = await loadPreferences(env, identity.userId);
  if (!preferences || preferences.localeSource !== "user_confirmed") {
    return {
      schema_version: M7_SCHEMA_VERSION,
      state: "locale_confirmation_required",
      chart: {
        chart_id: chart.id,
        effective_accuracy: chart.birth_accuracy,
        feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
      },
      consent,
      generation: null,
      pattern: null,
    };
  }

  const fingerprintHash = await hashChartFingerprint(chart.fingerprint);
  const claim = await loadClaimForFingerprint(env, identity.userId, fingerprintHash);
  const document = await loadActivePatternDocument(env, identity.userId, fingerprintHash);
  const ontology = await loadActiveOntology(env);

  const chartBlock = {
    chart_id: chart.id,
    effective_accuracy: chart.birth_accuracy,
    feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
  };

  if (document && (await isOntologyRecalled(env, document.ontology_version))) {
    return emptyState("withdrawn", chartBlock, consent);
  }

  if (claim?.status === "deleted") {
    return emptyState("deleted", chartBlock, consent);
  }
  if (claim?.status === "withdrawn") {
    return emptyState("withdrawn", chartBlock, consent);
  }
  if (claim?.status === "superseded" && !document) {
    // Consumed fingerprint with no current document: the one Pattern was used.
    return emptyState("deleted", chartBlock, consent);
  }

  if (claim?.status === "available") {
    const failed = await env.DB.prepare(
      `SELECT generation_id, stage, updated_at, created_at,
              public_failure_stage, failure_class
       FROM pattern_generation_jobs
       WHERE user_id = ? AND chart_fingerprint_hash = ? AND stage = 'failed'
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(identity.userId, fingerprintHash)
      .first<{
        generation_id: string;
        stage: PatternDomainStage;
        updated_at: string;
        created_at: string;
        public_failure_stage: string | null;
        failure_class: string | null;
      }>();
    if (failed) {
      return {
        schema_version: M7_SCHEMA_VERSION,
        state: "failed",
        chart: chartBlock,
        consent,
        generation: {
          generation_id: failed.generation_id,
          stage: publicFailureStageFor(failed.public_failure_stage) ?? "organizing_evidence",
          status_updated_at: failed.updated_at,
          started_at: failed.created_at,
          retryable:
            consent.status === "granted" &&
            await patternFailureIsRetryable(env, failed.failure_class, now),
          request_id: null,
        },
        pattern: null,
      };
    }
  }

  if (document && claim?.status === "accepted") {
    if (document.chart_fingerprint_hash !== fingerprintHash) {
      return emptyState("available", chartBlock, consent);
    }
    return {
      schema_version: M7_SCHEMA_VERSION,
      state: "ready",
      chart: chartBlock,
      consent,
      generation: null,
      pattern: {
        pattern_id: document.id,
        generated_at: document.generated_at,
        locale: document.locale,
        effective_accuracy: document.effective_accuracy,
      },
    };
  }

  if (claim?.status === "reserved" && claim.active_generation_id) {
    const job = await env.DB.prepare(
      `SELECT stage, updated_at, created_at, failure_class FROM pattern_generation_jobs
       WHERE generation_id = ? AND user_id = ?`,
    )
      .bind(claim.active_generation_id, identity.userId)
      .first<{ stage: PatternDomainStage; updated_at: string; created_at: string; failure_class: string | null }>();
    if (job) {
      const publicStage = publicStageFor(job.stage);
      if (job.stage === "failed") {
        return {
          schema_version: M7_SCHEMA_VERSION,
          state: "failed",
          chart: chartBlock,
          consent,
          generation: {
            generation_id: claim.active_generation_id,
            stage: publicStage ?? "organizing_evidence",
            status_updated_at: job.updated_at,
            started_at: job.created_at,
            retryable: consent.status === "granted",
            request_id: null,
          },
          pattern: null,
        };
      }
      if (publicStage) {
        return {
          schema_version: M7_SCHEMA_VERSION,
          state: publicStage,
          chart: chartBlock,
          consent,
          generation: {
            generation_id: claim.active_generation_id,
            stage: publicStage,
            status_updated_at: job.updated_at,
            started_at: job.created_at,
            retryable: false,
            request_id: null,
          },
          pattern: null,
        };
      }
    }
  }

  if (
    !ontologyServesAccount(
      ontology,
      isInternalPatternAccount(env, identity.userId),
    )
  ) {
    return emptyState("ontology_unavailable", chartBlock, consent);
  }
  if (consent.status !== "granted") {
    return emptyState("consent_required", chartBlock, consent);
  }
  return emptyState("available", chartBlock, consent);
}

function emptyState(
  state: PatternStateDocument["state"],
  chart: PatternStateDocument["chart"],
  consent: PatternStateDocument["consent"],
): PatternStateDocument {
  return {
    schema_version: M7_SCHEMA_VERSION,
    state,
    chart,
    consent,
    generation: null,
    pattern: null,
  };
}

export type { PatternClaimRow };
