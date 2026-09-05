import { useEffect } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fictionalPattern } from "../preview/pattern-portrait-fixture.js";
import { imageStudyBindings } from "../preview/image-study.js";
import { PatternPortrait } from "./PatternPortrait.js";

const graphics = vi.hoisted(() => ({ fail: false, ready: true, props: vi.fn() }));
vi.mock("./PatternSculpture.js", () => ({
  default: (props: { onReady: () => void; onUnavailable: () => void }) => {
    graphics.props(props);
    const { onReady, onUnavailable } = props;
    useEffect(() => { if (graphics.ready) onReady(); }, [onReady]);
    if (graphics.fail) throw new Error("Graphics unavailable");
    return <div data-testid="sculpture"><button onClick={onUnavailable}>Simulate graphics loss</button></div>;
  },
}));

beforeEach(() => {
  graphics.fail = false;
  graphics.ready = true;
  // jsdom has no native scrolling; mode changes now intentionally use it.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
const ready = { status: "ready" as const, document: fictionalPattern };

describe("Pattern portrait reader", () => {
  it("keeps star selection in place until Read chapter is requested, even after earlier navigation", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const user = userEvent.setup();
      render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
      await screen.findByTestId("sculpture");
      await user.click(screen.getByRole("button", { name: /Giving your ideas a place/ }));
      scroll.mockClear();
      act(() => graphics.props.mock.lastCall![0].onSelect(0));
      expect(scroll).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Read chapter" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Read chapter" }));
      expect(screen.getByRole("region", { name: "Closeness, with room to breathe" })).toHaveFocus();
      expect(scroll).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("button", { name: "Resources" }));
      await user.click(screen.getByRole("button", { name: "Back to constellation" }));
      expect(screen.getByRole("group", { name: "Interactive 3D constellation" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "Resources" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Closeness, with room to breathe" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Read chapter" }));
      await user.click(screen.getByRole("button", { name: "Reading view" }));
      await user.click(screen.getByRole("button", { name: "3D view" }));
      expect(screen.getByRole("group", { name: "Interactive 3D constellation" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "Resources" })).toHaveAttribute("aria-pressed", "true");
      await user.selectOptions(screen.getByRole("combobox", { name: "Choose chapter" }), "chapter-3");
      expect(screen.getByRole("heading", { name: "A steadiness of your own" })).toBeInTheDocument();
      await user.selectOptions(screen.getByRole("combobox", { name: "Choose chapter" }), "");
      expect(screen.queryByRole("button", { name: "Read chapter" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "A little room to explore" })).toBeInTheDocument();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
  it("waits for a fresh renderer when a quick sign change returns to the last ready sign", async () => {
    const { rerender } = render(<PatternPortrait source={{ ...ready, sunSign: "aries" }} objectBindings={imageStudyBindings} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled());
    graphics.ready = false;
    rerender(<PatternPortrait source={{ ...ready, sunSign: "pisces" }} objectBindings={imageStudyBindings} />);
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
    rerender(<PatternPortrait source={{ ...ready, sunSign: "aries" }} objectBindings={imageStudyBindings} />);
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
  });

  it("passes the supplied Sun sign to the shape and preserves the selected chapter when it changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PatternPortrait source={{ ...ready, sunSign: "aries" }} objectBindings={imageStudyBindings} />);
    await screen.findByTestId("sculpture");
    expect(graphics.props.mock.lastCall![0].sunSign).toBe("aries");
    await user.click(screen.getByRole("button", { name: /Giving your ideas a place/ }));
    graphics.ready = false;
    rerender(<PatternPortrait source={{ ...ready, sunSign: "pisces" }} objectBindings={imageStudyBindings} />);
    expect(graphics.props.mock.lastCall![0].sunSign).toBe("pisces");
    expect(screen.getByRole("heading", { name: "Giving your ideas a place" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
    expect(screen.getByText(/Pisces Sun/)).toBeInTheDocument();
    rerender(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    expect(graphics.props.mock.lastCall![0].sunSign).toBeNull();
    expect(screen.queryByText(/Pisces Sun/)).not.toBeInTheDocument();
  });

  it("shows all four image references and gives the renderer no reading or object metadata", async () => {
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await screen.findByTestId("sculpture");
    expect(screen.getAllByRole("img", { name: /Generated chapter object/ })).toHaveLength(4);
    const props = graphics.props.mock.lastCall![0];
    expect(props.imageUrls).toHaveLength(4);
    expect(props).not.toHaveProperty("manifest");
    expect(props).not.toHaveProperty("objectBindings");
    expect(JSON.stringify(props)).not.toContain(fictionalPattern.core_chapters[0].summary);
  });

  it("keeps reading but withholds the sculpture when any image binding is missing", async () => {
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings.slice(0, 3)} />);
    expect(screen.getByText(/Four chapter images are needed/)).toBeInTheDocument();
    expect(screen.queryByTestId("sculpture")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
  });
  it("lets a reader inspect the chapter object without losing the selected reading", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const { rerender } = render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
      await user.click(screen.getByRole("button", { name: /Closeness, with room to breathe/ }));
      expect(screen.getByRole("note", { name: "Chapter object" })).toHaveTextContent(imageStudyBindings[0].object.rationale);
      await user.click(screen.getByRole("button", { name: "View the whole constellation" }));
      expect(screen.getByRole("group", { name: "Interactive 3D constellation" })).toHaveFocus();
      expect(screen.getByRole("button", { name: /Closeness, with room to breathe/ })).toHaveAttribute("aria-pressed", "true");
      expect(scroll).toHaveBeenCalled();
      rerender(<PatternPortrait source={{ status: "ready", document: { ...fictionalPattern, pattern_id: "replacement" } }} objectBindings={imageStudyBindings} />);
      await user.click(screen.getByRole("button", { name: /Closeness, with room to breathe/ }));
      expect(screen.queryByRole("note", { name: "Chapter object" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View the whole constellation" })).not.toBeInTheDocument();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("lets a keyboard reader select a chapter and explore every expression", async () => {
    const user = userEvent.setup();
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    const chapter = screen.getByRole("button", { name: /Closeness, with room to breathe/ });
    chapter.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: fictionalPattern.core_chapters[0].title })).toBeInTheDocument();
    expect(screen.getByText(fictionalPattern.core_chapters[0].sections[1].text)).toBeInTheDocument();
    for (const [name, text] of [
      ["Tensions", fictionalPattern.core_chapters[0].tensions[0].text],
      ["Resources", fictionalPattern.core_chapters[0].resources[0].text],
      ["Another expression", fictionalPattern.core_chapters[0].counter_expression.text],
    ]) {
      await user.click(screen.getByRole("button", { name }));
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("provides every chapter and expression in a complete reading view", async () => {
    const user = userEvent.setup();
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await user.click(screen.getByRole("button", { name: "Reading view" }));
    const reading = screen.getByRole("region", { name: "Complete Pattern reading" });
    for (const chapter of fictionalPattern.core_chapters) {
      expect(within(reading).getByRole("heading", { name: chapter.title })).toBeInTheDocument();
      expect(within(reading).getByText(chapter.counter_expression.text)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("sculpture")).not.toBeInTheDocument();
  });

  it("resets selection and old text when a replacement is published", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await user.click(screen.getByRole("button", { name: /Giving your ideas a place/ }));
    const replacement = { ...fictionalPattern, pattern_id: "pat_replaced", core_chapters: fictionalPattern.core_chapters.map((chapter, index) => ({ ...chapter, title: `Replacement chapter ${index + 1}`, summary: "Replacement summary." })) };
    rerender(<PatternPortrait source={{ status: "ready", document: replacement }} />);
    expect(screen.queryByText("Giving your ideas a place")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A little room to explore" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Replacement chapter/ })).toHaveLength(4);
  });

  it("removes the portrait and prose immediately when the source is removed or loading", async () => {
    const { rerender } = render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await screen.findByTestId("sculpture");
    rerender(<PatternPortrait source={{ status: "unavailable" }} />);
    expect(screen.queryByTestId("sculpture")).not.toBeInTheDocument();
    expect(screen.queryByText(fictionalPattern.core_chapters[0].title)).not.toBeInTheDocument();
    expect(screen.getByText("No Pattern to display")).toBeInTheDocument();
    rerender(<PatternPortrait source={{ status: "loading" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your Pattern");
  });

  it("keeps the published uncertainty visible for unknown birth time", () => {
    render(<PatternPortrait source={{ status: "ready", document: { ...fictionalPattern, effective_accuracy: "unknown", uncertainty: { text: "Houses and angles are unavailable." } } }} />);
    expect(screen.getByText("Birth time unknown")).toBeInTheDocument();
    expect(screen.getByText("Houses and angles are unavailable.")).toBeInTheDocument();
  });

  it("retains reading when the graphics renderer throws", async () => {
    graphics.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await screen.findByText(/3D is unavailable/);
    await user.click(screen.getByRole("button", { name: /Closeness, with room to breathe/ }));
    expect(screen.getByText(fictionalPattern.core_chapters[0].summary)).toBeInTheDocument();
  });

  it("disables camera actions when an already-ready graphics context is lost", async () => {
    const user = userEvent.setup();
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await screen.findByTestId("sculpture");
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Simulate graphics loss" }));
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
  });

  it("disables controls immediately while replacement image assets load", async () => {
    const { rerender } = render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled());
    graphics.ready = false;
    const replacement = imageStudyBindings.map((binding) => ({ ...binding, object: { ...binding.object, imageUrl: `${binding.object.imageUrl}?replacement` } }));
    rerender(<PatternPortrait source={ready} objectBindings={replacement} />);
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
  });

  it("waits for a new renderer when returning from reading view", async () => {
    const user = userEvent.setup();
    render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
    await screen.findByTestId("sculpture");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled());
    graphics.ready = false;
    await user.click(screen.getByRole("button", { name: "Reading view" }));
    await user.click(screen.getByRole("button", { name: "3D view" }));
    await screen.findByTestId("sculpture");
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
  });

  it("brings the chosen chapter into view on a narrow screen", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const user = userEvent.setup();
      render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
      await user.click(screen.getByRole("button", { name: /Giving your ideas a place/ }));
      expect(screen.getByRole("region", { name: "Giving your ideas a place" })).toHaveFocus();
      expect(scroll).toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("reveals the next chapter when its heading is above the desktop viewport", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const user = userEvent.setup();
      render(<PatternPortrait source={ready} objectBindings={imageStudyBindings} />);
      await user.click(screen.getByRole("button", { name: /Closeness, with room to breathe/ }));
      const reader = screen.getByRole("region", { name: "Closeness, with room to breathe" });
      vi.spyOn(reader, "getBoundingClientRect").mockReturnValue({ top: -400, bottom: 450 } as DOMRect);
      await user.click(screen.getByRole("button", { name: "Next chapter" }));
      expect(screen.getByRole("region", { name: "Giving your ideas a place" })).toHaveFocus();
      expect(scroll).toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
