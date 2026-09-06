import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { REPO_ROOT, sha256Hex } from "./candidates.mjs";
import * as reviewTools from "../../pattern-corpus/review.mjs";

const content = readFileSync(join(REPO_ROOT, "pattern-corpus/fragments.json"), "utf8");
const historicalBytes = readFileSync(join(REPO_ROOT, "pattern-corpus/provenance.json"), "utf8");
const provenance = JSON.parse(historicalBytes);
const cli = join(REPO_ROOT, "pattern-corpus/review.mjs");
const createdAt = "2026-09-06T10:00:00.000Z";
const recordedAt = "2026-09-06T12:00:00.000Z";

// These keys and identities exist only in this synthetic test fixture. No test
// certification, key, or signature is written to the repository's evidence.
function fixture(refs = ["mars-body-initiation"]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const registry = {
    schema_version: "pattern-corpus-reviewers.v1",
    reviewers: [{
      reviewer_id: "synthetic-test-reviewer",
      name: "Synthetic Test Reviewer",
      kind: "human",
      independent_of_generation: true,
      public_key_pem: publicKey.export({ type: "spki", format: "pem" }),
      identity_evidence_reference: "test-only:operator-enrollment",
      identity_evidence_sha256: "a".repeat(64),
      enrolled_by: "Synthetic Test Operator",
      enrolled_at: "2026-09-06T09:00:00.000Z",
    }],
  };
  const packet = reviewTools.createReviewPacket(content, provenance, { refs, createdAt });
  const review = reviewTools.createReviewDraft(packet);
  Object.assign(review, {
    reviewer_id: "synthetic-test-reviewer",
    reviewer_name: "Synthetic Test Reviewer",
    reviewer_kind: "human",
    independent_of_generation: true,
    personally_reviewed: true,
    reviewed_at: "2026-09-06T11:00:00.000Z",
  });
  for (const fragment of review.fragments) {
    for (const decision of Object.values(fragment.criteria)) {
      decision.outcome = "pass";
      decision.notes = "Synthetic fixture decision; not an actual editorial judgment.";
      decision.evidence_references = ["test-only:comparison-notes"];
    }
  }
  const record = (value = review, key = privateKey, packetValue = packet) => {
    const reviewContent = JSON.stringify(value, null, 2) + "\n";
    return reviewTools.createReviewRecord({
      content, provenance, packet: packetValue, reviewContent,
      signature: sign(null, Buffer.from(reviewContent), key), registry, recordedAt,
    });
  };
  return { packet, review, registry, privateKey, record };
}

test("packets expose complete fragment bytes and leave every human judgment blank", () => {
  const packet = reviewTools.createReviewPacket(content, provenance, { createdAt });
  assert.equal(packet.fragments.length, 60);
  assert.deepEqual(packet.fragments[0].fragment, JSON.parse(content)[0]);
  assert.equal(packet.fragments[0].sha256, provenance.fragments[0].sha256);
  assert.deepEqual(packet.criteria.map((criterion) => criterion.id), [
    "copying", "stereotyping_and_protected_characteristics", "safety", "voice", "source_fidelity_and_uncertainty",
  ]);
  const draft = reviewTools.createReviewDraft(packet);
  assert.equal(draft.reviewer_name, null);
  assert.equal(draft.personally_reviewed, null);
  assert.equal(draft.reviewed_at, null);
  assert.ok(draft.fragments.every((fragment) => Object.values(fragment.criteria)
    .every((decision) => decision.outcome === "unreviewed" && decision.notes === "")));
});

test("packet creation refuses stale corpus bytes and duplicate or unknown fragment selections", () => {
  assert.throws(() => reviewTools.createReviewPacket(content + " ", provenance, { createdAt }), /hash mismatch/);
  for (const refs of [[], ["missing"], ["mars-body-initiation", "mars-body-initiation"]]) {
    assert.throws(() => reviewTools.createReviewPacket(content, provenance, { refs, createdAt }), /selection/);
  }
});

