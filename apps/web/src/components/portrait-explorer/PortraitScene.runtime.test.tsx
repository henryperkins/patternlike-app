import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { BufferGeometry, Mesh, MeshStandardMaterial, Raycaster, Vector3, type Camera, type Scene } from "three";
import PortraitScene from "./PortraitScene.js";
import type { PortraitSceneProps } from "./types.js";
import { compilePortraitMesh } from "../../../../codex-runner/src/portrait-mesh-compiler.js";
import { verifyGlbAsset } from "./scene-utils.js";

const gpu = vi.hoisted(() => ({ renders: 0, disposals: 0, contextLosses: 0, contexts: new Set<HTMLCanvasElement>(), position: [] as number[], extent: [Infinity, -Infinity], scene: null as Scene | null, camera: null as Camera | null, detachedDisplay: false }));
// jsdom has no GPU. Keep the real loader, camera, mesh, controls and lifecycle.
vi.mock("three", async importOriginal => {
  const original = await importOriginal<typeof import("three")>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0, needsUpdate: false };
    constructor() {
      gpu.contexts.add(this.domElement);
      this.domElement.addEventListener("webglcontextlost", () => gpu.contexts.delete(this.domElement));
    }
    getContext() { return { isContextLost: () => !gpu.contexts.has(this.domElement) }; }
    forceContextLoss() {
      gpu.contextLosses++;
      this.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    }
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render(scene: Scene, camera: Camera) {
      gpu.scene = scene;
      gpu.camera = camera;
      const station = scene.getObjectByName("Chapter display 1");
      const artifact = scene.children.find(object => object.userData.chapterId === "chapter-1");
      if (station && artifact && (Math.abs(station.position.x - artifact.position.x) > 0.001 || Math.abs(station.position.z - artifact.position.z) > 0.001)) gpu.detachedDisplay = true;
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      gpu.position = camera.position.toArray();
      gpu.extent = [Infinity, -Infinity];
      scene.traverse(object => {
        if (!object.userData.chapterId) return;
        const box = new original.Box3().setFromObject(object);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const projected = new original.Vector3(x, y, z).project(camera);
          const screenY = (1 - projected.y) * 300;
          gpu.extent[0] = Math.min(gpu.extent[0]!, screenY);
          gpu.extent[1] = Math.max(gpu.extent[1]!, screenY);
        }
      });
      gpu.renders++;
    }
    dispose() { gpu.disposals++; }
  } };
});

function props(): PortraitSceneProps {
  const model = readFileSync("public/portrait-explorer/compass.glb");
  const bytes = new Uint8Array(model);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  return {
    assets: [{ chapterId: "chapter-1", url: "/portrait-explorer/compass.glb", sha256: createHash("sha256").update(bytes).digest("hex"), sourceImageSha256: "1".repeat(64), sourceText: "Exact source" }],
    chapters: [{ id: "chapter-1", title: "Finding your own direction", ordinal: 1 }],
    selectedIds: ["chapter-1"], facet: "overview", activePassage: 0, unfolded: false,
    reducedMotion: true, expanded: false, quality: "low", viewKey: "chapter-1:assembled",
    bookmark: { position: [2, 4, 8], target: [0, 1, 0] }, command: { kind: "right", serial: 8 },
    onBookmark: vi.fn(), onSelect: vi.fn(), onAnnotation: vi.fn(), onStatus: vi.fn(),
  };
}

beforeEach(() => {
  gpu.renders = 0;
  gpu.disposals = 0;
  gpu.contextLosses = 0;
  gpu.contexts.clear();
  gpu.position = [];
  gpu.scene = null;
  gpu.detachedDisplay = false;
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
});

it.each([3, 4, 5, 6])("renders %i distinct chapter stations without downloading artwork", async (count) => {
  const callbacks = props();
  const chapters = Array.from({ length: count }, (_, index) => ({ id: `chapter-${index + 1}`, title: `Reading ${index + 1}`, ordinal: index + 1 }));
  const experience = { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} };
  const view = render(<PortraitScene {...callbacks} assets={[]} chapters={chapters} selectedIds={[]} bookmark={undefined} experience={experience} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  expect(fetch).not.toHaveBeenCalled();
  const stations = chapters.map(chapter => gpu.scene!.getObjectByName(`Chapter display ${chapter.ordinal}`)!);
  expect(stations.every(Boolean)).toBe(true);
  expect(new Set(stations.map(station => station.position.toArray().join(","))).size).toBe(count);
  expect(screen.getByRole("img")).toHaveAccessibleName(new RegExp(`${count} chapter`));
  view.unmount();
  expect(gpu.contexts.size).toBe(0);
});

