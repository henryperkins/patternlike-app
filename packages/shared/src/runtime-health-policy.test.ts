import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRuntimeHealthPolicy, evaluateRuntimeHealthPolicy, type PolicySample } from "./runtime-health-policy.js";

export const syntheticPolicy = {
  schema_version: "runtime-health-policy/v1", policy_id: "synthetic-local/v1",
  work_classes: ["text", "portrait", "mesh"].map((work_class) => ({ work_class, pending_age_limit_ms: 1000, expired_lease_persistence_limit_ms: 1000 })),
  consecutive_breach_samples: 2, sampling_interval_ms: 1000,
  responder: "synthetic:operator", destination: "synthetic:local-only",
  baseline_ref: "synthetic:queue-fixture", provider_work_envelope_ref: "synthetic:timeout-fixture",
};
test("policy validation requires explicit positive limits, cadence, ownership and evidence without defaults", () => {
  assert.equal(parseRuntimeHealthPolicy(syntheticPolicy).ok, true);
  for (const key of Object.keys(syntheticPolicy)) {
    const value: Record<string, unknown> = { ...syntheticPolicy }; delete value[key];
    assert.equal(parseRuntimeHealthPolicy(value).ok, false, key);
  }
  for (const bad of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, sampling_interval_ms: bad }).ok, false);
    assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, consecutive_breach_samples: bad }).ok, false);
    for (const field of ["pending_age_limit_ms", "expired_lease_persistence_limit_ms"]) {
      assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, work_classes: syntheticPolicy.work_classes.map((v) => ({ ...v, [field]: bad })) }).ok, false);
    }
  }
  for (const field of ["responder", "destination", "baseline_ref", "provider_work_envelope_ref"]) {
    assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, [field]: "" }).ok, false);
  }
  assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, extra: "private" }).ok, false);
  assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, schema_version: "v2" }).ok, false);
  assert.equal(parseRuntimeHealthPolicy({ ...syntheticPolicy, work_classes: [syntheticPolicy.work_classes[0], syntheticPolicy.work_classes[0], syntheticPolicy.work_classes[2]] }).ok, false);
  let reads = 0;
  const hostile = Object.defineProperty({ ...syntheticPolicy }, "destination", { get() { reads++; throw Error("private"); } });
  assert.equal(parseRuntimeHealthPolicy(hostile).ok, false);
  assert.equal(reads, 0);
  assert.equal(parseRuntimeHealthPolicy(new Proxy({}, { ownKeys() { throw Error("private"); } })).ok, false);
});
function sample(ms: number, age: number | null = 2000, expired = 1, known = true): PolicySample {
  return { policy_id: syntheticPolicy.policy_id, sampled_at: new Date(Date.UTC(2026, 8, 11) + ms).toISOString(),
    work_classes: ["text", "portrait", "mesh"].map((work_class) => ({ work_class: work_class as "text" | "portrait" | "mesh", observation: known ? "known" : "unavailable", oldest_pending_age_ms: age, expired_lease_count: expired })) };
}
test("pending streak and expired persistence require separate continuous evidence", () => {
  assert.deepEqual(evaluateRuntimeHealthPolicy(syntheticPolicy, [sample(0)]).candidates, []);
  const second = evaluateRuntimeHealthPolicy(syntheticPolicy, [sample(0), sample(1000)]);
  assert.equal(second.candidates.length, 3);
  assert.ok(second.candidates.every((c) => c.condition === "pending_age"));
  const third = evaluateRuntimeHealthPolicy(syntheticPolicy, [sample(0), sample(1000), sample(2000)]);
  assert.equal(third.candidates.length, 6);
  assert.ok(third.candidates.every((c) => !JSON.stringify(c).includes("operator")));
});
test("unknown samples, gaps, duplicates, reversed time and policy changes cannot establish continuous breach", () => {
  for (const history of [[sample(0), sample(1000, null, 0, false), sample(2000)],
    [sample(0), sample(2000)], [sample(0), sample(0)], [sample(1000), sample(0)],
    [sample(0), { ...sample(1000), policy_id: "different/v1" }]]) {
    assert.equal(evaluateRuntimeHealthPolicy(syntheticPolicy, history).candidates.length, 0);
  }
  const last = sample(1000); last.work_classes[1]!.oldest_pending_age_ms = null;
  const result = evaluateRuntimeHealthPolicy(syntheticPolicy, [sample(0), last]);
  assert.deepEqual(result.candidates.map((c) => c.work_class), ["text", "mesh"]);
});
