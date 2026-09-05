import * as THREE from "three";

export interface ImagePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Point = [number, number];
type Hole = { x: number; y: number; radiusX: number; radiusY: number; area: number };
type Evidence = {
  aspect: number;
  coverage: number;
  radii: number[];
  color: [number, number, number];
  hole: Hole | null;
  skew: number;
};

const SEGMENTS = 192;
const SECTIONS = 64;
const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function smooth(values: number[], passes: number): number[] {
  let result = values;
  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((_, i) => {
      let sum = 0;
      for (let delta = -2; delta <= 2; delta += 1) {
        sum += result[(i + delta + result.length) % result.length]! * (3 - Math.abs(delta));
      }
      return sum / 9;
    });
  }
  return result;
}

function measure(image: ImagePixels, index: number): Evidence {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 8 || image.height < 8 || image.width * image.height > 40_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error(`Image ${index + 1} requires valid dimensions and a complete RGBA pixel buffer`);
  }
  const scale = Math.min(1, 192 / Math.max(image.width, image.height));
  const width = Math.max(8, Math.round(image.width * scale));
  const height = Math.max(8, Math.round(image.height * scale));
  const sampled = new Uint8ClampedArray(width * height * 4);
  const border: number[][] = [[], [], []];
  let borderCount = 0;
  let visible = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height)) * image.width
        + Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width))) * 4;
      const target = (y * width + x) * 4;
      sampled.set(image.data.subarray(source, source + 4), target);
      if (sampled[target + 3]! > 32) visible += 1;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        borderCount += 1;
        if (sampled[target + 3]! > 32) {
          for (let channel = 0; channel < 3; channel += 1) border[channel]!.push(sampled[target + channel]!);
        }
      }
    }
  }
  if (visible < width * height * 0.005) throw new Error(`Image ${index + 1} is blank or has no visible pixels`);
  const background = border.map((channel) => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)] ?? 255);
  const transparentBackground = border[0]!.length < borderCount * 0.25;
  const mask = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const color: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * 4;
    const alpha = sampled[offset + 3]!;
    const difference = Math.hypot(sampled[offset]! - background[0]!, sampled[offset + 1]! - background[1]!, sampled[offset + 2]! - background[2]!);
    if (alpha > 32 && (transparentBackground || difference > 34)) {
      mask[i] = 1;
      const x = i % width;
      const y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let channel = 0; channel < 3; channel += 1) color[channel] = color[channel]! + sampled[offset + channel]! / 255;
      count += 1;
    }
  }
  if (count < width * height * 0.006 || maxX - minX < 3 || maxY - minY < 3) {
    throw new Error(`Image ${index + 1} has insufficient foreground contrast or is blank`);
  }
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const aspect = boxWidth / boxHeight;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const unit = 3.5 / boxHeight;
  const radii = Array<number>(SEGMENTS).fill(0);
  let skew = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const x = (i % width - centerX) * unit;
    const y = (centerY - Math.floor(i / width)) * unit;
    const angle = (Math.atan2(y, x) + TAU) % TAU;
    const bin = Math.round(angle / TAU * SEGMENTS) % SEGMENTS;
    radii[bin] = Math.max(radii[bin]!, Math.hypot(x, y));
    skew += x * y;
  }
  // The outer envelope may bridge a concavity; it is a contour abstraction,
  // not a claim that these unrelated images recover a physical object.
  for (let i = 0; i < SEGMENTS; i += 1) {
    if (radii[i]! > 0) continue;
    let previous = 1;
    let next = 1;
    while (!radii[(i - previous + SEGMENTS) % SEGMENTS] && previous < SEGMENTS) previous += 1;
    while (!radii[(i + next) % SEGMENTS] && next < SEGMENTS) next += 1;
    radii[i] = (radii[(i - previous + SEGMENTS) % SEGMENTS]! * next + radii[(i + next) % SEGMENTS]! * previous) / (next + previous);
  }

  // Flood background components. Only a sizeable enclosed component is
  // allowed to create a through opening; brightness alone is not depth.
  const visited = new Uint8Array(mask.length);
  let hole: Hole | null = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let touchesEdge = false;
    let sumX = 0;
    let sumY = 0;
    let hMinX = width; let hMaxX = 0;
    let hMinY = height; let hMaxY = 0;
    for (const point of queue) {
      const x = point % width;
      const y = Math.floor(point / width);
      touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      sumX += x; sumY += y;
      hMinX = Math.min(hMinX, x); hMaxX = Math.max(hMaxX, x);
      hMinY = Math.min(hMinY, y); hMaxY = Math.max(hMaxY, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx! < 0 || nx! >= width || ny! < 0 || ny! >= height) continue;
        const neighbor = ny! * width + nx!;
        if (!mask[neighbor] && !visited[neighbor]) { visited[neighbor] = 1; queue.push(neighbor); }
      }
    }
    const area = queue.length / (boxWidth * boxHeight);
    if (!touchesEdge && area > 0.012 && (!hole || area > hole.area)) {
      hole = {
        x: (sumX / queue.length - centerX) * unit,
        y: (centerY - sumY / queue.length) * unit,
        radiusX: (hMaxX - hMinX + 1) * unit * 0.44,
        radiusY: (hMaxY - hMinY + 1) * unit * 0.44,
        area,
      };
    }
  }
  return {
    aspect, coverage: count / (boxWidth * boxHeight), radii: smooth(radii, 4), hole,
    color: color.map((channel) => channel / count) as [number, number, number],
    skew: clamp(skew / count, -0.3, 0.3),
  };
}

