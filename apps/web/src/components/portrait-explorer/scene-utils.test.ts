import { describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Texture, Vector3 } from "three";
import { adaptCameraBookmark, cameraFrame, chapterLayout, disposeModel, firstVisibleIntersection, isCameraBookmark, TapTracker, validateGlb, verifyGlbAsset } from "./scene-utils.js";

it("blocks chapter picking behind architecture and restores it when the roof is cut away", () => {
  const chapter = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  chapter.userData.chapterId = "chapter-1";
  const roof = new Group();
  const panel = new Mesh(new BoxGeometry(3, 3, 0.2), new MeshStandardMaterial());
  panel.position.z = 3; roof.add(panel);
  chapter.updateMatrixWorld(); roof.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(0, 0, 8), new Vector3(0, 0, -1));
  expect(firstVisibleIntersection(ray, [chapter, roof])?.object).toBe(panel);
  roof.visible = false;
  expect(firstVisibleIntersection(ray, [chapter, roof])?.object.userData.chapterId).toBe("chapter-1");
  disposeModel([chapter, roof]);
});

function glb(json: unknown) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const size = Math.ceil(text.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + size);
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, size, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20).fill(32);
  new Uint8Array(bytes, 20, text.length).set(text);
  return bytes;
}

describe("verified self-contained GLBs", () => {
  it("rejects a correctly hashed personal model with stale source provenance", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const sourceText = "Complete chapter source";
      const provenance = { authoring: "codex-parametric/v1" as const, documentRevision: "current", compilerVersion: "portrait-mesh-compiler/v1" as const,
        programSha256: "a".repeat(64), sourceTextSha256: createHash("sha256").update(sourceText).digest("hex") };
      const asset = { chapterId: "chapter-1", url: "blob:https://pattern.example/model", sha256: "", sourceImageSha256: "b".repeat(64), sourceText, provenance };
      const extras = { ...provenance, chapterId: asset.chapterId, sourceImageSha256: asset.sourceImageSha256 };
      const model = (metadata: unknown) => glb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "chapter-1", extras: metadata }] });
      const good = model(extras);
      await expect(verifyGlbAsset(good, createHash("sha256").update(new Uint8Array(good)).digest("hex"), asset.chapterId, asset)).resolves.toBeUndefined();
      for (const changed of [{ documentRevision: "old" }, { sourceImageSha256: "c".repeat(64) }, { programSha256: "c".repeat(64) }, { compilerVersion: "unknown" }]) {
        const bytes = model({ ...extras, ...changed });
        await expect(verifyGlbAsset(bytes, createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), asset.chapterId, asset)).rejects.toThrow(/provenance/);
      }
      await expect(verifyGlbAsset(good, createHash("sha256").update(new Uint8Array(good)).digest("hex"), asset.chapterId, { ...asset, sourceText: "Different chapter" })).rejects.toThrow(/source/);
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects every external buffer, image, and nested extension resource before parsing", () => {
    for (const json of [
      { buffers: [{ uri: "https://example.invalid/private.bin" }] },
      { images: [{ uri: "texture.png" }] },
      { images: [{ uri: "data:image/png;base64,AA==" }] },
      { extensions: { example: { uri: "/unbound.bin" } } },
    ]) expect(() => validateGlb(glb({ asset: { version: "2.0" }, ...json }))).toThrow(/self-contained/);
    expect(() => validateGlb(glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 0 }] }))).not.toThrow();
  });

  it("rejects malformed headers, chunk overflows, non-glTF JSON, and oversized payloads", () => {
    const valid = glb({ asset: { version: "2.0" } });
    for (const offset of [0, 4, 8, 12, 16]) {
      const bytes = valid.slice(0);
      new DataView(bytes).setUint32(offset, 1, true);
      expect(() => validateGlb(bytes)).toThrow();
    }
    expect(() => validateGlb(new ArrayBuffer(12 * 1024 * 1024 + 1))).toThrow(/size/);
    expect(() => validateGlb(glb({ asset: { version: "1.0" } }))).toThrow(/version/);
  });

  it("checks the manifest SHA-256 against the exact fetched bytes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const bytes = glb({ asset: { version: "2.0" } });
      const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      await expect(verifyGlbAsset(bytes, digest)).resolves.toBeUndefined();
      await expect(verifyGlbAsset(bytes, "0".repeat(64))).rejects.toThrow(/hash/);
      await expect(verifyGlbAsset(bytes, "")).rejects.toThrow(/hash/);
    } finally { vi.unstubAllGlobals(); }
  });

  it("requires one explicitly bound chapter root and rejects absent, conflicting, or duplicate identities", () => {
    const root = { name: "chapter-1", extras: { chapterId: "chapter-1" } };
    const document = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [root] };
    expect(() => validateGlb(glb(document), "chapter-1")).not.toThrow();
    for (const changed of [
      { ...document, nodes: [{ name: "chapter-2", extras: { chapterId: "chapter-2" } }] },
      { ...document, nodes: [{ name: "chapter-1", extras: { chapterId: "chapter-2" } }] },
      { ...document, nodes: [{ name: "chapter-1" }] },
      { ...document, nodes: [{ name: "unbound", extras: { chapterId: "chapter-1" } }] },
      { ...document, nodes: [root, root] },
      { ...document, nodes: [root, { name: "chapter-2" }] },
      { ...document, nodes: [root, { name: "child", extras: { chapterId: "chapter-2" } }] },
      { ...document, scenes: [{ nodes: [0, 0] }] },
      { ...document, scenes: [{ nodes: [0] }, { nodes: [0] }] },
      { ...document, scene: 1 },
    ]) expect(() => validateGlb(glb(changed), "chapter-1")).toThrow(/chapter identity/);
  });
});

