import { describe, expect, it } from "vitest";
import { createImageSculpture, type ImagePixels } from "./image-sculpture.js";

function pixels(halfWidth = 20, opening = false, taper = 0): ImagePixels {
  const width = 96;
  const height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const extent = halfWidth * (1 - taper * (1 - y / height));
      const filled = y > 12 && y < 116 && Math.abs(x - 48) < extent
        && !(opening && ((x - 48) / 10) ** 2 + ((y - 39) / 13) ** 2 < 1);
      const offset = (y * width + x) * 4;
      data.set(filled ? [94, 77, 54, 255] : [246, 244, 240, 255], offset);
    }
  }
  return { width, height, data };
}

function topology(result: ReturnType<typeof createImageSculpture>) {
  const { geometry } = result;
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const index = geometry.getIndex()!;
  const adjacency = Array.from({ length: positions.count }, () => new Set<number>());
  const edges = new Map<string, { count: number; orientation: number }>();
  let signedVolume = 0;
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k);
    const b = index.getX(k + 1);
    const c = index.getX(k + 2);
    const ab = [positions.getX(b) - positions.getX(a), positions.getY(b) - positions.getY(a), positions.getZ(b) - positions.getZ(a)];
    const ac = [positions.getX(c) - positions.getX(a), positions.getY(c) - positions.getY(a), positions.getZ(c) - positions.getZ(a)];
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    expect(Math.hypot(...cross)).toBeGreaterThan(1e-8);
    signedVolume += (positions.getX(a) * cross[0]! + positions.getY(a) * cross[1]! + positions.getZ(a) * cross[2]!) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      adjacency[u!]!.add(v!);
      adjacency[v!]!.add(u!);
      const key = `${Math.min(u!, v!)}:${Math.max(u!, v!)}`;
      const edge = edges.get(key) ?? { count: 0, orientation: 0 };
      edge.count += 1;
      edge.orientation += u! < v! ? 1 : -1;
      edges.set(key, edge);
    }
  }
  expect(signedVolume).toBeGreaterThan(0.05);
  expect([...edges.values()].every((edge) => edge.count === 2 && edge.orientation === 0)).toBe(true);
  const reached = new Set([0]);
  const queue = [0];
  for (const vertex of queue) {
    for (const neighbor of adjacency[vertex]!) {
      if (!reached.has(neighbor)) { reached.add(neighbor); queue.push(neighbor); }
    }
  }
  expect(reached.size).toBe(positions.count);
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    expect(Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex))).toBeCloseTo(1, 4);
    expect(Math.hypot(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex))).toBeLessThanOrEqual(2.2);
  }
  expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeLessThanOrEqual(3.51);
  expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeGreaterThan(0.35);
  expect(index.count / 3).toBeLessThan(40_000);
  return positions.count - edges.size + index.count / 3;
}

function widthOf(result: ReturnType<typeof createImageSculpture>): number {
  return result.geometry.boundingBox!.max.x - result.geometry.boundingBox!.min.x;
}

