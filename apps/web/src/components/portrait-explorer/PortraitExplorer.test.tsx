import { useEffect } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeImageBindings, nativePattern } from "../../preview/native-image-study.js";
import { createPortraitManifest } from "../../lib/pattern-portrait.js";
import type { PortraitMeshBundle, PortraitSceneProps } from "./types.js";
import { PortraitExplorer } from "./PortraitExplorer.js";

const scene = vi.hoisted(() => ({ props: null as PortraitSceneProps | null }));
vi.mock("./PortraitScene.js", () => ({ default: (props: PortraitSceneProps) => {
  scene.props = props;
  useEffect(() => { props.onStatus("ready"); }, [props.onStatus]);
  return <div data-testid="scene"><button onClick={() => props.onSelect("chapter-1")}>Pick compass body</button><button onClick={props.onAnnotation}>Open scene annotation</button><button onClick={() => props.onStatus("unavailable")}>Lose graphics</button></div>;
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
function mount() { return render(<PortraitExplorer source={source} objectBindings={nativeImageBindings} meshBundle={bundle} />); }
async function chapter(user: ReturnType<typeof userEvent.setup>, ordinal = 1) {
  const navigation = screen.getByRole("navigation", { name: "Pattern chapters" });
  await user.click(within(navigation).getByRole("button", { name: new RegExp(`^${ordinal}\\.`) }));
}

describe("Portrait exploration", () => {
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
    expect(scene.props?.activePassage).toBe(0);
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Compare with another chapter" }), "chapter-2");
    expect(scene.props?.selectedIds).toEqual(["chapter-1", "chapter-2"]);
    for (const c of nativePattern.core_chapters.slice(0, 2)) expect(screen.getByText(c.tensions[0].text)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "End comparison" }));
    await waitFor(() => expect(scene.props?.selectedIds).toEqual(["chapter-1"]));
    expect(screen.getByRole("tab", { name: "Tensions" })).toHaveAttribute("aria-selected", "true");
  });

  it("retains exact camera bookmarks and facet through full reading", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene");
    await chapter(user); await user.click(screen.getByRole("tab", { name: "Resources" }));
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
  });

  it("opens the exact source image and restores focus when closed", async () => {
    const user = userEvent.setup(); mount(); await screen.findByTestId("scene"); await chapter(user);
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
    within(expanded).getByRole("button", { name: /^4\./ }).focus();
    await user.tab();
    expect(within(expanded).getByRole("button", { name: "Whole portrait" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(expanded).getByRole("button", { name: /^4\./ })).toHaveFocus();
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
