import { afterEach, describe, expect, it, vi } from "vitest";

import { safeLog, type SafeLogEvent } from "./safe-log.js";

const SENTINEL = "PRIVATE_SENTINEL_DO_NOT_LOG";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safe logging", () => {
  it("projects a closed event and generates its own internal trace id", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const traceId = safeLog({
      event: "generation_failed",
      failure_class: "publisher_output_invalid",
    });

    expect(traceId).toMatch(/^trc_[0-9a-f]{32}$/);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]).toEqual([
      "generation_failed",
      {
        trace_id: traceId,
        failure_class: "publisher_output_invalid",
      },
    ]);
  });

  it("drops undeclared runtime properties instead of spreading private input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      event: "publisher_attempt_failed",
      provider: "openai",
      model: "gpt-5.6-sol",
      prompt_version: "1.0.0",
      latency_ms: 91,
      failure_class: "publisher_unavailable",
      safe_detail_code: "network_error",
      message: SENTINEL,
      stack: SENTINEL,
      request_id: "caller-request-id",
      job_id: "job_private",
      reading_id: "rdg_private",
      cycle_id: "cyc_private",
      response_prose: SENTINEL,
      evidence_url: `/v1/readings/${SENTINEL}/evidence`,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain(SENTINEL);
    for (const forbidden of [
      "caller-request-id",
      "job_private",
      "rdg_private",
      "cyc_private",
      "evidence_url",
      "response_prose",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain("network_error");
  });

  it("logs completed-call metrics without request context or prose", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    safeLog({
      event: "publisher_call_completed",
      provider: "openai",
      model: "gpt-5.6-sol",
      prompt_version: "1.0.0",
      latency_ms: 120,
      input_tokens: 4210,
      output_tokens: 512,
      provider_response_hash: `sha256:${"a".repeat(64)}`,
    });

    const payload = info.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "input_tokens",
      "latency_ms",
      "model",
      "output_tokens",
      "prompt_version",
      "provider",
      "provider_response_hash",
      "trace_id",
    ]);
  });
});
