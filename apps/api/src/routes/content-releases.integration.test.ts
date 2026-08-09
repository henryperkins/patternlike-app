import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { resetDb, rows, seedUser, IDENTITY_A, USER_A } from "../../test/helpers.js";
import {
  generateSigningKey,
  ingestionBody,
  releaseKeysVar,
  resealWithoutSigning,
  signedBundle,
  withoutFixtures,
  type ReleaseSigningKey,
} from "../../test/content-release-fixtures.js";
import type { ContentReleaseBundle } from "../services/content-release.js";

const PATH = "http://api.test/internal/content-releases";
const IDEMPOTENCY_KEY = "release-ingest-key-0001";

interface IngestionResponse {
  release_version: string;
  bundle_hash: string;
  status: string;
  r2_uri: string | null;
  active_pointer: string | null;
  rejection_reason_class: string | null;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string | null;
    details?: { rejection_reason_class?: string };
  };
}

async function ingest(
  body: unknown,
  init: { idempotencyKey?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: IngestionResponse & ErrorEnvelope }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers ?? {}),
  };
  // The header mirrors the body's key unless a case is deliberately setting
  // them against each other, which is what the mismatch test does.
  const bodyKey =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).idempotency_key
      : undefined;
  const key =
    init.idempotencyKey === undefined
      ? typeof bodyKey === "string"
        ? bodyKey
        : IDEMPOTENCY_KEY
      : init.idempotencyKey;
  if (key !== null) headers["idempotency-key"] = key;

  const res = await SELF.fetch(PATH, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as IngestionResponse & ErrorEnvelope,
  };
}

function bucket(): R2Bucket {
  if (!env.ARTIFACTS) throw new Error("ARTIFACTS R2 binding is not bound in tests");
  return env.ARTIFACTS;
}

async function clearArtifacts(): Promise<void> {
  const listed = await bucket().list({ prefix: "content-releases/" });
  await Promise.all(listed.objects.map((object) => bucket().delete(object.key)));
}

interface ReleaseRow {
  version: string;
  bundle_hash: string;
  status: string;
  r2_uri: string | null;
  activated_at: string | null;
}

const releaseRows = () =>
  rows<ReleaseRow>(
    `SELECT version, bundle_hash, status, r2_uri, activated_at
     FROM content_releases ORDER BY version`,
  );

const pointer = () =>
  rows<{ active_version: string }>(`SELECT active_version FROM content_release_pointer`);

const auditRows = () =>
  rows<{ action: string; result: string; detail_class: string | null; resource_id: string | null; actor_id: string | null }>(
    `SELECT action, result, detail_class, resource_id, actor_id
     FROM audit_events WHERE resource_type = 'content_release' ORDER BY created_at, id`,
  );

let key: ReleaseSigningKey;
const originalKeys = env.CONTENT_RELEASE_KEYS;

beforeAll(async () => {
  key = await generateSigningKey("wp-release-key-1");
});

beforeEach(async () => {
  await resetDb();
  await clearArtifacts();
  env.CONTENT_RELEASE_KEYS = releaseKeysVar([key]);
});

afterEach(() => {
  env.CONTENT_RELEASE_KEYS = originalKeys;
});

/** The frozen fixture declares smoke-test fixtures; most cases want a bundle without them. */
const activatable = (mutate: (bundle: ContentReleaseBundle) => void = () => {}) =>
  signedBundle(key, (bundle) => {
    withoutFixtures(bundle);
    mutate(bundle);
  });

