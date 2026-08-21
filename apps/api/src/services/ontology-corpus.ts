import { canonicalJson, contentHash, type PatternTransformationClass } from "@patternlike/shared";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import m0CommonSchema from "../../../../contracts/m0/common.schema.json";
import m7CommonSchema from "../../../../contracts/m7/common.schema.json";
import sourceCorpusReleaseSchema from "../../../../contracts/m7/pattern-source-corpus-release.schema.json";
import sourceFragmentSchema from "../../../../contracts/m7/pattern-source-fragment.schema.json";
import type { Env } from "../env.js";
import {
  findRegisteredOntologyCorpus,
  findRegisteredOntologyCorpusIdentity,
  insertRegisteredOntologyCorpus,
  registeredOntologyCorpusMatches,
  type RegisteredCorpusLicenseClass,
  type RegisteredOntologyCorpusIdentity,
} from "../db/ontology-corpus.js";

const CORPUS_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const MAX_CORPUS_MANIFEST_BYTES = 4 * 1024 * 1024;
const CORPUS_OBJECT_PREFIX = "pattern-ontology-corpora/";
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export type OntologyCorpusLicenseClass = RegisteredCorpusLicenseClass;

export interface OntologyCorpusFragment {
  id: string;
  corpus_release_id: string;
  locale: string;
  title?: string;
  author?: string;
  edition?: string;
  location?: string;
  exclusions?: string[];
  normalized_proposition: string;
  excerpt: string;
  license_class: OntologyCorpusLicenseClass;
  allowed_transformations: PatternTransformationClass[];
}

export interface OntologyCorpusRelease {
  schema_version: "0.7.0";
  corpus_release_id: string;
  corpus_hash: string;
  locale: string;
  license_resolved: true;
  fragments: OntologyCorpusFragment[];
}

export interface CanonicalOntologyCorpusRelease {
  release: OntologyCorpusRelease;
  canonicalBytes: string;
  objectKey: string;
  licenseClass: OntologyCorpusLicenseClass;
  publicCapable: boolean;
}

export interface RegisteredOntologyCorpus extends CanonicalOntologyCorpusRelease {
  fragmentIndex: ReadonlyMap<string, OntologyCorpusFragment>;
}

export interface OntologyCorpusRunCommand {
  corpusReleaseId: string;
  corpusHash: string;
  locale: string;
  licenseClass: OntologyCorpusLicenseClass;
  publicCapable: boolean;
  fragments: readonly OntologyCorpusFragment[];
}

export class OntologyCorpusError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OntologyCorpusError";
  }
}

function fail(code: string): never {
  throw new OntologyCorpusError(code);
}

const schemaValidator = new Ajv2020({ strict: true });
addFormats(schemaValidator);
for (const schema of [
  m0CommonSchema,
  m7CommonSchema,
  sourceFragmentSchema,
  sourceCorpusReleaseSchema,
]) {
  schemaValidator.addSchema(schema);
}

function requiredValidator(schemaId: string): ValidateFunction {
  const validator = schemaValidator.getSchema(schemaId);
  if (!validator) throw new Error("Frozen M7 source corpus schema is unavailable");
  return validator;
}

const validateSourceCorpusRelease = requiredValidator(
  `${sourceCorpusReleaseSchema.$id}#/$defs/patternSourceCorpusRelease`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, index) => bytes[index] === byte)
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function corpusIdentity(
  canonical: CanonicalOntologyCorpusRelease,
): RegisteredOntologyCorpusIdentity {
  return {
    corpusReleaseId: canonical.release.corpus_release_id,
    corpusHash: canonical.release.corpus_hash,
    locale: canonical.release.locale,
    objectKey: canonical.objectKey,
    fragmentCount: canonical.release.fragments.length,
    licenseClass: canonical.licenseClass,
    publicCapable: canonical.publicCapable,
  };
}

function assertSchemaAndPolicy(
  value: unknown,
): OntologyCorpusRelease {
  if (!isRecord(value) || !validateSourceCorpusRelease(value)) {
    fail("ontology_corpus_manifest_invalid");
  }
  const release = value as unknown as OntologyCorpusRelease;
  if (!CORPUS_RELEASE_ID.test(release.corpus_release_id)) {
    fail("ontology_corpus_manifest_invalid");
  }
  const fragmentIds = new Set<string>();
  const firstLicenseClass = release.fragments[0]?.license_class;
  if (
    firstLicenseClass !== "licensed_excerpt" &&
    firstLicenseClass !== "internal_synthetic"
  ) {
    fail("ontology_corpus_manifest_invalid");
  }
  for (const fragment of release.fragments) {
    if (
      fragment.corpus_release_id !== release.corpus_release_id ||
      fragment.locale !== release.locale ||
      fragment.license_class !== firstLicenseClass ||
      fragmentIds.has(fragment.id)
    ) {
      fail("ontology_corpus_manifest_invalid");
    }
    fragmentIds.add(fragment.id);
  }
  return release;
}

