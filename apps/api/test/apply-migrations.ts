import { applyD1Migrations, env } from "cloudflare:test";

// Applies db/d1/0001_m0_core.sql to the test D1 once per test file. This runs
// before per-test storage isolation begins, so the schema is visible to every
// test while each test's own writes are rolled back afterwards.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