describe("POST /internal/content-releases — activation", () => {
  it("verifies, stores, and atomically activates a signed bundle", async () => {
    const bundle = await activatable();
    const { status, body } = await ingest(ingestionBody(bundle));

    expect(status).toBe(202);
    expect(body.status).toBe("active");
    expect(body.release_version).toBe("release-12");
    expect(body.bundle_hash).toBe(bundle.release.bundle_hash);
    expect(body.active_pointer).toBe("release-12");
    expect(body.rejection_reason_class).toBeNull();

    expect(await releaseRows()).toEqual([
      expect.objectContaining({
        version: "release-12",
        status: "active",
        r2_uri: "r2://artifacts/content-releases/release-12.json",
        activated_at: expect.any(String),
      }),
    ]);
    expect(await pointer()).toEqual([{ active_version: "release-12" }]);
  });

  it("stores the immutable bundle in R2 under its version", async () => {
    const bundle = await activatable();
    await ingest(ingestionBody(bundle));

    const object = await bucket().get("content-releases/release-12.json");
    expect(object).not.toBeNull();
    expect(object!.customMetadata).toMatchObject({
      release_version: "release-12",
      bundle_hash: bundle.release.bundle_hash,
    });

    // Canonical form, so the stored artifact re-hashes to bundle_hash under the
    // same canonicalisation the Worker verified it with.
    const stored = JSON.parse(await object!.text()) as ContentReleaseBundle;
    expect(stored.signature).toEqual(bundle.signature);
    expect(stored.objects.phases[0]!.id).toBe(bundle.objects.phases[0]!.id);
  });

  it("writes one audit row inside the activating transaction", async () => {
    await ingest(ingestionBody(await activatable()));

    expect(await auditRows()).toEqual([
      {
        action: "content_release.activate",
        result: "success",
        detail_class: "activate",
        resource_id: "release-12",
        actor_id: "wp-release-key-1",
      },
    ]);
  });

  it("supersedes the previously active release when a new one activates", async () => {
    await ingest(ingestionBody(await activatable()));
    await ingest(
      ingestionBody(
        await activatable((bundle) => {
          bundle.release.version = "release-13";
        }),
        { idempotencyKey: "release-ingest-key-0002" },
      ),
    );

    expect(await releaseRows()).toEqual([
      expect.objectContaining({ version: "release-12", status: "superseded" }),
      expect.objectContaining({ version: "release-13", status: "active" }),
    ]);
    expect(await pointer()).toEqual([{ active_version: "release-13" }]);
  });

  /**
   * Spec v0.2: "Rollback changes the active release pointer; it does not
   * require editing previously published readings." Re-posting a bundle that is
   * already stored moves the pointer back to it, so rollback needs no surface
   * of its own — and the audit row says which of the two it was.
   */
  it("rolls back by re-posting a superseded bundle", async () => {
    const first = await activatable();
    await ingest(ingestionBody(first));
    await ingest(
      ingestionBody(
        await activatable((bundle) => {
          bundle.release.version = "release-13";
        }),
        { idempotencyKey: "release-ingest-key-0002" },
      ),
    );

    const { status, body } = await ingest(
      ingestionBody(first, { idempotencyKey: "release-ingest-key-0003" }),
    );

    expect(status).toBe(202);
    expect(body.status).toBe("active");
    expect(body.active_pointer).toBe("release-12");
    expect(await pointer()).toEqual([{ active_version: "release-12" }]);
    expect(await releaseRows()).toEqual([
      expect.objectContaining({ version: "release-12", status: "active" }),
      expect.objectContaining({ version: "release-13", status: "superseded" }),
    ]);
    expect((await auditRows()).at(-1)).toMatchObject({
      action: "content_release.activate",
      detail_class: "rollback",
    });
  });
});

describe("POST /internal/content-releases — storing without activating", () => {
  it("stores but does not activate when activate is false", async () => {
    const { status, body } = await ingest(
      ingestionBody(await activatable(), { activate: false }),
    );

    expect(status).toBe(202);
    expect(body.status).toBe("accepted_pending_tests");
    expect(body.active_pointer).toBeNull();
    expect(await releaseRows()).toEqual([
      expect.objectContaining({ version: "release-12", status: "submitted", activated_at: null }),
    ]);
    expect(await pointer()).toEqual([]);
  });

  /**
   * The spec activates *after* smoke tests. A bundle that declares eligibility
   * fixtures needs the M3 assembly engine to evaluate them, so activating it
   * would claim a test result nobody produced.
   */
  it("holds a fixture-bearing bundle inactive even when activation was requested", async () => {
    const { status, body } = await ingest(ingestionBody(await signedBundle(key)));

    expect(status).toBe(202);
    expect(body.status).toBe("accepted_pending_tests");
    expect(await pointer()).toEqual([]);
    expect((await auditRows()).at(-1)).toMatchObject({
      action: "content_release.store",
      detail_class: "fixtures_unevaluated",
    });
  });
});

describe("POST /internal/content-releases — replay and immutability", () => {
  it("answers a replay of an active release with duplicate, without re-activating", async () => {
    const bundle = await activatable();
    await ingest(ingestionBody(bundle));
    const { status, body } = await ingest(ingestionBody(bundle));

    expect(status).toBe(202);
    expect(body.status).toBe("duplicate");
    expect(body.active_pointer).toBe("release-12");
    expect(await releaseRows()).toHaveLength(1);
    // One activation happened, so there is one activation row.
    expect(await auditRows()).toHaveLength(1);
  });

  it("refuses a second bundle claiming a version already ingested", async () => {
    await ingest(ingestionBody(await activatable()));

    const { status, body } = await ingest(
      ingestionBody(
        await activatable((bundle) => {
          bundle.release.changelog = "Rewritten under the same version.";
        }),
      ),
    );

    expect(status).toBe(409);
    expect(body.error.code).toBe("release_version_immutable");
    expect(await releaseRows()).toHaveLength(1);
    expect(await pointer()).toEqual([{ active_version: "release-12" }]);
  });

  /**
   * `bundle_hash` is UNIQUE in D1. `release.version` travels inside the signed
   * payload, so today two versions cannot share a hash — this guard exists so
   * that a change to the canonicalisation surfaces as a 409 rather than as a
   * constraint violation escaping to a 500. Seeding the row is the only way to
   * reach it.
   */
  it("refuses bytes already recorded under another version", async () => {
    const bundle = await activatable();
    await env.DB.prepare(
      `INSERT INTO content_releases
         (version, bundle_hash, status, approver_id, last_author_id, changelog, created_at)
       VALUES ('release-preexisting', ?, 'active', 'wp_reviewer', 'wp_author', 'seeded', ?)`,
    )
      .bind(bundle.release.bundle_hash, new Date().toISOString())
      .run();

    const { status, body } = await ingest(ingestionBody(bundle));

    expect(status).toBe(409);
    expect(body.error.code).toBe("bundle_hash_conflict");
  });
});

