import { describe, expect, it } from "vitest";
import { selectReaderConsequences } from "./reader-consequences.js";

describe("documented reader consequences", () => {
  it("separates retained charts, invalidated Today and erased Pattern on correction", () => {
    const result = selectReaderConsequences("correct_birth", { observedAt: 10, evidence: "known" });
    expect(result.effects.chart.content).toBe("retained");
    expect(result.effects.daily.content).toBe("invalidated");
    expect(result.effects.pattern.content).toBe("erased");
    expect(result.effects.pattern.future).toBe(null);
  });
  it("preserves completed content while withdrawing future permission", () => {
    const result = selectReaderConsequences("withdraw_pattern", { observedAt: 10, evidence: "known" });
    expect(result.effects.pattern).toEqual({ content: "retained", unfinished: "stops", future: "requires_permission" });
    expect(result.effects.artwork.content).toBe("retained");
  });
  it("does not turn saved permission or accepted deletion into erasure completion", () => {
    const result = selectReaderConsequences("delete_pattern", { observedAt: 10, evidence: "known", receipt: "accepted" });
    expect(result.receipt).toBe("accepted");
    expect(result.erasureCompleted).toBe(null);
  });
  it("uses unavailable effects instead of guessing from stale permission", () => {
    const result = selectReaderConsequences("withdraw_pattern", { observedAt: 10, evidence: "unavailable" });
    expect(result.effects.pattern).toEqual({ content: null, unfinished: null, future: null });
    expect(result.reason).toBe("observation_unavailable");
  });
  it("makes disabled automation independent from written content", () => {
    const result = selectReaderConsequences("disable_artwork", { observedAt: 10, evidence: "known" });
    expect(result.effects.pattern.content).toBe("unchanged");
    expect(result.effects.artwork).toEqual({ content: "retained", unfinished: "stops", future: "blocked" });
  });
});
