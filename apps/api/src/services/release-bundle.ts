import type { VerifiedBundle } from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { findReleaseByVersion } from "../db/content-releases.js";
import {
  computeBundleHash,
  hashesEqual,
  type ContentReleaseBundle,
} from "./content-release.js";

/**
 * Load the exact release version a command pinned, and prove it is the one that
 * was ingested.
 *
 * Three values must agree: the recomputed hash of the stored bytes, the hash the
 * command froze, and the trusted D1 record. Any disagreement fails the job
 * closed rather than substituting whatever is currently active — a frozen
 * command that silently assembled from different editorial copy would publish
 * prose nobody approved for that reading.
 */
export type ReleaseLoad =
  | { ok: true; bundle: ContentReleaseBundle; verified: VerifiedBundle }
  | { ok: false; reason: ReleaseLoadFailure; detail: string };

export type ReleaseLoadFailure =
  /** R2 unreachable or the object missing — infrastructural, so re-freezable. */
  | "release_unreadable"
  /** The bytes are there and they are not the bytes that were approved. */
  | "release_hash_mismatch";

/** Mirrors routes/content-releases.ts. Kept in step by the round-trip test. */
export function releaseObjectKey(version: string): string {
  return `content-releases/${version}.json`;
}

/**
 * Project an ingested bundle into the engine's input shape.
 *
 * The cast is safe because ingestion validated every object against
 * `contracts/m3/content-release.schema.json` before the bytes reached R2, and
 * the hash check above proves these are those bytes. Re-validating here would
 * be a second copy of the contract that could disagree with the first.
 */
export function toVerifiedBundle(bundle: ContentReleaseBundle): VerifiedBundle {
  const release: VerifiedBundle["release"] = {
    version: bundle.release.version,
    bundle_hash: bundle.release.bundle_hash,
    supported_locales: bundle.release.supported_locales,
    locale_default: bundle.release.locale_default,
  };
  if (bundle.release.language_fallbacks) {
    release.language_fallbacks = bundle.release.language_fallbacks;
  }
  return {
    release,
    objects: {
      cycles: bundle.objects.cycles as unknown as VerifiedBundle["objects"]["cycles"],
      phases: bundle.objects.phases as unknown as VerifiedBundle["objects"]["phases"],
      prompts: bundle.objects.prompts as unknown as VerifiedBundle["objects"]["prompts"],
      modifiers: bundle.objects.modifiers as unknown as VerifiedBundle["objects"]["modifiers"],
      timing_templates:
        bundle.objects.timing_templates as unknown as VerifiedBundle["objects"]["timing_templates"],
      daily_fallbacks:
        bundle.objects.daily_fallbacks as unknown as VerifiedBundle["objects"]["daily_fallbacks"],
    },
  };
}

/**
 * @param expectedBundleHash the hash frozen in the command, or null at enqueue
 *   where the D1 record is the only authority that exists yet.
 */
export async function loadReleaseBundle(
  env: Env,
  version: string,
  expectedBundleHash: string | null,
): Promise<ReleaseLoad> {
  if (!env.ARTIFACTS) {
    return { ok: false, reason: "release_unreadable", detail: "ARTIFACTS bucket is not bound" };
  }

  const record = await findReleaseByVersion(env, version);
  if (!record) {
    return {
      ok: false,
      reason: "release_unreadable",
      detail: `release ${version} has no D1 record`,
    };
  }

  let text: string;
  try {
    const object = await env.ARTIFACTS.get(releaseObjectKey(version));
    if (!object) {
      return {
        ok: false,
        reason: "release_unreadable",
        detail: `release ${version} is not in object storage`,
      };
    }
    text = await object.text();
  } catch (err) {
    return {
      ok: false,
      reason: "release_unreadable",
      detail: err instanceof Error ? err.message : "release read failed",
    };
  }

  let bundle: ContentReleaseBundle;
  try {
    bundle = JSON.parse(text) as ContentReleaseBundle;
  } catch {
    return {
      ok: false,
      reason: "release_hash_mismatch",
      detail: `release ${version} object is not valid JSON`,
    };
  }

  // The M0 release-hash procedure (the repository's legacy canonicalJson), NOT
  // JCS. M3 pins JCS only for the new patternlike.*-id.v1 profiles;
  // reinterpreting M0's byte-frozen hashes as JCS would invalidate every stored
  // bundle.
  const computed = await computeBundleHash(bundle);
  if (!hashesEqual(computed, record.bundle_hash)) {
    return {
      ok: false,
      reason: "release_hash_mismatch",
      detail: `release ${version} object does not hash to its D1 record`,
    };
  }
  if (expectedBundleHash !== null && !hashesEqual(computed, expectedBundleHash)) {
    return {
      ok: false,
      reason: "release_hash_mismatch",
      detail: `release ${version} object does not hash to the value the command froze`,
    };
  }

  return { ok: true, bundle, verified: toVerifiedBundle(bundle) };
}
