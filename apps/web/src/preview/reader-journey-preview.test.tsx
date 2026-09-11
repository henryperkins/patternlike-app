import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderJourneyPreview } from "./reader-journey-preview.js";

describe("fictional connected reading preview", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/reader-journey.html");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  it("follows the complete exact-edition journey, returns focus and scroll, and keeps response local", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<ReaderJourneyPreview />);
    await screen.findByRole("heading", { name: "Room inside a commitment" });
    const why = screen.getByRole("link", { name: "Why this passage?" });
    vi.spyOn(window, "scrollY", "get").mockReturnValue(325);
    await user.click(why);
    expect(screen.getByRole("heading", { name: "Why this passage?" })).toHaveFocus();
    const originState = window.history.state;
    const patternLink = screen.getByRole("link", { name: "Open Pattern chapter 3" });
    await user.click(patternLink);
    expect(screen.getByRole("heading", { level: 2, name: "A steadiness of your own" })).toHaveFocus();
    expect(screen.getByText("Pattern · Chapter 3 of 4 · September 5, 2026")).toBeInTheDocument();
    fireEvent.popState(window, { state: originState });
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Pattern chapter 3" })).toHaveFocus());
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 325, behavior: "instant" });
    await user.click(screen.getByRole("link", { name: "Open Pattern chapter 3" }));
    await user.click(screen.getByText("Read the complete four-chapter Pattern"));
    expect(screen.getByText("Complete text is available without artwork.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Closeness, with room to breathe" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Open Timing pass 2" }));
    expect(screen.getByRole("heading", { name: "A moment to revisit your commitments" })).toHaveFocus();
    expect(screen.getByText(/second pass falls inside/)).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open saved Daily reading" }));
    expect(screen.getByRole("heading", { name: "Keep the part that steadies you" })).toHaveFocus();
    expect(screen.getByText("Saved Daily · September 2, 2026 · Revision 2")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Mixed" }));
    await user.click(screen.getByRole("button", { name: "Try this response" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preview response: Mixed. Nothing was sent.");
    expect(fetch).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("permits a direct explained Timing branch", async () => {
    const user = userEvent.setup();
    render(<ReaderJourneyPreview />);
    await user.click(await screen.findByRole("link", { name: "Why this passage?" }));
    await user.click(screen.getByRole("link", { name: "Open Timing pass 2" }));
    expect(screen.getByRole("heading", { name: "A moment to revisit your commitments" })).toHaveFocus();
    expect(screen.queryByText("Pattern · Chapter 3 of 4 · September 5, 2026")).not.toBeInTheDocument();
  });

  it.each(["replaced_pattern", "missing_pattern", "replaced_source", "missing_source", "no_support"])("hides previously opened prose when %s becomes unavailable", async (scenario) => {
    const user = userEvent.setup();
    render(<ReaderJourneyPreview />);
    await user.click(await screen.findByRole("link", { name: "Why this passage?" }));
    await user.click(screen.getByRole("link", { name: "Open Pattern chapter 3" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), scenario);
    await screen.findByRole("heading", { name: "This exact reading is unavailable" });
    expect(screen.queryByText("The routines that support you can be small enough to change with your life.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Timing pass 2" })).not.toBeInTheDocument();
  });

  it.each(["unknown_time", "no_support"])("explains %s without manufacturing links", async (scenario) => {
    const user = userEvent.setup();
    render(<ReaderJourneyPreview />);
    await screen.findByRole("link", { name: "Why this passage?" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), scenario);
    await user.click(await screen.findByRole("link", { name: "Why this passage?" }));
    expect(screen.getByRole("heading", { name: "No supported connection" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Pattern chapter 3" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Timing pass 2" })).not.toBeInTheDocument();
  });
});
