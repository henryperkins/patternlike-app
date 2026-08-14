import type { VerifiedBundle } from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { findReleaseByVersion } from "../db/content-releases.js";
import {
  computeBundleHash,
  hashesEqual,
  validateIngestionRequest,
  type ContentObject,
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
 * Stored bytes are validated again through the explicit M3/M4 dispatcher
 * before projection. This is cheap compared with the R2 read and prevents a
 * cast from silently treating an unregistered future shape as Today content.
 */
export function toVerifiedBundle(bundle: ContentReleaseBundle): VerifiedBundle {
  const validated = validateIngestionRequest({
    schema_version: bundle.schema_version,
    bundle,
    idempotency_key: "stored-release-validation",
    activate: false,
  });
  if ("error" in validated) {
    throw new Error(`stored release bundle is invalid: ${validated.error.class}`);
  }

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
      cycles: bundle.objects.cycles.map(projectCycle),
      phases: bundle.objects.phases.map(projectPhase),
      prompts: bundle.objects.prompts.map(projectPrompt),
      modifiers: bundle.objects.modifiers.map(projectModifier),
      timing_templates: bundle.objects.timing_templates.map(projectTimingTemplate),
      daily_fallbacks: bundle.objects.daily_fallbacks.map(projectFallback),
    },
  };
}

function requiredString(object: ContentObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw new Error(`stored release ${object.id}.${key} invalid`);
  return value;
}

function requiredStrings(object: ContentObject, key: string): string[] {
  const value = object[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`stored release ${object.id}.${key} invalid`);
  }
  return value;
}

function commonOptional<T extends { eligibility?: unknown; status?: unknown }>(
  object: ContentObject,
): Partial<T> {
  const optional: Partial<T> = {};
  if (object.eligibility !== undefined) {
    optional.eligibility = object.eligibility as T["eligibility"];
  }
  if (object.status !== undefined) optional.status = object.status as T["status"];
  return optional;
}

type EngineCycle = VerifiedBundle["objects"]["cycles"][number];
function projectCycle(object: ContentObject): EngineCycle {
  return {
    id: object.id,
    content_type: "astrology_cycle",
    content_version: object.content_version,
    locale: object.locale,
    technique: requiredString(object, "technique"),
    bodies: requiredStrings(object, "bodies"),
    targets: requiredStrings(object, "targets"),
    aspect: object.aspect as EngineCycle["aspect"],
    phase_ids: requiredStrings(object, "phase_ids"),
    ...commonOptional<EngineCycle>(object),
  };
}

type EnginePhase = VerifiedBundle["objects"]["phases"][number];
function projectPhase(object: ContentObject): EnginePhase {
  return {
    id: object.id,
    content_type: "astrology_phase",
    content_version: object.content_version,
    locale: object.locale,
    parent_cycle_id: requiredString(object, "parent_cycle_id"),
    phase: object.phase as EnginePhase["phase"],
    summary: requiredString(object, "summary"),
    constructive_expression: requiredString(object, "constructive_expression"),
    shadow_expression: requiredString(object, "shadow_expression"),
    ...commonOptional<EnginePhase>(object),
  };
}

type EnginePrompt = VerifiedBundle["objects"]["prompts"][number];
function projectPrompt(object: ContentObject): EnginePrompt {
  return {
    id: object.id,
    content_type: "astrology_prompt",
    content_version: object.content_version,
    locale: object.locale,
    prompt_text: requiredString(object, "prompt_text"),
    life_domains: requiredStrings(object, "life_domains") as EnginePrompt["life_domains"],
    ...commonOptional<EnginePrompt>(object),
  };
}

type EngineModifier = VerifiedBundle["objects"]["modifiers"][number];
function projectModifier(object: ContentObject): EngineModifier {
  const precedence = object.precedence;
  if (typeof precedence !== "number") {
    throw new Error(`stored release ${object.id}.precedence invalid`);
  }
  return {
    id: object.id,
    content_type: "astrology_modifier",
    content_version: object.content_version,
    locale: object.locale,
    modifier_kind: requiredString(object, "modifier_kind"),
    body: requiredString(object, "body"),
    precedence,
    ...commonOptional<EngineModifier>(object),
  };
}

type EngineTiming = VerifiedBundle["objects"]["timing_templates"][number];
function projectTimingTemplate(object: ContentObject): EngineTiming {
  if (typeof object.is_locale_default !== "boolean") {
    throw new Error(`stored release ${object.id}.is_locale_default invalid`);
  }
  return {
    id: object.id,
    content_type: "timing_template",
    content_version: object.content_version,
    locale: object.locale,
    template_text: requiredString(object, "template_text"),
    placeholders: requiredStrings(object, "placeholders") as EngineTiming["placeholders"],
    is_locale_default: object.is_locale_default,
    ...(object.status === undefined ? {} : { status: object.status as EngineTiming["status"] }),
  };
}

type EngineFallback = VerifiedBundle["objects"]["daily_fallbacks"][number];
function projectFallback(object: ContentObject): EngineFallback {
  return {
    id: object.id,
    content_type: "daily_fallback",
    content_version: object.content_version,
    locale: object.locale,
    body: requiredString(object, "body"),
    eligibility_mode: "universal",
    ...(object.status === undefined
      ? {}
      : { status: object.status as EngineFallback["status"] }),
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
