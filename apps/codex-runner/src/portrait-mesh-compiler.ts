import { createHash } from "node:crypto";
import {
  Box3, BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry,
  Euler, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, Shape, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector2, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { canonicalJson, isPortraitChapterCount, parsePortraitMeshProgram, PORTRAIT_MESH_AUTHORING, PORTRAIT_MESH_COMPILER_VERSION,
  PORTRAIT_MESH_V2_AUTHORING, PORTRAIT_MESH_V2_COMPILER_VERSION,
  type MeshIdentity, type MeshPoint3, type PortraitMeshGeometry, type PortraitMeshMaterial, type PortraitMeshProgram } from "@patternlike/shared";

const MAX_TRIANGLES = 20_000;
const MAX_BYTES = 750_000;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export interface CompiledPortraitMesh {
  glb: Uint8Array; sha256: string; programSha256: string; triangles: number;
  bounds: { min: MeshPoint3; max: MeshPoint3 }; compilerVersion: typeof PORTRAIT_MESH_COMPILER_VERSION | typeof PORTRAIT_MESH_V2_COMPILER_VERSION;
}
export interface CompiledMeshModel {
  groups: Array<{ geometry: BufferGeometry; material: PortraitMeshMaterial }>;
  programSha256: string; triangles: number; bounds: CompiledPortraitMesh["bounds"];
}

function validateIdentity(identity: MeshIdentity) {
  if (!identity || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(identity.chapterId)
    || typeof identity.documentRevision !== "string" || !identity.documentRevision.trim() || identity.documentRevision.length > 512
    || /[\u0000-\u001f]/.test(identity.documentRevision) || !/^[a-f0-9]{64}$/.test(identity.sourceImageSha256)
    || !/^[a-f0-9]{64}$/.test(identity.sourceTextSha256)
    || (identity.chapterCount !== undefined && (!isPortraitChapterCount(identity.chapterCount)
      || !/^chapter-[1-6]$/.test(identity.chapterId)
      || Number(identity.chapterId.slice(8)) > identity.chapterCount))) throw new Error("Invalid mesh identity");
}

function compact(source: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(source.attributes)) if (name !== "position" && name !== "normal") source.deleteAttribute(name);
  source.clearGroups();
  if (!source.getAttribute("normal")) source.computeVertexNormals();
  const result = mergeVertices(source, 0.000001);
  source.dispose();
  return result;
}

function cappedTube(curve: CatmullRomCurve3, radius: number, segments: number, closed: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  try {
    const tube = new TubeGeometry(curve, segments, radius, 8, closed);
    if (!closed) for (const t of [0, 1]) {
      const normal = curve.getTangentAt(t).multiplyScalar(t === 0 ? -1 : 1).normalize();
      const center = curve.getPointAt(t);
      const positions = [...center.toArray()];
      const normals = [...normal.toArray()];
      const ring = tube.getAttribute("position");
      for (let i = 0; i < 8; i++) {
        positions.push(ring.getX(t * segments * 9 + i), ring.getY(t * segments * 9 + i), ring.getZ(t * segments * 9 + i));
        normals.push(...normal.toArray());
      }
      const a = new Vector3().fromArray(positions, 3).sub(center);
      const b = new Vector3().fromArray(positions, 6).sub(center);
      const outward = a.cross(b).dot(normal) > 0;
      const indices: number[] = [];
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8 + 1;
        indices.push(...(outward ? [0, i + 1, next] : [0, next, i + 1]));
      }
      const cap = new BufferGeometry();
      cap.setAttribute("position", new Float32BufferAttribute(positions, 3));
      cap.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      cap.setIndex(indices);
      parts.push(compact(cap));
    }
    parts.push(compact(tube));
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error("Invalid capped path");
    return merged;
  } finally { for (const part of parts) part.dispose(); }
}

