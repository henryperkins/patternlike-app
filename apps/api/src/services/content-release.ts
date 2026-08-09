import { canonicalJson, contentHash, SCHEMA_VERSION } from "@patternlike/shared";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import commonSchema from "../../../../contracts/m0/common.schema.json";
import contentReleaseSchema from "../../../../contracts/m0/content-release.schema.json";

/**
 * Verification for signed editorial release bundles.
 *
 * Spec v0.2 § WordPress.com editorial model: "Cloudflare verifies the
 * signature, stores the bundle in R2, runs smoke tests, and atomically
 * activates the release pointer." Everything in this module is the "verifies"
 * half — pure functions over a parsed body, so the route stays a sequence of
 * decisions and the rules are testable without a Worker.
 *
 * WordPress is the authoring surface, not a trusted one: the threat model in
 * the spec ("WordPress compromise — signed immutable bundles") assumes the CMS
 * can be taken over. So nothing here trusts a field because the bundle asserts
 * it. Order matters and is enforced by the route: recompute the hash, verify
 * the signature, and only then reason about the content graph. A policy
 * decision made on unverified bytes is not a policy decision.
 */

export const RELEASE_OBJECT_COLLECTIONS = [
  "patterns",
  "cycles",
  "phases",
  "modifiers",
  "prompts",
  "safety_rules",
] as const;

export type ReleaseObjectCollection = (typeof RELEASE_OBJECT_COLLECTIONS)[number];

/** The content_type each collection is allowed to hold (schema `const`s). */
const COLLECTION_CONTENT_TYPE: Record<ReleaseObjectCollection, string> = {
  patterns: "astrology_pattern",
  cycles: "astrology_cycle",
  phases: "astrology_phase",
  modifiers: "astrology_modifier",
  prompts: "astrology_prompt",
  safety_rules: "astrology_safety_rule",
};

/** Collections the contract requires to be non-empty. */
const REQUIRED_NON_EMPTY: ReleaseObjectCollection[] = ["phases", "safety_rules"];

export const SIGNATURE_ALGORITHMS = ["Ed25519", "ES256"] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

export interface ContentObject {
  id: string;
  content_type: string;
  content_version: string;
  title: string;
  object_hash: string;
  locale: string;
  [key: string]: unknown;
}

export interface ReleaseMetadata {
  version: string;
  bundle_hash: string;
  created_at: string;
  approver_id: string;
  last_author_id: string;
  changelog: string;
  status: string;
  calc_contract_id?: string | null;
  [key: string]: unknown;
}

export interface BundleSignature {
  alg: SignatureAlgorithm;
  key_id: string;
  signature: string;
  signed_payload_hash: string;
}

export interface ReleaseFixture {
  fixture_id: string;
  expect: string;
}

export interface ContentReleaseBundle {
  schema_version: string;
  release: ReleaseMetadata;
  objects: Record<ReleaseObjectCollection, ContentObject[]>;
  signature: BundleSignature;
  fixtures?: ReleaseFixture[];
}

export interface ContentReleaseIngestionRequest {
  schema_version: string;
  bundle: ContentReleaseBundle;
  idempotency_key: string;
  activate?: boolean;
}

/**
 * An opaque class plus an operator-readable message.
 *
 * `class` is what reaches `audit_events.detail_class` and the response's
 * `rejection_reason_class`; the contract calls for "opaque error class only; no
 * private content", and editorial copy is exactly the private content that must
 * not leak into an audit row. `message` never carries fragment text either —
 * only ids, which are already public identifiers in the release.
 */
export interface RejectionReason {
  class: string;
  message: string;
}

function reject(cls: string, message: string): RejectionReason {
  return { class: cls, message };
}

/**
 * `contentHash` in the contract is `^(sha256:)?[a-f0-9]{64}$` — the prefix is
 * preferred for new writes but optional, so two spellings of the same digest
 * must compare equal. Comparing the raw strings would reject a conforming
 * bundle for punctuation.
 */
export function normalizeHash(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
}

export function hashesEqual(a: string, b: string): boolean {
  return normalizeHash(a) === normalizeHash(b);
}