it("keeps reading stations when a verified artwork upgrade fails geometry checks", async () => {
  const callbacks = props();
  const sourceText = "Exact source";
  const identity = { chapterId: "chapter-1", documentRevision: "current", sourceImageSha256: "1".repeat(64), sourceTextSha256: createHash("sha256").update(sourceText).digest("hex") };
  const compiled = compilePortraitMesh({ version: "portrait-mesh-program/v1",
    materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
    parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [5, 0.05, 5], bevel: 0 } }],
  }, identity);
  const bytes = Uint8Array.from(compiled.glb);
  const asset = { ...callbacks.assets[0], sha256: compiled.sha256, sourceText,
    provenance: { authoring: "codex-parametric/v1" as const, documentRevision: identity.documentRevision, sourceTextSha256: identity.sourceTextSha256, programSha256: compiled.programSha256, compilerVersion: "portrait-mesh-compiler/v1" as const } };
  await expect(verifyGlbAsset(bytes.buffer, asset.sha256, asset.chapterId, asset)).resolves.toBeUndefined();
  vi.mocked(fetch).mockImplementation(async () => new Response(bytes));
  const chapters = Array.from({ length: 4 }, (_, index) => ({ id: `chapter-${index + 1}`, title: `Reading ${index + 1}`, ordinal: index + 1 }));
  const experience = { roofOpen: true, lighting: "dusk" as const, inspect: false, openDesks: {}, turns: {} };
  const onArtworkFallback = vi.fn();
  const scene = { ...callbacks, chapters, selectedIds: [], bookmark: undefined, experience, onArtworkFallback };
  const view = render(<PortraitScene {...scene} assets={[]} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenLastCalledWith("ready"), { timeout: 5000 });
  vi.mocked(callbacks.onStatus).mockClear();
  view.rerender(<PortraitScene {...scene} assets={[asset]} />);
  await waitFor(() => expect(vi.mocked(callbacks.onStatus).mock.lastCall?.[0]).not.toBe("loading"), { timeout: 5000 });
  expect(callbacks.onStatus).toHaveBeenLastCalledWith("ready");
  expect(callbacks.onStatus).not.toHaveBeenCalledWith("unavailable");
  expect(onArtworkFallback).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("img")).toHaveAccessibleName(/4 chapter displays/);
  const folios: string[] = [];
  gpu.scene!.traverse(object => { if (object.name === "Chapter reading folio") folios.push(object.userData.chapterId); });
  expect(folios.sort()).toEqual(chapters.map(chapter => chapter.id));
  view.unmount();
  expect(gpu.contexts.size).toBe(0);
}, 10000); // Builds two complete observatory worlds with real geometry.

it("restores actual camera coordinates without replaying the last command, and saves before unmount", async () => {
  const callbacks = props();
  const { unmount } = render(<PortraitScene {...callbacks} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  expect(gpu.position[0]).toBeCloseTo(2, 8);
  expect(gpu.position[1]).toBeCloseTo(4, 8);
  expect(gpu.position[2]).toBeCloseTo(8, 8);
  unmount();
  const saved = vi.mocked(callbacks.onBookmark).mock.lastCall!;
  expect(saved[0]).toBe("chapter-1:assembled");
  expect(saved[1].position[0]).toBeCloseTo(2, 8);
  expect(saved[1].target).toEqual([0, 1, 0]);
  expect(gpu.disposals).toBe(1);
});

it("keeps an unselected chapter identifiable on a phone canvas", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 324, 345));
  const callbacks = { ...props(), selectedIds: [], bookmark: undefined, command: { kind: "frame" as const, serial: 0 } };
  render(<PortraitScene {...callbacks} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  const label = document.querySelector<HTMLButtonElement>("[data-form-index='0']")!;
  expect(label.style.visibility).toBe("visible");
  expect(label).toHaveAccessibleName("Explore chapter 1: Finding your own direction");
  expect(label).toHaveAttribute("data-compact", "true");
});

