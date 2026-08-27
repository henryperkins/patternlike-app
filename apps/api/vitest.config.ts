import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { mockCalcService } from "./test/mock-calc-service.js";
import { HERMETIC_TEST_BINDINGS } from "./test/hermetic-bindings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_ONTOLOGY_SIGNER_NAME = "patternlike-ontology-signer";
const TEST_ONTOLOGY_SIGNER_KEY_ID = "ontology-test-ed25519";

function toBase64Url(value: ArrayBuffer): string {
  return Buffer.from(value).toString("base64url");
}

const testSignerKeys = (await webcrypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
)) as webcrypto.CryptoKeyPair;
const testSignerPrivateKey = toBase64Url(
  await webcrypto.subtle.exportKey("pkcs8", testSignerKeys.privateKey),
);
const testSignerPublicKey = toBase64Url(
  await webcrypto.subtle.exportKey("raw", testSignerKeys.publicKey),
);
const signerBuild = await build({
  entryPoints: [
    path.resolve(here, "../ontology-signer/src/index.ts"),
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["cloudflare:workers"],
  write: false,
});
const signerScript = signerBuild.outputFiles[0]?.text;
if (!signerScript) throw new Error("ontology signer test bundle missing");

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
      // Workers AI has no local simulator. Keep this hermetic suite from
      // opening an authenticated remote proxy for the configured `AI` binding.
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // The application DB proves a clean apply. The second binding is used
        // only by apply-migrations.ts to exercise forward upgrades over live
        // post-0011 rows without making every API test inherit those fixtures.
        d1Databases: {
          MIGRATION_UPGRADE_DB: "ontology-pipeline-migration-upgrade-test",
        },
        bindings: {
          ...HERMETIC_TEST_BINDINGS,
          TEST_MIGRATIONS: migrations,
          TEST_ONTOLOGY_SIGNER_KEY_ID,
          TEST_ONTOLOGY_SIGNER_PUBLIC_KEY: testSignerPublicKey,
        },
        serviceBindings: {
          ONTOLOGY_SIGNER: TEST_ONTOLOGY_SIGNER_NAME,
        },
        workers: [
          {
            name: TEST_ONTOLOGY_SIGNER_NAME,
            modules: [
              {
                type: "ESModule",
                path: "ontology-signer.mjs",
                contents: signerScript,
              },
            ],
            bindings: {
              PATTERN_ONTOLOGY_SIGNING_KEY: JSON.stringify({
                version: 1,
                keys: {
                  [TEST_ONTOLOGY_SIGNER_KEY_ID]: {
                    alg: "Ed25519",
                    private_key_pkcs8: testSignerPrivateKey,
                  },
                },
              }),
            },
          },
        ],
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