/**
 * The exact bytes the signature covers and `release.bundle_hash` digests.
 *
 * The schema says "canonical sorted-key bundle body excluding signature".
 * `release.bundle_hash` is excluded as well, and that is not a liberty: it
 * lives inside the body it would have to digest, so including it makes the
 * hash define itself. Excluding the two is the only computable reading, and
 * both sides of the pipeline must agree on it — the WordPress release action
 * has to hash the same shape or every bundle is rejected.
 *
 * Everything else travels under the signature, `fixtures` included, so a
 * tampered-with smoke-test list invalidates the bundle like any other edit.
 */
export function bundleSigningPayload(bundle: ContentReleaseBundle): string {
  const { signature: _signature, ...body } = bundle;
  const { bundle_hash: _bundleHash, ...release } = bundle.release;
  return canonicalJson({ ...body, release });
}

export async function computeBundleHash(bundle: ContentReleaseBundle): Promise<string> {
  return contentHash(bundleSigningPayload(bundle));
}

/** Per-object digest, excluding the field that carries it, for the same reason. */
export async function computeObjectHash(object: ContentObject): Promise<string> {
  const { object_hash: _objectHash, ...rest } = object;
  return contentHash(canonicalJson(rest));
}

export interface ReleasePublicKey {
  alg: SignatureAlgorithm;
  /** Raw public key bytes, base64url: 32 bytes for Ed25519, a 65-byte uncompressed point for ES256. */
  publicKey: string;
}

export interface ParsedReleaseKeyConfiguration {
  keys: Map<string, ReleasePublicKey>;
  invalidKeyIds: string[];
  malformed: boolean;
}

/**
 * Parse `CONTENT_RELEASE_KEYS` — a JSON object of `key_id -> {alg, public_key}`.
 *
 * Public keys are configuration, not secrets, so they belong in wrangler
 * `[vars]` alongside `OIDC_JWKS_URL` rather than in `wrangler secret put`.
 *
 * `alg` is pinned per key rather than taken from the bundle. The bundle names
 * an algorithm too, and honouring that one would let a compromised CMS pick
 * which primitive its bytes are checked under; the two must agree instead.
 */
export function parseReleaseKeyConfiguration(
  raw: string | undefined,
): ParsedReleaseKeyConfiguration {
  const keys = new Map<string, ReleasePublicKey>();
  const invalidKeyIds: string[] = [];
  if (!raw || !raw.trim()) return { keys, invalidKeyIds, malformed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { keys, invalidKeyIds, malformed: true };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { keys, invalidKeyIds, malformed: true };
  }

  for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!keyId.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
      invalidKeyIds.push(keyId);
      continue;
    }
    const entry = value as Record<string, unknown>;
    const alg = entry.alg;
    const publicKey = entry.public_key;
    if (
      typeof alg !== "string" ||
      typeof publicKey !== "string" ||
      !(SIGNATURE_ALGORITHMS as readonly string[]).includes(alg) ||
      !publicKey.trim() ||
      !hasExpectedPublicKeyEncoding(alg as SignatureAlgorithm, publicKey)
    ) {
      invalidKeyIds.push(keyId);
      continue;
    }
    keys.set(keyId, { alg: alg as SignatureAlgorithm, publicKey });
  }
  return { keys, invalidKeyIds, malformed: false };
}

/** Returns only usable entries for pure signature-verification callers. */
export function parseReleaseKeys(raw: string | undefined): Map<string, ReleasePublicKey> {
  return parseReleaseKeyConfiguration(raw).keys;
}

export function decodeBase64Url(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hasExpectedPublicKeyEncoding(alg: SignatureAlgorithm, value: string): boolean {
  const raw = decodeBase64Url(value);
  if (!raw) return false;
  return alg === "Ed25519" ? raw.length === 32 : raw.length === 65 && raw[0] === 4;
}

/**
 * workerd exposes Ed25519 under the WebCrypto name on current compatibility
 * dates and under the older `NODE-ED25519` spelling before that. Importing
 * under both keeps verification working across runtime versions instead of
 * failing closed on a name.
 */
async function importVerifyKey(
  alg: SignatureAlgorithm,
  raw: Uint8Array,
): Promise<CryptoKey | null> {
  const attempts: SubtleCryptoImportKeyAlgorithm[] =
    alg === "Ed25519"
      ? [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }]
      : [{ name: "ECDSA", namedCurve: "P-256" }];

  for (const params of attempts) {
    try {
      return await crypto.subtle.importKey("raw", raw, params, false, ["verify"]);
    } catch {
      // Try the next spelling; an unusable key surfaces as a null return.
    }
  }
  return null;
}

