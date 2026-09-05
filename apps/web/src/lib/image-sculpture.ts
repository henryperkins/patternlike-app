import * as THREE from "three";
import type { ZodiacSignName } from "@patternlike/shared";
import { applySunLayout } from "./sun-sculpture.js";

export interface ImagePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Point = [number, number];
type Contour = { points: Point[]; area: number };
type FeatureLine = { a: Point; b: Point; strength: number };
type Evidence = {
  width: number;
  height: number;
  bounds: [number, number, number, number];
  mask: Uint8Array;
  luminance: Float32Array;
  contours: Contour[];
  lines: FeatureLine[];
  aspect: number;
  coverage: number;
  openingArea: number;
  skew: number;
  color: [number, number, number];
};

const MAX_STARS = 84;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Follow actual pixel boundaries, retaining concavities and interior loops. */
function traceContours(mask: Uint8Array, width: number, height: number): Contour[] {
  const stride = width + 1;
  const edges = new Map<number, number[]>();
  const add = (x: number, y: number, nx: number, ny: number) => {
    const from = y * stride + x;
    const to = ny * stride + nx;
    const outgoing = edges.get(from) ?? [];
    outgoing.push(to);
    edges.set(from, outgoing);
  };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) add(x, y, x + 1, y);
    if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!filled(x - 1, y)) add(x, y + 1, x, y);
  }
  const contours: Contour[] = [];
  for (const [start, outgoing] of edges) {
    while (outgoing.length) {
      const points: Point[] = [];
      let current = start;
      do {
        points.push([current % stride, Math.floor(current / stride)]);
        const next = edges.get(current)?.pop();
        if (next === undefined) break;
        current = next;
      } while (current !== start && points.length <= width * height * 4);
      if (points.length < 8 || current !== start) continue;
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!; const b = points[(i + 1) % points.length]!;
        area += a[0] * b[1] - a[1] * b[0];
      }
      if (Math.abs(area) >= 8) contours.push({ points, area: area / 2 });
    }
  }
  return contours.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
}

function blur(source: Float32Array, width: number, height: number): Float32Array {
  const kernel = [1, 4, 6, 4, 1];
  const horizontal = new Float32Array(source.length);
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let offset = -2; offset <= 2; offset++) {
      horizontal[y * width + x] += source[y * width + clamp(x + offset, 0, width - 1)]! * kernel[offset + 2]! / 16;
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let offset = -2; offset <= 2; offset++) {
      result[y * width + x] += horizontal[clamp(y + offset, 0, height - 1) * width + x]! * kernel[offset + 2]! / 16;
    }
  }
  return result;
}

