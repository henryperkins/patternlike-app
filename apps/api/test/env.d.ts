import type { D1Migration } from "cloudflare:test";
import type { Env as AppEnv } from "../src/env.js";

/**
 * `cloudflare:test` types its `env` as the global `Cloudflare.Env`, so the
 * Worker's own bindings plus the test-only migration payload are declared here.
 */
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      /** Injected by vitest.config.ts via readD1Migrations(). */
      TEST_MIGRATIONS: D1Migration[];
      /** Isolated D1 binding for populated forward-migration probes. */
      MIGRATION_UPGRADE_DB: D1Database;
      /** Reference D1 that receives the real migration chain once per run. */
      SCHEMA_REFERENCE_DB: D1Database;
      /** Final-schema dump injected by vitest.config.ts (test/schema-dump.sql). */
      TEST_SCHEMA_DUMP: string;
      /** Public half of the ephemeral auxiliary signer test key. */
      TEST_ONTOLOGY_SIGNER_KEY_ID: string;
      TEST_ONTOLOGY_SIGNER_PUBLIC_KEY: string;
    }
  }
}

export {};