function verifyParams(alg: SignatureAlgorithm, key: CryptoKey): SubtleCryptoSignAlgorithm {
  if (alg === "ES256") return { name: "ECDSA", hash: "SHA-256" };
  return { name: key.algorithm.name };
}

/**
 * Verify `signature.signature` over {@link bundleSigningPayload}.
 *
 * ES256 signatures are raw `r||s` (64 bytes), the JWS convention, not DER —
 * WebCrypto's ECDSA verify accepts only the former.
 */
export async function verifyBundleSignature(
  bundle: ContentReleaseBundle,
  keys: Map<string, ReleasePublicKey>,
): Promise<RejectionReason | null> {
  const configured = keys.get(bundle.signature.key_id);
  if (!configured) {
    return reject(
      "signature_key_unknown",
      `No configured public key for key_id ${bundle.signature.key_id}`,
    );
  }
  if (configured.alg !== bundle.signature.alg) {
    return reject(
      "signature_alg_mismatch",
      `Key ${bundle.signature.key_id} is configured for ${configured.alg}, bundle declares ${bundle.signature.alg}`,
    );
  }

  const rawKey = decodeBase64Url(configured.publicKey);
  if (!rawKey) {
    return reject(
      "signature_key_unusable",
      `Configured public key for ${bundle.signature.key_id} is not valid base64url`,
    );
  }
  const signature = decodeBase64Url(bundle.signature.signature);
  if (!signature) {
    return reject("signature_malformed", "signature is not valid base64url");
  }

  const key = await importVerifyKey(configured.alg, rawKey);
  if (!key) {
    return reject(
      "signature_key_unusable",
      `Configured public key for ${bundle.signature.key_id} could not be imported as ${configured.alg}`,
    );
  }

  const payload = new TextEncoder().encode(bundleSigningPayload(bundle));
  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      verifyParams(configured.alg, key),
      key,
      signature,
      payload,
    );
  } catch {
    return reject("signature_invalid", "Bundle signature could not be verified");
  }
  if (!verified) {
    return reject("signature_invalid", "Bundle signature does not match the bundle body");
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

const HASH_RE = /^(sha256:)?[a-f0-9]{64}$/;
const RELEASE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const schemaValidator = new Ajv2020({ strict: true });
addFormats(schemaValidator);
schemaValidator.addSchema(commonSchema);
schemaValidator.addSchema(contentReleaseSchema);
const loadedContentReleaseRequestValidator =
  schemaValidator.getSchema<ContentReleaseIngestionRequest>(
    `${contentReleaseSchema.$id}#/$defs/contentReleaseIngestionRequest`,
  );
if (!loadedContentReleaseRequestValidator) {
  throw new Error("Could not load contentReleaseIngestionRequest schema");
}
const validateContentReleaseRequest = loadedContentReleaseRequestValidator;

/**
 * Structural validation of an ingestion request.
 *
 * The bundled Draft 2020-12 schema is the source of truth for the frozen wire
 * contract. The focused checks below retain stable rejection classes and add
 * operational constraints (such as the safe R2/D1 release-version grammar)
 * without maintaining a second copy of the full contract by hand.
 */
export function validateIngestionRequest(
  value: unknown,
): { request: ContentReleaseIngestionRequest } | { error: RejectionReason } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: reject("invalid_body", "Request body must be a JSON object") };
  }
  const body = value as Record<string, unknown>;

  if (body.schema_version !== SCHEMA_VERSION) {
    return {
      error: reject(
        "schema_version_unsupported",
        `schema_version must be ${SCHEMA_VERSION}`,
      ),
    };
  }
  if (!isNonEmptyString(body.idempotency_key)) {
    return { error: reject("invalid_body", "idempotency_key is required") };
  }
  if (body.idempotency_key.length < 8 || body.idempotency_key.length > 256) {
    return {
      error: reject("invalid_body", "idempotency_key must be 8..256 characters"),
    };
  }
  if (body.activate !== undefined && typeof body.activate !== "boolean") {
    return { error: reject("invalid_body", "activate must be a boolean") };
  }

  const bundleError = validateBundleShape(body.bundle);
  if (bundleError) return { error: bundleError };

  if (!validateContentReleaseRequest(value)) {
    const firstError = validateContentReleaseRequest.errors?.[0];
    const schemaLocation = firstError
      ? `${firstError.instancePath || "/"} (${firstError.keyword})`
      : "unknown path";
    return {
      error: reject(
        "invalid_body",
        `Request body must conform to content-release.schema.json: ${schemaLocation}`,
      ),
    };
  }

  return { request: body as unknown as ContentReleaseIngestionRequest };
}

