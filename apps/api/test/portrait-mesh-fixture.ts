export function fixtureGlb(
  extras: Record<string, string>,
  override: Record<string, unknown> = {},
) {
  const binary = new Uint8Array(80);
  const view = new DataView(binary.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((v, i) =>
    view.setFloat32(i * 4, v, true),
  );
  [0, 1, 2].forEach((v, i) => view.setUint16(72 + i * 2, v, true));
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: extras.chapterId, extras, mesh: 0 }],
    buffers: [{ byteLength: 80 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.5,
        },
      },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    ...override,
  };
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(raw.length / 4) * 4;
  const output = new Uint8Array(12 + 8 + length + 8 + binary.length);
  const header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, length, true);
  header.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + length);
  output.set(raw, 20);
  header.setUint32(20 + length, binary.length, true);
  header.setUint32(24 + length, 0x004e4942, true);
  output.set(binary, 28 + length);
  return output;
}
