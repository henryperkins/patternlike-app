import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { MeshIdentity, PortraitMeshGeometry, PortraitMeshProgram } from "@patternlike/shared";
import { compilePortraitMesh } from "./portrait-mesh-compiler.js";
import { validatePortraitMeshGlb } from "../../api/src/services/portrait-mesh-glb.js";

const identity: MeshIdentity = { chapterId: "chapter-1", documentRevision: "reading:v7:accepted", sourceImageSha256: "1".repeat(64), sourceTextSha256: "2".repeat(64) };
function program(geometry: PortraitMeshGeometry = { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 }): PortraitMeshProgram {
  return { version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
    parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry }] };
}

test("compiles deterministic source-bound GLB bytes that the real loader decodes", async () => {
  const result = compilePortraitMesh(program(), identity);
  assert.deepEqual(result, compilePortraitMesh(program(), identity));
  assert.equal(result.sha256, createHash("sha256").update(result.glb).digest("hex"));
  assert.ok(result.triangles > 12 && result.triangles <= 20_000);
  assert.ok(result.glb.length < 750_000);
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(result.glb).buffer, "");
  assert.equal(loaded.scene.children.length, 1);
  assert.equal(loaded.scene.children[0]!.name, "chapter-1");
  assert.deepEqual(loaded.scene.children[0]!.userData, { name: "chapter-1", ...identity, programSha256: result.programSha256, compilerVersion: result.compilerVersion, authoring: "codex-parametric/v1" });
  let meshes = 0;
  loaded.scene.traverse((node: any) => {
    if (!node.isMesh) return;
    meshes++;
    assert.equal(node.material.transparent, false);
    assert.ok(node.geometry.index.count > 0);
    node.geometry.dispose(); node.material.dispose();
  });
  assert.equal(meshes, 1);
});

test("rejects unsafe declarations, excessive triangles, and wrong trusted identities", () => {
  const repeated = program({ kind: "ellipsoid", radii: [1, 1, 1], segments: 32 });
  repeated.parts[0]!.repeat = { count: 64, translation: [0.1, 0, 0], rotation: [0, 0, 0] };
  assert.throws(() => compilePortraitMesh(repeated, identity), /budget/);
  assert.throws(() => compilePortraitMesh({ ...program(), script: "throw 1" } as PortraitMeshProgram, identity), /program/);
  assert.throws(() => compilePortraitMesh(program(), { ...identity, sourceImageSha256: "unknown" }), /identity/);
});

test("rejects collapsed rounded-box faces and reversing/repeated open paths", () => {
  const invalid: PortraitMeshGeometry[] = [
    { kind: "box", size: [1, 1, 1], bevel: 0.5 },
    { kind: "path", points: [[0, 0, 0], [1, 0, 0], [0, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "path", points: [[0, 0, 0], [1, 0, 0], [0.5, 0, 0]], radius: 0.1, segments: 24, closed: false },
  ];
  for (const shape of invalid) assert.throws(() => compilePortraitMesh(program(shape), identity), /program|Degenerate/);
});

test("rejects numerical geometry collapse without rejecting a proper cone", () => {
  const cone = compilePortraitMesh(program({ kind: "cylinder", radiusTop: 0, radiusBottom: 0.4, height: 1, segments: 24 }), identity);
  assert.equal(cone.triangles, 48);
  assert.throws(() => compilePortraitMesh(program({ kind: "box", size: [1, 1, 1], bevel: 0.499999999 }), identity), /Degenerate/);
});

test("each supported family has finite indexed normals, meaningful depth, and actual enclosed volume", async () => {
  const families: PortraitMeshGeometry[] = [
    { kind: "box", size: [1, 1, 1], bevel: 0 },
    { kind: "ellipsoid", radii: [1, 0.5, 0.4], segments: 16 },
    { kind: "cylinder", radiusTop: 0.2, radiusBottom: 0.4, height: 1, segments: 24 },
    { kind: "torus", radius: 0.6, tube: 0.1, segments: 24 },
    { kind: "lathe", profile: [[0.1, 0], [0.4, 0], [0.4, 0.5], [0.1, 0.5]], segments: 24 },
    { kind: "extrude", outline: [[0, 0], [1, 0], [0.5, 0.7]], depth: 0.2, bevel: 0.02 },
    { kind: "path", points: [[0, 0, 0], [0.4, 0.5, 0], [1, 0, 0]], radius: 0.1, segments: 24, closed: false },
    { kind: "braid", points: [[0, 0, 0], [0.4, 0.5, 0], [1, 0, 0]], radius: 0.1, segments: 48, closed: false, strands: 3, twists: 5 },
  ];
  for (const geometry of families) {
    const result = compilePortraitMesh(program(geometry), identity);
    assert.ok(Math.abs(Math.max(...result.bounds.max.map((value, axis) => value - result.bounds.min[axis]!)) - 2) < 0.00001, geometry.kind);
    const bytes = Buffer.from(result.glb);
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(json.buffers.length, 1); assert.equal(json.buffers[0].uri, undefined);
    assert.equal(json.images, undefined);
    const model = await new GLTFLoader().parseAsync(Uint8Array.from(result.glb).buffer, "");
    let volume = 0;
    model.scene.traverse((node: any) => {
      if (!node.isMesh) return;
      const positions = node.geometry.attributes.position;
      const normals = node.geometry.attributes.normal;
      for (const value of positions.array) assert.ok(Number.isFinite(value), geometry.kind);
      for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 0.001, geometry.kind);
      const indices = node.geometry.index.array;
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2];
        volume += (positions.getX(a) * (positions.getY(b) * positions.getZ(c) - positions.getZ(b) * positions.getY(c))
          + positions.getY(a) * (positions.getZ(b) * positions.getX(c) - positions.getX(b) * positions.getZ(c))
          + positions.getZ(a) * (positions.getX(b) * positions.getY(c) - positions.getY(b) * positions.getX(c))) / 6;
      }
      node.geometry.dispose(); node.material.dispose();
    });
    assert.ok(Math.abs(volume) > 0.00001, `${geometry.kind} enclosed volume`);
  }
});

