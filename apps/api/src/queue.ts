import type { Env, GenerationMessage, WorkerMessage } from "./env.js";
import { checkSecureConfig } from "./middleware/config-guard.js";
import {
  ClaimLoadError,
  claimJob,
  failClaimedJob,
  pauseQueuedV2ForRolloutOff,
  releaseClaimForRetry,
} from "./db/generation.js";
import { dispatchGeneration } from "./services/generate-daily-reading.js";
import {
  LEASE_RETRY_DELAY_SECONDS,
  MAX_JOB_ATTEMPTS,
  RETRY_DELAY_SECONDS,
  queueDisposition,
  type GenerationFailureCode,
} from "./services/generation-failures.js";
import { isCommandV2 } from "./services/generation-command-v2.js";
import { readReadingV5Rollout } from "./services/reading-rollout.js";
import { safeLog } from "./services/safe-log.js";
import {
  PRIVACY_RETRY_DELAY_SECONDS,
  isPrivacyMessage,
  processExportMessage,
} from "./services/privacy-jobs.js";
import {
  processDeletionMessage,
} from "./services/account-deletion.js";

/**
 * The daily-reading consumer.
 *
 * A queue message never touches Hono, so `configGuard` does not run on this
 * path. That matters more here than anywhere else: this handler decrypts a
 * user's frozen command and writes their prose, so it performs the same
 * fail-closed check itself. Without it, the one surface that writes the most
 * sensitive data would be the one surface a development-shaped deployment could
 * still run.
 */

interface ClaimReference {
  jobId: string;
  claimToken: string;
  attempts: number | null;
}

async function retryOrFail(
  message: Message<GenerationMessage>,
  env: Env,
  claim: ClaimReference,
  resultClass: string,
  disposition?: "retry_60s" | "terminal",
): Promise<void> {
  const attempts = Math.max(message.attempts, claim.attempts ?? 0);
  if (disposition === "terminal" || attempts >= MAX_JOB_ATTEMPTS) {
    const failed = await failClaimedJob(env, claim.jobId, claim.claimToken, resultClass);
    if (failed.ok) {
      message.ack();
      return;
    }
    // The platform may dead-letter this delivery after the retry budget. Keep
    // the claim intact so the expired-lease sweeper can recover it; releasing
    // it here would leave a queued, already-dispatched job that neither sweep
    // query can see.
    message.retry({ delaySeconds: LEASE_RETRY_DELAY_SECONDS });
    return;
  }

  try {
    const retryAt = new Date(Date.now() + RETRY_DELAY_SECONDS * 1000);
    if (await releaseClaimForRetry(env, claim.jobId, claim.claimToken, retryAt)) {
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      return;
    }
  } catch (err) {
    safeLog({ event: "generation_claim_release_failed" });
  }

  // If D1 could not prove the release, wait beyond the original lease. A
  // 60-second redelivery would otherwise see a live five-minute claim and ack
  // the command as a duplicate even though no terminal state committed.
  message.retry({ delaySeconds: LEASE_RETRY_DELAY_SECONDS });
}

