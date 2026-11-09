import { PackedSplats, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  Box3,
  Color,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { PortraitSkyBody, PortraitSkyPlacement } from "../../lib/portrait-sky.js";
import { zodiacPoint } from "./zodiac-instrument.js";

export interface ObservatorySplatsOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  placements?: readonly PortraitSkyPlacement[];
  hasCourtyard: boolean;
  quality: "standard" | "low";
  onDirty?: () => void;
}

export interface ObservatorySplatsExperienceState {
  lighting: "day" | "dusk";
  skyView: boolean;
  comparison: boolean;
  selectedSkyBody?: PortraitSkyBody | null;
}

export interface ObservatorySplats {
  readonly spark: SparkRenderer | null;
  readonly sky: SplatMesh | null;
  readonly skyBodies: ReadonlyMap<PortraitSkyBody, SplatMesh>;
  readonly chapters: ReadonlyMap<string, SplatMesh>;
  setQuality: (quality: "standard" | "low") => void;
  setExperience: (state: ObservatorySplatsExperienceState) => void;
  setChapterVolumes: (selectedIds: readonly string[], skyView: boolean) => void;
  setBlend: (skyBlend: number, chapterBlends: ReadonlyMap<string, number>) => void;
  attachChapterVolume: (id: string, mesh: SplatMesh, root: Object3D) => void;
  syncTransforms: (forms: ReadonlyArray<{ id: string; root: Object3D }>) => void;
  dispose: () => void;
}

const MARKER_RADII: Record<PortraitSkyBody, number> = {
  sun: 0.99,
  moon: 0.74,
  ascendant: 0.49,
};

const MARKER_COLORS: Record<PortraitSkyBody, string> = {
  sun: "#e7bd62",
  moon: "#e2e2d4",
  ascendant: "#b1d4c0",
};

const UP_AXIS = new Vector3(0, 1, 0);
const KEY_LIGHT_DIR = new Vector3(-3, 7, 5).normalize();

export const SKY_ECLIPTIC_COUNT = 14336;
export const SKY_CANOPY_COUNT = 8192;
export const SKY_MARKER_COUNT_PER_BODY = 512;
export const SKY_FOCUS_CORONA_COUNT = 256;
export const CHAPTER_VOLUME_COUNT = 12000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function ensureSparkContext(renderer: WebGLRenderer): void {
  const rawGetContext = renderer.getContext.bind(renderer);
  const initial = rawGetContext() as Partial<WebGL2RenderingContext> | null | undefined;
  if (initial && typeof initial.getExtension === "function") return;
  renderer.getContext = (() => {
    const context = rawGetContext() as unknown as Record<string, unknown> | null | undefined;
    if (context && typeof context.getExtension !== "function") {
      context.getExtension = () => null;
    }
    return context as unknown as WebGL2RenderingContext;
  }) as typeof renderer.getContext;
}

/**
 * Volumetric ecliptic for the sky view. This is the one view Spark owns:
 * a dense anisotropic band plus canopy and tight knots at the supplied
 * longitudes. It adds atmosphere only — the bronze instrument remains the
 * calibrated layer and no knot invents a new chart position.
 */
