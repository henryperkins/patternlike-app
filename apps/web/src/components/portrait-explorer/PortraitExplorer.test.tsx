import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeImageBindings, nativePattern } from "../../preview/native-image-study.js";
import { createPortraitManifest } from "../../lib/pattern-portrait.js";
import type { PortraitMeshBundle, PortraitSceneProps } from "./types.js";
import { PortraitExplorer } from "./PortraitExplorer.js";
import { clearExplorerMemory, createExplorerMemory, useExplorerNavigation } from "./use-explorer-navigation.js";

const scene = vi.hoisted(() => ({ props: null as PortraitSceneProps | null }));
vi.mock("./PortraitScene.js", () => ({ default: (props: PortraitSceneProps) => {
  scene.props = props;
  useEffect(() => { props.onStatus("ready"); }, [props.onStatus]);
  return <div data-testid="scene"><button onClick={() => props.onSelect("chapter-1")}>Pick compass body</button><button onClick={() => props.onAnnotation(props.selectedIds[0])}>Open scene annotation</button><button onClick={() => props.onStatus("unavailable")}>Lose graphics</button></div>;
} }));
const source = { status: "ready" as const, document: nativePattern };
const manifest = createPortraitManifest(nativePattern, nativeImageBindings);
const bundle: PortraitMeshBundle = { version: "portrait-mesh-1", authoring: "authored-fictional-fixtures", documentRevision: manifest.revision,
  assets: nativeImageBindings.map((binding, index) => ({ chapterId: binding.chapterId, url: `/fixture-${index}.glb`, sha256: "a".repeat(64), sourceImageSha256: binding.object.referenceSha256, sourceText: binding.sourceText })),
};
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  window.history.replaceState(null, "");
  scene.props = null;
});
function mount(mobile = false) {
  const view = render(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} />);
  if (mobile) {
    document.querySelector<HTMLElement>(".explorer-mobile-modes")!.style.display = "flex";
    const bounds = HTMLElement.prototype.getBoundingClientRect;
    // jsdom has no layout. Model a chapter well below the account page's top.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches(".explorer-reader h2") ? new DOMRect(20, 3600 - window.scrollY, 350, 80) : bounds.call(this);
    });
  }
  return view;
}
async function chapter(user: ReturnType<typeof userEvent.setup>, ordinal = 1) {
  const navigation = screen.getByRole("navigation", { name: "Pattern chapters" });
  await user.click(within(navigation).getByRole("button", { name: new RegExp(`^${ordinal}\\.`) }));
}