export async function queue(
  batch: MessageBatch<WorkerMessage>,
  env: Env,
): Promise<void> {
  const failure = checkSecureConfig(env);
  if (failure) {
    safeLog({ event: "insecure_configuration", config_code: failure.code });
    // Retry rather than ack: the messages are valid and the deployment is not.
    batch.retryAll({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }

  const generationMessages: Message<GenerationMessage>[] = [];
  for (const message of batch.messages) {
    if (isPrivacyMessage(message.body)) {
      if (message.body.job_type === "delete_account") {
        const outcome = await processDeletionMessage(env, message.body);
        if (outcome === "ack") {
          message.ack();
        } else {
          message.retry({ delaySeconds: outcome.retryAfterSeconds });
        }
      } else {
        const outcome = await processExportMessage(env, message.body);
        if (outcome === "retry") {
          message.retry({ delaySeconds: PRIVACY_RETRY_DELAY_SECONDS });
        } else {
          message.ack();
        }
      }
    } else {
      generationMessages.push(message as Message<GenerationMessage>);
    }
  }

  const rollout = readReadingV5Rollout(env);
  const rolloutPaused = new Set<string>();
  if (rollout === "off") {
    for (const message of generationMessages) {
      const { job_id: jobId } = message.body ?? {};
      if (!jobId) continue;
      const paused = await pauseQueuedV2ForRolloutOff(env, jobId);
      if (paused !== "not_v2") {
        // D1 committed the pause (or a duplicate delivery observed it) before
        // the Queue nudge is acknowledged. No command decryption or claim.
        message.ack();
        rolloutPaused.add(message.id);
      }
    }
  }

  for (const message of generationMessages) {
    if (rolloutPaused.has(message.id)) continue;
    const { job_id: jobId, reading_id: readingId } = message.body ?? {};
    if (!jobId || !readingId) {
      // Nothing to claim and nothing to retry into. Acking stops an unparseable
      // message from cycling until it reaches the dead-letter queue.
      safeLog({ event: "generation_message_malformed" });
      message.ack();
      continue;
    }

    let claimed: ClaimReference | null = null;
    try {
      const claim = await claimJob(env, jobId);
      if (!claim) {
        // A zero-row claim does no work. Either another consumer holds a live
        // lease or the job already reached a terminal state — both mean this
        // delivery is a duplicate, which at-least-once guarantees will happen.
        message.ack();
        continue;
      }
      claimed = claim;

      const outcome = await dispatchGeneration(env, claim);
      if (outcome.ok) {
        message.ack();
        continue;
      }

      if (outcome.reason === "duplicate") {
        message.ack();
        continue;
      }

      if (outcome.reason === "insufficient_lease") {
        const retryAt = new Date(Date.now() + LEASE_RETRY_DELAY_SECONDS * 1000);
        try {
          await releaseClaimForRetry(env, claim.jobId, claim.claimToken, retryAt);
        } finally {
          // If D1 did not prove the release, waiting beyond the lease is still
          // the safe disposition. A short retry could be mistaken for a
          // duplicate while this claim remains live.
          message.retry({ delaySeconds: LEASE_RETRY_DELAY_SECONDS });
        }
        continue;
      }

      const commandVersion = isCommandV2(claim.command) ? "v2" : "v1";
      const failureCode = outcome.reason as GenerationFailureCode;
      const disposition = queueDisposition(
        commandVersion,
        failureCode,
        Math.max(message.attempts, claim.attempts ?? 0),
      );
      if (disposition === "retry_60s") {
        // Infrastructural. Release the claim before asking Queue for a delayed
        // redelivery; after the bounded delivery budget, fail the reservation
        // so the scheduler's guarded replacement path can re-freeze the day.
        safeLog({
          event: "generation_retryable_failure",
          failure_class: outcome.reason,
        });
        await retryOrFail(message, env, claim, outcome.reason, disposition);
        continue;
      }

      if (
        commandVersion === "v2" ||
        queueDisposition(commandVersion, failureCode, 1) === "retry_60s"
      ) {
        await retryOrFail(message, env, claim, outcome.reason, disposition);
        continue;
      }

      // Terminal: generateDailyReading has already moved the reservation and the
      // job to a failed state, so the message is acked. The day is now visible
      // to an operator as a failed reading rather than cycling invisibly.
      safeLog({ event: "generation_failed", failure_class: outcome.reason });
      message.ack();
    } catch (err) {
      const loadFailure = err instanceof ClaimLoadError ? err : null;
      const claim = loadFailure
        ? {
            jobId: loadFailure.jobId,
            claimToken: loadFailure.claimToken,
            attempts: loadFailure.attempts,
          }
        : claimed;
      safeLog({
        event: "generation_threw",
        failure_class: loadFailure ? "payload_undecryptable" : "execution_error",
      });
      if (claim) {
        await retryOrFail(
          message,
          env,
          claim,
          loadFailure ? "payload_undecryptable" : "execution_error",
        );
      } else {
        // A D1 failure during the claim UPDATE has an unknown commit outcome.
        // Delay beyond the possible lease instead of risking a premature ack.
        message.retry({ delaySeconds: LEASE_RETRY_DELAY_SECONDS });
      }
    }
  }
}
