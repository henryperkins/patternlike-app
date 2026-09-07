import { Box3, BufferGeometry, Group, Material, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { PortraitSkyPlacement } from "../../lib/portrait-sky.js";
import { disposeModel } from "./scene-utils.js";
import { createZodiacInstrument, zodiacPoint } from "./zodiac-instrument.js";

const owned: Group[] = [];
function instrument(placements: readonly PortraitSkyPlacement[] = []) {
  const value = createZodiacInstrument(placements);
  owned.push(value.root);
  return value;
}
function sectors(root: Group) {
  const result = new Map<string, MeshStandardMaterial>();
  root.traverse(object => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial && typeof object.userData.zodiacSign === "string") {
      result.set(object.userData.zodiacSign, object.material);
    }
  });
  return result;
}
function selectedSectors(root: Group) {
  return [...sectors(root)].filter(([, material]) => material.emissiveIntensity > 0).map(([sign]) => sign);
}
afterEach(() => { disposeModel(owned.splice(0)); });

describe("zodiac instrument", () => {
  it.each([
    [0, [0, 0.95, -2]],
    [90, [2, 0.95, 0]],
    [180, [0, 0.95, 2]],
    [270, [-2, 0.95, 0]],
    [390, [1, 0.95, -1.7320508075688772]],
    [-90, [-2, 0.95, 0]],
  ] as const)("calibrates longitude %s clockwise from the negative z axis", (longitude, expected) => {
    const point = zodiacPoint(longitude, 2, 0.95);
    point.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 10));
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite longitude %s instead of producing invalid geometry", longitude => {
    expect(() => zodiacPoint(longitude, 1, 0.95)).toThrow(RangeError);
  });

  it("places the supplied bodies at their measured degrees and exposes their visible meshes for picking", () => {
    const placements = Object.freeze([
      Object.freeze({ body: "sun", longitude: 14.5, sign: "aries", degree: 14.5 }),
      Object.freeze({ body: "moon", longitude: 93.25, sign: "cancer", degree: 3.25 }),
      Object.freeze({ body: "ascendant", longitude: 222.8, sign: "scorpio", degree: 12.8 }),
    ] satisfies PortraitSkyPlacement[]);
    const before = JSON.stringify(placements);
    const value = instrument(placements);
    expect(value.markers.size).toBe(3);
    for (const placement of placements) {
      const marker = value.markers.get(placement.body)!;
      const angle = (Math.atan2(marker.position.x, -marker.position.z) * 180 / Math.PI + 360) % 360;
      expect(angle).toBeCloseTo(placement.longitude, 10);
      let pickableMeshes = 0;
      marker.traverse(object => {
        if (!(object instanceof Mesh)) return;
        pickableMeshes++;
        expect(object.userData.skyBody).toBe(placement.body);
        expect(object.userData.chapterId).toBeUndefined();
      });
      expect(pickableMeshes).toBeGreaterThan(0);
    }
    expect(JSON.stringify(placements)).toBe(before);
  });

  it("keeps equal-longitude markers spatially separate on deterministic radial lanes", () => {
    const value = instrument([
      { body: "sun", longitude: 90, sign: "cancer", degree: 0 },
      { body: "moon", longitude: 90, sign: "cancer", degree: 0 },
      { body: "ascendant", longitude: 90, sign: "cancer", degree: 0 },
    ]);
    expect(value.markers.size).toBe(3);
    value.root.updateMatrixWorld(true);
    const boxes = [...value.markers.values()].map(marker => new Box3().setFromObject(marker));
    for (let index = 0; index < boxes.length; index++) {
      for (let other = index + 1; other < boxes.length; other++) expect(boxes[index]!.intersectsBox(boxes[other]!)).toBe(false);
    }
    const sun = value.markers.get("sun")!;
    expect(sun.position.x).toBeGreaterThan(value.markers.get("moon")!.position.x);
    expect(value.markers.get("moon")!.position.x).toBeGreaterThan(value.markers.get("ascendant")!.position.x);
  });

  it("highlights the measured sector, clears the previous body, and returns to neutral selection", () => {
    const value = instrument([
      { body: "sun", longitude: 29.9, sign: "aries", degree: 29.9 },
      { body: "moon", longitude: 330, sign: "pisces", degree: 0 },
    ]);
    expect(sectors(value.root).size).toBe(12);
    value.setSelection("sun");
    expect(selectedSectors(value.root)).toEqual(["aries"]);
    const sunMaterials: MeshStandardMaterial[] = [];
    value.markers.get("sun")!.traverse(object => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) sunMaterials.push(object.material);
    });
    const selectedIntensities = sunMaterials.map(material => material.emissiveIntensity);
    value.setSelection("moon");
    expect(selectedSectors(value.root)).toEqual(["pisces"]);
    expect(sunMaterials.every((material, index) => material.emissiveIntensity < selectedIntensities[index]!)).toBe(true);
    value.setSelection(null);
    expect(selectedSectors(value.root)).toEqual([]);
  });

  it("highlights a saved Sun sign as a whole sector without inventing any marker", () => {
    const value = instrument();
    value.setSelection("sun", "libra");
    expect(selectedSectors(value.root)).toEqual(["libra"]);
    expect(value.markers.size).toBe(0);
    let inventedMarkers = 0;
    value.root.traverse(object => { if (object.userData.skyBody) inventedMarkers++; });
    expect(inventedMarkers).toBe(0);
    value.setSelection(null, "taurus");
    expect(selectedSectors(value.root)).toEqual(["taurus"]);
    value.setSelection(null);
    expect(selectedSectors(value.root)).toEqual([]);
  });

  it("preserves marker coordinates and twelve readable sign anchors while hiding foreground hoops in sky focus", () => {
    const value = instrument([{ body: "sun", longitude: 45, sign: "taurus", degree: 15 }]);
    const positions = [...value.markers.values()].map(marker => marker.position.toArray());
    const visibleMeshes = () => {
      let count = 0;
      value.root.traverseVisible(object => { if (object instanceof Mesh) count++; });
      return count;
    };
    const overviewCount = visibleMeshes();
    value.setFocused(true);
    expect(visibleMeshes()).toBeLessThan(overviewCount);
    expect([...value.markers.values()].map(marker => marker.position.toArray())).toEqual(positions);
    expect(value.signAnchors).toHaveLength(12);
    const first = value.signAnchors[0]!;
    expect(Math.atan2(first[0], -first[2]) * 180 / Math.PI).toBeCloseTo(15);
    expect(Math.hypot(first[0], first[2])).toBeCloseTo(1.5);
    expect(first[1]).toBeCloseTo(0.95);
    value.setFocused(false);
    expect(visibleMeshes()).toBe(overviewCount);
    const size = new Box3().setFromObject(value.root).getSize(new Vector3());
    expect(size.x).toBeGreaterThan(2.8);
    expect(size.y).toBeGreaterThan(1);
    expect([...size.toArray()].every(Number.isFinite)).toBe(true);
  });

  it("owns all materials and geometry locally so disposing one instrument cannot invalidate another", () => {
    const first = instrument([{ body: "sun", longitude: 5, sign: "aries", degree: 5 }]);
    const second = instrument([{ body: "sun", longitude: 5, sign: "aries", degree: 5 }]);
    const resources = (root: Group) => {
      const result = new Set<BufferGeometry | Material>();
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        result.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) result.add(material);
      });
      return result;
    };
    const firstResources = resources(first.root);
    const secondResources = resources(second.root);
    expect(firstResources.size).toBeGreaterThan(0);
    expect([...firstResources].some(resource => secondResources.has(resource))).toBe(false);
    first.setSelection("sun");
    expect(selectedSectors(second.root)).toEqual([]);
    const disposed = new Set<BufferGeometry | Material>();
    for (const resource of firstResources) resource.addEventListener("dispose", () => disposed.add(resource));
    disposeModel([first.root]);
    owned.splice(owned.indexOf(first.root), 1);
    expect(disposed).toEqual(firstResources);
  });
});
