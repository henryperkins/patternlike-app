#!/usr/bin/env node
/**
 * Create apps/api/.dev.vars with local-only Codex runner settings.
 *
 * Committed configuration declares PATTERN_PUBLISHER = "codex", and the config
 * guard answers every /v1 request with 503 configuration_error unless
 * CODEX_RUNNER_TOKEN and CODEX_PROVIDER_ARTIFACT_KEYRING are set, in development
 * too. apps/api/wrangler.toml leaves both to .dev.vars so that no token is ever
 * committed. The values written here are random, in the shapes the Worker
 * accepts (a 32-512 character runner token; a version-1 keyring holding one
 * 32-byte base64url key), and authorize nothing beyond this checkout's local
 * Worker.
 *
 * An existing file is never modified, because it may hold a developer's own
 * values. Delete it first to regenerate.
 *
 * Usage:
 *   node scripts/dev/write-dev-vars.mjs
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const target = new URL("../../apps/api/.dev.vars", import.meta.url);
const keyring = {
  version: 1,
  keys: { "local-dev": randomBytes(32).toString("base64url") },
};
const contents = [
  `CODEX_RUNNER_TOKEN=runner_${randomBytes(24).toString("hex")}`,
  `CODEX_PROVIDER_ARTIFACT_KEYRING=${JSON.stringify(keyring)}`,
  "",
].join("\n");

try {
  writeFileSync(target, contents, { flag: "wx", mode: 0o600 });
  console.log("wrote apps/api/.dev.vars with local-only Codex runner settings");
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  console.log("apps/api/.dev.vars already exists; left unchanged");
}
