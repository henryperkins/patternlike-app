import {
  LAUNCH_ASPECTS,
  LAUNCH_BODIES,
  isCanonicalAspectPair,
  type AspectType,
  type BirthTimeAccuracy,
  type CelestialBody,
  type NatalPredicate,
  type PatternContentObject,
  type PatternMatch,
} from "@patternlike/shared";

const BIRTH_TIME_ACCURACIES: readonly BirthTimeAccuracy[] = ["exact", "approximate", "unknown"];

/**
 * Narrow a hash-verified release's `patterns` collection to the closed M4
 * object shape.
 *
 * Ingestion already validated the bundle against the M4 schema and
 * `loadReleaseBundle()` already re-hashed the stored R2 bytes, so a failure
 * here is not an ordinary content error — it means bytes that passed both
 * gates do not describe what the matcher is about to read. The route treats
 * that as an integrity refusal rather than matching a partially understood
 * object, because a silently dropped predicate is the one failure mode that
 * produces a *wrong* chapter instead of a missing one.
 *
 * Returning `null` for the whole collection rather than skipping one object is
 * deliberate for the same reason: one unreadable object makes the eligibility
 * partition reported in `omissions` unverifiable for every other object.
 */
export function readPatternObjects(objects: unknown): PatternContentObject[] | null {
  if (!Array.isArray(objects)) return null;
  const read: PatternContentObject[] = [];
  for (const value of objects) {
    const pattern = readPatternObject(value);
    if (!pattern) return null;
    read.push(pattern);
  }
  return read;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readEnumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  const read: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(allowed as readonly string[]).includes(item)) return null;
    read.push(item as T);
  }
  return read;
}

function readPatternObject(value: unknown): PatternContentObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (object.content_type !== "pattern") return null;
  if (object.status !== "approved" && object.status !== "deprecated") return null;

  const strings = [
    "id",
    "content_version",
    "object_hash",
    "locale",
    "title",
    "summary",
    "body",
    "counter_expression",
  ] as const;
  for (const key of strings) {
    const held = object[key];
    if (typeof held !== "string" || held.length === 0) return null;
  }
  if (typeof object.display_priority !== "number" || !Number.isInteger(object.display_priority)) return null;
  if (typeof object.requires_houses !== "boolean") return null;
  if (
    typeof object.minimum_accuracy !== "string" ||
    !(BIRTH_TIME_ACCURACIES as readonly string[]).includes(object.minimum_accuracy)
  ) {
    return null;
  }
  for (const key of ["resources", "tensions", "prohibited_claims", "tags"] as const) {
    if (!isStringArray(object[key])) return null;
  }
  const requiredBodies = readEnumArray<CelestialBody>(object.required_bodies, LAUNCH_BODIES);
  const requiredAspects = readEnumArray<AspectType>(object.required_aspects, LAUNCH_ASPECTS);
  const match = readMatch(object.match);
  if (!requiredBodies || !requiredAspects || !match) return null;

  return {
    id: object.id as string,
    content_type: "pattern",
    content_version: object.content_version as string,
    object_hash: object.object_hash as string,
    locale: object.locale as string,
    status: object.status,
    display_priority: object.display_priority,
    title: object.title as string,
    summary: object.summary as string,
    body: object.body as string,
    resources: object.resources as string[],
    tensions: object.tensions as string[],
    counter_expression: object.counter_expression as string,
    prohibited_claims: object.prohibited_claims as string[],
    tags: object.tags as string[],
    minimum_accuracy: object.minimum_accuracy as BirthTimeAccuracy,
    requires_houses: object.requires_houses,
    required_bodies: requiredBodies,
    required_aspects: requiredAspects,
    match,
  };
}

