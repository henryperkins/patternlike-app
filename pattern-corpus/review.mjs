// Repository evidence tooling only. This does not publish content, generate
// judgments, enroll a person, create a key, or sign on a reviewer's behalf.
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, REPO_ROOT, sha256Hex } from "../scripts/pattern-release/candidates.mjs";
import { provenanceProblems } from "./provenance.mjs";

const CORPUS_DIRECTORY = join(REPO_ROOT, "pattern-corpus");
const SHA256 = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const hash = (value) => sha256Hex(canonicalJson(value));
const hasKeys = (value, keys) => isObject(value)
  && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
const timestamp = (value) => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export const REVIEW_CRITERIA = Object.freeze([
  { id: "copying", instruction: "Check the complete fragment for copying or close paraphrase. Record the comparison sources or review-method evidence and its limits. Missing historical source inputs remain unknown; a pass is not a legal originality warranty." },
  { id: "stereotyping_and_protected_characteristics", instruction: "Check for essentialist stereotypes and unsupported claims about protected characteristics, appearance, intelligence, conduct, sexuality, or a person's worth." },
  { id: "safety", instruction: "Check for medical or mental-health diagnosis, harmful advice, victim-blaming, predictive guarantees, causal certainty, invented biography, and other unsafe personal claims." },
  { id: "voice", instruction: "Check for calm, humane, specific reflective language with meaningful tension and counter-expression. Reject fatalism, generic sign filler, hype, false intimacy, unsupported praise, and claims of uniqueness." },
  { id: "source_fidelity_and_uncertainty", instruction: "Check that the proposition, excerpt, exclusions, and allowed transformations agree. Preserve uncertainty and birth-time suppression; do not extend a source into unsupported interpretation." },
]);
const CRITERION_IDS = REVIEW_CRITERIA.map((criterion) => criterion.id);

/** Complete reviewable content plus an immutable historical-evidence binding. */
export function createReviewPacket(content, provenance, { refs, createdAt = new Date().toISOString() } = {}) {
  const problems = provenanceProblems(content, provenance);
  assert(problems.length === 0, problems.join("; "));
  assert(timestamp(createdAt), "packet creation timestamp invalid");
  const fragments = JSON.parse(content);
  const selected = refs ?? fragments.map((fragment) => fragment.ref);
  assert(Array.isArray(selected) && selected.length > 0
    && new Set(selected).size === selected.length
    && selected.every((ref) => fragments.some((fragment) => fragment.ref === ref)), "fragment selection invalid");
  return {
    schema_version: "pattern-corpus-review-packet.v1",
    created_at: createdAt,
    corpus_release_id: provenance.corpus_release_id,
    content_sha256: sha256Hex(content),
    historical_provenance_sha256: hash(provenance),
    historical_generation_status: "unverified",
    criteria: structuredClone(REVIEW_CRITERIA),
    fragments: fragments.filter((fragment) => selected.includes(fragment.ref)).map((fragment) => ({
      ref: fragment.ref, sha256: hash(fragment), fragment,
    })),
  };
}

/** Deliberately incomplete. A named reviewer must supply every judgment. */
export function createReviewDraft(packet) {
  return {
    schema_version: "pattern-corpus-review.v1",
    packet_sha256: hash(packet),
    corpus_release_id: packet.corpus_release_id,
    content_sha256: packet.content_sha256,
    reviewer_id: null,
    reviewer_name: null,
    reviewer_kind: null,
    independent_of_generation: null,
    personally_reviewed: null,
    reviewed_at: null,
    fragments: packet.fragments.map(({ ref, sha256 }) => ({
      ref, sha256,
      criteria: Object.fromEntries(CRITERION_IDS.map((id) => [id, {
        outcome: "unreviewed", notes: "", evidence_references: [],
      }])),
    })),
  };
}