/** The one create-only R2 namespace for canonical source corpora. */
export function ontologyCorpusObjectKey(releaseId: string): string {
  if (!CORPUS_RELEASE_ID.test(releaseId)) {
    fail("ontology_corpus_manifest_invalid");
  }
  return `${CORPUS_OBJECT_PREFIX}${releaseId}.json`;
}

/**
 * Validate the frozen M7 contract, then apply the operational identity rules
 * that JSON Schema cannot express across array members or the canonical hash.
 */
export async function canonicalizeOntologyCorpusRelease(
  value: unknown,
): Promise<CanonicalOntologyCorpusRelease> {
  const release = assertSchemaAndPolicy(value);
  const { corpus_hash: declaredHash, ...payload } = release;
  const computedHash = await contentHash(canonicalJson(payload));
  if (computedHash !== declaredHash) {
    fail("ontology_corpus_manifest_hash_mismatch");
  }
  const canonicalBytes = canonicalJson(release);
  if (new TextEncoder().encode(canonicalBytes).byteLength > MAX_CORPUS_MANIFEST_BYTES) {
    fail("ontology_corpus_manifest_invalid");
  }
  const licenseClass = release.fragments[0]!.license_class;
  return {
    release,
    canonicalBytes,
    objectKey: ontologyCorpusObjectKey(release.corpus_release_id),
    licenseClass,
    // This is derived from a validated all-fragment class, never caller input.
    publicCapable: licenseClass === "licensed_excerpt",
  };
}

/**
 * The ingestion-time reader used by the evidence verifier. It deliberately
 * knows no D1 row so Task 9 can continue to verify historical stored manifests;
 * the registered runtime reader below adds the D1 identity gate.
 */
export async function readStoredOntologyCorpusManifest(
  env: Env,
  releaseId: string,
): Promise<CanonicalOntologyCorpusRelease> {
  const objectKey = ontologyCorpusObjectKey(releaseId);
  if (!env.ARTIFACTS) fail("ontology_corpus_manifest_missing");
  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) fail("ontology_corpus_manifest_missing");
  if (object.size > MAX_CORPUS_MANIFEST_BYTES) {
    fail("ontology_corpus_manifest_invalid");
  }
  const rawBytes = new Uint8Array(await object.arrayBuffer());
  if (hasUtf8Bom(rawBytes)) fail("ontology_corpus_manifest_invalid");
  let bytes: string;
  try {
    bytes = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(rawBytes);
  } catch {
    fail("ontology_corpus_manifest_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("ontology_corpus_manifest_invalid");
  }
  // Check canonicality before accepting the declared hash so the immutable
  // stored representation has one byte-level identity.
  const release = assertSchemaAndPolicy(parsed);
  if (release.corpus_release_id !== releaseId) {
    fail("ontology_corpus_manifest_invalid");
  }
  if (canonicalJson(release) !== bytes) {
    fail("ontology_corpus_manifest_noncanonical");
  }
  return canonicalizeOntologyCorpusRelease(release);
}

async function storedObjectMatches(
  artifacts: R2Bucket,
  objectKey: string,
  expectedBytes: Uint8Array,
): Promise<boolean> {
  const stored = await artifacts.get(objectKey);
  if (!stored || stored.size !== expectedBytes.byteLength) return false;
  return sameBytes(new Uint8Array(await stored.arrayBuffer()), expectedBytes);
}

/**
 * Register immutable canonical corpus bytes. R2 reserves the object first;
 * a retry only proceeds after it proves the existing R2 bytes and all D1
 * identity fields are exactly the same.
 */
