import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPortraitMeshAudit,
  isCodexPortraitMeshClaim,
  isCodexPortraitMeshFailure,
} from "./portrait-mesh-protocol.js";
const audit = {
  schema_version: "portrait-mesh-audit/v1",
  accepted: true,
  recognizable: true,
  substantial: true,
  source_correspondence: true,
  no_severe_intersections: true,
  view_count: 4,
  notes: "Four views checked.",
};
test("visual acceptance requires every check, four views and closed receipt", () => {
  assert.equal(isPortraitMeshAudit(audit), true);
  for (const field of [
    "accepted",
    "recognizable",
    "substantial",
    "source_correspondence",
    "no_severe_intersections",
  ])
    assert.equal(isPortraitMeshAudit({ ...audit, [field]: false }), false);
  assert.equal(isPortraitMeshAudit({ ...audit, view_count: 3 }), false);
  assert.equal(
    isPortraitMeshAudit({ ...audit, source_url: "https://invalid.test" }),
    false,
  );
});
test("machine failures are bounded and closed", () => {
  const value = {
    lease_token: "12345678-1234-1234-1234-123456789abc",
    code: "visual_check_failed",
  };
  assert.equal(isCodexPortraitMeshFailure(value), true);
  assert.equal(
    isCodexPortraitMeshFailure({ ...value, code: "raw_private_error" }),
    false,
  );
  assert.equal(
    isCodexPortraitMeshFailure({ ...value, stack: "private" }),
    false,
  );
  assert.equal(
    isCodexPortraitMeshClaim({
      schema_version: "codex-portrait-mesh-claim/v1",
    }),
    false,
  );
});

import { readFileSync } from "node:fs";
const fixture = (path: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../contracts/portrait-mesh-v1/fixtures/${path}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
test("frozen claim fixtures reject unknown data and chapter substitution", () => {
  const claim = fixture("valid/claim.json");
  assert.equal(isCodexPortraitMeshClaim(claim), true);
  assert.equal(
    isCodexPortraitMeshClaim(fixture("invalid/claim-unknown-property.json")),
    false,
  );
  assert.equal(
    isCodexPortraitMeshClaim(fixture("invalid/claim-chapter-mismatch.json")),
    false,
  );
  assert.equal(
    isCodexPortraitMeshClaim({
      ...claim,
      image_base64: "A".repeat(4 * 1024 * 1024),
    }),
    false,
  );
  assert.equal(isCodexPortraitMeshFailure(fixture("valid/failure.json")), true);
  assert.equal(
    isCodexPortraitMeshFailure(fixture("invalid/failure-raw-error.json")),
    false,
  );
});

import { PORTRAIT_MESH_PROGRAM_SCHEMA } from "./portrait-mesh-program.js";
test("the versioned program contract matches the trusted parser schema", () => {
  const contract = JSON.parse(
    readFileSync(
      new URL(
        "../../../contracts/portrait-mesh-v1/program.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  delete contract.$id;
  delete contract.$schema;
  assert.deepEqual(contract, PORTRAIT_MESH_PROGRAM_SCHEMA);
});

import { isCodexPortraitMeshCompletion, PORTRAIT_MESH_V2_PROMPT_VERSION } from "./portrait-mesh-protocol.js";
import { PORTRAIT_MESH_V2_PROGRAM_SCHEMA, PORTRAIT_MESH_V2_COMPILER_VERSION } from "./portrait-mesh-program.js";
test("adaptive claims and terminal receipts bind count, index, revision and version", () => {
  for (const chapterCount of [3, 4, 5, 6]) {
    const binding = { chapter_count: chapterCount, chapter_index: chapterCount - 1, chapter_id: `chapter-${chapterCount}`, document_revision: "revision-fictional" };
    const claim = { ...fixture("valid/claim.json"), ...binding, schema_version: "codex-portrait-mesh-claim/v2",
      prompt_version: PORTRAIT_MESH_V2_PROMPT_VERSION, compiler_version: PORTRAIT_MESH_V2_COMPILER_VERSION };
    const failure = { ...fixture("valid/failure.json"), ...binding, schema_version: "codex-portrait-mesh-failure/v2" };
    assert.equal(isCodexPortraitMeshClaim(claim), true);
    assert.equal(isCodexPortraitMeshFailure(failure), true);
    for (const patch of [{ chapter_count: 2 }, { chapter_count: 7 }, { chapter_index: chapterCount },
      { chapter_index: 1.5 }, { chapter_id: "chapter-0" }, { document_revision: "" }, { private: true }]) {
      assert.equal(isCodexPortraitMeshClaim({ ...claim, ...patch }), false);
      assert.equal(isCodexPortraitMeshFailure({ ...failure, ...patch }), false);
    }
    assert.equal(isCodexPortraitMeshClaim({ ...claim, prompt_version: "portrait-mesh/v1" }), false);
    assert.equal(isCodexPortraitMeshClaim({ ...claim, compiler_version: "portrait-mesh-compiler/v1" }), false);
    const program = { version: "portrait-mesh-program/v2", chapter_count: chapterCount, chapter_id: binding.chapter_id,
      materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }],
      parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null,
        geometry: { kind: "box", size: [1, 1, 1], bevel: 0.04 } }] };
    const completion = { ...binding, schema_version: "codex-portrait-mesh-completion/v2", lease_token: claim.lease_token,
      program, program_sha256: "a".repeat(64), glb_base64: "AAAA", glb_sha256: "b".repeat(64),
      compiler_version: PORTRAIT_MESH_V2_COMPILER_VERSION, audit, provider_request_id: "request", audit_request_id: "audit" };
    assert.equal(isCodexPortraitMeshCompletion(completion), true);
    assert.equal(isCodexPortraitMeshCompletion({ ...completion, program: { ...program, chapter_id: "chapter-1" } }), false);
    assert.equal(isCodexPortraitMeshCompletion({ ...completion, audit: { ...audit, view_count: chapterCount === 4 ? 6 : chapterCount } }), false);
    assert.equal(isCodexPortraitMeshCompletion({ ...completion, schema_version: "codex-portrait-mesh-completion/v1" }), false);
  }
});
test("adaptive program structured-output schema matches the published contract", () => {
  const contract = JSON.parse(readFileSync(new URL("../../../contracts/portrait-mesh-v2/program.schema.json", import.meta.url), "utf8"));
  delete contract.$id; delete contract.$schema;
  assert.deepEqual(contract, PORTRAIT_MESH_V2_PROGRAM_SCHEMA);
});
