import { createExecutionContext, createMessageBatch, createScheduledController, env, getQueueResult } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker, { app } from "../index.js";
import { DEVELOPMENT_RELEASE_GIT_SHA } from "../services/release-attestation.js";

/**
 * `/v1/meta` is what release verification asks after an upload.
 *
 * Two properties matter and both are load-bearing. It reports the commit the
 * deployment was actually built from, so a release can be checked rather than
 * asserted. And it answers without configGuard, so a deployment that shipped
 * WITHOUT an attestation — the case the check exists to catch — can still say so
 * instead of returning the same opaque 503 as every other path.
 */

interface Meta {
  schema_version: string;
  release_git_sha: string | null;
  worker_version_id: string | null;
  auth_stub: boolean;
}

async function meta(requestEnv: typeof env): Promise<{ status: number; body: Meta }> {
  const response = await app.request("/v1/meta", {}, requestEnv);
  return { status: response.status, body: (await response.json()) as Meta };
}

describe("GET /v1/meta", () => {
  it("reports the deployed commit and Worker version", async () => {
    const { status, body } = await meta(env);
    expect(status).toBe(200);
    expect(body.release_git_sha).toBe(DEVELOPMENT_RELEASE_GIT_SHA);
    expect(body.worker_version_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reports null rather than echoing a value that is not a commit", async () => {
    const { body } = await meta({
      ...env,
      RELEASE_GIT_SHA: "not-a-commit",
    } as typeof env);
    // Absent and malformed are one visible failure to the caller doing the
    // verifying, and neither repeats unvalidated configuration text back.
    expect(body.release_git_sha).toBeNull();
  });

  it("still answers when the configuration guard is refusing everything else", async () => {
    // A production deployment with no release identity: every guarded path is
    // 503, and this one has to keep working or the failure is undiagnosable.
    const unattested = {
      ...env,
      ENVIRONMENT: "production",
      AUTH_STUB: "0",
      RELEASE_GIT_SHA: "",
    } as typeof env;

    const guarded = await app.request(
      "/v1/sessions",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      unattested,
    );
    expect(guarded.status).toBe(503);
    expect((await guarded.json() as { error: { code: string } }).error.code)
      .toBe("configuration_error");

    const { status, body } = await meta(unattested);
    expect(status).toBe(200);
    expect(body.release_git_sha).toBeNull();
  });
});

describe("release guard across entry points", () => {
  it.each([undefined, "", DEVELOPMENT_RELEASE_GIT_SHA, "HEAD"])("rejects production SHA %s on HTTP, queue and scheduled paths", async (sha) => {
    const values = {
      ...env, ENVIRONMENT: "production", AUTH_STUB: "0",
      ROOT_KEK: "a-real-root-kek-with-enough-entropy-32+",
      OIDC_ISSUER: "https://issuer.example.com", OIDC_AUDIENCE: "patternlike-web",
      OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
      RELEASE_GIT_SHA: sha,
    } as typeof env;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = vi.spyOn(env.DB, "prepare");
    try {
      expect((await app.request("/v1/sessions", { method: "POST" }, values)).status).toBe(503);
      const batch = createMessageBatch("patternlike-daily-readings-dev", [{
        id: "attestation-message", timestamp: new Date(), attempts: 1,
        body: { job_id: "job_no_work", reading_id: "rdg_no_work" },
      }]);
      const ctx = createExecutionContext();
      await worker.queue(batch, values);
      expect((await getQueueResult(batch, ctx)).retryBatch.retry).toBe(true);
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "* * * * *" }), values, createExecutionContext());
      expect(log).toHaveBeenCalledWith("insecure_configuration", expect.objectContaining({ config_code: "release_attestation_missing" }));
      expect(db).not.toHaveBeenCalled();
      const result = await meta(values);
      expect(result.status).toBe(200);
      expect(result.body.worker_version_id).toBe(env.CF_VERSION_METADATA.id);
    } finally {
      log.mockRestore(); db.mockRestore();
    }
  });

  it("reports a valid release independently when Worker metadata is malformed", async () => {
    const result = await meta({ ...env, RELEASE_GIT_SHA: "a".repeat(40),
      CF_VERSION_METADATA: { ...env.CF_VERSION_METADATA, id: "malformed" } });
    expect(result).toMatchObject({ status: 200, body: { release_git_sha: "a".repeat(40), worker_version_id: null } });
  });
});