describe("bounds framing and camera restoration", () => {
  const boxes = [
    new Box3(new Vector3(-2.2, 0, -2), new Vector3(-0.2, 2, 0)),
    new Box3(new Vector3(0.2, 0, 0.2), new Vector3(2.2, 0.4, 2.2)),
  ];

  it.each([0.65, 1, 1.8])("keeps real object bounds visible at aspect %s even while a chapter is selected", (aspect) => {
    for (const selected of [[], [1], [0, 1]]) {
      const frame = cameraFrame(boxes, selected, aspect);
      const camera = new PerspectiveCamera(38, aspect, 0.05, 100);
      camera.position.fromArray(frame.position);
      camera.lookAt(new Vector3().fromArray(frame.target));
      camera.updateMatrixWorld();
      for (const box of boxes) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.88);
        expect(Math.abs(point.y)).toBeLessThan(0.88);
      }
    }
  });

  it("moves the framing target toward the selected contribution and separates unfolded positions", () => {
    expect(cameraFrame(boxes, [1], 1).target[0]).toBeGreaterThan(cameraFrame(boxes, [], 1).target[0]);
    const together = chapterLayout(0, false);
    const apart = chapterLayout(0, true);
    expect(Math.hypot(apart[0], apart[2])).toBeGreaterThan(Math.hypot(together[0], together[2]));
  });

  it("accepts a concrete saved pose and rejects nonfinite or degenerate restoration", () => {
    expect(isCameraBookmark({ position: [2, 3, 5], target: [1, 0, 0] })).toBe(true);
    expect(isCameraBookmark({ position: [0, 0, 0], target: [0, 0, 0] })).toBe(false);
    expect(isCameraBookmark({ position: [NaN, 0, 3], target: [0, 0, 0] })).toBe(false);
    expect(isCameraBookmark({ position: [0, 0, Infinity], target: [0, 0, 0] })).toBe(false);
    expect(isCameraBookmark(undefined)).toBe(false);
  });
});

describe("body picking gesture boundaries", () => {
  const pointer = (pointerId: number, x = 10, y = 10, isPrimary = true) => ({ pointerId, clientX: x, clientY: y, isPrimary, button: 0 });
  it("selects only a stationary primary release without page scrolling", () => {
    const taps = new TapTracker();
    taps.down(pointer(1), 0, 0);
    expect(taps.up(pointer(1, 12, 12), 0, 0)).toBe(true);
    taps.down(pointer(1), 0, 0);
    expect(taps.up(pointer(1), 0, 3)).toBe(false);
  });
  it("rejects drag-return, multitouch, cancellation, and mismatched pointer releases", () => {
    const taps = new TapTracker();
    taps.down(pointer(1), 0, 0);
    taps.move(pointer(1, 30));
    expect(taps.up(pointer(1), 0, 0)).toBe(false);
    taps.down(pointer(1), 0, 0);
    taps.down(pointer(2, 10, 10, false), 0, 0);
    expect(taps.up(pointer(1), 0, 0)).toBe(false);
    taps.cancel();
    expect(taps.up(pointer(2), 0, 0)).toBe(false);
    taps.down(pointer(1), 0, 0);
    expect(taps.up(pointer(2), 0, 0)).toBe(false);
  });
});

it("disposes shared geometry, material, texture, and decoded image exactly once across GLB scenes", () => {
  const geometry = new BoxGeometry();
  const close = vi.fn();
  const texture = new Texture({ close } as unknown as HTMLImageElement);
  const material = new MeshStandardMaterial({ map: texture, roughnessMap: texture });
  const geometryDispose = vi.spyOn(geometry, "dispose");
  const materialDispose = vi.spyOn(material, "dispose");
  const textureDispose = vi.spyOn(texture, "dispose");
  const first = new Group().add(new Mesh(geometry, material));
  const second = new Group().add(new Mesh(geometry, material));
  disposeModel([first, second]);
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(materialDispose).toHaveBeenCalledTimes(1);
  expect(textureDispose).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});


it("adapts a turned and zoomed bookmark to a new frame without losing its direction or relative zoom", () => {
  const target: [number, number, number] = [1, 2, 3];
  const bookmark = { position: [3, 6, 11] as [number, number, number], target, frameDistance: 10 };
  const resized = adaptCameraBookmark(bookmark, 20);
  const originalOffset = new Vector3(...bookmark.position).sub(new Vector3(...target));
  const resizedOffset = new Vector3(...resized.position).sub(new Vector3(...target));
  expect(resized.target).toEqual(target);
  expect(resizedOffset.clone().normalize().distanceTo(originalOffset.clone().normalize())).toBeLessThan(1e-10);
  expect(resizedOffset.length() / 20).toBeCloseTo(originalOffset.length() / 10);
  expect(adaptCameraBookmark(resized, 10).position).toEqual(bookmark.position);
  expect(adaptCameraBookmark({ position: bookmark.position, target }, 20).position).toEqual(bookmark.position);
});
