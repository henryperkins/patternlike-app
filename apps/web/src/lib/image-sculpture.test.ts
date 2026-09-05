import { describe, expect, it } from "vitest";
import { ZODIAC_SIGNS } from "@patternlike/shared";
import { createImageSculpture, type ImagePixels } from "./image-sculpture.js";

function pixels(halfWidth = 22, opening = false, taper = 0, interior = false): ImagePixels {
  const width = 96;
  const height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const extent = halfWidth * (1 - taper * (1 - y / height));
    const filled = y > 12 && y < 116 && Math.abs(x - 48) < extent
      && !(opening && ((x - 48) / 10) ** 2 + ((y - 39) / 13) ** 2 < 1);
    const detail = interior && filled && ((Math.abs(x - 42) < 2 && y > 35 && y < 97)
      || (Math.abs(y - 72) < 2 && x > 34 && x < 62));
    data.set(filled ? detail ? [21, 24, 26, 255] : [132, 112, 91, 255] : [246, 244, 240, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const images = () => [pixels(), pixels(31), pixels(29, false, 0.48, true), pixels(26, true)];
type Model = ReturnType<typeof createImageSculpture>;
function dispose(model: Model) { model.geometry.dispose(); model.lineGeometry.dispose(); }
function sourcePositions(model: Model, source: number): number[] {
  const p = model.geometry.getAttribute("position");
  const sources = model.geometry.getAttribute("sourceIndex");
  return Array.from({ length: p.count }, (_, i) => i).filter((i) => sources.getX(i) === source)
    .flatMap((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
}

function verifyGraph(model: Model) {
  const p = model.geometry.getAttribute("position");
  const sources = model.geometry.getAttribute("sourceIndex");
  const strength = model.geometry.getAttribute("starStrength");
  const segments = model.lineGeometry.getAttribute("position");
  const lineSources = model.lineGeometry.getAttribute("sourceIndex");
  expect(model.geometry.getIndex()).toBeNull();
  expect(model.lineGeometry.getIndex()).toBeNull();
  expect(p.count).toBeGreaterThanOrEqual(160);
  expect(p.count).toBeLessThanOrEqual(400);
  expect(sources.count).toBe(p.count);
  expect(strength.count).toBe(p.count);
  expect(Array.from(strength.array).every((value) => value >= 0 && value <= 1)).toBe(true);
  expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
  expect(segments.count).toBe(model.connections.length * 2);
  expect(lineSources.count).toBe(segments.count);
  expect(model.connections.length).toBeLessThan(p.count * 1.4);
  const adjacency = Array.from({ length: p.count }, () => new Set<number>());
  const seen = new Set<string>();
  let bridges = 0;
  for (let edge = 0; edge < model.connections.length; edge++) {
    const [a, b] = model.connections[edge]!;
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(p.count);
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    adjacency[a]!.add(b);
    adjacency[b]!.add(a);
    if (sources.getX(a) !== sources.getX(b)) bridges++;
    for (const [endpoint, vertex] of [[0, a], [1, b]]) {
      const lineVertex = edge * 2 + endpoint!;
      expect([segments.getX(lineVertex), segments.getY(lineVertex), segments.getZ(lineVertex)])
        .toEqual([p.getX(vertex!), p.getY(vertex!), p.getZ(vertex!)]);
      expect(lineSources.getX(lineVertex)).toBe(sources.getX(vertex!));
    }
  }
  expect(bridges).toBe(3);
  const reached = new Set([0]);
  const queue = [0];
  for (const vertex of queue) for (const neighbor of adjacency[vertex]!) {
    if (!reached.has(neighbor)) { reached.add(neighbor); queue.push(neighbor); }
  }
  expect(reached.size).toBe(p.count);
  for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i), p.getY(i), p.getZ(i))).toBeLessThanOrEqual(2.31);
  for (let source = 0; source < 4; source++) {
    const count = Array.from(sources.array).filter((value) => value === source).length;
    expect(count).toBeGreaterThanOrEqual(40);
    expect(count).toBeLessThanOrEqual(100);
  }
  // A tilted flat card has z extent too. Test volume between actual stars.
  const origin = [p.getX(0), p.getY(0), p.getZ(0)];
  const vector = (i: number) => [p.getX(i) - origin[0]!, p.getY(i) - origin[1]!, p.getZ(i) - origin[2]!];
  let volume = 0;
  for (let a = 1; a < p.count; a += 7) {
    const u = vector(a);
    for (let b = a + 1; b < p.count; b += 17) {
      const v = vector(b);
      for (let c = b + 1; c < p.count; c += 31) {
        const w = vector(c);
        volume = Math.max(volume, Math.abs(u[0]! * (v[1]! * w[2]! - v[2]! * w[1]!)
          - u[1]! * (v[0]! * w[2]! - v[2]! * w[0]!) + u[2]! * (v[0]! * w[1]! - v[1]! * w[0]!)));
      }
    }
  }
  expect(volume).toBeGreaterThan(0.02);
}

describe("createImageSculpture constellation", () => {
  it("makes one sparse connected spatial star graph with exactly three chapter bridges", () => {
    const model = createImageSculpture(images());
    verifyGraph(model);
    expect(model.contributions).toHaveLength(4);
    expect(model.color.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    dispose(model);
  });

  it.each([0, 1, 2, 3])("preserves structural influence from image %i without averaging away its outline", (source) => {
    const inputs = images();
    const before = createImageSculpture(inputs);
    inputs[source] = pixels(36, false, 0.2);
    const after = createImageSculpture(inputs);
    expect(sourcePositions(after, source)).not.toEqual(sourcePositions(before, source));
    expect(after.contributions[source]!.aspect).not.toBe(before.contributions[source]!.aspect);
    dispose(before); dispose(after);
  });

  it.each([0, 1, 2, 3])("retains internal image %i edges even when its outer silhouette is unchanged", (source) => {
    const inputs = [pixels(), pixels(), pixels(), pixels()];
    const before = createImageSculpture(inputs);
    inputs[source] = pixels(22, false, 0, true);
    const after = createImageSculpture(inputs);
    expect(after.contributions[source]!.aspect).toBe(before.contributions[source]!.aspect);
    expect(after.contributions[source]!.coverage).toBe(before.contributions[source]!.coverage);
    expect(sourcePositions(after, source)).not.toEqual(sourcePositions(before, source));
    // New feature stars are required, not merely a different scalar depth/color.
    expect(sourcePositions(after, source).length).toBeGreaterThan(sourcePositions(before, source).length);
    dispose(before); dispose(after);
  });

  it("keeps a measured interior opening as its own star contour", () => {
    const solid = createImageSculpture([pixels(), pixels(), pixels(), pixels()]);
    const open = createImageSculpture([pixels(22, true), pixels(), pixels(), pixels()]);
    expect(open.contributions[0]!.openingArea).toBeGreaterThan(0.03);
    expect(sourcePositions(open, 0).length).toBeGreaterThan(sourcePositions(solid, 0).length);
    verifyGraph(open);
    dispose(solid); dispose(open);
  });

  it.each(ZODIAC_SIGNS)("keeps the %s arrangement finite, bounded, connected, and sparse", (sign) => {
    const model = createImageSculpture(images(), sign);
    verifyGraph(model);
    dispose(model);
  });

  it("arranges all twelve Sun signs distinctly while retaining each chapter's image features", () => {
    const inputs = images();
    const baseline = createImageSculpture(inputs);
    const variants = new Set<string>();
    for (const sign of ZODIAC_SIGNS) {
      const model = createImageSculpture(inputs, sign);
      const repeated = createImageSculpture(inputs, sign);
      const positions = Array.from(model.geometry.getAttribute("position").array);
      variants.add(JSON.stringify(positions));
      expect(positions).not.toEqual(Array.from(baseline.geometry.getAttribute("position").array));
      expect(Array.from(repeated.geometry.getAttribute("position").array)).toEqual(positions);
      expect(model.contributions).toEqual(baseline.contributions);
      expect(Array.from(model.geometry.getAttribute("sourceIndex").array))
        .toEqual(Array.from(baseline.geometry.getAttribute("sourceIndex").array));
      expect(model.color).toEqual(baseline.color);
      dispose(model); dispose(repeated);
    }
    expect(variants.size).toBe(12);
    dispose(baseline);
  });

  it("is deterministic and ignores metadata outside the explicit pixel contract", () => {
    const inputs = images();
    const first = createImageSculpture(inputs);
    const second = createImageSculpture(inputs.map((item) => ({ ...item, subject: "arbitrary text", seed: 9465 })));
    expect(Array.from(second.geometry.getAttribute("position").array)).toEqual(Array.from(first.geometry.getAttribute("position").array));
    expect(second.connections).toEqual(first.connections);
    dispose(first); dispose(second);
  });

  it("requires exactly four complete, visible, contrasting pixel buffers", () => {
    expect(() => createImageSculpture([])).toThrow(/four|4/i);
    expect(() => createImageSculpture(new Array<ImagePixels>(4))).toThrow(/image 1/i);
    const blank = { width: 96, height: 128, data: new Uint8ClampedArray(96 * 128 * 4) };
    expect(() => createImageSculpture([pixels(), pixels(), pixels(), blank])).toThrow(/image 4.*visible|image 4.*blank/i);
    const flat = pixels(); flat.data.fill(255);
    expect(() => createImageSculpture([flat, pixels(), pixels(), pixels()])).toThrow(/image 1.*contrast|image 1.*blank|image 1.*foreground/i);
    expect(() => createImageSculpture([{ ...pixels(), width: Number.NaN }, pixels(), pixels(), pixels()])).toThrow(/image 1/i);
    expect(() => createImageSculpture([{ ...pixels(), data: new Uint8ClampedArray(8) }, pixels(), pixels(), pixels()])).toThrow(/image 1/i);
  });

  it("supports transparent backgrounds without mistaking a partly transparent border for all foreground", () => {
    const original = pixels(22, true);
    const partial = { ...original, data: new Uint8ClampedArray(original.data) };
    for (let x = 0; x < partial.width; x++) for (let y = 0; y < 5; y++) partial.data[(y * partial.width + x) * 4 + 3] = 0;
    const transparent = { ...original, data: new Uint8ClampedArray(original.data) };
    for (let i = 0; i < transparent.data.length; i += 4) if (transparent.data[i] === 246) transparent.data[i + 3] = 0;
    const before = createImageSculpture([original, pixels(), pixels(), pixels()]);
    for (const image of [partial, transparent]) {
      const model = createImageSculpture([image, pixels(), pixels(), pixels()]);
      expect(model.contributions[0]!.aspect).toBeCloseTo(before.contributions[0]!.aspect, 6);
      expect(model.contributions[0]!.openingArea).toBeCloseTo(before.contributions[0]!.openingArea, 6);
      verifyGraph(model);
      dispose(model);
    }
    dispose(before);
  });
});
