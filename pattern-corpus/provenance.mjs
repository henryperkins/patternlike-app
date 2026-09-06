// Repository-side inventory. These checks do not certify authorship or publish a corpus.
import { canonicalJson, sha256Hex } from "../scripts/pattern-release/candidates.mjs";
import { readFileSync } from "node:fs";

const GENERATION_FIELDS = ["provider", "model", "model_version", "account_context", "generated_at"];
const SHA256 = /^[0-9a-f]{64}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function provenanceProblems(content, provenance) {
  if (!record(provenance)) return ["provenance record missing or invalid"];
  const problems = [];
  if (provenance.schema_version !== "pattern-corpus-provenance.v1") problems.push("provenance schema version invalid");
  if (provenance.content_sha256 !== sha256Hex(content)) problems.push("provenance content hash mismatch");
  const fragments = JSON.parse(content);
  if (!Array.isArray(fragments)) return [...problems, "corpus must be an array"];
  if (provenance.corpus_release_id !== "pattern-ontology-source-manual-en-us-0.1.0"
    || provenance.content_path !== "pattern-corpus/fragments.json"
    || fragments.length !== 60 || fragments.some((fragment) => !record(fragment)
    || ["title", "edition", "locale"].some((key) => fragment[key] !== provenance[key])
    || fragment.author !== "Pattern editorial (model-generated)"
    || fragment.license_class !== provenance.license?.license_class)) {
    problems.push("provenance corpus metadata mismatch");
  }
  if (provenance.fragment_count !== fragments.length) problems.push("provenance fragment count mismatch");
  if (provenance.origin !== "model_generated_first_party") problems.push("provenance must retain model-generated first-party origin");
  if (provenance.origin_status !== "recorded"
    || provenance.origin_evidence_path !== "pattern-corpus/ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md"
    || provenance.origin_evidence_sha256 !== sha256Hex(readFileSync(new URL("./ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md", import.meta.url), "utf8"))) {
    problems.push("provenance origin decision evidence mismatch");
  }
  if (provenance.license?.license_class !== "licensed_excerpt"
    || provenance.license?.operator_authorization_status !== "recorded"
    || provenance.license?.counsel_review_status !== "unverified"
    || provenance.license?.generating_account_terms_status !== "unverified"
    || provenance.source_material_review?.status !== "unverified"
    || provenance.source_material_review?.no_unpublished_third_party_source_supplied !== null) {
    problems.push("provenance review evidence must retain unresolved historical conditions");
  }
  if (!Array.isArray(provenance.fragments)) return [...problems, "provenance fragment inventory missing"];
  const refs = new Set();
  for (const entry of provenance.fragments) {
    if (!record(entry) || typeof entry.ref !== "string" || !SHA256.test(entry.sha256)) {
      problems.push("provenance fragment entry invalid");
      continue;
    }
    if (refs.has(entry.ref)) problems.push("provenance duplicate fragment ref");
    refs.add(entry.ref);
    const fragment = fragments.find((candidate) => candidate.ref === entry.ref);
    if (!fragment || entry.sha256 !== sha256Hex(canonicalJson(fragment))) problems.push("provenance fragment content hash mismatch");
  }
  if (refs.size !== fragments.length || fragments.some((fragment) => !refs.has(fragment.ref))) {
    problems.push("provenance fragment inventory does not cover the corpus exactly");
  }
  for (const field of GENERATION_FIELDS) {
    const item = provenance.generation?.[field];
    if (!record(item) || item.status !== "unverified" || item.value !== null) {
      problems.push(`provenance generation.${field} needs the explicit unverified historical record`);
    }
  }
  if (provenance.human_review?.status !== "incomplete"
    || provenance.human_review?.certified_fragment_count !== 0
    || !Array.isArray(provenance.human_review?.certifications)
    || provenance.human_review.certifications.length !== 0) {
    problems.push("provenance human review has no fragment certification evidence; retain incomplete status");
  }
  if (provenance.public_activation?.status !== "unverified") problems.push("provenance must not claim public activation certification");
  return problems;
}
