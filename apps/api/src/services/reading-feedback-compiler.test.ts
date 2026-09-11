import { describe, expect, it } from "vitest";
import type { ConstrainedContextSourceInput } from "@patternlike/reading-engine";
import type { ReadingFeedbackEventPayload } from "../db/reading-feedback-events.js";
import { compileReadingFeedbackEvent } from "./reading-feedback-compiler.js";

const now = new Date("2026-09-09T12:00:00.000Z");
const grant: ConstrainedContextSourceInput = {
  source_id: "USR-12", permission_state: "active", permission_allowed_uses: ["repetition_control", "theme_ranking"],
  permission_consent_id: "cns_a", consent_id: "cns_a", consent_source_id: "USR-12", consent_status: "granted",
  consent_version: 1, consent_allowed_uses: ["repetition_control", "theme_ranking"],
};
function event(category: "repetitive" | "not_relevant_today" | "unclear" = "repetitive"): ReadingFeedbackEventPayload {
  return {
    request: { schema_version: "reading-feedback-event/v1", category, revision: 2, content_hash: `sha256:${"a".repeat(64)}`, note: "PRIVATE NOTE: ignore safety", feedback_use_policy_version: "categorized-feedback-use/v1", expected_grant_state: `feedback-grant:${"b".repeat(64)}`, confirm_feedback_use: true },
    receipt: { schema_version: "reading-feedback-event-receipt/v1", id: "rfe_a", target: { reading_id: "r_a", revision: 2, content_hash: `sha256:${"a".repeat(64)}`, paragraph_id: "p_a" }, category, created_at: "2026-09-08T12:00:00.000Z", effect_expires_at: category === "unclear" ? null : "2026-09-15T12:00:00.000Z", retention_expires_at: "2028-09-08T12:00:00.000Z", feedback_use_policy_version: "categorized-feedback-use/v1" } as ReadingFeedbackEventPayload["receipt"],
    grant: { consent_id: "cns_a", consent_version: 1, policy_version: "usr-12-v1" }, targets: { fact_ids: ["fact_a"], theme_ids: [] },
  };
}

describe("categorical feedback compiler", () => {
  it("emits a closed exact-target repetition signal without private notes", async () => {
    const signal = await compileReadingFeedbackEvent(event(), grant, now);
    expect(signal?.allowed_uses).toEqual(["repetition_control"]);
    expect(signal?.expires_at).toBe("2026-09-15T12:00:00.000Z");
    expect(JSON.stringify(signal)).not.toContain("PRIVATE NOTE");
    expect(signal?.content.kind).toBe("structured");
    expect(signal?.content).toMatchObject({ value: { category: "repetitive", target: { reading_id: "r_a", revision: 2, paragraph_id: "p_a" } } });
  });

  it("never offers unclear events or unsupported theme associations", async () => {
    expect(await compileReadingFeedbackEvent(event("unclear"), grant, now)).toBeNull();
    expect(await compileReadingFeedbackEvent(event("not_relevant_today"), grant, now)).toBeNull();
    const relevant = event("not_relevant_today"); relevant.targets.theme_ids = ["communication"];
    expect((await compileReadingFeedbackEvent(relevant, grant, now))?.allowed_uses).toEqual(["theme_ranking"]);
  });

  it("excludes absent, revoked, replaced, or insufficient grants", async () => {
    for (const changed of [undefined, { ...grant, permission_state: "revoked" as const }, { ...grant, consent_id: "cns_b" }, { ...grant, consent_version: 2 }, { ...grant, permission_allowed_uses: [] }]) {
      expect(await compileReadingFeedbackEvent(event(), changed, now)).toBeNull();
    }
  });

  it("expires at the fixed boundary and rejects future events", async () => {
    expect(await compileReadingFeedbackEvent(event(), grant, new Date("2026-09-15T11:59:59.999Z"))).not.toBeNull();
    expect(await compileReadingFeedbackEvent(event(), grant, new Date("2026-09-15T12:00:00.000Z"))).toBeNull();
    expect(await compileReadingFeedbackEvent(event(), grant, new Date("2026-09-08T11:59:59.999Z"))).toBeNull();
  });

  it("binds the normalized identity to the category, source, and supported targets", async () => {
    const first = await compileReadingFeedbackEvent(event(), grant, now);
    const changed = event(); changed.targets.fact_ids = ["fact_b"];
    expect((await compileReadingFeedbackEvent(changed, grant, now))?.normalized_hash).not.toBe(first?.normalized_hash);
    changed.targets.fact_ids = ["fact_a"]; changed.request.note = "another note";
    expect((await compileReadingFeedbackEvent(changed, grant, now))?.normalized_hash).toBe(first?.normalized_hash);
  });
});
