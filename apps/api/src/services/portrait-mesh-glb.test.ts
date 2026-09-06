import { describe, it, expect } from "vitest";
import { validatePortraitMeshGlb } from "./portrait-mesh-glb.js";
import { fixtureGlb } from "../../test/portrait-mesh-fixture.js";
const identity = {
  chapterId: "chapter-1",
  documentRevision: "revision",
  sourceImageSha256: "a".repeat(64),
  sourceTextSha256: "b".repeat(64),
  programSha256: "c".repeat(64),
  compilerVersion: "portrait-mesh-compiler/v1",
  authoring: "codex-parametric/v1",
};
describe("private mesh GLB boundary", () => {
  it("accepts bounded indexed normal-bearing geometry with exact identity", () =>
    expect(validatePortraitMeshGlb(fixtureGlb(identity), identity)).toBe(true));
  it("rejects foreign identities, external buffers and unsupported material transport", () => {
    expect(
      validatePortraitMeshGlb(
        fixtureGlb({ ...identity, chapterId: "chapter-2" }),
        identity,
      ),
    ).toBe(false);
    expect(
      validatePortraitMeshGlb(
        fixtureGlb(identity, {
          buffers: [{ byteLength: 80, uri: "https://private.test" }],
        }),
        identity,
      ),
    ).toBe(false);
    expect(
      validatePortraitMeshGlb(
        fixtureGlb(identity, { images: [{ uri: "file:///private" }] }),
        identity,
      ),
    ).toBe(false);
    expect(
      validatePortraitMeshGlb(
        fixtureGlb(identity, {
          extensionsUsed: ["KHR_draco_mesh_compression"],
        }),
        identity,
      ),
    ).toBe(false);
  });
});

it("requires one correctly named baked root and rejects render-cost multiplication by instances", () => {
  expect(
    validatePortraitMeshGlb(
      fixtureGlb(identity, {
        nodes: [{ name: "chapter-2", extras: identity, mesh: 0 }],
      }),
      identity,
    ),
  ).toBe(false);
  expect(
    validatePortraitMeshGlb(
      fixtureGlb(identity, {
        nodes: [{ name: "chapter-1", extras: identity, mesh: 0 }, { mesh: 0 }],
        scenes: [{ nodes: [0, 1] }],
      }),
      identity,
    ),
  ).toBe(false);
});
