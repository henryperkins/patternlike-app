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
