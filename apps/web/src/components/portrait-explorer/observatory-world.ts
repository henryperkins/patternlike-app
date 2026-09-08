import {
  Box3, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  PointLight, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cameraFrame } from "./scene-utils.js";
import type { CameraBookmark, Point3 } from "./types.js";
import type { PortraitSkyPlacement } from "../../lib/portrait-sky.js";
import { createZodiacInstrument, type ZodiacInstrument } from "./zodiac-instrument.js";

const positions: Point3[] = [[2.65, 0, 2.05], [-2.65, 0, -2.05], [2.65, 0, -2.05], [-2.65, 0, 2.05]];
export const DISPLAY_HEIGHT = 0.56;
export function stationPosition(index: number, unfolded: boolean, count = 4): Point3 {
  // Longer readings use three stations per aisle, clear of the central instrument.
  const [x, y, z] = count > 4 ? [index % 2 === 0 ? 2.65 : -2.65, 0, 2.8 - Math.floor(index / 2) * 2.8] : positions[index] ?? [0, 0, 0];
  return [x * (unfolded ? 1.32 : 1), y, z * (unfolded ? 1.32 : 1)];
}

/** A reading folio is part of the authored room, not a generated chapter metaphor. */
export function createReadingFolio(chapterId: string): Group {
  const root = new Group();
  root.name = "Chapter reading folio";
  root.userData.chapterId = chapterId;
  const cover = new MeshStandardMaterial({ color: "#173f35", roughness: 0.8 });
  const paper = new MeshStandardMaterial({ color: "#ede1bf", roughness: 0.95 });
  const bronze = new MeshStandardMaterial({ color: "#ad8950", roughness: 0.4, metalness: 0.65 });
  const part = (size: Point3, position: Point3, material: MeshStandardMaterial) => {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.chapterId = chapterId;
    root.add(mesh);
  };
  part([1.65, 0.08, 1.15], [0, 0.04, 0], cover);
  for (const side of [-1, 1]) {
    part([0.74, 0.14, 1.03], [side * 0.4, 0.15, 0], paper);
    for (let line = 0; line < 7; line++) part([line === 6 ? 0.3 : 0.55, 0.006, 0.012], [side * 0.4, 0.223, -0.35 + line * 0.105], bronze);
  }
  part([0.035, 0.025, 1.07], [0, 0.225, 0], bronze);
  return root;
}

/** The reading order determines a neutral pair arrangement, independent of meaning. */
export function comparisonPosition(index: number, selected: readonly number[], boxes: readonly Box3[]): Point3 {
  const radius = (selectedIndex: number) => {
    const box = boxes[selectedIndex];
    return box ? Math.max(1.25, Math.abs(box.min.x), Math.abs(box.max.x)) : 1.25;
  };
  const separation = radius(selected[0]) + radius(selected[1]) + 0.7;
  return [selected.indexOf(index) === 0 ? -separation / 2 : separation / 2, 0, 0];
}

/** Chapter destinations are actual approaches; the overview includes the courtyard architecture. */
export function observatoryFrame(boxes: readonly Box3[], selected: readonly number[], aspect: number, inspect: boolean): CameraBookmark {
  if (!selected.length) {
    return cameraFrame([new Box3(new Vector3(-5.2, -0.2, -4.25), new Vector3(5.2, 4.2, 4.25)), ...boxes], [], aspect);
  }
  const chosen = selected.flatMap(index => boxes[index] ? [boxes[index]] : []);
  if (!chosen.length) return cameraFrame(boxes, [], aspect);
  const size = chosen[0].getSize(new Vector3());
  // Low, broad objects need an elevated view to reveal their top surface above
  // the folio. Derive this from physical bounds, never the chapter's meaning.
  const shallow = chosen.length === 1 && size.y < Math.max(size.x, size.z) * 0.5;
  const pose = cameraFrame(chosen, [], aspect, new Vector3(0.15, shallow ? 1.25 : 0.76, 1).normalize());
  const target = new Vector3(...pose.target);
  const offset = new Vector3(...pose.position).sub(target);
  // Keep room for the plinth and reading desk until the reader explicitly inspects the object.
  offset.multiplyScalar(inspect ? 1 : 1.2);
  return { position: target.clone().add(offset).toArray(), target: target.toArray() };
}

interface WorldState {
  roofOpen: boolean; lighting: "day" | "dusk"; open: boolean[]; unfolded: boolean;
  comparison?: { indices: readonly number[]; positions: readonly Point3[] };
}
export interface ObservatoryWorld {
  root: Group;
  instrument: ZodiacInstrument;
  roof: Group;
  stations: Group[];
  desks: Group[];
  setState: (state: WorldState) => void;
  tick: (seconds: number) => boolean;
}