it("operates real courtyard geometry, honors reduced motion, and releases its resources at rest", async () => {
  const callbacks = props();
  const experience = { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} };
  const { rerender, unmount } = render(<PortraitScene {...callbacks} experience={experience} />);
  // This integration test constructs the real architectural geometry in jsdom.
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  expect(screen.getByRole("img")).not.toHaveAccessibleName(/birth-chart markers/);
  const initial = [...gpu.position];
  const source = gpu.scene!.getObjectByName("chapter-1")!;
  const display = gpu.scene!.children.find(object => object.userData.chapterId === "chapter-1")!;
  const geometryBefore = source.children[0].position.clone();
  rerender(<PortraitScene {...callbacks} experience={{ ...experience, roofOpen: false, lighting: "dusk", openDesks: { "chapter-1": true }, turns: { "chapter-1": 1 } }} />);
  await waitFor(() => expect(gpu.scene!.getObjectByName("Reading desk hinge")!.rotation.x).toBe(-1.25));
  expect(gpu.scene!.getObjectByName("Timber canopy cutaway")!.visible).toBe(true);
  await waitFor(() => expect(display.rotation.y).toBeCloseTo(Math.PI / 4));
  expect(source.children[0].position).toEqual(geometryBefore);
  expect(gpu.position).toEqual(initial);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  const frames = gpu.renders;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(gpu.renders).toBe(frames);
  rerender(<PortraitScene {...callbacks} experience={experience} reducedMotion={false} unfolded viewKey="chapter-1:unfolded" bookmark={undefined} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(gpu.detachedDisplay).toBe(false);
  const dispose = vi.spyOn(BufferGeometry.prototype, "dispose");
  unmount();
  expect(dispose.mock.calls.length).toBeGreaterThan(20);
  expect(gpu.contexts.size).toBe(0);
});

it("places the zodiac markers at supplied longitudes and brings the instrument into view", async () => {
  const callbacks = props();
  const experience = { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} };
  const sky = { chartId: "fictional-chart", placements: [
    { body: "sun" as const, longitude: 115, sign: "cancer" as const, degree: 25 },
    { body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 },
  ], unavailable: {} };
  const selectSky = vi.fn();
  const view = render(<PortraitScene {...callbacks} experience={experience} sky={sky} selectedSkyBody="sun" onSelectSkyBody={selectSky} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  expect(screen.getByRole("img")).toHaveAccessibleName(/birth-chart markers/);
  const markers: import("three").Object3D[] = [];
  gpu.scene!.traverse(object => { if (object.type === "Group" && object.userData.skyBody === "sun") markers.push(object); });
  expect(markers).toHaveLength(1);
  const marker = markers[0];
  expect((Math.atan2(marker.position.x, -marker.position.z) * 180 / Math.PI + 360) % 360).toBeCloseTo(115, 5);
  const before = [...gpu.position];
  view.rerender(<PortraitScene {...callbacks} experience={experience} sky={sky} skyView selectedSkyBody="moon" viewKey="sky" bookmark={undefined} onSelectSkyBody={selectSky} />);
  await waitFor(() => expect(gpu.position).not.toEqual(before));
  expect(document.querySelector<HTMLButtonElement>("[data-form-index]")?.style.visibility).toBe("hidden");
  expect(document.querySelectorAll("[data-sign-index]")).toHaveLength(12);
  expect([...document.querySelectorAll<HTMLElement>("[data-sky-body]")].filter(label => label.style.visibility === "visible")).toHaveLength(1);
  await act(async () => { screen.getByRole("button", { name: "Moon in Taurus" }).click(); });
  expect(selectSky).toHaveBeenCalledWith("moon");
  const markerMesh = marker.children.find(object => "geometry" in object) as import("three").Mesh;
  const dispose = vi.spyOn(markerMesh.geometry, "dispose");
  view.unmount();
  expect(dispose).toHaveBeenCalledOnce();
  expect(gpu.contextLosses).toBe(1);
});

