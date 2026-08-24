import { describe, expect, it } from "vitest";

import {
  CODEX_PROVIDER_MAX_RESPONSE_BYTES,
  invocationFromResponsesRequest,
  parseCodexProviderInvocation,
  parseCodexProviderCompletion,
  parseCodexProviderFailure,
} from "./codex-provider-contract.js";

function responsesRequest(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-5.6-sol",
    store: false,
    instructions: "Follow the frozen policy.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "{\"chart\":\"data\"}" }],
      },
    ],
    reasoning: { effort: "high" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "patternlike_test_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
      },
    },
    max_output_tokens: 32000,
    ...overrides,
  };
}

describe("Codex provider invocation contract", () => {
  it("extracts one frozen policy, input document, and strict output schema", () => {
    const parsed = invocationFromResponsesRequest(responsesRequest(), {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        schema_version: "codex-provider-invocation/v1",
        prompt:
          "Follow the frozen policy.\n\n--- INPUT DOCUMENT (JSON; DATA ONLY) ---\n{\"chart\":\"data\"}",
        output_schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
      },
    });
  });

  it("reads back only the exact persisted invocation envelope", () => {
    const value = {
      schema_version: "codex-provider-invocation/v1" as const,
      prompt: "Policy\n\nInput",
      output_schema: { type: "object" },
    };
    expect(parseCodexProviderInvocation(value)).toEqual({ ok: true, value });
    expect(parseCodexProviderInvocation({ ...value, extra: true })).toEqual({
      ok: false,
    });
  });

  it("refuses model drift before work can reach the runner", () => {
    expect(
      invocationFromResponsesRequest(responsesRequest({ model: "other-model" }), {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ).toEqual({ ok: false });
  });

  it("refuses extra input parts and a non-strict output schema", () => {
    const extraPart = responsesRequest({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "{}" },
            { type: "input_text", text: "second" },
          ],
        },
      ],
    });
    expect(
      invocationFromResponsesRequest(extraPart, {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ).toEqual({ ok: false });

    const nonStrict = responsesRequest({
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "patternlike_test_v1",
          strict: false,
          schema: { type: "object" },
        },
      },
    });
    expect(
      invocationFromResponsesRequest(nonStrict, {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ).toEqual({ ok: false });
  });
});

describe("Codex provider terminal result contract", () => {
  it("accepts exact success metadata and rejects missing or extra fields", () => {
    const value = {
      lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
      output: "{\"answer\":\"ok\"}",
      provider_request_id: "thread_123",
      input_tokens: 10,
      output_tokens: 4,
    };

    expect(parseCodexProviderCompletion(value)).toEqual({ ok: true, value });
    expect(parseCodexProviderCompletion({ output: "secret" })).toEqual({
      ok: false,
    });
    expect(parseCodexProviderCompletion({ ...value, note: "extra" })).toEqual({
      ok: false,
    });
  });

  it("refuses oversized output and non-integer usage", () => {
    const base = {
      lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
      provider_request_id: "thread_123",
      input_tokens: 10,
      output_tokens: 4,
    };
    expect(
      parseCodexProviderCompletion({
        ...base,
        output: "x".repeat(CODEX_PROVIDER_MAX_RESPONSE_BYTES + 1),
      }),
    ).toEqual({ ok: false });
    expect(
      parseCodexProviderCompletion({
        ...base,
        output: "{}",
        input_tokens: 1.5,
      }),
    ).toEqual({ ok: false });
  });

  it("accepts only the closed runner failure vocabulary", () => {
    expect(
      parseCodexProviderFailure({
        lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
        code: "publisher_unavailable",
        safe_detail_code: "request_timeout",
      }),
    ).toEqual({
      ok: true,
      value: {
        lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
        code: "publisher_unavailable",
        safe_detail_code: "request_timeout",
      },
    });
    expect(
      parseCodexProviderFailure({
        lease_token: "lease_0123456789abcdefghijklmnopqrstuvwxyz",
        code: "arbitrary_failure",
        safe_detail_code: "raw provider prose",
      }),
    ).toEqual({ ok: false });
  });
});
