import {
  NATAL_FEATURE_POLICY_ID,
  NATAL_FEATURE_POLICY_VERSION,
  canonicalAspectPair,
  jcsCanonicalize,
  sha256Hex,
  type AspectType,
  type BirthTimeAccuracy,
  type CelestialBody,
  type NatalFeature,
} from "@patternlike/shared";

export { NATAL_FEATURE_POLICY_ID, NATAL_FEATURE_POLICY_VERSION };

const BODIES = new Set<CelestialBody>([
  "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
  "uranus", "neptune", "pluto", "true_node", "ascendant", "midheaven",
]);
const ASPECTS = new Set<AspectType>([
  "conjunction", "sextile", "square", "trine", "opposition",
]);
const SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
] as const;

export interface DerivedNatalFeatureSet {
  featureSetId: string;
  featureSetHash: string;
  features: NatalFeature[];
}

export interface DeriveNatalFeatureSetInput {
  chartId: string;
  userId: string;
  chartFingerprint: string;
  effectiveAccuracy: BirthTimeAccuracy;
  snapshot: unknown;
  uncertainty: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Object.is(value, -0) ? 0 : value : null;
}

function body(value: unknown): CelestialBody | null {
  return typeof value === "string" && BODIES.has(value as CelestialBody)
    ? value as CelestialBody
    : null;
}

function aspect(value: unknown): AspectType | null {
  return typeof value === "string" && ASPECTS.has(value as AspectType)
    ? value as AspectType
    : null;
}

function longitude(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n >= 0 && n < 360 ? n : null;
}

function signNumber(value: unknown, longitudeValue: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value;
  }
  if (typeof value === "string") {
    const index = SIGNS.indexOf(value.toLowerCase() as typeof SIGNS[number]);
    if (index >= 0) return index + 1;
  }
  return Math.floor(longitudeValue / 30) + 1;
}

function suppressedClasses(value: unknown): string[] {
  const source = record(value);
  const raw = source?.suppressed_features;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    const entry = record(item);
    return typeof entry?.feature_class === "string" ? [entry.feature_class] : [];
  }))].sort();
}

async function sealFeature(
  chartFingerprint: string,
  featureClass: NatalFeature["feature_class"],
  fact: Record<string, unknown>,
): Promise<NatalFeature> {
  const digest = await sha256Hex(jcsCanonicalize({
    chart_fingerprint: chartFingerprint,
    policy_id: NATAL_FEATURE_POLICY_ID,
    policy_version: NATAL_FEATURE_POLICY_VERSION,
    feature_class: featureClass,
    fact,
  }));
  return {
    feature_id: `nft_${digest.slice(0, 32)}`,
    feature_class: featureClass,
    policy_id: NATAL_FEATURE_POLICY_ID,
    policy_version: NATAL_FEATURE_POLICY_VERSION,
    ...fact,
  } as NatalFeature;
}

export async function deriveNatalFeatureSet(
  input: DeriveNatalFeatureSetInput,
): Promise<DerivedNatalFeatureSet> {
  const snap = record(input.snapshot);
  if (!snap || !Array.isArray(snap.positions) || !Array.isArray(snap.aspects)) {
    throw new Error("chart snapshot cannot be normalized for natal features");
  }
  const suppressed = suppressedClasses(input.uncertainty);
  const housesEligible =
    input.effectiveAccuracy !== "unknown" &&
    !suppressed.includes("houses") && record(snap.houses) !== null;
  const anglesEligible =
    input.effectiveAccuracy !== "unknown" &&
    !suppressed.includes("angles") && record(snap.angles) !== null;
  const facts: Array<{ featureClass: NatalFeature["feature_class"]; fact: Record<string, unknown> }> = [];

  for (const raw of snap.positions) {
    const item = record(raw);
    const b = body(item?.body);
    const lng = longitude(item?.longitude_deg ?? item?.longitude);
    if (!item || !b || lng === null) continue;
    const rawHouse = item.house;
    const house = housesEligible && typeof rawHouse === "number" && Number.isInteger(rawHouse) && rawHouse >= 1 && rawHouse <= 12
      ? rawHouse
      : null;
    facts.push({
      featureClass: "position",
      fact: { body: b, longitude: lng, sign: signNumber(item.sign, lng), house },
    });
  }

  for (const raw of snap.aspects) {
    const item = record(raw);
    const a = body(item?.body_a);
    const b = body(item?.body_b);
    const kind = aspect(item?.aspect);
    const orb = finite(item?.orb_deg ?? item?.orb);
    if (!item || !a || !b || a === b || !kind || orb === null || orb < 0 || orb > 12) continue;
    const [bodyA, bodyB] = canonicalAspectPair(a, b);
    facts.push({
      featureClass: "aspect",
      fact: { body_a: bodyA, body_b: bodyB, aspect: kind, orb },
    });
  }

  const rawPatterns = Array.isArray(snap.patterns) ? snap.patterns : [];
  for (const raw of rawPatterns) {
    const item = record(raw);
    const name = item?.pattern ?? item?.type ?? item?.name;
    const members = item?.member_bodies ?? item?.bodies;
    if (typeof name !== "string" || !Array.isArray(members)) continue;
    const normalizedMembers = [...new Set(members.map(body).filter((v): v is CelestialBody => v !== null))].sort();
    if (normalizedMembers.length < 2) continue;
    facts.push({ featureClass: "pattern", fact: { pattern: name, member_bodies: normalizedMembers } });
  }

  if (anglesEligible) {
    const angles = record(snap.angles)!;
    for (const [angleName, key] of [["ascendant", "ascendant_deg"], ["midheaven", "midheaven_deg"]] as const) {
      const lng = longitude(angles[key]);
      if (lng !== null) {
        facts.push({ featureClass: "angle", fact: { angle: angleName, longitude: lng, sign: signNumber(null, lng) } });
      }
    }
  }

  if (housesEligible) {
    const houses = record(snap.houses)!;
    const cusps = houses.cusps_deg ?? houses.cusps;
    if (Array.isArray(cusps)) {
      for (let index = 0; index < Math.min(cusps.length, 12); index++) {
        const lng = longitude(cusps[index]);
        if (lng !== null) {
          facts.push({ featureClass: "house_cusp", fact: { house: index + 1, longitude: lng, sign: signNumber(null, lng) } });
        }
      }
    }
  }

  facts.push({
    featureClass: "uncertainty",
    fact: { accuracy: input.effectiveAccuracy, suppressed_features: suppressed },
  });

  const features = await Promise.all(facts.map(({ featureClass, fact }) =>
    sealFeature(input.chartFingerprint, featureClass, fact)));
  features.sort((a, b) => a.feature_id.localeCompare(b.feature_id));
  const featureSetHash = await sha256Hex(jcsCanonicalize({
    chart_fingerprint: input.chartFingerprint,
    policy_id: NATAL_FEATURE_POLICY_ID,
    policy_version: NATAL_FEATURE_POLICY_VERSION,
    features,
  }));
  const setDigest = await sha256Hex(jcsCanonicalize({
    chart_fingerprint: input.chartFingerprint,
    policy_id: NATAL_FEATURE_POLICY_ID,
    policy_version: NATAL_FEATURE_POLICY_VERSION,
    feature_set_hash: featureSetHash,
  }));
  return { featureSetId: `nfs_${setDigest.slice(0, 32)}`, featureSetHash, features };
}
