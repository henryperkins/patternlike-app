import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  OctahedronGeometry, RingGeometry, SphereGeometry, TorusGeometry, type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ZODIAC_SIGNS, type ZodiacSignName } from "@patternlike/shared";
import type { PortraitSkyBody, PortraitSkyPlacement } from "../../lib/portrait-sky.js";

export interface ZodiacInstrument {
  root: Group;
  markers: Map<PortraitSkyBody, Group>;
  signAnchors: [number, number, number][];
  setSelection: (body: PortraitSkyBody | null, sunSign?: ZodiacSignName | null) => void;
  setFocused: (focused: boolean) => void;
}

const radians = Math.PI / 180;
const normalizeLongitude = (longitude: number) => ((longitude % 360) + 360) % 360;

/** Clockwise ecliptic longitude in the horizontal dial: zero points along negative z. */
export function zodiacPoint(longitude: number, radius: number, height: number): [number, number, number] {
  if (![longitude, radius, height].every(Number.isFinite) || radius < 0) {
    throw new RangeError("Zodiac coordinates require finite values and a non-negative radius");
  }
  const angle = normalizeLongitude(longitude) * radians;
  return [Math.sin(angle) * radius, height, -Math.cos(angle) * radius];
}

/** Owned presentation geometry. Radial lanes separate markers; they do not represent distance. */
export function createZodiacInstrument(placements: readonly PortraitSkyPlacement[]): ZodiacInstrument {
  // Validate before allocating GPU resources; each supported body owns at most one marker.
  const byBody = new Map<PortraitSkyBody, PortraitSkyPlacement>();
  for (const placement of placements) {
    zodiacPoint(placement.longitude, 1, 0);
    byBody.set(placement.body, placement);
  }
  const root = new Group();
  root.name = "Zodiac instrument";
  const markers = new Map<PortraitSkyBody, Group>();
  const signAnchors = ZODIAC_SIGNS.map((_, index) => zodiacPoint(index * 30 + 15, 1.5, 0.95));
  const material = (name: string, color: string, roughness = 0.35, metalness = 0.72) => {
    const finish = new MeshStandardMaterial({ color, roughness, metalness });
    finish.name = name;
    return finish;
  };
  const bronze = material("Zodiac brushed bronze", "#ad8950");
  const edge = material("Zodiac polished rim", "#d0b377", 0.25, 0.82);
  const dark = material("Zodiac recessed dial", "#293730", 0.6, 0.35);
  const mesh = (group: Group, geometry: BufferGeometry, finish: MeshStandardMaterial, position: [number, number, number] = [0, 0, 0]) => {
    const object = new Mesh(geometry, finish);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
    return object;
  };
  const cylinder = (radius: number, height: number, y: number, finish: MeshStandardMaterial) =>
    mesh(root, new CylinderGeometry(radius, radius, height, 96), finish, [0, y, 0]);
  const horizontalRing = (radius: number, thickness: number, y: number, finish: MeshStandardMaterial) => {
    const ring = mesh(root, new TorusGeometry(radius, thickness, 8, 128), finish, [0, y, 0]);
    ring.rotation.x = -Math.PI / 2;
    return ring;
  };

  // The spindle meets the existing water court; a dark inset makes the calibrated brass legible.
  cylinder(0.24, 0.055, 0.35, bronze);
  cylinder(0.11, 0.43, 0.565, bronze);
  cylinder(1.42, 0.09, 0.785, bronze);
  cylinder(1.2, 0.026, 0.843, dark);
  horizontalRing(1.43, 0.026, 0.835, edge);
  horizontalRing(1.205, 0.012, 0.865, edge);

  const sectors = ZODIAC_SIGNS.map((sign, index) => {
    const finish = material(`${sign} zodiac sector`, index % 2 ? "#92703f" : "#ad8950", 0.4);
    finish.emissive.set("#d7ae5e");
    finish.emissiveIntensity = 0;
    // RingGeometry starts on +x in its own plane. This arc maps to longitude [index*30, (index+1)*30].
    const sector = mesh(root, new RingGeometry(1.22, 1.405, 12, 1, (90 - (index + 1) * 30 + 0.6) * radians, 28.8 * radians), finish, [0, 0.854, 0]);
    sector.rotation.x = -Math.PI / 2;
    sector.userData.zodiacSign = sign;
    return finish;
  });

  // Five-degree divisions merge into one owned mesh, with longer marks at ten and thirty degrees.
  const ticks: BufferGeometry[] = [];
  for (let longitude = 0; longitude < 360; longitude += 5) {
    const length = longitude % 30 === 0 ? 0.15 : longitude % 10 === 0 ? 0.09 : 0.045;
    const tick = new BoxGeometry(longitude % 30 === 0 ? 0.022 : 0.013, 0.012, length);
    tick.rotateY(-longitude * radians);
    tick.translate(...zodiacPoint(longitude, 1.19 - length / 2, 0.866));
    ticks.push(tick);
  }
  const tickGeometry = mergeGeometries(ticks)!;
  ticks.forEach(geometry => geometry.dispose());
  mesh(root, tickGeometry, edge);
  for (const radius of [0.49, 0.74, 0.99]) horizontalRing(radius, 0.004, 0.862, bronze);

  // The raised rings make the instrument visible from the court; close study removes their occlusion.
  const armillary = new Group();
  armillary.name = "Zodiac armillary hoops";
  armillary.position.y = 1.95;
  root.add(armillary);
  for (const yaw of [-Math.PI / 3, Math.PI / 3]) {
    const hoop = mesh(armillary, new TorusGeometry(1.15, 0.025, 8, 128), bronze);
    hoop.rotation.y = yaw;
  }
  const inclined = mesh(armillary, new TorusGeometry(1.17, 0.032, 8, 128), edge);
  inclined.rotation.x = Math.PI / 3;
  inclined.rotation.z = Math.PI / 8;
  for (const x of [-1.12, 1.12]) {
    mesh(armillary, new CylinderGeometry(0.025, 0.045, 1.08, 12), bronze, [x, -0.57, 0]);
  }

  const markerMaterials = new Map<PortraitSkyBody, MeshStandardMaterial>();
  const markerRadii: Record<PortraitSkyBody, number> = { sun: 0.99, moon: 0.74, ascendant: 0.49 };
  const markerColors: Record<PortraitSkyBody, string> = { sun: "#e7bd62", moon: "#e2e2d4", ascendant: "#b1d4c0" };
  for (const [body, placement] of byBody) {
    const marker = new Group();
    marker.name = `${body} zodiac marker`;
    marker.position.set(...zodiacPoint(placement.longitude, markerRadii[body], 0.95));
    marker.userData.skyBody = body;
    const finish = material(`${body} marker`, markerColors[body], 0.28, body === "moon" ? 0.25 : 0.65);
    finish.emissive.set(markerColors[body]);
    finish.emissiveIntensity = 0.06;
    markerMaterials.set(body, finish);
    mesh(marker, new CylinderGeometry(0.018, 0.025, 0.08, 10), finish, [0, -0.045, 0]);
    if (body === "sun") {
      mesh(marker, new SphereGeometry(0.073, 20, 12), finish);
      const rim = mesh(marker, new TorusGeometry(0.108, 0.009, 6, 40), finish);
      rim.rotation.x = -Math.PI / 2;
    } else if (body === "moon") {
      // A neutral pearl identifies the Moon without asserting a phase.
      mesh(marker, new SphereGeometry(0.083, 20, 12), finish);
    } else {
      mesh(marker, new OctahedronGeometry(0.095), finish);
    }
    marker.traverse(object => { if (object instanceof Mesh) object.userData.skyBody = body; });
    markers.set(body, marker);
    root.add(marker);
  }

  return {
    root,
    markers,
    signAnchors,
    setSelection(body, sunSign = null) {
      const placement = body ? byBody.get(body) : undefined;
      const fallback = !markers.has("sun") && (body === null || body === "sun") ? sunSign : null;
      const selectedSign = placement ? ZODIAC_SIGNS[Math.floor(normalizeLongitude(placement.longitude) / 30)] : fallback;
      sectors.forEach((finish, index) => { finish.emissiveIntensity = ZODIAC_SIGNS[index] === selectedSign ? 0.65 : 0; });
      for (const [markerBody, marker] of markers) {
        const selected = markerBody === body;
        marker.scale.setScalar(selected ? 1.16 : 1);
        markerMaterials.get(markerBody)!.emissiveIntensity = selected ? 0.7 : 0.06;
      }
    },
    setFocused(focused) { armillary.visible = !focused; },
  };
}