function validateBundleShape(value: unknown): RejectionReason | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_body", "bundle must be a JSON object");
  }
  const bundle = value as Record<string, unknown>;

  if (bundle.schema_version !== SCHEMA_VERSION) {
    return reject(
      "schema_version_unsupported",
      `bundle.schema_version must be ${SCHEMA_VERSION}`,
    );
  }

  const release = bundle.release;
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    return reject("invalid_body", "bundle.release must be a JSON object");
  }
  const meta = release as Record<string, unknown>;
  for (const field of [
    "created_at",
    "approver_id",
    "last_author_id",
    "changelog",
    "status",
  ]) {
    if (!isNonEmptyString(meta[field])) {
      return reject("invalid_body", `bundle.release.${field} is required`);
    }
  }
  if (!isNonEmptyString(meta.bundle_hash) || !HASH_RE.test(normalizeHashInput(meta.bundle_hash))) {
    return reject("invalid_body", "bundle.release.bundle_hash must be a sha256 digest");
  }
  // The contract only asks for a non-empty string, but this value becomes a D1
  // primary key, an R2 object key, and the trailing segment of `reading_key`,
  // whose pattern is colon-delimited. A '/' would reshape the object path and a
  // ':' would make a reading key ambiguous to parse, so the runtime narrows
  // what it will accept rather than repairing it later.
  if (!isNonEmptyString(meta.version) || !RELEASE_VERSION_RE.test(meta.version)) {
    return reject(
      "invalid_body",
      "bundle.release.version must be 1..128 characters of [A-Za-z0-9._-], starting alphanumeric",
    );
  }

  const signature = bundle.signature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return reject("invalid_body", "bundle.signature must be a JSON object");
  }
  const sig = signature as Record<string, unknown>;
  if (
    typeof sig.alg !== "string" ||
    !(SIGNATURE_ALGORITHMS as readonly string[]).includes(sig.alg)
  ) {
    return reject(
      "invalid_body",
      `bundle.signature.alg must be one of ${SIGNATURE_ALGORITHMS.join(", ")}`,
    );
  }
  for (const field of ["key_id", "signature", "signed_payload_hash"]) {
    if (!isNonEmptyString(sig[field])) {
      return reject("invalid_body", `bundle.signature.${field} is required`);
    }
  }
  if (!HASH_RE.test(normalizeHashInput(sig.signed_payload_hash as string))) {
    return reject(
      "invalid_body",
      "bundle.signature.signed_payload_hash must be a sha256 digest",
    );
  }

  const objects = bundle.objects;
  if (!objects || typeof objects !== "object" || Array.isArray(objects)) {
    return reject("invalid_body", "bundle.objects must be a JSON object");
  }
  const collections = objects as Record<string, unknown>;
  for (const name of RELEASE_OBJECT_COLLECTIONS) {
    const list = collections[name];
    if (!Array.isArray(list)) {
      return reject("invalid_body", `bundle.objects.${name} must be an array`);
    }
    if (REQUIRED_NON_EMPTY.includes(name) && list.length === 0) {
      return reject(
        "objects_incomplete",
        `bundle.objects.${name} must contain at least one object`,
      );
    }
    for (const [index, item] of list.entries()) {
      const objectError = validateObjectShape(name, index, item);
      if (objectError) return objectError;
    }
  }

  if (bundle.fixtures !== undefined) {
    if (!Array.isArray(bundle.fixtures)) {
      return reject("invalid_body", "bundle.fixtures must be an array");
    }
    for (const [index, item] of bundle.fixtures.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return reject("invalid_body", `bundle.fixtures[${index}] must be a JSON object`);
      }
      const fixture = item as Record<string, unknown>;
      if (!isNonEmptyString(fixture.fixture_id) || !isNonEmptyString(fixture.expect)) {
        return reject(
          "invalid_body",
          `bundle.fixtures[${index}] requires fixture_id and expect`,
        );
      }
    }
  }

  return null;
}

