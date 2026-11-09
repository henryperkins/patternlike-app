import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { Mesh, MeshStandardMaterial, type Scene } from "three";
import PortraitScene from "./PortraitScene.js";
import type { PortraitSceneProps } from "./types.js";

const gpu = vi.hoisted(() => ({ scene: null as Scene | null }));
// jsdom has no GPU. Keep the real loader, camera, and Spark splat construction.
vi.mock("three", async (importOriginal) => {
  const original = await importOriginal<typeof import("three")>();
  return {
    ...original,
    PMREMGenerator: class {
      fromScene() { return { texture: new original.Texture(), dispose() {} }; }
      dispose() {}
    },
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = { enabled: false, type: 0, needsUpdate: false };
      getContext() { return { isContextLost: () => false, getExtension: () => null }; }
      forceContextLoss() {}
      setClearColor() {}
      setPixelRatio() {}
      setSize() {}
      render(scene: Scene) { gpu.scene = scene; scene.updateMatrixWorld(); }
      dispose() {}
    },
  };
});

function props(quality: "standard" | "low"): PortraitSceneProps {
  const model = readFileSync("public/portrait-explorer/compass.glb");
  const bytes = new Uint8Array(model);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  return {
    assets: [{ chapterId: "chapter-1", url: "/portrait-explorer/compass.glb", sha256: createHash("sha256").update(bytes).digest("hex"), sourceImageSha256: "1".repeat(64), sourceText: "Exact source" }],
    chapters: [{ id: "chapter-1", title: "Finding your own direction", ordinal: 1 }],
    selectedIds: ["chapter-1"], facet: "overview", activePassages: { "chapter-1": 0 }, unfolded: false,
    reducedMotion: true, expanded: false, quality, viewKey: "chapter-1:assembled",
    bookmark: undefined, command: { kind: "frame", serial: 0 },
    onBookmark: vi.fn(), onSelect: vi.fn(), onAnnotation: vi.fn(), onStatus: vi.fn(),
    experience: { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} },
    sky: { chartId: "fictional", placements: [{ body: "sun" as const, longitude: 115, sign: "cancer" as const, degree: 25 }], unavailable: {} },
  };
}

function meshOpacities(): number[] {
  const root = gpu.scene!.children.find((object) => object.userData.chapterId === "chapter-1")!;
  const values: number[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial) values.push(material.opacity);
    }
  });
  return values;
}

beforeEach(() => {
  gpu.scene = null;
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
});

it("gives the sky view a dense volume only on standard quality", async () => {
  const standard = props("standard");
  const skyView = render(<PortraitScene {...standard} skyView viewKey="sky" selectedIds={[]} />);
  await waitFor(() => expect(standard.onStatus).toHaveBeenCalledWith("ready"), { timeout: 8000 });
  await waitFor(() => expect(gpu.scene!.getObjectByName("Observatory sky volume")).toBeDefined(), { timeout: 8000 });
  const volume = gpu.scene!.getObjectByName("Observatory sky volume") as unknown as { numSplats: number; visible: boolean };
  expect(volume.numSplats).toBeGreaterThanOrEqual(20000);
  expect(volume.visible).toBe(true);
  skyView.unmount();

  const low = props("low");
  const lowView = render(<PortraitScene {...low} skyView viewKey="sky" selectedIds={[]} />);
  await waitFor(() => expect(low.onStatus).toHaveBeenCalledWith("ready"), { timeout: 8000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(gpu.scene!.getObjectByName("Observatory sky volume")).toBeUndefined();
  expect(gpu.scene!.getObjectByName("Observatory spark renderer")).toBeUndefined();
  lowView.unmount();
});

it("replaces the selected verified mesh with its volume and restores it for the sky", async () => {
  const current = props("standard");
  const view = render(<PortraitScene {...current} />);
  await waitFor(() => expect(current.onStatus).toHaveBeenCalledWith("ready"), { timeout: 8000 });
  await waitFor(() => expect(gpu.scene!.getObjectByName("Chapter volume chapter-1")).toBeDefined(), { timeout: 8000 });
  const volume = gpu.scene!.getObjectByName("Chapter volume chapter-1") as unknown as { numSplats: number; visible: boolean };
  expect(volume.numSplats).toBe(12000);
  expect(volume.visible).toBe(true);
  expect(meshOpacities().length).toBeGreaterThan(0);
  expect(meshOpacities().every((opacity) => opacity === 0)).toBe(true);

  view.rerender(<PortraitScene {...current} skyView viewKey="sky" selectedIds={[]} />);
  await waitFor(() => expect((gpu.scene!.getObjectByName("Observatory sky volume") as unknown as { visible: boolean }).visible).toBe(true));
  expect(volume.visible).toBe(false);
  expect(meshOpacities().every((opacity) => opacity === 1)).toBe(true);
  view.unmount();
});
