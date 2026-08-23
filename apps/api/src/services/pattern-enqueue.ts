import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  M7_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
  PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  newId,
  type PatternGenerationAccepted,
  type PatternGenerationReason,
} from "@patternlike/shared";
import { PATTERN_SELECTION_POLICY_ID, PATTERN_SELECTION_POLICY_VERSION } from "@patternlike/pattern-engine";
import type { Env, PatternGenerationMessage } from "../env.js";
import { encryptPayload, type UserIdentity } from "../db/users.js";
import { loadPreferences } from "../db/preferences.js";
import { ensureNatalFeatureSet } from "../db/natal-features.js";
import { loadActiveOntology, ontologyServesAccount } from "../db/pattern-ontology.js";
import {
  insertPatternConsentGrant,
  latestPatternConsentVersion,
  loadLatestPatternConsent,
  loadPatternGenerationGrant,
  patternConsentDocument,
} from "../db/pattern-consents.js";
import {
  hashChartFingerprint,
  isConsumedStatus,
  loadClaimForFingerprint,
} from "../db/pattern-claims.js";
import {
  PATTERN_COMMAND_VERSION,
  PATTERN_JOB_TYPE,
  type GeneratePatternCommandV1,
  type PatternReservationReason,
} from "./pattern-command.js";
import {
  acceptedReplayStage,
  type PatternDomainStage,
} from "./pattern-stage-protocol.js";
import {
  resolvePatternPublisherConfiguration,
} from "./pattern-publisher.js";
import {
  consumerAdmissionEntry,
  isInternalPatternAccount,
  patternRolloutAllows,
  readPatternAiRollout,
} from "./pattern-rollout.js";
import { markDispatched } from "../db/generation.js";
import { safeLog } from "./safe-log.js";
import { randomKey, wrapContentKey } from "./pattern-crypto.js";

export type PatternEnqueueFailure =
  | { ok: false; status: 400 | 409 | 503; code: string; message: string }
  | { ok: true; body: PatternGenerationAccepted; replay: boolean };

interface ActiveChartRow {
  id: string;
  fingerprint: string;
  birth_accuracy: string;
  profile_version: number;
}

function reasonToReservation(reason: PatternGenerationReason | "chart_correction"): PatternReservationReason {
  return reason;
}

async function loadStoredReservation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<{ generationId: string; consentId: string; stage: PatternDomainStage } | null> {
  const row = await env.DB.prepare(
    `SELECT j.id AS job_id, p.generation_id, p.consent_id, p.stage
     FROM jobs j
     JOIN pattern_generation_jobs p ON p.job_id = j.id
     WHERE j.job_type = ? AND j.user_id = ? AND j.idempotency_key = ?`,
  )
    .bind(PATTERN_JOB_TYPE, identity.userId, idempotencyKey)
    .first<{ job_id: string; generation_id: string; consent_id: string; stage: PatternDomainStage }>();
  return row
    ? { generationId: row.generation_id, consentId: row.consent_id, stage: row.stage }
    : null;
}