function enrolledReviewers(registry) {
  assert(hasKeys(registry, ["schema_version", "reviewers"])
    && registry.schema_version === "pattern-corpus-reviewers.v1"
    && Array.isArray(registry.reviewers), "reviewer registry invalid");
  const ids = new Set();
  const keys = new Set();
  return registry.reviewers.map((entry) => {
    assert(hasKeys(entry, ["reviewer_id", "name", "kind", "independent_of_generation", "public_key_pem",
      "identity_evidence_reference", "identity_evidence_sha256", "enrolled_by", "enrolled_at"])
      && typeof entry.reviewer_id === "string" && SLUG.test(entry.reviewer_id)
      && !ids.has(entry.reviewer_id) && nonempty(entry.name)
      && entry.kind === "human" && entry.independent_of_generation === true
      && nonempty(entry.identity_evidence_reference) && SHA256.test(entry.identity_evidence_sha256)
      && nonempty(entry.enrolled_by) && timestamp(entry.enrolled_at), "enrolled reviewer metadata invalid");
    assert(typeof entry.public_key_pem === "string"
      && /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(entry.public_key_pem),
    "enrolled reviewer needs a public SPKI PEM; private keys are refused");
    const key = createPublicKey(entry.public_key_pem);
    assert(key.asymmetricKeyType === "ed25519", "enrolled reviewer key must be Ed25519");
    const keyHash = sha256Hex(key.export({ type: "spki", format: "der" }));
    assert(!keys.has(keyHash), "enrolled reviewer key cannot identify multiple reviewers");
    ids.add(entry.reviewer_id);
    keys.add(keyHash);
    return { entry, key, keyHash };
  });
}

function verifySubmission({ content, provenance, packet, reviewContent, signature, registry, recordedAt }) {
  assert(timestamp(recordedAt), "recording timestamp invalid");
  assert(isObject(packet) && Array.isArray(packet.fragments), "review packet invalid");
  const expectedPacket = createReviewPacket(content, provenance, {
    refs: packet.fragments.map((fragment) => fragment.ref), createdAt: packet.created_at,
  });
  assert(canonicalJson(packet) === canonicalJson(expectedPacket), "review packet content or criteria mismatch");
  const review = JSON.parse(reviewContent);
  assert(hasKeys(review, ["schema_version", "packet_sha256", "corpus_release_id", "content_sha256", "reviewer_id",
    "reviewer_name", "reviewer_kind", "independent_of_generation", "personally_reviewed", "reviewed_at", "fragments"])
    && review.schema_version === "pattern-corpus-review.v1"
    && review.packet_sha256 === hash(packet)
    && review.corpus_release_id === packet.corpus_release_id
    && review.content_sha256 === packet.content_sha256, "review content binding invalid");
  assert(review.reviewer_kind === "human" && review.independent_of_generation === true
    && review.personally_reviewed === true, "review needs an independent human personal-review attestation");
  assert(timestamp(review.reviewed_at) && Date.parse(review.reviewed_at) >= Date.parse(packet.created_at)
    && Date.parse(review.reviewed_at) <= Date.parse(recordedAt), "review timestamp invalid");
  const enrolled = enrolledReviewers(registry).find(({ entry }) => entry.reviewer_id === review.reviewer_id);
  assert(enrolled && enrolled.entry.name === review.reviewer_name
    && Date.parse(enrolled.entry.enrolled_at) <= Date.parse(recordedAt), "review does not match an enrolled reviewer");
  assert(Buffer.isBuffer(signature) && signature.length === 64
    && verify(null, Buffer.from(reviewContent, "utf8"), enrolled.key, signature), "review signature invalid");
  assert(Array.isArray(review.fragments) && review.fragments.length === packet.fragments.length,
    "review fragment inventory incomplete");
  const refs = new Set();
  for (const fragment of review.fragments) {
    assert(hasKeys(fragment, ["ref", "sha256", "criteria"])
      && !refs.has(fragment.ref)
      && packet.fragments.some((source) => source.ref === fragment.ref && source.sha256 === fragment.sha256),
    "review fragment hash or inventory mismatch");
    refs.add(fragment.ref);
    assert(hasKeys(fragment.criteria, CRITERION_IDS), "review criteria incomplete");
    for (const [id, decision] of Object.entries(fragment.criteria)) {
      assert(hasKeys(decision, ["outcome", "notes", "evidence_references"])
        && ["pass", "fail", "needs_followup"].includes(decision.outcome) && nonempty(decision.notes)
        && Array.isArray(decision.evidence_references) && decision.evidence_references.every(nonempty)
        && (id !== "copying" || decision.evidence_references.length > 0), `review criterion ${id} incomplete`);
    }
  }
  return { review, enrolled };
}