export function createSkyVolumeSplats(placements: readonly PortraitSkyPlacement[] = []): SplatMesh {
  const byBody = new Map<PortraitSkyBody, PortraitSkyPlacement>();
  for (const placement of placements) {
    zodiacPoint(placement.longitude, 1, 0);
    byBody.set(placement.body, placement);
  }
  const markerCount = byBody.size * SKY_MARKER_COUNT_PER_BODY;
  const total = SKY_ECLIPTIC_COUNT + SKY_CANOPY_COUNT + markerCount;
  const packedSplats = new PackedSplats({ maxSplats: total });
  const rng = mulberry32(0x5eed1234);
  const center = new Vector3();
  const scales = new Vector3();
  const quaternion = new Quaternion();
  const bronzeGold = new Color("#d0b377");
  const warmBronze = new Color("#ad8950");
  const skyMist = new Color("#adc7da");
  const skySoft = new Color("#d9e8e3");
  const color = new Color();

  for (let i = 0; i < SKY_ECLIPTIC_COUNT; i++) {
    const step = 360 / SKY_ECLIPTIC_COUNT;
    const longitude = i * step + (rng() - 0.5) * step * 0.9;
    const band = i % 3;
    const radius = 1.28 + band * 0.065 + (rng() - 0.5) * 0.04;
    const height = 0.875 + (i % 2) * 0.035 + (rng() - 0.5) * 0.02;
    center.set(...zodiacPoint(longitude, radius, height));
    scales.set(0.048 + rng() * 0.02, 0.011, 0.02);
    quaternion.setFromAxisAngle(UP_AXIS, -(longitude * Math.PI) / 180);
    color.copy(i % 2 === 0 ? bronzeGold : warmBronze);
    color.offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    packedSplats.pushSplat(center, scales, quaternion, i % 12 === 0 ? 0.5 : 0.3, color);
  }

  for (let i = 0; i < SKY_CANOPY_COUNT; i++) {
    const goldenAngle = i * 2.399963229728653 + (rng() - 0.5) * 0.08;
    const fraction = (i + 0.5) / SKY_CANOPY_COUNT;
    const radius = 2.8 + Math.sqrt(fraction) * 3.4 + (rng() - 0.5) * 0.25;
    const height = 3.65 + (1 - fraction * 0.5) * 0.95 + (rng() - 0.5) * 0.2;
    center.set(Math.cos(goldenAngle) * radius, height, Math.sin(goldenAngle) * radius);
    scales.set(0.085 + rng() * 0.04, 0.028, 0.085 + rng() * 0.04);
    quaternion.setFromAxisAngle(UP_AXIS, goldenAngle);
    color.copy(i % 3 === 0 ? bronzeGold : i % 2 === 0 ? skyMist : skySoft);
    packedSplats.pushSplat(center, scales, quaternion, 0.16, color);
  }

  for (const [body, placement] of byBody) {
    const anchor = new Vector3(...zodiacPoint(placement.longitude, MARKER_RADII[body], 0.95));
    const bodyColor = new Color(MARKER_COLORS[body]);
    for (let i = 0; i < SKY_MARKER_COUNT_PER_BODY; i++) {
      center.set(
        anchor.x + gaussian(rng) * 0.045,
        anchor.y + gaussian(rng) * 0.025,
        anchor.z + gaussian(rng) * 0.045,
      );
      scales.set(0.02, 0.014, 0.02);
      quaternion.setFromAxisAngle(UP_AXIS, rng() * Math.PI * 2);
      const fade = Math.max(0.25, 1 - Math.abs(gaussian(rng)) * 0.25);
      packedSplats.pushSplat(center, scales, quaternion, 0.68 * fade, bodyColor);
    }
  }

  const mesh = new SplatMesh({ packedSplats, raycastable: false });
  mesh.numSplats = packedSplats.numSplats;
  mesh.name = "Observatory sky volume";
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Focused volumetric corona centered on a single calibrated natal placement.
 * Its origin sits at the exact zodiacPoint of the supplied placement so
 * selecting a body intensifies its volumetric aura without inventing position.
 */
export function createSkyBodyFocusSplats(placement: PortraitSkyPlacement): SplatMesh {
  const anchor = zodiacPoint(placement.longitude, MARKER_RADII[placement.body], 0.95);
  const packedSplats = new PackedSplats({ maxSplats: SKY_FOCUS_CORONA_COUNT });
  const seed = placement.body === "sun" ? 0x51a01 : placement.body === "moon" ? 0x51a02 : 0x51a03;
  const rng = mulberry32(seed);
  const center = new Vector3();
  const scales = new Vector3();
  const quaternion = new Quaternion();
  const coreColor = new Color(MARKER_COLORS[placement.body]).offsetHSL(0, 0.04, 0.08);
  const haloColor = new Color(MARKER_COLORS[placement.body]).offsetHSL(0, -0.02, 0.02);
  const color = new Color();

  for (let i = 0; i < SKY_FOCUS_CORONA_COUNT; i++) {
    const inner = i < SKY_FOCUS_CORONA_COUNT * 0.55;
    const spread = inner ? 0.036 : 0.072;
    center.set(
      gaussian(rng) * spread,
      gaussian(rng) * (spread * 0.58),
      gaussian(rng) * spread,
    );
    const radius = inner ? 0.022 + rng() * 0.01 : 0.034 + rng() * 0.018;
    scales.set(radius, radius * 0.68, radius);
    quaternion.setFromAxisAngle(UP_AXIS, rng() * Math.PI * 2);
    color.copy(inner ? coreColor : haloColor).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    const radial = Math.min(1, center.length() / (spread * 2.2));
    const opacity = (inner ? 0.82 : 0.42) * (1 - radial * 0.55);
    packedSplats.pushSplat(center, scales, quaternion, opacity, color);
  }

  const mesh = new SplatMesh({ packedSplats, raycastable: false });
  mesh.numSplats = packedSplats.numSplats;
  mesh.name = `Sky body focus ${placement.body}`;
  mesh.position.set(...anchor);
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Dense surface volume baked from a verified chapter mesh. Tens of thousands
 * of splats oriented to the surface normal give the selected object thickness,
 * directional normal shading, and an inset subsurface core layer. Sampling is
 * area-weighted and deterministic for a given geometry.
 */
export function createChapterVolumeSplats(root: Object3D, targetCount: number = CHAPTER_VOLUME_COUNT): SplatMesh {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  interface Tri {
    a: Vector3;
    b: Vector3;
    c: Vector3;
    normal: Vector3;
    ca: Color;
    cb: Color;
    cc: Color;
    shade: number;
    area: number;
  }
  const tris: Tri[] = [];
  const toLocal = (mesh: Mesh, v: Vector3) => v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.count === 0) return;
    const colorAttr = geometry.getAttribute("color");
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const baseColor = material instanceof MeshStandardMaterial ? material.color.clone() : new Color("#d0b377");
    const index = geometry.getIndex();
    const read = (i: number) => toLocal(object, new Vector3().fromBufferAttribute(position, i));
    const readColor = (i: number) => {
      if (!colorAttr || i >= colorAttr.count) return baseColor.clone();
      return new Color(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i)).multiply(baseColor);
    };
    const addTri = (ia: number, ib: number, ic: number) => {
      const a = read(ia); const b = read(ib); const c = read(ic);
      if (![a, b, c].every((p) => [p.x, p.y, p.z].every(Number.isFinite))) return;
      const ab = b.clone().sub(a); const ac = c.clone().sub(a);
      const cross = ab.cross(ac);
      const area = cross.length() / 2;
      if (!(area > 1e-10)) return;
      const normal = cross.normalize();
      const ndotl = Math.max(0, normal.dot(KEY_LIGHT_DIR));
      const hemi = 0.5 + 0.5 * normal.y;
      const shade = (ndotl * 0.65 + hemi * 0.35 - 0.48) * 0.16;
      tris.push({
        a,
        b,
        c,
        normal,
        ca: readColor(ia),
        cb: readColor(ib),
        cc: readColor(ic),
        shade,
        area,
      });
    };
    if (index) {
      for (let i = 0; i + 2 < index.count; i += 3) addTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    } else {
      for (let i = 0; i + 2 < position.count; i += 3) addTri(i, i + 1, i + 2);
    }
  });

  const count = Math.max(1, Math.floor(targetCount));
  const packedSplats = new PackedSplats({ maxSplats: count });
  const rng = mulberry32(0x9e3779b9);
  const center = new Vector3();
  const scales = new Vector3();
  const quaternion = new Quaternion();
  const spin = new Quaternion();

  if (tris.length === 0) {
    // No surface to bake: a single inert splat keeps the mesh contract without hiding the mesh.
    packedSplats.pushSplat(new Vector3(), new Vector3(0.001, 0.001, 0.001), new Quaternion(), 0, new Color("#000000"));
    const empty = new SplatMesh({ packedSplats, raycastable: false });
    empty.numSplats = packedSplats.numSplats;
    empty.name = "Chapter volume (empty)";
    empty.raycast = () => {};
    return empty;
  }

  const cumulative: number[] = [];
  let totalArea = 0;
  for (const tri of tris) { totalArea += tri.area; cumulative.push(totalArea); }
  const box = new Box3().setFromObject(root);
  const span = box.isEmpty() ? 1 : Math.max(0.25, box.getSize(new Vector3()).length());
  const baseScale = Math.min(0.035, Math.max(0.01, span * 0.014));
  const color = new Color();

  for (let i = 0; i < count; i++) {
    const pick = rng() * totalArea;
    let lo = 0; let hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid]! < pick) lo = mid + 1; else hi = mid; }
    const tri = tris[lo]!;
    const r1 = rng(); const r2 = rng();
    const sqrtR1 = Math.sqrt(r1);
    const w0 = 1 - sqrtR1; const w1 = sqrtR1 * (1 - r2); const w2 = sqrtR1 * r2;
    const isSubsurface = i % 5 === 0;
    const inset = isSubsurface ? baseScale * (0.35 + rng() * 0.35) : 0;
    center.set(
      tri.a.x * w0 + tri.b.x * w1 + tri.c.x * w2 - tri.normal.x * inset,
      tri.a.y * w0 + tri.b.y * w1 + tri.c.y * w2 - tri.normal.y * inset,
      tri.a.z * w0 + tri.b.z * w1 + tri.c.z * w2 - tri.normal.z * inset,
    );
    quaternion.setFromUnitVectors(UP_AXIS, tri.normal);
    spin.setFromAxisAngle(tri.normal, rng() * Math.PI * 2);
    quaternion.premultiply(spin);
    const tangent = baseScale * (0.9 + rng() * 0.4) * (isSubsurface ? 1.18 : 1);
    scales.set(tangent, baseScale * (isSubsurface ? 0.42 : 0.28), tangent);
    color.setRGB(
      tri.ca.r * w0 + tri.cb.r * w1 + tri.cc.r * w2,
      tri.ca.g * w0 + tri.cb.g * w1 + tri.cc.g * w2,
      tri.ca.b * w0 + tri.cb.b * w1 + tri.cc.b * w2,
    );
    if (isSubsurface) {
      color.offsetHSL(-0.01, 0.04, tri.shade * 0.5 - 0.04 + (rng() - 0.5) * 0.03);
      packedSplats.pushSplat(center, scales, quaternion, 0.58, color);
    } else {
      color.offsetHSL(0, 0, tri.shade + (rng() - 0.5) * 0.04);
      packedSplats.pushSplat(center, scales, quaternion, 0.92, color);
    }
  }

  const mesh = new SplatMesh({ packedSplats, raycastable: false });
  mesh.numSplats = packedSplats.numSplats;
  mesh.name = "Chapter volume";
  mesh.raycast = () => {};
  return mesh;
}