it("selects the previous chapter from the sky view before allowing its reading desk to operate", async () => {
  const callbacks = props();
  const operate = vi.fn();
  const experience = { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} };
  const view = render(<PortraitScene {...callbacks} experience={experience} skyView onOperate={operate} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  let chapterMesh: Mesh | undefined;
  gpu.scene!.traverse(object => { if (!chapterMesh && object instanceof Mesh && object.userData.chapterId === "chapter-1") chapterMesh = object; });
  expect(chapterMesh).toBeDefined();
  const canvas = screen.getByRole("img") as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  const hit = vi.spyOn(Raycaster.prototype, "intersectObjects").mockReturnValue([{ distance: 1, point: new Vector3(), object: chapterMesh! }]);
  const tap = () => act(() => {
    for (const type of ["pointerdown", "pointerup"]) canvas.dispatchEvent(Object.assign(
      new MouseEvent(type, { bubbles: true, button: 0, buttons: type === "pointerdown" ? 1 : 0, clientX: 400, clientY: 300 }),
      { pointerId: 1, pointerType: "mouse", isPrimary: true },
    ));
  });
  try {
    tap();
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith("chapter-1");
    expect(operate).not.toHaveBeenCalled();
    vi.mocked(callbacks.onSelect).mockClear();
    view.rerender(<PortraitScene {...callbacks} experience={experience} skyView={false} onOperate={operate} />);
    tap();
    expect(operate).toHaveBeenCalledExactlyOnceWith("chapter-1");
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  } finally {
    hit.mockRestore();
  }
});

it("uses a saved Sun sector only without chart context and never substitutes it for a missing chart Sun", async () => {
  const callbacks = props();
  const experience = { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} };
  const view = render(<PortraitScene {...callbacks} experience={experience} sky={null} sunSign="cancer" selectedSkyBody="sun" />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  const litSigns = () => {
    const signs: string[] = [];
    gpu.scene!.traverse(object => {
      if (object instanceof Mesh && object.userData.zodiacSign && object.material instanceof MeshStandardMaterial && object.material.emissiveIntensity > 0) signs.push(object.userData.zodiacSign);
    });
    return signs;
  };
  expect(litSigns()).toEqual(["cancer"]);
  expect(gpu.scene!.getObjectByName("sun zodiac marker")).toBeUndefined();
  // PortraitExplorer keys its child by sky context, so a chart change mounts a fresh scene.
  view.unmount();
  const sky = { chartId: "fictional-chart", placements: [
    { body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 },
  ], unavailable: { sun: "missing" as const, ascendant: "missing" as const } };
  vi.mocked(callbacks.onStatus).mockClear();
  const chartView = render(<PortraitScene {...callbacks} experience={experience} sky={sky} sunSign="cancer" selectedSkyBody="sun" />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  expect(gpu.scene!.getObjectByName("moon zodiac marker")).toBeDefined();
  expect(gpu.scene!.getObjectByName("sun zodiac marker")).toBeUndefined();
  expect(litSigns()).toEqual([]);
  chartView.rerender(<PortraitScene {...callbacks} experience={experience} sky={sky} sunSign="cancer" selectedSkyBody="moon" />);
  await waitFor(() => expect(litSigns()).toEqual(["taurus"]));
  // Two full scenes each have a bounded five-second readiness check.
}, 12_000);

it("leaves no live WebGL contexts after repeated scene teardown", async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    const callbacks = props();
    const view = render(<PortraitScene {...callbacks} />);
    await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
    expect(gpu.contexts.size).toBe(1);
    view.unmount();
    expect(gpu.contexts.size).toBe(0);
    expect(callbacks.onStatus).not.toHaveBeenCalledWith("unavailable");
  }
  expect(gpu.contextLosses).toBe(3);
});

it("keeps a reading-only facet change at the same camera pose, then stops drawing at idle", async () => {
  const callbacks = props();
  const { rerender } = render(<PortraitScene {...callbacks} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  const initial = [...gpu.position];
  rerender(<PortraitScene {...callbacks} facet="resources" activePassage={2} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Resources: show source passage 3/ })).toBeVisible());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(gpu.position).toEqual(initial);
  const count = gpu.renders;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(gpu.renders).toBe(count);
});

