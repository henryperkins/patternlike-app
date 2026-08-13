import type { Env } from "./env.js";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { runReadingScheduler } from "./services/run-reading-scheduler.js";
import { runPrivacyMaintenance } from "./services/privacy-maintenance.js";
import { safeLog } from "./services/safe-log.js";

/** Cron does not enter Hono, so it owns the same direct fail-closed gate as Queue. */
export async function scheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const failure = checkSecureConfig(env);
  if (failure) {
    safeLog({ event: "insecure_configuration", config_code: failure.code });
    return;
  }

  const scheduledAt = new Date(controller.scheduledTime);
  let laneFailure: unknown;
  try {
    const summary = await runReadingScheduler(env, scheduledAt);
    if (summary.repairQuotaExhausted) {
      safeLog({ event: "scheduler_repair_quota_exhausted" });
    }
  } catch (error) {
    laneFailure = error;
  }
  try {
    await runPrivacyMaintenance(env, scheduledAt);
  } catch (error) {
    if (laneFailure === undefined) laneFailure = error;
  }
  if (laneFailure !== undefined) throw laneFailure;
}