export async function registerOntologyCorpus(
  env: Env,
  value: unknown,
): Promise<{ corpus: RegisteredOntologyCorpus; status: "registered" | "duplicate" }> {
  const canonical = await canonicalizeOntologyCorpusRelease(value);
  const identity = corpusIdentity(canonical);
  if (!env.ARTIFACTS) fail("ontology_corpus_storage_unavailable");

  const existing = await findRegisteredOntologyCorpusIdentity(env, identity);
  const expectedBytes = new TextEncoder().encode(canonical.canonicalBytes);
  if (existing) {
    // A D1 row is never enough by itself: the stored immutable bytes remain
    // the read authority and must agree on every replay.
    let storedMatches = false;
    try {
      storedMatches = await storedObjectMatches(
        env.ARTIFACTS,
        identity.objectKey,
        expectedBytes,
      );
    } catch {
      fail("ontology_corpus_storage_unavailable");
    }
    if (!storedMatches || !registeredOntologyCorpusMatches(existing, identity)) {
      fail("ontology_corpus_immutable");
    }
    return {
      corpus: await registeredCorpusFromCanonical(env, canonical),
      status: "duplicate",
    };
  }

  try {
    await env.ARTIFACTS.put(identity.objectKey, expectedBytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    fail("ontology_corpus_storage_unavailable");
  }

  let storedMatches = false;
  try {
    storedMatches = await storedObjectMatches(
      env.ARTIFACTS,
      identity.objectKey,
      expectedBytes,
    );
  } catch {
    fail("ontology_corpus_storage_unavailable");
  }
  if (!storedMatches) fail("ontology_corpus_immutable");

  try {
    await insertRegisteredOntologyCorpus(env, identity);
  } catch {
    let raced;
    try {
      raced = await findRegisteredOntologyCorpusIdentity(env, identity);
    } catch {
      fail("ontology_corpus_registration_unavailable");
    }
    if (!raced || !registeredOntologyCorpusMatches(raced, identity)) {
      fail("ontology_corpus_immutable");
    }
    return {
      corpus: await registeredCorpusFromCanonical(env, canonical),
      status: "duplicate",
    };
  }
  return {
    corpus: await registeredCorpusFromCanonical(env, canonical),
    status: "registered",
  };
}

function runtimeCorpusFromCanonical(
  canonical: CanonicalOntologyCorpusRelease,
): RegisteredOntologyCorpus {
  return {
    ...canonical,
    fragmentIndex: new Map(
      canonical.release.fragments.map((fragment) => [fragment.id, fragment]),
    ),
  };
}

async function registeredCorpusFromCanonical(
  env: Env,
  canonical: CanonicalOntologyCorpusRelease,
): Promise<RegisteredOntologyCorpus> {
  const stored = await readStoredOntologyCorpusManifest(
    env,
    canonical.release.corpus_release_id,
  );
  if (stored.canonicalBytes !== canonical.canonicalBytes) {
    fail("ontology_corpus_immutable");
  }
  return runtimeCorpusFromCanonical(stored);
}

/**
 * Runtime authority: D1 first establishes that this corpus was registered;
 * R2 then supplies the only fragment data, after its canonical identity has
 * been re-verified. This reader never dereferences source text or URLs.
 */
export async function readRegisteredOntologyCorpus(
  env: Env,
  releaseId: string,
): Promise<RegisteredOntologyCorpus> {
  if (!CORPUS_RELEASE_ID.test(releaseId)) {
    fail("ontology_corpus_not_registered");
  }
  const row = await findRegisteredOntologyCorpus(env, releaseId);
  if (!row) fail("ontology_corpus_not_registered");
  const expectedKey = ontologyCorpusObjectKey(releaseId);
  if (row.object_key !== expectedKey) {
    fail("ontology_corpus_registered_identity_mismatch");
  }
  const stored = await readStoredOntologyCorpusManifest(env, releaseId);
  const identity = corpusIdentity(stored);
  if (!registeredOntologyCorpusMatches(row, identity)) {
    fail("ontology_corpus_registered_identity_mismatch");
  }
  return runtimeCorpusFromCanonical(stored);
}

/**
 * Resolve cited ids for a later immutable run command. Missing ids are not
 * tolerated, and a public command can only originate from registered all-
 * licensed-excerpt corpus material.
 */
export function buildOntologyCorpusRunCommand(
  corpus: RegisteredOntologyCorpus,
  citedFragmentIds: readonly string[],
  activationScope: "internal" | "public" = "internal",
): OntologyCorpusRunCommand {
  if (activationScope === "public" && !corpus.publicCapable) {
    fail("ontology_corpus_not_public");
  }
  const fragments = citedFragmentIds.map((fragmentId) => {
    const fragment = corpus.fragmentIndex.get(fragmentId);
    if (!fragment) fail("ontology_corpus_fragment_missing");
    return fragment;
  });
  return {
    corpusReleaseId: corpus.release.corpus_release_id,
    corpusHash: corpus.release.corpus_hash,
    locale: corpus.release.locale,
    licenseClass: corpus.licenseClass,
    publicCapable: corpus.publicCapable,
    fragments,
  };
}
