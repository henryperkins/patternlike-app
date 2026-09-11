import { types } from "node:util";

const POLICY = "weighted-work-classes/v1";
const SIMPLE_EVENTS = ["codex_runner_started", "codex_runner_stopped", "codex_runner_fatal"];

/** Runtime boundary: inspect descriptors, never stringify caller-owned objects. */
export function serializeRunnerLogEvent(input: unknown, timestamp = new Date().toISOString()): string {
  const validTimestamp = typeof timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)
    && Number.isFinite(Date.parse(timestamp)) && new Date(timestamp).toISOString() === timestamp;
  const rejected = () => JSON.stringify({ timestamp: validTimestamp ? timestamp : null, event: "codex_runner_log_rejected" });
  try {
    if (!validTimestamp || input === null || typeof input !== "object" || types.isProxy(input)) return rejected();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return rejected();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !["event", "policy", "work_class"].includes(key))) return rejected();
    if (keys.some((key) => !("value" in descriptors[key as string]!))) return rejected();
    const event = descriptors.event?.value;
    if (typeof event !== "string") return rejected();
    if (SIMPLE_EVENTS.includes(event)) {
      return keys.length === 1 ? JSON.stringify({ timestamp, event }) : rejected();
    }
    if (descriptors.policy?.value !== POLICY) return rejected();
    if (event === "codex_runner_idle") {
      return keys.length === 2 ? JSON.stringify({ timestamp, event, policy: POLICY }) : rejected();
    }
    if (!["codex_runner_job_processed", "codex_runner_poll_failed"].includes(event) || keys.length !== 3) return rejected();
    const workClass = descriptors.work_class?.value;
    if (typeof workClass !== "string" || !["text", "portrait", "mesh"].includes(workClass)) return rejected();
    return JSON.stringify({ timestamp, event, policy: POLICY, work_class: workClass });
  } catch {
    return rejected();
  }
}
