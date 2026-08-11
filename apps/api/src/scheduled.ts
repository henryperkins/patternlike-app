import type { Env } from "./env.js";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { runReadingScheduler } from "./services/run-reading-scheduler.js";
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

  const summary = await runReadingScheduler(
    env,
    new Date(controller.scheduledTime),
  );
  if (summary.repairQuotaExhausted) {
    safeLog({ event: "scheduler_repair_quota_exhausted" });
  }
}
