import { diagnosticArray, diagnosticInteger, diagnosticRecord, diagnosticTimestamp } from "./diagnostic-data.js";

type WorkClass = "text" | "portrait" | "mesh";
const CLASSES: readonly WorkClass[] = ["text", "portrait", "mesh"];
export interface RuntimeHealthPolicy {
  schema_version: "runtime-health-policy/v1";
  policy_id: string;
  work_classes: { work_class: WorkClass; pending_age_limit_ms: number; expired_lease_persistence_limit_ms: number }[];
  consecutive_breach_samples: number;
  sampling_interval_ms: number;
  responder: string;
  destination: string;
  baseline_ref: string;
  provider_work_envelope_ref: string;
}
const POLICY_KEYS = ["schema_version", "policy_id", "work_classes", "consecutive_breach_samples", "sampling_interval_ms", "responder", "destination", "baseline_ref", "provider_work_envelope_ref"];
const reference = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(v);
const positive = (v: unknown): v is number => diagnosticInteger(v) && v > 0;
export function parseRuntimeHealthPolicy(input: unknown): { ok: true; policy: RuntimeHealthPolicy } | { ok: false; reason: "invalid_policy" } {
  const invalid = { ok: false, reason: "invalid_policy" } as const;
  const record = diagnosticRecord(input, POLICY_KEYS);
  if (!record || record.schema_version !== "runtime-health-policy/v1" || !reference(record.policy_id)
    || !positive(record.consecutive_breach_samples) || !positive(record.sampling_interval_ms)) return invalid;
  for (const key of ["responder", "destination", "baseline_ref", "provider_work_envelope_ref"]) if (!reference(record[key])) return invalid;
  const rawClasses = diagnosticArray(record.work_classes, 3);
  if (!rawClasses) return invalid;
  const policies: RuntimeHealthPolicy["work_classes"] = [];
  for (const item of rawClasses) {
    const value = diagnosticRecord(item, ["work_class", "pending_age_limit_ms", "expired_lease_persistence_limit_ms"]);
    if (!value || !CLASSES.includes(value.work_class as WorkClass) || !positive(value.pending_age_limit_ms)
      || !positive(value.expired_lease_persistence_limit_ms) || policies.some((p) => p.work_class === value.work_class)) return invalid;
    policies.push({ work_class: value.work_class as WorkClass, pending_age_limit_ms: value.pending_age_limit_ms, expired_lease_persistence_limit_ms: value.expired_lease_persistence_limit_ms });
  }
  return { ok: true, policy: { schema_version: "runtime-health-policy/v1", policy_id: record.policy_id,
    work_classes: policies, consecutive_breach_samples: record.consecutive_breach_samples, sampling_interval_ms: record.sampling_interval_ms,
    responder: record.responder as string, destination: record.destination as string,
    baseline_ref: record.baseline_ref as string, provider_work_envelope_ref: record.provider_work_envelope_ref as string } };
}
export interface PolicySample {
  policy_id: string;
  sampled_at: string;
  work_classes: { work_class: WorkClass; observation: "known" | "unavailable"; oldest_pending_age_ms: number | null; expired_lease_count: number | null }[];
}
export interface RuntimeHealthAlertCandidate {
  event: "runtime_health_threshold_candidate";
  work_class: WorkClass;
  condition: "pending_age" | "expired_lease_persistence";
  policy_id: string;
  sampled_at: string;
  consecutive_samples: number;
}
/** Offline evaluation only. Candidates neither configure a timer nor send messages. */
export function evaluateRuntimeHealthPolicy(input: unknown, samples: readonly PolicySample[]): {
  candidates: RuntimeHealthAlertCandidate[]; evidence: "continuous" | "restarted" | "invalid_policy";
} {
  const parsed = parseRuntimeHealthPolicy(input);
  if (!parsed.ok) return { candidates: [], evidence: "invalid_policy" };
  const policy = parsed.policy;
  const fresh = () => ({ age: 0, lease: 0, expiredSince: null as number | null });
  let states = { text: fresh(), portrait: fresh(), mesh: fresh() };
  let previous: number | null = null;
  let evidence: "continuous" | "restarted" = "continuous";
  let candidates: RuntimeHealthAlertCandidate[] = [];
  for (const sample of samples) {
    candidates = [];
    const now = diagnosticTimestamp(sample.sampled_at) ? Date.parse(sample.sampled_at) : NaN;
    if (!Number.isFinite(now) || sample.policy_id !== policy.policy_id || (previous !== null && now <= previous)) {
      states = { text: fresh(), portrait: fresh(), mesh: fresh() }; previous = null; evidence = "restarted"; continue;
    }
    if (previous !== null && now - previous !== policy.sampling_interval_ms) {
      states = { text: fresh(), portrait: fresh(), mesh: fresh() }; evidence = "restarted";
    }
    previous = now;
    for (const limits of policy.work_classes) {
      const matches = sample.work_classes.filter((c) => c.work_class === limits.work_class);
      const value = matches.length === 1 ? matches[0] : undefined;
      const state = states[limits.work_class];
      if (!value || value.observation !== "known"
        || (value.oldest_pending_age_ms !== null && !diagnosticInteger(value.oldest_pending_age_ms))
        || !diagnosticInteger(value.expired_lease_count)) {
        states[limits.work_class] = fresh(); evidence = "restarted"; continue;
      }
      state.age = value.oldest_pending_age_ms !== null && value.oldest_pending_age_ms > limits.pending_age_limit_ms ? state.age + 1 : 0;
      if (value.expired_lease_count > 0) {
        state.expiredSince ??= now;
        state.lease = now - state.expiredSince >= limits.expired_lease_persistence_limit_ms ? state.lease + 1 : 0;
      } else { state.expiredSince = null; state.lease = 0; }
      for (const [condition, count] of [["pending_age", state.age], ["expired_lease_persistence", state.lease]] as const) {
        if (count >= policy.consecutive_breach_samples) candidates.push({ event: "runtime_health_threshold_candidate", work_class: limits.work_class,
          condition, policy_id: policy.policy_id, sampled_at: sample.sampled_at, consecutive_samples: count });
      }
    }
  }
  return { candidates, evidence };
}