it("saves the old view before framing a new one and accepts only a new command serial", async () => {
  const callbacks = props();
  const { rerender } = render(<PortraitScene {...callbacks} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  rerender(<PortraitScene {...callbacks} viewKey="whole:assembled" selectedIds={[]} bookmark={undefined} />);
  const oldPose = vi.mocked(callbacks.onBookmark).mock.calls.find(call => call[0] === "chapter-1:assembled")!;
  expect(oldPose[1].position[0]).toBeCloseTo(2, 8);
  expect(oldPose[1].target).toEqual([0, 1, 0]);
  rerender(<PortraitScene {...callbacks} viewKey="whole:assembled" selectedIds={[]} bookmark={undefined} command={{ kind: "right", serial: 9 }} />);
  const saved = vi.mocked(callbacks.onBookmark).mock.lastCall!;
  expect(saved[0]).toBe("whole:assembled");
  expect(saved[1].position[0]).not.toBeCloseTo(2, 3);
});

it("releases the canvas and loaded geometry on graphics loss while leaving the reading reachable", async () => {
  const callbacks = props();
  const dispose = vi.spyOn(BufferGeometry.prototype, "dispose");
  render(<><p>Complete published reading</p><PortraitScene {...callbacks} /></>);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  const canvas = screen.getByRole("img");
  const before = dispose.mock.calls.length;
  act(() => { canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); });
  expect(callbacks.onStatus).toHaveBeenCalledWith("unavailable");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("Complete published reading")).toBeVisible();
  expect(dispose.mock.calls.length).toBeGreaterThan(before);
  expect(gpu.disposals).toBe(1);
  expect(gpu.contexts.size).toBe(0);
  expect(gpu.contextLosses).toBe(0);
});

it("frames models inside the unobscured viewport above the real toolbar", async () => {
  const callbacks = { ...props(), bookmark: undefined };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains("explorer-scene-toolbar") ? 550 : 0;
    const height = this.classList.contains("explorer-scene-toolbar") ? 50 : this.classList.contains("explorer-scene-top") ? 44 : 600;
    return { left: 0, top, right: 800, bottom: top + height, width: 800, height, x: 0, y: top, toJSON() {} };
  });
  render(<div className="explorer-scene"><div className="explorer-scene-top" /><PortraitScene {...callbacks} /><div className="explorer-scene-toolbar" /></div>);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"));
  expect(gpu.extent[0]).toBeGreaterThan(52);
  expect(gpu.extent[1]).toBeLessThan(542);
});

it("rejects an intact correctly hashed compass assigned to a different chapter before drawing", async () => {
  const callbacks = props();
  render(<PortraitScene {...callbacks} assets={callbacks.assets.map(asset => ({ ...asset, chapterId: "chapter-2" }))}
    chapters={[{ id: "chapter-2", title: "Making room for care", ordinal: 2 }]} selectedIds={["chapter-2"]} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("unavailable"));
  expect(callbacks.onStatus).not.toHaveBeenCalledWith("ready");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(gpu.renders).toBe(0);
});


it("keeps all zodiac labels in frame across expansion and resize and connects the selected readout to the plotted marker", async () => {
  let resize: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  let bounds = new DOMRect(0, 0, 358, 345);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => bounds);
  const callbacks = { ...props(), bookmark: undefined, selectedIds: [], skyView: true, viewKey: "sky",
    selectedSkyBody: "moon" as const,
    experience: { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} },
    sky: { chartId: "fictional", placements: [{ body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 }], unavailable: {} },
  };
  const initial = render(<PortraitScene {...callbacks} />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  const initialPosition = [...gpu.position];
  initial.unmount();
  const bookmark = vi.mocked(callbacks.onBookmark).mock.lastCall![1];
  bounds = new DOMRect(0, 0, 354, 580);
  vi.mocked(callbacks.onStatus).mockClear();
  const expanded = render(<PortraitScene {...callbacks} bookmark={bookmark} expanded />);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  const labels = [...expanded.container.querySelectorAll<HTMLElement>("[data-sign-index]")];
  expect(labels.filter(label => label.style.visibility === "visible")).toHaveLength(12);
  const marker = gpu.scene!.getObjectByName("moon zodiac marker")!;
  const projected = marker.getWorldPosition(new Vector3()).project(gpu.camera!);
  const connector = expanded.container.querySelector<SVGLineElement>("[data-sky-connector]")!;
  expect(connector).not.toBeNull();
  expect(Number(connector.getAttribute("x2"))).toBeCloseTo((projected.x + 1) * 354 / 2, 1);
  expect(Number(connector.getAttribute("y2"))).toBeCloseTo((1 - projected.y) * 580 / 2, 1);
  bounds = new DOMRect(0, 0, 358, 345);
  act(() => resize());
  await waitFor(() => expect(gpu.position[1]).toBeCloseTo(initialPosition[1], 6));
  expect(gpu.position[0]).toBeCloseTo(initialPosition[0], 6);
  expect(gpu.position[2]).toBeCloseTo(initialPosition[2], 6);
}, 12_000);


