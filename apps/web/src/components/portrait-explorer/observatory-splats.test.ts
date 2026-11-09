import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Raycaster, Scene, Vector3, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import type { PortraitSkyPlacement } from "../../lib/portrait-sky.js";
import { createReadingFolio } from "./observatory-world.js";
import {
  CHAPTER_VOLUME_COUNT,
  createChapterVolumeSplats,
  createObservatorySplats,
  createSkyVolumeSplats,
  SKY_CANOPY_COUNT,
  SKY_ECLIPTIC_COUNT,
} from "./observatory-splats.js";
import { verifySplatAsset } from "./scene-utils.js";
import { disposeModel } from "./scene-utils.js";
import { zodiacPoint } from "./zodiac-instrument.js";

function createFakeRenderer(): WebGLRenderer {
  const domElement = document.createElement("canvas");
  return {
    domElement,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    getContext() {
      return {
        isContextLost: () => false,
      };
    },
  } as unknown as WebGLRenderer;
}

describe("observatory Gaussian splats (@sparkjsdev/spark)", () => {
  it("builds a dense volumetric sky that owns the sky view", () => {
    const placements: PortraitSkyPlacement[] = [
      { body: "sun", longitude: 120, sign: "leo", degree: 0 },
      { body: "moon", longitude: 42.5, sign: "taurus", degree: 12.5 },
    ];
    const withoutMarkers = createSkyVolumeSplats([]);
    const withMarkers = createSkyVolumeSplats(placements);
    try {
      expect(withoutMarkers.numSplats).toBe(SKY_ECLIPTIC_COUNT + SKY_CANOPY_COUNT);
      expect(withoutMarkers.numSplats).toBeGreaterThanOrEqual(20000);
      expect(withMarkers.numSplats).toBe(SKY_ECLIPTIC_COUNT + SKY_CANOPY_COUNT + placements.length * 512);
      const box = withMarkers.getBoundingBox();
      expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true);
      expect(box.getSize(new Vector3()).x).toBeGreaterThan(5);
      expect(box.max.y).toBeGreaterThan(3.5);
      // Tight knot at the supplied Sun longitude: same point the instrument marks.
      const anchor = new Vector3(...zodiacPoint(120, 0.99, 0.95));
      let near = 0;
      withMarkers.forEachSplat((_index, center) => {
        if (center.distanceTo(anchor) < 0.2) near++;
      });
      expect(near).toBeGreaterThan(100);
      const raycaster = new Raycaster(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      expect(raycaster.intersectObject(withMarkers, true)).toEqual([]);
    } finally {
      withoutMarkers.dispose();
      withMarkers.dispose();
    }
  });

  it("bakes a dense surface volume from chapter geometry without intercepting raycasts", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 0.5, 1), new MeshStandardMaterial({ color: "#ad8950" }));
    mesh.userData.chapterId = "chapter-1";
    root.add(mesh);
    root.position.set(3, 0.56, -2);
    const splats = createChapterVolumeSplats(root, 2000);
    try {
      expect(splats.numSplats).toBe(2000);
      expect(CHAPTER_VOLUME_COUNT).toBe(12000);
      const box = splats.getBoundingBox();
      expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true);
      // Surface shell has extent on all axes, so orbiting shows thickness/back.
      const size = box.getSize(new Vector3());
      expect(size.x).toBeGreaterThan(0.5);
      expect(size.y).toBeGreaterThan(0.2);
      expect(size.z).toBeGreaterThan(0.5);
      const raycaster = new Raycaster(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      expect(raycaster.intersectObject(splats, true)).toEqual([]);
    } finally {
      splats.dispose();
      disposeModel([root]);
    }
  });

  it("skips SparkRenderer entirely on low quality", () => {
    const renderer = createFakeRenderer();
    const scene = new Scene();
    const splats = createObservatorySplats({
      renderer,
      scene,
      placements: [{ body: "sun", longitude: 120, sign: "leo", degree: 0 }],
      hasCourtyard: true,
      quality: "low",
      onDirty: vi.fn(),
    });
    expect(splats.spark).toBeNull();
    expect(splats.sky).toBeNull();
    expect(splats.chapters.size).toBe(0);
    expect(scene.children).toHaveLength(0);
    splats.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("coordinates sky visibility, chapter volumes, transform sync, and disposal", () => {
    const renderer = createFakeRenderer();
    const scene = new Scene();
    const firstRoot = createReadingFolio("chapter-1");
    const secondRoot = createReadingFolio("chapter-2");
    firstRoot.position.set(-2, 0.56, 1);
    secondRoot.position.set(2, 0.56, -1);
    const forms = [
      { id: "chapter-1", root: firstRoot },
      { id: "chapter-2", root: secondRoot },
    ];
    const splats = createObservatorySplats({
      renderer,
      scene,
      placements: [{ body: "sun", longitude: 120, sign: "leo", degree: 0 }],
      hasCourtyard: true,
      quality: "standard",
      onDirty: vi.fn(),
    });

    try {
      expect(splats.spark).not.toBeNull();
      expect(scene.children).toContain(splats.spark);
      expect(splats.sky).not.toBeNull();
      expect(splats.sky!.visible).toBe(false);

      splats.setExperience({ lighting: "day", skyView: true, comparison: false, selectedSkyBody: "sun" });
      expect(splats.sky!.visible).toBe(true);
      expect(splats.sky!.opacity).toBeCloseTo(0.96);
      expect(splats.sky!.recolor.equals(new Color("#fff3d6"))).toBe(true);

      splats.setExperience({ lighting: "dusk", skyView: false, comparison: false, selectedSkyBody: null });
      expect(splats.sky!.visible).toBe(false);

      const volume = createChapterVolumeSplats(firstRoot, 500);
      splats.attachChapterVolume("chapter-1", volume, firstRoot);
      expect(scene.children).toContain(volume);
      splats.setChapterVolumes(["chapter-1"], false);
      expect(volume.visible).toBe(true);
      splats.setChapterVolumes(["chapter-1"], true);
      expect(volume.visible).toBe(false);
      splats.setChapterVolumes(["chapter-1", "chapter-2"], false);
      expect(volume.visible).toBe(true);

      firstRoot.position.set(-1.5, 0.56, 0);
      firstRoot.rotation.y = Math.PI / 4;
      splats.syncTransforms(forms);
      expect(volume.position.x).toBeCloseTo(-1.5);
      expect(volume.rotation.y).toBeCloseTo(Math.PI / 4);
    } finally {
      splats.dispose();
      disposeModel([firstRoot as Group, secondRoot as Group]);
    }

    expect(scene.children).not.toContain(splats.spark);
    expect(scene.children).not.toContain(splats.sky);
  });

  it("verifies splat companions by exact hash and bounded size", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const hash = createHash("sha256").update(bytes).digest("hex");
      await expect(verifySplatAsset(bytes, hash)).resolves.toBeUndefined();
      await expect(verifySplatAsset(bytes, "0".repeat(64))).rejects.toThrow(/hash/);
      await expect(verifySplatAsset(bytes, "")).rejects.toThrow(/hash/);
      await expect(verifySplatAsset(new Uint8Array(0), hash)).rejects.toThrow(/size/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
