import { afterEach, describe, expect, it, vi } from "vitest";

import { safeLog, type SafeLogEvent } from "./safe-log.js";

const SENTINEL = "PRIVATE_SENTINEL_DO_NOT_LOG";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safe logging", () => {
  it("projects only closed Codex control-plane completion metadata", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const hostile = {
      event: "codex_provider_job_completed",
      job_id: `cpjob_${"a".repeat(32)}`,
      pipeline: "pattern",
      pass: "writer",
      model: "gpt-5.6-sol",
      input_tokens: 120,
      output_tokens: 40,
      response_hash: `sha256:${"b".repeat(64)}`,
      prompt: SENTINEL,
      output: SENTINEL,
      stderr: SENTINEL,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(info).toHaveBeenCalledOnce();
    const payload = info.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "input_tokens",
      "job_id",
      "model",
      "output_tokens",
      "pass",
      "pipeline",
      "response_hash",
      "trace_id",
    ]);
    expect(JSON.stringify(info.mock.calls)).not.toContain(SENTINEL);
  });

  it("projects only closed ontology regression hard-gate metadata", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      event: "ontology_regression_hard_gate_failed",
      fixture_index: 2,
      pass: "verifier",
      hard_gate_failures: ["mandatory_feature_omission"],
      fixture_id: SENTINEL,
      chart: SENTINEL,
      candidate: SENTINEL,
      corpus: SENTINEL,
      response_prose: SENTINEL,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(warn).toHaveBeenCalledOnce();
    const payload = warn.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      fixture_index: 2,
      pass: "verifier",
      hard_gate_failures: ["mandatory_feature_omission"],
      trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
    });
    expect(Object.keys(payload).sort()).toEqual([
      "fixture_index",
      "hard_gate_failures",
      "pass",
      "trace_id",
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL);
  });

  it("projects only the closed stalled-generation diagnostic", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      event: "ontology_generation_stalled",
      safe_detail_code: "coverage_no_progress",
      remaining_feature_classes: ["position"],
      candidate: SENTINEL,
      corpus: SENTINEL,
      run: SENTINEL,
      response_prose: SENTINEL,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(warn).toHaveBeenCalledOnce();
    const payload = warn.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      safe_detail_code: "coverage_no_progress",
      remaining_feature_classes: ["position"],
      trace_id: expect.stringMatching(/^trc_[0-9a-f]{32}$/),
    });
    expect(Object.keys(payload).sort()).toEqual([
      "remaining_feature_classes",
      "safe_detail_code",
      "trace_id",
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL);
  });

  it("projects only a closed ontology candidate rejection reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      event: "ontology_candidate_rejected",
      reason: "record_policy_invalid",
      candidate: SENTINEL,
      corpus: SENTINEL,
      run_id: "private-run-id",
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatchObject({
      reason: "record_policy_invalid",
    });
    expect(Object.keys(warn.mock.calls[0]![1] as object).sort()).toEqual([
      "reason",
      "trace_id",
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-run-id");
  });

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

  it("projects only closed Pattern completed-call metrics with the pass", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const hostile = {
      event: "pattern_publisher_call_completed",
      provider: "openai",
      pass: "writer",
      model: "gpt-5.6-sol",
      prompt_version: "1.0.0",
      latency_ms: 120,
      input_tokens: 4210,
      output_tokens: 512,
      provider_response_hash: `sha256:${"b".repeat(64)}`,
      prompt_text: SENTINEL,
      packet: { private: SENTINEL },
      plan: { private: SENTINEL },
      draft: SENTINEL,
      response_prose: SENTINEL,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(info).toHaveBeenCalledOnce();
    const payload = info.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "input_tokens",
      "latency_ms",
      "model",
      "output_tokens",
      "pass",
      "prompt_version",
      "provider",
      "provider_response_hash",
      "trace_id",
    ]);
    for (const forbidden of ["prompt_text", "packet", "plan", "draft", "response_prose"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(info.mock.calls)).not.toContain(SENTINEL);
  });

  it("projects only closed Pattern failure metrics with pass and attempt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      event: "pattern_publisher_attempt_failed",
      provider: "openai",
      pass: "planner",
      model: "gpt-5.6-sol",
      prompt_version: "1.0.0",
      latency_ms: 91,
      attempt: 1,
      failure_class: "publisher_unavailable",
      safe_detail_code: "network_error",
      prompt_text: SENTINEL,
      packet: { private: SENTINEL },
      plan_document: { private: SENTINEL },
      draft: SENTINEL,
      response_prose: SENTINEL,
    } as unknown as SafeLogEvent;

    safeLog(hostile);

    expect(warn).toHaveBeenCalledOnce();
    const payload = warn.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "attempt",
      "failure_class",
      "latency_ms",
      "model",
      "pass",
      "prompt_version",
      "provider",
      "safe_detail_code",
      "trace_id",
    ]);
    for (const forbidden of [
      "prompt_text",
      "packet",
      "plan_document",
      "draft",
      "response_prose",
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL);
  });
});
