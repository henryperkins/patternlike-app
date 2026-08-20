import { applyD1Migrations, env } from "cloudflare:test";

// Historical compatibility lanes intentionally supply a schema prefix. Apply
// that exact slice without invoking the full forward-migration upgrade checks.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