function geometries(shape: PortraitMeshGeometry): BufferGeometry[] {
  switch (shape.kind) {
    case "box": return [compact(shape.bevel > 0 ? new RoundedBoxGeometry(...shape.size, 2, shape.bevel) : new BoxGeometry(...shape.size))];
    case "ellipsoid": {
      const result = new SphereGeometry(1, shape.segments, Math.ceil(shape.segments / 2));
      result.scale(...shape.radii);
      return [compact(result)];
    }
    case "cylinder": return [compact(new CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments, 1, false))];
    case "torus": return [compact(new TorusGeometry(shape.radius, shape.tube, 8, shape.segments))];
    case "lathe": {
      const profile = shape.profile.map(point => new Vector2(...point));
      if (!profile[0]!.equals(profile.at(-1)!)) profile.push(profile[0]!.clone());
      // Counterclockwise radial/height sections produce outward-facing revolutions.
      let area = 0;
      for (let i = 0; i < profile.length - 1; i++) area += profile[i]!.x * profile[i + 1]!.y - profile[i + 1]!.x * profile[i]!.y;
      if (area < 0) profile.reverse();
      return [compact(new LatheGeometry(profile, shape.segments))];
    }
    case "extrude": {
      const outline = new Shape(shape.outline.map(point => new Vector2(...point)));
      const result = new ExtrudeGeometry(outline, { depth: shape.depth - shape.bevel * 2, bevelEnabled: shape.bevel > 0,
        bevelThickness: shape.bevel, bevelSize: shape.bevel, bevelSegments: 2, steps: 1, curveSegments: 1 });
      result.translate(0, 0, -shape.depth / 2 + shape.bevel);
      return [compact(result)];
    }
    case "path": return [cappedTube(new CatmullRomCurve3(shape.points.map(point => new Vector3(...point)), shape.closed, "centripetal"), shape.radius, shape.segments, shape.closed)];
    case "braid": {
      const curve = new CatmullRomCurve3(shape.points.map(point => new Vector3(...point)), shape.closed, "centripetal");
      const frames = curve.computeFrenetFrames(shape.segments, shape.closed);
      const result: BufferGeometry[] = [];
      try {
        for (let strand = 0; strand < shape.strands; strand++) {
          const points: Vector3[] = [];
          for (let i = 0; i <= shape.segments; i++) {
            const t = i / shape.segments;
            const angle = (shape.twists * t + strand / shape.strands) * Math.PI * 2;
            points.push(curve.getPointAt(t).addScaledVector(frames.normals[i]!, Math.cos(angle) * shape.radius * 0.55)
              .addScaledVector(frames.binormals[i]!, Math.sin(angle) * shape.radius * 0.55));
          }
          if (shape.closed) points.pop();
          result.push(cappedTube(new CatmullRomCurve3(points, shape.closed, "centripetal"), shape.radius * 0.65, shape.segments, shape.closed));
        }
        return result;
      } catch (error) { for (const geometry of result) geometry.dispose(); throw error; }
    }
  }
}

/** Shared trusted CPU geometry path for GLB publication and the review images. Caller owns groups. */
export function createPortraitMeshModel(input: PortraitMeshProgram, identity: MeshIdentity): CompiledMeshModel {
  validateIdentity(identity);
  const program = parsePortraitMeshProgram(input);
  if (!program) throw new Error("Invalid mesh program");
  if (program.version === "portrait-mesh-program/v2"
    && (identity.chapterCount !== program.chapter_count || identity.chapterId !== program.chapter_id)) throw new Error("Mesh program identity mismatch");
  const parts: Array<{ geometry: BufferGeometry; material: string }> = [];
  const groups: CompiledMeshModel["groups"] = [];
  let triangles = 0;
  try {
    for (const part of program.parts) {
      const sources = geometries(part.geometry);
      try {
        const count = part.repeat?.count ?? 1;
        const addition = sources.reduce((sum, source) => sum + source.index!.count / 3, 0) * count;
        if (triangles + addition > MAX_TRIANGLES) throw new Error("Mesh triangle budget exceeded");
        triangles += addition;
        for (let repeat = 0; repeat < count; repeat++) {
          const position = new Vector3(...part.position);
          const rotation = [...part.rotation] as MeshPoint3;
          if (part.repeat) {
            position.addScaledVector(new Vector3(...part.repeat.translation), repeat);
            for (let axis = 0; axis < 3; axis++) rotation[axis] = rotation[axis]! + part.repeat.rotation[axis]! * repeat;
          }
          const transform = new Matrix4().compose(position, new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...part.scale));
          for (const source of sources) parts.push({ geometry: source.clone().applyMatrix4(transform), material: part.material });
        }
      } finally { for (const source of sources) source.dispose(); }
    }
    const bounds = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox!);
    }
    const size = bounds.getSize(new Vector3());
    const maximum = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maximum) || maximum <= 0 || Math.min(size.x, size.y, size.z) / maximum < 0.01) throw new Error("Mesh lacks substantial depth");
    const center = bounds.getCenter(new Vector3());
    const scale = 2 / maximum;
    const normalized = new Box3();
    for (const material of program.materials) {
      const matched = parts.filter(part => part.material === material.id).map(part => part.geometry);
      if (!matched.length) continue;
      const geometry = mergeGeometries(matched, false);
      if (!geometry) throw new Error("Invalid material geometry");
      groups.push({ geometry, material });
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.scale(scale, scale, scale);
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      for (let index = 0; index < positions.count; index++) {
        if (![positions.getX(index), positions.getY(index), positions.getZ(index), normals.getX(index), normals.getY(index), normals.getZ(index)].every(Number.isFinite)) throw new Error("Nonfinite compiled geometry");
        const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
        if (length < 0.9) throw new Error("Degenerate compiled normal");
        normals.setXYZ(index, normals.getX(index) / length, normals.getY(index) / length, normals.getZ(index) / length);
      }
      const a = new Vector3(); const b = new Vector3(); const c = new Vector3();
      const indices = geometry.index!;
      for (let index = 0; index < indices.count; index += 3) {
        a.fromBufferAttribute(positions, indices.getX(index));
        b.fromBufferAttribute(positions, indices.getX(index + 1)).sub(a);
        c.fromBufferAttribute(positions, indices.getX(index + 2)).sub(a);
        // Float32 output may collapse a formally positive bevel or tiny feature. Never publish zero-area faces.
        if (b.cross(c).lengthSq() === 0) throw new Error("Degenerate compiled triangle");
      }
      geometry.computeBoundingBox();
      normalized.union(geometry.boundingBox!);
    }
    return { groups, triangles, programSha256: hash(canonicalJson(program)), bounds: { min: normalized.min.toArray(), max: normalized.max.toArray() } };
  } catch (error) { for (const group of groups) group.geometry.dispose(); throw error; }
  finally { for (const part of parts) part.geometry.dispose(); }
}

