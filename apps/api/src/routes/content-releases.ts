import { Hono } from "hono";
import { canonicalJson, requireIdempotencyKey, SCHEMA_VERSION } from "@patternlike/shared";
import type { Env } from "../env.js";
import { safeLog } from "../services/safe-log.js";
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
  parseReleaseKeyConfiguration,
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
const MAX_INGESTION_BODY_BYTES = 8 * 1024 * 1024;

type JsonBodyResult =
  | { value: unknown }
  | { error: "invalid_json" | "request_too_large" };

async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_INGESTION_BODY_BYTES) {
      return { error: "request_too_large" };
    }
  }

  if (!request.body) return { error: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_INGESTION_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size decision is already final; cancellation is best effort.
        }
        return { error: "request_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "invalid_json" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
      ),
    };
  } catch {
    return { error: "invalid_json" };
  }
}

function objectKey(version: string): string {
  return `content-releases/${version}.json`;
}

function isReleaseIdentityConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: content_releases\.(?:version|bundle_hash)/.test(error.message)
  );
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
    status: 400 | 409 | 413 | 503,
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
    return refuse(
      {
        class: "idempotency_key_required",
        message: "Idempotency-Key header is required (8..256 characters)",
      },
      400,
    );
  }

  const jsonBody = await readJsonBody(c.req.raw);
  if ("error" in jsonBody && jsonBody.error === "request_too_large") {
    return refuse(
      {
        class: "request_too_large",
        message: "Request body must not exceed 8 MiB",
      },
      413,
    );
  }
  if ("error" in jsonBody) {
    return refuse(
      { class: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }
  const raw = jsonBody.value;

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
      { version },
    );
  }

  const parsedKeys = parseReleaseKeyConfiguration(c.env.CONTENT_RELEASE_KEYS);
  if (parsedKeys.malformed || parsedKeys.invalidKeyIds.length > 0) {
    safeLog({ event: "content_release_keys_misconfigured" });
    return refuse(
      {
        class: "release_keys_misconfigured",
        message: "CONTENT_RELEASE_KEYS contains an invalid signing-key entry",
      },
      503,
    );
  }
  const keys = parsedKeys.keys;
  if (keys.size === 0) {
    // Fails closed everywhere, development included. A branch that skipped
    // verification locally would mean the one path that must never be wrong is
    // the one path never exercised before production.
    return refuse(
      {
        class: "release_keys_not_configured",
        message: "CONTENT_RELEASE_KEYS is not configured; cannot verify release signatures",
      },
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
      { version },
    );
  }

  const signatureError = await verifyBundleSignature(bundle, keys);
  if (signatureError) return refuse(signatureError, 400, { version });

  // --- Smoke tests on the verified content graph. ---

  const graphError = validateContentGraph(bundle);
  if (graphError) return refuse(graphError, 400, { version, keyId });

  const objectHashError = await verifyObjectHashes(bundle);
  if (objectHashError) return refuse(objectHashError, 400, { version, keyId });

  // --- Immutability and replay. ---

  const activate = request.activate ?? true;
  const unevaluated = pendingFixtureIds(bundle);
  const holdForFixtures = activate && unevaluated.length > 0;
  const existingByVersion = await findReleaseByVersion(c.env, version);

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
  const response = (
    status: IngestionResponse["status"],
    r2Uri: string | null,
    pointer: string | null,
  ): IngestionResponse => ({
    schema_version: SCHEMA_VERSION,
    release_version: version,
    bundle_hash: computedHash,
    status,
    r2_uri: r2Uri,
    active_pointer: pointer,
    rejection_reason_class: null,
    received_at: receivedAt,
  });

  // A re-POST of bytes already stored and already live is the retry it looks
  // like. Re-running activation would rewrite the pointer to where it already
  // points and emit a second activation audit row for an event that did not
  // happen twice. A fixture-bearing release is similarly a retry until this
  // milestone can evaluate the declared fixture ids; attempting to store it a
  // second time would only trip the immutable D1 identity constraint.
  if (existingByVersion && (!activate || activePointer === version || holdForFixtures)) {
    return c.json(
      response(RESPONSE_STATUS.duplicate, existingByVersion.r2_uri, activePointer),
      202,
    );
  }

  // --- Store the immutable artifact, then move the pointer. ---

  if (!c.env.ARTIFACTS) {
    return refuse(
      {
        class: "object_storage_not_configured",
        message: "ARTIFACTS R2 bucket is not bound; cannot store the release bundle",
      },
      503,
      { version, keyId },
    );
  }

  const key = objectKey(version);
  const r2Uri = `r2://${R2_BUCKET_LABEL}/${key}`;
  // Canonical form, not the caller's bytes: the stored artifact is what a later
  // reader re-verifies, and it must hash to `bundle_hash` under the same
  // canonicalisation this Worker used rather than under the sender's
  // whitespace and key order.
  const serializedBundle = canonicalJson(bundle);
  const stored = await c.env.ARTIFACTS.put(key, serializedBundle, {
    // R2 is the first durable reservation of a release version. A conditional
    // create prevents two verified requests from overwriting each other's
    // immutable artifact between the D1 preflight and its transaction.
    onlyIf: new Headers({ "if-none-match": "*" }),
    httpMetadata: { contentType: "application/json" },
    customMetadata: { release_version: version, bundle_hash: computedHash },
  });
  if (!stored) {
    const existingArtifact = await c.env.ARTIFACTS.get(key);
    const matchesExisting =
      existingArtifact &&
      "body" in existingArtifact &&
      existingArtifact.customMetadata?.release_version === version &&
      hashesEqual(existingArtifact.customMetadata?.bundle_hash ?? "", computedHash) &&
      (await existingArtifact.text()) === serializedBundle;
    if (!matchesExisting) {
      return refuse(
        {
          class: "release_version_immutable",
          message: `Release ${version} was already reserved with different content`,
        },
        409,
        { version, keyId },
      );
    }
  }

  const record: ReleaseRecord = {
    version,
    bundleHash: computedHash,
    r2Uri,
    approverId: bundle.release.approver_id,
    lastAuthorId: bundle.release.last_author_id,
    changelog: bundle.release.changelog,
    calcContractId: bundle.release.calc_contract_id ?? null,
  };

  const activateAndRespond = async (
    alreadyStored: boolean,
    fallbackR2Uri: string | null,
  ) => {
    const transitioned = await activateRelease(
      c.env,
      record,
      {
        action: "content_release.activate",
        resourceId: version,
        result: "success",
        // Stored-release transitions derive this from the target's status in
        // D1, not this preflight snapshot, so a concurrent transition cannot
        // turn a real rollback into a falsely labelled activation.
        detailClass: "activate",
        actorId: keyId,
      },
      alreadyStored,
    );
    if (!transitioned) {
      const settledRelease = await findReleaseByVersion(c.env, version);
      const settledPointer = await getActiveVersion(c.env);
      return c.json(
        response(
          RESPONSE_STATUS.duplicate,
          settledRelease?.r2_uri ?? fallbackR2Uri,
          settledPointer,
        ),
        202,
      );
    }
    return c.json(response(RESPONSE_STATUS.active, r2Uri, version), 202);
  };

  try {
    if (!activate || holdForFixtures) {
      if (holdForFixtures) {
        // The response envelope has no field for this and `detail_class` is an
        // opaque class, so without a log the only trace of *which* tests were
        // skipped is the bundle itself. Ids, never content.
        safeLog({
          event: "content_release_held_for_fixtures",
          release_version: version,
          fixture_count: unevaluated.length,
        });
      }
      await storeRelease(c.env, record, {
        action: "content_release.store",
        resourceId: version,
        result: "success",
        detailClass: holdForFixtures ? "fixtures_unevaluated" : "activate_false",
        actorId: keyId,
      });
      return c.json(response(RESPONSE_STATUS.pending, r2Uri, activePointer), 202);
    }

    return await activateAndRespond(existingByVersion !== null, r2Uri);
  } catch (error) {
    if (!isReleaseIdentityConstraint(error)) throw error;

    // R2 conditionally reserved this version before D1. If another identical
    // request won the database race, surface the durable state rather than a
    // transient 500. A differing version or hash remains a refused conflict.
    const winnerByVersion = await findReleaseByVersion(c.env, version);
    if (winnerByVersion && hashesEqual(winnerByVersion.bundle_hash, computedHash)) {
      const winnerPointer = await getActiveVersion(c.env);
      if (!activate || holdForFixtures || winnerPointer === version) {
        return c.json(
          response(RESPONSE_STATUS.duplicate, winnerByVersion.r2_uri, winnerPointer),
          202,
        );
      }

      return activateAndRespond(true, winnerByVersion.r2_uri);
    }

    if (winnerByVersion) {
      return refuse(
        {
          class: "release_version_immutable",
          message: `Release ${version} was already ingested with different content`,
        },
        409,
        { version, keyId },
      );
    }

    const winnerByHash = await findReleaseByBundleHash(c.env, computedHash);
    if (winnerByHash) {
      return refuse(
        {
          class: "bundle_hash_conflict",
          message: `These bytes were already ingested as release ${winnerByHash.version}`,
        },
        409,
        { version, keyId },
      );
    }
    throw error;
  }
});
