import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { mockCalcService } from "./test/mock-calc-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Read the D1 schema in Node, hand it to the tests as a binding, and apply it in
// a setup file. Setup runs outside per-test storage isolation, so the schema
// persists across tests while every test's writes roll back.
const migrations = await readD1Migrations(path.resolve(here, "../../db/d1"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Runs in the same isolate as the tests, so `exports.default.fetch()`
      // drives the real Hono app with real bindings.
      main: "src/index.ts",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
        // Every outbound fetch from the Worker — including invokeCalc's POST to
        // CALC_SERVICE_URL — lands here instead of the network, so tests are
        // hermetic and the calculation result is deterministic on its input.
        outboundService: mockCalcService,
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