test("record accepts only an enrolled name's signature over the exact review bytes", () => {
  const { record, review, registry, privateKey, packet } = fixture();
  const accepted = record();
  assert.equal(accepted.review_sha256, sha256Hex(JSON.stringify(review, null, 2) + "\n"));
  assert.deepEqual(reviewTools.reviewRecordProblems({ content, provenance, registry, record: accepted }), []);

  const otherKey = generateKeyPairSync("ed25519").privateKey;
  assert.throws(() => record(review, otherKey), /signature/);
  assert.throws(() => record({ ...review, reviewer_name: "Someone Else" }), /enrolled reviewer/);
  assert.throws(() => reviewTools.createReviewRecord({
    content, provenance, packet, reviewContent: JSON.stringify(review) + " ",
    signature: sign(null, Buffer.from(JSON.stringify(review)), privateKey), registry, recordedAt,
  }), /signature/);

  for (const mutate of [
    (value) => { value.review_json = value.review_json.replace("Synthetic fixture decision", "Changed decision"); },
    (value) => { value.reviewer_enrollment_sha256 = "0".repeat(64); },
    (value) => { value.packet.fragments[0].fragment.excerpt += " New words."; },
  ]) {
    const changed = structuredClone(accepted);
    mutate(changed);
    assert.notDeepEqual(reviewTools.reviewRecordProblems({ content, provenance, registry, record: changed }), []);
  }
});

test("an automatic review, unsigned draft, incomplete criteria, or copied identity cannot count as human review", () => {
  const { record, review, packet, registry } = fixture();
  for (const mutate of [
    (value) => { value.reviewer_kind = "model"; },
    (value) => { value.personally_reviewed = false; },
    (value) => { value.independent_of_generation = false; },
    (value) => { value.reviewed_at = null; },
    (value) => { value.fragments[0].sha256 = "0".repeat(64); },
    (value) => { delete value.fragments[0].criteria.voice; },
    (value) => { value.fragments[0].criteria.safety.outcome = "unreviewed"; },
    (value) => { value.fragments[0].criteria.copying.evidence_references = []; },
    (value) => { value.fragments[0].criteria.voice.notes = ""; },
    (value) => { value.fragments.push(value.fragments[0]); },
  ]) {
    const changed = structuredClone(review);
    mutate(changed);
    assert.throws(() => record(changed));
  }
  assert.throws(() => record(reviewTools.createReviewDraft(packet)));
  const empty = { ...registry, reviewers: [] };
  assert.match(reviewTools.reviewRecordProblems({ content, provenance, registry: empty, record: record() }).join("\n"), /enrolled reviewer/);
});

test("signed coverage stays partial with missing fragments or unresolved adverse reviews", () => {
  const { record, registry, review } = fixture();
  let summary = reviewTools.summarizeReviews({ content, provenance, registry, records: [] });
  assert.equal(summary.signed_review_coverage, "open");
  assert.equal(summary.passing_fragment_count, 0);
  summary = reviewTools.summarizeReviews({ content, provenance, registry, records: [record()] });
  assert.equal(summary.signed_review_coverage, "partial");
  assert.equal(summary.passing_fragment_count, 1);
  assert.equal(summary.unreviewed_fragment_refs.length, 59);
  const failed = structuredClone(review);
  failed.fragments[0].criteria.safety.outcome = "needs_followup";
  summary = reviewTools.summarizeReviews({ content, provenance, registry, records: [record(), record(failed)] });
  assert.equal(summary.passing_fragment_count, 0);
  assert.deepEqual(summary.blocked_fragment_refs, ["mars-body-initiation"]);
});