/** Verifies supplied bytes; has no capability to create a reviewer's signature. */
export function createReviewRecord({ content, provenance, packet, reviewContent, signature, registry,
  recordedAt = new Date().toISOString() }) {
  const { enrolled } = verifySubmission({ content, provenance, packet, reviewContent, signature, registry, recordedAt });
  return {
    schema_version: "pattern-corpus-review-record.v1",
    recorded_at: recordedAt,
    packet: structuredClone(packet),
    review_json: reviewContent,
    review_sha256: sha256Hex(reviewContent),
    signature_algorithm: "ed25519",
    signature_base64: signature.toString("base64"),
    reviewer_key_sha256: enrolled.keyHash,
    reviewer_enrollment_sha256: hash(enrolled.entry),
  };
}

export function reviewRecordProblems({ content, provenance, registry, record }) {
  try {
    assert(hasKeys(record, ["schema_version", "recorded_at", "packet", "review_json", "review_sha256", "signature_algorithm",
      "signature_base64", "reviewer_key_sha256", "reviewer_enrollment_sha256"])
      && record.schema_version === "pattern-corpus-review-record.v1"
      && record.signature_algorithm === "ed25519" && typeof record.review_json === "string"
      && record.review_sha256 === sha256Hex(record.review_json), "review record integrity invalid");
    const signature = Buffer.from(record.signature_base64, "base64");
    assert(signature.toString("base64") === record.signature_base64, "review signature encoding invalid");
    const { enrolled } = verifySubmission({ content, provenance, registry, packet: record.packet,
      reviewContent: record.review_json, signature, recordedAt: record.recorded_at });
    assert(record.reviewer_key_sha256 === enrolled.keyHash
      && record.reviewer_enrollment_sha256 === hash(enrolled.entry), "reviewer enrollment binding mismatch");
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "review record invalid"];
  }
}

/** Coverage of signed declarations, separate from empirical human authorship. */
export function summarizeReviews({ content, provenance, registry, records }) {
  const packet = createReviewPacket(content, provenance);
  enrolledReviewers(registry);
  const problems = [];
  const reviewed = new Set();
  const blocked = new Set();
  const recordHashes = new Set();
  for (const [index, record] of records.entries()) {
    const invalid = reviewRecordProblems({ content, provenance, registry, record });
    if (invalid.length > 0) {
      problems.push(...invalid.map((problem) => `record ${index + 1}: ${problem}`));
      continue;
    }
    if (recordHashes.has(record.review_sha256)) {
      problems.push(`record ${index + 1}: duplicate review record`);
      continue;
    }
    recordHashes.add(record.review_sha256);
    for (const fragment of JSON.parse(record.review_json).fragments) {
      reviewed.add(fragment.ref);
      if (Object.values(fragment.criteria).some((criterion) => criterion.outcome !== "pass")) blocked.add(fragment.ref);
    }
  }
  const passing = [...reviewed].filter((ref) => !blocked.has(ref));
  return {
    schema_version: "pattern-corpus-review-summary.v1",
    corpus_release_id: packet.corpus_release_id,
    content_sha256: packet.content_sha256,
    signed_review_coverage: problems.length > 0 ? "invalid"
      : reviewed.size === 0 ? "open" : passing.length === packet.fragments.length ? "complete" : "partial",
    valid_signed_record_count: recordHashes.size,
    fragment_count: packet.fragments.length,
    reviewed_fragment_count: reviewed.size,
    passing_fragment_count: passing.length,
    blocked_fragment_refs: [...blocked].sort(),
    unreviewed_fragment_refs: packet.fragments.map((fragment) => fragment.ref).filter((ref) => !reviewed.has(ref)),
    attribution_basis: reviewed.size > 0 ? "signature_verified_against_operator_enrolled_key" : "none",
    human_authorship_status: reviewed.size > 0 ? "operator_attested_not_independently_proven" : "unverified",
    historical_generation_status: "unverified",
    public_activation_status: "unverified",
    problems,
  };
}

