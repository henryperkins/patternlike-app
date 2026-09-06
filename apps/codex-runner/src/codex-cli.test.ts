import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexChildEnvironment } from "./codex-cli.js";

test("passes only the explicit Codex child environment allowlist", () => {
  assert.deepEqual(buildCodexChildEnvironment({
    HOME: "/var/lib/patternlike-codex-runner",
    PATH: "/usr/local/bin:/usr/bin",
    CODEX_HOME: "/var/lib/patternlike-codex-runner/.codex",
    HTTPS_PROXY: "http://proxy.example.test:8080",
    SSL_CERT_FILE: "/etc/ssl/custom.pem",
    CODEX_RUNNER_TOKEN: "runner-secret",
    PATTERNLIKE_API_ORIGIN: "https://api.example.test",
    SERVICE_AUTH_TOKEN: "service-secret",
    PATTERN_ADMIN_TOKEN: "admin-secret",
    OPENAI_API_KEY: "provider-secret",
    NODE_OPTIONS: "--require=/tmp/inject.cjs",
  }), {
    HOME: "/var/lib/patternlike-codex-runner",
    PATH: "/usr/local/bin:/usr/bin",
    CODEX_HOME: "/var/lib/patternlike-codex-runner/.codex",
    HTTPS_PROXY: "http://proxy.example.test:8080",
    SSL_CERT_FILE: "/etc/ssl/custom.pem",
  });
});
