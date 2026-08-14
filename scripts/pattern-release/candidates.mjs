// Candidate loading, validation, and reviewed-bytes hashing.
//
// Shared by the builder and its tests. Nothing here is imported by the Worker,
// the web app, or any shipped package: candidates are review material and the
// runtime has no path that reads them.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");
export const CANDIDATE_FILE = join(REPO_ROOT, "content", "pattern-candidates", "candidates.json");

export const CANDIDATE_STATE = "review_candidate";

/**
 * `LAUNCH_BODIES` order, and it is load-bearing twice: membership, and the rank
 * that defines canonical aspect-pair order. The frozen M4 contract settles that
 * order — its rejection fixture is the alphabetical form of a Sun-Moon aspect —
 * so this list mirrors `canonicalAspectPair` in @patternlike/shared rather than
 * sorting. These scripts are plain ESM and cannot import the TypeScript
 * package; `build.test.mjs` pins the two lists against each other.
 */
export const BODY_ORDER = [
  "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
  "uranus", "neptune", "pluto", "true_node", "ascendant", "midheaven",
];
const BODIES = new Set(BODY_ORDER);
const ASPECTS = new Set(["conjunction", "sextile", "square", "trine", "opposition"]);
const ACCURACIES = new Set(["exact", "approximate", "unknown"]);
const GROUPS = new Set([
  "integrated_aspect_structure",
  "elemental_or_modal_emphasis",
  "calculated_multi_body_pattern",
  "accuracy_gated_angular_or_house",
]);

/**
 * The fields that become the shipped content object, in the order the release
 * declares them. `reviewer_notes`, `candidate_id`, `state`, `group`, and
 * `evidence_requirements` are review material and are deliberately absent: a
 * reviewer note reaching a reader would be a leak, and the M4 object schema is
 * closed, so it would also be a rejected release.
 */
const SHIPPED_FIELDS = [
  "id",
  "content_type",
  "content_version",
  "object_hash",
  "locale",
  "status",
  "display_priority",
  "title",
  "summary",
  "body",
  "resources",
  "tensions",
  "counter_expression",
  "prohibited_claims",
  "tags",
  "minimum_accuracy",
  "requires_houses",
  "required_bodies",
  "required_aspects",
  "match",
];

/** RFC 8785-shaped canonical JSON: sorted keys, no insignificant whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isStringArray(value, { min = 0 } = {}) {
  return Array.isArray(value) && value.length >= min &&
    value.every((item) => typeof item === "string" && item.length > 0);
}

function predicateProblem(predicate, where) {
  if (!predicate || typeof predicate !== "object" || Array.isArray(predicate)) {
    return `${where}: predicate must be an object`;
  }
  switch (predicate.type) {
    case "position":
      if (!BODIES.has(predicate.body)) return `${where}: unknown body ${predicate.body}`;
      if (predicate.sign === undefined && predicate.house === undefined) {
        return `${where}: a position predicate must constrain sign or house`;
      }
      return null;
    case "aspect":
      if (!BODIES.has(predicate.body_a) || !BODIES.has(predicate.body_b)) {
        return `${where}: unknown body in aspect predicate`;
      }
      if (!ASPECTS.has(predicate.aspect)) return `${where}: unknown aspect ${predicate.aspect}`;
      // A reversed pair is not a stricter rule; the contract calls it invalid,
      // and the runtime narrower refuses the release that carries it.
      if (BODY_ORDER.indexOf(predicate.body_a) >= BODY_ORDER.indexOf(predicate.body_b)) {
        return `${where}: aspect pair must be in canonical order (${predicate.body_a}, ${predicate.body_b})`;
      }
      return null;
    case "pattern":
      if (typeof predicate.pattern !== "string" || !predicate.pattern) {
        return `${where}: pattern predicate needs a pattern name`;
      }
      return null;
    case "angle":
      return predicate.angle === "ascendant" || predicate.angle === "midheaven"
        ? null
        : `${where}: unknown angle ${predicate.angle}`;
    case "house_cusp":
      return Number.isInteger(predicate.house) ? null : `${where}: house_cusp needs a house`;
    case "uncertainty":
      return ACCURACIES.has(predicate.accuracy) ? null : `${where}: unknown accuracy`;
    default:
      return `${where}: unknown predicate type ${String(predicate.type)}`;
  }
}

/** Structural problems with one candidate, as a list rather than a first hit. */
export function candidateProblems(candidate) {
  const problems = [];
  const id = candidate?.candidate_id ?? "<unnamed>";
  const require = (field, ok, message) => {
    if (!ok) problems.push(`${id}.${field}: ${message}`);
  };

  require("candidate_id", typeof candidate?.candidate_id === "string" && candidate.candidate_id.length > 0, "required");
  require("content_id", typeof candidate?.content_id === "string" && /^[A-Za-z0-9_./@+-]+$/.test(candidate.content_id ?? ""), "must be a fragment id");
  require("content_version", typeof candidate?.content_version === "string" && candidate.content_version.length > 0, "required");
  require("locale", typeof candidate?.locale === "string" && candidate.locale.length > 0, "required");
  require("state", candidate?.state === CANDIDATE_STATE, `must be "${CANDIDATE_STATE}"`);
  require("group", GROUPS.has(candidate?.group), `must be one of ${[...GROUPS].join(", ")}`);
  require("display_priority", Number.isInteger(candidate?.display_priority), "must be an integer");
  require("title", typeof candidate?.title === "string" && candidate.title.length > 0, "required");
  require("summary", typeof candidate?.summary === "string" && candidate.summary.length > 0, "required");
  require("body", typeof candidate?.body === "string" && candidate.body.length > 0, "required");
  require("resources", isStringArray(candidate?.resources), "must be strings");
  require("tensions", isStringArray(candidate?.tensions, { min: 1 }), "needs at least one tension");
  require("counter_expression", typeof candidate?.counter_expression === "string" && candidate.counter_expression.length > 0, "every family states its counter-expression");
  require("prohibited_claims", isStringArray(candidate?.prohibited_claims, { min: 1 }), "needs at least one prohibited claim");
  require("evidence_requirements", typeof candidate?.evidence_requirements === "string" && candidate.evidence_requirements.length > 0, "reviewers need the human-readable evidence statement");
  require("tags", isStringArray(candidate?.tags), "must be strings");
  require("minimum_accuracy", ACCURACIES.has(candidate?.minimum_accuracy), "must be a birth-time accuracy");
  require("requires_houses", typeof candidate?.requires_houses === "boolean", "required");
  require("required_bodies", Array.isArray(candidate?.required_bodies) && candidate.required_bodies.every((body) => BODIES.has(body)), "unknown body");
  require("required_aspects", Array.isArray(candidate?.required_aspects) && candidate.required_aspects.every((aspect) => ASPECTS.has(aspect)), "unknown aspect");
  require("reviewer_notes", typeof candidate?.reviewer_notes === "string", "reviewer notes are required and are never shipped");

  const match = candidate?.match;
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    problems.push(`${id}.match: required`);
    return problems;
  }
  for (const clause of ["all_of", "any_of", "none_of"]) {
    if (!Array.isArray(match[clause])) {
      problems.push(`${id}.match.${clause}: must be an array`);
      continue;
    }
    match[clause].forEach((predicate, index) => {
      const problem = predicateProblem(predicate, `${id}.match.${clause}[${index}]`);
      if (problem) problems.push(problem);
    });
  }
  if ((match.all_of?.length ?? 0) === 0 && (match.any_of?.length ?? 0) === 0) {
    problems.push(`${id}.match: needs at least one positive predicate`);
  }
  // A house or angle predicate is only evaluable when houses are eligible, and
  // that needs a real birth time. Without the gate the family would silently
  // never match rather than being reported as accuracy-omitted.
  const positional = [...(match.all_of ?? []), ...(match.any_of ?? [])];
  const needsTime = positional.some(
    (predicate) =>
      predicate?.type === "angle" ||
      predicate?.type === "house_cusp" ||
      (predicate?.type === "position" && predicate.house !== undefined),
  );
  if (needsTime && (candidate.requires_houses !== true || candidate.minimum_accuracy === "unknown")) {
    problems.push(
      `${id}: a house or angle predicate requires requires_houses=true and a minimum_accuracy above "unknown"`,
    );
  }
  return problems;
}

