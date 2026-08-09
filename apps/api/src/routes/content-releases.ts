import { Hono } from "hono";
import { canonicalJson, requireIdempotencyKey, SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  activateRelease,
  findReleaseByBundleHash,
  findReleaseByVersion,
  getActiveVersion,
  recordAudit,
  storeRelease,
  type ReleaseRecord,
} from "../db/content-releases.js";
import {
  computeBundleHash,
  hashesEqual,
  parseReleaseKeys,
  pendingFixtureIds,
  validateContentGraph,
  validateIngestionRequest,
  verifyBundleSignature,
  verifyObjectHashes,
  type ContentReleaseBundle,
  type RejectionReason,
} from "../services/content-release.js";

/**
 * `POST /internal/content-releases` — ingestion of signed WordPress bundles.
 *
 * Mounted under the `/internal` prefix behind `serviceAuth`, so the consumer
 * session has no reach here and the editorial control plane has no reach into
 * user data. The pipeline follows the spec verbatim: verify the signature,
 * store the bundle in R2, run the smoke tests, then atomically activate the
 * pointer — in that order, because each step's input is the previous step's
 * verified output.
 */
export const contentReleaseRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

const RESPONSE_STATUS = {
  pending: "accepted_pending_tests",
  active: "active",
  duplicate: "duplicate",
} as const;

interface IngestionResponse {
  schema_version: typeof SCHEMA_VERSION;
  release_version: string;
  bundle_hash: string;
  status: (typeof RESPONSE_STATUS)[keyof typeof RESPONSE_STATUS];
  r2_uri: string | null;
  active_pointer: string | null;
  rejection_reason_class: string | null;
  received_at: string;
}

/** Logical bucket name for `r2_uri`; the binding is `ARTIFACTS`. */
const R2_BUCKET_LABEL = "artifacts";

function objectKey(version: string): string {
  return `content-releases/${version}.json`;
}

