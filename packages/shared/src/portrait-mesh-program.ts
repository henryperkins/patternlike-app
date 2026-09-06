export const PORTRAIT_MESH_COMPILER_VERSION = "portrait-mesh-compiler/v1" as const;
export type MeshPoint3 = [number, number, number];
export type MeshPoint2 = [number, number];
export interface MeshIdentity { chapterId: string; documentRevision: string; sourceImageSha256: string; sourceTextSha256: string; }
export type PortraitMeshGeometry =
  | { kind: "box"; size: MeshPoint3; bevel: number }
  | { kind: "ellipsoid"; radii: MeshPoint3; segments: number }
  | { kind: "cylinder"; radiusTop: number; radiusBottom: number; height: number; segments: number }
  | { kind: "torus"; radius: number; tube: number; segments: number }
  | { kind: "lathe"; profile: MeshPoint2[]; segments: number }
  | { kind: "extrude"; outline: MeshPoint2[]; depth: number; bevel: number }
  | { kind: "path"; points: MeshPoint3[]; radius: number; segments: number; closed: boolean }
  | { kind: "braid"; points: MeshPoint3[]; radius: number; segments: number; closed: boolean; strands: number; twists: number };
export interface PortraitMeshMaterial { id: string; color: string; metalness: number; roughness: number; }
export interface PortraitMeshPart {
  name: string; material: string; position: MeshPoint3; rotation: MeshPoint3; scale: MeshPoint3;
  repeat: { count: number; translation: MeshPoint3; rotation: MeshPoint3 } | null;
  geometry: PortraitMeshGeometry;
}
export interface PortraitMeshProgram {
  version: "portrait-mesh-program/v1";
  materials: PortraitMeshMaterial[];
  parts: PortraitMeshPart[];
}

