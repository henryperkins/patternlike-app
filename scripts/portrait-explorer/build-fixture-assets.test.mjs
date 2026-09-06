import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildFixtures, parseGlb } from "./build-fixture-assets.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const fixturePromise = buildFixtures(repo);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("all four fictional fixtures bind exactly to the inspected native images", async () => {
  const { manifest, assets } = await fixturePromise;
  assert.equal(manifest.version, 1);
  assert.match(manifest.authoring.description, /fictional/);
  assert.match(manifest.authoring.description, /not automatic image reconstruction/);
  assert.equal(assets.length, 4);
  assert.deepEqual(manifest.assets.map((asset) => asset.chapterId), ["chapter-1", "chapter-2", "chapter-3", "chapter-4"]);
  for (const [index, asset] of assets.entries()) {
    const metadata = manifest.assets[index];
    assert.equal(metadata.sha256, sha256(asset.bytes));
    const source = await readFile(`${repo}/apps/web/src/preview/references/native-0${index + 1}.png`);
    assert.equal(metadata.sourceImageSha256, sha256(source));
  }
});

test("GLBs have complete volumetric indexed geometry, finite positions, and exact bounds", async () => {
  const { manifest, assets } = await fixturePromise;
  for (const [assetIndex, asset] of assets.entries()) {
    const { json, binary } = parseGlb(asset.bytes);
    assert.equal(json.asset.version, "2.0");
    assert.equal(json.nodes[0].name, manifest.assets[assetIndex].chapterId);
    assert.equal(json.buffers.length, 1);
    assert.equal(json.buffers[0].uri, undefined);
    assert.equal(json.images, undefined);
    assert.equal(json.textures, undefined);
    const observedMin = [Infinity, Infinity, Infinity];
    const observedMax = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode, 4);
      const accessor = json.accessors[primitive.attributes.POSITION];
      const view = json.bufferViews[accessor.bufferView];
      const positions = new Float32Array(binary.buffer, binary.byteOffset + view.byteOffset, accessor.count * 3);
      for (let offset = 0; offset < positions.length; offset += 3) {
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[offset + axis];
          assert.ok(Number.isFinite(value), `${asset.file} finite coordinate`);
          observedMin[axis] = Math.min(observedMin[axis], value);
          observedMax[axis] = Math.max(observedMax[axis], value);
        }
      }
      const normalAccessor = json.accessors[primitive.attributes.NORMAL];
      const normalView = json.bufferViews[normalAccessor.bufferView];
      const normals = new Float32Array(binary.buffer, binary.byteOffset + normalView.byteOffset, normalAccessor.count * 3);
      for (let offset = 0; offset < normals.length; offset += 3) {
        const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
        assert.ok(Math.abs(length - 1) < 0.002, `${asset.file} unit surface normal`);
      }
      const indexAccessor = json.accessors[primitive.indices];
      const indexView = json.bufferViews[indexAccessor.bufferView];
      const IndexArray = indexAccessor.componentType === 5123 ? Uint16Array : Uint32Array;
      const indices = new IndexArray(binary.buffer, binary.byteOffset + indexView.byteOffset, indexAccessor.count);
      assert.equal(indices.length % 3, 0);
      for (const index of indices) assert.ok(index < accessor.count, `${asset.file} valid vertex index`);
      triangles += indices.length / 3;
    }
    assert.equal(triangles, manifest.assets[assetIndex].triangles);
    assert.ok(triangles >= 1000, `${asset.file} is a crafted mesh`);
    const dimensions = observedMax.map((value, axis) => value - observedMin[axis]);
    assert.ok(Math.abs(Math.max(...dimensions) - 2) < 0.00001);
    assert.ok(Math.min(...dimensions) > 0.18, `${asset.file} has a substantial third dimension`);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(observedMin[axis] + observedMax[axis]) < 0.00001, `${asset.file} centered origin`);
      assert.ok(Math.abs(observedMin[axis] - manifest.assets[assetIndex].bounds.min[axis]) < 0.00001);
      assert.ok(Math.abs(observedMax[axis] - manifest.assets[assetIndex].bounds.max[axis]) < 0.00001);
    }
  }
});

test("the assembly remains inside payload, triangle, and draw-call budgets", async () => {
  const { manifest, assets } = await fixturePromise;
  assert.ok(assets.reduce((total, asset) => total + asset.bytes.length, 0) <= 3_000_000);
  assert.ok(manifest.assets.reduce((total, asset) => total + asset.triangles, 0) <= 80_000);
  assert.ok(manifest.assets.reduce((total, asset) => total + asset.drawCalls, 0) <= 32);
});

test("the standard Three.js loader decodes every complete scene and its PBR materials", async () => {
  const { manifest, assets } = await fixturePromise;
  for (const [index, asset] of assets.entries()) {
    const buffer = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength);
    const loaded = await new GLTFLoader().parseAsync(buffer, "");
    const root = loaded.scene.getObjectByName(manifest.assets[index].chapterId);
    assert.ok(root, `${asset.file} retains the bound chapter node`);
    assert.equal(root.userData.fictionalFixture, true);
    let loadedPrimitives = 0;
    loaded.scene.traverse((object) => {
      if (!object.isMesh) return;
      loadedPrimitives++;
      assert.equal(object.material.isMeshStandardMaterial, true);
      assert.equal(object.material.transparent, false);
      assert.ok(object.geometry.index.count > 0);
      object.geometry.dispose();
      object.material.dispose();
    });
    assert.equal(loadedPrimitives, manifest.assets[index].drawCalls);
  }
});

test("regeneration is byte-identical and the committed assets match the generator", async () => {
  const first = await fixturePromise;
  const second = await buildFixtures(repo);
  assert.deepEqual(first.manifest, second.manifest);
  for (const [index, asset] of first.assets.entries()) {
    assert.deepEqual(asset.bytes, second.assets[index].bytes);
    assert.deepEqual(asset.bytes, await readFile(`${repo}/apps/web/public/portrait-explorer/${asset.file}`));
  }
  const publishedManifest = JSON.parse(await readFile(`${repo}/apps/web/public/portrait-explorer/fixtures.json`, "utf8"));
  assert.deepEqual(first.manifest, publishedManifest);
});

test("the GLB parser rejects truncated, invalid, and externally dependent data", async () => {
  const { assets } = await fixturePromise;
  assert.throws(() => parseGlb(Buffer.from("invalid")), /GLB/);
  assert.throws(() => parseGlb(assets[0].bytes.subarray(0, 30)), /GLB/);
  const changed = Buffer.from(assets[0].bytes);
  changed.writeUInt32LE(1, 4);
  assert.throws(() => parseGlb(changed), /version/);
  const { json, binary } = parseGlb(assets[0].bytes);
  json.buffers[0].uri = "https://invalid.example/secret.bin";
  const externalJson = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(externalJson.length / 4) * 4, 0x20);
  externalJson.copy(paddedJson);
  const external = Buffer.alloc(28 + paddedJson.length + binary.length);
  assets[0].bytes.copy(external, 0, 0, 20);
  external.writeUInt32LE(external.length, 8);
  external.writeUInt32LE(paddedJson.length, 12);
  paddedJson.copy(external, 20);
  external.writeUInt32LE(binary.length, 20 + paddedJson.length);
  external.writeUInt32LE(0x004e4942, 24 + paddedJson.length);
  binary.copy(external, 28 + paddedJson.length);
  assert.throws(() => parseGlb(external), /self-contained/);
});