/**
 * The bytes a human reviewed, for one candidate.
 *
 * Split in two so a manifest can approve prose and matching rules separately:
 * an editorial reviewer signs off the words, and the same or another reviewer
 * signs off the rule that decides who is shown them.
 */
export function reviewedHashes(candidate) {
  const content = {
    content_id: candidate.content_id,
    content_version: candidate.content_version,
    locale: candidate.locale,
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body,
    resources: candidate.resources,
    tensions: candidate.tensions,
    counter_expression: candidate.counter_expression,
    prohibited_claims: candidate.prohibited_claims,
  };
  const rule = {
    content_id: candidate.content_id,
    minimum_accuracy: candidate.minimum_accuracy,
    requires_houses: candidate.requires_houses,
    required_bodies: candidate.required_bodies,
    required_aspects: candidate.required_aspects,
    match: candidate.match,
  };
  return {
    content_hash: `sha256:${sha256Hex(canonicalJson(content))}`,
    match_rule_hash: `sha256:${sha256Hex(canonicalJson(rule))}`,
  };
}

export function loadCandidates(file = CANDIDATE_FILE) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed?.candidates)) {
    throw new Error(`${file} does not contain a candidates array`);
  }
  const problems = parsed.candidates.flatMap(candidateProblems);
  const ids = new Set();
  const contentIds = new Set();
  for (const candidate of parsed.candidates) {
    if (ids.has(candidate.candidate_id)) problems.push(`duplicate candidate_id ${candidate.candidate_id}`);
    if (contentIds.has(candidate.content_id)) problems.push(`duplicate content_id ${candidate.content_id}`);
    ids.add(candidate.candidate_id);
    contentIds.add(candidate.content_id);
  }
  if (problems.length > 0) {
    throw new Error(`Candidate file is not reviewable:\n  ${problems.join("\n  ")}`);
  }
  return parsed.candidates;
}

/** Project one approved candidate into the closed M4 pattern object. */
export function toPatternObject(candidate) {
  const object = {
    id: candidate.content_id,
    content_type: "pattern",
    content_version: candidate.content_version,
    // Replaced by the caller once the whole bundle is assembled; the field has
    // to exist first because the digest is computed over the object without it.
    object_hash: `sha256:${"0".repeat(64)}`,
    locale: candidate.locale,
    status: "approved",
    display_priority: candidate.display_priority,
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body,
    resources: candidate.resources,
    tensions: candidate.tensions,
    counter_expression: candidate.counter_expression,
    prohibited_claims: candidate.prohibited_claims,
    tags: candidate.tags,
    minimum_accuracy: candidate.minimum_accuracy,
    requires_houses: candidate.requires_houses,
    required_bodies: candidate.required_bodies,
    required_aspects: candidate.required_aspects,
    match: candidate.match,
  };
  const unexpected = Object.keys(object).filter((key) => !SHIPPED_FIELDS.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`Shipped object gained unexpected fields: ${unexpected.join(", ")}`);
  }
  return object;
}

export { SHIPPED_FIELDS };