describe("Portrait exploration", () => {
  it.each([3, 4, 5, 6])("opens a %i-chapter reading in the observatory without requiring artwork", async (count) => {
    const document = { ...nativePattern, core_chapters: Array.from({ length: count }, (_, index) => ({ ...nativePattern.core_chapters[index % 4], title: `Published chapter ${index + 1}` })) };
    render(<PortraitExplorer source={{ status: "ready", document }} />);
    await screen.findByTestId("scene");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled());
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(within(screen.getByRole("navigation", { name: "Pattern chapters" })).getAllByRole("button")).toHaveLength(count);
    await userEvent.click(screen.getByRole("button", { name: "Your sky" }));
    expect(screen.getByText(/^Your chapters bring the chart into a personal reading\./)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Full reading" }));
    for (const item of document.core_chapters) expect(screen.getByRole("heading", { name: item.title })).toBeVisible();
    expect(screen.queryByText(/authored models|fictional study/i)).not.toBeInTheDocument();
  });

  it.each([[3, "three"], [4, "four"], [5, "five"], [6, "six"]] as const)(
    "counts the courtyard's chapter spaces for a %i-chapter reading",
    async (count, word) => {
      const user = userEvent.setup();
      const document = { ...nativePattern, core_chapters: Array.from({ length: count }, (_, index) => ({ ...nativePattern.core_chapters[index % 4], title: `Published chapter ${index + 1}` })) };
      render(<PortraitExplorer source={{ status: "ready", document }} />);
      await screen.findByTestId("scene");
      await user.click(screen.getByText("Scene options"));
      expect(screen.getByText(`A court, ${word} chapter spaces. Choose a chapter to approach its display.`)).toBeVisible();
    },
  );

  it("retains display choices and camera bookmarks across account close and reopen", async () => {
    const memory = createExplorerMemory();
    function Account() {
      const navigation = useExplorerNavigation(manifest.chapters.map(item => item.id), { embedded: true, memory });
      return navigation.isOpen
        ? <PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} navigation={navigation} />
        : <button onClick={navigation.open}>Open portrait</button>;
    }
    const user = userEvent.setup();
    const view = render(<Account />);
    await user.click(screen.getByRole("button", { name: "Open portrait" }));
    await screen.findByTestId("scene");
    await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByText("Scene options"));
    for (const name of ["Dusk", "Show roof", "Open reading desk", "Turn chapter object", "Look closer"]) await user.click(screen.getByRole("button", { name }));
    const bookmark = { position: [-3, 3, 6] as [number, number, number], target: [-2, 1, -1] as [number, number, number], frameDistance: 8 };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    await user.click(screen.getByRole("button", { name: "Back to reading" }));
    await waitFor(() => expect(window.history.state?.portrait).toBeUndefined());
    // Remounting the account route still uses the same private session.
    view.unmount();
    render(<Account />);
    await user.click(screen.getByRole("button", { name: "Open portrait" }));
    await screen.findByTestId("scene");
    await user.click(screen.getByText("Scene options"));
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cut away roof" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close reading desk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Step back" })).toHaveAttribute("aria-pressed", "true");
    expect(scene.props!.experience!.turns["chapter-2"]).toBe(1);
    expect(scene.props!.bookmark).toEqual(bookmark);
    expect(JSON.stringify(window.history.state)).not.toContain("chapter-2");
    expect(window.location.href).not.toContain("chapter-2");
    const save = scene.props!.onBookmark, key = scene.props!.viewKey;
    act(() => clearExplorerMemory(memory));
    // A disposed renderer cannot put its last camera back into invalidated memory.
    act(() => save(key, bookmark));
    expect(memory.scene).toBeNull();
  });

  it("shows the whole current layout on unfold and returns to the exact chapter with Back", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Look closer" }));
    const bookmark = { position: [4, 3, 2] as [number, number, number], target: [1, 1, 1] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    await user.click(screen.getByRole("button", { name: /^Unfold portrait/ }));
    expect(scene.props!.selectedIds).toEqual([]);
    expect(scene.props!.unfolded).toBe(true);
    const command = scene.props!.command.serial;
    const historyIndex = window.history.state.portrait.index;
    await user.click(screen.getByRole("button", { name: "Whole portrait" }));
    expect(scene.props!.unfolded).toBe(true);
    expect(scene.props!.command.serial).toBeGreaterThan(command);
    expect(window.history.state.portrait.index).toBe(historyIndex);
    act(() => window.history.back());
    await waitFor(() => expect(scene.props!.selectedIds).toEqual(["chapter-1"]));
    expect(scene.props!.unfolded).toBe(false);
    expect(scene.props!.bookmark).toEqual(bookmark);
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
  });

  it("links either compared chapter to its own complete source passage without breaking the pair", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    const navigation = screen.getByRole("navigation", { name: "Compared chapters" });
    expect(within(navigation).getAllByRole("button")).toHaveLength(2);
    const second = screen.getByRole("region", { name: nativePattern.core_chapters[1].title });
    await user.click(within(second).getByRole("button", { name: "Show passage 2 in portrait" }));
    await waitFor(() => expect(within(navigation).getAllByRole("button")[1]).toHaveFocus());
    act(() => scene.props!.onAnnotation("chapter-2"));
    expect(screen.getByText(nativePattern.core_chapters[1].sections[1].text)).toHaveFocus();
    expect(scene.props!.selectedIds).toEqual(["chapter-1", "chapter-2"]);
    for (const item of nativePattern.core_chapters.slice(0, 2)) for (const paragraph of item.sections) expect(screen.getByText(paragraph.text)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    act(() => scene.props!.onAnnotation("chapter-2"));
    expect(screen.getByText(nativePattern.core_chapters[1].resources[0].text)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "End comparison" }));
    await waitFor(() => expect(scene.props?.selectedIds).toEqual(["chapter-1"]));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps comparison motion and graphics settings available when the scene is paused", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByText("Scene controls & motion"));
    await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    await user.click(screen.getByRole("checkbox", { name: "Reduce motion" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Graphics" }), "low");
    expect(scene.props!.quality).toBe("low");
    expect(scene.props!.reducedMotion).toBe(true);
    expect(screen.getByRole("button", { name: "End comparison" })).toBeEnabled();
    expect(screen.getByText(nativePattern.core_chapters[1].sections[0].text)).toBeInTheDocument();
  });

  it("keeps the comparison pair through expanded passage links and restores the originating camera on exit", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    const bookmark = { position: [4, 2, -3] as [number, number, number], target: [1, 0, 0] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    act(() => scene.props!.onAnnotation("chapter-2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(nativePattern.core_chapters[1].sections[0].text)).toHaveFocus();
    expect(scene.props!.selectedIds).toEqual(["chapter-1", "chapter-2"]);
    await user.click(screen.getByRole("button", { name: "End comparison" }));
    await waitFor(() => expect(scene.props!.bookmark).toEqual(bookmark));
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
  });

  it("focuses the visible second comparison passage when returning from the sky reader", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    const text = nativePattern.core_chapters[1].sections[0].text;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.matches(".explorer-reader")) return new DOMRect(0, -1000, 390, 2400);
      return this.tagName === "P" && this.textContent === text ? new DOMRect(20, 240, 350, 150) : new DOMRect(0, -500, 350, 80);
    });
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await user.click(screen.getByRole("button", { name: "Explore your Pattern" }));
    await waitFor(() => expect(screen.getByText(text)).toHaveFocus());
  });

  it("returns directly to Pattern from an expanded sky and keeps body choices when closing only the expansion", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("tab", { name: "Tensions" }));
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    act(() => scene.props!.onSelectSkyBody!("moon"));
    await user.click(screen.getByRole("button", { name: "Close expanded scene" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(scene.props?.skyView).toBe(true);
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    await user.click(screen.getByRole("button", { name: "Back to Pattern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(scene.props?.skyView).toBe(false);
    expect(scene.props?.facet).toBe("tensions");
  });

  it("closes the expanded scene even when sky was opened inside it", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    act(() => scene.props!.onSelectSkyBody!("sun"));
    await user.click(screen.getByRole("button", { name: "Close expanded scene" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(scene.props?.skyView).toBe(false);
    expect(scene.props?.selectedIds).toEqual(["chapter-1"]);
  });

  it("returns from sky before undoing the chapter facet, and restores sky on Forward", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user);
    await user.click(screen.getByRole("tab", { name: "Tensions" }));
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await act(async () => {
      const done = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
      window.history.back(); await done;
    });
    expect(scene.props?.skyView).toBe(false);
    expect(screen.getByRole("tab", { name: "Tensions" })).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      const done = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
      window.history.forward(); await done;
    });
    expect(scene.props?.skyView).toBe(true);
    await user.click(screen.getByRole("button", { name: "Back to Pattern" }));
    await waitFor(() => expect(scene.props?.skyView).toBe(false));
    expect(screen.getByRole("tab", { name: "Tensions" })).toHaveAttribute("aria-selected", "true");
  });

  it("returns focus to the selected chapter when leaving the sky reader", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user, 2);
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await user.click(screen.getByRole("button", { name: "Explore your Pattern" }));
    expect(screen.getByRole("heading", { name: nativePattern.core_chapters[1].title })).toHaveFocus();
  });

  it("does not invite readers to find placements that are unavailable", async () => {
    mount(); await screen.findByTestId("scene");
    expect(screen.queryByText(/Find your Sun, Moon, and rising/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your Pattern, in 4 chapters" })).toBeVisible();
  });

  it("keeps one chapter introduction and reads the first chapter with its identity beside Return", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene");
    expect(document.querySelector(".explorer-entry-invitation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Your Pattern, in 4 chapters" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
    expect(scene.props?.selectedIds).toEqual(["chapter-1"]);
    expect(screen.getByRole("heading", { name: nativePattern.core_chapters[0].title })).toBeVisible();
    expect(screen.getByRole("button", { name: "Return to portrait" }).closest(".explorer-mobile-modes")).toHaveTextContent(nativePattern.core_chapters[0].title);
    expect(screen.getByRole("button", { name: "Your sky" }).closest(".explorer-mobile-modes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    expect(scene.props?.selectedIds).toEqual(["chapter-1"]);
  });

  it("replaces unavailable graphics instructions with reading beside retry and preserves the selected experience", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene");
    await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Dusk" }));
    await user.click(screen.getByRole("button", { name: "Open reading desk" }));
    await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    expect(screen.queryByText(/Turn the object to inspect|The reading desk is open/)).not.toBeInTheDocument();
    const recovery = screen.getByRole("button", { name: "Try 3D again" }).parentElement!;
    await user.click(within(recovery).getByRole("button", { name: "Continue reading" }));
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
    expect(scene.props?.experience).toMatchObject({ lighting: "dusk", openDesks: { "chapter-2": true } });
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await user.click(screen.getByRole("button", { name: "Try 3D again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate left" })).toBeEnabled());
    expect(scene.props?.facet).toBe("resources");
    expect(scene.props?.experience).toMatchObject({ lighting: "dusk", openDesks: { "chapter-2": true } });
  });

  it("keeps secondary options collapsible in a short expanded scene and hands focus to the preserved reading", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-height: 480px"), media: query,
      addEventListener() {}, removeEventListener() {},
    }));
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Dusk" }));
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    const expanded = screen.getByRole("dialog", { name: "Expanded portrait scene" });
    const summary = within(expanded).getByText("Scene options");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(within(expanded).getByRole("navigation", { name: "Pattern chapters" })).toBeVisible();
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(within(expanded).getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(expanded).getByRole("button", { name: "Read chapter" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("heading", { name: nativePattern.core_chapters[1].title })).toHaveFocus());
  });

  it("explores calculated zodiac placements and returns to the same Pattern perspective", async () => {
    const user = userEvent.setup();
    const sky = { chartId: "chart-fixture", placements: [
      { body: "sun" as const, longitude: 115, sign: "cancer" as const, degree: 25 },
      { body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 },
      { body: "ascendant" as const, longitude: 193, sign: "libra" as const, degree: 13 },
    ], unavailable: {} };
    render(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} sky={sky} />);
    await screen.findByTestId("scene"); await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await user.click(screen.getByRole("button", { name: "Moon in Taurus" }));
    expect(screen.getByRole("heading", { name: "Moon in Taurus" })).toBeVisible();
    expect(screen.getByText("12° 30′ Taurus")).toBeVisible();
    expect(scene.props?.selectedSkyBody).toBe("moon");
    expect(scene.props?.skyView).toBe(true);
    expect(document.querySelector(".explorer-sr-only[aria-live]")).toHaveTextContent("Your sky. Moon in Taurus.");
    await user.click(screen.getByRole("button", { name: "Your Pattern" }));
    expect(scene.props?.skyView).toBe(false);
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(nativePattern.core_chapters[1].resources[0].text)).toBeVisible();
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
    document.querySelector<HTMLElement>(".explorer-mobile-modes")!.style.display = "flex";
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(scene.props?.skyView).toBe(false);
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(nativePattern.core_chapters[1].resources[0].text)).toBeVisible();
  });

  it("does not attribute every suppressed placement to missing birth-time detail", async () => {
    const user = userEvent.setup();
    const sky = { chartId: "chart-fixture", placements: [], unavailable: { ascendant: "suppressed" as const } };
    render(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} sky={sky} />);
    await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    expect(screen.getByText("Unavailable in this chart")).toBeVisible();
    expect(screen.queryByText("Needs birth-time detail")).not.toBeInTheDocument();
  });

  it("opens the sky from a reading comparison and preserves that reading context on return", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene");
    await chapter(user, 1);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    await waitFor(() => expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-explore"));
    expect(scene.props?.selectedIds).toEqual(["chapter-1", "chapter-2"]);
    await user.click(screen.getByRole("button", { name: "Back to Pattern" }));
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
    expect(screen.getByRole("button", { name: "End comparison" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps supported sky facts readable without graphics and does not invent missing placements", async () => {
    const user = userEvent.setup();
    const sky = { chartId: "chart-fixture",
      placements: [{ body: "sun" as const, longitude: 150, sign: "virgo" as const, degree: 0 }],
      unavailable: { moon: "unknown_birth_time" as const, ascendant: "unknown_birth_time" as const },
      uncertainty: "Birth time is unknown; time-sensitive placements are unavailable." };
    render(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} sky={sky} />);
    await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    expect(screen.getByRole("heading", { name: "Sun in Virgo" })).toBeVisible();
    expect(screen.getByText(sky.uncertainty)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Moon in/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rising in/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Full reading" }));
    expect(screen.getByText(nativePattern.core_chapters[3].counter_expression.text)).toBeVisible();
  });

  it("uses a saved Sun sign as a sector without supplying a made-up longitude", async () => {
    const user = userEvent.setup();
    render(<PortraitExplorer source={{ ...source, sunSign: "virgo" }} objectBindings={nativeImageBindings} meshBundle={bundle} />);
    await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    expect(screen.getByRole("heading", { name: "Sun in Virgo" })).toBeVisible();
    expect(screen.getByText("The saved portrait includes your Sun sign. Its exact position is not available in this view.")).toBeVisible();
    expect(scene.props?.sky).toBeNull();
    expect(scene.props?.sunSign).toBe("virgo");
  });

  it("keeps each chapter's physical display state independent of its complete reading", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user);
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Open reading desk" }));
    await user.click(screen.getByRole("button", { name: "Turn chapter object" }));
    expect(screen.getByRole("button", { name: "Close reading desk" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    expect(screen.getByText(nativePattern.core_chapters[0].resources[0].text)).toBeVisible();
    await chapter(user, 2);
    expect(screen.getByRole("button", { name: "Open reading desk" })).toHaveAttribute("aria-pressed", "false");
    await chapter(user);
    expect(screen.getByRole("button", { name: "Close reading desk" })).toHaveAttribute("aria-pressed", "true");
    expect(scene.props?.experience?.turns["chapter-1"]).toBe(1);
    expect(scene.props?.experience?.turns["chapter-2"] ?? 0).toBe(0);
    await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    expect(screen.getByRole("button", { name: "Turn chapter object" })).toBeDisabled();
    expect(screen.getByText(nativePattern.core_chapters[0].resources[0].text)).toBeVisible();
  });

  it("changes the courtyard light and cutaway without changing chapter or perspective", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Tensions" }));
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Dusk" }));
    await user.click(screen.getByRole("button", { name: "Show roof" }));
    expect(screen.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cut away roof" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Tensions" })).toHaveAttribute("aria-selected", "true");
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
  });

  it("embeds in the account landmark with a local exit and no duplicate page heading", async () => {
    function Account() {
      const navigation = useExplorerNavigation(manifest.chapters.map((item) => item.id), { embedded: true });
      return <main><h1>Your Pattern</h1>{navigation.isOpen
        ? <PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} navigation={navigation} />
        : <button onClick={navigation.open}>Open portrait</button>}</main>;
    }
    const user = userEvent.setup(); render(<Account />);
    await user.click(screen.getByRole("button", { name: "Open portrait" }));
    await screen.findByTestId("scene");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const explorer = screen.getByRole("region", { name: "Pattern portrait explorer" });
    await user.click(within(explorer).getByRole("button", { name: /^Full reading/ }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(nativePattern.core_chapters[3].counter_expression.text)).toBeInTheDocument();
    await user.click(within(explorer).getByRole("button", { name: "Back to reading" }));
    expect(screen.getByRole("button", { name: "Open portrait" })).toBeInTheDocument();
  });

  it("owns browser scroll restoration only while the explorer is mounted", async () => {
    window.history.scrollRestoration = "auto";
    const view = mount();
    await screen.findByTestId("scene");
    expect(window.history.scrollRestoration).toBe("manual");
    view.unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it("focuses the chapter heading on first reading entry without scrolling the containing page to zero", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    vi.stubGlobal("scrollY", 3200);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    const heading = within(screen.getByRole("complementary", { name: "Chapter reading" })).getByRole("heading", { level: 2 });
    expect(heading).toHaveFocus();
    expect(vi.mocked(heading.scrollIntoView).mock.contexts).toContain(heading);
    expect(window.scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("brings the next chapter heading into view from the bottom of the mobile reader", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 4200);
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    await user.click(screen.getByRole("button", { name: /^Next chapter/ }));
    const heading = within(screen.getByRole("complementary", { name: "Chapter reading" })).getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(nativePattern.core_chapters[1].title);
    expect(heading).toHaveFocus();
    expect(vi.mocked(heading.scrollIntoView).mock.contexts).toContain(heading);
  });

  it("keeps new reading choices when browser Back returns to the scene", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.click(screen.getByRole("button", { name: /^Next chapter/ }));
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
    expect(scene.props?.facet).toBe("resources");
  });

  it("keeps keyboard focus inside comparison when its controls are replaced", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    const selector = screen.getByRole("combobox", { name: "Compare with another chapter" });
    selector.focus();
    await user.selectOptions(selector, "chapter-2");
    expect(screen.getByRole("button", { name: "End comparison" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Compare with another chapter" })).toHaveFocus());
  });

  it("restores comparison controls when native Back removes the focused exit", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Compare with another chapter" })).toHaveFocus());
  });

  it("keeps pointer selection focused on the chapter rail inside reading mode", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await chapter(user, 2);
    expect(within(screen.getByRole("navigation", { name: "Pattern chapters" })).getByRole("button", { name: /^2\./ })).toHaveFocus();
  });

  it("approaches the object and focuses its named chapter when Explore is chosen", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Explore the first chapter" }));
    expect(document.activeElement).toHaveTextContent(nativePattern.core_chapters[0].title);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement?.closest(".explorer-chapters")).toBeInTheDocument();
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-explore");
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(document.querySelector(".explorer-scene"));
  });

  it("keeps named chapters before collapsed Scene options after selection", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    const options = screen.getByText("Scene options").closest("details")!;
    expect(options).not.toHaveAttribute("open");
    const rail = screen.getByRole("navigation", { name: "Pattern chapters" });
    expect(rail.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await chapter(user);
    expect(options).not.toHaveAttribute("open");
    expect(within(rail).getAllByRole("button")).toHaveLength(4);
    await user.click(screen.getByText("Scene options"));
    expect(screen.getByRole("button", { name: "Look closer" })).toBeVisible();
  });

  it("remembers reading scroll on return and starts a different chapter at its heading", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    vi.stubGlobal("scrollY", 3200);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 3820);
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 3200, behavior: "instant" });
    vi.stubGlobal("scrollY", 3200);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 3820, behavior: "instant" });
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    await chapter(user, 2);
    vi.mocked(window.scrollTo).mockClear();
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveTextContent(nativePattern.core_chapters[1].title);
  });

  it("remembers reading scroll when the browser Back action leaves the reader", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 3820);
    act(() => { window.dispatchEvent(new Event("scroll")); window.history.back(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 3820, behavior: "instant" });
  });

  it("restores the phone passage position after a sky visit", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 3820);
    await user.click(screen.getByRole("button", { name: "Your sky" }));
    vi.stubGlobal("scrollY", 100);
    act(() => window.history.back());
    await waitFor(() => expect(scene.props?.skyView).toBe(false));
    expect(document.querySelector(".portrait-explorer")).toHaveClass("explorer-presentation-reading");
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 3820, behavior: "instant" });
  });

  it("restores the same source position when the layout above the chapter changes", async () => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 3820);
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    const heading = within(screen.getByRole("complementary", { name: "Chapter reading" })).getByRole("heading", { level: 2 });
    heading.getBoundingClientRect = () => new DOMRect(20, 3720 - window.scrollY, 350, 80);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 3940, behavior: "instant" });
  });

  it.each(["passage", "next chapter"])("focuses a visible %s when returning to a saved reading position", async (kind) => {
    const user = userEvent.setup(); mount(true); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    vi.stubGlobal("scrollY", 3820);
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true"));
    const target = kind === "passage" ? screen.getByText(nativePattern.core_chapters[0].sections[0].text)
      : screen.getByRole("button", { name: /^Next chapter/ });
    target.getBoundingClientRect = () => new DOMRect(20, 90, 350, 160);
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    expect(target).toHaveFocus();
  });

  it("identifies a personal source-bound explorer as a private portrait", async () => {
    const bindings = nativeImageBindings.map((binding, index) => ({ ...binding, object: { ...binding.object, imageUrl: `blob:private-image-${index}` } }));
    const personal: PortraitMeshBundle = { ...bundle, authoring: "codex-parametric/v1", assets: bundle.assets.map((asset, index) => ({ ...asset, url: `blob:private-model-${index}`, provenance: {
      authoring: "codex-parametric/v1", documentRevision: manifest.revision, compilerVersion: "portrait-mesh-compiler/v1", programSha256: "b".repeat(64), sourceTextSha256: "c".repeat(64),
    } })) };
    render(<PortraitExplorer source={source} objectBindings={bindings} meshBundle={personal} />);
    await screen.findByTestId("scene");
    expect(screen.queryByText(/fictional/i)).not.toBeInTheDocument();
    expect(screen.getByText("Private portrait")).toBeInTheDocument();
  });

  it("keeps named chapters visible and links facets to actual source passages", async () => {
    const user = userEvent.setup(); mount();
    await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Pick compass body" }));
    await user.click(screen.getByRole("tab", { name: "Tensions" }));
    expect(scene.props?.facet).toBe("tensions");
    expect(screen.getByRole("navigation", { name: "Pattern chapters" })).toBeVisible();
    expect(screen.getByText(nativePattern.core_chapters[0].tensions[0].text)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open scene annotation" }));
    expect(screen.getByRole("tabpanel")).toContainElement(document.activeElement as HTMLElement);
    expect(scene.props?.activePassages["chapter-1"]).toBe(0);
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])("returns between an occluded annotation and its source without reframing (comparison: %s, reading: %s)", async (comparing, reading) => {
    const user = userEvent.setup(); mount(reading); await screen.findByTestId("scene"); await chapter(user);
    if (reading) await user.click(screen.getByRole("button", { name: "Read chapter" }));
    if (comparing) await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    const index = comparing ? 1 : 0;
    const chapterId = `chapter-${index + 1}`;
    const text = nativePattern.core_chapters[index].sections[1].text;
    const bookmark = { position: [4, 2, -3] as [number, number, number], target: [1, 0, 0] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    await user.click(screen.getByRole("button", { name: "Rotate left" }));
    const command = scene.props!.command;
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    const paragraph = screen.getByText(text);
    await user.click(within(paragraph.parentElement!).getByRole("button", { name: "Show passage 2 in portrait" }));
    expect(scene.props!.command).toEqual(command);
    expect(scene.props!.bookmark).toEqual(bookmark);
    expect(scene.props!.activePassages[chapterId]).toBe(1);
    expect(within(paragraph.parentElement!).getByText("Selected in portrait")).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: comparing ? "Compared chapters" : "Pattern chapters" });
    const nativeLink = within(navigation).getAllByRole("button")[index];
    await waitFor(() => expect(nativeLink).toHaveFocus());
    expect(nativeLink).toHaveTextContent("Overview · Read passage 2");
    expect(nativeLink).toHaveAccessibleName(/Overview · Read passage 2/);
    await user.keyboard("{Enter}");
    expect(paragraph).toHaveFocus();
    expect(reader).toContainElement(paragraph);
    expect(scene.props!.command).toEqual(command);
    expect(scene.props!.selectedIds).toEqual(comparing ? ["chapter-1", "chapter-2"] : ["chapter-1"]);
    expect(document.querySelector("[aria-live=polite]")).toHaveTextContent(new RegExp(`${nativePattern.core_chapters[index].title}.*Overview.*passage 2`, "i"));
    const historyEntry = window.history.state;
    await user.click(within(paragraph.parentElement!).getByRole("button", { name: "Show passage 2 in portrait" }));
    await waitFor(() => expect(nativeLink).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(paragraph).toHaveFocus();
    expect(scene.props!.command).toEqual(command);
    expect(window.history.state).toEqual(historyEntry);
  });

  it.each([[75, -105], [320, 60]])("reveals a source link at y=%i between sticky bars without scrolling its overlay", async (top, offset) => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    vi.stubGlobal("innerHeight", 390);
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const link = within(screen.getByRole("navigation", { name: "Pattern chapters" })).getAllByRole("button")[0];
    link.style.scrollMarginBlockStart = "180px";
    link.style.scrollMarginBlockEnd = "70px";
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(20, top, 240, 60));
    await user.click(screen.getByRole("button", { name: "Show passage 2 in portrait" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: offset })));
    expect(link).toHaveFocus();
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts).not.toContain(link);
  });

  it("preserves a chapter's facet when exploring another chapter and returning", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user); await user.click(screen.getByRole("tab", { name: "Resources" }));
    await chapter(user, 2); await chapter(user);
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
  });

  it("compares complete source facets and restores the originating chapter", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user); await user.click(screen.getByRole("tab", { name: "Tensions" }));
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    reader.scrollTop = 180; fireEvent.scroll(reader);
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    expect(scene.props?.selectedIds).toEqual(["chapter-1", "chapter-2"]);
    for (const c of nativePattern.core_chapters.slice(0, 2)) expect(screen.getByText(c.tensions[0].text)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "End comparison" }));
    await waitFor(() => expect(scene.props?.selectedIds).toEqual(["chapter-1"]));
    expect(screen.getByRole("tab", { name: "Tensions" })).toHaveAttribute("aria-selected", "true");
    expect(reader.scrollTop).toBe(180);
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(reader.scrollTop).toBe(0);
    await user.click(screen.getByRole("tab", { name: "Tensions" }));
    expect(reader.scrollTop).toBe(180);
  });

  it("retains exact camera bookmarks and facet through full reading", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user); await user.click(screen.getByRole("tab", { name: "Resources" }));
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    reader.scrollTop = 260; fireEvent.scroll(reader);
    const bookmark = { position: [4, 2, -3] as [number, number, number], target: [1, 0, 0] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    await user.click(screen.getByRole("button", { name: /^Full reading/ }));
    const reading = screen.getByRole("region", { name: "Complete Pattern reading" });
    for (const c of nativePattern.core_chapters) {
      expect(within(reading).getByText(c.summary)).toBeInTheDocument();
      for (const text of [...c.sections, ...c.tensions, ...c.resources, c.counter_expression]) expect(within(reading).getByText(text.text)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(scene.props?.bookmark).toEqual(bookmark));
    expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("complementary", { name: "Chapter reading" }).scrollTop).toBe(260);
  });

  it("continues an overflowing reading without navigating and lets the reader return to its start", async () => {
    const user = userEvent.setup(); mount(); await chapter(user);
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    reader.style.overflowY = "auto";
    Object.defineProperties(reader, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, value: 900 } });
    reader.scrollBy = (options?: ScrollToOptions | number, y: number = 0) => { reader.scrollTop = Math.min(600, reader.scrollTop + (typeof options === "number" ? y : options?.top ?? 0)); fireEvent.scroll(reader); };
    reader.scrollTo = (options?: ScrollToOptions | number, y: number = 0) => { reader.scrollTop = typeof options === "number" ? y : options?.top ?? 0; fireEvent.scroll(reader); };
    fireEvent(window, new Event("resize"));
    const history = window.history.state;
    const advance = await screen.findByRole("button", { name: "Continue reading" });
    expect(advance).toHaveAttribute("aria-controls", reader.id);
    await user.click(advance);
    expect(reader.scrollTop).toBeGreaterThan(0);
    expect(reader.scrollTop).toBeLessThan(300);
    expect(window.history.state).toEqual(history);
    await user.click(advance); await user.click(advance);
    expect(screen.getByText("End of this reading")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to start" }));
    expect(reader.scrollTop).toBe(0);
    expect(screen.getByRole("button", { name: "Continue reading" })).toHaveFocus();
  });

  it("only offers internal reading continuation when the pane overflows", async () => {
    const user = userEvent.setup(); mount(); await chapter(user);
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    reader.style.overflowY = "auto";
    Object.defineProperties(reader, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, value: 900 } });
    fireEvent(window, new Event("resize"));
    (await screen.findByRole("button", { name: "Continue reading" })).focus();
    reader.style.overflowY = "visible";
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("button", { name: "Continue reading" })).not.toBeInTheDocument();
    expect(reader).toHaveFocus();
    reader.style.overflowY = "auto";
    Object.defineProperty(reader, "clientHeight", { configurable: true, value: 900 });
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("button", { name: "Continue reading" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect original image" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Compare with another chapter" })).toBeEnabled();
  });

  it("opens the exact source image and restores focus when closed", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    await user.click(within(reader).getByText("About this artwork"));
    expect(within(reader).getByText(nativeImageBindings[0].object.rationale)).toBeVisible();
    reader.scrollTop = 240; fireEvent.scroll(reader);
    await user.click(screen.getByRole("button", { name: "Inspect original image" }));
    const dialog = screen.getByRole("dialog", { name: "Original chapter image" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", nativeImageBindings[0].object.imageUrl);
    expect(within(dialog).getByText(nativeImageBindings[0].object.rationale)).toBeInTheDocument();
    within(dialog).getByRole("button", { name: "Close image" }).focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close image" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Close image" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Close image" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Inspect original image" })).toHaveFocus();
    expect(reader.scrollTop).toBe(240);
  });

  it.each([false, true])("inspects either compared image and restores its reading and opener (paused: %s)", async (paused) => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    if (paused) await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    const reader = screen.getByRole("complementary", { name: "Chapter reading" });
    reader.scrollTop = 240; fireEvent.scroll(reader);
    for (const index of [0, 1]) {
      const item = nativePattern.core_chapters[index];
      const object = nativeImageBindings[index].object;
      const section = within(reader).getByRole("region", { name: item.title });
      await user.click(within(section).getByText("About this artwork"));
      expect(within(section).getByText(object.rationale)).toBeVisible();
      const opener = within(section).getByRole("button", { name: `Inspect original image for ${item.title}` });
      await user.click(opener);
      const dialog = screen.getByRole("dialog", { name: "Original chapter image" });
      expect(within(dialog).getByRole("img")).toHaveAttribute("src", object.imageUrl);
      expect(within(dialog).getByText(object.rationale)).toBeVisible();
      expect(within(dialog).getByText(`${item.title} · Image reference ${object.referenceId}`)).toBeVisible();
      await user.click(within(dialog).getByRole("button", { name: "Close image" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
      expect(reader.scrollTop).toBe(240);
      expect(scene.props?.selectedIds).toEqual(["chapter-1", "chapter-2"]);
      expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    }
    act(() => window.history.forward());
    const restored = await screen.findByRole("dialog", { name: "Original chapter image" });
    expect(within(restored).getByRole("img")).toHaveAttribute("src", nativeImageBindings[1].object.imageUrl);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "End comparison" })).toBeVisible();
  });

  it("offers the second compared image when the first chapter has no artwork", async () => {
    const user = userEvent.setup();
    render(<PortraitExplorer source={source} objectBindings={nativeImageBindings.slice(1)} />);
    await screen.findByTestId("scene"); await chapter(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    expect(screen.queryByRole("button", { name: `Inspect original image for ${nativePattern.core_chapters[0].title}` })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Inspect original image for ${nativePattern.core_chapters[1].title}` }));
    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", nativeImageBindings[1].object.imageUrl);
  });

  it("offers a manual guided journey and reversible assembly", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Unfold portrait" }));
    expect(scene.props?.unfolded).toBe(true);
    await user.click(screen.getByRole("button", { name: "Reassemble" }));
    expect(scene.props?.unfolded).toBe(false);
    await user.click(screen.getByRole("button", { name: "Guide me through" }));
    expect(scene.props?.selectedIds).toEqual(["chapter-1"]);
    await user.click(screen.getByRole("button", { name: "Next stop" }));
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
    await user.click(screen.getByRole("button", { name: "Exit guide" }));
    await waitFor(() => expect(scene.props?.selectedIds).toEqual([]));
  });

  it("keeps reading on graphics failure and withholds mismatched model bindings", async () => {
    const user = userEvent.setup(); const view = mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Lose graphics" }));
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
    expect(screen.getByText(nativePattern.core_chapters[0].summary)).toBeVisible();
    view.rerender(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={{ ...bundle, documentRevision: "wrong" }} />);
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Full reading/ })).toBeEnabled();
  });

  it("clears visual and reading state when the source is removed", async () => {
    const user = userEvent.setup(); const view = mount(); await screen.findByTestId("scene"); await chapter(user);
    view.rerender(<PortraitExplorer source={{ status: "unavailable" }} meshBundle={bundle} />);
    expect(screen.queryByText(nativePattern.core_chapters[0].summary)).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No Pattern to display");
  });

  it("preserves chapter state while refreshing or removing sky facts for the same source", async () => {
    const user = userEvent.setup(); const view = mount(); await screen.findByTestId("scene");
    await chapter(user, 2);
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByText("Scene options"));
    await user.click(screen.getByRole("button", { name: "Open reading desk" }));
    await user.click(screen.getByRole("button", { name: "Turn chapter object" }));
    await user.click(screen.getByRole("button", { name: "Dusk" }));
    const bookmark = { position: [4, 2, -3] as [number, number, number], target: [1, 0, 0] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    const sky = { chartId: "chart-fixture", placements: [
      { body: "moon" as const, longitude: 45, sign: "taurus" as const, degree: 15 },
    ], unavailable: {} };
    let previousScene = screen.getByTestId("scene");
    for (const currentSky of [sky, { ...sky, placements: [{ ...sky.placements[0], longitude: 46, degree: 16 }] }, null]) {
      view.rerender(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} sky={currentSky} />);
      await screen.findByTestId("scene");
      expect(screen.getByTestId("scene")).not.toBe(previousScene);
      previousScene = screen.getByTestId("scene");
      expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
      expect(scene.props?.facet).toBe("resources");
      expect(scene.props?.bookmark).toEqual(bookmark);
      expect(scene.props?.sky).toEqual(currentSky);
      expect(scene.props?.selectedSkyBody).toBe(currentSky ? "moon" : null);
      expect(scene.props?.experience?.turns["chapter-2"]).toBe(1);
      expect(screen.getByRole("button", { name: "Close reading desk" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText(nativePattern.core_chapters[1].resources[0].text)).toBeVisible();
    }
  });

  it("preserves navigation and camera when the same source image is hydrated", async () => {
    const user = userEvent.setup(); const view = mount(); await screen.findByTestId("scene");
    await chapter(user); await user.click(screen.getByRole("tab", { name: "Resources" }));
    const bookmark = { position: [4, 2, -3] as [number, number, number], target: [1, 0, 0] as [number, number, number] };
    act(() => scene.props!.onBookmark(scene.props!.viewKey, bookmark));
    view.rerender(<PortraitExplorer source={source} meshBundle={bundle} objectBindings={nativeImageBindings.map((binding) => ({ ...binding, object: { ...binding.object, imageUrl: `${binding.object.imageUrl}?hydrated` } }))} />);
    expect(scene.props?.selectedIds).toEqual(["chapter-1"]);
    expect(scene.props?.facet).toBe("resources");
    expect(scene.props?.bookmark).toEqual(bookmark);
  });

  it("follows an expanded scene annotation to its chapter and exact paragraph", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    const dialog = screen.getByRole("dialog", { name: "Expanded portrait scene" });
    await user.click(within(dialog).getByRole("button", { name: /^2\./ }));
    await user.click(within(dialog).getByRole("button", { name: "Open scene annotation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(scene.props?.selectedIds).toEqual(["chapter-2"]);
    expect(document.activeElement).toHaveTextContent(nativePattern.core_chapters[1].sections[0].text);
  });

  it("restores expanded-scene focus and opens full reading at the current chapter", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user, 4);
    await user.click(screen.getByRole("button", { name: "Expand scene" }));
    const expanded = screen.getByRole("dialog", { name: "Expanded portrait scene" });
    const lastControl = within(expanded).getByText("Scene options");
    lastControl.focus();
    await user.tab();
    expect(within(expanded).getByRole("button", { name: "Close expanded scene" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastControl).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close expanded scene" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand scene" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: /^Full reading/ }));
    expect(document.activeElement).toHaveAttribute("data-reading-chapter", "chapter-4");
  });

  it("returns to the exact origin after more than thirty history transitions", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    for (let index = 0; index < 32; index++) await chapter(user, index % 2 + 1);
    await chapter(user, 3); await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(screen.getByRole("button", { name: /^Full reading/ }));
    await user.click(screen.getByRole("button", { name: "Return to portrait" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Complete Pattern reading" })).not.toBeInTheDocument());
    expect(scene.props?.selectedIds).toEqual(["chapter-3"]);
    expect(scene.props?.facet).toBe("resources");
  });

  it("exits a guide directly even after opening the mobile chapter reader", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await user.click(screen.getByRole("button", { name: "Guide me through" }));
    document.querySelector<HTMLElement>(".explorer-mobile-modes")!.style.display = "flex";
    await user.click(screen.getByRole("button", { name: "Read chapter" }));
    await user.click(screen.getByRole("button", { name: "Next stop" }));
    await user.click(screen.getByRole("button", { name: "Exit guide" }));
    await waitFor(() => expect(scene.props?.selectedIds).toEqual([]));
    expect(screen.queryByRole("button", { name: "Exit guide" })).not.toBeInTheDocument();
  });

  it("retains all long source paragraphs, signatures, and uncertainty without meshes", async () => {
    const user = userEvent.setup();
    const document = { ...nativePattern, pattern_id: "long-source", uncertainty: { text: "A recorded uncertainty must stay visible." },
      core_chapters: nativePattern.core_chapters.map((c) => ({ ...c, sections: [...c.sections, ...c.sections.map((section) => ({ ...section, text: `Another source paragraph: ${section.text}` }))] })),
    };
    render(<PortraitExplorer source={{ status: "ready", document }} meshBundle={bundle} />);
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Full reading/ }));
    const reading = screen.getByRole("region", { name: "Complete Pattern reading" });
    expect(within(reading).getByText(document.uncertainty.text)).toBeVisible();
    for (const c of document.core_chapters) for (const paragraph of c.sections) expect(within(reading).getByText(paragraph.text)).toBeInTheDocument();
    for (const signature of document.additional_signatures) expect(within(reading).getByText(signature.text)).toBeInTheDocument();
  });
});

import { adaptiveFixture } from "../../test/adaptive-portrait-fixture.js";
import { bindingsFor } from "../../lib/account-portrait.js";
it.each([5, 6] as const)("retains both original images when comparing the final chapters of a %i-chapter reading", async count => {
  const f = adaptiveFixture(count);
  const bindings = bindingsFor(f.portrait, f.portrait.chapters.map((_, index) => `blob:adaptive-source-${index + 1}`));
  const user = userEvent.setup();
  render(<PortraitExplorer source={{ status: "ready", document: f.document }} objectBindings={bindings} />);
  await screen.findByTestId("scene"); await chapter(user, count - 1);
  await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), `chapter-${count}`);
  const reader = screen.getByRole("complementary", { name: "Chapter reading" });
  for (const ordinal of [count - 1, count]) {
    const section = within(reader).getByRole("region", { name: `Chapter ${ordinal}` });
    const opener = within(section).getByRole("button", { name: `Inspect original image for Chapter ${ordinal}` });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Original chapter image" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", `blob:adaptive-source-${ordinal}`);
    await user.click(within(dialog).getByRole("button", { name: "Close image" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(scene.props?.selectedIds).toEqual([`chapter-${count - 1}`, `chapter-${count}`]);
  }
});