describe("POST /internal/content-releases — refusals", () => {
  it("requires an Idempotency-Key header", async () => {
    const { status, body } = await ingest(ingestionBody(await activatable()), {
      idempotencyKey: null,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("idempotency_key_required");
  });

  it("refuses a header and body idempotency key that disagree", async () => {
    const { status, body } = await ingest(
      ingestionBody(await activatable(), { idempotencyKey: "body-key-000000001" }),
      { idempotencyKey: "header-key-00000001" },
    );

    expect(status).toBe(400);
    expect(body.error.code).toBe("idempotency_key_mismatch");
  });

  it("refuses a body that is not JSON", async () => {
    const { status, body } = await ingest("{not json");

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_json");
  });

  it.each([
    [
      "a body edited after signing",
      async () => {
        const bundle = await activatable();
        bundle.objects.phases[0]!.shadow_expression = "Injected copy.";
        return bundle;
      },
      "bundle_hash_mismatch",
    ],
    [
      // The CMS-compromise case from the spec's threat model: every hash the
      // bundle asserts about itself is recomputed and correct, so only the
      // signature is left to catch it.
      "content re-hashed by someone without the signing key",
      async () => {
        const bundle = await activatable();
        bundle.objects.phases[0]!.shadow_expression = "Injected copy.";
        return resealWithoutSigning(bundle);
      },
      "signature_invalid",
    ],
    [
      "a bundle_hash that does not match the body",
      async () => {
        const bundle = await activatable();
        bundle.release.bundle_hash = `sha256:${"b".repeat(64)}`;
        return bundle;
      },
      "bundle_hash_mismatch",
    ],
    [
      "a signature from an unconfigured key_id",
      async () => {
        const bundle = await activatable();
        bundle.signature.key_id = "wp-release-key-unknown";
        return bundle;
      },
      "signature_key_unknown",
    ],
  ])("refuses %s", async (_label, build, expected) => {
    const { status, body } = await ingest(ingestionBody(await build()));

    expect(status).toBe(400);
    expect(body.error.code).toBe(expected);
    expect(await releaseRows()).toEqual([]);
    expect(await bucket().list({ prefix: "content-releases/" })).toMatchObject({
      objects: [],
    });
  });

  /**
   * Dual control is enforced on verified bytes: the bundle is properly signed
   * and only then refused, which is what proves the check is the editorial
   * policy rather than the signature failing for an unrelated reason.
   */
  it("refuses a validly signed bundle that one person authored and approved", async () => {
    const bundle = await activatable((draft) => {
      draft.release.approver_id = draft.release.last_author_id;
    });

    const { status, body } = await ingest(ingestionBody(bundle));

    expect(status).toBe(400);
    expect(body.error.code).toBe("dual_control_violation");
    expect(body.error.details?.rejection_reason_class).toBe("dual_control_violation");
    expect(await releaseRows()).toEqual([]);
  });

  it("records a refusal in the audit log with an opaque class", async () => {
    await ingest(
      ingestionBody(
        await activatable((bundle) => {
          bundle.objects.phases[0]!.parent_cycle_id = "cycle.does.not.exist";
        }),
      ),
    );

    expect(await auditRows()).toEqual([
      {
        action: "content_release.ingest",
        result: "denied",
        detail_class: "orphan_phase",
        resource_id: "release-12",
        actor_id: "wp-release-key-1",
      },
    ]);
  });

  /**
   * No signing keys means no way to tell an editorial bundle from anyone
   * else's. There is deliberately no development bypass: a branch that skipped
   * verification locally would leave the one path that must never be wrong as
   * the one path never exercised before production.
   */
  it("fails closed when no release signing keys are configured", async () => {
    env.CONTENT_RELEASE_KEYS = "";

    const { status, body } = await ingest(ingestionBody(await activatable()));

    expect(status).toBe(503);
    expect(body.error.code).toBe("release_keys_not_configured");
  });

  it("carries a request id on every refusal", async () => {
    const { body } = await ingest(ingestionBody(await activatable()), {
      headers: { "x-request-id": "req-release-correlation-1" },
      idempotencyKey: null,
    });

    expect(body.error.request_id).toBe("req-release-correlation-1");
  });
});

/**
 * A router mounted at "/" contributes its `use("*", ...)` middleware to every
 * path in the parent. That defect once made the service token gate the whole
 * consumer API, so the prefix is worth asserting rather than assuming.
 */
describe("internal mount isolation", () => {
  it("is not reachable without the /internal prefix", async () => {
    await seedUser(IDENTITY_A);

    const res = await SELF.fetch("http://api.test/content-releases", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": USER_A },
      body: "{}",
    });

    // Authenticated as an ordinary user and still not found: the ingestion
    // route exists only under /internal.
    expect(res.status).toBe(404);
  });
});