const number = (minimum: number, maximum: number) => ({ type: "number", minimum, maximum });
const integer = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
const tuple = (length: number, minimum = -8, maximum = 8) => ({ type: "array", items: number(minimum, maximum), minItems: length, maxItems: length });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const points = (dimension: number, minimum: number) => ({ type: "array", items: tuple(dimension), minItems: minimum, maxItems: 64 });
const kind = (value: string) => ({ type: "string", const: value });
const pathFields = { points: points(3, 2), radius: number(0.005, 4), segments: integer(8, 192), closed: { type: "boolean" } };
/** Structured-output schema; cross-field, topology and aggregate limits are enforced by the parser. */
export const PORTRAIT_MESH_PROGRAM_SCHEMA = object({
  version: kind("portrait-mesh-program/v1"),
  materials: { type: "array", minItems: 1, maxItems: 4, items: object({ id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$" }, color: { type: "string", pattern: "^#[a-fA-F0-9]{6}$" }, metalness: number(0, 1), roughness: number(0.1, 1) }) },
  parts: { type: "array", minItems: 1, maxItems: 128, items: object({
    name: { type: "string", minLength: 1, maxLength: 80 }, material: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$" },
    position: tuple(3), rotation: tuple(3, -Math.PI * 2, Math.PI * 2), scale: tuple(3, 0.01, 8),
    repeat: { anyOf: [{ type: "null" }, object({ count: integer(2, 64), translation: tuple(3), rotation: tuple(3, -Math.PI * 2, Math.PI * 2) })] },
    geometry: { anyOf: [
      object({ kind: kind("box"), size: tuple(3, 0.005, 8), bevel: number(0, 1) }),
      object({ kind: kind("ellipsoid"), radii: tuple(3, 0.005, 4), segments: integer(8, 32) }),
      object({ kind: kind("cylinder"), radiusTop: number(0, 4), radiusBottom: number(0, 4), height: number(0.005, 8), segments: integer(8, 64) }),
      object({ kind: kind("torus"), radius: number(0.005, 4), tube: number(0.005, 2), segments: integer(8, 64) }),
      object({ kind: kind("lathe"), profile: points(2, 3), segments: integer(8, 64) }),
      object({ kind: kind("extrude"), outline: points(2, 3), depth: number(0.005, 8), bevel: number(0, 1) }),
      object({ kind: kind("path"), ...pathFields }),
      object({ kind: kind("braid"), ...pathFields, strands: integer(2, 3), twists: integer(1, 32) }),
    ] },
  }) },
});

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const finite = (value: unknown, minimum: number, maximum: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
const whole = (value: unknown, minimum: number, maximum: number): value is number => finite(value, minimum, maximum) && Number.isInteger(value);
const point = (value: unknown, length: number, minimum = -8, maximum = 8): value is number[] => Array.isArray(value) && value.length === length && value.every(item => finite(item, minimum, maximum));
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
const same = (a: number[], b: number[]) => a.every((value, index) => Math.abs(value - b[index]!) < 0.00001);

function simplePolygon(value: unknown): value is MeshPoint2[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64 || !value.every(item => point(item, 2))) return false;
  const vertices = value as MeshPoint2[];
  const polygon = same(vertices[0]!, vertices.at(-1)!) ? vertices.slice(0, -1) : vertices;
  if (polygon.length < 3) return false;
  const orient = (a: MeshPoint2, b: MeshPoint2, c: MeshPoint2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const between = (a: MeshPoint2, b: MeshPoint2, c: MeshPoint2) => Math.abs(orient(a, b, c)) < 1e-9
    && c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9
    && c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
    if (same(a, b)) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      const c = polygon[j]!; const d = polygon[(j + 1) % polygon.length]!;
      if (between(a, b, c) || between(a, b, d) || between(c, d, a) || between(c, d, b)
        || (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0)) return false;
    }
  }
  return Math.abs(area) > 0.000001;
}

function geometry(value: unknown): value is PortraitMeshGeometry {
  if (!record(value)) return false;
  switch (value.kind) {
    case "box": return exact(value, ["kind", "size", "bevel"]) && point(value.size, 3, 0.005, 8)
      && finite(value.bevel, 0, 1) && value.bevel < Math.min(...value.size) / 2;
    case "ellipsoid": return exact(value, ["kind", "radii", "segments"]) && point(value.radii, 3, 0.005, 4) && whole(value.segments, 8, 32);
    case "cylinder": return exact(value, ["kind", "radiusTop", "radiusBottom", "height", "segments"])
      && finite(value.radiusTop, 0, 4) && finite(value.radiusBottom, 0, 4) && Math.max(value.radiusTop, value.radiusBottom) >= 0.005
      && finite(value.height, 0.005, 8) && whole(value.segments, 8, 64);
    case "torus": return exact(value, ["kind", "radius", "tube", "segments"]) && finite(value.radius, 0.005, 4)
      && finite(value.tube, 0.005, Math.min(2, value.radius * 0.6)) && whole(value.segments, 8, 64);
    case "lathe": return exact(value, ["kind", "profile", "segments"]) && simplePolygon(value.profile)
      && value.profile.every(([radius]) => radius >= 0.005) && whole(value.segments, 8, 64);
    case "extrude": return exact(value, ["kind", "outline", "depth", "bevel"]) && simplePolygon(value.outline)
      && finite(value.depth, 0.005, 8) && finite(value.bevel, 0, Math.min(1, value.depth / 3));
    case "path":
    case "braid": {
      const fields = ["kind", "points", "radius", "segments", "closed", ...(value.kind === "braid" ? ["strands", "twists"] : [])];
      if (!exact(value, fields) || !Array.isArray(value.points) || value.points.length < (value.closed ? 3 : 2) || value.points.length > 64
        || !value.points.every(item => point(item, 3)) || !finite(value.radius, 0.005, 4) || !whole(value.segments, 8, 192) || typeof value.closed !== "boolean") return false;
      const path = value.points as number[][];
      if (path.some((p, i) => path.slice(0, i).some(previous => same(p, previous)))) return false;
      // A reversal creates a zero-tangent cusp, overlapping tube sections and collapsed faces.
      const start = value.closed ? 0 : 1;
      const end = value.closed ? path.length : path.length - 1;
      for (let i = start; i < end; i++) {
        const a = path[(i + path.length - 1) % path.length]!;
        const b = path[i]!;
        const c = path[(i + 1) % path.length]!;
        const u = b.map((coordinate, axis) => coordinate - a[axis]!);
        const v = c.map((coordinate, axis) => coordinate - b[axis]!);
        const cosine = u.reduce((sum, coordinate, axis) => sum + coordinate * v[axis]!, 0) / (Math.hypot(...u) * Math.hypot(...v));
        if (!Number.isFinite(cosine) || cosine < -0.999999) return false;
      }
      return value.kind === "path" || (whole(value.strands, 2, 3) && whole(value.twists, 1, 32) && value.segments >= value.twists * 4);
    }
    default: return false;
  }
}

/** The sole executable vocabulary is compiled from validated numbers, never evaluated strings. */
export function parsePortraitMeshProgram(value: unknown): PortraitMeshProgram | null {
  if (!record(value) || !exact(value, ["version", "materials", "parts"]) || value.version !== "portrait-mesh-program/v1"
    || !Array.isArray(value.materials) || value.materials.length < 1 || value.materials.length > 4
    || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 128) return null;
  const materials = new Set<string>();
  for (const material of value.materials) {
    if (!record(material) || !exact(material, ["id", "color", "metalness", "roughness"])
      || typeof material.id !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(material.id) || materials.has(material.id)
      || typeof material.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(material.color)
      || !finite(material.metalness, 0, 1) || !finite(material.roughness, 0.1, 1)) return null;
    materials.add(material.id);
  }
  let expanded = 0;
  for (const part of value.parts) {
    if (!record(part) || !exact(part, ["name", "material", "position", "rotation", "scale", "repeat", "geometry"])
      || !text(part.name, 80) || typeof part.material !== "string" || !materials.has(part.material)
      || !point(part.position, 3) || !point(part.rotation, 3, -Math.PI * 2, Math.PI * 2) || !point(part.scale, 3, 0.01, 8) || !geometry(part.geometry)) return null;
    let count = 1;
    if (part.repeat !== null) {
      if (!record(part.repeat) || !exact(part.repeat, ["count", "translation", "rotation"]) || !whole(part.repeat.count, 2, 64)
        || !point(part.repeat.translation, 3) || !point(part.repeat.rotation, 3, -Math.PI * 2, Math.PI * 2)) return null;
      count = part.repeat.count;
      if (part.position.some((coordinate, i) => Math.abs(coordinate + (count - 1) * (part.repeat as { translation: number[] }).translation[i]!) > 32)) return null;
    }
    expanded += count * (part.geometry.kind === "braid" ? part.geometry.strands : 1);
    if (expanded > 512) return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).length > 64 * 1024) return null;
    return JSON.parse(serialized) as PortraitMeshProgram;
  } catch { return null; }
}
