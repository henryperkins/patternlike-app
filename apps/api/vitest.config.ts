import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { mockCalcService } from "./test/mock-calc-service.js";
import { HERMETIC_TEST_BINDINGS } from "./test/hermetic-bindings.js";

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
        bindings: {
          ...HERMETIC_TEST_BINDINGS,
          TEST_MIGRATIONS: migrations,
        },
        // Every outbound fetch from the Worker — including invokeCalc's POST to
        // CALC_SERVICE_URL — lands here instead of the network, so tests are
        // hermetic and the calculation result is deterministic on its input.
        outboundService: mockCalcService,
      },
    }),
  ],
  test: {
    // The pool's D1 binding is shared while these integration suites explicitly
    // clear tables in their setup. Running files concurrently lets one suite
    // erase another suite's fixture between a request and its assertion.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
