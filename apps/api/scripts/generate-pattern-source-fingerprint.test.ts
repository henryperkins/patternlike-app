import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  PatternSourceFingerprintError,
  buildPatternSourceFingerprint,
  checkPatternSourceFingerprint,
  renderPatternSourceModule,
} from "./generate-pattern-source-fingerprint.js";

async function fixture(
  sources: Record<string, string>,
  manifestSources = Object.keys(sources).sort(),
): Promise<{ root: string; manifestPath: string; outputPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "pattern-source-"));
  for (const [relativePath, bytes] of Object.entries(sources)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const manifestPath = join(root, "pattern-creation-sources.json");
  await writeFile(manifestPath, JSON.stringify({ version: 1, sources: manifestSources }));
  return {
    root,
    manifestPath,
    outputPath: join(root, "src/generated/pattern-creation-source.ts"),
  };
}

test("hashes exact bytes and repository-relative paths deterministically", async () => {
  const first = await fixture({
    "apps/api/src/a.ts": "export const a = 1;\n",
    "apps/api/src/b.ts": "export const b = 2;\n",
  });
  try {
    const original = await buildPatternSourceFingerprint(first);
    const repeat = await buildPatternSourceFingerprint(first);
    assert.match(original.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(repeat.hash, original.hash);

    await writeFile(join(first.root, "apps/api/src/a.ts"), "export const a = 1; // byte change\n");
    const byteChanged = await buildPatternSourceFingerprint(first);
    assert.notEqual(byteChanged.hash, original.hash);

    await writeFile(join(first.root, "apps/api/src/a.ts"), "export const a = 1;\n");
    await mkdir(join(first.root, "packages/pattern-engine/src"), { recursive: true });
    await writeFile(join(first.root, "packages/pattern-engine/src/a.ts"), "export const a = 1;\n");
    await writeFile(
      first.manifestPath,
      JSON.stringify({
        version: 1,
        sources: ["apps/api/src/b.ts", "packages/pattern-engine/src/a.ts"],
      }),
    );
    const pathChanged = await buildPatternSourceFingerprint(first);
    assert.notEqual(pathChanged.hash, original.hash);
  } finally {
    await rm(first.root, { recursive: true, force: true });
  }
});

test("rejects ambiguous or out-of-scope manifests", async () => {
  const cases: Array<[string, string[]]> = [
    ["duplicate", ["apps/api/src/a.ts", "apps/api/src/a.ts"]],
    ["unsorted", ["apps/api/src/b.ts", "apps/api/src/a.ts"]],
    ["traversal", ["../outside.ts"]],
    ["absolute", ["/tmp/outside.ts"]],
    ["non-typescript", ["apps/api/src/a.json"]],
    ["outside_pattern_source", ["apps/web/src/a.ts"]],
  ];

  for (const [label, sources] of cases) {
    const held = await fixture({
      "apps/api/src/a.ts": "export const a = 1;\n",
      "apps/api/src/b.ts": "export const b = 2;\n",
      "apps/api/src/a.json": "{}\n",
      "apps/web/src/a.ts": "export const a = 1;\n",
    }, sources);
    try {
      await assert.rejects(
        buildPatternSourceFingerprint(held),
        (error: unknown) =>
          error instanceof PatternSourceFingerprintError &&
          error.code === `manifest_${label}_path`,
      );
    } finally {
      await rm(held.root, { recursive: true, force: true });
    }
  }
});

test("renders a closed generated module and detects stale output", async () => {
  const held = await fixture({ "apps/api/src/a.ts": "export const a = 1;\n" });
  try {
    const fingerprint = await buildPatternSourceFingerprint(held);
    const rendered = renderPatternSourceModule(fingerprint);
    assert.match(rendered, /PATTERN_CREATION_SOURCE_HASH = "sha256:[0-9a-f]{64}" as const/);
    assert.match(rendered, /"apps\/api\/src\/a\.ts"/);
    assert.doesNotMatch(rendered, /export const a = 1/);

    await mkdir(dirname(held.outputPath), { recursive: true });
    await writeFile(held.outputPath, rendered);
    assert.equal(await checkPatternSourceFingerprint(held), true);

    await writeFile(join(held.root, "apps/api/src/a.ts"), "export const a = 2;\n");
    assert.equal(await checkPatternSourceFingerprint(held), false);
    assert.notEqual(await readFile(held.outputPath, "utf8"), renderPatternSourceModule(
      await buildPatternSourceFingerprint(held),
    ));
  } finally {
    await rm(held.root, { recursive: true, force: true });
  }
});
