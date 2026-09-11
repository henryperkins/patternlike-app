import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeRunnerLogEvent } from "./safe-log.js";

const now = "2026-09-11T00:00:00.000Z";
const event = { event: "codex_runner_job_processed", work_class: "text", policy: "weighted-work-classes/v1" };
test("runner logs processed separately from success and retain only closed metadata", () => {
  assert.deepEqual(JSON.parse(serializeRunnerLogEvent(event, now)), { timestamp: now, ...event });
  for (const name of ["codex_runner_started", "codex_runner_stopped", "codex_runner_fatal"]) {
    assert.equal(JSON.parse(serializeRunnerLogEvent({ event: name }, now)).event, name);
  }
  assert.equal(JSON.parse(serializeRunnerLogEvent({ event: "codex_runner_idle", policy: event.policy }, now)).event, "codex_runner_idle");
});
test("hostile objects, private extras, symbols and invalid strings never reach logs", () => {
  let reads = 0;
  const hostile: unknown[] = [null, new Error("private"), { ...event, job_id: "private" },
    { ...event, work_class: "private" }, { ...event, policy: "x".repeat(100000) },
    { event: "codex_runner_succeeded" }, { ...event, [Symbol("private")]: true },
    Object.create(event), new Proxy(event, {}),
    new Proxy(event, { ownKeys() { throw new Error("private"); } }),
    new Proxy(event, { getOwnPropertyDescriptor() { throw new Error("private"); } }),
    new Proxy(event, { getPrototypeOf() { throw new Error("private"); } })];
  for (const key of ["event", "toJSON", "toString", "message", "stack", "hidden"]) {
    for (const enumerable of [true, false]) {
      hostile.push(Object.defineProperty({ ...event }, key, { enumerable, get() { reads++; throw new Error("private"); } }));
    }
  }
  for (const input of hostile) {
    const result = serializeRunnerLogEvent(input, now);
    assert.deepEqual(JSON.parse(result), { timestamp: now, event: "codex_runner_log_rejected" });
    assert.ok(result.length < 150);
  }
  assert.equal(reads, 0);
});
test("invalid timestamps use a fixed null timestamp without throwing", () => {
  assert.deepEqual(JSON.parse(serializeRunnerLogEvent(event, "private")), { timestamp: null, event: "codex_runner_log_rejected" });
});
