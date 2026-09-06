import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { runPortraitMeshCanary } from "./portrait-mesh-canary.js";
import { jsonFixture } from "./portrait-mesh-test-fixture.js";

test("fictional canary uses the real pipeline with a fake provider and retains reproducible artifacts without secrets", async () => {
  const program = { version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }], parts: [{ name: "solid body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 } }] };
  const audit = { schema_version: "portrait-mesh-audit/v1", accepted: true, recognizable: true, substantial: true, source_correspondence: true, no_severe_intersections: true, view_count: 4, notes: "A substantial fictional block." };
  const f = await jsonFixture("success", [program, audit]); const previousHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = f.home;
    const image = join(f.root, "source.png"), source = join(f.root, "source.txt"), output = join(f.root, "evidence");
    await writeFile(image, await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ad8151" } }).png().toBuffer());
    await writeFile(source, "Fictional source about a wooden keepsake.");
    const args = ["--fictional", "--image", image, "--source", source, "--out", output, "--codex-bin", f.executable];
    assert.equal(await runPortraitMeshCanary(args), 0);
    assert.deepEqual((await readdir(output)).sort(), ["authored-program.json", "model.glb", "program.json", "receipt.json", "reference.png", "source.txt", "view-front.png", "view-rear.png", "view-side.png", "view-three-quarter.png", "visual-check.json"].sort());
    const receipt = JSON.parse(await readFile(join(output, "receipt.json"), "utf8"));
    assert.equal(receipt.fictional, true); assert.equal(receipt.manual_model_edits, false); assert.equal(receipt.result.ok, true);
    assert.equal(receipt.codex_cli_version, "0.153.3"); assert(receipt.compiled.triangles > 0);
    assert(!JSON.stringify(receipt).includes(f.root)); assert(!JSON.stringify(receipt).includes("lease_token"));
    await assert.rejects(runPortraitMeshCanary(args), { code: "EEXIST" });
    await assert.rejects(runPortraitMeshCanary(args.filter((arg) => arg !== "--fictional")), /Required/);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    await rm(f.root, { recursive: true, force: true });
  }
});