function readMatch(value: unknown): PatternMatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const allOf = readPredicates(object.all_of);
  const anyOf = readPredicates(object.any_of);
  const noneOf = readPredicates(object.none_of);
  if (!allOf || !anyOf || !noneOf) return null;
  // The one cross-clause rule. A chapter matching on negatives alone would be
  // shown to every reader whose chart merely lacks something, which is exactly
  // the generic filler the product forbids.
  if (allOf.length === 0 && anyOf.length === 0) return null;
  return { all_of: allOf, any_of: anyOf, none_of: noneOf };
}

function readPredicates(value: unknown): NatalPredicate[] | null {
  if (!Array.isArray(value)) return null;
  const read: NatalPredicate[] = [];
  for (const item of value) {
    const predicate = readPredicate(item);
    if (!predicate) return null;
    read.push(predicate);
  }
  return read;
}

function isBody(value: unknown): value is CelestialBody {
  return typeof value === "string" && (LAUNCH_BODIES as readonly string[]).includes(value);
}

function isSignIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

function readPredicate(value: unknown): NatalPredicate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  switch (object.type) {
    case "position": {
      if (!isBody(object.body)) return null;
      if (object.sign !== undefined && !isSignIndex(object.sign)) return null;
      if (object.house !== undefined && !isSignIndex(object.house)) return null;
      return {
        type: "position",
        body: object.body,
        ...(object.sign === undefined ? {} : { sign: object.sign as number }),
        ...(object.house === undefined ? {} : { house: object.house as number }),
      };
    }
    case "aspect": {
      if (!isBody(object.body_a) || !isBody(object.body_b)) return null;
      if (
        typeof object.aspect !== "string" ||
        !(LAUNCH_ASPECTS as readonly string[]).includes(object.aspect)
      ) {
        return null;
      }
      // Canonical ordering is a contract rule with one definition in
      // @patternlike/shared. It is `LAUNCH_BODIES` rank, not alphabetical: the
      // M4 contract's rejection fixture is the alphabetical form of a Sun-Moon
      // aspect, so an ordering rolled by hand here would refuse exactly the
      // releases the contract accepts.
      if (!isCanonicalAspectPair(object.body_a, object.body_b)) return null;
      if (object.max_orb !== undefined && (typeof object.max_orb !== "number" || !(object.max_orb > 0))) {
        return null;
      }
      return {
        type: "aspect",
        body_a: object.body_a,
        body_b: object.body_b,
        aspect: object.aspect as AspectType,
        ...(object.max_orb === undefined ? {} : { max_orb: object.max_orb as number }),
      };
    }
    case "pattern": {
      if (typeof object.pattern !== "string" || object.pattern.length === 0) return null;
      if (object.member_bodies === undefined) return { type: "pattern", pattern: object.pattern };
      const members = readEnumArray<CelestialBody>(object.member_bodies, LAUNCH_BODIES);
      return members ? { type: "pattern", pattern: object.pattern, member_bodies: members } : null;
    }
    case "angle": {
      if (object.angle !== "ascendant" && object.angle !== "midheaven") return null;
      if (object.sign !== undefined && !isSignIndex(object.sign)) return null;
      return {
        type: "angle",
        angle: object.angle,
        ...(object.sign === undefined ? {} : { sign: object.sign as number }),
      };
    }
    case "house_cusp": {
      if (!isSignIndex(object.house)) return null;
      if (object.sign !== undefined && !isSignIndex(object.sign)) return null;
      return {
        type: "house_cusp",
        house: object.house,
        ...(object.sign === undefined ? {} : { sign: object.sign as number }),
      };
    }
    case "uncertainty": {
      if (
        typeof object.accuracy !== "string" ||
        !(BIRTH_TIME_ACCURACIES as readonly string[]).includes(object.accuracy)
      ) {
        return null;
      }
      if (object.suppressed_feature !== undefined && typeof object.suppressed_feature !== "string") {
        return null;
      }
      return {
        type: "uncertainty",
        accuracy: object.accuracy as BirthTimeAccuracy,
        ...(object.suppressed_feature === undefined
          ? {}
          : { suppressed_feature: object.suppressed_feature as string }),
      };
    }
    default:
      return null;
  }
}
