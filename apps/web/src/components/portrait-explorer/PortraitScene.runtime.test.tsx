import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { BufferGeometry, type Camera, type Scene } from "three";
import PortraitScene from "./PortraitScene.js";
import type { PortraitSceneProps } from "./types.js";

const gpu = vi.hoisted(() => ({ renders: 0, disposals: 0, position: [] as number[], extent: [Infinity, -Infinity] }));
// jsdom has no GPU. Keep the real loader, camera, mesh, controls and lifecycle.
vi.mock("three", async importOriginal => {
  const original = await importOriginal<typeof import("three")>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0, needsUpdate: false };
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render(scene: Scene, camera: Camera) {
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
  gpu.position = [];
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
});

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
