#!/usr/bin/env node
// Build an UNSIGNED M4 content-release body from reviewed Pattern candidates.
//
// The gate this command exists to enforce: a candidate becomes shippable only
// when a human review manifest says a named human approved those exact bytes,
// and a different named human authored them. Everything else here is assembly.
//
// It never signs. `sign.mjs` does that with a key supplied from outside the
// repository, so a compromised checkout cannot produce an ingestable bundle.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT,
  canonicalJson,
  loadCandidates,
  reviewedHashes,
  sha256Hex,
  toPatternObject,
} from "./candidates.mjs";

const BASE_BUNDLE = join(
  REPO_ROOT,
  "contracts",
  "m3",
  "fixtures",
  "valid",
  "content-release.bundle.json",
);

export class BuildRefused extends Error {
  constructor(problems) {
    super(`Refusing to build a production-shaped release:\n  ${problems.join("\n  ")}`);
    this.name = "BuildRefused";
    this.problems = problems;
  }
}

/**
 * Every rule the manifest has to satisfy, checked together.
 *
 * Reported as a list rather than a first failure: a reviewer fixing one
 * approval at a time learns nothing about the other twenty-three.
 */
export function reviewProblems(candidates, manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["review manifest must be a JSON object"];
  }
  if (!Array.isArray(manifest.approvals)) return ["review manifest has no approvals array"];
  if (typeof manifest.reviewed_at !== "string" || !manifest.reviewed_at) {
    problems.push("review manifest needs reviewed_at");
  }
  // These land in `release.last_author_id` and `release.approver_id`, which the
  // ingestion route requires to be distinct. Checking here keeps the refusal in
  // the same list as every other review failure.
  const releaseAuthor = typeof manifest.release_author === "string" ? manifest.release_author.trim() : "";
  const releaseApprover = typeof manifest.release_approver === "string" ? manifest.release_approver.trim() : "";
  if (!releaseAuthor) problems.push("review manifest names no release_author");
  if (!releaseApprover) problems.push("review manifest names no release_approver");
  if (releaseAuthor && releaseApprover && releaseAuthor.toLowerCase() === releaseApprover.toLowerCase()) {
    problems.push("release_author and release_approver must be different people");
  }

  const approvals = new Map();
  for (const approval of manifest.approvals) {
    if (!approval || typeof approval !== "object") {
      problems.push("an approval entry is not an object");
      continue;
    }
    if (approvals.has(approval.candidate_id)) {
      problems.push(`${approval.candidate_id}: approved twice`);
    }
    approvals.set(approval.candidate_id, approval);
  }

  for (const candidate of candidates) {
    const approval = approvals.get(candidate.candidate_id);
    if (!approval) {
      problems.push(`${candidate.candidate_id}: no approval in the review manifest`);
      continue;
    }
    if (approval.approved !== true) {
      problems.push(`${candidate.candidate_id}: approval is not marked approved`);
    }
    const author = typeof approval.author === "string" ? approval.author.trim() : "";
    const approver = typeof approval.approver === "string" ? approval.approver.trim() : "";
    if (!author) problems.push(`${candidate.candidate_id}: approval names no human author`);
    if (!approver) problems.push(`${candidate.candidate_id}: approval names no human approver`);
    // Self-approval is the failure mode the whole manifest exists to prevent.
    if (author && approver && author.toLowerCase() === approver.toLowerCase()) {
      problems.push(`${candidate.candidate_id}: author and approver must be different people`);
    }

    const hashes = reviewedHashes(candidate);
    if (approval.content_hash !== hashes.content_hash) {
      problems.push(
        `${candidate.candidate_id}: content changed since review (approved ${approval.content_hash ?? "nothing"}, found ${hashes.content_hash})`,
      );
    }
    if (approval.match_rule_hash !== hashes.match_rule_hash) {
      problems.push(
        `${candidate.candidate_id}: match rule changed since review (approved ${approval.match_rule_hash ?? "nothing"}, found ${hashes.match_rule_hash})`,
      );
    }
  }

  const known = new Set(candidates.map((candidate) => candidate.candidate_id));
  for (const id of approvals.keys()) {
    if (!known.has(id)) problems.push(`${id}: approved but not present in the candidate file`);
  }
  return problems;
}

