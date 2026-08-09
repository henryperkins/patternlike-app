import type { Env, GenerationMessage } from "./env.js";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { claimJob, releaseClaimForRetry } from "./db/generation.js";
import { generateDailyReading } from "./services/generate-daily-reading.js";

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

/** Backoff for a dependency that was down rather than wrong. */
const RETRY_DELAY_SECONDS = 60;

export async function queue(
  batch: MessageBatch<GenerationMessage>,
  env: Env,
): Promise<void> {
  const failure = checkSecureConfig(env);
  if (failure) {
    console.error("insecure_configuration", { code: failure.code, queue: batch.queue });
    // Retry rather than ack: the messages are valid and the deployment is not.
    batch.retryAll({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }

  for (const message of batch.messages) {
    const { job_id: jobId, reading_id: readingId } = message.body ?? {};
    if (!jobId || !readingId) {
      // Nothing to claim and nothing to retry into. Acking stops an unparseable
      // message from cycling until it reaches the dead-letter queue.
      console.error("generation_message_malformed", {
        queue: batch.queue,
        message_id: message.id,
      });
      message.ack();
      continue;
    }

    try {
      const claim = await claimJob(env, jobId);
      if (!claim) {
        // A zero-row claim does no work. Either another consumer holds a live
        // lease or the job already reached a terminal state — both mean this
        // delivery is a duplicate, which at-least-once guarantees will happen.
        message.ack();
        continue;
      }

      const outcome = await generateDailyReading(env, claim);
      if (outcome.ok) {
        message.ack();
        continue;
      }

      if (outcome.reason === "duplicate") {
        message.ack();
        continue;
      }

      if (outcome.reason === "calc_unavailable" || outcome.reason === "release_unreadable") {
        // Infrastructural. The reservation is left alone so the same frozen
        // command can be attempted again; only after the retries are spent does
        // the replacement path re-freeze the day.
        console.warn("generation_retryable_failure", {
          job_id: jobId,
          reason: outcome.reason,
        });
        const retryAt = new Date(Date.now() + RETRY_DELAY_SECONDS * 1000);
        if (!(await releaseClaimForRetry(env, jobId, claim.claimToken, retryAt))) {
          message.ack();
          continue;
        }
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
        continue;
      }

      // Terminal: generateDailyReading has already moved the reservation and the
      // job to a failed state, so the message is acked. The day is now visible
      // to an operator as a failed reading rather than cycling invisibly.
      console.error("generation_failed", { job_id: jobId, reason: outcome.reason });
      message.ack();
    } catch (err) {
      // An unexpected throw leaves the claim in place with a bounded lease, so
      // the reclaim path can pick it up. Retry rather than ack: nothing proved
      // this job cannot succeed.
      console.error("generation_threw", {
        job_id: jobId,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}