function weights(angle: number): number[] {
  const directional = Array.from({ length: 4 }, (_, index) => Math.exp(1.4 * Math.cos(angle - index * Math.PI / 2 - Math.PI / 4)));
  const total = directional.reduce((sum, value) => sum + value, 0);
  return directional.map((value) => 0.14 + 0.44 * value / total);
}

function rayBoundary(origin: Point, angle: number, boundary: Point[]): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    const ex = b[0] - a[0]; const ey = b[1] - a[1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-10) continue;
    const ax = a[0] - origin[0]; const ay = a[1] - origin[1];
    const ray = (ax * ey - ay * ex) / denominator;
    const segment = (ax * dy - ay * dx) / denominator;
    if (ray > 0 && segment >= 0 && segment <= 1) distance = Math.min(distance, ray);
  }
  return Number.isFinite(distance) ? distance : 0;
}

/**
 * Synthesize one connected sculpture from exactly four decoded pixel images.
 * The algorithm measures foreground envelopes, aspect, skew, and enclosed
 * background. It blends the envelopes into a single contour and rounds its
 * depth into a continuous surface. A measured opening becomes one aperture.
 * It does not classify subjects or interpret the inputs as camera views.
 * Caller owns the returned geometry and must dispose it.
 */
export function createImageSculpture(images: readonly ImagePixels[]): {
  geometry: THREE.BufferGeometry;
  color: [number, number, number];
  contributions: Array<{ index: number; aspect: number; coverage: number; openingArea: number; skew: number }>;
} {
  if (!Array.isArray(images) || images.length !== 4) throw new Error("Image sculpture requires exactly four images");
  const evidence = Array.from(images, measure);
  const boundary: Point[] = Array.from({ length: SEGMENTS }, (_, i) => {
    const angle = i * TAU / SEGMENTS;
    const blend = weights(angle);
    const radius = evidence.reduce((sum, source, sourceIndex) => sum + source.radii[i]! * blend[sourceIndex]!, 0);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  const minY = Math.min(...boundary.map((point) => point[1]));
  const maxY = Math.max(...boundary.map((point) => point[1]));
  for (const point of boundary) point[1] = (point[1] - (maxY + minY) / 2) * 3.5 / (maxY - minY);
  const strongestHole = evidence.map((source) => source.hole).filter((hole): hole is Hole => hole !== null).sort((a, b) => b.area - a.area)[0];
  const origin: Point = strongestHole ? [clamp(strongestHole.x, -0.2, 0.2), clamp(strongestHole.y, -1, 1)] : [0, 0];
  let outer = boundary.map((_, i) => rayBoundary(origin, i * TAU / SEGMENTS, boundary));
  if (outer.some((distance) => distance < 0.08)) {
    origin[0] = 0; origin[1] = 0;
    outer = boundary.map((_, i) => rayBoundary(origin, i * TAU / SEGMENTS, boundary));
  }
  outer = smooth(outer, 2);
  const inner = strongestHole ? outer.map((distance, i) => {
    const angle = i * TAU / SEGMENTS;
    const ellipse = 1 / Math.hypot(Math.cos(angle) / strongestHole.radiusX, Math.sin(angle) / strongestHole.radiusY);
    return Math.min(ellipse, distance * 0.7);
  }) : null;
  const positions: number[] = [];
  const sourceIndices: number[] = [];
  const indices: number[] = [];
  const meanSkew = evidence.reduce((sum, item) => sum + item.skew, 0) / 4;
  function addVertex(angleIndex: number, fraction: number, side: number) {
    const angle = angleIndex * TAU / SEGMENTS;
    const blend = weights(angle);
    const radius = inner ? inner[angleIndex]! + (outer[angleIndex]! - inner[angleIndex]!) * fraction : outer[angleIndex]! * fraction;
    const x = origin[0] + Math.cos(angle) * radius;
    const y = origin[1] + Math.sin(angle) * radius;
    const fullness = evidence.reduce((sum, item, i) => sum + blend[i]! * (0.3 + 0.22 * item.coverage + 0.13 * Math.min(item.aspect, 1.4)), 0);
    const thickness = inner ? fullness * (0.6 + 0.4 * Math.min(1.3, outer[angleIndex]! - inner[angleIndex]!)) : fullness;
    const z = side * thickness + meanSkew * y * 0.7;
    positions.push(x, y, z);
    sourceIndices.push(blend.indexOf(Math.max(...blend)));
  }
  if (inner) {
    // Periodic in both directions: one welded genus-one surface, without
    // independent meshes, Boolean seams, caps, or coincident edge vertices.
    for (let i = 0; i < SEGMENTS; i += 1) {
      for (let j = 0; j < SECTIONS; j += 1) {
        const phase = j * TAU / SECTIONS;
        addVertex(i, (1 + Math.cos(phase)) / 2, Math.sin(phase));
      }
    }
    for (let i = 0; i < SEGMENTS; i += 1) {
      for (let j = 0; j < SECTIONS; j += 1) {
        const a = i * SECTIONS + j;
        const b = ((i + 1) % SEGMENTS) * SECTIONS + j;
        const c = ((i + 1) % SEGMENTS) * SECTIONS + (j + 1) % SECTIONS;
        const d = i * SECTIONS + (j + 1) % SECTIONS;
        indices.push(a, b, d, b, c, d);
      }
    }
  } else {
    // One front pole, shared perimeter rings, one back pole.
    addVertex(0, 0, 1);
    for (let j = 1; j < SECTIONS; j += 1) {
      const phase = j * Math.PI / SECTIONS;
      for (let i = 0; i < SEGMENTS; i += 1) addVertex(i, Math.sin(phase), Math.cos(phase));
    }
    addVertex(0, 0, -1);
    const last = positions.length / 3 - 1;
    for (let i = 0; i < SEGMENTS; i += 1) {
      const next = (i + 1) % SEGMENTS;
      indices.push(0, 1 + i, 1 + next);
      for (let j = 0; j < SECTIONS - 2; j += 1) {
        const a = 1 + j * SEGMENTS + i;
        const b = 1 + j * SEGMENTS + next;
        const c = b + SEGMENTS;
        const d = a + SEGMENTS;
        indices.push(a, d, b, b, d, c);
      }
      indices.push(last, last - SEGMENTS + next, last - SEGMENTS + i);
    }
  }
  let maximumRadius = 0;
  for (let i = 0; i < positions.length; i += 3) maximumRadius = Math.max(maximumRadius, Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  if (maximumRadius > 2.19) {
    const fit = 2.19 / maximumRadius;
    for (let i = 0; i < positions.length; i += 1) positions[i] = positions[i]! * fit;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("sourceIndex", new THREE.Float32BufferAttribute(sourceIndices, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    geometry,
    color: [0, 1, 2].map((channel) => evidence.reduce((sum, item) => sum + item.color[channel]!, 0) / 4) as [number, number, number],
    contributions: evidence.map((item, index) => ({ index, aspect: item.aspect, coverage: item.coverage, openingArea: item.hole?.area ?? 0, skew: item.skew })),
  };
}