export async function enqueuePatternGeneration(
  env: Env,
  identity: UserIdentity,
  input: {
    idempotencyKey: string;
    consentPolicyVersion: string;
    reason: PatternGenerationReason | "chart_correction";
    requestId: string;
  },
  now = new Date(),
): Promise<PatternEnqueueFailure> {
  const rollout = readPatternAiRollout(env);
  if (!rollout) {
    return { ok: false, status: 503, code: "configuration_error", message: "Pattern rollout is misconfigured" };
  }
  const publisher = resolvePatternPublisherConfiguration(env);
  if (!publisher.ok || !publisher.config) {
    return {
      ok: false,
      status: 503,
      code: "pattern_generation_unavailable",
      message: "Pattern generation is not enabled",
    };
  }
  if (!patternRolloutAllows(rollout, consumerAdmissionEntry(env, identity.userId, input.reason))) {
    return {
      ok: false,
      status: 503,
      code: "pattern_generation_unavailable",
      message: "Pattern generation is not enabled for this surface",
    };
  }
  if (input.consentPolicyVersion !== PATTERN_GENERATION_CONSENT_POLICY_VERSION) {
    return {
      ok: false,
      status: 409,
      code: "consent_policy_version_stale",
      message: "The displayed Pattern consent policy is no longer current",
    };
  }

  const existing = await loadStoredReservation(env, identity, input.idempotencyKey);
  if (existing) {
    const grant = await loadPatternGenerationGrant(env, identity.userId, now);
    return {
      ok: true,
      replay: true,
      body: {
        schema_version: M7_SCHEMA_VERSION,
        consent: patternConsentDocument(grant),
        generation: { generation_id: existing.generationId, stage: acceptedReplayStage(existing.stage) },
      },
    };
  }

  const chart = await env.DB.prepare(
    `SELECT id, fingerprint, birth_accuracy, profile_version
     FROM chart_snapshots
     WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  )
    .bind(identity.userId)
    .first<ActiveChartRow>();
  if (!chart) {
    return { ok: false, status: 409, code: "chart_required", message: "An active chart is required before Pattern generation" };
  }

  const preferences = await loadPreferences(env, identity.userId);
  if (!preferences || preferences.localeSource !== "user_confirmed") {
    return {
      ok: false,
      status: 409,
      code: "locale_confirmation_required",
      message: "Confirm a content locale before generating a Pattern",
    };
  }

  const ontology = await loadActiveOntology(env);
  if (
    !ontologyServesAccount(
      ontology,
      isInternalPatternAccount(env, identity.userId),
    )
  ) {
    return {
      ok: false,
      status: 409,
      code: "ontology_unavailable",
      message: "No activated Pattern ontology is available",
    };
  }

  const features = await ensureNatalFeatureSet(env, identity.userId, chart.id, now);
  const fingerprintHash = await hashChartFingerprint(chart.fingerprint);
  const claim = await loadClaimForFingerprint(env, identity.userId, fingerprintHash);
  if (claim && isConsumedStatus(claim.status)) {
    return {
      ok: false,
      status: 409,
      code: "pattern_already_consumed",
      message: "This chart has already used its one Pattern generation",
    };
  }
  if (claim?.status === "reserved" && claim.active_generation_id) {
    const grant = await loadPatternGenerationGrant(env, identity.userId, now);
    const reservedJob = await env.DB.prepare(
      `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ? AND user_id = ?`,
    )
      .bind(claim.active_generation_id, identity.userId)
      .first<{ stage: PatternDomainStage }>();
    return {
      ok: true,
      replay: true,
      body: {
        schema_version: M7_SCHEMA_VERSION,
        consent: patternConsentDocument(grant),
        generation: {
          generation_id: claim.active_generation_id,
          stage: acceptedReplayStage(reservedJob?.stage ?? "reserved"),
        },
      },
    };
  }
  if (input.reason === "failed_attempt_retry") {
    const failed = await env.DB.prepare(
      `SELECT generation_id FROM pattern_generation_jobs
       WHERE user_id = ? AND chart_fingerprint_hash = ? AND stage = 'failed'
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(identity.userId, fingerprintHash)
      .first<{ generation_id: string }>();
    if (!failed) {
      return {
        ok: false,
        status: 409,
        code: "pattern_retry_not_available",
        message: "A failed attempt is required before retrying",
      };
    }
  }

  let grant = await loadPatternGenerationGrant(env, identity.userId, now);
  if (input.reason === "chart_correction" && !grant) {
    return {
      ok: false,
      status: 409,
      code: "pattern_generation_consent_required",
      message: "Chart-correction auto-reserve requires a prior Pattern grant",
    };
  }
  const latest = await loadLatestPatternConsent(env, identity.userId);
  const nowIso = now.toISOString();
  const newConsent = !grant;
  const consentId = grant?.consentId ?? newId("cns");
  const consentVersion = newConsent ? (await latestPatternConsentVersion(env, identity.userId)) + 1 : grant!.policyVersion === PATTERN_GENERATION_CONSENT_POLICY_VERSION ? (latest?.version ?? 1) : 1;
  const jobId = newId("job");
  const generationId = newId("pgen");
  const claimId = claim?.id ?? newId("pgc");
  const localeRevision = preferences.localeUpdatedAt ? Date.parse(preferences.localeUpdatedAt) || 1 : 1;

  const command: GeneratePatternCommandV1 = {
    command_version: PATTERN_COMMAND_VERSION,
    schema_version: M7_SCHEMA_VERSION,
    generation_id: generationId,
    job_id: jobId,
    claim_id: claimId,
    user_id: identity.userId,
    chart_id: chart.id,
    chart_fingerprint: chart.fingerprint,
    chart_fingerprint_hash: fingerprintHash,
    profile_version: chart.profile_version,
    calc_contract_id: CALC_CONTRACT_ID,
    calc_contract_version: CALC_CONTRACT_VERSION,
    feature_set_id: features.featureSetId,
    feature_set_hash: features.featureSetHash,
    feature_policy_version: NATAL_FEATURE_POLICY_VERSION,
    selection_policy_id: PATTERN_SELECTION_POLICY_ID,
    selection_policy_version: PATTERN_SELECTION_POLICY_VERSION,
    locale: preferences.locale,
    locale_revision: localeRevision,
    consent_id: consentId,
    consent_policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
    ontology_version: ontology.version,
    ontology_bundle_hash: ontology.bundleHash,
    corpus_release_hash: ontology.corpusReleaseHash,
    reservation_reason: reasonToReservation(input.reason),
    publisher: publisher.config.pin,
    planner_attempts_max: 2,
    writer_attempts_max: 3,
    verifier_attempts_max: 2,
    artifact_retention_days: publisher.config.artifactRetentionDays,
  };

  const sealed = await encryptPayload(env, identity, command, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  const artifactKey = randomKey();
  const wrappedArtifact = await wrapContentKey(
    env,
    identity,
    generationId,
    "pattern_generation_artifact_keys.wrapped_key_enc",
    artifactKey,
    { generation_id: generationId },
  );

  const statements = [];
  if (newConsent) {
    statements.push(
      insertPatternConsentGrant(
        env,
        identity.userId,
        consentId,
        consentVersion,
        latest?.id ?? null,
        nowIso,
      ),
    );
  }
  if (!claim) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO pattern_generation_claims (
           id, user_id, chart_fingerprint_hash, last_chart_id, status,
           active_generation_id, consumed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'reserved', ?, NULL, ?, ?)`,
      ).bind(claimId, identity.userId, fingerprintHash, chart.id, generationId, nowIso, nowIso),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE pattern_generation_claims
         SET status = 'reserved', active_generation_id = ?, last_chart_id = ?, updated_at = ?
         WHERE id = ? AND status = 'available' AND consumed_at IS NULL`,
      ).bind(generationId, chart.id, nowIso, claimId),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'pattern claim was consumed before reservation'
         WHERE NOT EXISTS (
           SELECT 1 FROM pattern_generation_claims
           WHERE id = ? AND status = 'reserved' AND active_generation_id = ?
         )`,
      ).bind(claimId, generationId),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO jobs
         (id, job_type, user_id, idempotency_key, status, payload_json,
          payload_enc, payload_key_version, payload_nonce, attempts, created_at)
       VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?, ?, 0, ?)`,
    ).bind(
      jobId,
      PATTERN_JOB_TYPE,
      identity.userId,
      input.idempotencyKey,
      Uint8Array.from(atob(sealed.ciphertext), (ch) => ch.charCodeAt(0)),
      sealed.keyVersion,
      sealed.nonce,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_generation_jobs (
         generation_id, job_id, user_id, claim_id, chart_id, chart_fingerprint_hash,
         feature_set_id, feature_set_hash, feature_policy_version, selection_policy_version,
         locale, locale_revision, consent_id, consent_policy_version, ontology_version,
         ontology_bundle_hash, corpus_release_hash, reservation_reason, stage,
         stage_generation, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
    ).bind(
      generationId,
      jobId,
      identity.userId,
      claimId,
      chart.id,
      fingerprintHash,
      features.featureSetId,
      features.featureSetHash,
      NATAL_FEATURE_POLICY_VERSION,
      PATTERN_SELECTION_POLICY_VERSION,
      preferences.locale,
      localeRevision,
      consentId,
      PATTERN_GENERATION_CONSENT_POLICY_VERSION,
      ontology.version,
      ontology.bundleHash,
      ontology.corpusReleaseHash,
      command.reservation_reason,
      nowIso,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pattern_generation_artifact_keys (
         generation_id, user_id, wrapped_key_enc, wrapped_key_version, wrapped_key_nonce,
         created_at, erased_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      generationId,
      identity.userId,
      Uint8Array.from(atob(wrappedArtifact.ciphertext), (ch) => ch.charCodeAt(0)),
      wrappedArtifact.keyVersion,
      wrappedArtifact.nonce,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_type, actor_id, action, resource_type, resource_id, result, detail_class, created_at)
       VALUES (?, 'user', ?, 'pattern_generation.reserved', 'pattern_generation', ?, 'success', ?, ?)`,
    ).bind(newId("aud"), identity.userId, generationId, command.reservation_reason, nowIso),
  );

  try {
    await env.DB.batch(statements);
  } catch {
    const replay = await loadStoredReservation(env, identity, input.idempotencyKey);
    if (replay) {
      const currentGrant = await loadPatternGenerationGrant(env, identity.userId, now);
      return {
        ok: true,
        replay: true,
        body: {
          schema_version: M7_SCHEMA_VERSION,
          consent: patternConsentDocument(currentGrant),
          generation: { generation_id: replay.generationId, stage: acceptedReplayStage(replay.stage) },
        },
      };
    }
    // Concurrent POSTs with different keys can both observe `available` (or no
    // claim). Only one UPDATE/INSERT wins; the loser must replay the winner
    // rather than throw a 500 after the reservation already exists.
    const winner = await loadClaimForFingerprint(env, identity.userId, fingerprintHash);
    if (winner?.status === "reserved" && winner.active_generation_id) {
      const currentGrant = await loadPatternGenerationGrant(env, identity.userId, now);
      const reservedJob = await env.DB.prepare(
        `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ? AND user_id = ?`,
      )
        .bind(winner.active_generation_id, identity.userId)
        .first<{ stage: PatternDomainStage }>();
      return {
        ok: true,
        replay: true,
        body: {
          schema_version: M7_SCHEMA_VERSION,
          consent: patternConsentDocument(currentGrant),
          generation: {
            generation_id: winner.active_generation_id,
            stage: acceptedReplayStage(reservedJob?.stage ?? "reserved"),
          },
        },
      };
    }
    throw new Error("pattern reservation batch failed");
  }

  const message: PatternGenerationMessage = {
    kind: "pattern_generation",
    job_id: jobId,
    generation_id: generationId,
    stage_generation: 0,
  };
  try {
    await env.PATTERN_QUEUE.send(message);
    await markDispatched(env, jobId);
  } catch {
    safeLog({ event: "pattern_dispatch_failed" });
  }

  grant = await loadPatternGenerationGrant(env, identity.userId, now);
  return {
    ok: true,
    replay: false,
    body: {
      schema_version: M7_SCHEMA_VERSION,
      consent: patternConsentDocument(grant),
      generation: { generation_id: generationId, stage: "organizing_evidence" },
    },
  };
}
