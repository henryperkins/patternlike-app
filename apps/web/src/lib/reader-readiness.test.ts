import { describe, expect, it } from "vitest";
import type { PatternStateDocumentV9 } from "@patternlike/shared";
import { selectReaderReadiness, type ReaderScope, type Observation } from "./reader-readiness.js";

const scope: ReaderScope = { accountId: "account-a", sessionEpoch: 1, chartId: "chart-a", profileVersion: 1, source: "edition-a" };
const now = 1_000_000;
const observe = <T>(value: T): Observation<T> => ({ scope, requestGeneration: 2, observedAt: now, evidence: "known", value });
const state = (overrides: Partial<PatternStateDocumentV9> = {}): PatternStateDocumentV9 => ({
  schema_version: "0.9.0", state: "ready", chart: { chart_id: "chart-a", effective_accuracy: "exact", feature_policy_version: "1" },
  consent: { status: "granted", policy_version: "1" } as PatternStateDocumentV9["consent"],
  pattern: { pattern_id: "p", generated_at: "2026-09-11T00:00:00Z", locale: "en-US", effective_accuracy: "exact" },
  generation: null, regeneration: null, ...overrides,
});
const failure = { generation_id: "g", stage: "writing" as const, status_updated_at: "2026-09-11T00:00:00Z", started_at: "2026-09-11T00:00:00Z", retryable: true, request_id: null };
const select = (pattern: Observation<PatternStateDocumentV9>, extra = {}) => selectReaderReadiness({ scope, requestGeneration: 2, now, pattern, patternDocumentMatches: true, chapterCount: 4, ...extra });

describe("reader readiness composition", () => {
  it("keeps an accepted reading ready independently of failed replacement and unavailable artwork", () => {
    const result = select(observe(state({ regeneration: { eligible: true, failure, generation: null } })));
    expect(result.pattern.code).toBe("ready");
    expect(result.patternReplacement.code).toBe("retryable_failure");
    expect(result.patternReplacement.actions.map(action => action.type)).toContain("retry_generation");
    expect(result.artwork.code).toBe("unavailable");
  });
  it.each([false, undefined, null])("requires explicit retry eligibility: %s", (retryable) => {
    const result = select(observe(state({ state: "failed", pattern: null, generation: { ...failure, retryable } as typeof failure })));
    expect(result.pattern.code).toBe("unavailable");
    expect(result.pattern.actions.map(action => action.type)).toEqual(["reload_status"]);
  });
  it("rejects contradictory replacement eligibility", () => {
    expect(select(observe(state({ regeneration: { eligible: false, failure, generation: null } }))).patternReplacement.actions.map(a => a.type)).toEqual(["reload_status"]);
  });
  it.each([3, 5, 6])("keeps %s chapter reading usable while optional artwork status is unknown", chapterCount => {
    const result = select(observe(state()), { chapterCount });
    expect(result.pattern.code).toBe("ready");
    expect(result.artwork.reason).toBe("observation_unavailable");
    expect(result.artwork.actions.map(action => action.type)).toEqual(["reload_status"]);
  });
  it.each([
    { scope: { ...scope, accountId: "account-b" } },
    { scope: { ...scope, sessionEpoch: 2 } },
    { scope: { ...scope, chartId: "chart-b" } },
    { scope: { ...scope, source: "edition-b" } },
    { requestGeneration: 1 },
    { observedAt: now - 60_001 },
    { observedAt: now + 1 },
    { evidence: "unavailable" as const },
  ])("fences stale and mismatched authority %j", changes => {
    const result = select({ ...observe(state({ state: "available" })), ...changes });
    expect(result.pattern.actions.map(a => a.type)).toEqual(["reload_status"]);
    expect(result.pattern.code).toBe("unavailable");
  });
  it("does not invent a queue stage or completion from progress", () => {
    expect(select(observe(state({ state: "organizing_evidence", pattern: null }))).pattern.code).toBe("working");
  });
  it("keeps granted reading access independent from generation permission", () => {
    expect(select(observe(state({ consent: null }))).pattern.code).toBe("ready");
  });
  it("retains a matching accepted reading after uncertain refresh but removes mutation authority", () => {
    const result = select({ ...observe(state({ regeneration: { eligible: true, generation: null, failure: null } })), evidence: "unavailable" }, { retainAcceptedPattern: true });
    expect(result.pattern.code).toBe("ready");
    expect(result.patternReplacement.actions.map(a => a.type)).toEqual(["reload_status"]);
  });
  it("does not retain a reading across account changes", () => {
    expect(select({ ...observe(state()), scope: { ...scope, accountId: "b" } }, { retainAcceptedPattern: true }).pattern.code).toBe("unavailable");
  });
  it("describes an absent Daily GET as unknown availability with no mutation", () => {
    const result = selectReaderReadiness({ scope, requestGeneration: 2, now, daily: observe({ kind: "absent" }) });
    expect(result.daily.code).toBe("unavailable");
    expect(result.daily.actions.map(a => a.type)).toEqual(["reload_status"]);
  });
  it("routes scheduling-zone input to the timezone form", () => {
    const result = selectReaderReadiness({ scope, requestGeneration: 2, now, daily: observe({ kind: "needs_preference", preference: "timezone" }) });
    expect(result.daily.actions[0]).toMatchObject({ type: "confirm_locale", preference: "timezone" });
  });
});