describe("createImageSculpture", () => {
  it("requires exactly four complete visible pixel buffers", () => {
    expect(() => createImageSculpture([])).toThrow(/four|4/i);
    expect(() => createImageSculpture(new Array<ImagePixels>(4))).toThrow(/image 1/i);
    const blank = { width: 96, height: 128, data: new Uint8ClampedArray(96 * 128 * 4) };
    expect(() => createImageSculpture([pixels(), pixels(), pixels(), blank])).toThrow(/image 4.*visible|image 4.*blank/i);
    const flat = pixels();
    flat.data.fill(255);
    expect(() => createImageSculpture([flat, pixels(), pixels(), pixels()])).toThrow(/image 1.*contrast|image 1.*blank|image 1.*foreground/i);
    expect(() => createImageSculpture([{ ...pixels(), width: Number.NaN }, pixels(), pixels(), pixels()])).toThrow(/image 1/i);
    expect(() => createImageSculpture([{ ...pixels(), data: new Uint8ClampedArray(8) }, pixels(), pixels(), pixels()])).toThrow(/image 1/i);
  });

  it("does not turn an opaque background into foreground when a few border pixels are transparent", () => {
    const original = pixels(22, true);
    const altered = { ...original, data: new Uint8ClampedArray(original.data) };
    for (let x = 0; x < altered.width; x += 1) {
      for (let y = 0; y < 5; y += 1) altered.data[(y * altered.width + x) * 4 + 3] = 0;
    }
    const before = createImageSculpture([original, pixels(), pixels(), pixels()]);
    const after = createImageSculpture([altered, pixels(), pixels(), pixels()]);
    expect(after.contributions[0]!.aspect).toBeCloseTo(before.contributions[0]!.aspect, 6);
    expect(widthOf(after)).toBeCloseTo(widthOf(before), 6);
    before.geometry.dispose();
    after.geometry.dispose();
  });

  it("supports transparent-background silhouettes and associates each vertex with a neutral input slot", () => {
    const source = pixels(22, true);
    for (let i = 0; i < source.data.length; i += 4) {
      if (source.data[i] === 246) source.data[i + 3] = 0;
    }
    const result = createImageSculpture([source, pixels(), pixels(), pixels()]);
    expect(result.contributions[0]!.openingArea).toBeGreaterThan(0.03);
    const sourceIndex = result.geometry.getAttribute("sourceIndex");
    expect(sourceIndex.count).toBe(result.geometry.getAttribute("position").count);
    expect([...new Set(Array.from(sourceIndex.array))].sort()).toEqual([0, 1, 2, 3]);
    result.geometry.dispose();
  });

  it("makes one closed connected dimensional surface without inventing openings", () => {
    const result = createImageSculpture([pixels(), pixels(29), pixels(26, false, 0.5), pixels(24)]);
    expect(topology(result)).toBe(2);
    expect(result.contributions).toHaveLength(4);
    expect(result.color.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    result.geometry.dispose();
  });

  it("preserves enclosed background evidence as a real through opening", () => {
    const result = createImageSculpture([pixels(), pixels(29), pixels(26, false, 0.5), pixels(24, true)]);
    expect(topology(result)).toBe(0);
    result.geometry.dispose();
  });

  it("is deterministic and ignores metadata outside the explicit pixel contract", () => {
    const images = [pixels(), pixels(29), pixels(26, false, 0.5), pixels(24, true)];
    const first = createImageSculpture(images);
    const second = createImageSculpture(images.map((item) => ({ ...item, subject: "arbitrary unrelated text", seed: 9465 })));
    expect(Array.from(second.geometry.getAttribute("position").array)).toEqual(Array.from(first.geometry.getAttribute("position").array));
    expect(Array.from(second.geometry.getIndex()!.array)).toEqual(Array.from(first.geometry.getIndex()!.array));
    first.geometry.dispose();
    second.geometry.dispose();
  });

  it.each([0, 1, 2, 3])("uses image %i structurally: widening its silhouette widens the surface", (imageIndex) => {
    const images = [pixels(18), pixels(18), pixels(18), pixels(18)];
    const before = createImageSculpture(images);
    images[imageIndex] = pixels(30);
    const after = createImageSculpture(images);
    expect(widthOf(after)).toBeGreaterThan(widthOf(before) + 0.08);
    expect(after.contributions[imageIndex]!.aspect).toBeGreaterThan(before.contributions[imageIndex]!.aspect);
    before.geometry.dispose();
    after.geometry.dispose();
  });

  it.each([0, 1, 2, 3])("uses image %i profile changes at the corresponding height", (imageIndex) => {
    const images = [pixels(28), pixels(28), pixels(28), pixels(28)];
    const before = createImageSculpture(images);
    images[imageIndex] = pixels(28, false, 0.6);
    const after = createImageSculpture(images);
    const upperWidth = (result: ReturnType<typeof createImageSculpture>) => {
      const p = result.geometry.getAttribute("position");
      const xs = Array.from({ length: p.count }, (_, index) => index).filter((index) => p.getY(index) > 0.6 && p.getY(index) < 1.1).map((index) => p.getX(index));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(upperWidth(after)).toBeLessThan(upperWidth(before) - 0.025);
    before.geometry.dispose();
    after.geometry.dispose();
  });
});
