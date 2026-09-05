import { describe, expect, it } from "vitest";
import { ZODIAC_SIGNS, type ZodiacSignName } from "@patternlike/shared";
import { applySunLayout, getSunShapeProfile } from "./sun-sculpture.js";

type Point = [number, number, number];
const center: Point = [0, 0, 0];
const distance = (a: Point, b: Point) => Math.hypot(...a.map((value, index) => value - b[index]!));

describe("Sun-inspired chapter layout", () => {
  it("arranges four separate chapter centers into a balanced rising default", () => {
    const anchors = [0, 1, 2, 3].map((index) => applySunLayout(center, index, null));
    expect(anchors[0]![0]).toBeLessThan(0);
    expect(anchors[0]![1]).toBeLessThan(0);
    expect(anchors[3]![0]).toBeGreaterThan(0);
    expect(anchors[3]![1]).toBeGreaterThan(0);
    expect(anchors[1]![1]).toBeGreaterThan(anchors[2]![1]);
    expect(Math.abs(anchors.reduce((sum, point) => sum + point[0], 0) / 4)).toBeLessThan(0.15);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) expect(distance(anchors[a]!, anchors[b]!)).toBeGreaterThan(1);
    }
    expect(applySunLayout(center, 0)).toEqual(anchors[0]);
  });

  it("gives every sign its own deterministic arrangement without altering local contours", () => {
    const sample: Point = [0.3, -0.25, 0.04];
    const original = [...sample];
    const defaultAnchors = [0, 1, 2, 3].map((index) => applySunLayout(center, index, null));
    const arrangements = new Set<string>();
    for (const sign of ZODIAC_SIGNS) {
      const anchors = [0, 1, 2, 3].map((index) => applySunLayout(center, index, sign));
      expect(anchors).not.toEqual(defaultAnchors);
      arrangements.add(JSON.stringify(anchors));
      for (let index = 0; index < 4; index++) {
        const transformed = applySunLayout(sample, index, sign);
        expect(applySunLayout(sample, index, sign)).toEqual(transformed);
        // Changing signs translates a chapter; its orientation and scale stay intact.
        const localOffset = transformed.map((value, axis) => value - anchors[index]![axis]!);
        const defaultPoint = applySunLayout(sample, index, null);
        localOffset.forEach((value, axis) => expect(value).toBeCloseTo(defaultPoint[axis]! - defaultAnchors[index]![axis]!, 12));
      }
    }
    expect(arrangements.size).toBe(12);
    expect(sample).toEqual(original);
  });

  it.each([null, ...ZODIAC_SIGNS])("keeps the %s layout finite, open, and inside the viewer radius", (sign) => {
    const localA: Point = [-0.4, -0.3, -0.05];
    const localB: Point = [0.35, 0.45, 0.08];
    const anchors = [0, 1, 2, 3].map((index) => applySunLayout(center, index, sign));
    for (let index = 0; index < 4; index++) {
      const ratio = distance(applySunLayout(localA, index, sign), applySunLayout(localB, index, sign)) / distance(localA, localB);
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThanOrEqual(1);
      for (const x of [-0.65, 0.65]) for (const y of [-0.6, 0.6]) for (const z of [-0.09, 0.09]) {
        const transformed = applySunLayout([x, y, z], index, sign);
        expect(transformed.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...transformed)).toBeLessThan(2.3);
      }
      const front = applySunLayout([0, 0, 0.1], index, sign);
      expect(front[2] - anchors[index]![2]).toBeGreaterThan(0.08);
      for (let other = index + 1; other < 4; other++) {
        expect(Math.hypot(anchors[index]![0] - anchors[other]![0], anchors[index]![1] - anchors[other]![1])).toBeGreaterThan(1);
      }
    }
  });

  it("falls back to the unassigned layout for unsupported runtime signs", () => {
    for (const sign of ["", "Aries", "not-a-sign", "toString", "__proto__"] as unknown as ZodiacSignName[]) {
      expect(applySunLayout(center, 2, sign)).toEqual(applySunLayout(center, 2, null));
      expect(getSunShapeProfile(sign)).toBe(getSunShapeProfile(null));
    }
  });

  it("rejects invalid chapter indexes and nonfinite local coordinates", () => {
    for (const index of [-1, 4, 1.5, NaN]) expect(() => applySunLayout(center, index, null)).toThrow(/chapter/i);
    for (const value of [NaN, Infinity, -Infinity]) expect(() => applySunLayout([value, 0, 0], 0, null)).toThrow(/finite/i);
    expect(() => applySunLayout(new Array<number>(3) as Point, 0, null)).toThrow(/finite/i);
  });
});
