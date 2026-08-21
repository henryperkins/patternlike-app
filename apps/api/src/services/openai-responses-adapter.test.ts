import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractOutputText,
  failure,
  responsesUrlFor,
  retryAfterSeconds,
  runOpenAiResponsesRequest,
} from "./openai-responses-adapter.js";

function utf8Bom(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(encoded.byteLength + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  return bytes;
}

async function exactBytesHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

/** One `message` item wrapping the given content parts. */
function envelope(content: unknown[]): unknown {
  return { output: [{ type: "message", content }] };
}

describe("OpenAI Responses boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts one leading UTF-8 BOM while preserving and hashing the exact received bytes", async () => {
    const body = JSON.stringify({
      id: "resp_exact_bom",
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ ok: true }) }],
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const received = utf8Bom(body);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(received, { status: 200 })));

    const result = await runOpenAiResponsesRequest({
      credential: { source: "worker", apiKey: "sk-test" },
      route: null,
      timeoutMs: 5_000,
      body: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextEncoder().encode(result.raw)).toEqual(received);
    expect(result.raw.charCodeAt(0)).toBe(0xfeff);
    expect(result.metadata.provider_response_hash).toBe(await exactBytesHash(received));
    expect(result.parsed).toEqual({ ok: true });
  });

  describe("extractOutputText", () => {
    it("resolves a refusal accompanied by text as a refusal, not as a candidate", () => {
      // The provider declined and then emitted prose anyway. Publishing that
      // prose would ship a candidate the model attached a refusal to.
      const result = extractOutputText(
        envelope([
          { type: "refusal", refusal: "I cannot help with that." },
          { type: "output_text", text: '{"schema_version":"0.5.0"}' },
        ]),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.result.code).toBe("publisher_refused");
      expect(result.result.safe_detail_code).toBe("provider_refusal");
    });

    it("resolves a refusal with no text as a refusal", () => {
      const result = extractOutputText(
        envelope([{ type: "refusal", refusal: "I cannot help with that." }]),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.result.code).toBe("publisher_refused");
    });

    it("refuses two text parts rather than silently taking the first", () => {
      const result = extractOutputText(
        envelope([
          { type: "output_text", text: '{"a":1}' },
          { type: "output_text", text: '{"b":2}' },
        ]),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.result.code).toBe("publisher_output_invalid");
      expect(result.result.safe_detail_code).toBe("multiple_output_text");
    });

    it("skips reasoning items that precede the message", () => {
      const result = extractOutputText({
        output: [
          { type: "reasoning", summary: [] },
          { type: "reasoning", summary: [] },
          { type: "message", content: [{ type: "output_text", text: "ok" }] },
        ],
      });
      expect(result).toEqual({ ok: true, text: "ok" });
    });

    it("reports a missing output array as missing text rather than throwing", () => {
      for (const body of [undefined, null, {}, { output: "nope" }]) {
        const result = extractOutputText(body);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.result.safe_detail_code).toBe("missing_output_text");
      }
    });

    it("reports an empty message as missing text", () => {
      const result = extractOutputText(envelope([]));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.result.safe_detail_code).toBe("missing_output_text");
    });
  });

  describe("failure", () => {
    it("defaults retry_after_seconds to null", () => {
      expect(failure("publisher_unavailable", "network_error")).toEqual({
        ok: false,
        code: "publisher_unavailable",
        safe_detail_code: "network_error",
        retry_after_seconds: null,
      });
    });
  });

  describe("retryAfterSeconds", () => {
    it("reads a whole number of seconds", () => {
      const response = new Response(null, { headers: { "retry-after": " 30 " } });
      expect(retryAfterSeconds(response)).toBe(30);
    });

    it("discards a date-formatted value rather than coercing it", () => {
      const response = new Response(null, {
        headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      });
      expect(retryAfterSeconds(response)).toBeNull();
    });

    it("returns null when the header is absent", () => {
      expect(retryAfterSeconds(new Response(null))).toBeNull();
    });
  });

  describe("responsesUrlFor", () => {
    it("uses the direct origin for a null route", () => {
      expect(responsesUrlFor(null)).toBe("https://api.openai.com/v1/responses");
    });

    it("builds the gateway path without the doubled /v1 that 404s", () => {
      const url = responsesUrlFor({
        accountId: "a".repeat(32),
        gatewayId: "patternlike",
        token: null,
      });
      expect(url).toBe(
        `https://gateway.ai.cloudflare.com/v1/${"a".repeat(32)}/patternlike/openai/responses`,
      );
      expect(url).not.toContain("/openai/v1/responses");
    });
  });
});
