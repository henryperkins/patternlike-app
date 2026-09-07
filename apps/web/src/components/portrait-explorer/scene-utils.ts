import { Box3, Mesh, Texture, Vector3, type Object3D, type Material, type Raycaster } from "three";
import type { CameraBookmark, Point3, PortraitMeshAsset } from "./types.js";

export const MAX_GLB_BYTES = 12 * 1024 * 1024;
export const HOME_DIRECTION = new Vector3(0.15, 0.76, 1).normalize();

/** Raycaster does not itself exclude invisible ancestors, including a cutaway roof. */
export function firstVisibleIntersection(raycaster: Raycaster, roots: readonly Object3D[]) {
  const targets: Mesh[] = [];
  for (const root of roots) root.traverseVisible(object => {
    if (object instanceof Mesh && (Array.isArray(object.material) ? object.material.some(material => material.visible) : object.material.visible)) targets.push(object);
  });
  return raycaster.intersectObjects(targets, false)[0];
}

/** Inspect the container before GLTFLoader can follow a buffer or image URL. */
export function validateGlb(bytes: ArrayBuffer, chapterId?: string, source?: PortraitMeshAsset): void {
  if (bytes.byteLength < 20 || bytes.byteLength > MAX_GLB_BYTES) throw new Error("Invalid GLB size");
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength) throw new Error("Invalid GLB header");
  let offset = 12;
  let json: unknown;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("Invalid GLB chunk");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (!length || length % 4 || offset + 8 + length > bytes.byteLength) throw new Error("Invalid GLB chunk size");
    if (offset === 12) {
      if (type !== 0x4e4f534a || length > 1024 * 1024) throw new Error("Invalid GLB JSON chunk");
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, offset + 8, length)));
    } else if (type !== 0x004e4942) throw new Error("Unexpected GLB chunk");
    offset += 8 + length;
  }
  const document = json as { asset?: { version?: string } } | null;
  if (!document || document.asset?.version !== "2.0") throw new Error("Unsupported glTF version");
  const pending: unknown[] = [document];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "uri") throw new Error("Only self-contained GLB resources are supported");
      if (entry && typeof entry === "object") pending.push(entry);
    }
  }
  if (chapterId !== undefined) {
    const identity = document as {
      scene?: number;
      scenes?: Array<{ nodes?: number[] }>;
      nodes?: Array<{ name?: string; extras?: Record<string, unknown> }>;
    };
    const roots = identity.scenes?.[0]?.nodes;
    const rootIndex = roots?.[0];
    const root = typeof rootIndex === "number" ? identity.nodes?.[rootIndex] : undefined;
    if (!chapterId || (identity.scene ?? 0) !== 0 || identity.scenes?.length !== 1
      || !Array.isArray(roots) || roots.length !== 1 || !Number.isInteger(rootIndex)
      || !Array.isArray(identity.nodes) || root?.name !== chapterId || root.extras?.chapterId !== chapterId) {
      throw new Error("Model chapter identity mismatch");
    }
    if (source?.provenance) {
      const expected = { ...source.provenance, chapterId: source.chapterId, sourceImageSha256: source.sourceImageSha256 };
      if (Object.entries(expected).some(([key, value]) => root.extras?.[key] !== value)) throw new Error("Model source provenance mismatch");
    }
    for (const [index, node] of identity.nodes.entries()) {
      // Inspect raw names before GLTFLoader makes duplicate node names unique.
      if (index !== rootIndex && (node?.extras?.chapterId !== undefined || node?.name === chapterId
        || (typeof node?.name === "string" && /^chapter-\d+$/.test(node.name)))) {
        throw new Error("Conflicting or duplicate model chapter identity");
      }
    }
  }
}

export async function verifyGlbAsset(bytes: ArrayBuffer, expected: string, chapterId?: string, source?: PortraitMeshAsset): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid model hash");
  validateGlb(bytes, chapterId, source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error("Model hash mismatch");
  if (source?.provenance) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.sourceText));
    const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (sourceHash !== source.provenance.sourceTextSha256) throw new Error("Model source text hash mismatch");
  }
}

/** A camera-space fit leaves room for native labels while retaining all four forms. */
export function cameraFrame(boxes: readonly Box3[], selected: readonly number[], aspect: number): CameraBookmark {
  const whole = new Box3();
  for (const box of boxes) whole.union(box);
  if (whole.isEmpty()) whole.set(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
  const target = whole.getCenter(new Vector3());
  const chosen = new Box3();
  for (const index of selected) if (boxes[index]) chosen.union(boxes[index]!);
  if (!chosen.isEmpty()) target.lerp(chosen.getCenter(new Vector3()), 0.22);
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), HOME_DIRECTION).normalize();
  const up = new Vector3().crossVectors(HOME_DIRECTION, right).normalize();
  const tangent = Math.tan(38 * Math.PI / 360);
  const horizontal = tangent * Math.max(0.1, Number.isFinite(aspect) ? aspect : 1);
  let distance = 2;
  for (const box of boxes.length ? boxes : [whole]) {
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new Vector3(x, y, z).sub(target);
      distance = Math.max(distance, point.dot(HOME_DIRECTION)
        + Math.max(Math.abs(point.dot(right)) / horizontal, Math.abs(point.dot(up)) / tangent) / 0.82);
    }
  }
  return { position: target.clone().addScaledVector(HOME_DIRECTION, distance).toArray(), target: target.toArray() };
}

