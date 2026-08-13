import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { mockCalcService } from "./test/mock-calc-service.js";
import { HERMETIC_TEST_BINDINGS } from "./test/hermetic-bindings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const allMigrations = await readD1Migrations(path.resolve(here, "../../db/d1"));
const migrations = allMigrations.slice(0, 2);
if (migrations.length !== 2) {
  throw new Error("M3 compatibility lane requires exactly migrations 0001 and 0002");
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "src/index.ts",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          ...HERMETIC_TEST_BINDINGS,
          TEST_MIGRATIONS: migrations,
          READING_V5_ROLLOUT: "off",
        },
        outboundService: mockCalcService,
      },
    }),
  ],
  test: {
    fileParallelism: false,
    include: ["test/m3-rollout-compat.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
