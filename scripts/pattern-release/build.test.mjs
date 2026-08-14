import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifyOneShot } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

import {
  BODY_ORDER,
  CANDIDATE_STATE,
  REPO_ROOT,
  candidateProblems,
  loadCandidates,
  reviewedHashes,
  toPatternObject,
} from "./candidates.mjs";
import { BuildRefused, buildRelease, graphProblems, reviewProblems } from "./build.mjs";
import { signBundle, signingPayload } from "./sign.mjs";

const candidates = loadCandidates();

/** A synthetic manifest. Nothing here is a claim that a review happened. */
function manifest(overrides = {}, mutateApproval = () => {}) {
  const approvals = candidates.map((candidate) => {
    const approval = {
      candidate_id: candidate.candidate_id,
      approved: true,
      author: "test-author (synthetic)",
      approver: "test-approver (synthetic)",
      ...reviewedHashes(candidate),
    };
    mutateApproval(approval, candidate);
    return approval;
  });
  return {
    reviewed_at: "2026-08-14T00:00:00.000Z",
    release_author: "test-author (synthetic)",
    release_approver: "test-approver (synthetic)",
    approvals,
    ...overrides,
  };
}

test("the launch catalog holds 24 reviewable families across the four groups", () => {
  assert.equal(candidates.length, 24);
  const groups = new Map();
  for (const candidate of candidates) {
    groups.set(candidate.group, (groups.get(candidate.group) ?? 0) + 1);
    assert.equal(candidate.state, CANDIDATE_STATE);
    assert.ok(!("signature" in candidate), "a candidate must carry no signature metadata");
  }
  assert.deepEqual([...groups.keys()].sort(), [
    "accuracy_gated_angular_or_house",
    "calculated_multi_body_pattern",
    "elemental_or_modal_emphasis",
    "integrated_aspect_structure",
  ]);
  for (const [, count] of groups) assert.ok(count >= 5, "every group carries real coverage");
});

test("every family states its counter-expression and its prohibited claims", () => {
  for (const candidate of candidates) {
    assert.ok(candidate.counter_expression.length > 0, candidate.candidate_id);
    assert.ok(candidate.prohibited_claims.length > 0, candidate.candidate_id);
    assert.ok(candidate.evidence_requirements.length > 0, candidate.candidate_id);
    assert.ok(candidate.reviewer_notes.length > 0, candidate.candidate_id);
  }
});

test("a family with no positive predicate is not reviewable", () => {
  const problems = candidateProblems({
    ...candidates[0],
    match: { all_of: [], any_of: [], none_of: [{ type: "position", body: "sun", sign: 1 }] },
  });
  assert.ok(problems.some((problem) => problem.includes("positive predicate")));
});

test("a noncanonical aspect pair is not reviewable", () => {
  const problems = candidateProblems({
    ...candidates[0],
    match: {
      all_of: [{ type: "aspect", body_a: "saturn", body_b: "mars", aspect: "square" }],
      any_of: [],
      none_of: [],
    },
  });
  assert.ok(problems.some((problem) => problem.includes("canonical order")));
});

test("a house or angle predicate without an accuracy gate is not reviewable", () => {
  const problems = candidateProblems({
    ...candidates[0],
    minimum_accuracy: "unknown",
    requires_houses: false,
    match: {
      all_of: [{ type: "position", body: "saturn", house: 1 }],
      any_of: [],
      none_of: [],
    },
  });
  assert.ok(problems.some((problem) => problem.includes("requires_houses")));
});

test("the builder refuses without a review manifest approving every candidate", () => {
  assert.throws(
    () => buildRelease({ candidates, manifest: { approvals: [] }, version: "release-x", createdAt: "2026-08-14T00:00:00.000Z", changelog: "x" }),
    (error) => error instanceof BuildRefused && error.problems.length >= candidates.length,
  );

  const partial = manifest();
  partial.approvals.pop();
  const problems = reviewProblems(candidates, partial);
  assert.ok(problems.some((problem) => problem.includes("no approval in the review manifest")));
});

test("the builder refuses a self-approved candidate and a self-approved release", () => {
  const sameReviewer = manifest({}, (approval) => {
    approval.approver = approval.author;
  });
  assert.ok(
    reviewProblems(candidates, sameReviewer)
      .some((problem) => problem.includes("author and approver must be different people")),
  );

  const sameRelease = manifest({ release_approver: "test-author (synthetic)" });
  assert.ok(
    reviewProblems(candidates, sameRelease)
      .some((problem) => problem.includes("release_author and release_approver")),
  );
});

