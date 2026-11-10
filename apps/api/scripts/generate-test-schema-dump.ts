/**
 * Generates `test/schema-dump.sql`: the final D1 schema produced by applying
 * every migration in `db/d1/`, as one statement per line.
 *
 * The worker test setup (`test/apply-migrations.ts`) runs before every test
 * file against a fresh database. Applying the 34-migration chain each time
 * cost ~2.5s per file; executing this 221-statement dump costs a fraction of
 * that. Equivalence between the dump and the real migration chain is proven
 * once per suite run by `src/db/migrations-upgrade.test.ts`, which applies
 * the genuine migrations to a reference database and compares schemas.
 *
 * Usage:
 *   tsx scripts/generate-test-schema-dump.ts --write   # regenerate the dump
 *   tsx scripts/generate-test-schema-dump.ts --check   # fail if stale
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../db/d1");
const dumpPath = path.resolve(here, "../test/schema-dump.sql");

/** Serializes a SQLite value from node:sqlite into a SQL literal. */
function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString("hex")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Removes `--` comments outside quoted text, then collapses whitespace. */
function collapseStatement(sql: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += quote;
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

function buildDump(): string {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  const rows = db.prepare(
    `SELECT sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1
                        WHEN 'trigger' THEN 2 ELSE 3 END, name`,
  ).all() as { sql: string }[];
  // The chain also seeds singleton rows on an empty database (today:
  // `pattern_ontology_pointer`). A DDL-only dump would silently lose them,
  // so emit whatever data the chain itself leaves behind.
  const tables = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'
     ORDER BY name`,
  ).all() as { name: string }[];
  for (const { name } of tables) {
    const data = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    for (const row of data) {
      const columns = Object.keys(row);
      const values = columns.map((column) => sqlLiteral(row[column]));
      rows.push({
        sql: `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${values.join(", ")})`,
      });
    }
  }
  // One statement per line, no semicolons: that is the input grammar of
  // D1's `exec()`, which the test setup uses to apply the dump. SQL comments
  // must be stripped before collapsing whitespace: a `--` comment would
  // otherwise swallow the remainder of its (now single) line.
  return rows.map((row) => collapseStatement(row.sql)).join("\n") + "\n";
}

const mode = process.argv[2];
const dump = buildDump();
if (mode === "--write") {
  writeFileSync(dumpPath, dump);
  console.log(`wrote ${dumpPath} (${dump.trim().split("\n").length} statements)`);
} else if (mode === "--check") {
  const current = readFileSync(dumpPath, "utf8");
  if (current !== dump) {
    console.error("test/schema-dump.sql is stale; run: npm run generate:test-schema -w @patternlike/api");
    process.exit(1);
  }
  console.log("test/schema-dump.sql is current");
} else {
  console.error("usage: generate-test-schema-dump.ts --write|--check");
  process.exit(2);
}
