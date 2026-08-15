import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ENCRYPTED_COLUMNS, NESTED_CONTENT_CIPHERTEXT_COLUMNS, UNWRITTEN_ENCRYPTED_COLUMNS } from "./users.js";

/**
 * The tripwire for the tightest constraint in the repository.
 *
 * A new encrypted column that nobody registers in ENCRYPTED_COLUMNS is left
 * under a destroyed key at the next DEK rotation — silently, and only
 * discovered when someone tries to read it. The runtime check in
 * assertNoUnrotatedCiphertext catches stray ciphertext in a KNOWN column; this
 * catches the column itself, by reading the live schema rather than a list
 * somebody remembered to update.
 */
async function encryptedColumnsInSchema(): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL",
  ).all<{ name: string; sql: string }>();

  const found = new Set<string>();
  for (const table of results) {
    // Column definitions only: a REFERENCES clause or a CHECK can mention a
    // column name without declaring one.
    for (const line of table.sql.split("\n")) {
      const match = /^\s{2}([a-z_]+_enc)\s+BLOB/.exec(line);
      if (match) found.add(`${table.name}.${match[1]}`);
    }
  }
  return found;
}

describe("encrypted column registration", () => {
  it("every *_enc column in the schema is registered exactly once", async () => {
    const inSchema = await encryptedColumnsInSchema();

    const rotated = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`));
    const unwritten = new Set(
      UNWRITTEN_ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`),
    );
    const nested = new Set(
      NESTED_CONTENT_CIPHERTEXT_COLUMNS.map((c) => `${c.table}.${c.encColumn}`),
    );

    const overlap = [...rotated].filter((c) => unwritten.has(c) || nested.has(c));
    expect(overlap, "a column cannot be both rotated and unwritten or nested").toEqual([]);

    const unregistered = [...inSchema].filter(
      (c) => !rotated.has(c) && !unwritten.has(c) && !nested.has(c),
    );
    expect(
      unregistered,
      "add these to ENCRYPTED_COLUMNS in apps/api/src/db/users.ts, to " +
        "UNWRITTEN_ENCRYPTED_COLUMNS if nothing writes them yet, or to " +
        "NESTED_CONTENT_CIPHERTEXT_COLUMNS if they sit under a wrapped content key.",
    ).toEqual([]);

    const phantom = [...rotated, ...unwritten, ...nested].filter((c) => !inSchema.has(c));
    expect(phantom, "these are registered but do not exist in the schema").toEqual([]);
  });

  it("nests Pattern document bodies under a wrapped key rather than the user DEK", () => {
    expect(NESTED_CONTENT_CIPHERTEXT_COLUMNS.map((c) => `${c.table}.${c.encColumn}`))
      .toEqual(["pattern_documents.document_enc"]);
    const rotated = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    expect(rotated).toContain("pattern_documents.wrapped_document_key_enc");
    expect(rotated).toContain("pattern_generation_artifact_keys.wrapped_key_enc");
  });

  it("registers the three columns M3 adds", async () => {
    const rotated = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    expect(rotated).toContain("jobs.payload_enc");
    expect(rotated).toContain("daily_readings.reading_enc");
    expect(rotated).toContain("reading_sources.evidence_enc");
  });

  it("rotates context_signals.value_enc, which M5 is about to write", async () => {
    // Moved BEFORE the context compiler acquires its first writer. The other
    // order — write first, register later — leaves whatever was written between
    // the two changes under a destroyed key, and nothing reports it until a
    // reader asks for a value that no longer decrypts.
    const rotated = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    const unwritten = UNWRITTEN_ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    expect(rotated).toContain("context_signals.value_enc");
    expect(unwritten).not.toContain("context_signals.value_enc");
  });

  it("rotates reading_feedback.notes_enc now that feedback writes notes", async () => {
    const rotated = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    const unwritten = UNWRITTEN_ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.encColumn}`);
    expect(rotated).toContain("reading_feedback.notes_enc");
    expect(unwritten).not.toContain("reading_feedback.notes_enc");
  });

  it("every registered column names a real key-version and nonce column", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL",
    ).all<{ name: string; sql: string }>();
    const ddl = new Map(results.map((r) => [r.name, r.sql]));

    for (const col of ENCRYPTED_COLUMNS) {
      const sql = ddl.get(col.table);
      expect(sql, `${col.table} is not in the schema`).toBeDefined();
      for (const name of [col.encColumn, col.keyVersionColumn, col.nonceColumn, col.idColumn]) {
        expect(sql, `${col.table}.${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });

  it("every rotated table can be reached by user_id, or rotation cannot walk it", async () => {
    // rotateUserDek selects and updates `WHERE user_id = ?`. A table without
    // that column would throw at rotation time rather than at review time.
    for (const col of ENCRYPTED_COLUMNS) {
      const probe = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${col.table} WHERE user_id IS NOT NULL`,
      ).first<{ n: number }>();
      expect(probe, `${col.table} has no user_id column`).not.toBeNull();
    }
  });
});
