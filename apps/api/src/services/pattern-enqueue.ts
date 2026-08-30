import {
  CALC_CONTRACT_ID,
  CALC_CONTRACT_VERSION,
  M9_SCHEMA_VERSION,
  NATAL_FEATURE_POLICY_VERSION,
  PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  newId,
  type PatternGenerationAcceptedV9,
  type PatternGenerationReasonV9,
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
  reservePatternClaim,
  reservePatternRegeneration,
} from "../db/pattern-claim-transitions.js";
import {
  buildCryptoWriteFence,
  requireSingleCryptoWriteVersion,
} from "../db/crypto-write-fence.js";
import {
  PATTERN_COMMAND_VERSION,
  PATTERN_JOB_TYPE,
  type GeneratePatternCommandV2,
  type PatternReservationReason,
} from "./pattern-command.js";
import { PATTERN_CREATION_SOURCE_HASH } from "../generated/pattern-creation-source.js";
import {
  acceptedReplayStage,
  type PatternDomainStage,
} from "./pattern-stage-protocol.js";
import {
  resolvePatternPublisherConfiguration,
} from "./pattern-publisher.js";
import { markDispatched } from "../db/generation.js";
import { safeLog } from "./safe-log.js";
import { randomKey, wrapContentKey } from "./pattern-crypto.js";

export type PatternEnqueueFailure =
  | { ok: false; status: 400 | 409 | 503; code: string; message: string }
  | { ok: true; body: PatternGenerationAcceptedV9; replay: boolean };

interface ActiveChartRow {
  id: string;
  fingerprint: string;
  birth_accuracy: string;
  profile_version: number;
}

type PatternEnqueueReason = PatternGenerationReasonV9 | "chart_correction";

function reasonToReservation(reason: PatternEnqueueReason): PatternReservationReason {
  return reason;
}

async function loadStoredReservation(
  env: Env,
  identity: UserIdentity,
  idempotencyKey: string,
): Promise<{
  generationId: string;
  consentId: string;
  stage: PatternDomainStage;
  reservationReason: PatternReservationReason;
} | null> {
  const row = await env.DB.prepare(
    `SELECT j.id AS job_id, p.generation_id, p.consent_id, p.stage,
            p.reservation_reason
     FROM jobs j
     JOIN pattern_generation_jobs p ON p.job_id = j.id
     WHERE j.job_type = ? AND j.user_id = ? AND j.idempotency_key = ?`,
  )
    .bind(PATTERN_JOB_TYPE, identity.userId, idempotencyKey)
    .first<{
      job_id: string;
      generation_id: string;
      consent_id: string;
      stage: PatternDomainStage;
      reservation_reason: PatternReservationReason;
    }>();
  return row
    ? {
        generationId: row.generation_id,
        consentId: row.consent_id,
        stage: row.stage,
        reservationReason: row.reservation_reason,
      }
    : null;
}

function acceptedBody(
  consent: PatternGenerationAcceptedV9["consent"],
  generationId: string,
  stage: PatternDomainStage,
): PatternGenerationAcceptedV9 {
  return {
    schema_version: M9_SCHEMA_VERSION,
    consent,
    generation: {
      generation_id: generationId,
      stage: acceptedReplayStage(stage),
    },
  };
}

