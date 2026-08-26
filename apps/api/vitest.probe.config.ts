// TEMPORARY measurement harness — delete after use.
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
const REMOTE = process.env.PROBE_REMOTE !== "0";
const SETUP = process.env.PROBE_SETUP === "batch" ? "./test/probe-setup-batch.ts" : process.env.PROBE_SETUP === "none" ? "./test/probe-setup-none.ts" : process.env.PROBE_SETUP === "min"
  ? "./test/probe-setup-min.ts"
  : "./test/apply-migrations.ts";

function toBase64Url(value: ArrayBuffer): string {
  return Buffer.from(value).toString("base64url");
}
const testSignerKeys = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
const testSignerPrivateKey = toBase64Url(await webcrypto.subtle.exportKey("pkcs8", testSignerKeys.privateKey));
const testSignerPublicKey = toBase64Url(await webcrypto.subtle.exportKey("raw", testSignerKeys.publicKey));
const signerBuild = await build({
  entryPoints: [path.resolve(here, "../ontology-signer/src/index.ts")],
  bundle: true, format: "esm", platform: "browser", target: "es2022",
  external: ["cloudflare:workers"], write: false,
});
const signerScript = signerBuild.outputFiles[0]!.text;
const migrations = await readD1Migrations(path.resolve(here, "../../db/d1"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "src/index.ts",
      remoteBindings: REMOTE,
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        d1Databases: { MIGRATION_UPGRADE_DB: "ontology-pipeline-migration-upgrade-test" },
        bindings: {
          ...HERMETIC_TEST_BINDINGS,
          TEST_MIGRATIONS: migrations,
          TEST_ONTOLOGY_SIGNER_KEY_ID,
          TEST_ONTOLOGY_SIGNER_PUBLIC_KEY: testSignerPublicKey,
        },
        serviceBindings: { ONTOLOGY_SIGNER: TEST_ONTOLOGY_SIGNER_NAME },
        workers: [{
          name: TEST_ONTOLOGY_SIGNER_NAME,
          modules: [{ type: "ESModule", path: "ontology-signer.mjs", contents: signerScript }],
          bindings: { PATTERN_ONTOLOGY_SIGNING_KEY: JSON.stringify({ version: 1, keys: { [TEST_ONTOLOGY_SIGNER_KEY_ID]: { alg: "Ed25519", private_key_pkcs8: testSignerPrivateKey } } }) },
        }],
        outboundService: mockCalcService,
      },
    }),
  ],
  test: {
    fileParallelism: false,
    include: (process.env.PROBE_FILES ?? "").split(",").filter(Boolean),
    setupFiles: [SETUP],
  },
});