/** Sparse, supported interior edges. Blurring and line support reject grain. */
function interiorLines(luma: Float32Array, mask: Uint8Array, width: number, height: number): FeatureLine[] {
  const samples: Array<{ x: number; y: number; gx: number; gy: number; magnitude: number }> = [];
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    if (!mask[y * width + x] || !mask[y * width + x - 2] || !mask[y * width + x + 2]
      || !mask[(y - 2) * width + x] || !mask[(y + 2) * width + x]) continue;
    const gx = (luma[y * width + x + 1]! - luma[y * width + x - 1]!) / 2;
    const gy = (luma[(y + 1) * width + x]! - luma[(y - 1) * width + x]!) / 2;
    const magnitude = Math.hypot(gx, gy);
    if (magnitude >= 0.018) samples.push({ x, y, gx, gy, magnitude });
  }
  if (!samples.length) return [];
  const angles = 90;
  const radius = Math.ceil(Math.hypot(width, height));
  const bins = radius * 2 + 1;
  const votes = new Float32Array(angles * bins);
  const cosine = Array.from({ length: angles }, (_, i) => Math.cos(i * Math.PI / angles));
  const sine = Array.from({ length: angles }, (_, i) => Math.sin(i * Math.PI / angles));
  for (const sample of samples) {
    const normal = (Math.atan2(sample.gy, sample.gx) + Math.PI) % Math.PI;
    const center = Math.round(normal / Math.PI * angles) % angles;
    for (let delta = -2; delta <= 2; delta++) {
      const angle = (center + delta + angles) % angles;
      const bin = Math.round(sample.x * cosine[angle]! + sample.y * sine[angle]!) + radius;
      votes[angle * bins + bin] += sample.magnitude;
    }
  }
  const peaks = Array.from({ length: votes.length }, (_, i) => i).filter((i) => votes[i]! > 0.15)
    .sort((a, b) => votes[b]! - votes[a]! || a - b).slice(0, 180);
  const lines: FeatureLine[] = [];
  for (const peak of peaks) {
    const angle = Math.floor(peak / bins);
    const rho = peak % bins - radius;
    const nx = cosine[angle]!; const ny = sine[angle]!;
    const supported = samples.filter((sample) => Math.abs(sample.x * nx + sample.y * ny - rho) < 1.3
      && Math.abs((sample.gx * nx + sample.gy * ny) / sample.magnitude) > 0.85)
      .map((sample) => ({ t: -sample.x * ny + sample.y * nx, strength: sample.magnitude }))
      .sort((a, b) => a.t - b.t);
    let start = 0;
    for (let end = 1; end <= supported.length; end++) {
      if (end < supported.length && supported[end]!.t - supported[end - 1]!.t < 3.5) continue;
      const first = supported[start]; const last = supported[end - 1];
      if (first && last && end - start >= 6 && last.t - first.t >= 9) {
        const a: Point = [nx * rho - ny * first.t, ny * rho + nx * first.t];
        const b: Point = [nx * rho - ny * last.t, ny * rho + nx * last.t];
        const length = distance(a, b);
        const duplicate = lines.some((line) => {
          const lx = line.b[0] - line.a[0]; const ly = line.b[1] - line.a[1];
          if (Math.abs((-ny * lx + nx * ly) / distance(line.a, line.b)) < 0.96) return false;
          const midpoint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const oldMidpoint: Point = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
          return Math.abs((midpoint[0] - oldMidpoint[0]) * nx + (midpoint[1] - oldMidpoint[1]) * ny) < 4
            && Math.abs(-(midpoint[0] - oldMidpoint[0]) * ny + (midpoint[1] - oldMidpoint[1]) * nx) < (length + distance(line.a, line.b)) * 0.45;
        });
        if (!duplicate) lines.push({ a, b, strength: Math.min(1, votes[peak]! / Math.max(1, length) * 8) });
      }
      start = end;
    }
    if (lines.length >= 8) break;
  }
  return lines.slice(0, 8);
}

function measure(image: ImagePixels, index: number): Evidence {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 8 || image.height < 8 || image.width * image.height > 40_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error(`Image ${index + 1} requires valid dimensions and a complete RGBA pixel buffer`);
  }
  const scale = Math.min(1, 128 / Math.max(image.width, image.height));
  const width = Math.max(8, Math.round(image.width * scale));
  const height = Math.max(8, Math.round(image.height * scale));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const border: number[][] = [[], [], []];
  let borderCount = 0;
  let visible = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height)) * image.width
      + Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width))) * 4;
    const target = (y * width + x) * 4;
    rgba.set(image.data.subarray(source, source + 4), target);
    if (rgba[target + 3]! > 32) visible++;
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
      borderCount++;
      if (rgba[target + 3]! > 32) for (let channel = 0; channel < 3; channel++) border[channel]!.push(rgba[target + channel]!);
    }
  }
  if (visible < width * height * 0.005) throw new Error(`Image ${index + 1} is blank or has no visible pixels`);
  const background = border.map((channel) => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)] ?? 255);
  const transparentBackground = border[0]!.length < borderCount * 0.25;
  const mask = new Uint8Array(width * height);
  const luminance = new Float32Array(mask.length);
  const color: [number, number, number] = [0, 0, 0];
  let minX = width; let minY = height; let maxX = 0; let maxY = 0; let count = 0; let skew = 0;
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    const alpha = rgba[offset + 3]!;
    const difference = Math.hypot(rgba[offset]! - background[0]!, rgba[offset + 1]! - background[1]!, rgba[offset + 2]! - background[2]!);
    luminance[i] = (rgba[offset]! * 0.2126 + rgba[offset + 1]! * 0.7152 + rgba[offset + 2]! * 0.0722) / 255;
    if (alpha > 32 && (transparentBackground || difference > 34)) {
      mask[i] = 1;
      const x = i % width; const y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let channel = 0; channel < 3; channel++) color[channel] = color[channel]! + rgba[offset + channel]! / 255;
      count++;
    }
  }
  if (count < width * height * 0.006 || maxX - minX < 3 || maxY - minY < 3) {
    throw new Error(`Image ${index + 1} has insufficient foreground contrast or is blank`);
  }
  const boxWidth = maxX - minX + 1; const boxHeight = maxY - minY + 1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    skew += ((i % width) - (minX + maxX) / 2) * ((minY + maxY) / 2 - Math.floor(i / width)) / (boxHeight * boxHeight);
  }
  const contours = traceContours(mask, width, height);
  if (!contours.length) throw new Error(`Image ${index + 1} has no usable foreground contour`);
  const smoothed = blur(luminance, width, height);
  return {
    width, height, bounds: [minX, minY, maxX + 1, maxY + 1], mask, luminance: smoothed, contours,
    lines: interiorLines(smoothed, mask, width, height),
    aspect: boxWidth / boxHeight, coverage: count / (boxWidth * boxHeight),
    openingArea: contours.filter((contour) => contour.area < 0).reduce((sum, contour) => sum + Math.abs(contour.area), 0) / (boxWidth * boxHeight),
    skew: clamp(skew / count, -0.3, 0.3),
    color: color.map((channel) => channel / count) as [number, number, number],
  };
}

