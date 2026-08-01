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
    }
  }
}

export {};
