import type { Env } from "../env.js";
import { exportObjectKey } from "./export-envelope.js";

export interface DeletionArtifactFamily {
  family: string;
  prefix: `${string}/`;
  collectKeys: (env: Env, userId: string) => Promise<string[]>;
}

/** User-owned R2 families must be registered here before deletion may ship. */
export const DELETION_ARTIFACT_FAMILIES: readonly DeletionArtifactFamily[] = [
  {
    family: "account_exports",
    prefix: "exports/",
    async collectKeys(env, userId) {
      const { results } = await env.DB.prepare(
        "SELECT id FROM export_requests WHERE user_id = ? ORDER BY id",
      )
        .bind(userId)
        .all<{ id: string }>();
      return results.map((row) => exportObjectKey(row.id));
    },
  },
];

export async function collectDeletionArtifactKeys(
  env: Env,
  userId: string,
): Promise<string[]> {
  const keys = new Set<string>();
  for (const family of DELETION_ARTIFACT_FAMILIES) {
    for (const key of await family.collectKeys(env, userId)) {
      if (!key.startsWith(family.prefix)) {
        throw new Error(`Deletion artifact escaped ${family.family} prefix`);
      }
      keys.add(key);
    }
  }
  return [...keys].sort();
}

/**
 * Directly user-owned tables classified for account erasure.
 *
 * The order is dependency-safe: children precede parents. `users`,
 * `user_keys`, and `deletion_requests` are retained tombstone/proof state and
 * are therefore classified separately below rather than silently omitted.
 */
export const DELETED_USER_TABLES = [
  "reading_sources",
  "reading_feedback",
  "daily_readings",
  "cycle_passes",
  "cycle_instances",
  "cycle_scan_receipts",
  "time_travel_daily_usage",
  "timezone_changes",
  "natal_feature_sets",
  "natal_features",
  "chart_snapshots",
  "birth_profiles",
  "context_signals",
  "context_source_permissions",
  "connector_accounts",
  "device_tokens",
  "sessions",
  "identities",
  "consents",
  "export_requests",
] as const;

export const RETAINED_USER_TABLES = [
  "users",
  "user_keys",
  "deletion_requests",
] as const;

/**
 * Portability classification for every directly user-owned table.
 *
 * Deletion coverage alone does not answer the question a data-subject request
 * asks: it says the row goes away, not whether the reader was ever entitled to
 * a copy of it. Splitting the classification makes "this is derived cache, not
 * the reader's data" an explicit, reviewed claim per table rather than an
 * inference from whichever tables `buildAccountExport` happens to SELECT.
 *
 * A table listed as portable must be reachable through a section of M6's
 * frozen closed `accountExport` document; that schema cannot grow top-level
 * sections, so a new portable table has to project into an existing one.
 */
export const PORTABLE_USER_TABLES = [
  "users",
  "birth_profiles",
  "chart_snapshots",
  "timezone_changes",
  "consents",
  "context_source_permissions",
  "context_signals",
  "daily_readings",
] as const;

export const NON_PORTABLE_USER_TABLES = [
  /** Prose evidence links; the reading itself is the portable artifact. */
  "reading_sources",
  /** Operational signal, recomputable from nothing the reader authored. */
  "reading_feedback",
  /** Deterministic calculation output, recomputable from the chart. */
  "cycle_passes",
  "cycle_instances",
  /** M4: deterministic derived Pattern facts and their completion receipt. */
  "natal_features",
  "natal_feature_sets",
  /** M4: bounded recomputable Time Travel calculation cache. */
  "cycle_scan_receipts",
  /** M4: operational spend ledger; no selected date or natal fact. */
  "time_travel_daily_usage",
  /** Credentials, transport, and delivery state — not reader content. */
  "connector_accounts",
  "device_tokens",
  "sessions",
  "identities",
  "user_keys",
  /** Proof-of-request state about the export/deletion mechanism itself. */
  "export_requests",
  "deletion_requests",
] as const;

export const JOBS_TABLE = "jobs" as const;
export const AUDIT_TABLE = "audit_events" as const;

export async function deleteUserRows(
  env: Env,
  userId: string,
  deletionJobId: string,
): Promise<void> {
  // Break the daily-reading -> jobs parent link before deleting either side.
  await env.DB.prepare(
    "UPDATE daily_readings SET active_generation_job_id = NULL WHERE user_id = ?",
  )
    .bind(userId)
    .run();

  for (const table of DELETED_USER_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .run();
  }

  await env.DB.prepare(
    "DELETE FROM jobs WHERE user_id = ? AND id != ?",
  )
    .bind(userId, deletionJobId)
    .run();
  await env.DB.prepare(
    "DELETE FROM audit_events WHERE actor_id = ? OR resource_id = ?",
  )
    .bind(userId, userId)
    .run();
}
