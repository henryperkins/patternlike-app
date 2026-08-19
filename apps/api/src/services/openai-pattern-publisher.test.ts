import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAiPatternTransport } from "./openai-pattern-publisher.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";
import type { AiGatewayRoute } from "./openai-responses-adapter.js";
import {
  OPENAI_MOCK_AUTH_FAILED,
  OPENAI_MOCK_ECHO_WRONG_DATE,
} from "../../test/mock-calc-service.js";

const ROUTE: AiGatewayRoute = {
  accountId: "a".repeat(32),
  gatewayId: "patternlike",
  token: "gwtoken",
};

function pin(): PatternPublisherPin {
  return {
    publisher: "openai",
    planner_model: "gpt-5.6-sol",
    planner_reasoning: "high",
    planner_prompt_version: "1.0.0",
    planner_max_output_tokens: 4000,
    writer_model: "gpt-5.6-sol",
    writer_reasoning: "high",
    writer_prompt_version: "1.0.0",
    writer_max_output_tokens: 8000,
    verifier_model: "gpt-5.6-sol",
    verifier_reasoning: "high",
    verifier_prompt_version: "1.0.0-verifier",
    verifier_max_output_tokens: 4000,
    input_max_bytes: 98_304,
    selection_policy_version: "1.0.0",
    validation_policy_version: "1.0.0",
  };
}

const PLAN = {
  schema_version: "0.7.0",
  chapters: [],
  additional_signatures: [],
  omissions: [],
};

function envelope(payload: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    id: "resp_mock_0000000000000001",
    object: "response",
    model: "gpt-5.6-sol",
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(payload) }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200 },
    ...extra,
  };
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];

function stubFetch(responder: (call: Call) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
      const call: Call = {
        url: String(input),
        headers,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return responder(call);
    }),
  );
}

