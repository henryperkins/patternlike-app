import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  AUDIT_TABLE,
  DELETION_ARTIFACT_FAMILIES,
  DELETED_USER_TABLES,
  JOBS_TABLE,
  NON_PORTABLE_USER_TABLES,
  PORTABLE_USER_TABLES,
  RETAINED_USER_TABLES,
} from "./deletion-manifest.js";

async function schemaTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'
     ORDER BY name`,
  ).all<{ name: string }>();
  return results.map((row) => row.name);
}

describe("account-deletion manifest", () => {
  it("registers each user artifact family behind an internal safe prefix", () => {
    expect(DELETION_ARTIFACT_FAMILIES.map(({ family, prefix }) => ({ family, prefix })))
      .toEqual([{ family: "account_exports", prefix: "exports/" }]);
    for (const { prefix } of DELETION_ARTIFACT_FAMILIES) {
      expect(prefix).toMatch(/^[a-z][a-z0-9-]*\/$/);
      expect(prefix).not.toContain("..");
    }
  });

  it("classifies every table with a direct user_id owner", async () => {
    const owned = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`)
        .all<{ name: string }>();
      if (results.some((column) => column.name === "user_id")) owned.add(table);
    }

    const classified = new Set<string>([
      ...DELETED_USER_TABLES,
      ...RETAINED_USER_TABLES,
      JOBS_TABLE,
    ]);
    expect(
      [...owned].filter((table) => !classified.has(table)),
      "A new directly user-owned table must be explicitly deleted or retained.",
    ).toEqual([]);
    expect(
      [...classified].filter((table) => table !== "users" && !owned.has(table)),
      "The deletion manifest names a table that is no longer directly user-owned.",
    ).toEqual([]);
  });

  it("classifies every table whose foreign keys point at users", async () => {
    const directChildren = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA foreign_key_list(${table})`)
        .all<{ table: string }>();
      if (results.some((foreignKey) => foreignKey.table === "users")) {
        directChildren.add(table);
      }
    }
    const classified = new Set<string>([
      ...DELETED_USER_TABLES,
      ...RETAINED_USER_TABLES,
      JOBS_TABLE,
    ]);
    expect(
      [...directChildren].filter((table) => !classified.has(table)),
      "A new users foreign-key child must be classified for account deletion.",
    ).toEqual([]);
  });

  it("classifies every directly user-owned table as portable or non-portable", async () => {
    const owned = new Set<string>();
    for (const table of await schemaTables()) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`)
        .all<{ name: string }>();
      if (results.some((column) => column.name === "user_id" || column.name === "id" && table === "users")) {
        owned.add(table);
      }
    }
    owned.delete(JOBS_TABLE);
    owned.delete(AUDIT_TABLE);

    const portable = new Set<string>(PORTABLE_USER_TABLES);
    const nonPortable = new Set<string>(NON_PORTABLE_USER_TABLES);
    expect(
      [...owned].filter((table) => !portable.has(table) && !nonPortable.has(table)),
      "A new user-owned table must be explicitly portable or explicitly non-portable.",
    ).toEqual([]);
    expect(
      [...portable].filter((table) => nonPortable.has(table)),
      "A table cannot be both portable and non-portable.",
    ).toEqual([]);
    expect(
      [...portable, ...nonPortable].filter((table) => !owned.has(table)),
      "The portability manifest names a table that no longer exists.",
    ).toEqual([]);
  });

  it("keeps the M4 derived caches non-portable and deleted with the account", () => {
    for (const table of ["natal_feature_sets", "cycle_scan_receipts", "time_travel_daily_usage"] as const) {
      expect(NON_PORTABLE_USER_TABLES).toContain(table);
      expect(PORTABLE_USER_TABLES).not.toContain(table as never);
      expect(DELETED_USER_TABLES).toContain(table);
    }
  });

  it("keeps payload-free audit proof in its explicit special class", async () => {
    expect(AUDIT_TABLE).toBe("audit_events");
    expect(DELETED_USER_TABLES).not.toContain(AUDIT_TABLE as never);
    expect(RETAINED_USER_TABLES).not.toContain(AUDIT_TABLE as never);
  });
});
