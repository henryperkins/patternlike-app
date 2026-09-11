import assert from "node:assert/strict";
import test from "node:test";
import { parsePortraitMeshProgram, type PortraitMeshProgram } from "./portrait-mesh-program.js";

function program(): PortraitMeshProgram {
  return { version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
    parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null,
      geometry: { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 } }] };
}

test("admits declarative solid geometry and no executable or unknown input", () => {
  const valid = program();
  assert.deepEqual(parsePortraitMeshProgram(valid), valid);
  for (const value of [null, { ...valid, script: "process.exit()" }, { ...valid, url: "https://invalid.test" },
    { ...valid, parts: [{ ...valid.parts[0], expression: "Math.random()" }] },
    { ...valid, parts: [{ ...valid.parts[0], geometry: { kind: "custom", code: "return []" } }] }]) assert.equal(parsePortraitMeshProgram(value), null);
});

test("rejects nonfinite numbers, mirrored/zero transforms, unknown materials, and excessive counts", () => {
  const valid = program();
  for (const part of [
    { ...valid.parts[0], position: [NaN, 0, 0] }, { ...valid.parts[0], scale: [1, -1, 1] },
    { ...valid.parts[0], scale: [1, 0, 1] }, { ...valid.parts[0], material: "missing" },
    { ...valid.parts[0], geometry: { kind: "ellipsoid", radii: [1, 1, 1], segments: 1000000 } },
  ]) assert.equal(parsePortraitMeshProgram({ ...valid, parts: [part] }), null);
  assert.equal(parsePortraitMeshProgram({ ...valid, parts: Array.from({ length: 129 }, () => valid.parts[0]) }), null);
  assert.equal(parsePortraitMeshProgram({ ...valid, parts: Array.from({ length: 9 }, () => ({ ...valid.parts[0], repeat: { count: 64, translation: [0.1, 0, 0], rotation: [0, 0, 0] } })) }), null);
  assert.equal(parsePortraitMeshProgram({ ...valid, materials: Array.from({ length: 5 }, (_, i) => ({ ...valid.materials[0], id: `m${i}` })) }), null);
});

test("rejects self-intersecting and degenerate profiles before triangulation", () => {
  const valid = program();
  const invalid = [
    { kind: "extrude", outline: [[0, 0], [1, 1], [0, 1], [1, 0]], depth: 0.2, bevel: 0 },
    { kind: "extrude", outline: [[0, 0], [1, 0], [2, 0]], depth: 0.2, bevel: 0 },
    { kind: "lathe", profile: [[-1, 0], [1, 1], [1, 0]], segments: 24 },
    { kind: "path", points: [[0, 0, 0], [0, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "path", points: [[0, 0, 0], [1, 0, 0], [0, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "path", points: [[0, 0, 0], [1, 0, 0], [0.5, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "box", size: [1, 1, 1], bevel: 0.5 },
  ];
  for (const geometry of invalid) assert.equal(parsePortraitMeshProgram({ ...valid, parts: [{ ...valid.parts[0], geometry }] }), null);
});

test("admits all supported shape families with bounded numeric parameters", () => {
  const valid = program();
  const geometries = [
    { kind: "ellipsoid", radii: [1, 0.5, 0.4], segments: 16 },
    { kind: "cylinder", radiusTop: 0, radiusBottom: 0.4, height: 1, segments: 24 },
    { kind: "torus", radius: 0.6, tube: 0.1, segments: 24 },
    { kind: "lathe", profile: [[0.1, 0], [0.4, 0], [0.4, 0.5], [0.1, 0.5]], segments: 24 },
    { kind: "extrude", outline: [[0, 0], [1, 0], [0.5, 0.7]], depth: 0.2, bevel: 0.02 },
    { kind: "path", points: [[0, 0, 0], [0.4, 0.5, 0], [1, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "braid", points: [[0, 0, 0], [0.4, 0.5, 0], [1, 0, 0]], radius: 0.1, segments: 48, closed: false, strands: 3, twists: 5 },
  ];
  for (const geometry of geometries) assert.ok(parsePortraitMeshProgram({ ...valid, parts: [{ ...valid.parts[0], geometry }] }), JSON.stringify(geometry));
});

test("limits serialized programs to 64 KiB even when declaration counts are valid", () => {
  const valid = program();
  const dense: PortraitMeshProgram = { ...valid, parts: Array.from({ length: 128 }, (_, i) => ({ ...valid.parts[0]!, name: `path-${i}`,
    geometry: { kind: "path", points: Array.from({ length: 64 }, (_, n) => [Math.sin(n), Math.cos(n), n / 16]), radius: 0.02, segments: 8, closed: false } })) };
  assert.ok(Buffer.byteLength(JSON.stringify(dense)) > 64 * 1024);
  assert.equal(parsePortraitMeshProgram(dense), null);
  assert.ok(parsePortraitMeshProgram({ ...dense, parts: dense.parts.slice(0, 1) }));
});

test("adaptive programs bind every supported chapter count and retain geometry limits", () => {
  for (const chapterCount of [3, 4, 5, 6]) {
    const value = { ...program(), version: "portrait-mesh-program/v2", chapter_count: chapterCount, chapter_id: `chapter-${chapterCount}` };
    assert.deepEqual(parsePortraitMeshProgram(value), value);
    for (const patch of [{ chapter_count: 2 }, { chapter_count: 7 }, { chapter_count: 3.5 },
      { chapter_count: chapterCount - 1 }, { chapter_id: "chapter-0" }, { chapter_id: "chapter-7" },
      { version: "portrait-mesh-program/v1" }, { version: "portrait-mesh-program/v3" }, { injected: true },
      { parts: [{ ...value.parts[0], position: [NaN, 0, 0] }] },
    ]) assert.equal(parsePortraitMeshProgram({ ...value, ...patch }), null);
  }
});
