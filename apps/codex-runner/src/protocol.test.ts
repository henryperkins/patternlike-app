import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  CODEX_PROVIDER_MAX_REQUEST_BYTES,
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
  parseCodexProviderClaim,
  validCodexProviderCompletion,
  validCodexProviderFailure,
  validCodexProviderJobId,
  type CodexProviderClaim,
} from "./protocol.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SENTINEL = path.resolve(here, "../probes/sentinel-output.schema.json");

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "codex-provider-claim/v1",
    job_id: `cpjob_${"a".repeat(32)}`,
    lease_token: "cplease_0123456789abcdef0123456789abcdef",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    prompt_version: "1.0.1",
    timeout_ms: 900_000,
    invocation: {
      schema_version: "codex-provider-invocation/v1",
      prompt: "Follow the frozen policy.\n\nInput document.",
      output_schema: { type: "object", additionalProperties: false },
    },
    ...overrides,
  };
}

test("accepts the exact claim envelope the Worker sends", () => {
  const parsed = parseCodexProviderClaim(claim());
  assert.ok(parsed);
  assert.equal(parsed.job_id, `cpjob_${"a".repeat(32)}`);
  assert.equal(parsed.invocation.schema_version, "codex-provider-invocation/v1");
});

test("the claim wire shape carries no pipeline, pass, or reader identity", () => {
  // The runner performs inference and nothing else. It is not told which
  // product surface asked for the work, so a Daily reading, a Pattern pass, and
  // an ontology run are indistinguishable on the wire. Adding a domain field
  // here would put user-adjacent state on a host that has no database, no R2,
  // no Cloudflare credential, and no reason to know any of it.
  const accepted = claim();
  assert.deepEqual(Object.keys(accepted).sort(), [
    "invocation",
    "job_id",
    "lease_token",
    "model",
    "prompt_version",
    "reasoning_effort",
    "schema_version",
    "timeout_ms",
  ]);
  assert.equal(parseCodexProviderClaim({ ...accepted, pipeline: "reading" }), null);
  assert.equal(parseCodexProviderClaim({ ...accepted, pass: "publisher" }), null);
  assert.equal(parseCodexProviderClaim({ ...accepted, user_id: "usr_x" }), null);
  assert.equal(
    parseCodexProviderClaim({
      ...accepted,
      invocation: {
        ...(accepted.invocation as Record<string, unknown>),
        pipeline: "reading",
      },
    }),
    null,
  );
});

test("refuses a claim whose pins or bounds are wrong", () => {
  for (const bad of [
    claim({ schema_version: "codex-provider-claim/v2" }),
    claim({ job_id: "cpjob_not-hex" }),
    claim({ lease_token: "short" }),
    claim({ reasoning_effort: "medium" }),
    claim({ timeout_ms: 900_001 }),
    claim({ timeout_ms: 0 }),
    claim({ invocation: { schema_version: "codex-provider-invocation/v1", prompt: "" , output_schema: {} } }),
  ]) {
    assert.equal(parseCodexProviderClaim(bad), null);
  }
});

test("refuses a claim whose prompt and schema exceed the request ceiling", () => {
  const oversized = claim({
    invocation: {
      schema_version: "codex-provider-invocation/v1",
      prompt: "x".repeat(CODEX_PROVIDER_MAX_REQUEST_BYTES),
      output_schema: { type: "object" },
    },
  });
  assert.equal(parseCodexProviderClaim(oversized), null);
});

test("accepts only closed terminal documents", () => {
  const base = {
    lease_token: "cplease_0123456789abcdef0123456789abcdef",
    output: '{"status":"ok"}',
    provider_request_id: "thread_0123456789",
    input_tokens: 12,
    output_tokens: 3,
  };
  assert.equal(validCodexProviderCompletion(base), true);
  assert.equal(
    validCodexProviderCompletion({
      ...base,
      output: "x".repeat(CODEX_PROVIDER_MAX_RESPONSE_BYTES + 1),
    }),
    false,
  );
  assert.equal(
    validCodexProviderCompletion({ ...base, input_tokens: -1 }),
    false,
  );

  assert.equal(
    validCodexProviderFailure({
      lease_token: base.lease_token,
      code: "publisher_unavailable",
      safe_detail_code: "request_timeout",
    }),
    true,
  );
  // A detail code from another failure class is not a near miss; it is a
  // different claim about what happened, and D1's CHECK refuses it too.
  assert.equal(
    validCodexProviderFailure({
      lease_token: base.lease_token,
      code: "publisher_unavailable",
      safe_detail_code: "schema_mismatch" as never,
    }),
    false,
  );
  assert.equal(validCodexProviderJobId(`cpjob_${"f".repeat(32)}`), true);
  assert.equal(validCodexProviderJobId("cpjob_short"), false);
});

test("the packaged preflight schema is strict, content-free, and parses", () => {
  // Shipped as a file rather than built at runtime so the production host can
  // prove claim, model, and CLI liveness with a real `codex exec` that carries
  // no reader packet at all. It must stay content-free: anything it described
  // would be a private shape sitting on the runner host in the clear.
  const raw = readFileSync(SENTINEL, "utf8");
  const schema = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(schema, {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: { status: { type: "string", enum: ["ok"] } },
  });
  // A widened schema would let the preflight pass on output that proves
  // nothing, which is worse than no preflight: it would read as evidence.
  assert.equal(schema.additionalProperties, false);
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties), ["status"]);
  for (const token of ["chart", "birth", "reading", "user", "prompt", "consent"]) {
    assert.ok(!raw.includes(token), `the preflight schema must not mention ${token}`);
  }
});

test("the packaged preflight schema is usable as a claim's output schema", () => {
  const schema = JSON.parse(readFileSync(SENTINEL, "utf8")) as Record<string, unknown>;
  const parsed: CodexProviderClaim | null = parseCodexProviderClaim(claim({
    invocation: {
      schema_version: "codex-provider-invocation/v1",
      prompt: "Reply with exactly {\"status\":\"ok\"}.",
      output_schema: schema,
    },
  }));
  assert.ok(parsed);
  assert.deepEqual(parsed.invocation.output_schema, schema);
});