/**
 * Content-graph checks over the assembled body.
 *
 * The Worker re-runs its own version of these after verifying the signature —
 * nothing here is a substitute for that. Running them at build time means a
 * release that would be rejected is never signed, so a signing key is never
 * spent on bytes that cannot be ingested.
 */
export function graphProblems(bundle) {
  const problems = [];
  const objects = bundle.objects ?? {};
  for (const collection of [
    "patterns", "cycles", "phases", "modifiers", "prompts",
    "safety_rules", "timing_templates", "daily_fallbacks",
  ]) {
    if (!Array.isArray(objects[collection])) problems.push(`objects.${collection} is missing`);
  }
  if (problems.length > 0) return problems;

  const locales = new Set(bundle.release.supported_locales ?? []);
  if (!locales.has(bundle.release.locale_default)) {
    problems.push("locale_default is not in supported_locales");
  }
  for (const pattern of objects.patterns) {
    if (!locales.has(pattern.locale)) {
      problems.push(`${pattern.id}: locale ${pattern.locale} is not declared in supported_locales`);
    }
    if (pattern.status !== "approved") {
      problems.push(`${pattern.id}: a production-shaped release cannot carry a draft object`);
    }
    for (const field of ["state", "candidate_id", "reviewer_notes", "evidence_requirements", "group"]) {
      if (field in pattern) problems.push(`${pattern.id}: review-only field ${field} reached the release`);
    }
  }
  const ids = objects.patterns.map((pattern) => pattern.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate pattern content ids");

  // Fixtures are held pending until a runtime fixture evaluator exists, so a
  // release built here must not declare any.
  if (Array.isArray(bundle.fixtures) && bundle.fixtures.length > 0) {
    problems.push("this builder does not emit fixtures; the runtime evaluator is not implemented");
  }
  return problems;
}

function objectHash(object) {
  const { object_hash: _omitted, ...rest } = object;
  return `sha256:${sha256Hex(canonicalJson(rest))}`;
}

function bundleHash(bundle) {
  const { signature: _signature, ...body } = bundle;
  const { bundle_hash: _bundleHash, ...release } = body.release;
  return `sha256:${sha256Hex(canonicalJson({ ...body, release }))}`;
}

export function buildRelease({ candidates, manifest, version, createdAt, changelog }) {
  const problems = reviewProblems(candidates, manifest);
  if (problems.length > 0) throw new BuildRefused(problems);

  const base = JSON.parse(readFileSync(BASE_BUNDLE, "utf8"));
  const bundle = {
    schema_version: "0.4.0",
    release: {
      ...base.release,
      version,
      created_at: createdAt,
      changelog,
      status: "active",
      last_author_id: manifest.release_author,
      approver_id: manifest.release_approver,
      bundle_hash: `sha256:${"0".repeat(64)}`,
    },
    objects: {
      ...base.objects,
      patterns: candidates.map(toPatternObject),
    },
    signature: {
      alg: "Ed25519",
      key_id: "unsigned",
      signature: "",
      signed_payload_hash: "",
    },
  };
  delete bundle.fixtures;

  const graph = graphProblems(bundle);
  if (graph.length > 0) throw new BuildRefused(graph);

  for (const collection of Object.keys(bundle.objects)) {
    for (const object of bundle.objects[collection]) {
      object.object_hash = objectHash(object);
    }
  }
  bundle.release.bundle_hash = bundleHash(bundle);
  return bundle;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument ${flag}`);
    args[flag.slice(2)] = argv[index + 1];
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  for (const required of ["review-manifest", "version", "out"]) {
    if (!args[required]) {
      throw new Error(
        "Usage: build.mjs --review-manifest <file> --version <release-version> --out <file> [--changelog <text>]",
      );
    }
  }
  const candidates = loadCandidates();
  const manifest = JSON.parse(readFileSync(resolve(args["review-manifest"]), "utf8"));
  const bundle = buildRelease({
    candidates,
    manifest,
    version: args.version,
    createdAt: manifest.reviewed_at,
    changelog: args.changelog ?? `Reviewed Pattern catalog ${args.version}`,
  });
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${canonicalJson(bundle)}\n`, "utf8");
  process.stdout.write(
    `Wrote an unsigned release with ${bundle.objects.patterns.length} reviewed patterns to ${out}\n` +
      `Sign it with scripts/pattern-release/sign.mjs and a key stored outside this repository.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith("build.mjs")) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