export async function enqueuePatternGeneration(
  env: Env,
  identity: UserIdentity,
  input: {
    idempotencyKey: string;
    consentPolicyVersion: string;
    reason: PatternEnqueueReason;
    requestId: string;
  },
  now = new Date(),
): Promise<PatternEnqueueFailure> {
  // Admission is the eligibility ladder below and nothing else: an active
  // chart, a user-confirmed locale, the reader's own current consent, a
  // public-capable active ontology, and an unused chart-fingerprint claim.
  // No account, cohort, allowlist, or product switch takes part.
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
    if (existing.reservationReason !== input.reason) {
      return {
        ok: false,
        status: 409,
        code: "idempotency_key_reused",
        message: "Idempotency-Key was already used for a different Pattern action",
      };
    }
    const grant = await loadPatternGenerationGrant(env, identity.userId, now);
    return {
      ok: true,
      replay: true,
      body: acceptedBody(
        patternConsentDocument(grant),
        existing.generationId,
        existing.stage,
      ),
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
  if (!ontologyServesAccount(ontology)) {
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
  const sourceUpdate = input.reason === "source_update";
  const currentDocument = sourceUpdate
    ? await env.DB.prepare(
        `SELECT id, generation_id, pattern_source_hash
         FROM pattern_documents
         WHERE user_id = ? AND chart_fingerprint_hash = ?`,
      )
        .bind(identity.userId, fingerprintHash)
        .first<{
          id: string;
          generation_id: string;
          pattern_source_hash: string;
        }>()
    : null;

  if (sourceUpdate) {
    if (claim?.status !== "accepted" || !currentDocument) {
      return {
        ok: false,
        status: 409,
        code: "pattern_regeneration_not_available",
        message: "A current accepted Pattern is required before regeneration",
      };
    }
    if (claim.pending_regeneration_id) {
      const pendingJob = await env.DB.prepare(
        `SELECT stage FROM pattern_generation_jobs
         WHERE generation_id = ? AND user_id = ? AND reservation_reason = 'source_update'`,
      )
        .bind(claim.pending_regeneration_id, identity.userId)
        .first<{ stage: PatternDomainStage }>();
      if (pendingJob) {
        const grant = await loadPatternGenerationGrant(env, identity.userId, now);
        return {
          ok: true,
          replay: true,
          body: acceptedBody(
            patternConsentDocument(grant),
            claim.pending_regeneration_id,
            pendingJob.stage,
          ),
        };
      }
      return {
        ok: false,
        status: 409,
        code: "pattern_regeneration_in_progress",
        message: "A Pattern regeneration is already reserved",
      };
    }
    if (currentDocument.pattern_source_hash === PATTERN_CREATION_SOURCE_HASH) {
      return {
        ok: false,
        status: 409,
        code: "pattern_regeneration_not_available",
        message: "This Pattern already uses the current creation source",
      };
    }
    const currentGrant = await loadPatternGenerationGrant(env, identity.userId, now);
    if (!currentGrant) {
      return {
        ok: false,
        status: 409,
        code: "pattern_generation_consent_required",
        message: "Pattern generation consent is required before regeneration",
      };
    }
  } else if (claim && isConsumedStatus(claim.status)) {
    return {
      ok: false,
      status: 409,
      code: "pattern_already_consumed",
      message: "This chart has already used its one Pattern generation",
    };
  }
  if (!sourceUpdate && claim?.status === "reserved" && claim.active_generation_id) {
    const grant = await loadPatternGenerationGrant(env, identity.userId, now);
    const reservedJob = await env.DB.prepare(
      `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ? AND user_id = ?`,
    )
      .bind(claim.active_generation_id, identity.userId)
      .first<{ stage: PatternDomainStage }>();
    return {
      ok: true,
      replay: true,
      body: acceptedBody(
        patternConsentDocument(grant),
        claim.active_generation_id,
        reservedJob?.stage ?? "reserved",
      ),
    };
  }
  if (!sourceUpdate && input.reason === "failed_attempt_retry") {
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

  // Last, and only once the reader is otherwise eligible: the deployment's own
  // provider configuration. It is a spend and transport control, never an
  // admission decision, so it must not shadow `chart_required` or any other
  // refusal the reader can act on.
  const publisher = resolvePatternPublisherConfiguration(env);
  if (!publisher.ok || !publisher.config) {
    return {
      ok: false,
      status: 503,
      code: "pattern_generation_unavailable",
      message: "Pattern generation is not configured",
    };
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

  const command: GeneratePatternCommandV2 = {
    command_version: PATTERN_COMMAND_VERSION,
    schema_version: M9_SCHEMA_VERSION,
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
    pattern_source_hash: PATTERN_CREATION_SOURCE_HASH,
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

  const statements: D1PreparedStatement[] = [
    buildCryptoWriteFence(env, {
      userId: identity.userId,
      keyVersion: requireSingleCryptoWriteVersion([
        sealed.keyVersion,
        wrappedArtifact.keyVersion,
      ]),
      allowedStatuses: ["active"],
    }),
  ];
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
  if (sourceUpdate) {
    statements.push(
      reservePatternRegeneration(env, {
        claimId,
        userId: identity.userId,
        chartFingerprintHash: fingerprintHash,
        chartId: chart.id,
        generationId,
        now: nowIso,
      }),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'pattern regeneration reservation did not win'
         WHERE NOT EXISTS (
           SELECT 1 FROM pattern_generation_claims
           WHERE id = ? AND status = 'accepted' AND pending_regeneration_id = ?
         )`,
      ).bind(claimId, generationId),
    );
  } else if (!claim) {
    statements.push(
      reservePatternClaim(env, {
        claimId,
        userId: identity.userId,
        chartFingerprintHash: fingerprintHash,
        chartId: chart.id,
        generationId,
        now: nowIso,
        existing: false,
      }),
    );
  } else {
    statements.push(
      reservePatternClaim(env, {
        claimId,
        userId: identity.userId,
        chartFingerprintHash: fingerprintHash,
        chartId: chart.id,
        generationId,
        now: nowIso,
        existing: true,
      }),
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
         ontology_bundle_hash, corpus_release_hash, pattern_source_hash,
         reservation_reason, stage,
         stage_generation, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
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
      PATTERN_CREATION_SOURCE_HASH,
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
    if (replay && replay.reservationReason === input.reason) {
      const currentGrant = await loadPatternGenerationGrant(env, identity.userId, now);
      return {
        ok: true,
        replay: true,
        body: acceptedBody(
          patternConsentDocument(currentGrant),
          replay.generationId,
          replay.stage,
        ),
      };
    }
    // Concurrent POSTs with different keys can both observe `available` (or no
    // claim). Only one UPDATE/INSERT wins; the loser must replay the winner
    // rather than throw a 500 after the reservation already exists.
    const winner = await loadClaimForFingerprint(env, identity.userId, fingerprintHash);
    const winnerGenerationId = sourceUpdate
      ? winner?.pending_regeneration_id
      : winner?.active_generation_id;
    const winnerOwnsExpectedLane = sourceUpdate
      ? winner?.status === "accepted"
      : winner?.status === "reserved";
    if (winnerOwnsExpectedLane && winnerGenerationId) {
      const currentGrant = await loadPatternGenerationGrant(env, identity.userId, now);
      const reservedJob = await env.DB.prepare(
        `SELECT stage FROM pattern_generation_jobs WHERE generation_id = ? AND user_id = ?`,
      )
        .bind(winnerGenerationId, identity.userId)
        .first<{ stage: PatternDomainStage }>();
      return {
        ok: true,
        replay: true,
        body: acceptedBody(
          patternConsentDocument(currentGrant),
          winnerGenerationId,
          reservedJob?.stage ?? "reserved",
        ),
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
    body: acceptedBody(
      patternConsentDocument(grant),
      generationId,
      "reserved",
    ),
  };
}
