import sharp from "sharp";
import { Color, Vector3 } from "three";
import type { MeshIdentity, PortraitMeshProgram } from "@patternlike/shared";
import { createPortraitMeshModel, type CompiledMeshModel } from "./portrait-mesh-compiler.js";

const SIZE = 512;
const RASTER_BUDGET = 16_000_000;
const VIEWS = [
  { label: "front", direction: new Vector3(0, 0, 1) },
  { label: "rear", direction: new Vector3(0, 0, -1) },
  { label: "side", direction: new Vector3(1, 0, 0) },
  { label: "three-quarter", direction: new Vector3(1, 0.7, 1).normalize() },
];

interface RasterTriangle {
  vertices: Float64Array; a: number; b: number; c: number;
  area: number; x0: number; x1: number; y0: number; y1: number;
}
const srgb = (linear: number) => Math.round(255 * Math.min(1, linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));

/** Bounded orthographic z-buffer renderer. Reads only compiled positions, normals and opaque materials. */
function rasterize(model: CompiledMeshModel, direction: Vector3): Buffer {
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const key = direction.clone().multiplyScalar(0.8).addScaledVector(right, -0.5).addScaledVector(up, 0.9).normalize();
  const fill = direction.clone().multiplyScalar(0.5).addScaledVector(right, 1).normalize();
  const half = key.clone().add(direction).normalize();
  const triangles: RasterTriangle[] = [];
  let samples = 0;
  for (const { geometry, material } of model.groups) {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const indices = geometry.index!;
    // Gouraud lighting is deterministic and keeps per-pixel CPU work strictly bounded.
    const vertices = new Float64Array(positions.count * 6);
    const color = new Color(material.color);
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3().fromBufferAttribute(positions, i);
      const n = new Vector3().fromBufferAttribute(normals, i);
      const diffuse = 0.23 + 0.65 * Math.max(0, n.dot(key)) + 0.12 * Math.max(0, n.dot(fill));
      const highlight = Math.max(0, n.dot(half)) ** (4 + 96 * (1 - material.roughness) ** 2);
      const specular = highlight * (0.035 + material.metalness * 0.45);
      const shade = (channel: number) => srgb(Math.max(0, channel * diffuse * (1 - material.metalness * 0.35)
        + specular * (1 - material.metalness + material.metalness * channel)));
      vertices.set([SIZE / 2 + p.dot(right) * SIZE / 3.2, SIZE / 2 - p.dot(up) * SIZE / 3.2,
        -p.dot(direction), shade(color.r), shade(color.g), shade(color.b)], i * 6);
    }
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i) * 6; const b = indices.getX(i + 1) * 6; const c = indices.getX(i + 2) * 6;
      const area = (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!)
        - (vertices[b + 1]! - vertices[a + 1]!) * (vertices[c]! - vertices[a]!);
      // Canvas Y points down. Opaque glTF front faces therefore have negative projected area.
      if (area >= -0.000001) continue;
      const x0 = Math.max(0, Math.floor(Math.min(vertices[a]!, vertices[b]!, vertices[c]!)));
      const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(vertices[a]!, vertices[b]!, vertices[c]!)));
      const y0 = Math.max(0, Math.floor(Math.min(vertices[a + 1]!, vertices[b + 1]!, vertices[c + 1]!)));
      const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(vertices[a + 1]!, vertices[b + 1]!, vertices[c + 1]!)));
      samples += Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
      if (samples > RASTER_BUDGET) throw new Error("Mesh preview raster budget exceeded");
      triangles.push({ vertices, a, b, c, area, x0, x1, y0, y1 });
    }
  }
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < pixels.length; i += 3) { pixels[i] = 243; pixels[i + 1] = 240; pixels[i + 2] = 232; }
  const depth = new Float64Array(SIZE * SIZE).fill(Infinity);
  for (const { vertices: v, a, b, c, area, x0, x1, y0, y1 } of triangles) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const wa = ((v[b]! - px) * (v[c + 1]! - py) - (v[b + 1]! - py) * (v[c]! - px)) / area;
      const wb = ((v[c]! - px) * (v[a + 1]! - py) - (v[c + 1]! - py) * (v[a]! - px)) / area;
      const wc = 1 - wa - wb;
      if (wa < -0.0000001 || wb < -0.0000001 || wc < -0.0000001) continue;
      const z = wa * v[a + 2]! + wb * v[b + 2]! + wc * v[c + 2]!;
      const pixel = y * SIZE + x;
      if (z >= depth[pixel]!) continue;
      depth[pixel] = z;
      for (let channel = 0; channel < 3; channel++) pixels[pixel * 3 + channel] = Math.round(wa * v[a + 3 + channel]! + wb * v[b + 3 + channel]! + wc * v[c + 3 + channel]!);
    }
  }
  return pixels;
}

/** Fixed views use the identical geometry interpreter as publication; no browser, model code, or network. */
export async function renderPortraitMeshPreviews(program: PortraitMeshProgram, identity: MeshIdentity): Promise<Array<{ label: string; png: Buffer }>> {
  const model = createPortraitMeshModel(program, identity);
  try {
    const result: Array<{ label: string; png: Buffer }> = [];
    for (const view of VIEWS) result.push({ label: view.label, png: await sharp(rasterize(model, view.direction),
      { raw: { width: SIZE, height: SIZE, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer() });
    return result;
  } finally { for (const { geometry } of model.groups) geometry.dispose(); }
}
