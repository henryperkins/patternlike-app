import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { MeshIdentity, PortraitMeshProgram } from "@patternlike/shared";
import { renderPortraitMeshPreviews } from "./portrait-mesh-preview.js";

const identity: MeshIdentity = { chapterId: "chapter-1", documentRevision: "reading:7", sourceImageSha256: "1".repeat(64), sourceTextSha256: "2".repeat(64) };
function program(): PortraitMeshProgram {
  return { version: "portrait-mesh-program/v1", materials: [
    { id: "red", color: "#dc3020", metalness: 0, roughness: 0.7 },
    { id: "blue", color: "#2050dc", metalness: 0, roughness: 0.7 },
  ], parts: [
    { name: "front", material: "red", position: [0, 0, 0.35], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null,
      geometry: { kind: "box", size: [1, 1.4, 0.3], bevel: 0 } },
    { name: "rear", material: "blue", position: [0, 0, -0.35], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null,
      geometry: { kind: "box", size: [1.3, 0.8, 0.3], bevel: 0 } },
  ] };
}

test("renders deterministic material and silhouette PNGs from four actual geometry views", async () => {
  const views = await renderPortraitMeshPreviews(program(), identity);
  assert.deepEqual(views.map(view => view.label), ["front", "rear", "side", "three-quarter"]);
  assert.deepEqual(views, await renderPortraitMeshPreviews(program(), identity));
  for (const view of views) {
    const metadata = await sharp(view.png).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
    assert.ok(view.png.length > 1_000);
  }
  assert.equal(new Set(views.map(view => view.png.toString("base64"))).size, 4);
  const center = async (png: Buffer) => [...await sharp(png).extract({ left: 256, top: 256, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  const front = await center(views[0]!.png); const rear = await center(views[1]!.png);
  assert.ok(front[0]! > front[2]! * 2, "front red surface occludes rear blue geometry");
  assert.ok(rear[2]! > rear[0]! * 2, "rear blue surface occludes front red geometry");
});

test("does not preview malformed or computationally excessive programs", async () => {
  await assert.rejects(renderPortraitMeshPreviews({ ...program(), code: "return true" } as PortraitMeshProgram, identity), /program/);
  const dense = program();
  dense.parts = Array.from({ length: 128 }, (_, i) => ({ ...dense.parts[0]!, name: `overlap-${i}` }));
  await assert.rejects(renderPortraitMeshPreviews(dense, identity), /raster budget/);
});