contentReleaseRoutes.post("/content-releases", async (c) => {
  const requestId = c.get("requestId");
  const receivedAt = new Date().toISOString();

  const errorBody = (reason: RejectionReason) => ({
    error: {
      code: reason.class,
      message: reason.message,
      request_id: requestId,
      details: { rejection_reason_class: reason.class },
    },
  });

  /**
   * Refuse, and leave a trace. The launch criterion is that activation is
   * auditable; a bundle that was offered and turned away is part of that
   * record, and it is the only durable signal that someone is presenting
   * bundles this Worker will not accept.
   */
  const refuse = async (
    reason: RejectionReason,
    status: 400 | 409,
    context: { version?: string | null; keyId?: string | null } = {},
  ) => {
    await recordAudit(c.env, {
      action: "content_release.ingest",
      resourceId: context.version ?? null,
      result: "denied",
      detailClass: reason.class,
      actorId: context.keyId ?? null,
    });
    return c.json(errorBody(reason), status);
  };

  // Required by the OpenAPI on every mutating endpoint. The durable idempotency
  // here is `bundle_hash`, which is UNIQUE in D1 and derived from the bytes
  // rather than asserted alongside them — the header is checked because the
  // contract requires it, not because a replay could slip past without it.
  const headerKey = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!headerKey) {
    return c.json(
      errorBody({
        class: "idempotency_key_required",
        message: "Idempotency-Key header is required (8..256 characters)",
      }),
      400,
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      errorBody({ class: "invalid_json", message: "Request body must be valid JSON" }),
      400,
    );
  }

  const parsed = validateIngestionRequest(raw);
  if ("error" in parsed) return refuse(parsed.error, 400);
  const { request } = parsed;
  const bundle: ContentReleaseBundle = request.bundle;
  const version = bundle.release.version;
  const keyId = bundle.signature.key_id;

  // Two keys naming the same request that disagree is not a request anyone can
  // act on: whichever one wins, the caller believes the other.
  if (request.idempotency_key !== headerKey) {
    return refuse(
      {
        class: "idempotency_key_mismatch",
        message: "Idempotency-Key header and body idempotency_key must match",
      },
      400,
      { version, keyId },
    );
  }

  const keys = parseReleaseKeys(c.env.CONTENT_RELEASE_KEYS);
  if (keys.size === 0) {
    // Fails closed everywhere, development included. A branch that skipped
    // verification locally would mean the one path that must never be wrong is
    // the one path never exercised before production.
    return c.json(
      errorBody({
        class: "release_keys_not_configured",
        message: "CONTENT_RELEASE_KEYS is not configured; cannot verify release signatures",
      }),
      503,
    );
  }

  // --- Integrity: everything below this line reasons about verified bytes. ---

  const computedHash = await computeBundleHash(bundle);
  if (!hashesEqual(computedHash, bundle.release.bundle_hash)) {
    return refuse(
      {
        class: "bundle_hash_mismatch",
        message: "release.bundle_hash does not match the canonical bundle body",
      },
      400,
      { version, keyId },
    );
  }

  const signatureError = await verifyBundleSignature(bundle, keys);
  if (signatureError) return refuse(signatureError, 400, { version, keyId });

  // --- Smoke tests on the verified content graph. ---

  const graphError = validateContentGraph(bundle);
  if (graphError) return refuse(graphError, 400, { version, keyId });

  const objectHashError = await verifyObjectHashes(bundle);
  if (objectHashError) return refuse(objectHashError, 400, { version, keyId });

  // --- Immutability and replay. ---

  const existingByVersion = await findReleaseByVersion(c.env, version);
  const activate = request.activate ?? true;

  if (existingByVersion) {
    if (!hashesEqual(existingByVersion.bundle_hash, computedHash)) {
      return refuse(
        {
          class: "release_version_immutable",
          message: `Release ${version} was already ingested with different content`,
        },
        409,
        { version, keyId },
      );
    }
  } else {
    const existingByHash = await findReleaseByBundleHash(c.env, computedHash);
    if (existingByHash) {
      return refuse(
        {
          class: "bundle_hash_conflict",
          message: `These bytes were already ingested as release ${existingByHash.version}`,
        },
        409,
        { version, keyId },
      );
    }
  }

  const activePointer = await getActiveVersion(c.env);

  // A re-POST of bytes already stored and already live is the retry it looks
  // like. Re-running activation would rewrite the pointer to where it already
  // points and emit a second activation audit row for an event that did not
  // happen twice.
  if (existingByVersion && (!activate || activePointer === version)) {
    const response: IngestionResponse = {
      schema_version: SCHEMA_VERSION,
      release_version: version,
      bundle_hash: computedHash,
      status: RESPONSE_STATUS.duplicate,
      r2_uri: existingByVersion.r2_uri,
      active_pointer: activePointer,
      rejection_reason_class: null,
      received_at: receivedAt,
    };
    return c.json(response, 202);
  }

  // --- Store the immutable artifact, then move the pointer. ---

  if (!c.env.ARTIFACTS) {
    return c.json(
      errorBody({
        class: "object_storage_not_configured",
        message: "ARTIFACTS R2 bucket is not bound; cannot store the release bundle",
      }),
      503,
    );
  }

  const key = objectKey(version);
  const r2Uri = `r2://${R2_BUCKET_LABEL}/${key}`;
  // Canonical form, not the caller's bytes: the stored artifact is what a later
  // reader re-verifies, and it must hash to `bundle_hash` under the same
  // canonicalisation this Worker used rather than under the sender's
  // whitespace and key order.
  await c.env.ARTIFACTS.put(key, canonicalJson(bundle), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { release_version: version, bundle_hash: computedHash },
  });

  const record: ReleaseRecord = {
    version,
    bundleHash: computedHash,
    r2Uri,
    approverId: bundle.release.approver_id,
    lastAuthorId: bundle.release.last_author_id,
    changelog: bundle.release.changelog,
    calcContractId: bundle.release.calc_contract_id ?? null,
  };

  // The bundle may declare eligibility fixtures. Running them needs the M3
  // assembly engine, so a bundle that carries them is stored and left inactive
  // rather than activated on tests nobody ran.
  const unevaluated = pendingFixtureIds(bundle);
  const holdForFixtures = activate && unevaluated.length > 0;

  if (!activate || holdForFixtures) {
    if (holdForFixtures) {
      // The response envelope has no field for this and `detail_class` is an
      // opaque class, so without a log the only trace of *which* tests were
      // skipped is the bundle itself. Ids, never content.
      console.warn("content_release_held_for_fixtures", {
        request_id: requestId,
        release_version: version,
        fixture_ids: unevaluated,
      });
    }
    await storeRelease(c.env, record, {
      action: "content_release.store",
      resourceId: version,
      result: "success",
      detailClass: holdForFixtures ? "fixtures_unevaluated" : "activate_false",
      actorId: keyId,
    });

    const response: IngestionResponse = {
      schema_version: SCHEMA_VERSION,
      release_version: version,
      bundle_hash: computedHash,
      status: RESPONSE_STATUS.pending,
      r2_uri: r2Uri,
      active_pointer: activePointer,
      rejection_reason_class: null,
      received_at: receivedAt,
    };
    return c.json(response, 202);
  }

  await activateRelease(c.env, record, {
    action: "content_release.activate",
    resourceId: version,
    result: "success",
    // Distinguishes a first activation from a pointer moved back to an earlier
    // release, which is the operation the spec calls rollback.
    detailClass: existingByVersion ? "rollback" : "activate",
    actorId: keyId,
  });

  const response: IngestionResponse = {
    schema_version: SCHEMA_VERSION,
    release_version: version,
    bundle_hash: computedHash,
    status: RESPONSE_STATUS.active,
    r2_uri: r2Uri,
    active_pointer: version,
    rejection_reason_class: null,
    received_at: receivedAt,
  };
  return c.json(response, 202);
});
