/**
 * Deterministic, manually authored fictional reference-based meshes.
 * No pixels are converted to geometry: the four inspected images are artistic
 * references, and their hashes bind these particular fixtures to those images.
 * Run: node scripts/portrait-explorer/build-fixture-assets.mjs
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const vector = (point) => new THREE.Vector3(...point);
const material = (name, color, metallic, roughness) => ({ name, color, metallic, roughness });
const BRASS = material("warm machined brass", "#c89b52", 0.78, 0.3);
const EDGE = material("polished brass edges", "#ecc482", 0.84, 0.23);
const DARK = material("recessed antique brass", "#75562b", 0.72, 0.42);
const SATIN = material("satin brushed brass", "#ba9259", 0.64, 0.5);
const BLUE = material("blued steel needle", "#1f638b", 0.7, 0.24);
const OAK = material("honey oak with carved grain", "#b38250", 0, 0.65);
const END = material("oak end grain and joinery", "#cb9a64", 0, 0.67);
const GRAIN = material("subtle oak grain", "#926138", 0, 0.8);
const LEATHER = material("aged brown leather", "#493126", 0, 0.83);
const THREAD = material("leather stitching", "#8a6b44", 0, 0.86);
const GLASS = material("deep blue optical glass", "#153c47", 0.32, 0.13);
const HEMP = material("natural twisted hemp", "#b39260", 0, 0.95);

class Model {
  constructor(chapterId, name) {
    this.chapterId = chapterId;
    this.name = name;
    this.parts = [];
  }

  add(geometry, surface, name, transform = {}) {
    if (transform.rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...transform.rotation)));
    if (transform.quaternion) geometry.applyQuaternion(transform.quaternion);
    if (transform.position) geometry.translate(...transform.position);
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("uv1");
    geometry.clearGroups();
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    // Modest vertex variation keeps materials tactile without external textures.
    // Grain changes along the object, not with the camera or renderer state.
    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const wood = surface === OAK || surface === END;
      const leather = surface === LEATHER;
      const variation = wood
        ? 0.91 + 0.075 * Math.sin(49 * x + 1.4 * Math.sin(8 * y) + 3 * z) + 0.025 * Math.sin(157 * x + 9 * z)
        : leather ? 0.89 + 0.07 * Math.sin(118 * x + 34 * z) * Math.sin(95 * y + 13 * x)
          : 0.97 + 0.025 * Math.sin(27 * x + 19 * y + 11 * z);
      colors.set([variation, variation, variation], index * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push({ geometry: mergeVertices(geometry, 0.000001), material: surface, name });
  }

  tube(points, radius, surface, name, segments = 48, sides = 6, closed = false) {
    const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points.map(vector), closed, "centripetal");
    this.add(new THREE.TubeGeometry(curve, segments, radius, sides, closed), surface, name);
    // TubeGeometry intentionally leaves both ends open; rounded end caps close
    // these authored rails/cords and remain visible from the rear and underside.
    if (!closed) for (const t of [0, 1]) {
      this.add(new THREE.SphereGeometry(radius, sides, 4), surface, `${name} rounded end`, { position: curve.getPointAt(t).toArray() });
    }
  }
}

function roundedBox(width, height, depth, radius = 0.025, segments = [1, 1, 1]) {
  const geometry = new THREE.BoxGeometry(width, height, depth, ...segments);
  const positions = geometry.getAttribute("position");
  const half = [width / 2, height / 2, depth / 2];
  // Subdivide bevels by using a standard shape extrusion for thin components.
  // For sturdy rails the sphere-clamped surface gives honest rounded joinery.
  for (let index = 0; index < positions.count; index++) {
    const p = [positions.getX(index), positions.getY(index), positions.getZ(index)];
    const q = p.map((value, axis) => THREE.MathUtils.clamp(value, -half[axis] + radius, half[axis] - radius));
    const delta = vector(p).sub(vector(q)).normalize().multiplyScalar(radius);
    positions.setXYZ(index, q[0] + delta.x, q[1] + delta.y, q[2] + delta.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function bevelShape(points, depth, bevel = 0.012, steps = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (const point of points.slice(1)) shape.lineTo(...point);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16,
    steps,
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  return geometry;
}

function lathe(profile, segments = 72) {
  return new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), segments);
}

function ring(model, radius, tube, y, surface, name, rotation = [Math.PI / 2, 0, 0], segments = 72) {
  model.add(new THREE.TorusGeometry(radius, tube, 6, segments), surface, name, { rotation, position: [0, y, 0] });
}

function pin(model, position, radius = 0.023, length = 0.022, surface = EDGE, axis = Y, name = "joinery pin") {
  model.add(new THREE.CylinderGeometry(radius, radius, length, 12), surface, name, {
    position,
    quaternion: new THREE.Quaternion().setFromUnitVectors(Y, axis),
  });
}

function compass() {
  const model = new Model("chapter-1", "Brass compass with a blue needle");
  model.add(lathe([[0, -0.17], [0.9, -0.17], [0.95, -0.16], [0.97, -0.13], [0.97, 0.09], [0.955, 0.115], [0.91, 0.115], [0.89, 0.075], [0.89, -0.075], [0, -0.075]]), BRASS, "solid machined case and back");
  model.add(lathe([[0, -0.06], [0.755, -0.06], [0.765, -0.04], [0.765, -0.015], [0.745, 0], [0, 0]]), SATIN, "solid recessed compass bowl");
  model.add(lathe([[0.767, -0.03], [0.803, -0.03], [0.824, 0.008], [0.824, 0.087], [0.81, 0.11], [0.786, 0.11], [0.767, 0.085], [0.767, -0.03]]), BRASS, "inner raised circular bezel");
  ring(model, 0.95, 0.014, 0.12, EDGE, "outer rolled brass lip");
  ring(model, 0.955, 0.012, -0.13, EDGE, "rear rolled edge");
  ring(model, 0.786, 0.011, 0.108, EDGE, "inner polished lip");
  ring(model, 0.745, 0.008, -0.003, DARK, "recess shadow ring");
  for (const y of [-0.09, -0.072, -0.052]) ring(model, 0.971, 0.0024, y, DARK, "fine machined case groove", undefined, 72);
  // The gimbal is a solid rectangular annulus, with a real central opening.
  model.add(lathe([[0.854, -0.009], [0.888, -0.009], [0.897, 0], [0.897, 0.047], [0.887, 0.056], [0.854, 0.056], [0.848, 0.046], [0.848, 0], [0.854, -0.009]]), EDGE, "tilted gimbal suspension ring", { rotation: [0.085, 0, 0.065], position: [0, 0.072, 0] });
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2 + 0.22;
    const position = [0.875 * Math.cos(angle), 0.15 + 0.034 * Math.sin(angle), 0.875 * Math.sin(angle)];
    model.add(new THREE.SphereGeometry(0.035, 12, 8), EDGE, "gimbal pivot head", { position });
  }
  for (let index = 0; index < 36; index++) {
    const angle = index / 36 * TAU;
    const length = index % 3 === 0 ? 0.035 : 0.017;
    model.add(new THREE.BoxGeometry(0.003, 0.0025, length), DARK, "subtle bezel graduation", { rotation: [0, angle, 0], position: [0.805 * Math.sin(angle), 0.112, 0.805 * Math.cos(angle)] });
  }
  // Raised four-sided diamond cross section gives the blue needle a visible
  // edge and distinct highlight, rather than using a colored image plane.
  const needle = new THREE.BufferGeometry();
  needle.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0.135, -0.7, 0.092, 0.135, 0, 0, 0.171, 0, -0.092, 0.135, 0, 0, 0.135, 0.7, 0, 0.111, 0,
  ], 3));
  needle.setIndex([0, 2, 1, 0, 3, 2, 4, 1, 2, 4, 2, 3, 0, 1, 5, 0, 5, 3, 4, 5, 1, 4, 3, 5]);
  needle.computeVertexNormals();
  model.add(needle.toNonIndexed(), BLUE, "three dimensional blued steel diamond needle", { rotation: [0, -0.48, 0] });
  pin(model, [0, 0.108, 0], 0.078, 0.05, DARK, Y, "needle spindle base");
  pin(model, [0, 0.18, 0], 0.064, 0.043, EDGE, Y, "needle spindle cap");
  model.add(new THREE.TorusGeometry(0.049, 0.008, 6, 24), BRASS, "spindle cap bevel", { rotation: [Math.PI / 2, 0, 0], position: [0, 0.204, 0] });
  const stem = new THREE.Vector3(1, 0, 0);
  pin(model, [1.01, -0.03, 0], 0.072, 0.14, DARK, stem, "setting crown neck");
  pin(model, [1.08, -0.03, 0], 0.09, 0.063, BRASS, stem, "setting crown");
  for (let index = 0; index < 20; index++) {
    const angle = index / 20 * TAU;
    model.add(new THREE.BoxGeometry(0.046, 0.007, 0.011), EDGE, "crown knurl", { rotation: [angle, 0, 0], position: [1.082, -0.03 + 0.09 * Math.cos(angle), 0.09 * Math.sin(angle)] });
  }
  return model;
}

function bench() {
  const model = new Model("chapter-2", "Two-seat wooden rocking bench");
  // Rockers have a continuous curved rectangular cross section: broad enough
  // to read from either side, and visibly joined to four complete legs.
  for (const x of [-0.85, 0.85]) {
    const outline = [];
    for (let i = 0; i <= 24; i++) {
      const z = -0.72 + i / 24 * 1.5;
      outline.push([z, 0.07 + 0.28 * z * z]);
    }
    for (let i = 24; i >= 0; i--) {
      const z = -0.72 + i / 24 * 1.5;
      outline.push([z, -0.035 + 0.28 * z * z]);
    }
    model.add(bevelShape(outline, 0.13, 0.014), OAK, "continuous curved rocker", { rotation: [0, Math.PI / 2, 0], position: [x, 0, 0] });
    for (const z of [-0.45, 0.44]) {
      const rear = z < 0;
      const height = rear ? 1.59 : 0.93;
      model.add(roundedBox(0.103, height, 0.108, 0.017, [3, 10, 3]), OAK, rear ? "continuous back leg and upright" : "front arm support and leg", {
        position: [x, height / 2 + 0.04, z - (rear ? 0.06 : 0)], rotation: [rear ? -0.09 : 0.04, 0, 0],
      });
      pin(model, [x + Math.sign(x) * 0.055, 0.55, z], 0.018, 0.006, END, new THREE.Vector3(Math.sign(x), 0, 0), "wooden mortise plug");
    }
    model.add(roundedBox(0.15, 0.088, 0.88, 0.022, [4, 3, 12]), OAK, "rounded full-length armrest", { position: [x, 0.98, -0.005], rotation: [-0.06, 0, 0] });
    model.add(roundedBox(0.073, 0.085, 0.85, 0.009, [2, 2, 8]), OAK, "seat side apron", { position: [x, 0.51, 0] });
  }
  model.add(roundedBox(1.7, 0.112, 0.085, 0.012, [18, 3, 2]), OAK, "front seat apron", { position: [0, 0.51, 0.425] });
  model.add(roundedBox(1.7, 0.088, 0.076, 0.011, [18, 2, 2]), OAK, "rear seat apron", { position: [0, 0.51, -0.42] });
  model.add(roundedBox(1.68, 0.06, 0.06, 0.007, [18, 2, 2]), OAK, "rear stretcher", { position: [0, 0.28, -0.44] });
  // Two distinct carved seat pans, with softened fronts and a restrained dish.
  for (const seatX of [-0.422, 0.422]) {
    const seat = roundedBox(0.827, 0.105, 0.88, 0.033, [14, 3, 14]);
    const positions = seat.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const dip = 0.035 * Math.max(0, 1 - (x / 0.42) ** 2) * Math.max(0, 1 - (z / 0.46) ** 2);
      positions.setY(index, positions.getY(index) - dip);
    }
    seat.computeVertexNormals();
    model.add(seat, OAK, "sculpted individual seat pan", { position: [seatX, 0.62, 0] });
    // Delicate flowing lines sit flush with the seat, and expose actual grain
    // in close views without a raster texture or camera-facing detail plane.
    for (let grain = 0; grain < 9; grain++) {
      const z = -0.33 + grain * 0.079;
      const points = [];
      for (let step = 0; step <= 10; step++) {
        const x = -0.37 + step * 0.074;
        const zz = z + 0.008 * Math.sin(x * 7 + grain);
        const dip = 0.035 * Math.max(0, 1 - (x / 0.42) ** 2) * Math.max(0, 1 - (zz / 0.46) ** 2);
        points.push([seatX + x, 0.673 - dip, zz]);
      }
      model.tube(points, 0.00085, GRAIN, "carved seat grain", 12, 3);
    }
    // The two arched crowns retain the reference's unmistakable double seat.
    const crown = [];
    for (let i = 0; i <= 16; i++) {
      const x = -0.386 + i / 16 * 0.772;
      crown.push([x, 1.61 + 0.115 * Math.sin(i / 16 * Math.PI)]);
    }
    for (let i = 16; i >= 0; i--) {
      const x = -0.386 + i / 16 * 0.772;
      crown.push([x, 1.49 + 0.093 * Math.sin(i / 16 * Math.PI)]);
    }
    model.add(bevelShape(crown, 0.085, 0.014), OAK, "arched individual back crown", { position: [seatX, 0, -0.603] });
    for (let slat = 0; slat < 5; slat++) {
      const x = seatX + (slat - 2) * 0.143;
      const slatHeight = 0.91 + 0.055 * Math.cos((slat - 2) * 0.7);
      model.add(roundedBox(0.111, slatHeight, 0.062, 0.011, [3, 10, 3]), OAK, "individual bowed back slat", {
        position: [x, 1.11, -0.524], rotation: [-0.13, 0, 0],
      });
      for (let grain = 0; grain < 2; grain++) {
        const points = [];
        for (let i = 0; i <= 12; i++) {
          const y = 0.72 + i / 12 * 0.78;
          points.push([x + (grain - 0.5) * 0.04 + Math.sin(i * 0.4 + slat) * 0.004, y, -0.49 - (y - 1.11) * 0.13]);
        }
        model.tube(points, 0.0009, GRAIN, "longitudinal back slat grain", 12, 3);
      }
      for (const y of [0.76, 1.5]) pin(model, [x, y, -0.487 - (y - 1.11) * 0.13], 0.011, 0.005, END, new THREE.Vector3(0, 0, 1), "flush back slat peg");
    }
  }
  model.add(roundedBox(0.075, 1.01, 0.081, 0.012, [3, 14, 3]), OAK, "central divided back upright", { position: [0, 1.13, -0.54], rotation: [-0.105, 0, 0] });
  return model;
}

function braidedRope(model, points, name, samples, radius = 0.039, twistPitch = 0.16) {
  const curve = new THREE.CatmullRomCurve3(points.map(vector), false, "centripetal");
  const frames = curve.computeFrenetFrames(samples, false);
  const length = curve.getLength();
  // Three continuous helical strands overlap into a solid rope cross-section.
  // Their actual silhouette changes at every twist, including rear/side views.
  for (let strand = 0; strand < 3; strand++) {
    const positions = [];
    for (let index = 0; index <= samples; index++) {
      const t = index / samples;
      const phase = length * t / twistPitch * TAU + strand / 3 * TAU;
      const point = curve.getPointAt(t)
        .addScaledVector(frames.normals[index], Math.cos(phase) * radius * 0.57)
        .addScaledVector(frames.binormals[index], Math.sin(phase) * radius * 0.57);
      positions.push(point);
    }
    const strandCurve = new THREE.CatmullRomCurve3(positions, false, "centripetal");
    model.tube(strandCurve, radius * 0.64, HEMP, `${name} continuous twisted strand ${strand + 1}`, samples, 5);
  }
}

function rope() {
  const model = new Model("chapter-3", "Coiled hemp rope with a loop and knot");
  const coil = [];
  const turns = 3.15;
  for (let index = 0; index <= 145; index++) {
    const t = index / 145;
    const angle = t * turns * TAU + 0.8;
    const radius = 0.12 + t * 0.385;
    coil.push([-0.35 + radius * Math.cos(angle), 0.065 + 0.005 * Math.sin(angle * 2), 0.25 + radius * Math.sin(angle)]);
  }
  // The loose coil end lies visibly on the outside, not hidden inside a disk.
  const end = coil.at(-1);
  coil.push([end[0] + 0.06, 0.07, end[2] + 0.04], [end[0] + 0.14, 0.075, end[2] + 0.01]);
  braidedRope(model, coil, "three-turn grounded coil", 550, 0.041, 0.155);
  const bridge = [
    [-0.27, 0.065, 0.34], [-0.18, 0.09, 0.32], [0.03, 0.135, 0.16], [0.18, 0.12, -0.08], [0.23, 0.16, -0.25],
  ];
  braidedRope(model, bridge, "coil to knot standing part", 90, 0.041);
  const eye = [
    [0.19, 0.18, -0.27], [0.1, 0.16, -0.46], [0.06, 0.12, -0.7], [0.17, 0.09, -0.82], [0.35, 0.09, -0.79],
    [0.43, 0.12, -0.63], [0.36, 0.17, -0.45], [0.29, 0.16, -0.3],
  ];
  braidedRope(model, eye, "open eye loop", 140, 0.041);
  const knot = [];
  for (let index = 0; index <= 42; index++) {
    const t = index / 42;
    const a = t * TAU * 2.2 + 0.4;
    knot.push([0.235 + 0.112 * Math.cos(a), 0.185 + 0.115 * Math.sin(a), -0.36 + t * 0.18]);
  }
  knot.push([0.3, 0.1, -0.15], [0.33, 0.075, -0.07]);
  braidedRope(model, knot, "over and under binding knot", 180, 0.042, 0.145);
  const tail = [
    [0.16, 0.115, -0.25], [0.4, 0.09, -0.22], [0.67, 0.065, -0.24], [0.86, 0.065, -0.39], [0.9, 0.065, -0.65],
    [0.79, 0.065, -0.8], [0.66, 0.065, -0.91], [0.69, 0.065, -1.05], [0.86, 0.065, -1.1], [1.02, 0.065, -1.05],
  ];
  braidedRope(model, tail, "loose curving standing end", 210, 0.041);
  // Short uneven fibers make the exposed cut ends read as rope, not hose.
  for (const [endPoint, direction] of [[coil.at(-1), 1], [tail.at(-1), 1]]) {
    for (let index = 0; index < 7; index++) {
      const angle = index / 7 * TAU;
      const p = [endPoint[0], endPoint[1] + Math.cos(angle) * 0.022, endPoint[2] + Math.sin(angle) * 0.022];
      model.tube([p, [p[0] + 0.018 * direction, p[1] + 0.003, p[2]], [p[0] + (0.033 + 0.007 * Math.sin(index)) * direction, p[1] - 0.002, p[2] + 0.005]], 0.003, HEMP, "uneven cut hemp fiber", 4, 4);
    }
  }
  return model;
}

function spyglass() {
  const model = new Model("chapter-4", "Collapsible brass and leather spyglass");
  const orientation = { rotation: [0, 0, -Math.PI / 2] };
  // Turned nested barrels have closed outer walls and an open optical mouth.
  // Each profile includes its inner return wall, avoiding a paper-thin rim.
  const body = (profile, surface, name, segments = 48) => model.add(lathe(profile, segments), surface, name, orientation);
  body([[0.168, -1.04], [0.19, -1.04], [0.203, -1.016], [0.203, -0.99], [0.196, -0.98], [0.196, -0.27], [0.203, -0.25], [0.203, -0.21], [0.18, -0.19], [0.16, -0.21], [0.168, -1.04]], BRASS, "objective barrel complete brass shell");
  body([[0.195, -0.965], [0.203, -0.965], [0.211, -0.94], [0.211, -0.29], [0.204, -0.268], [0.195, -0.268], [0.195, -0.965]], LEATHER, "thick leather objective sleeve", 64);
  body([[0.146, -0.25], [0.172, -0.25], [0.175, -0.23], [0.175, 0.23], [0.169, 0.253], [0.151, 0.253], [0.143, 0.235], [0.143, -0.23], [0.146, -0.25]], SATIN, "first telescoping brass drawtube");
  body([[0.112, 0.19], [0.142, 0.19], [0.145, 0.21], [0.145, 0.6], [0.139, 0.624], [0.121, 0.624], [0.111, 0.605], [0.112, 0.19]], BRASS, "second telescoping brass drawtube");
  body([[0.083, 0.58], [0.113, 0.58], [0.117, 0.6], [0.117, 0.98], [0.124, 0.995], [0.124, 1.025], [0.117, 1.04], [0.079, 1.04], [0.074, 1.016], [0.083, 0.58]], SATIN, "third drawtube and complete eyepiece mouth");
  for (const [x, radius, width] of [[-1.025, 0.204, 0.025], [-0.995, 0.204, 0.014], [-0.258, 0.214, 0.018], [-0.194, 0.194, 0.02], [0.242, 0.172, 0.013], [0.612, 0.145, 0.013], [1.014, 0.125, 0.014]]) {
    body([[radius - 0.019, x - width], [radius, x - width], [radius + 0.006, x - width / 2], [radius + 0.006, x + width / 2], [radius, x + width], [radius - 0.019, x + width], [radius - 0.019, x - width]], EDGE, "polished drawtube collar", 48);
  }
  body([[0.204, -0.342], [0.22, -0.342], [0.22, -0.277], [0.204, -0.277], [0.204, -0.342]], BRASS, "wide knurled focus collar");
  for (let row = 0; row < 3; row++) for (let index = 0; index < 64; index++) {
    const angle = (index + row * 0.5) / 64 * TAU;
    model.add(new THREE.OctahedronGeometry(0.0048), EDGE, "diamond focus grip knurl", { position: [-0.329 + row * 0.019, 0.221 * Math.cos(angle), 0.221 * Math.sin(angle)], rotation: [angle, 0, Math.PI / 4] });
  }
  // Convex glass surfaces are solid shallow lenses, not flat transparency.
  for (const [x, radius, thickness] of [[-1.018, 0.161, 0.016], [1.018, 0.074, 0.01]]) {
    const lens = new THREE.SphereGeometry(radius, 48, 16);
    lens.scale(thickness / radius, 1, 1);
    model.add(lens, GLASS, "solid convex optical lens", { position: [x, 0, 0] });
  }
  // A real longitudinal seam and minute raised stitches run along the leather.
  model.tube([[-0.94, -0.148, 0.149], [-0.65, -0.148, 0.15], [-0.36, -0.148, 0.149]], 0.003, DARK, "leather sleeve seam", 12, 4);
  for (let index = 0; index < 22; index++) {
    const x = -0.926 + index * 0.026;
    model.tube([[x, -0.157, 0.141], [x + 0.01, -0.149, 0.153]], 0.0016, THREAD, "hand stitched leather seam", 1, 4);
  }
  return model;
}

function serializeModel(model) {
  const box = new THREE.Box3();
  for (const part of model.parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox);
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 2 / Math.max(size.x, size.y, size.z);
  const surfaces = [...new Set(model.parts.map((part) => part.material))];
  const json = {
    asset: { version: "2.0", generator: "Pattern/Like authored fictional fixture builder v1", copyright: "Pattern/Like fictional study; reference-based authored fixture" },
    scene: 0,
    scenes: [{ name: model.name, nodes: [0] }],
    nodes: [{ name: model.chapterId, mesh: 0, extras: { chapterId: model.chapterId, fictionalFixture: true, authoring: "manually authored reference-based geometry; not automatic image reconstruction" } }],
    meshes: [{ name: `${model.chapterId}-crafted-object`, primitives: [] }],
    materials: surfaces.map((surface) => ({
      name: surface.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...new THREE.Color(surface.color).toArray(), 1],
        metallicFactor: surface.metallic,
        roughnessFactor: surface.roughness,
      },
    })),
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const chunks = [];
  let byteOffset = 0;
  let triangles = 0;
  let vertices = 0;
  const finalBox = new THREE.Box3();
  const append = (typed, componentType, type, count, target, extrema) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
    bytes.copy(padded);
    const bufferView = json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target }) - 1;
    chunks.push(padded);
    byteOffset += padded.length;
    return json.accessors.push({ bufferView, componentType, count, type, ...extrema }) - 1;
  };
  for (const [materialIndex, surface] of surfaces.entries()) {
    const parts = model.parts.filter((part) => part.material === surface);
    const geometry = mergeGeometries(parts.map((part) => part.geometry), false);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    finalBox.union(geometry.boundingBox);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const color = geometry.getAttribute("color");
    const attributes = {
      POSITION: append(position.array, 5126, "VEC3", position.count, 34962, { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() }),
      NORMAL: append(normal.array, 5126, "VEC3", normal.count, 34962),
      COLOR_0: append(color.array, 5126, "VEC3", color.count, 34962),
    };
    const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
    const indices = append(new IndexArray(geometry.index.array), IndexArray === Uint32Array ? 5125 : 5123, "SCALAR", geometry.index.count, 34963);
    json.meshes[0].primitives.push({ attributes, indices, material: materialIndex, mode: 4, extras: { authoredParts: parts.map((part) => part.name) } });
    triangles += geometry.index.count / 3;
    vertices += position.count;
    geometry.dispose();
  }
  for (const part of model.parts) part.geometry.dispose();
  json.buffers[0].byteLength = byteOffset;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20);
  jsonBytes.copy(jsonChunk);
  const binary = Buffer.concat(chunks);
  const bytes = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonChunk.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(bytes, 20);
  const binaryHeader = 20 + jsonChunk.length;
  bytes.writeUInt32LE(binary.length, binaryHeader);
  bytes.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(bytes, binaryHeader + 8);
  return { bytes, bounds: { min: finalBox.min.toArray(), max: finalBox.max.toArray() }, triangles, vertices, drawCalls: surfaces.length, meshNodes: [model.chapterId], materials: surfaces.map((surface) => surface.name) };
}

export function parseGlb(bytes) {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error("Invalid GLB header");
  if (bytes.readUInt32LE(4) !== 2) throw new Error("Unsupported GLB version");
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error("GLB declared length mismatch");
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || jsonLength % 4 !== 0 || 28 + jsonLength > bytes.length) throw new Error("Invalid GLB JSON chunk");
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const offset = 20 + jsonLength;
  if (bytes.readUInt32LE(offset + 4) !== 0x004e4942 || offset + 8 + bytes.readUInt32LE(offset) !== bytes.length) throw new Error("Invalid GLB binary chunk");
  if (json.buffers?.some((buffer) => buffer.uri) || json.images?.length || json.textures?.length) throw new Error("GLB fixture must be self-contained without external dependencies or textures");
  return { json, binary: bytes.subarray(offset + 8) };
}

export async function buildFixtures(repo = fileURLToPath(new URL("../../", import.meta.url))) {
  const manifest = {
    version: 1,
    representation: "authored-fictional-fixture-glb-v1",
    authoring: {
      method: "deterministic hand-authored procedural mesh geometry",
      generator: "scripts/portrait-explorer/build-fixture-assets.mjs",
      generatorVersion: 1,
      description: "Authored fictional reference-based fixture assets; not automatic image reconstruction, recovered physical objects, or account-generated personal portraits.",
      source: "Four inspected native fictional-study images; geometric detail is an artistic interpretation of those references.",
    },
    coordinates: { upAxis: "Y", origin: "geometric bounds center", maximumDimension: 2, unit: "normalized artistic world unit" },
    assets: [],
  };
  const assets = [];
  const builders = [compass, bench, rope, spyglass];
  const names = ["compass", "bench", "rope", "spyglass"];
  const orientations = ["face +Y, bowl in XZ", "upright +Y, front +Z", "coil in XZ, knot above +Y", "length along X, objective -X, eyepiece +X"];
  for (const [index, builder] of builders.entries()) {
    const file = `${names[index]}.glb`;
    const sourceImage = `apps/web/src/preview/references/native-0${index + 1}.png`;
    const model = builder();
    const result = serializeModel(model);
    const { bytes, ...stats } = result;
    assets.push({ file, bytes });
    manifest.assets.push({
      chapterId: model.chapterId,
      file,
      title: model.name,
      sha256: hash(bytes),
      sourceImage,
      sourceImageSha256: hash(await readFile(resolve(repo, sourceImage))),
      byteLength: bytes.length,
      ...stats,
      orientation: orientations[index],
      fictionalFixture: true,
    });
  }
  return { manifest, assets };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const destination = resolve(repo, "apps/web/public/portrait-explorer");
  const { manifest, assets } = await buildFixtures(repo);
  await mkdir(destination, { recursive: true });
  for (const asset of assets) await writeFile(resolve(destination, asset.file), asset.bytes);
  await writeFile(resolve(destination, "fixtures.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const asset of manifest.assets) console.log(`${asset.file}: ${asset.byteLength} bytes, ${asset.triangles} triangles, ${asset.drawCalls} draw calls`);
  console.log(`Total: ${manifest.assets.reduce((sum, asset) => sum + asset.byteLength, 0)} bytes; ${manifest.assets.reduce((sum, asset) => sum + asset.triangles, 0)} triangles; ${manifest.assets.reduce((sum, asset) => sum + asset.drawCalls, 0)} draw calls.`);
}
