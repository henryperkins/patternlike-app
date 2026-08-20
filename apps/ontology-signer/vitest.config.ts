import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "src/index.ts",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          PATTERN_ONTOLOGY_SIGNING_KEY: "{}",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
