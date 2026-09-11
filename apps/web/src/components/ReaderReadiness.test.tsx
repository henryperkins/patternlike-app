import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderConsequences } from "./ReaderReadiness.js";

describe("consequence observation boundary", () => {
  it("does not assert known effects without an authorized observation", () => {
    const { container } = render(<ReaderConsequences action="correct_birth" />);
    expect(container.querySelector("[data-evidence]")).toHaveAttribute("data-evidence", "unavailable");
    expect(screen.queryByText(/previous Pattern.*erased/)).not.toBeInTheDocument();
  });
  it("expires consequence evidence rather than manufacturing a new receipt time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    try {
      const { container } = render(<ReaderConsequences action="withdraw_pattern" observedAt={100_000} evidence="known" />);
      expect(container.querySelector("[data-evidence]")).toHaveAttribute("data-evidence", "known");
      act(() => vi.advanceTimersByTime(60_001));
      expect(container.querySelector("[data-evidence]")).toHaveAttribute("data-evidence", "unavailable");
    } finally { vi.useRealTimers(); }
  });
  it("rejects an already stale observation", () => {
    const { container } = render(<ReaderConsequences action="withdraw_pattern" observedAt={Date.now() - 60_001} evidence="known" />);
    expect(container.querySelector("[data-evidence]")).toHaveAttribute("data-evidence", "unavailable");
  });
});