test("the builder refuses when the reviewed bytes no longer match", () => {
  const edited = candidates.map((candidate, index) =>
    index === 0 ? { ...candidate, body: `${candidate.body} A sentence added after review.` } : candidate,
  );
  const problems = reviewProblems(edited, manifest());
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes("content changed since review"));

  const reruled = candidates.map((candidate, index) =>
    index === 1
      ? {
          ...candidate,
          match: { ...candidate.match, none_of: [{ type: "position", body: "sun", sign: 1 }] },
        }
      : candidate,
  );
  const ruleProblems = reviewProblems(reruled, manifest());
  assert.equal(ruleProblems.length, 1);
  assert.ok(ruleProblems[0].includes("match rule changed since review"));
});

test("an approved build ships no review-only field and no draft state", () => {
  const bundle = buildRelease({
    candidates,
    manifest: manifest(),
    version: "release-test-24",
    createdAt: "2026-08-14T00:00:00.000Z",
    changelog: "synthetic",
  });

  assert.equal(bundle.schema_version, "0.4.0");
  assert.equal(bundle.objects.patterns.length, 24);
  assert.deepEqual(graphProblems(bundle), []);

  const serialized = JSON.stringify(bundle.objects.patterns);
  for (const leak of ["reviewer_notes", "candidate_id", CANDIDATE_STATE, "evidence_requirements"]) {
    assert.ok(!serialized.includes(leak), `${leak} reached the release`);
  }
  for (const pattern of bundle.objects.patterns) {
    assert.equal(pattern.status, "approved");
    assert.match(pattern.object_hash, /^sha256:[0-9a-f]{64}$/);
  }
  assert.match(bundle.release.bundle_hash, /^sha256:[0-9a-f]{64}$/);

  // Every M3 collection Today needs survives the M4 build.
  for (const collection of ["cycles", "phases", "modifiers", "prompts", "safety_rules", "timing_templates", "daily_fallbacks"]) {
    assert.ok(Array.isArray(bundle.objects[collection]), collection);
  }
  assert.ok(!("fixtures" in bundle), "a fixture-bearing release stays pending");
});

test("a draft object cannot be smuggled into a production-shaped body", () => {
  const bundle = buildRelease({
    candidates,
    manifest: manifest(),
    version: "release-test-24",
    createdAt: "2026-08-14T00:00:00.000Z",
    changelog: "synthetic",
  });
  bundle.objects.patterns[0].status = "deprecated";
  bundle.objects.patterns[1].reviewer_notes = "not for readers";
  const problems = graphProblems(bundle);
  assert.ok(problems.some((problem) => problem.includes("draft object")));
  assert.ok(problems.some((problem) => problem.includes("review-only field reviewer_notes")));
});

test("signing produces a verifiable signature over the built body", () => {
  const bundle = buildRelease({
    candidates,
    manifest: manifest(),
    version: "release-test-24",
    createdAt: "2026-08-14T00:00:00.000Z",
    changelog: "synthetic",
  });
  // A synthetic test key, generated in memory and never written anywhere.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = signBundle(bundle, {
    alg: "Ed25519",
    keyId: "synthetic-test-key",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });

  assert.equal(signed.signature.signed_payload_hash, bundle.release.bundle_hash);
  const signature = Buffer.from(
    signed.signature.signature.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  assert.ok(
    verifyOneShot(null, Buffer.from(signingPayload(signed), "utf8"), publicKey, signature),
  );

  // Tampering after signing invalidates it, which is the whole point.
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.objects.patterns[0].body = "Replaced after signing.";
  assert.ok(
    !verifyOneShot(null, Buffer.from(signingPayload(tampered), "utf8"), publicKey, signature),
  );
});

test("signing refuses a body whose declared bundle hash is wrong", () => {
  const bundle = buildRelease({
    candidates,
    manifest: manifest(),
    version: "release-test-24",
    createdAt: "2026-08-14T00:00:00.000Z",
    changelog: "synthetic",
  });
  bundle.release.bundle_hash = `sha256:${"0".repeat(64)}`;
  const { privateKey } = generateKeyPairSync("ed25519");
  assert.throws(
    () =>
      signBundle(bundle, {
        alg: "Ed25519",
        keyId: "synthetic-test-key",
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
    /does not match the body/,
  );
});

test("no private key material is committed to this repository", () => {
  const suspicious = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
  const skip = new Set([
    "node_modules", ".git", "dist", "build", ".wrangler", ".worktrees",
    "coverage", ".playwright-mcp",
  ]);
  const offenders = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (skip.has(entry)) continue;
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (stats.size > 2_000_000) continue;
      if (path === join(REPO_ROOT, "scripts", "pattern-release", "build.test.mjs")) continue;
      const text = readFileSync(path, "utf8");
      if (suspicious.test(text)) offenders.push(path);
    }
  };
  walk(REPO_ROOT);
  assert.deepEqual(offenders, []);
});