function normalizeHashInput(value: string): string {
  return value.trim().toLowerCase();
}

const FRAGMENT_ID_RE = /^[A-Za-z0-9_./@+-]+$/;

function validateObjectShape(
  collection: ReleaseObjectCollection,
  index: number,
  value: unknown,
): RejectionReason | null {
  const where = `bundle.objects.${collection}[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_body", `${where} must be a JSON object`);
  }
  const object = value as Record<string, unknown>;

  for (const field of ["id", "content_type", "content_version", "title", "locale"]) {
    if (!isNonEmptyString(object[field])) {
      return reject("invalid_body", `${where}.${field} is required`);
    }
  }
  if (!FRAGMENT_ID_RE.test(object.id as string)) {
    return reject("invalid_body", `${where}.id is not a valid fragment id`);
  }
  if (
    !isNonEmptyString(object.object_hash) ||
    !HASH_RE.test(normalizeHashInput(object.object_hash))
  ) {
    return reject("invalid_body", `${where}.object_hash must be a sha256 digest`);
  }
  if (object.content_type !== COLLECTION_CONTENT_TYPE[collection]) {
    return reject(
      "objects_incomplete",
      `${where}.content_type must be ${COLLECTION_CONTENT_TYPE[collection]}`,
    );
  }

  if (collection === "cycles" && !isStringArray(object.phase_ids)) {
    return reject("invalid_body", `${where}.phase_ids must be an array of fragment ids`);
  }
  if (collection === "phases" && !isNonEmptyString(object.parent_cycle_id)) {
    return reject("invalid_body", `${where}.parent_cycle_id is required`);
  }
  if (collection === "safety_rules") {
    if (!isNonEmptyString(object.rule_id)) {
      return reject("invalid_body", `${where}.rule_id is required`);
    }
    if (!isNonEmptyString(object.fallback_fragment_id)) {
      return reject("invalid_body", `${where}.fallback_fragment_id is required`);
    }
  }
  return null;
}

/**
 * Recompute every `object_hash`.
 *
 * The bundle signature already covers these bytes, so a mismatch is not a
 * tamper signal — it means the release action's canonicalisation disagrees with
 * this one. Catching it here, loudly, is what stops M3 from citing a
 * `content_version` whose digest nobody can reproduce from the stored bundle.
 */
export async function verifyObjectHashes(
  bundle: ContentReleaseBundle,
): Promise<RejectionReason | null> {
  for (const collection of RELEASE_OBJECT_COLLECTIONS) {
    for (const object of bundle.objects[collection]) {
      const computed = await computeObjectHash(object);
      if (!hashesEqual(computed, object.object_hash)) {
        return reject(
          "object_hash_mismatch",
          `object_hash does not match canonical content for ${object.id}`,
        );
      }
    }
  }
  return null;
}

export function allObjects(bundle: ContentReleaseBundle): ContentObject[] {
  return RELEASE_OBJECT_COLLECTIONS.flatMap((name) => bundle.objects[name]);
}

/**
 * The content-graph policies that JSON Schema 2020-12 cannot express.
 *
 * The first four mirror `content_release_policy_errors` in
 * `contracts/m0/validate_schemas.py` — CI enforces them on the frozen fixtures
 * and this enforces the same rules at ingestion, so a bundle cannot enter the
 * runtime by a door the contract lane does not guard. The rest close gaps that
 * only matter once a bundle is actually served: an unresolvable prompt or
 * fallback is a reading that cannot be assembled, and a duplicate fragment id
 * makes `approved_fragments` ambiguous about which text was approved.
 */
export function validateContentGraph(bundle: ContentReleaseBundle): RejectionReason | null {
  const { release, objects } = bundle;

  if (release.approver_id === release.last_author_id) {
    return reject(
      "dual_control_violation",
      "approver_id must differ from last_author_id",
    );
  }

  if (!hashesEqual(bundle.signature.signed_payload_hash, release.bundle_hash)) {
    return reject(
      "signature_payload_mismatch",
      "signature.signed_payload_hash must equal release.bundle_hash",
    );
  }

  const seen = new Set<string>();
  for (const object of allObjects(bundle)) {
    if (seen.has(object.id)) {
      return reject("duplicate_fragment_id", `fragment id ${object.id} appears twice`);
    }
    seen.add(object.id);
  }

  const cycles = new Map(objects.cycles.map((cycle) => [cycle.id, cycle]));
  const phases = new Map(objects.phases.map((phase) => [phase.id, phase]));
  const prompts = new Set(objects.prompts.map((prompt) => prompt.id));

  for (const phase of objects.phases) {
    const parent = phase.parent_cycle_id as string;
    if (!cycles.has(parent)) {
      return reject(
        "orphan_phase",
        `phase ${phase.id} parent_cycle_id ${parent} is not in objects.cycles`,
      );
    }
  }

  for (const cycle of objects.cycles) {
    for (const phaseId of cycle.phase_ids as string[]) {
      const phase = phases.get(phaseId);
      if (!phase) {
        return reject(
          "incomplete_cycle",
          `cycle ${cycle.id} phase_id ${phaseId} is not in objects.phases`,
        );
      }
      if (phase.parent_cycle_id !== cycle.id) {
        return reject(
          "incomplete_cycle",
          `cycle ${cycle.id} lists phase ${phaseId}, whose parent_cycle_id is ${String(phase.parent_cycle_id)}`,
        );
      }
    }
  }

  for (const pattern of objects.patterns) {
    const promptIds = pattern.prompt_ids;
    if (promptIds === undefined) continue;
    if (!isStringArray(promptIds)) {
      return reject("invalid_body", `pattern ${pattern.id} prompt_ids must be strings`);
    }
    for (const promptId of promptIds) {
      if (!prompts.has(promptId)) {
        return reject(
          "unresolved_prompt",
          `pattern ${pattern.id} prompt_id ${promptId} is not in objects.prompts`,
        );
      }
    }
  }

  // A safety rule exists to replace unsafe output with reviewed copy. One whose
  // fallback resolves to nothing is a rule that fires and produces nothing,
  // which is the failure mode the spec's "model failure or validation rejection
  // always produces reviewed deterministic copy" criterion exists to prevent.
  for (const rule of objects.safety_rules) {
    const fragmentId = rule.fallback_fragment_id as string;
    const hasText = isNonEmptyString(rule.fallback_text);
    if (!seen.has(fragmentId) && !hasText) {
      return reject(
        "unresolved_safety_fallback",
        `safety rule ${rule.id} fallback_fragment_id ${fragmentId} is not in this bundle and no fallback_text was supplied`,
      );
    }
  }

  return null;
}

/**
 * Whether the bundle can be activated now, or only stored.
 *
 * The spec activates a release *after* smoke tests. The integrity smoke tests
 * run at ingestion (graph resolution, hashes, signature), but a bundle may also
 * declare eligibility `fixtures`, and evaluating those needs the M3 assembly
 * engine that does not exist yet. Activating anyway would claim a test result
 * nobody produced, so a fixture-bearing bundle is stored and left inactive —
 * which is precisely what the contract's `accepted_pending_tests` status is
 * for. Re-POST the same bundle once M3 can run the fixtures to activate it.
 */
export function pendingFixtureIds(bundle: ContentReleaseBundle): string[] {
  return (bundle.fixtures ?? []).map((fixture) => fixture.fixture_id);
}
