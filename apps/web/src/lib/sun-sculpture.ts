import type { ZodiacSignName } from "@patternlike/shared";

interface SunShapeProfile {
  label: string;
  description: string;
  width: number;
  depth: number;
  taper: number;
  waist: number;
  bend: number;
  twist: number;
  ripple: number;
}

/** Artistic shape directions, not calculated physical properties or personality claims. */
export const sunShapeProfiles: Record<ZodiacSignName, SunShapeProfile> = {
  aries: { label: "Aries", description: "An upward sweep with a widening crown.", width: 1.05, depth: 0.94, taper: 0.28, waist: 0.02, bend: 0.22, twist: 0.18, ripple: 0 },
  taurus: { label: "Taurus", description: "A broad, rounded form with a fuller base.", width: 1.36, depth: 1.2, taper: -0.22, waist: -0.08, bend: 0, twist: 0, ripple: 0 },
  gemini: { label: "Gemini", description: "Paired curves moving through a gentle turn.", width: 1.15, depth: 0.9, taper: 0, waist: 0.12, bend: 0.08, twist: 0.42, ripple: -0.17 },
  cancer: { label: "Cancer", description: "A curved embrace with a soft, rounded base.", width: 1.18, depth: 1.22, taper: -0.18, waist: -0.16, bend: -0.26, twist: -0.16, ripple: 0.04 },
  leo: { label: "Leo", description: "A generous crown opening above a narrower base.", width: 1.3, depth: 1.08, taper: 0.3, waist: 0.14, bend: 0, twist: 0, ripple: 0.04 },
  virgo: { label: "Virgo", description: "A slender silhouette with a precise, quiet taper.", width: 0.83, depth: 0.88, taper: -0.13, waist: 0.08, bend: 0, twist: -0.12, ripple: 0 },
  libra: { label: "Libra", description: "Balanced flares around a softly drawn-in middle.", width: 1.12, depth: 0.88, taper: 0, waist: 0.28, bend: 0, twist: 0, ripple: -0.06 },
  scorpio: { label: "Scorpio", description: "A close-held core with a pronounced spiral.", width: 0.92, depth: 1.16, taper: 0.1, waist: 0.04, bend: -0.12, twist: 0.82, ripple: 0 },
  sagittarius: { label: "Sagittarius", description: "An open, leaning sweep toward the top.", width: 1.12, depth: 0.82, taper: 0.25, waist: 0, bend: 0.4, twist: -0.32, ripple: 0 },
  capricorn: { label: "Capricorn", description: "A grounded base climbing into a narrow crest.", width: 1.02, depth: 1.02, taper: -0.3, waist: 0.12, bend: 0.2, twist: 0.22, ripple: 0 },
  aquarius: { label: "Aquarius", description: "An expansive silhouette with an offset wave.", width: 1.27, depth: 0.8, taper: 0.04, waist: 0.08, bend: -0.32, twist: -0.62, ripple: 0.12 },
  pisces: { label: "Pisces", description: "A flowing curve and a soft, rippling turn.", width: 1.08, depth: 1.12, taper: -0.05, waist: -0.08, bend: 0.32, twist: 0.55, ripple: -0.12 },
};

/**
 * Deform the image-derived surface without adding meshes or changing its topology.
 * At each height this is a positive scale, rotation, and translation in x/z;
 * y is unchanged, so distinct cross sections cannot fold into each other.
 */
export function applySunShape(positions: number[], sunSign: ZodiacSignName): void {
  const profile = sunShapeProfiles[sunSign];
  if (!Object.hasOwn(sunShapeProfiles, sunSign)) throw new Error("Unknown Sun sign");
  for (let i = 0; i < positions.length; i += 3) {
    const height = Math.max(-1, Math.min(1, positions[i + 1]! / 1.75));
    const width = profile.width * (1 + profile.taper * height + profile.waist * height * height
      + profile.ripple * Math.cos(Math.PI * 2 * height));
    const angle = profile.twist * height;
    const x = positions[i]! * width;
    const z = positions[i + 2]! * profile.depth;
    positions[i] = x * Math.cos(angle) - z * Math.sin(angle) + profile.bend * Math.sin(Math.PI * height * 0.8);
    positions[i + 2] = x * Math.sin(angle) + z * Math.cos(angle);
  }
}
