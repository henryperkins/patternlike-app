import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { contentHash, type ReadingGenerationRequest } from "@patternlike/shared";
import {
  OPENAI_MOCK_AUTH_FAILED,
  OPENAI_MOCK_ECHO_WRONG_DATE,
  OPENAI_MOCK_FORBIDDEN,
  OPENAI_MOCK_INVALID_JSON,
  OPENAI_MOCK_INCOMPLETE_MAX_OUTPUT,
  OPENAI_MOCK_MODEL_MISSING,
  OPENAI_MOCK_NETWORK_ERROR,
  OPENAI_MOCK_NO_TEXT,
  OPENAI_MOCK_RATE_LIMITED,
  OPENAI_MOCK_REFUSAL,
  OPENAI_MOCK_SERVER_ERROR,
  OPENAI_MOCK_TIMEOUT,
  OPENAI_MOCK_TWO_TEXTS,
  OPENAI_MOCK_WRONG_SHAPE,
} from "../../test/mock-calc-service.js";
import { createOpenAiReadingPublisher } from "./openai-reading-publisher.js";
import { READING_PROMPT_VERSION } from "./reading-prompt.js";
import {
  OPENAI_READING_MAX_OUTPUT_TOKENS,
  OPENAI_READING_MODEL,
  READING_CONTEXT_MAX_BYTES,
  type PublisherConfigPin,
} from "./reading-publisher.js";

function pin(model = OPENAI_READING_MODEL): PublisherConfigPin {
  return {
    provider: "openai",
    model,
    reasoning_effort: "high",
    prompt_version: READING_PROMPT_VERSION,
    output_schema: "daily-reading-v5",
    selection_policy_version: "1.0.0",
    validation_policy_version: "1.0.0",
    max_output_tokens: OPENAI_READING_MAX_OUTPUT_TOKENS,
    context_max_bytes: READING_CONTEXT_MAX_BYTES,
  };
}

function request(): ReadingGenerationRequest {
  return {
    schema_version: "0.5.0",
    prompt_version: READING_PROMPT_VERSION,
    selection_policy_version: "1.0.0",
    output_schema: "daily-reading-v5",
    local_date: "2026-07-30",
    locale: "en-US",
    birth_time_accuracy: "exact",
    suppressed_features: [],
    domain_preference: null,
    facts: [
      {
        fact_id: `cyc_${"a".repeat(32)}`,
        fact_class: "cycle_instance",
        scope: "personalized",
        lane_rank: 1,
        label: "Saturn square your Sun, building",
        attributes: {
          bodies: ["saturn", "sun"],
          aspect: "square",
          signs: [],
          houses: [],
          degrees: [0.42],
          timestamps: [],
          dates: ["2026-08-02"],
        },
      },
      {
        fact_id: `dsf_${"b".repeat(32)}`,
        fact_class: "lunar_phase",
        scope: "collective",
        lane_rank: 3,
        label: "Waxing gibbous Moon",
        attributes: {
          bodies: ["moon", "sun"],
          lunar_phase: "waxing_gibbous",
          signs: [],
          houses: [],
          degrees: [],
          timestamps: [],
          dates: [],
        },
      },
    ],
    context: [],
    prior_readings: [],
    composition: {
      allowed_paragraph_roles: ["supporting_theme", "collective_context"],
      min_paragraphs: 1,
      max_paragraphs: 2,
      headline_max_chars: 60,
      lead_max_chars: 600,
      paragraph_max_chars: 600,
      reflection_max_chars: 240,
      uncertainty_note_required: false,
    },
  };
}

function publisher(apiKey = "sk-test-key") {
  return createOpenAiReadingPublisher({ ...env, OPENAI_API_KEY: apiKey });
}

async function publish(model: string, timeoutMs = 5_000) {
  return publisher().publish(request(), {
    requestId: "req_test_0001",
    timeoutMs,
    configuration: pin(model),
  });
}