/** Merge static joinery by material; the desk hinges and light fixtures keep independent ownership. */
function bake(group: Group) {
  group.updateMatrixWorld(true);
  const batches = new Map<MeshStandardMaterial, BufferGeometry[]>();
  const originals = new Set<BufferGeometry>();
  for (const child of [...group.children]) {
    if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) continue;
    const geometry = child.geometry.clone().applyMatrix4(child.matrix);
    const batch = batches.get(child.material) ?? [];
    batch.push(geometry);
    batches.set(child.material, batch);
    originals.add(child.geometry);
    group.remove(child);
  }
  originals.forEach(geometry => geometry.dispose());
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(item => item.dispose());
    if (!geometry) throw new Error("Observatory geometry could not be assembled");
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** Authored setting only. No saved chapter model or source text enters geometry construction. */
export function createObservatory(count: number, placements: readonly PortraitSkyPlacement[] = []): ObservatoryWorld {
  const root = new Group();
  root.name = "Courtyard observatory";
  const architecture = new Group();
  const roof = new Group();
  roof.name = "Timber canopy cutaway";
  root.add(architecture, roof);
  const instrument = createZodiacInstrument(placements);
  root.add(instrument.root);
  const material = (name: string, color: string, roughness = 0.75, metalness = 0) => {
    const value = new MeshStandardMaterial({ color, roughness, metalness });
    value.name = name;
    return value;
  };
  const stone = material("Warm limestone", "#c8bfaa", 0.9);
  const edge = material("Cut stone edges", "#968d79", 0.95);
  const plaster = material("Lime plaster", "#ded4bb", 0.95);
  const timber = material("Oiled oak", "#705137", 0.6);
  const endgrain = material("Oak end grain", "#a17b4d", 0.75);
  const bronze = material("Brushed bronze", "#ad8950", 0.33, 0.75);
  const dark = material("Recessed joints", "#293730", 0.85);
  const earth = material("Garden soil", "#313b2d", 1);
  const bark = material("Tree bark", "#555743", 1);
  const leaves = ["#4e6241", "#6e7950", "#8e9460", "#394f3b"].map((color, index) => material(`Foliage ${index + 1}`, color, 0.95));
  const paper = material("Reading desk paper", "#ede1bf", 0.9);
  const water = material("Courtyard water", "#386663", 0.22, 0.55);
  const glass = material("Lamp glass", "#ffdda1", 0.25);
  glass.emissive = new Color("#ffb96c");
  glass.emissiveIntensity = 0.6;
  const mesh = (group: Group, geometry: BufferGeometry, finish: MeshStandardMaterial, position: Point3 = [0, 0, 0]) => {
    const object = new Mesh(geometry, finish);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
    return object;
  };
  const box = (group: Group, size: Point3, position: Point3, finish: MeshStandardMaterial) => mesh(group, new BoxGeometry(...size), finish, position);
  const cylinder = (group: Group, radius: number, height: number, position: Point3, finish: MeshStandardMaterial, top = radius) => mesh(group, new CylinderGeometry(top, radius, height, 48), finish, position);
  const beam = (group: Group, from: Point3, to: Point3, radius: number, finish: MeshStandardMaterial) => {
    const start = new Vector3(...from); const end = new Vector3(...to);
    const object = mesh(group, new CylinderGeometry(radius * 0.65, radius, start.distanceTo(end), 8), finish);
    object.position.copy(start.add(end).multiplyScalar(0.5));
    object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...to).sub(new Vector3(...from)).normalize());
    return object;
  };

  // A continuous terrace, inset paving, and a garden approach give the objects a shared place.
  cylinder(architecture, 7.6, 0.18, [0, -0.24, 0], edge);
  cylinder(architecture, 7.3, 0.2, [0, -0.08, 0], stone);
  for (let x = -5; x <= 5; x++) for (let z = -4; z <= 4; z++) {
    if (Math.hypot(x, z) < 1.8) continue;
    box(architecture, [0.986, 0.04, 0.986], [x, 0.035, z], (x + z) % 4 === 0 ? plaster : stone);
  }
  for (let i = 0; i < 4; i++) box(architecture, [2.2 + i * 0.2, 0.12, 0.6], [0, -0.15 - i * 0.11, 6 + i * 0.65], stone);
  cylinder(architecture, 1.62, 0.24, [0, 0.14, 0], edge);
  cylinder(architecture, 1.52, 0.16, [0, 0.22, 0], dark);
  cylinder(architecture, 1.45, 0.04, [0, 0.31, 0], water);
  cylinder(architecture, 0.57, 0.32, [0, 0.39, 0], stone);
  cylinder(architecture, 0.49, 0.03, [0, 0.57, 0], earth);
  // Quiet concentric water ripples, modeled so they read from different camera positions.
  for (let radius = 0.72; radius < 1.4; radius += 0.23) {
    const ring = mesh(architecture, new TorusGeometry(radius, 0.006, 4, 96), bronze, [0, 0.336, 0]);
    ring.rotation.x = Math.PI / 2;
  }

  // Timber colonnades and a clerestory canopy leave the central garden open to the sky.
  for (const side of [-1, 1]) {
    box(architecture, [0.22, 2.5, 7.3], [side * 4.9, 1.25, 0], plaster);
    box(architecture, [0.35, 0.18, 7.6], [side * 4.9, 2.57, 0], stone);
    for (const z of [-3.6, 0, 3.6]) {
      box(architecture, [0.18, 3.9, 0.18], [side * 1.28, 1.95, z], timber);
      box(architecture, [0.18, 3.9, 0.18], [side * 4.9, 1.95, z], timber);
      box(architecture, [0.3, 0.18, 0.3], [side * 1.28, 0.14, z], bronze);
    }
    box(architecture, [0.18, 0.25, 7.5], [side * 1.28, 3.88, 0], timber);
    box(architecture, [0.18, 0.25, 7.5], [side * 4.9, 3.88, 0], timber);
    for (let z = -3.6; z <= 3.6; z += 0.27) {
      box(roof, [3.9, 0.11, 0.12], [side * 3.09, 4.02, z], endgrain);
    }
    box(roof, [4.05, 0.1, 7.65], [side * 3.09, 4.18, 0], plaster);
    // Low interior shelves, regularly spaced book spines, and carved vertical wall slats.
    for (let z = -3.3; z < 3.4; z += 0.18) box(architecture, [0.07, 2.05, 0.055], [side * 4.75, 1.5, z], timber);
    for (const z of [-1.7, 1.7]) {
      box(architecture, [0.42, 0.07, 1.5], [side * 4.45, 0.65, z], endgrain);
      box(architecture, [0.42, 0.07, 1.5], [side * 4.45, 1.1, z], endgrain);
      for (let i = 0; i < 8; i++) box(architecture, [0.22, 0.23 + (i % 3) * 0.035, 0.065], [side * 4.43, 0.8, z - 0.52 + i * 0.13], [stone, dark, timber][i % 3]);
    }
  }
  // A low rear wall, long seat, and individual seat slats complete the enclosure.
  box(architecture, [10, 0.72, 0.23], [0, 0.38, -3.95], plaster);
  for (const x of [-0.75, 0.75]) box(architecture, [0.15, 0.45, 0.55], [x, 0.3, -3.5], dark);
  for (let i = 0; i < 5; i++) box(architecture, [2.1, 0.055, 0.09], [0, 0.57, -3.72 + i * 0.12], timber);

  const leafGeometry = new SphereGeometry(1, 6, 4);
  const plant = (x: number, z: number, scale: number, seed: number, central = false) => {
    const base = central ? 0.55 : 0;
    const top = base + scale * 2.8;
    beam(architecture, [x, base, z], [x + 0.12 * scale, top, z - 0.1 * scale], 0.09 * scale, bark);
    for (let branch = 0; branch < 7; branch++) {
      const angle = branch * 2.399 + seed;
      const reach = (0.6 + (branch % 3) * 0.23) * scale;
      const end: Point3 = [x + Math.cos(angle) * reach, top - 0.2 * scale + (branch % 3) * 0.25 * scale, z + Math.sin(angle) * reach];
      beam(architecture, [x, top - scale, z], end, 0.025 * scale, bark);
      for (let leaf = 0; leaf < (central ? 45 : 16); leaf++) {
        const a = leaf * 2.399 + branch;
        const r = Math.sqrt((leaf + 1) / (central ? 45 : 16)) * scale * 0.58;
        const foliage = mesh(architecture, leafGeometry, leaves[(leaf + branch) % leaves.length],
          [end[0] + Math.cos(a) * r, end[1] + Math.sin(leaf * 1.7) * scale * 0.18, end[2] + Math.sin(a) * r]);
        foliage.scale.set(scale * 0.16, scale * 0.04, scale * 0.09);
        foliage.rotation.set(0.2 * Math.sin(a), a, 0.3);
      }
    }
  };
  // Layered garden perimeter; foreground remains open for the approach camera.
  for (let i = 0; i < 19; i++) {
    const angle = Math.PI * 0.58 + i / 18 * Math.PI * 1.3;
    const radius = 8.6 + (i % 3) * 1.5;
    plant(Math.sin(angle) * radius, Math.cos(angle) * radius, 1.2 + (i % 4) * 0.25, i);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 14; i++) {
    const x = side * (5.45 + (i % 3) * 0.38); const z = -3.4 + i * 0.48;
    const shrub = mesh(architecture, new SphereGeometry(0.4, 10, 6), leaves[i % 4], [x, 0.3, z]);
    shrub.scale.set(1.3, 0.85 + (i % 3) * 0.18, 1);
  }
  bake(architecture);
  bake(roof);

  const stations: Group[] = [];
  const desks: Group[] = [];
  const lights: PointLight[] = [];
  for (let index = 0; index < count; index++) {
    const station = new Group(); station.name = `Chapter display ${index + 1}`;
    cylinder(station, 1.18, 0.18, [0, 0.15, 0], edge);
    cylinder(station, 1.12, 0.2, [0, 0.34, 0], timber);
    cylinder(station, 1.15, 0.025, [0, 0.45, 0], bronze);
    cylinder(station, 1.13, 0.09, [0, 0.505, 0], stone);
    for (let flute = 0; flute < 48; flute++) {
      const angle = flute / 48 * Math.PI * 2;
      cylinder(station, 0.018, 0.2, [Math.sin(angle) * 1.12, 0.34, Math.cos(angle) * 1.12], endgrain);
    }
    // A small working folio in front of each artifact, with two page blocks and a brass spine.
    box(station, [1.05, 0.06, 0.56], [0, 0.68, 1.27], timber);
    for (const x of [-0.36, 0.36]) box(station, [0.06, 0.52, 0.06], [x, 0.39, 1.3], bronze);
    for (const x of [-0.25, 0.25]) {
      box(station, [0.47, 0.045, 0.48], [x, 0.725, 1.27], paper);
      for (let line = 0; line < 5; line++) box(station, [line === 4 ? 0.19 : 0.34, 0.002, 0.005], [x, 0.75, 1.14 + line * 0.055], bronze);
    }
    box(station, [0.025, 0.014, 0.48], [0, 0.75, 1.27], bronze);
    // Visible lanterns make the dusk light originate from modeled fixtures.
    box(station, [0.065, 2.75, 0.065], [0.95, 1.4, -0.95], bronze);
    cylinder(station, 0.14, 0.07, [0.95, 2.81, -0.95], bronze);
    cylinder(station, 0.09, 0.26, [0.95, 2.65, -0.95], glass);
    cylinder(station, 0.14, 0.04, [0.95, 2.5, -0.95], bronze);
    bake(station);
    const lid = new Group(); lid.name = "Reading desk hinge";
    lid.position.set(0, 0.78, 0.98);
    box(lid, [1.08, 0.04, 0.58], [0, 0, 0.29], timber);
    box(lid, [1, 0.015, 0.5], [0, -0.027, 0.29], paper);
    box(lid, [0.18, 0.025, 0.04], [0, 0.031, 0.52], bronze);
    bake(lid);
    station.add(lid);
    const light = new PointLight("#ffd3a0", 1, 5, 2);
    light.position.set(0.95, 2.6, -0.95);
    station.add(light);
    station.position.set(...stationPosition(index, false, count));
    root.add(station);
    stations.push(station); desks.push(lid); lights.push(light);
  }
  let state: WorldState = { roofOpen: true, lighting: "day", open: [], unfolded: false };
  roof.visible = false;
  const approach = (current: number, goal: number, fraction: number) => Math.abs(goal - current) < 0.001 ? goal : current + (goal - current) * fraction;
  const tick = (seconds: number) => {
    const fraction = seconds >= 1 ? 1 : 1 - Math.exp(-Math.max(0, seconds) * 9);
    let moving = false;
    desks.forEach((desk, index) => {
      const goal = state.open[index] ? -1.25 : 0;
      desk.rotation.x = approach(desk.rotation.x, goal, fraction);
      moving ||= desk.rotation.x !== goal;
      const destination = state.comparison?.positions[index] ?? stationPosition(index, state.unfolded, count);
      for (const [axis, value] of (["x", "y", "z"] as const).map((axis, i) => [axis, destination[i]] as const)) {
        stations[index].position[axis] = approach(stations[index].position[axis], value, fraction);
        moving ||= stations[index].position[axis] !== value;
      }
    });
    return moving;
  };
  return { root, roof, instrument, stations, desks, tick, setState(next) {
    state = next;
    architecture.visible = !state.comparison;
    instrument.root.visible = !state.comparison;
    roof.visible = !state.comparison && !state.roofOpen;
    stations.forEach((station, index) => { station.visible = !state.comparison || state.comparison.indices.includes(index); });
    glass.emissiveIntensity = state.lighting === "dusk" ? 3 : 0.6;
    lights.forEach(light => { light.intensity = state.lighting === "dusk" ? 18 : 0.4; });
  } };
}