function packetMarkdown(packet) {
  return [
    "# Pattern corpus review packet", "",
    `Corpus: ${packet.corpus_release_id}`, `Content SHA-256: ${packet.content_sha256}`,
    `Packet SHA-256: ${hash(packet)}`, "",
    "A named independent reviewer must read every field, enter a decision and rationale for every criterion, and sign the completed review JSON bytes using their own enrolled key.",
    "This packet contains no judgments. A signature authenticates an enrolled key, not independent proof of human authorship. Historical generation provenance and public activation remain unverified.", "",
    ...packet.criteria.flatMap((criterion) => [`## ${criterion.id}`, "", criterion.instruction, ""]),
    ...packet.fragments.flatMap(({ ref, sha256, fragment }) => [
      `## ${ref}`, "", `Canonical complete-fragment SHA-256: ${sha256}`, "", "```json",
      JSON.stringify(fragment, null, 2), "```", "",
    ]),
  ].join("\n");
}

function options(args, allowed, required) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    assert(allowed.includes(key) && !Object.hasOwn(parsed, key) && nonempty(args[index + 1])
      && !args[index + 1].startsWith("--"), `unknown, duplicate, or incomplete option: ${key}`);
    parsed[key] = args[index + 1];
  }
  for (const key of required) assert(parsed[key], `required option: ${key}`);
  return parsed;
}

function main(args) {
  const [command, ...rest] = args;
  const content = readFileSync(join(CORPUS_DIRECTORY, "fragments.json"), "utf8");
  const provenance = JSON.parse(readFileSync(join(CORPUS_DIRECTORY, "provenance.json"), "utf8"));
  if (command === "packet") {
    const input = options(rest, ["--out", "--refs"], ["--out"]);
    const packet = createReviewPacket(content, provenance, { refs: input["--refs"]?.split(",") });
    const directory = resolve(input["--out"]);
    mkdirSync(directory); // Exclusive new directory: never overwrite a reviewer's work.
    writeFileSync(join(directory, "packet.json"), JSON.stringify(packet, null, 2) + "\n", { flag: "wx" });
    writeFileSync(join(directory, "review-draft.json"), JSON.stringify(createReviewDraft(packet), null, 2) + "\n", { flag: "wx" });
    writeFileSync(join(directory, "packet.md"), packetMarkdown(packet), { flag: "wx" });
    return { packet_directory: directory, fragment_count: packet.fragments.length, review_status: "unreviewed" };
  }
  assert(command === "record" || command === "status", "usage: review.mjs packet --out DIRECTORY [--refs REF,REF] | record --packet FILE --review FILE --signature FILE [--registry FILE] [--records DIRECTORY] | status [--registry FILE] [--records DIRECTORY]");
  const input = options(rest, command === "record"
    ? ["--packet", "--review", "--signature", "--registry", "--records"] : ["--registry", "--records"],
  command === "record" ? ["--packet", "--review", "--signature"] : []);
  const registry = JSON.parse(readFileSync(input["--registry"] ?? join(CORPUS_DIRECTORY, "reviewers.json"), "utf8"));
  const directory = resolve(input["--records"] ?? join(CORPUS_DIRECTORY, "reviews"));
  if (command === "record") {
    const record = createReviewRecord({ content, provenance, registry,
      packet: JSON.parse(readFileSync(input["--packet"], "utf8")),
      reviewContent: readFileSync(input["--review"], "utf8"), signature: readFileSync(input["--signature"]),
    });
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${record.review_sha256}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    return { record_path: file, review_sha256: record.review_sha256,
      attribution_basis: "signature_verified_against_operator_enrolled_key",
      human_authorship_status: "operator_attested_not_independently_proven" };
  }
  const files = existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith(".json")).sort() : [];
  const records = files.map((file) => JSON.parse(readFileSync(join(directory, file), "utf8")));
  const summary = summarizeReviews({ content, provenance, registry, records });
  if (summary.problems.length > 0) process.exitCode = 1;
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`corpus review: ${error instanceof Error ? error.message : "invalid input"}\n`);
    process.exitCode = 1;
  }
}
