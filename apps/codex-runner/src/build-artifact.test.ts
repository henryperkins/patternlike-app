import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { jsonFixture } from "./portrait-mesh-test-fixture.js";

const runnerRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceManifest = JSON.parse(
  await readFile(join(runnerRoot, "package.json"), "utf8"),
);

/** Copy the installed production closure, including this host's Sharp binaries.
 * The regression stays offline and the child cannot resolve repository modules. */
async function stageDependencies(destination: string) {
  const copied = new Set<string>();
  async function copyPackage(name: string, from: string, optional = false) {
    if (copied.has(name)) return;
    const paths =
      createRequire(join(from, "package.json")).resolve.paths(name) ?? [];
    let directory: string | undefined;
    for (const candidate of paths) {
      try {
        await access(join(candidate, name, "package.json"));
        directory = join(candidate, name);
        break;
      } catch {
        /* Search the next Node resolution directory. */
      }
    }
    if (!directory) {
      if (optional) return;
      throw new Error(`Missing installed production dependency: ${name}`);
    }
    copied.add(name);
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    await cp(directory, join(destination, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      await copyPackage(dependency, directory);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}))
      await copyPackage(dependency, directory, true);
  }
  await copyPackage("sharp", runnerRoot);
  await copyPackage("three", runnerRoot);
}

test("built runner is an installable Node ESM artifact outside the workspace", async () => {
  const stage = await mkdtemp(join(tmpdir(), "patternlike-runner-artifact-"));
  try {
    const built = spawnSync(
      process.execPath,
      [join(runnerRoot, "scripts/build.mjs"), "--outdir", stage],
      { cwd: runnerRoot, encoding: "utf8" },
    );
    assert.equal(built.status, 0, built.stderr);
    const manifest = JSON.parse(
      await readFile(join(stage, "package.json"), "utf8"),
    );
    assert.deepEqual(manifest.dependencies, {
      sharp: sourceManifest.dependencies.sharp,
      three: sourceManifest.dependencies.three,
    });
    assert.equal(manifest.type, "module");
    assert.equal(manifest.scripts.start, "node index.js");
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.dependencies["@patternlike/shared"], undefined);
    await stageDependencies(stage);
    const probe = `import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { main } from "./index.js";
import { runPortraitMeshCanary } from "./portrait-mesh-canary.js";
import sharp from "sharp";
import { BoxGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
assert.equal(typeof main,"function"); assert.equal(typeof runPortraitMeshCanary,"function");
assert.equal(process.exitCode,undefined);
const image=await sharp({create:{width:32,height:32,channels:4,background:"#ffffff"}}).png().toBuffer();
assert.equal((await sharp(image).metadata()).width,32);
await writeFile(new URL("./source.png",import.meta.url),image);
const solid=new BoxGeometry(1,1,1);assert.ok(solid.index.count>0);solid.dispose();
const rounded=new RoundedBoxGeometry(1,1,1,2,0.1);assert.ok(rounded.getAttribute("position").count>0);rounded.dispose();
process.stdout.write("standalone-runtime-ok\\n");`;
    await writeFile(join(stage, "probe.mjs"), probe);
    const environment = { PATH: dirname(process.execPath) };
    const loaded = spawnSync(process.execPath, [join(stage, "probe.mjs")], {
      cwd: stage,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout.trim(), "standalone-runtime-ok");
    const runner = spawnSync(process.execPath, [join(stage, "index.js")], {
      cwd: stage,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(runner.status, 1, runner.stderr);
    assert.equal(JSON.parse(runner.stdout).event, "codex_runner_fatal");
    const canary = spawnSync(
      process.execPath,
      [join(stage, "portrait-mesh-canary.js")],
      { cwd: stage, encoding: "utf8", env: environment },
    );
    assert.equal(canary.status, 1);
    assert.match(canary.stderr, /Check required arguments/);
    assert.doesNotMatch(
      canary.stderr,
      /ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/,
    );
    const program = {
      version: "portrait-mesh-program/v1",
      materials: [
        { id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 },
      ],
      parts: [
        {
          name: "body",
          material: "oak",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          repeat: null,
          geometry: { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 },
        },
      ],
    };
    const audit = {
      schema_version: "portrait-mesh-audit/v1",
      accepted: true,
      recognizable: true,
      substantial: true,
      source_correspondence: true,
      no_severe_intersections: true,
      view_count: 4,
      notes: "Synthetic local artifact probe.",
    };
    const fixture = await jsonFixture("success", [program, audit]);
    try {
      await writeFile(
        join(stage, "source.txt"),
        "A fictional wooden keepsake.",
      );
      const modeled = spawnSync(
        process.execPath,
        [
          join(stage, "portrait-mesh-canary.js"),
          "--fictional",
          "--source",
          join(stage, "source.txt"),
          "--image",
          join(stage, "source.png"),
          "--out",
          join(stage, "evidence"),
          "--codex-bin",
          fixture.executable,
        ],
        {
          cwd: stage,
          encoding: "utf8",
          env: { ...environment, HOME: fixture.root, CODEX_HOME: fixture.home },
          timeout: 20000,
        },
      );
      assert.equal(modeled.status, 0, modeled.stderr + modeled.stdout);
      const receipt = JSON.parse(
        await readFile(join(stage, "evidence/receipt.json"), "utf8"),
      );
      assert.equal(receipt.result.ok, true);
      assert.ok(receipt.compiled.triangles > 0);
      assert.equal(receipt.compiled.views.length, 4);
      assert.equal(
        (await readFile(join(stage, "evidence/model.glb"))).toString(
          "ascii",
          0,
          4,
        ),
        "glTF",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});
