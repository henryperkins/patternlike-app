import { canonicalJson, contentHash } from "@patternlike/shared";
import type { Env } from "../env.js";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const CORPUS_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SOURCE_FRAGMENT_ID = /^srcf_[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/;
const MAX_CORPUS_MANIFEST_BYTES = 4 * 1024 * 1024;
const CORPUS_OBJECT_PREFIX = "pattern-ontology-corpora/";
const TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "corpus_release_id",
  "corpus_hash",
  "locale",
  "license_resolved",
  "fragments",
]);
const FRAGMENT_FIELDS = new Set([
  "id",
  "corpus_release_id",
  "locale",
  "title",
  "author",
  "edition",
  "location",
  "exclusions",
  "normalized_proposition",
  "excerpt",
  "license_class",
  "allowed_transformations",
]);
const REQUIRED_FRAGMENT_FIELDS = [
  "id",
  "corpus_release_id",
  "locale",
  "normalized_proposition",
  "excerpt",
  "license_class",
  "allowed_transformations",
] as const;
const TRANSFORMATION_CLASSES = new Set([
  "intersection",
  "contrast",
  "tension",
  "counterbalance",
  "developmental_arc",
  "expression_range",
  "shared_motif",
]);

export type VerifiedCorpusLicenseClass =
  | "licensed_excerpt"
  | "internal_synthetic";

export interface VerifiedPatternOntologyCorpus {
  releaseId: string;
  releaseHash: string;
  locale: string;
  licenseClass: VerifiedCorpusLicenseClass;
  publicCapable: boolean;
  objectKey: string;
}

export class PatternOntologyCorpusError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PatternOntologyCorpusError";
  }
}

function fail(code: string): never {
  throw new PatternOntologyCorpusError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function optionalFragmentFieldsAreValid(
  fragment: Record<string, unknown>,
): boolean {
  return (
    (fragment.title === undefined || typeof fragment.title === "string") &&
    (fragment.author === undefined || typeof fragment.author === "string") &&
    (fragment.edition === undefined ||
      (typeof fragment.edition === "string" && fragment.edition.length > 0)) &&
    (fragment.location === undefined ||
      (typeof fragment.location === "string" &&
        fragment.location.length > 0)) &&
    (fragment.exclusions === undefined ||
      (Array.isArray(fragment.exclusions) &&
        fragment.exclusions.every(
          (value) => typeof value === "string" && value.length > 0,
        )))
  );
}

function fragmentIsValid(
  value: unknown,
  releaseId: string,
  locale: string,
): value is Record<string, unknown> & {
  license_class: VerifiedCorpusLicenseClass;
} {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some((key) => !FRAGMENT_FIELDS.has(key)) ||
    REQUIRED_FRAGMENT_FIELDS.some((field) => !(field in value)) ||
    typeof value.id !== "string" ||
    !SOURCE_FRAGMENT_ID.test(value.id) ||
    value.corpus_release_id !== releaseId ||
    value.locale !== locale ||
    typeof value.normalized_proposition !== "string" ||
    value.normalized_proposition.length === 0 ||
    typeof value.excerpt !== "string" ||
    value.excerpt.length === 0 ||
    value.excerpt.length > 2_000 ||
    (value.license_class !== "licensed_excerpt" &&
      value.license_class !== "internal_synthetic") ||
    !Array.isArray(value.allowed_transformations) ||
    !value.allowed_transformations.every(
      (item) => typeof item === "string" && TRANSFORMATION_CLASSES.has(item),
    ) ||
    !optionalFragmentFieldsAreValid(value)
  ) {
    return false;
  }
  return true;
}

export function patternOntologyCorpusObjectKey(releaseId: string): string {
  if (!CORPUS_RELEASE_ID.test(releaseId)) {
    fail("ontology_corpus_manifest_invalid");
  }
  return `${CORPUS_OBJECT_PREFIX}${releaseId}.json`;
}

export async function readVerifiedPatternOntologyCorpus(
  env: Env,
  releaseId: string,
): Promise<VerifiedPatternOntologyCorpus> {
  if (!env.ARTIFACTS) fail("ontology_corpus_manifest_missing");
  const objectKey = patternOntologyCorpusObjectKey(releaseId);
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) fail("ontology_corpus_manifest_missing");
  if (object.size > MAX_CORPUS_MANIFEST_BYTES) {
    fail("ontology_corpus_manifest_invalid");
  }
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(await object.arrayBuffer());
  } catch {
    fail("ontology_corpus_manifest_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("ontology_corpus_manifest_invalid");
  }
  if (!isRecord(parsed) || !hasExactFields(parsed, TOP_LEVEL_FIELDS)) {
    fail("ontology_corpus_manifest_invalid");
  }
  if (canonicalJson(parsed) !== bytes) {
    fail("ontology_corpus_manifest_noncanonical");
  }
  if (
    parsed.schema_version !== "0.7.0" ||
    parsed.corpus_release_id !== releaseId ||
    typeof parsed.corpus_hash !== "string" ||
    !CONTENT_HASH.test(parsed.corpus_hash) ||
    typeof parsed.locale !== "string" ||
    parsed.locale.length > 35 ||
    !LOCALE.test(parsed.locale) ||
    parsed.license_resolved !== true ||
    !Array.isArray(parsed.fragments) ||
    parsed.fragments.length === 0 ||
    !parsed.fragments.every((fragment) =>
      fragmentIsValid(fragment, releaseId, parsed.locale as string))
  ) {
    fail("ontology_corpus_manifest_invalid");
  }
  const { corpus_hash: declaredHash, ...payload } = parsed;
  const computedHash = await contentHash(canonicalJson(payload));
  if (computedHash !== declaredHash) {
    fail("ontology_corpus_manifest_hash_mismatch");
  }
  const classes = new Set(
    parsed.fragments.map((fragment) =>
      (fragment as { license_class: VerifiedCorpusLicenseClass })
        .license_class),
  );
  if (classes.size !== 1) fail("ontology_corpus_manifest_invalid");
  const licenseClass = classes.values().next().value;
  if (
    licenseClass !== "licensed_excerpt" &&
    licenseClass !== "internal_synthetic"
  ) {
    fail("ontology_corpus_manifest_invalid");
  }
  return {
    releaseId,
    releaseHash: declaredHash,
    locale: parsed.locale,
    licenseClass,
    publicCapable: licenseClass === "licensed_excerpt",
    objectKey,
  };
}