/** Indexed opaque self-contained glTF. No loader plugins, images, animations, or executable metadata. */
export function compilePortraitMesh(program: PortraitMeshProgram, identity: MeshIdentity): CompiledPortraitMesh {
  const parsed = parsePortraitMeshProgram(program);
  if (!parsed) throw new Error("Invalid mesh program");
  const v2 = parsed.version === "portrait-mesh-program/v2";
  const compilerVersion = v2 ? PORTRAIT_MESH_V2_COMPILER_VERSION : PORTRAIT_MESH_COMPILER_VERSION;
  const authoring = v2 ? PORTRAIT_MESH_V2_AUTHORING : PORTRAIT_MESH_AUTHORING;
  const model = createPortraitMeshModel(parsed, identity);
  try {
    const json = {
      asset: { version: "2.0", generator: compilerVersion }, scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: identity.chapterId, mesh: 0, extras: {
        chapterId: identity.chapterId, documentRevision: identity.documentRevision, sourceImageSha256: identity.sourceImageSha256,
        sourceTextSha256: identity.sourceTextSha256, programSha256: model.programSha256,
        compilerVersion, authoring,
        ...(v2 ? { chapterCount: parsed.chapter_count } : {}),
      } }],
      meshes: [{ name: `${identity.chapterId}-object`, primitives: [] as Array<{ attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode: number }> }],
      materials: model.groups.map(({ material }) => ({ name: material.id, pbrMetallicRoughness: {
        baseColorFactor: [...new Color(material.color).toArray(), 1], metallicFactor: material.metalness, roughnessFactor: material.roughness,
      } })),
      accessors: [] as Array<Record<string, unknown>>, bufferViews: [] as Array<Record<string, number>>, buffers: [{ byteLength: 0 }],
    };
    const chunks: Buffer[] = [];
    let offset = 0;
    const append = (array: Float32Array | Uint16Array | Uint32Array, componentType: number, type: string, count: number, target: number, extrema = {}) => {
      const raw = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
      const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
      raw.copy(padded);
      const bufferView = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: raw.length, target }) - 1;
      offset += padded.length;
      if (offset > MAX_BYTES) throw new Error("Mesh payload budget exceeded");
      chunks.push(padded);
      return json.accessors.push({ bufferView, componentType, type, count, ...extrema }) - 1;
    };
    model.groups.forEach(({ geometry }, material) => {
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const indices = positions.count > 65535 ? new Uint32Array(geometry.index!.array) : new Uint16Array(geometry.index!.array);
      json.meshes[0]!.primitives.push({ attributes: {
        POSITION: append(new Float32Array(positions.array), 5126, "VEC3", positions.count, 34962, { min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray() }),
        NORMAL: append(new Float32Array(normals.array), 5126, "VEC3", normals.count, 34962),
      }, indices: append(indices, indices instanceof Uint32Array ? 5125 : 5123, "SCALAR", indices.length, 34963), material, mode: 4 });
    });
    json.buffers[0]!.byteLength = offset;
    const metadata = Buffer.from(JSON.stringify(json));
    const jsonChunk = Buffer.alloc(Math.ceil(metadata.length / 4) * 4, 0x20);
    metadata.copy(jsonChunk);
    const total = 28 + jsonChunk.length + offset;
    if (total > MAX_BYTES) throw new Error("Mesh payload budget exceeded");
    const glb = Buffer.alloc(total);
    glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
    glb.writeUInt32LE(jsonChunk.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(glb, 20);
    const binaryOffset = 20 + jsonChunk.length;
    glb.writeUInt32LE(offset, binaryOffset); glb.writeUInt32LE(0x004e4942, binaryOffset + 4);
    Buffer.concat(chunks).copy(glb, binaryOffset + 8);
    return { glb, sha256: hash(glb), programSha256: model.programSha256, triangles: model.triangles, bounds: model.bounds, compilerVersion };
  } finally { for (const group of model.groups) group.geometry.dispose(); }
}