test("repetition expands actual geometry while canonical property ordering preserves program identity", () => {
  const source = program({ kind: "box", size: [0.2, 1, 0.2], bevel: 0 });
  const single = compilePortraitMesh(source, identity);
  source.parts[0]!.repeat = { count: 3, translation: [0.5, 0, 0], rotation: [0, 0, 0] };
  const repeated = compilePortraitMesh(source, identity);
  assert.equal(repeated.triangles, single.triangles * 3);
  const reordered = { parts: source.parts, materials: source.materials, version: source.version };
  assert.deepEqual(compilePortraitMesh(reordered, identity), repeated);
  assert.notEqual(compilePortraitMesh(source, { ...identity, sourceImageSha256: "3".repeat(64) }).sha256, repeated.sha256);
});

test("path end caps share the actual tube perimeter without open boundary edges", async () => {
  const result = compilePortraitMesh(program({ kind: "path", points: [[0, 0, 0], [0.4, 0.5, 0.2], [1, 0, 0]], radius: 0.1, segments: 24, closed: false }), identity);
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(result.glb).buffer, "");
  const edges = new Map<string, number>();
  loaded.scene.traverse((node: any) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position;
    const ids = node.geometry.index.array;
    const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(value => Math.round(value * 100000)).join(",");
    for (let i = 0; i < ids.length; i += 3) for (const [a, b] of [[ids[i], ids[i + 1]], [ids[i + 1], ids[i + 2]], [ids[i + 2], ids[i]]]) {
      const edge = [key(a), key(b)].sort().join("|");
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
    node.geometry.dispose(); node.material.dispose();
  });
  assert.ok([...edges.values()].every(count => count === 2), "every surface edge has exactly two adjacent triangles");
});

test("rejects the GLB payload budget independently of the triangle count", () => {
  const source = program({ kind: "extrude", outline: Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32), Math.sin(i * Math.PI / 32)]), depth: 0.2, bevel: 0 });
  source.parts[0]!.repeat = { count: 64, translation: [0, 0, 0], rotation: [0, 0, 0] };
  source.parts.push({ ...source.parts[0]!, name: "more", repeat: { count: 15, translation: [0, 0, 0], rotation: [0, 0, 0] } });
  assert.throws(() => compilePortraitMesh(source, identity), /payload budget/);
});

test("generated multi-material GLBs pass the actual Worker publication validator", () => {
  const source = program();
  source.materials.push({ id: "brass", color: "#b38641", metalness: 0.6, roughness: 0.4 });
  source.parts.push({ ...source.parts[0]!, name: "rim", material: "brass", position: [0, 0.8, 0],
    geometry: { kind: "torus", radius: 0.6, tube: 0.08, segments: 24 } });
  const result = compilePortraitMesh(source, identity);
  const binding = { ...identity, programSha256: result.programSha256, compilerVersion: result.compilerVersion, authoring: "codex-parametric/v1" };
  assert.equal(validatePortraitMeshGlb(result.glb, binding), true);
  assert.equal(validatePortraitMeshGlb(result.glb, { ...binding, sourceImageSha256: "9".repeat(64) }), false);
});
