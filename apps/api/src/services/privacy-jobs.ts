import type { Env, PrivacyMessage } from "../env.js";
import {
  PRIVACY_MAX_JOB_ATTEMPTS,
  canPublishExport,
  claimExportJob,
  failExportClaim,
  markFailedExportArtifactDeleted,
  markPrivacyDispatched,
  publishExport,
  releaseExportClaim,
} from "../db/privacy-jobs.js";
import type { ExportClaim } from "../db/privacy-jobs.js";
import { assembleAccountExport } from "./account-export.js";
import {
  ExportTooLargeError,
  exportObjectKey,
  sealExport,
} from "./export-envelope.js";
import type { SealedExport } from "./export-envelope.js";

export const PRIVACY_RETRY_DELAY_SECONDS = 60;

export async function dispatchPrivacy(
  env: Env,
  message: PrivacyMessage,
): Promise<boolean> {
  try {
    await env.PRIVACY_QUEUE.send(message);
  } catch {
    return false;
  }
  await markPrivacyDispatched(env, message.job_id, message.job_type);
  return true;
}

export type PrivacyProcessOutcome = "ack" | "retry";

const EXPORT_ARTIFACT_CAS_ATTEMPTS = 4;

function storedPublicationAttempt(object: R2Object): number {
  const raw = object.customMetadata?.publication_attempt;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return 0;
  const attempt = Number(raw);
  return Number.isSafeInteger(attempt) ? attempt : 0;
}

async function putExportArtifact(
  artifacts: R2Bucket,
  claim: ExportClaim,
  objectKey: string,
  sealed: SealedExport,
): Promise<"stored" | "stale"> {
  for (let index = 0; index < EXPORT_ARTIFACT_CAS_ATTEMPTS; index += 1) {
    const existing = await artifacts.head(objectKey);
    if (existing && storedPublicationAttempt(existing) > claim.attempts) {
      return "stale";
    }
    const stored = await artifacts.put(objectKey, sealed.ciphertext, {
      onlyIf: existing
        ? { etagMatches: existing.etag }
        : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        artifact_schema: "account-export-m6",
        export_request_id: claim.exportId,
        created_at: claim.createdAt,
        publication_attempt: String(claim.attempts),
      },
    });
    if (stored) return "stored";
  }
  throw new Error("export artifact publication was contended");
}

async function exportOwnerIsFenced(
  env: Env,
  claim: ExportClaim,
): Promise<boolean> {
  const owner = await env.DB.prepare(
    "SELECT status FROM users WHERE id = ?",
  )
    .bind(claim.identity.userId)
    .first<{ status: string }>();
  return owner === null || !["active", "frozen"].includes(owner.status);
}

async function deleteFailedExportArtifact(
  env: Env,
  claim: ExportClaim,
  objectKey: string,
  now: Date,
): Promise<void> {
  await env.ARTIFACTS!.delete(objectKey);
  await markFailedExportArtifactDeleted(env, claim.exportId, now);
}

export async function processExportMessage(
  env: Env,
  message: PrivacyMessage,
  now = new Date(),
): Promise<PrivacyProcessOutcome> {
  const claim = await claimExportJob(env, message.job_id, now);
  if (!claim) return "ack";

  if (
    message.job_type !== "export_account" ||
    claim.command.job_type !== "export_account" ||
    claim.command.accepted_response.job_id !== claim.jobId ||
    claim.command.accepted_response.resource_id !== claim.exportId
  ) {
    if (
      await failExportClaim(env, claim, "invariant_failed", now) &&
      env.ARTIFACTS
    ) {
      await deleteFailedExportArtifact(
        env,
        claim,
        exportObjectKey(claim.exportId),
        now,
      );
    }
    return "ack";
  }

  if (!env.ARTIFACTS) {
    await failExportClaim(env, claim, "artifact_write_failed", now);
    return "ack";
  }

  const objectKey = exportObjectKey(claim.exportId);
  try {
    const generatedAt = now.toISOString();
    const plaintext = await assembleAccountExport(
      env,
      claim.identity,
      claim.exportId,
      generatedAt,
      claim.command.request,
    );
    const sealed = await sealExport(
      env,
      claim.exportId,
      claim.createdAt,
      plaintext,
    );
    if (!(await canPublishExport(env, claim))) {
      return "ack";
    }
    if (
      (await putExportArtifact(env.ARTIFACTS, claim, objectKey, sealed)) ===
        "stale"
    ) {
      return "ack";
    }

    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const published = await publishExport(
      env,
      claim,
      `r2://artifacts/${objectKey}`,
      sealed,
      now,
      expiresAt,
    );
    if (!published) {
      // A pending/deleted account cannot acquire a successor export claim, so
      // deletion owns this key and a late PUT must be removed. Active/frozen
      // owners may have a newer claimant; that worker's object is fenced by the
      // publication-attempt metadata and must never be deleted here.
      if (await exportOwnerIsFenced(env, claim)) {
        await env.ARTIFACTS.delete(objectKey);
      }
      return "ack";
    }
    return "ack";
  } catch (error) {
    // Nothing sealed under an oversized document may survive, even if a prior
    // delivery crashed after writing the deterministic key.
    if (error instanceof ExportTooLargeError) {
      if (await failExportClaim(env, claim, "export_too_large", now)) {
        await deleteFailedExportArtifact(env, claim, objectKey, now);
      }
      return "ack";
    }

    if (claim.attempts >= PRIVACY_MAX_JOB_ATTEMPTS) {
      if (await failExportClaim(env, claim, "invariant_failed", now)) {
        await deleteFailedExportArtifact(env, claim, objectKey, now);
      }
      return "ack";
    }
    const retryAt = new Date(
      now.getTime() + PRIVACY_RETRY_DELAY_SECONDS * 1000,
    );
    return (await releaseExportClaim(env, claim, retryAt)) ? "retry" : "ack";
  }
}

export function isPrivacyMessage(value: unknown): value is PrivacyMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    candidate.kind === "privacy" &&
    typeof candidate.job_id === "string" &&
    (candidate.job_type === "export_account" ||
      candidate.job_type === "delete_account")
  );
}
