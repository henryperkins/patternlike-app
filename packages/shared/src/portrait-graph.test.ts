import assert from "node:assert/strict";
import test from "node:test";
import { createPortraitGraph, isPortraitGraph, isUsablePortraitImage } from "./portrait-graph.js";

function reference(shape: number) {
  const width = 64; const height = 64;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 9; y < 55; y++) for (let x = 9; x < 55; x++) {
    const inside = shape === 0 ? x < 33 : shape === 1 ? y < 40
      : shape === 2 ? Math.abs(x - 32) < (y - 6) / 2 : Math.hypot(x - 32, y - 32) < 22;
    if (inside) {
      const offset = (y * width + x) * 4;
      data[offset] = 45; data[offset + 1] = 68; data[offset + 2] = 87;
    }
  }
  return { width, height, data };
}

test("four image contributions survive a serialized saved-graph roundtrip", () => {
  const graph = createPortraitGraph([0, 1, 2, 3].map(reference), "leo");
  const restored: unknown = JSON.parse(JSON.stringify(graph));
  assert.equal(isPortraitGraph(restored), true);
  assert.deepEqual(restored, graph);
  assert.deepEqual(graph.contributions.map(({ index }) => index), [0, 1, 2, 3]);
  for (const contribution of graph.contributions) {
    assert.equal(contribution.stars, graph.source_indices.filter((source) => source === contribution.index).length);
  }
});

test("changing one reference changes its stars while retaining other chapters", () => {
  const images = [0, 1, 2, 3].map(reference);
  const original = createPortraitGraph(images, "aries");
  for (let changed = 0; changed < 4; changed++) {
    const replacement = images.map((image, index) => index === changed ? reference((changed + 1) % 4) : image);
    const next = createPortraitGraph(replacement, "aries");
    for (let source = 0; source < 4; source++) {
      const coordinates = (graph: typeof original) => graph.source_indices.flatMap((index, point) =>
        index === source ? graph.positions.slice(point * 3, point * 3 + 3) : []);
      if (source === changed) assert.notDeepEqual(coordinates(original), coordinates(next));
      else assert.deepEqual(coordinates(original), coordinates(next));
    }
  }
});

test("saved graphs reject corrupt geometry, source attribution and unsupported versions", () => {
  const graph = createPortraitGraph([0, 1, 2, 3].map(reference), null);
  const corruptions = [
    { ...graph, engine_version: "future" },
    { ...graph, positions: [Number.NaN, ...graph.positions.slice(1)] },
    { ...graph, positions: graph.positions.slice(1) },
    { ...graph, source_indices: graph.source_indices.map(() => 0) },
    { ...graph, star_strengths: graph.star_strengths.map(() => 5) },
    { ...graph, connections: [...graph.connections, [0, graph.source_indices.length]] },
    { ...graph, connections: [] },
    { ...graph, connections: [...graph.connections, graph.connections[0]] },
    { ...graph, contributions: graph.contributions.slice(1) },
  ];
  for (const corrupted of corruptions) assert.equal(isPortraitGraph(corrupted), false);
  assert.equal(isPortraitGraph(null), false);
});

test("chapter admission rejects unusable samples before accepting an immutable image", () => {
  const blank = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
  const transparent = { ...blank, data: new Uint8ClampedArray(blank.data.length) };
  const faint = reference(0);
  for (let i = 0; i < faint.data.length; i += 4) {
    if (faint.data[i] !== 255) faint.data[i] = faint.data[i + 1] = faint.data[i + 2] = 254;
  }
  for (const image of [blank, transparent, faint]) assert.equal(isUsablePortraitImage(image), false);
  for (let shape = 0; shape < 4; shape++) assert.equal(isUsablePortraitImage(reference(shape)), true);
});