/** Load a verified .spz companion as the chapter volume. Caller verifies the hash first. */
export async function createChapterSplatFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<SplatMesh> {
  const fileBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mesh = new SplatMesh({ fileBytes, raycastable: false });
  await mesh.initialized;
  mesh.raycast = () => {};
  mesh.name = "Chapter volume (spz)";
  return mesh;
}

export function createObservatorySplats({
  renderer,
  scene,
  placements = [],
  hasCourtyard,
  quality,
  onDirty,
}: ObservatorySplatsOptions): ObservatorySplats {
  const chapters = new Map<string, SplatMesh>();
  const skyBodies = new Map<PortraitSkyBody, SplatMesh>();
  let spark: SparkRenderer | null = null;
  let sky: SplatMesh | null = null;
  let disposed = false;
  let currentExperience: ObservatorySplatsExperienceState = {
    lighting: "day",
    skyView: false,
    comparison: false,
    selectedSkyBody: null,
  };

  if (quality !== "low") {
    ensureSparkContext(renderer);
    spark = new SparkRenderer({
      renderer,
      onDirty,
      enableLod: false,
      preUpdate: true,
      sortRadial: true,
    });
    spark.name = "Observatory spark renderer";
    spark.raycast = () => {};
    spark.maxStdDev = Math.sqrt(8);
    spark.blurAmount = 0.3;
    spark.focalAdjustment = 1.0;
    scene.add(spark);
    if (hasCourtyard) {
      sky = createSkyVolumeSplats(placements);
      sky.visible = false;
      scene.add(sky);
      const byBody = new Map<PortraitSkyBody, PortraitSkyPlacement>();
      for (const placement of placements) {
        zodiacPoint(placement.longitude, 1, 0);
        byBody.set(placement.body, placement);
      }
      for (const [body, placement] of byBody) {
        const focusMesh = createSkyBodyFocusSplats(placement);
        focusMesh.visible = false;
        skyBodies.set(body, focusMesh);
        scene.add(focusMesh);
      }
    }
  }

  const dayTint = new Color("#f2ead7");
  const duskTint = new Color("#ffe0b5");
  const skyFocusTint = new Color("#fff3d6");
  const chapterDayTint = new Color("#ffffff");
  const chapterDuskTint = new Color("#ffe4be");

  const api: ObservatorySplats = {
    get spark() { return spark; },
    get sky() { return sky; },
    get skyBodies() { return skyBodies; },
    get chapters() { return chapters; },
    setQuality(next) {
      if (next === "low") {
        api.dispose();
        return;
      }
      if (spark) {
        spark.maxStdDev = Math.sqrt(8);
        spark.blurAmount = 0.3;
      }
    },
    setExperience({ lighting, skyView, comparison, selectedSkyBody }) {
      currentExperience = { lighting, skyView, comparison, selectedSkyBody: selectedSkyBody ?? null };
      const dusk = lighting === "dusk";
      const chapterTint = dusk ? chapterDuskTint : chapterDayTint;
      for (const mesh of chapters.values()) {
        mesh.recolor.copy(chapterTint);
      }
      if (!sky) return;
      const showSky = skyView && !comparison;
      sky.visible = showSky;
      sky.opacity = 0.96;
      sky.recolor.copy(dusk ? duskTint : skyView || selectedSkyBody ? skyFocusTint : dayTint);
      for (const [body, focusMesh] of skyBodies) {
        const active = showSky && selectedSkyBody === body;
        focusMesh.visible = active;
        focusMesh.opacity = active ? 0.95 : 0;
        focusMesh.scale.setScalar(active ? 1.18 : 1);
        focusMesh.recolor.copy(dusk ? duskTint : skyFocusTint);
      }
    },
    setChapterVolumes(selectedIds, skyView) {
      for (const [id, mesh] of chapters) {
        const active = !skyView && selectedIds.includes(id);
        mesh.visible = active;
        mesh.opacity = active ? 1 : 0;
      }
    },
    setBlend(skyBlend, chapterBlends) {
      if (sky) {
        const clampedSky = Math.max(0, Math.min(1, skyBlend));
        sky.visible = clampedSky > 0.001 && !currentExperience.comparison;
        sky.opacity = 0.96 * clampedSky;
        for (const [body, focusMesh] of skyBodies) {
          const active = sky.visible && currentExperience.selectedSkyBody === body;
          focusMesh.visible = active;
          focusMesh.opacity = active ? 0.95 * clampedSky : 0;
          focusMesh.scale.setScalar(active ? 1 + 0.18 * clampedSky : 1);
        }
      }
      for (const [id, mesh] of chapters) {
        const blend = Math.max(0, Math.min(1, chapterBlends.get(id) ?? 0));
        mesh.visible = blend > 0.001;
        mesh.opacity = blend;
      }
    },
    attachChapterVolume(id, mesh, root) {
      const previous = chapters.get(id);
      if (previous && previous !== mesh) {
        scene.remove(previous);
        previous.dispose();
      }
      mesh.position.copy(root.position);
      mesh.rotation.copy(root.rotation);
      mesh.recolor.copy(currentExperience.lighting === "dusk" ? chapterDuskTint : chapterDayTint);
      chapters.set(id, mesh);
      if (!scene.children.includes(mesh)) scene.add(mesh);
    },
    syncTransforms(forms) {
      for (const form of forms) {
        const mesh = chapters.get(form.id);
        if (!mesh) continue;
        mesh.position.copy(form.root.position);
        mesh.rotation.copy(form.root.rotation);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (sky) {
        scene.remove(sky);
        sky.dispose();
        sky = null;
      }
      for (const focusMesh of skyBodies.values()) {
        scene.remove(focusMesh);
        focusMesh.dispose();
      }
      skyBodies.clear();
      for (const mesh of chapters.values()) {
        scene.remove(mesh);
        mesh.dispose();
      }
      chapters.clear();
      if (spark) {
        scene.remove(spark);
        spark.dispose();
        spark = null;
      }
    },
  };
  return api;
}