/** Preserve the orbit and user zoom relative to the viewport's fitted frame. */
export function adaptCameraBookmark(bookmark: CameraBookmark, frameDistance: number): CameraBookmark {
  const previous = bookmark.frameDistance;
  const scale = previous && Number.isFinite(previous) && previous > 0 ? frameDistance / previous : 1;
  const target = new Vector3(...bookmark.target);
  return {
    position: new Vector3(...bookmark.position).sub(target).multiplyScalar(scale).add(target).toArray(),
    target: [...bookmark.target],
    frameDistance,
  };
}

export interface LabelRect { x: number; y: number; width: number; height: number; }

/** Choose the nearest free rectangle from the usable viewport and obstacle edges. */
export function placeLabel(preferred: LabelRect, viewport: LabelRect, obstacles: readonly LabelRect[]): LabelRect | null {
  const maxX = viewport.x + viewport.width - preferred.width;
  const maxY = viewport.y + viewport.height - preferred.height;
  if (maxX < viewport.x || maxY < viewport.y) return null;
  // A pixel of clearance covers fractional text widths without excluding the narrow dial’s center.
  const gap = 1;
  const xs = [preferred.x, viewport.x, maxX];
  const ys = [preferred.y, viewport.y, maxY];
  for (const box of obstacles) {
    xs.push(box.x - preferred.width - gap, box.x + box.width + gap);
    ys.push(box.y - preferred.height - gap, box.y + box.height + gap);
  }
  const columns = new Set(xs.map(x => Math.max(Math.ceil(viewport.x), Math.min(Math.floor(maxX), Math.round(x)))));
  const rows = new Set(ys.map(y => Math.max(Math.ceil(viewport.y), Math.min(Math.floor(maxY), Math.round(y)))));
  let best: LabelRect | null = null;
  let distance = Infinity;
  for (const x of columns) for (const y of rows) {
    const score = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
    if (score >= distance || obstacles.some(box => x < box.x + box.width + gap && x + preferred.width + gap > box.x
      && y < box.y + box.height + gap && y + preferred.height + gap > box.y)) continue;
    best = { ...preferred, x, y };
    distance = score;
  }
  return best;
}

/** Four-chapter composition in published order; model Y is seated separately. */
export function chapterLayout(index: number, unfolded: boolean): Point3 {
  const layouts: Point3[] = [[1.13, 0, 1.05], [-1.15, 0, -1.08], [1.2, 0, -1.12], [-1.18, 0, 1.24]];
  const source = layouts[index] ?? [0, 0, 0];
  const spacing = unfolded ? 1.46 : 1;
  return [source[0] * spacing, source[1], source[2] * spacing];
}

export function isCameraBookmark(value: unknown): value is CameraBookmark {
  if (!value || typeof value !== "object") return false;
  const bookmark = value as CameraBookmark;
  const point = (candidate: unknown): candidate is Point3 => Array.isArray(candidate) && candidate.length === 3
    && candidate.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) < 1000);
  return point(bookmark.position) && point(bookmark.target)
    && new Vector3().fromArray(bookmark.position).distanceTo(new Vector3().fromArray(bookmark.target)) > 0.1;
}
interface TapPointer { pointerId: number; clientX: number; clientY: number; isPrimary: boolean; button: number; }
export class TapTracker {
  private start: { pointer: TapPointer; scrollX: number; scrollY: number; dragged: boolean } | null = null;
  private contacts = new Set<number>();
  down(event: TapPointer, scrollX: number, scrollY: number) {
    this.contacts.add(event.pointerId);
    if (this.contacts.size !== 1 || event.isPrimary === false || event.button !== 0) { this.start = null; return; }
    this.start = { pointer: { ...event, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }, scrollX, scrollY, dragged: false };
  }
  move(event: TapPointer) {
    if (this.start?.pointer.pointerId === event.pointerId
      && Math.hypot(event.clientX - this.start.pointer.clientX, event.clientY - this.start.pointer.clientY) > 5) this.start.dragged = true;
  }
  up(event: TapPointer, scrollX: number, scrollY: number): boolean {
    const start = this.start;
    this.contacts.delete(event.pointerId);
    this.start = null;
    return !!start && start.pointer.pointerId === event.pointerId && !start.dragged && this.contacts.size === 0
      && Math.hypot(event.clientX - start.pointer.clientX, event.clientY - start.pointer.clientY) <= 5
      && Math.abs(scrollX - start.scrollX) <= 1 && Math.abs(scrollY - start.scrollY) <= 1;
  }
  cancel() { this.start = null; this.contacts.clear(); }
}

/** GLTF scenes may share all three resources, and image bitmaps have independent ownership. */
export function disposeModel(roots: readonly Object3D[]): void {
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const images = new Set<{ close?: () => void }>();
  for (const root of roots) root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const source = texture.source.data as { close?: () => void } | Array<{ close?: () => void }> | null;
    if (source) for (const image of Array.isArray(source) ? source : [source]) images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close?.();
  for (const geometry of geometries) geometry.dispose();
}