test("no runtime source reads the candidate directory", () => {
  const roots = [
    join(REPO_ROOT, "apps", "api", "src"),
    join(REPO_ROOT, "apps", "web", "src"),
    join(REPO_ROOT, "apps", "calc-stub", "src"),
    join(REPO_ROOT, "packages"),
  ];
  const offenders = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue;
      const text = readFileSync(path, "utf8");
      // Draft prose becoming a fallback is the failure this whole boundary
      // exists to prevent: `pattern_release_not_active` is the correct answer.
      if (text.includes("pattern-candidates") || text.includes("candidates.json")) {
        offenders.push(path);
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, []);
});

test("the candidate file is not reachable as a release fixture", () => {
  const contracts = join(REPO_ROOT, "contracts");
  const offenders = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith(".json")) continue;
      if (readFileSync(path, "utf8").includes(CANDIDATE_STATE)) offenders.push(path);
    }
  };
  walk(contracts);
  assert.deepEqual(offenders, []);
});

test("the built body validates against the frozen M4 contract", () => {
  // The builder's own graph checks are not the contract. Validating the emitted
  // body against the committed schema is what proves a signed release would be
  // ingestable, and it is cheap enough to run before any key is spent.
  const Ajv = require("ajv/dist/2020.js");
  const addFormats = require("ajv-formats");
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  const schema = (...parts) => JSON.parse(readFileSync(join(REPO_ROOT, "contracts", ...parts), "utf8"));
  for (const path of [
    ["m0", "common.schema.json"],
    ["m0", "content-release.schema.json"],
    ["m3", "common.schema.json"],
    ["m3", "content-release.schema.json"],
    ["m4", "common.schema.json"],
    ["m4", "natal-feature.schema.json"],
    ["m4", "content-release.schema.json"],
  ]) {
    ajv.addSchema(schema(...path));
  }

  const validate = ajv.getSchema(
    "https://patternlike.app/contracts/m4/content-release.schema.json#/$defs/contentReleaseBundle",
  );
  assert.ok(validate, "the M4 bundle schema is loadable");

  const bundle = buildRelease({
    candidates,
    manifest: manifest(),
    version: "release-test-24",
    createdAt: "2026-08-14T00:00:00.000Z",
    changelog: "synthetic",
  });
  const { privateKey } = generateKeyPairSync("ed25519");
  const signed = signBundle(bundle, {
    alg: "Ed25519",
    keyId: "synthetic-test-key",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });

  const valid = validate(signed);
  assert.ok(valid, JSON.stringify(validate.errors?.slice(0, 4), null, 2));
});

test("the canonical body order matches the shared package and the contract", () => {
  // These scripts cannot import the TypeScript package, so the list is copied.
  // A copy that drifts would accept candidates the runtime narrower refuses,
  // which is the failure this pin exists to catch.
  const shared = readFileSync(join(REPO_ROOT, "packages", "shared", "src", "index.ts"), "utf8");
  // Anchored on `= [` rather than the declaration: the type annotation is
  // `readonly CelestialBody[]`, whose brackets precede the array literal's.
  const literal = /export const LAUNCH_BODIES[^=]*=\s*\[([^\]]*)\]/.exec(shared);
  assert.ok(literal, "LAUNCH_BODIES is no longer a readable array literal");
  const declared = (literal[1].match(/"[a-z_]+"/g) ?? []).map((quoted) => quoted.slice(1, -1));
  assert.deepEqual(BODY_ORDER, declared);

  // And against the frozen contract's own rejection fixture: the alphabetical
  // form of a Sun-Moon aspect is the shape the contract calls invalid.
  const rejected = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "contracts", "m4", "fixtures", "invalid", "natal-feature.aspect-noncanonical.json"),
      "utf8",
    ),
  );
  assert.ok(
    BODY_ORDER.indexOf(rejected.body_a) > BODY_ORDER.indexOf(rejected.body_b),
    "the contract's rejection fixture must be noncanonical under this order",
  );
});

test("the shipped projection is the closed M4 object shape", () => {
  const object = toPatternObject(candidates[0]);
  assert.deepEqual(
    Object.keys(object).sort(),
    [
      "body", "content_type", "content_version", "counter_expression",
      "display_priority", "id", "locale", "match", "minimum_accuracy",
      "object_hash", "prohibited_claims", "required_aspects", "required_bodies",
      "requires_houses", "resources", "status", "summary", "tags", "tensions",
      "title",
    ],
  );
});
