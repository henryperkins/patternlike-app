/**
 * Two independent release coordinates: the source SHA supplied by the release
 * command and the version id supplied by Cloudflare's version_metadata binding.
 * Shape checks validate these values; they do not independently verify that an
 * operator supplied the correct source SHA or that a live upload is serving it.
 */

import type { Env } from "../env.js";
import { isDevEnvironment } from "../crypto.js";

/**
 * The reserved all-zero development placeholder. Production refuses it.
 */
export const DEVELOPMENT_RELEASE_GIT_SHA = "0".repeat(40);

const GIT_SHA = /^[0-9a-f]{40}$/;
const WORKER_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReleaseAttestation {
  /** The exact commit the deployed bundle was built from. */
  releaseGitSha: string;
  /** The Cloudflare Worker version serving this invocation. */
  workerVersionId: string;
}

export type ReleaseAttestationFailure = {
  ok: false;
  code: "release_attestation_missing";
  message: string;
};

const MISSING: ReleaseAttestationFailure = {
  ok: false,
  code: "release_attestation_missing",
  message:
    "RELEASE_GIT_SHA must name the exact commit this Worker was built from",
};

/**
 * Configuration-time check: is the deployed source identifiable at all?
 *
 * Three rules, and which environment it is only changes one of them:
 *
 *   present and not a commit hash  refused everywhere. A value that is present
 *                                  and wrong is a claim, not an omission, and a
 *                                  local run would otherwise fail later and
 *                                  more obscurely — the receipt column refuses
 *                                  the same shape, mid-publication.
 *   absent                         refused outside development only. A unit
 *                                  caller exercising an unrelated rule need not
 *                                  carry a release identity; a deployment must.
 *   the committed placeholder      refused outside development only. That is
 *                                  the reason the placeholder is reserved.
 *
 * `checkSecureConfig` calls this twice, presence-gated, for the same reason it
 * calls the birth operational check twice: the shape rule belongs before the
 * development short-circuit and the presence rule belongs after it, beside
 * ROOT_KEK and identity.
 */
export function checkReleaseAttestation(
  env: Partial<Env>,
): ReleaseAttestationFailure | null {
  const sha = env.RELEASE_GIT_SHA?.trim() ?? "";
  if (sha === "") {
    return isDevEnvironment(env.ENVIRONMENT) ? null : MISSING;
  }
  if (!GIT_SHA.test(sha)) return MISSING;
  if (
    sha === DEVELOPMENT_RELEASE_GIT_SHA &&
    !isDevEnvironment(env.ENVIRONMENT)
  ) {
    return MISSING;
  }
  return null;
}

/**
 * The deployed commit, or null when nothing well-formed is deployed.
 *
 * Reported independently of the Worker version by /v1/meta so the release
 * script can say WHICH half of the attestation is missing. A value that is
 * present but not a commit hash reads as null rather than being echoed: an
 * unauthenticated endpoint should not repeat arbitrary configuration text back
 * to a caller.
 */
export function readReleaseGitSha(env: Partial<Env>): string | null {
  const sha = env.RELEASE_GIT_SHA?.trim() ?? "";
  return GIT_SHA.test(sha) ? sha : null;
}

/** The Cloudflare-assigned version id, or null when the binding is absent. */
export function readWorkerVersionId(env: Partial<Env>): string | null {
  const id = env.CF_VERSION_METADATA?.id?.trim() ?? "";
  return WORKER_VERSION_ID.test(id) ? id : null;
}

/**
 * Both halves, or nothing.
 *
 * Returns null rather than a partial attestation: a receipt naming a release
 * but no Worker version, or a version but no release, would answer half the
 * question while looking like it answered all of it. Publication treats null as
 * a refusal, which is the intended failure — a reading published under an
 * unidentifiable release is precisely what this exists to prevent.
 */
export function resolveReleaseAttestation(
  env: Partial<Env>,
): ReleaseAttestation | null {
  if (checkReleaseAttestation(env)) return null;
  const releaseGitSha = readReleaseGitSha(env);
  const workerVersionId = readWorkerVersionId(env);
  if (!releaseGitSha || !workerVersionId) return null;
  return { releaseGitSha, workerVersionId };
}