test("complete signed coverage never recovers historical provenance or independently proves human authorship", () => {
  const { record, registry } = fixture(JSON.parse(content).map((fragment) => fragment.ref));
  const summary = reviewTools.summarizeReviews({ content, provenance, registry, records: [record()] });
  assert.equal(summary.signed_review_coverage, "complete");
  assert.equal(summary.passing_fragment_count, 60);
  assert.equal(summary.human_authorship_status, "operator_attested_not_independently_proven");
  assert.equal(summary.historical_generation_status, "unverified");
  assert.equal(summary.public_activation_status, "unverified");
  assert.equal(readFileSync(join(REPO_ROOT, "pattern-corpus/provenance.json"), "utf8"), historicalBytes);
});

test("CLI prepares readable packets and records verified submissions without overwriting existing evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "corpus-review-test-"));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  try {
    const packetDir = join(directory, "packet");
    let result = run("packet", "--out", packetDir, "--refs", "mars-body-initiation");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(readFileSync(join(packetDir, "packet.md"), "utf8"), /Mars is usually described/);
    assert.equal(JSON.parse(readFileSync(join(packetDir, "review-draft.json"), "utf8")).reviewer_id, null);
    assert.equal(run("packet", "--out", packetDir).status, 1);

    const { packet, registry, review, privateKey } = fixture();
    writeFileSync(join(directory, "packet.json"), JSON.stringify(packet));
    writeFileSync(join(directory, "registry.json"), JSON.stringify(registry));
    const reviewContent = JSON.stringify(review, null, 2) + "\n";
    writeFileSync(join(directory, "review.json"), reviewContent);
    writeFileSync(join(directory, "review.sig"), sign(null, Buffer.from(reviewContent), privateKey));
    const args = ["record", "--packet", join(directory, "packet.json"), "--review", join(directory, "review.json"),
      "--signature", join(directory, "review.sig"), "--registry", join(directory, "registry.json"), "--records", join(directory, "records")];
    result = run(...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(run(...args).status, 1);
    result = run("status", "--registry", join(directory, "registry.json"), "--records", join(directory, "records"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).signed_review_coverage, "partial");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("empty evidence inventory cannot infer human review from reviewer enrollment", () => {
  const { registry } = fixture();
  const summary = reviewTools.summarizeReviews({ content, provenance, registry, records: [] });
  assert.equal(summary.signed_review_coverage, "open");
  assert.equal(summary.passing_fragment_count, 0);
});

test("reviewer enrollment refuses private keys and duplicate key identities", () => {
  const { registry, privateKey } = fixture();
  const privateRegistry = structuredClone(registry);
  privateRegistry.reviewers[0].public_key_pem = privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => reviewTools.summarizeReviews({ content, provenance, registry: privateRegistry, records: [] }), /public.*PEM/);
  const duplicate = structuredClone(registry);
  duplicate.reviewers.push({ ...duplicate.reviewers[0], reviewer_id: "another-reviewer", name: "Another Test Name" });
  assert.throws(() => reviewTools.summarizeReviews({ content, provenance, registry: duplicate, records: [] }), /key cannot identify multiple/);
});

test("stale, corrupted, duplicate, and incomplete evidence cannot produce a clean coverage result", () => {
  const { record, registry, review } = fixture();
  const valid = record();
  const corrupt = structuredClone(valid);
  corrupt.review_sha256 = "0".repeat(64);
  for (const records of [[valid, corrupt], [valid, valid]]) {
    const summary = reviewTools.summarizeReviews({ content, provenance, registry, records });
    assert.equal(summary.signed_review_coverage, "invalid");
    assert.ok(summary.problems.length > 0);
  }
  const changedRegistry = structuredClone(registry);
  changedRegistry.reviewers[0].identity_evidence_sha256 = "b".repeat(64);
  assert.equal(reviewTools.summarizeReviews({ content, provenance, registry: changedRegistry, records: [valid] }).signed_review_coverage, "invalid");
  for (const reviewed_at of ["2026-09-06T09:59:59.000Z", "2026-09-06T12:00:01.000Z"]) {
    assert.throws(() => record({ ...review, reviewed_at }), /timestamp/);
  }
});