function sampleContour(points: Point[], count: number): Point[] {
  const lengths = points.map((point, i) => distance(point, points[(i + 1) % points.length]!));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  const result: Point[] = [];
  let edge = 0; let travelled = 0;
  for (let sample = 0; sample < count; sample++) {
    const target = perimeter * sample / count;
    while (edge < lengths.length - 1 && travelled + lengths[edge]! < target) travelled += lengths[edge++]!;
    const fraction = (target - travelled) / lengths[edge]!;
    const a = points[edge]!; const b = points[(edge + 1) % points.length]!;
    result.push([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
  }
  return result;
}

/**
 * Build an open constellation from four images, keeping each source's outline,
 * holes and supported interior edges. No semantic labels, random positions, or
 * radial averages enter this graph. Depth is an artistic relief from measured
 * luminance and image coordinates, not a reconstruction of hidden surfaces.
 * Caller owns and must dispose both returned geometries.
 */
export function createImageSculpture(images: readonly ImagePixels[], sunSign: ZodiacSignName | null = null): {
  geometry: THREE.BufferGeometry;
  lineGeometry: THREE.BufferGeometry;
  connections: Array<[number, number]>;
  color: [number, number, number];
  contributions: Array<{ index: number; aspect: number; coverage: number; openingArea: number; skew: number; stars: number; interiorLines: number }>;
} {
  if (!Array.isArray(images) || images.length !== 4) throw new Error("Image sculpture requires exactly four images");
  const evidence = Array.from(images, measure);
  const positions: number[] = []; const sourceIndices: number[] = []; const strengths: number[] = [];
  const connections: Array<[number, number]> = [];
  const keys = new Set<string>();
  const groups: number[][] = [];
  const connect = (a: number, b: number) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (a !== b && !keys.has(key)) { keys.add(key); connections.push([a, b]); }
  };
  for (let sourceIndex = 0; sourceIndex < 4; sourceIndex++) {
    const source = evidence[sourceIndex]!;
    const group: number[] = []; const localPoints: Point[] = [];
    groups.push(group);
    const [minX, minY, maxX, maxY] = source.bounds;
    const unit = Math.min(1.2 / (maxY - minY), 1.3 / (maxX - minX));
    const addStar = (point: Point, strength: number) => {
      const duplicate = localPoints.findIndex((other) => distance(point, other) < 0.65);
      if (duplicate >= 0) return group[duplicate]!;
      if (group.length >= MAX_STARS) return -1;
      const x = (point[0] - (minX + maxX) / 2) * unit;
      const y = ((minY + maxY) / 2 - point[1]) * unit;
      const px = clamp(Math.round(point[0]), 0, source.width - 1);
      const py = clamp(Math.round(point[1]), 0, source.height - 1);
      const light = source.luminance[py * source.width + px]!;
      // A shallow, continuous curved relief keeps the drawing spatial during
      // rotation. Its bends follow the actual sampled positions and luminance.
      const z = 0.07 * Math.sin(x * Math.PI / 1.3) * Math.cos(y * Math.PI / 1.2) + (light - 0.5) * 0.04;
      const positioned = applySunLayout([x, y, z], sourceIndex, sunSign);
      const index = positions.length / 3;
      positions.push(...positioned); sourceIndices.push(sourceIndex); strengths.push(clamp(strength, 0, 1));
      group.push(index); localPoints.push(point);
      return index;
    };
    const main = source.contours[0]!;
    const loops = [main, ...source.contours.slice(1).filter((contour) => Math.abs(contour.area) > Math.abs(main.area) * 0.012).slice(0, 2)];
    for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
      const points = sampleContour(loops[loopIndex]!.points, loopIndex === 0 ? 40 : 12);
      const vertices = points.map((point, i) => {
        const before = points[(i + points.length - 1) % points.length]!;
        const after = points[(i + 1) % points.length]!;
        const turn = 1 - ((point[0] - before[0]) * (after[0] - point[0]) + (point[1] - before[1]) * (after[1] - point[1]))
          / Math.max(0.001, distance(before, point) * distance(point, after));
        return addStar(point, 0.3 + Math.min(0.6, turn * 0.8));
      });
      for (let i = 0; i < vertices.length; i++) if (vertices[i]! >= 0 && vertices[(i + 1) % vertices.length]! >= 0) connect(vertices[i]!, vertices[(i + 1) % vertices.length]!);
    }
    for (const line of source.lines) {
      const count = Math.min(6, Math.max(3, Math.ceil(distance(line.a, line.b) / 10)));
      if (group.length + count > MAX_STARS) continue;
      let previous = -1;
      for (let i = 0; i < count; i++) {
        const fraction = i / (count - 1);
        const point: Point = [line.a[0] + (line.b[0] - line.a[0]) * fraction, line.a[1] + (line.b[1] - line.a[1]) * fraction];
        const index = addStar(point, (i === 0 || i === count - 1 ? 0.58 : 0.28) + line.strength * 0.32);
        if (previous >= 0 && index >= 0) connect(previous, index);
        previous = index;
      }
    }
    // Join separate measured feature paths with the minimum number of shortest
    // links. Retain their contours, rather than triangulating their interiors.
    const parent = new Map(group.map((index) => [index, index]));
    const root = (index: number): number => {
      while (parent.get(index) !== index) index = parent.get(index)!;
      return index;
    };
    for (const [a, b] of connections) if (parent.has(a) && parent.has(b)) parent.set(root(a), root(b));
    const candidates: Array<{ a: number; b: number; length: number }> = [];
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      candidates.push({ a: group[a]!, b: group[b]!, length: distance(localPoints[a]!, localPoints[b]!) });
    }
    candidates.sort((a, b) => a.length - b.length || a.a - b.a || a.b - b.b);
    for (const candidate of candidates) if (root(candidate.a) !== root(candidate.b)) {
      connect(candidate.a, candidate.b); parent.set(root(candidate.a), root(candidate.b));
    }
  }
  // A single ordered spine ties the four image fragments into one composition.
  for (let source = 0; source < 3; source++) {
    let pair: [number, number] = [groups[source]![0]!, groups[source + 1]![0]!];
    let minimum = Infinity;
    for (const a of groups[source]!) for (const b of groups[source + 1]!) {
      const length = Math.hypot(positions[a * 3]! - positions[b * 3]!, positions[a * 3 + 1]! - positions[b * 3 + 1]!, positions[a * 3 + 2]! - positions[b * 3 + 2]!);
      if (length < minimum) { minimum = length; pair = [a, b]; }
    }
    connect(...pair);
    strengths[pair[0]] = 1; strengths[pair[1]] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("sourceIndex", new THREE.Float32BufferAttribute(sourceIndices, 1));
  geometry.setAttribute("starStrength", new THREE.Float32BufferAttribute(strengths, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const linePositions: number[] = []; const lineSources: number[] = [];
  for (const edge of connections) for (const vertex of edge) {
    linePositions.push(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!);
    lineSources.push(sourceIndices[vertex]!);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("sourceIndex", new THREE.Float32BufferAttribute(lineSources, 1));
  lineGeometry.computeBoundingBox(); lineGeometry.computeBoundingSphere();
  return {
    geometry, lineGeometry, connections,
    color: [0, 1, 2].map((channel) => evidence.reduce((sum, source) => sum + source.color[channel]!, 0) / 4) as [number, number, number],
    contributions: evidence.map((source, index) => ({ index, aspect: source.aspect, coverage: source.coverage,
      openingArea: source.openingArea, skew: source.skew, stars: groups[index]!.length, interiorLines: source.lines.length })),
  };
}