it.each([{ width: 288, height: 300 }, { width: 544, height: 296 }])("keeps the selected readout clear of measured sign labels and its marker in a $width by $height canvas", async ({ width, height }) => {
  const signWidths: Record<string, number> = { Aries: 42, Taurus: 49, Gemini: 52, Cancer: 51, Leo: 30, Virgo: 42, Libra: 40, Scorpio: 53, Sagittarius: 76, Capricorn: 73, Aquarius: 64, Pisces: 43 };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.matches("[data-sign-index]") ? signWidths[this.textContent ?? ""] ?? 50 : this.matches("[data-sky-body]") ? 80 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.matches("[data-sign-index]") ? 25 : this.matches("[data-sky-body]") ? 44 : 0;
  });
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    if (this.matches(".explorer-scene-top")) return new DOMRect(8, 8, width - 16, 44);
    if (this.matches(".explorer-scene-toolbar")) return new DOMRect(8, height - 58, width - 16, 50);
    return new DOMRect(0, 0, width, height);
  });
  const callbacks = { ...props(), bookmark: undefined, selectedIds: [], skyView: true, viewKey: "sky",
    experience: { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} },
    sky: { chartId: "fictional", placements: [
      { body: "sun" as const, longitude: 115, sign: "cancer" as const, degree: 25 },
      { body: "moon" as const, longitude: 42.5, sign: "taurus" as const, degree: 12.5 },
      { body: "ascendant" as const, longitude: 193, sign: "libra" as const, degree: 13 },
    ], unavailable: {} },
  };
  const scene = (body: "sun" | "moon" | "ascendant") => <div className="explorer-scene"><div className="explorer-scene-top" /><PortraitScene {...callbacks} selectedSkyBody={body} /><div className="explorer-scene-toolbar" /></div>;
  const view = render(scene("sun"));
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("ready"), { timeout: 5000 });
  const rect = (element: HTMLElement) => {
    const [x, y] = element.style.transform.match(/-?[\d.]+/g)!.map(Number);
    return { left: x, right: x + element.offsetWidth, top: y, bottom: y + element.offsetHeight };
  };
  for (const body of ["sun", "moon", "ascendant"] as const) {
    const renders = gpu.renders;
    view.rerender(scene(body));
    await waitFor(() => expect(gpu.renders).toBeGreaterThan(renders));
    const readout = view.container.querySelector<HTMLElement>(`[data-sky-body="${body}"]`)!;
    expect(readout.style.visibility, JSON.stringify({ body, readout: rect(readout), signs: [...view.container.querySelectorAll<HTMLElement>("[data-sign-index]")].map(label => ({ sign: label.textContent, ...rect(label) })) })).toBe("visible");
    const box = rect(readout);
    expect(box.left).toBeGreaterThanOrEqual(6);
    expect(box.right).toBeLessThanOrEqual(width - 6);
    expect(box.top).toBeGreaterThanOrEqual(62);
    expect(box.bottom).toBeLessThanOrEqual(height - 68);
    const signs = [...view.container.querySelectorAll<HTMLElement>("[data-sign-index]")];
    expect(signs.filter(label => label.style.visibility === "visible")).toHaveLength(12);
    for (const sign of signs) {
      const labelBox = rect(sign);
      expect(box.right <= labelBox.left || box.left >= labelBox.right || box.bottom <= labelBox.top || box.top >= labelBox.bottom, `${body} readout overlaps ${sign.textContent}`).toBe(true);
    }
    const marker = gpu.scene!.getObjectByName(`${body} zodiac marker`)!;
    const projected = marker.getWorldPosition(new Vector3()).project(gpu.camera!);
    const x = (projected.x + 1) * width / 2;
    const y = (1 - projected.y) * height / 2;
    expect(x < box.left || x > box.right || y < box.top || y > box.bottom, `${body} marker hidden by its readout`).toBe(true);
    const connector = view.container.querySelector<SVGLineElement>("[data-sky-connector]")!;
    expect(connector.style.visibility).toBe("visible");
    expect(Number(connector.getAttribute("x2"))).toBeCloseTo(x, 1);
    expect(Number(connector.getAttribute("y2"))).toBeCloseTo(y, 1);
  }
}, 10_000);
