import type { ZodiacSignName } from "./daily-sky-types.js";

type Point = [number, number, number];

export interface SunShapeProfile {
  label: string;
  description: string;
  anchors: readonly [Point, Point, Point, Point];
}

const defaultProfile: SunShapeProfile = {
  label: "Pattern",
  description: "Four chapter forms trace a rising path with room between its branches.",
  anchors: [[-0.98, -0.83, -0.18], [-0.58, 0.66, 0.16], [0.44, -0.42, 0.25], [0.98, 0.93, -0.16]],
};

/** Artistic compositions inspired by signs, never astronomical star positions. */
export const sunShapeProfiles: Record<ZodiacSignName, SunShapeProfile> = {
  aries: {
    label: "Aries", description: "An artistic rising fork inspired by Aries.",
    anchors: [[-1.1, -0.72, -0.24], [-0.66, 0.82, 0.2], [0.38, -0.3, -0.08], [1.02, 0.92, 0.22]],
  },
  taurus: {
    label: "Taurus", description: "An artistic wide arc inspired by Taurus.",
    anchors: [[-1.1, 0.73, 0.12], [-0.67, -0.72, -0.28], [0.69, -0.68, 0.2], [1.08, 0.86, -0.08]],
  },
  gemini: {
    label: "Gemini", description: "An artistic pairing of upright paths inspired by Gemini.",
    anchors: [[-0.78, -0.86, 0.21], [-0.84, 0.88, -0.14], [0.85, 0.82, 0.19], [0.78, -0.86, -0.21]],
  },
  cancer: {
    label: "Cancer", description: "An artistic enclosing arc inspired by Cancer.",
    anchors: [[0.75, 1, 0.14], [-0.6, 0.5, -0.22], [-0.85, -0.85, 0.18], [0.66, -0.87, -0.13]],
  },
  leo: {
    label: "Leo", description: "An artistic open crown inspired by Leo.",
    anchors: [[-1.08, -0.79, -0.12], [-0.64, 0.78, 0.21], [0.79, 1.02, -0.12], [1.04, -0.5, 0.2]],
  },
  virgo: {
    label: "Virgo", description: "An artistic sequence of rising steps inspired by Virgo.",
    anchors: [[-0.7, -1.12, 0.21], [0.59, -0.36, -0.14], [-0.5, 0.4, 0.12], [0.72, 1.14, -0.22]],
  },
  libra: {
    label: "Libra", description: "An artistic balanced span inspired by Libra.",
    anchors: [[-1.07, 0.36, 0.14], [-0.51, -0.92, -0.2], [0.54, -0.92, 0.2], [1.08, 0.38, -0.14]],
  },
  scorpio: {
    label: "Scorpio", description: "An artistic hooked path inspired by Scorpio.",
    anchors: [[-1.02, 0.92, -0.16], [-0.65, -0.49, 0.19], [0.68, -0.87, -0.15], [1.06, 0.43, 0.25]],
  },
  sagittarius: {
    label: "Sagittarius", description: "An artistic upward branch inspired by Sagittarius.",
    anchors: [[-1.04, -0.86, 0.2], [0.08, -0.18, -0.2], [1.04, 0.96, 0.12], [-0.52, 0.97, -0.14]],
  },
  capricorn: {
    label: "Capricorn", description: "An artistic angular ridge inspired by Capricorn.",
    anchors: [[-1.02, -0.82, -0.1], [-0.67, 0.88, 0.2], [0.61, 0.16, -0.22], [1.06, -0.93, 0.1]],
  },
  aquarius: {
    label: "Aquarius", description: "An artistic alternating wave inspired by Aquarius.",
    anchors: [[-1.05, -0.65, 0.22], [-0.62, 0.84, -0.16], [0.67, -0.75, 0.2], [1.03, 0.77, -0.25]],
  },
  pisces: {
    label: "Pisces", description: "An artistic pairing of drifting arcs inspired by Pisces.",
    anchors: [[-0.98, 0.83, -0.24], [-0.55, -0.74, 0.18], [0.72, 0.84, 0.22], [1.07, -0.64, -0.18]],
  },
};

export function getSunShapeProfile(sign: ZodiacSignName | null = null): SunShapeProfile {
  return typeof sign === "string" && Object.hasOwn(sunShapeProfiles, sign) ? sunShapeProfiles[sign] : defaultProfile;
}

const localScale = 0.86;
const orientations = [
  { yaw: -0.14, roll: -0.08 },
  { yaw: 0.16, roll: 0.06 },
  { yaw: -0.12, roll: -0.06 },
  { yaw: 0.13, roll: 0.08 },
] as const;

/**
 * Place an image-derived point in an open four-chapter composition.
 * Input is centered local image space: x within +/-0.65, y within +/-0.6,
 * and z within +/-0.09. These bounds stay inside a 2.3-unit viewer radius.
 * A fixed uniform scale and modest rotations preserve each image's contours
 * and front legibility. Changing signs changes only the chapter anchors.
 */
export function applySunLayout(point: Point, sourceIndex: number, sign: ZodiacSignName | null = null): Point {
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 3) throw new RangeError("Chapter index must be 0 through 3");
  if (!Array.isArray(point) || point.length !== 3 || ![point[0], point[1], point[2]].every(Number.isFinite)) throw new TypeError("Local image point must contain three finite coordinates");
  const anchor = getSunShapeProfile(sign).anchors[sourceIndex]!;
  const { yaw, roll } = orientations[sourceIndex]!;
  const x = (point[0] * Math.cos(yaw) + point[2] * Math.sin(yaw)) * localScale;
  const y = point[1] * localScale;
  const z = (-point[0] * Math.sin(yaw) + point[2] * Math.cos(yaw)) * localScale;
  return [
    anchor[0] + x * Math.cos(roll) - y * Math.sin(roll),
    anchor[1] + x * Math.sin(roll) + y * Math.cos(roll),
    anchor[2] + z,
  ];
}
