import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { isCodexPortraitMeshClaim, type CodexPortraitMeshClaim, type CodexPortraitMeshClaimV2, type PortraitMeshProgram, type PortraitMeshProgramV2 } from "@patternlike/shared";
import { jsonFixture } from "./portrait-mesh-test-fixture.js";
import { runPortraitMeshInvocation } from "./portrait-mesh-invocation.js";
import { installPortableTestScriptSpawn } from "./portable-script-spawn.test-helper.js";

installPortableTestScriptSpawn();

export const SIMPLE_PROGRAM: PortraitMeshProgram = { version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }], parts: [{ name: "solid body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1.3, 0.7], bevel: 0.04 } }] };
const AUDIT = { schema_version: "portrait-mesh-audit/v1", accepted: true, recognizable: true, substantial: true, source_correspondence: true, no_severe_intersections: true, view_count: 4, notes: "All four views depict a solid fictional wooden block." };
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
async function fixture(program: unknown = SIMPLE_PROGRAM, audit: unknown = AUDIT) {
  const f = await jsonFixture("success", [program, audit]);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ad8151" } }).png().toBuffer();
  const source = "Fictional chapter. A substantial wooden keepsake holds the thread of a thought.\n\nFinal paragraph must survive exactly.";
  // Shaped like a live revision: schema, pat_-prefixed Pattern id, generation instant.
  const claim: CodexPortraitMeshClaim = { schema_version: "codex-portrait-mesh-claim/v1", job_id: `ppmesh_${"a".repeat(32)}`, portrait_id: `ppor_${"b".repeat(32)}`, chapter_index: 0, chapter_id: "chapter-1", lease_token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", model: "gpt-5.6-sol", reasoning_effort: "xhigh", prompt_version: "portrait-mesh/v1", timeout_ms: 10_000, source_text: source, source_text_sha256: sha(source), source_image_sha256: sha(png), document_revision: `pattern-response/v7:pat_${"c".repeat(64)}:2026-09-06T06:00:00.000Z`, image_base64: png.toString("base64"), compiler_version: "portrait-mesh-compiler/v1" };
  return { ...f, png, claim, options: { claim, codexBin: f.executable, env: f.options.env, tempRoot: f.options.tempRoot } };
}

test("provider turns receive chapter content and content hashes, never Pattern, job, or portrait identifiers", async () => {
  const f = await fixture();
  try {
    const out = await runPortraitMeshInvocation(f.options);
    assert.equal(out.ok, true);
    for (const stage of ["turn-0", "turn-1"]) {
      const sent = JSON.stringify(JSON.parse(await readFile(join(f.root, `${stage}.json`), "utf8")).input);
      assert(sent.includes(f.claim.source_text_sha256) && sent.includes(f.claim.source_image_sha256), `${stage} names the exact source by hash`);
      for (const [label, value] of [["document revision", f.claim.document_revision], ["Pattern id prefix", "pat_"], ["job id", f.claim.job_id], ["portrait id", f.claim.portrait_id]]) {
        assert(!sent.includes(value), `${stage} must not carry the ${label} across the provider boundary`);
      }
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("mesh generation binds complete text/image, compiles unchanged program, and independently checks four views before completion", async () => {
  const f = await fixture();
  try {
    const out = await runPortraitMeshInvocation(f.options);
    assert.equal(out.ok, true); if (!out.ok) return;
    assert.deepEqual(out.completion.program, SIMPLE_PROGRAM);
    const glb = Buffer.from(out.completion.glb_base64, "base64");
    assert.equal(glb.toString("ascii", 0, 4), "glTF"); assert.equal(sha(glb), out.completion.glb_sha256);
    const document = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)).trim());
    assert.equal(document.nodes[0].extras.chapterId, f.claim.chapter_id);
    assert.equal(document.nodes[0].extras.sourceTextSha256, f.claim.source_text_sha256);
    assert.equal(document.nodes[0].extras.sourceImageSha256, f.claim.source_image_sha256);
    const author = JSON.parse(await readFile(join(f.root, "turn-0.json"), "utf8"));
    const check = JSON.parse(await readFile(join(f.root, "turn-1.json"), "utf8"));
    assert(author.input[0].text.includes(JSON.stringify(f.claim.source_text)));
    assert(check.input[0].text.includes(JSON.stringify(f.claim.source_text)));
    assert.deepEqual(author.input[1], { type: "image", url: `data:image/png;base64,${f.claim.image_base64}` });
    assert.equal(check.input.filter((input: { type: string }) => input.type === "image").length, 5);
    assert.notEqual(author.threadId, check.threadId);
    assert(!JSON.stringify(check.input).includes("solid body"), "audit must not receive the author's self-description");
    assert.equal(out.completion.audit.view_count, 4);
    assert.notEqual(out.completion.provider_request_id, out.completion.audit_request_id);
    assert.deepEqual(await readdir(join(f.root, "attempts")), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("adaptive mesh generation binds a six-chapter last chapter while retaining exactly four audit viewpoints", async () => {
  const adaptiveProgram: PortraitMeshProgramV2 = { ...SIMPLE_PROGRAM, version: "portrait-mesh-program/v2", chapter_count: 6, chapter_id: "chapter-6" };
  const f = await fixture(SIMPLE_PROGRAM);
  const claim: CodexPortraitMeshClaimV2 = {
    ...f.claim,
    schema_version: "codex-portrait-mesh-claim/v2",
    chapter_count: 6,
    chapter_index: 5,
    chapter_id: "chapter-6",
    prompt_version: "portrait-mesh/v2",
    compiler_version: "portrait-mesh-compiler/v2",
  };
  try {
    assert.equal(isCodexPortraitMeshClaim(claim), true, "fixture must satisfy the negotiated v2 claim contract");
    const out = await runPortraitMeshInvocation({ ...f.options, claim });
    const count = await readFile(join(f.root, "count"), "utf8").catch(() => "not-launched");
    assert.equal(out.ok, true, JSON.stringify({ out, count })); if (!out.ok) return;
    assert.deepEqual({
      schema_version: out.completion.schema_version,
      chapter_count: out.completion.chapter_count,
      chapter_index: out.completion.chapter_index,
      chapter_id: out.completion.chapter_id,
      document_revision: out.completion.document_revision,
      compiler_version: out.completion.compiler_version,
      program: out.completion.program,
      view_count: out.completion.audit.view_count,
    }, {
      schema_version: "codex-portrait-mesh-completion/v2",
      chapter_count: 6,
      chapter_index: 5,
      chapter_id: "chapter-6",
      document_revision: claim.document_revision,
      compiler_version: "portrait-mesh-compiler/v2",
      program: adaptiveProgram,
      view_count: 4,
    });
    for (const stage of ["turn-0", "turn-1"]) {
      const turn = JSON.parse(await readFile(join(f.root, `${stage}.json`), "utf8"));
      const sent = JSON.stringify(turn.input);
      assert(!sent.includes(claim.document_revision));
      assert(!sent.includes("chapter_count"));
      if (stage === "turn-0") assert(!JSON.stringify(turn.outputSchema).includes("chapter_count"));
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const change of [{ source_text_sha256: "d".repeat(64) }, { source_image_sha256: "e".repeat(64) }, { compiler_version: "unknown" }, { chapter_id: "chapter-2" }, { image_base64: Buffer.from("not png").toString("base64"), source_image_sha256: sha("not png") }]) {
  test(`wrong claim source or compiler fails before provider launch: ${Object.keys(change)[0]}`, async () => {
    const f = await fixture();
    try {
      const out = await runPortraitMeshInvocation({ ...f.options, claim: { ...f.claim, ...change } });
      assert.equal(out.ok, false);
      await assert.rejects(readFile(join(f.root, "launched")), { code: "ENOENT" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("invalid programs never reach the visual checker or return a completion", async () => {
  const f = await fixture({ ...SIMPLE_PROGRAM, script: "fetch('private')" });
  try {
    assert.deepEqual(await runPortraitMeshInvocation(f.options), { ok: false, code: "program_invalid", fatal: false });
    assert.equal(await readFile(join(f.root, "count"), "utf8"), "1");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const change of [{ accepted: false }, { recognizable: false }, { substantial: false }, { source_correspondence: false }, { no_severe_intersections: false }, { view_count: 3 }, { extra: "unexpected" }]) {
  test(`visual rejection has no completion or hidden retry: ${Object.keys(change)[0]}`, async () => {
    const f = await fixture(SIMPLE_PROGRAM, { ...AUDIT, ...change });
    try {
      assert.deepEqual(await runPortraitMeshInvocation(f.options), { ok: false, code: "visual_check_failed", fatal: false });
      assert.equal(await readFile(join(f.root, "count"), "utf8"), "2");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}