describe("OpenAI reading publisher", () => {
  it("returns a parsed candidate and safe provider metadata", async () => {
    const result = await publish(OPENAI_READING_MODEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.candidate.schema_version).toBe("0.5.0");
    expect(result.candidate.local_date).toBe("2026-07-30");
    expect(result.candidate.lead.fact_ids).toEqual([`cyc_${"a".repeat(32)}`]);

    expect(result.metadata.provider).toBe("openai");
    expect(result.metadata.model).toBe(OPENAI_READING_MODEL);
    expect(result.metadata.provider_request_id).toBe("resp_mock_0000000000000001");
    expect(result.metadata.input_tokens).toBe(4210);
    expect(result.metadata.output_tokens).toBe(512);
    expect(result.metadata.provider_response_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("hashes the exact response bytes and keeps nothing else from them", async () => {
    const first = await publish(OPENAI_READING_MODEL);
    const second = await publish(OPENAI_READING_MODEL);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Deterministic on the response body, and only on the response body.
    expect(first.metadata.provider_response_hash).toBe(second.metadata.provider_response_hash);
    expect(first.metadata.provider_response_hash).not.toBe(
      await contentHash(JSON.stringify(first.candidate)),
    );

    const serialized = JSON.stringify(first.metadata);
    for (const leak of ["assistant", "output_text", "reasoning", "usage", "annotations"]) {
      expect(serialized, leak).not.toContain(leak);
    }
  });

  it("makes exactly one provider request per publish", async () => {
    let calls = 0;
    const counting = {
      ...env,
      OPENAI_API_KEY: "sk-test-key",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await createOpenAiReadingPublisher(counting).publish(request(), {
        requestId: "req_test_0002",
        timeoutMs: 5_000,
        configuration: pin(OPENAI_MOCK_SERVER_ERROR),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    // A 503 is the most tempting case to retry inside the adapter. It does not:
    // the shared failure policy owns retries, and one delivery is one call.
    expect(calls).toBe(1);
  });

  it("refuses to call the provider with no key rather than sending an empty header", async () => {
    const result = await publisher("").publish(request(), {
      requestId: "req_test_0003",
      timeoutMs: 5_000,
      configuration: pin(),
    });
    expect(result).toEqual({
      ok: false,
      code: "publisher_auth_failed",
      safe_detail_code: "authentication_failed",
      retry_after_seconds: null,
    });
  });

  it.each([
    [OPENAI_MOCK_TIMEOUT, "publisher_unavailable", "request_timeout"],
    [OPENAI_MOCK_RATE_LIMITED, "publisher_unavailable", "rate_limited"],
    [OPENAI_MOCK_SERVER_ERROR, "publisher_unavailable", "provider_5xx"],
    [OPENAI_MOCK_AUTH_FAILED, "publisher_auth_failed", "authentication_failed"],
    [OPENAI_MOCK_FORBIDDEN, "publisher_auth_failed", "authentication_failed"],
    [OPENAI_MOCK_MODEL_MISSING, "publisher_model_unavailable", "model_not_available"],
    [OPENAI_MOCK_REFUSAL, "publisher_refused", "provider_refusal"],
    [OPENAI_MOCK_NO_TEXT, "publisher_output_invalid", "missing_output_text"],
    [OPENAI_MOCK_TWO_TEXTS, "publisher_output_invalid", "multiple_output_text"],
    [OPENAI_MOCK_INVALID_JSON, "publisher_output_invalid", "invalid_json"],
    [
      OPENAI_MOCK_INCOMPLETE_MAX_OUTPUT,
      "publisher_output_invalid",
      "max_output_tokens_exhausted",
    ],
    [OPENAI_MOCK_WRONG_SHAPE, "publisher_output_invalid", "schema_mismatch"],
  ])("maps %s to %s / %s", async (model, code, detail) => {
    const result = await publish(model, model === OPENAI_MOCK_TIMEOUT ? 40 : 5_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
    expect(result.safe_detail_code).toBe(detail);
  });

  it("maps a rejected fetch to a network error rather than to a provider fault", async () => {
    // miniflare turns a throwing outbound service into a 5xx RESPONSE, which is
    // a different thing: this is the case where nothing reached the provider at
    // all, and only a stubbed fetch can produce it.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("connection reset"))) as typeof fetch;
    try {
      const result = await publish(OPENAI_MOCK_NETWORK_ERROR);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("publisher_unavailable");
      expect(result.safe_detail_code).toBe("network_error");
      expect(JSON.stringify(result)).not.toContain("connection reset");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the timeout active until the response body finishes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const aborted = new Error("body aborted");
              aborted.name = "AbortError";
              reject(aborted);
            });
            setTimeout(() => reject(new Error("body watchdog expired")), 150);
          }),
      } as Response;
    }) as typeof fetch;
    try {
      const result = await publish(OPENAI_READING_MODEL, 40);
      expect(result).toMatchObject({
        ok: false,
        code: "publisher_unavailable",
        safe_detail_code: "request_timeout",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects provider metadata that cannot satisfy the evidence contract", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const body = (await response.json()) as {
        id: string;
        usage: { input_tokens: number; output_tokens: number };
      };
      body.id = "";
      body.usage.input_tokens = -1;
      body.usage.output_tokens = 0.5;
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      expect(await publish(OPENAI_READING_MODEL)).toMatchObject({
        ok: false,
        code: "publisher_output_invalid",
        safe_detail_code: "schema_mismatch",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads a numeric retry-after and nothing else from a rate-limit response", async () => {
    const result = await publish(OPENAI_MOCK_RATE_LIMITED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retry_after_seconds).toBe(17);
    expect(Object.keys(result).sort()).toEqual([
      "code",
      "ok",
      "retry_after_seconds",
      "safe_detail_code",
    ]);
  });

  it("never copies provider text into a failure result", async () => {
    for (const model of [
      OPENAI_MOCK_AUTH_FAILED,
      OPENAI_MOCK_SERVER_ERROR,
      OPENAI_MOCK_REFUSAL,
      OPENAI_MOCK_INVALID_JSON,
    ]) {
      const result = await publish(model);
      const serialized = JSON.stringify(result);
      for (const leak of [
        "sk-live-REDACTED",
        "Incorrect API key",
        "The server had an error",
        "I cannot help with that.",
        "this is not json",
        "api.openai.com",
      ]) {
        expect(serialized, `${model} leaked ${leak}`).not.toContain(leak);
      }
    }
  });

  it("returns the candidate the provider actually sent, without repairing it", async () => {
    // Validation is the reading engine's job and happens after this boundary.
    // An adapter that quietly corrected an echoed date would hide the exact
    // defect the validator exists to catch.
    const result = await publish(OPENAI_MOCK_ECHO_WRONG_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.local_date).toBe("2999-01-01");
  });
});
