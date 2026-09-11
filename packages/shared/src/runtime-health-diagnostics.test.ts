import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosePattern, parsePatternDiagnostics, type PatternDiagnosticsResponse } from "./runtime-health-diagnostics.js";
const time = "2026-09-11T00:00:00.000Z";
export const snapshot: PatternDiagnosticsResponse = {
  schema_version: "pattern-diagnostics/v1", generation_id: `pgen_${"a".repeat(32)}`, observed_at: time,
  stage: "failed", stage_generation: 2, created_at: "2026-09-10T23:59:00.000Z", updated_at: time, finished_at: time,
  failure_class: "publication_safety_failed", public_failure_stage: "checking_claims", cancellation_reason: null,
  reservation_reason: "first_open_retry", revision_reason: null,
  planner_attempts: 1, writer_attempts: 1, verifier_attempts: 1,
  schedule: { status: "failed", available_at: null, lease_expires_at: null },
  provider: { pass: "verifier", status: "completed", lease_expires_at: null, available_at: time, completed_at: time },
};
test("durable publication failure is distinct from accepted provider output and only offers reads", () => {
  const result = diagnosePattern({ domain: "pattern", authorized: true, snapshot }, time);
  assert.equal(result.blocking_stage, "publication");
  assert.equal(result.reason, "publication_safety_failed");
  assert.equal(result.provider_output, "accepted");
  assert.equal(result.publication, "not_published");
  assert.equal(result.retry_origin, "first_open_retry");
  assert.equal(result.revision_reason, null);
  assert.deepEqual(result.recovery, { action: "reload_status", authority: "read_only" });
  assert.equal(result.stages[0]!.observation, "not_collected");
});
test("coarse checking_claims does not identify a validator or publication root cause", () => {
  const result = diagnosePattern({ domain: "pattern", authorized: true, snapshot: { ...snapshot, failure_class: "execution_error" } }, time);
  assert.equal(result.blocking_stage, null);
  assert.equal(result.reason, "unknown_failure");
  for (const failure of ["plan_invalid", "candidate_invalid", "semantic_verification_failed"] as const) {
    assert.equal(diagnosePattern({ domain: "pattern", authorized: true, snapshot: { ...snapshot, failure_class: failure } }, time).blocking_stage, "validation");
  }
});
test("missing, unauthorized, unsupported, stale, future and contradictory evidence preserves uncertainty", () => {
  const inputs = [
    { domain: "daily", authorized: true, snapshot },
    { domain: "pattern", authorized: false, snapshot },
    { domain: "pattern", authorized: true, snapshot: null },
    { domain: "pattern", authorized: true, snapshot: { ...snapshot, updated_at: null } },
    { domain: "pattern", authorized: true, snapshot: { ...snapshot, observed_at: "2026-09-12T00:00:00.000Z" } },
    { domain: "pattern", authorized: true, snapshot: { ...snapshot, stage: "succeeded" } },
  ];
  for (const input of inputs) assert.equal(diagnosePattern(input, time).blocking_stage, null);
  const stale = diagnosePattern({ domain: "pattern", authorized: true, snapshot }, "2026-09-11T00:10:00.000Z");
  assert.equal(stale.reason, "stale_observation");
  assert.equal(stale.observation_age_ms, 600000);
  assert.equal(stale.blocking_stage, null);
});
test("active stages are observations rather than asserted blockers; historical publication is not current retention", () => {
  const active = { ...snapshot, stage: "publishing", failure_class: null, finished_at: null, schedule: { ...snapshot.schedule, status: "queued" } };
  const report = diagnosePattern({ domain: "pattern", authorized: true, snapshot: active }, time);
  assert.equal(report.blocking_stage, null);
  assert.equal(report.publication, "not_published");
  const success = diagnosePattern({ domain: "pattern", authorized: true, snapshot: { ...snapshot, stage: "succeeded", failure_class: null, public_failure_stage: null, schedule: { ...snapshot.schedule, status: "succeeded" } } }, time);
  assert.equal(success.publication, "historically_published");
  assert.equal(success.current_reader_access, "not_collected");
});
test("strict scoped snapshot parser rejects private extras, arbitrary labels and accessor properties", () => {
  assert.ok(parsePatternDiagnostics(snapshot));
  assert.equal(parsePatternDiagnostics({ ...snapshot, prose: "private" }), null);
  assert.equal(parsePatternDiagnostics({ ...snapshot, failure_class: "<script>private</script>" }), null);
  let reads = 0;
  assert.equal(parsePatternDiagnostics(Object.defineProperty({ ...snapshot }, "stage", { get() { reads++; return "failed"; } })), null);
  assert.equal(reads, 0);
});

test("contradictory schedule or lease evidence never exposes a recovery clock", () => {
  for (const invalid of [
    { ...snapshot, stage: "publishing", failure_class: null, finished_at: null },
    { ...snapshot, provider: { ...snapshot.provider!, status: "leased", completed_at: null, lease_expires_at: "2020-01-01T00:00:00.000Z" } },
  ]) {
    const result = diagnosePattern({ domain: "pattern", authorized: true, snapshot: invalid }, time);
    assert.equal(result.reason, "contradictory_record");
    assert.equal(result.lease_expires_at, null);
    assert.equal(result.blocking_stage, null);
  }
});