function ok(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(envelope(payload)), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

const OPTIONS = { requestId: "req-1", timeoutMs: 5000, configuration: pin() };

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI Pattern publisher", () => {
  describe("one request per pass", () => {
    it("makes exactly one fetch and returns the parsed document, bytes, and hash", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", { pass: "planner" }, OPTIONS);

      expect(calls).toHaveLength(1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.parsed).toEqual(PLAN);
      // The exact bytes travel to Task 6's encrypted response artifact.
      expect(JSON.parse(result.raw)).toEqual(envelope(PLAN));
      expect(result.metadata.provider_response_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.metadata.input_tokens).toBe(100);
      expect(result.metadata.output_tokens).toBe(200);
      expect(result.metadata.provider_request_id).toBe("resp_mock_0000000000000001");
      expect(result.metadata.pass).toBe("planner");
    });

    it("never retries, on any status", async () => {
      stubFetch(() => new Response("{}", { status: 500 }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      await publisher.run("writer", {}, OPTIONS);
      expect(calls).toHaveLength(1);
    });

    it("hashes the exact bytes before parsing them", async () => {
      // A body that parses to the same document under two spellings must hash
      // differently, which only holds if the hash is over the raw bytes.
      const spaced = ` ${JSON.stringify(envelope(PLAN))} `;
      stubFetch(() => new Response(spaced, { status: 200 }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const first = await publisher.run("planner", {}, OPTIONS);

      stubFetch(() => ok(PLAN));
      const second = await publisher.run("planner", {}, OPTIONS);

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.raw).not.toBe(second.raw);
      expect(first.metadata.provider_response_hash).not.toBe(
        second.metadata.provider_response_hash,
      );
    });
  });

  describe("outgoing headers", () => {
    it("pins the three gateway headers with their exact values on a routed request", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
      await publisher.run("planner", {}, OPTIONS);

      const { headers } = calls[0]!;
      // Values, not just names. A name-only allowlist would pass
      // collect-log: true, which is the worst value to get wrong.
      expect(headers["cf-aig-collect-log"]).toBe("false");
      expect(headers["cf-aig-max-attempts"]).toBe("1");
      expect(headers["cf-aig-skip-cache"]).toBe("true");
      expect(headers["cf-aig-authorization"]).toBe("Bearer gwtoken");
    });

    it("sends no gateway header at all without a route", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      await publisher.run("planner", {}, OPTIONS);

      for (const name of Object.keys(calls[0]!.headers)) {
        expect(name.startsWith("cf-aig-"), `${name} must not be sent direct`).toBe(false);
      }
    });

    it("sends only allowlisted header names, with and without a route", async () => {
      const forbidden = [
        "cf-aig-metadata",
        "cf-aig-request-timeout",
        "cf-aig-retry-delay",
        "cf-aig-backoff",
        "cf-aig-cache-ttl",
        "cf-aig-cache-key",
        "cf-aig-custom-cost",
        "cf-aig-byok-alias",
        "cf-aig-zdr",
      ];
      const allowed = new Set([
        "authorization",
        "content-type",
        "cf-aig-collect-log",
        "cf-aig-max-attempts",
        "cf-aig-skip-cache",
        "cf-aig-authorization",
      ]);

      for (const route of [null, ROUTE]) {
        calls = [];
        stubFetch(() => ok(PLAN));
        const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, route);
        await publisher.run("writer", {}, OPTIONS);

        const names = Object.keys(calls[0]!.headers);
        // An allowlist, so a header added later fails by default.
        for (const name of names) expect(allowed.has(name), `unexpected header ${name}`).toBe(true);
        for (const name of forbidden) expect(names).not.toContain(name);
      }
    });

    it("builds the gateway path without the doubled /v1 that 404s", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
      await publisher.run("planner", {}, OPTIONS);
      expect(calls[0]!.url).toBe(
        `https://gateway.ai.cloudflare.com/v1/${"a".repeat(32)}/patternlike/openai/responses`,
      );
      expect(calls[0]!.url).not.toContain("/openai/v1/responses");
    });

    it("sends the pass's own schema name and token ceiling", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      await publisher.run("writer", {}, OPTIONS);
      const body = calls[0]!.body as { text: { format: { name: string } }; max_output_tokens: number };
      expect(body.text.format.name).toBe("patternlike_pattern_document_v7");
      expect(body.max_output_tokens).toBe(8000);
    });
  });

  describe("failure mapping", () => {
    const cases: Array<[number, string, string]> = [
      [401, "publisher_auth_failed", "authentication_failed"],
      [403, "publisher_auth_failed", "authentication_failed"],
      [404, "publisher_model_unavailable", "model_not_available"],
      [429, "publisher_unavailable", "rate_limited"],
      [500, "publisher_unavailable", "provider_5xx"],
      [503, "publisher_unavailable", "provider_5xx"],
      [400, "publisher_output_invalid", "schema_mismatch"],
    ];

    it.each(cases)("maps %i without leaking provider text", async (status, code, detail) => {
      stubFetch(
        () =>
          new Response(JSON.stringify({ error: { message: "SECRET-PROVIDER-PROSE" } }), {
            status,
          }),
      );
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(code);
      expect(result.safe_detail_code).toBe(detail);
      expect(JSON.stringify(result)).not.toContain("SECRET-PROVIDER-PROSE");
    });

    it("refuses without an API key before spending a round trip", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "  " }, null);
      const result = await publisher.run("planner", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("publisher_auth_failed");
      expect(calls).toHaveLength(0);
    });

    it("separates a deadline this Worker set from a network that did not carry", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw Object.assign(new Error("boom"), { name: "TypeError" });
        }),
      );
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.safe_detail_code).toBe("network_error");
    });

    it("maps a refusal part and an output-ceiling stop distinctly", async () => {
      stubFetch(
        () =>
          new Response(
            JSON.stringify({
              id: "resp_1",
              output: [
                { type: "message", content: [{ type: "refusal", refusal: "no" }] },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200 },
          ),
      );
      let publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      let result = await publisher.run("writer", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("publisher_refused");

      stubFetch(
        () =>
          new Response(
            JSON.stringify({
              id: "resp_1",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output: [],
            }),
            { status: 200 },
          ),
      );
      publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      result = await publisher.run("writer", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.safe_detail_code).toBe("max_output_tokens_exhausted");
    });

    it("rejects a body that is not a JSON object", async () => {
      stubFetch(() => new Response("not json at all", { status: 200 }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.safe_detail_code).toBe("invalid_json");
    });

    it("rejects a document whose usage or id the envelope omits", async () => {
      stubFetch(
        () =>
          new Response(
            JSON.stringify({
              output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
            }),
            { status: 200 },
          ),
      );
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.safe_detail_code).toBe("schema_mismatch");
    });
  });

  describe("gateway-layer classification", () => {
    it("calls a direct non-2xx a provider failure", async () => {
      stubFetch(() => new Response("{}", { status: 429 }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, OPTIONS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.origin_layer).toBe("provider");
    });

    it.each([2016, 2017, 2029, 2030])(
      "calls documented Cloudflare code %i a gateway failure",
      async (code) => {
        stubFetch(
          () =>
            new Response(JSON.stringify({ errors: [{ code, message: "SECRET" }] }), {
              status: 403,
            }),
        );
        const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
        const result = await publisher.run("planner", {}, OPTIONS);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.origin_layer).toBe("gateway");
        expect(JSON.stringify(result)).not.toContain("SECRET");
      },
    );

    it("leaves every other routed non-2xx unknown, including a numeric code outside the allowlist", async () => {
      for (const body of [
        JSON.stringify({ errors: [{ code: 9999 }] }),
        JSON.stringify({ error: { message: "rate limited" } }),
        "",
        "not json",
      ]) {
        calls = [];
        stubFetch(() => new Response(body, { status: 429 }));
        const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
        const result = await publisher.run("planner", {}, OPTIONS);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // Cloudflare publishes no universal gateway-error body, so a spend limit
        // and an OpenAI rate limit are indistinguishable on status alone. Saying
        // "unknown" is the honest answer; claiming an operator remedy is not.
        expect(result.origin_layer).toBe("unknown");
      }
    });
  });

  describe("response-header invariants", () => {
    it("fails terminally on a cache HIT", async () => {
      stubFetch(() => ok(PLAN, { "cf-aig-cache-status": "HIT" }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
      const result = await publisher.run("planner", {}, OPTIONS);
      // A hit gives two Patterns one provider_request_id and one response hash:
      // stored evidence naming a generation that did not happen.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.safe_detail_code).toBe("gateway_cache_hit");
    });

    it("succeeds on MISS and records a closed observation for absent or unrecognised", async () => {
      const seen: string[] = [];
      for (const [header, expected] of [
        ["MISS", "miss"],
        [null, "missing"],
        ["SOMETHING_NEW", "unrecognized"],
      ] as Array<[string | null, string]>) {
        stubFetch(() => ok(PLAN, header ? { "cf-aig-cache-status": header } : {}));
        const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
        const result = await publisher.run("planner", {}, OPTIONS);
        expect(result.ok, `${header} should succeed`).toBe(true);
        if (!result.ok) return;
        // Never the raw header value.
        expect(result.metadata.cache_observation).toBe(expected);
        seen.push(result.metadata.cache_observation);
      }
      expect(seen).toEqual(["miss", "missing", "unrecognized"]);
    });

    it("fails terminally when a DLP policy matched", async () => {
      stubFetch(() => ok(PLAN, { "cf-aig-dlp": "policy-matched" }));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
      const result = await publisher.run("planner", {}, OPTIONS);
      // Its presence proves an undisclosed inspector processed this content.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.safe_detail_code).toBe("gateway_dlp_match");
      expect(JSON.stringify(result)).not.toContain("policy-matched");
    });
  });

  describe("correlation id", () => {
    it("never sends the Worker's own request id to the provider", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, ROUTE);
      await publisher.run("planner", { pass: "planner" }, {
        ...OPTIONS,
        requestId: "ZZCORRELATIONZZ",
      });
      const blob = JSON.stringify(calls[0]);
      expect(blob).not.toContain("ZZCORRELATIONZZ");
    });
  });

  describe("hermetic mock seam", () => {
    // These do NOT stub fetch: they exercise apps/api/test/mock-calc-service.ts,
    // which is what every integration-level Pattern test will route through.
    it.each(["planner", "writer", "verifier"] as const)(
      "answers the %s pass through the mock, routed on the schema name",
      async (pass) => {
        vi.unstubAllGlobals();
        const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
        const result = await publisher.run(pass, { pass }, OPTIONS);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.parsed as { schema_version?: string }).schema_version).toBe("0.7.0");
        expect(result.metadata.pass).toBe(pass);
      },
    );

    it("still drives failure sentinels off the model, without colliding with the pass router", async () => {
      vi.unstubAllGlobals();
      const sentinel = pin();
      sentinel.planner_model = OPENAI_MOCK_AUTH_FAILED;
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, { ...OPTIONS, configuration: sentinel });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("publisher_auth_failed");
      // The mock's 401 body carries a redacted-looking key; none of it escapes.
      expect(JSON.stringify(result)).not.toContain("sk-live");
    });

    it("refuses an unmocked host rather than reaching the network", async () => {
      vi.unstubAllGlobals();
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, {
        accountId: "b".repeat(32),
        gatewayId: "patternlike",
        token: null,
      });
      const result = await publisher.run("planner", {}, OPTIONS);
      // The gateway host IS mocked, so this proves the gateway path is wired.
      expect(result.ok).toBe(true);
    });
  });

  describe("regressions from the adversarial review", () => {
    it("keeps the deadline armed across the error-body read", async () => {
      // A peer that sends non-2xx headers and then stalls the body. Clearing the
      // timer before this read disarmed the only controller.abort() in the
      // function, so run() never settled and the claimed job held its lease and
      // its already-spent budget until the consumer was killed.
      //
      // The stub honours init.signal the way real fetch does -- aborting errors
      // the body stream -- because a locally constructed Response is not
      // attached to the caller's controller and would prove nothing.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: unknown, init: RequestInit = {}) => {
          const signal = init.signal;
          // Modelled at the surface the adapter uses: headers have arrived, so
          // status and headers read fine, but the body never completes and only
          // an abort ever settles it. A locally constructed Response would not
          // be attached to the caller's controller and would prove nothing.
          return {
            ok: false,
            status: 503,
            headers: new Headers(),
            text: () =>
              new Promise<string>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              }),
          } as unknown as Response;
        }),
      );

      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, { ...OPTIONS, timeoutMs: 50 });

      // The invariant is that a typed failure arrives at all, inside the deadline.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("publisher_unavailable");
    }, 3000);

    it("still answers a Pattern pass when the pinned model is an unhandled sentinel", async () => {
      // The mock's pass router originally sat above the sentinel handlers behind
      // a "model does not look like a sentinel" guard, which excluded sentinels
      // that have no handler too -- so this request fell into the reading packet
      // path, threw on a packet it does not have, and came back provider_5xx.
      vi.unstubAllGlobals();
      const sentinel = pin();
      sentinel.planner_model = OPENAI_MOCK_ECHO_WRONG_DATE;
      const publisher = createOpenAiPatternTransport({ source: "worker" as const, apiKey: "sk-test" }, null);
      const result = await publisher.run("planner", {}, { ...OPTIONS, configuration: sentinel });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.parsed as { schema_version?: string }).schema_version).toBe("0.7.0");
    });
  });

  describe("credential mode", () => {
    const STORED = { source: "gateway_stored" as const, alias: "primary" };

    it("sends NO provider authorization in stored mode, which is what lets BYOK win", async () => {
      stubFetch(() => ok(PLAN));
      const publisher = createOpenAiPatternTransport(STORED, ROUTE);
      await publisher.run("planner", {}, OPTIONS);

      const { headers } = calls[0]!;
      // On a provider-native request a key on the request has FIRST precedence:
      // the gateway forwards it and never consults the stored key. Sending one
      // here would silently bypass the alias below.
      expect(headers).not.toHaveProperty("authorization");
      expect(headers["cf-aig-byok-alias"]).toBe("primary");
      expect(headers["cf-aig-authorization"]).toBe("Bearer gwtoken");
    });

    it("sends the alias only in stored mode, and only with a route", async () => {
      stubFetch(() => ok(PLAN));
      await createOpenAiPatternTransport(
        { source: "worker", apiKey: "sk-test" },
        ROUTE,
      ).run("planner", {}, OPTIONS);
      expect(calls[0]!.headers).not.toHaveProperty("cf-aig-byok-alias");
      expect(calls[0]!.headers.authorization).toBe("Bearer sk-test");

      calls = [];
      stubFetch(() => ok(PLAN));
      await createOpenAiPatternTransport(STORED, null).run("planner", {}, OPTIONS);
      // No route means no gateway, so there is nothing to name an alias to.
      expect(calls[0]!.headers).not.toHaveProperty("cf-aig-byok-alias");
    });

    it("keeps worker mode byte-identical to today", async () => {
      stubFetch(() => ok(PLAN));
      await createOpenAiPatternTransport({ source: "worker", apiKey: "sk-test" }, ROUTE).run(
        "planner",
        {},
        OPTIONS,
      );
      expect(Object.keys(calls[0]!.headers).sort()).toEqual([
        "authorization",
        "cf-aig-authorization",
        "cf-aig-collect-log",
        "cf-aig-max-attempts",
        "cf-aig-skip-cache",
        "content-type",
      ]);
    });
  });
});
