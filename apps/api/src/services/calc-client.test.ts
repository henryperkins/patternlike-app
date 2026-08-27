import type { CalcRequest, CalcResponse } from "@patternlike/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env.js";
import {
  MAX_CALC_RESPONSE_BYTES,
  invokeCalc,
} from "./calc-client.js";

const env = {
  CALC_SERVICE_URL: "https://calc.example/",
  CALC_SERVICE_AUTH_TOKEN: "calc-token",
} as Env;

const request: CalcRequest = {
  request_id: "job_test",
  user_id: "usr_test",
  profile_version: 1,
  accuracy: "exact",
  birth_date: "1990-05-15",
  birth_time_local: "12:34:00",
  timezone: "America/Los_Angeles",
  latitude: 34.0522,
  longitude: -118.2437,
  place_label: "Los Angeles",
  approximate_window_minutes: null,
  contract_id: "calc-request",
  contract_version: "0.2.0",
};

const success = {
  ok: true,
  chart: null,
} satisfies CalcResponse;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded calc invocation", () => {
  it("returns a successful response with latency and timeout metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://calc.example/v1/calculate");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer calc-token");
      return new Response(JSON.stringify(success), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const invocation = await invokeCalc(env, request, 5_000);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(invocation.response).toEqual(success);
    expect(invocation.timedOut).toBe(false);
    expect(invocation.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a fetch aborted by its supplied deadline as timed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) return Promise.reject(new Error("fetch signal missing"));
        return new Promise<Response>((_resolve, reject) => {
          const rejectForAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (signal.aborted) {
            rejectForAbort();
            return;
          }
          signal.addEventListener("abort", rejectForAbort, { once: true });
        });
      }),
    );

    const invocation = await invokeCalc(env, request, 5);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: true,
    });
    expect(invocation.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps malformed JSON to a non-timeout transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":', { status: 200 })),
    );

    const invocation = await invokeCalc(env, request, 5_000);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: false,
    });
  });

  it("rejects a misleading oversized Content-Length before parsing its tiny body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(success), {
          headers: {
            "content-length": String(MAX_CALC_RESPONSE_BYTES + 1),
          },
        })),
    );

    const invocation = await invokeCalc(env, request, 5_000);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: false,
    });
  });

  it("cancels a chunked response after reading one byte above 1 MiB", async () => {
    let cancelled = false;
    const firstChunk = new TextEncoder().encode(
      JSON.stringify(success).padEnd(MAX_CALC_RESPONSE_BYTES, " "),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstChunk);
        controller.enqueue(new Uint8Array([0x20]));
        setTimeout(() => {
          if (!cancelled) controller.close();
        }, 0);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));

    const invocation = await invokeCalc(env, request, 5_000);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: false,
    });
    expect(cancelled).toBe(true);
  });

  it("maps an ordinary rejected fetch to a non-timeout transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("connection reset"))),
    );

    const invocation = await invokeCalc(env, request, 5_000);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: false,
    });
  });

  it("does not infer a timeout from an AbortError while the signal is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted elsewhere", "AbortError"))),
    );

    const invocation = await invokeCalc(env, request, 5_000);

    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_transport_error" },
      timedOut: false,
    });
  });

  it("wraps the existing unavailable response when no calc URL is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const invocation = await invokeCalc(
      { ...env, CALC_SERVICE_URL: "" },
      request,
      5_000,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(invocation).toMatchObject({
      response: { ok: false, error_class: "calc_unavailable" },
      timedOut: false,
    });
    expect(invocation.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
