import type { Env } from "./env.js";
import { checkSecureConfig } from "./middleware/config-guard.js";
import { runReadingScheduler } from "./services/run-reading-scheduler.js";
import { runPrivacyMaintenance } from "./services/privacy-maintenance.js";
import { sweepPatternJobs } from "./services/pattern-sweep.js";
import { safeLog } from "./services/safe-log.js";
import { releaseExpiredOntologyPipelineLeases } from "./db/ontology-pipeline.js";
import {
  dispatchUndispatchedOntologyPipelineRuns,
  recoverStaleOntologyPipelineDispatches,
} from "./services/ontology-pipeline-enqueue.js";
import { sweepExpiredOntologyPipelineArtifacts } from "./services/ontology-pipeline-artifacts.js";
import { maintainCodexProviderJobs } from "./services/codex-provider-maintenance.js";

export const ONTOLOGY_PIPELINE_MAINTENANCE_CRON =
  "7,22,37,52 * * * *";

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
  if (controller.cron === ONTOLOGY_PIPELINE_MAINTENANCE_CRON) {
    await runOntologyPipelineMaintenance(env, scheduledAt);
    return;
  }
  await runIncumbentMaintenance(env, scheduledAt);
}

async function runIncumbentMaintenance(
  env: Env,
  scheduledAt: Date,
): Promise<void> {
  let laneFailure: unknown;
  try {
    await maintainCodexProviderJobs(env, scheduledAt);
  } catch (error) {
    if (laneFailure === undefined) laneFailure = error;
  }
  try {
    const summary = await runReadingScheduler(env, scheduledAt);
    if (summary.repairQuotaExhausted) {
      safeLog({ event: "scheduler_repair_quota_exhausted" });
    }
  } catch (error) {
    if (laneFailure === undefined) laneFailure = error;
  }
  try {
    await runPrivacyMaintenance(env, scheduledAt);
  } catch (error) {
    if (laneFailure === undefined) laneFailure = error;
  }
  try {
    await sweepPatternJobs(env, scheduledAt);
  } catch (error) {
    if (laneFailure === undefined) laneFailure = error;
  }
  if (laneFailure !== undefined) throw laneFailure;
}

async function runOntologyPipelineMaintenance(
  env: Env,
  scheduledAt: Date,
): Promise<void> {
  let laneFailure: unknown;
  try {
    await maintainCodexProviderJobs(env, scheduledAt);
  } catch {
    laneFailure = new Error("codex_provider_maintenance_failed");
  }
  try {
    await releaseExpiredOntologyPipelineLeases(env, scheduledAt);
  } catch {
    if (laneFailure === undefined) {
      laneFailure = new Error("ontology_pipeline_lease_recovery_failed");
    }
  }
  try {
    await recoverStaleOntologyPipelineDispatches(env, scheduledAt);
  } catch {
    if (laneFailure === undefined) {
      laneFailure = new Error("ontology_pipeline_dispatch_recovery_failed");
    }
  }
  try {
    await dispatchUndispatchedOntologyPipelineRuns(env, scheduledAt);
  } catch {
    if (laneFailure === undefined) {
      laneFailure = new Error("ontology_pipeline_outbox_recovery_failed");
    }
  }
  try {
    await sweepExpiredOntologyPipelineArtifacts(env, scheduledAt);
  } catch {
    if (laneFailure === undefined) {
      laneFailure = new Error("ontology_pipeline_artifact_cleanup_failed");
    }
  }
  if (laneFailure !== undefined) throw laneFailure;
}
