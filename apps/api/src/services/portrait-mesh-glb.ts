/** Worker-safe GLB admission: one bounded embedded buffer, indexed solids, exact compiler identity. */
export function validatePortraitMeshGlb(
  bytes: Uint8Array,
  identity: Record<string, string>,
): boolean {
  try {
    if (bytes.length < 40 || bytes.length > 750000) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length ||
      view.getUint32(16, true) !== 0x4e4f534a
    )
      return false;
    const jsonLength = view.getUint32(12, true);
    const end = 20 + jsonLength;
    if (
      jsonLength % 4 ||
      end + 8 >= bytes.length ||
      view.getUint32(end + 4, true) !== 0x004e4942 ||
      end + 8 + view.getUint32(end, true) !== bytes.length
    )
      return false;
    const json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(20, end),
      ),
    );
    const binary = bytes.subarray(end + 8);
    const data = new DataView(
      binary.buffer,
      binary.byteOffset,
      binary.byteLength,
    );
    const integer = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
    const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (
      json.asset?.version !== "2.0" ||
      [
        "extensionsUsed",
        "extensionsRequired",
        "extensions",
        "images",
        "textures",
        "samplers",
        "animations",
        "skins",
        "cameras",
      ].some((k) => json[k] !== undefined)
    )
      return false;
    // Reject nested extension and resource references, even in unused graph nodes.
    const scan = (v: unknown): boolean =>
      !v || typeof v !== "object"
        ? true
        : Array.isArray(v)
          ? v.every(scan)
          : Object.entries(v).every(
              ([k, x]) =>
                ![
                  "uri",
                  "extensions",
                  "sparse",
                  "targets",
                  "skin",
                  "camera",
                ].includes(k) && scan(x),
            );
    if (
      !scan(json) ||
      !Array.isArray(json.buffers) ||
      json.buffers.length !== 1 ||
      !integer(json.buffers[0].byteLength, 1, binary.length) ||
      binary.length - json.buffers[0].byteLength > 3
    )
      return false;
    if (
      !Array.isArray(json.nodes) ||
      json.nodes.length < 1 ||
      json.nodes.length > 514 ||
      !Array.isArray(json.meshes) ||
      json.meshes.length < 1 ||
      json.meshes.length > 512 ||
      !Array.isArray(json.materials) ||
      json.materials.length < 1 ||
      json.materials.length > 4 ||
      !Array.isArray(json.bufferViews) ||
      !Array.isArray(json.accessors) ||
      json.accessors.length > 2048
    )
      return false;
    // The trusted compiler bakes every part into one named root mesh. This also
    // makes the triangle budget a rendered budget, with no reusable instances.
    if (
      json.nodes.length !== 1 ||
      json.meshes.length !== 1 ||
      json.nodes[0].name !== identity.chapterId ||
      json.nodes[0].mesh !== 0 ||
      Object.keys(json.nodes[0]).some(
        (key) => !["name", "mesh", "extras"].includes(key),
      )
    )
      return false;
    let identities = 0;
    for (const node of json.nodes) {
      if (node.extras?.chapterId !== undefined) {
        identities++;
        if (Object.entries(identity).some(([k, v]) => node.extras[k] !== v))
          return false;
      }
      if (
        node.matrix !== undefined &&
        (!Array.isArray(node.matrix) ||
          node.matrix.length !== 16 ||
          !node.matrix.every(finite))
      )
        return false;
      for (const [k, n] of [
        ["translation", 3],
        ["scale", 3],
        ["rotation", 4],
      ] as const)
        if (
          node[k] !== undefined &&
          (!Array.isArray(node[k]) ||
            node[k].length !== n ||
            !node[k].every(finite))
        )
          return false;
    }
    if (
      identities !== 1 ||
      !Array.isArray(json.scenes) ||
      json.scenes.length !== 1 ||
      (json.scene ?? 0) !== 0 ||
      !Array.isArray(json.scenes[0].nodes) ||
      json.scenes[0].nodes.length !== 1 ||
      json.scenes[0].nodes[0] !== 0
    )
      return false;
    const visited = new Set<number>();
    const usedMeshes = new Set<number>();
    const walk = (n: number): boolean => {
      if (!integer(n, 0, json.nodes.length - 1) || visited.has(n)) return false;
      visited.add(n);
      const node = json.nodes[n];
      if (node.mesh !== undefined) {
        if (!integer(node.mesh, 0, json.meshes.length - 1)) return false;
        usedMeshes.add(node.mesh);
      }
      return (
        node.children === undefined ||
        (Array.isArray(node.children) && node.children.every(walk))
      );
    };
    if (
      !json.scenes[0].nodes.every(walk) ||
      visited.size !== json.nodes.length ||
      usedMeshes.size !== json.meshes.length
    )
      return false;
    for (const material of json.materials) {
      if (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE")
        return false;
      const pbr = material.pbrMetallicRoughness;
      if (
        !pbr ||
        pbr.baseColorTexture ||
        material.normalTexture ||
        material.emissiveTexture ||
        material.occlusionTexture ||
        pbr.metallicRoughnessTexture
      )
        return false;
      if (
        pbr.baseColorFactor !== undefined &&
        (!Array.isArray(pbr.baseColorFactor) ||
          pbr.baseColorFactor.length !== 4 ||
          !pbr.baseColorFactor.every(
            (x: unknown) => finite(x) && Number(x) >= 0 && Number(x) <= 1,
          ) ||
          pbr.baseColorFactor[3] !== 1)
      )
        return false;
    }
    for (const buffer of json.bufferViews)
      if (
        buffer.buffer !== 0 ||
        !integer(buffer.byteOffset ?? 0, 0, binary.length) ||
        !integer(buffer.byteLength, 1, binary.length) ||
        (buffer.byteOffset ?? 0) + buffer.byteLength >
          json.buffers[0].byteLength
      )
        return false;
    const accessor = (index: number, type: string, component: number[]) => {
      if (!integer(index, 0, json.accessors.length - 1)) return null;
      const a = json.accessors[index];
      if (
        a.type !== type ||
        !component.includes(a.componentType) ||
        a.normalized ||
        !integer(a.count, 1, 60000) ||
        !integer(a.bufferView, 0, json.bufferViews.length - 1)
      )
        return null;
      const b = json.bufferViews[a.bufferView];
      const width =
        a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 4;
      const size = type === "VEC3" ? 3 : 1;
      const stride = b.byteStride ?? width * size;
      const offset = a.byteOffset ?? 0;
      if (
        !integer(offset, 0, b.byteLength) ||
        !integer(stride, width * size, 252) ||
        stride % width ||
        offset % width ||
        offset + (a.count - 1) * stride + width * size > b.byteLength
      )
        return null;
      return { a, start: (b.byteOffset ?? 0) + offset, stride, width, size };
    };
    let triangles = 0;
    for (const mesh of json.meshes) {
      if (
        !Array.isArray(mesh.primitives) ||
        mesh.primitives.length < 1 ||
        mesh.primitives.length > 4
      )
        return false;
      for (const p of mesh.primitives) {
        if (
          (p.mode ?? 4) !== 4 ||
          !integer(p.material, 0, json.materials.length - 1) ||
          !p.attributes ||
          Object.keys(p.attributes).some(
            (k) => !["POSITION", "NORMAL"].includes(k),
          )
        )
          return false;
        const position = accessor(p.attributes.POSITION, "VEC3", [5126]);
        const normal = accessor(p.attributes.NORMAL, "VEC3", [5126]);
        const indices = accessor(p.indices, "SCALAR", [5121, 5123, 5125]);
        if (
          !position ||
          !normal ||
          !indices ||
          position.a.count !== normal.a.count ||
          indices.a.count % 3
        )
          return false;
        triangles += indices.a.count / 3;
        if (triangles > 20000) return false;
        for (const a of [position, normal])
          for (let i = 0; i < a.a.count; i++)
            for (let axis = 0; axis < 3; axis++) {
              const n = data.getFloat32(
                a.start + i * a.stride + axis * 4,
                true,
              );
              if (!Number.isFinite(n) || Math.abs(n) > 4) return false;
            }
        for (let i = 0; i < indices.a.count; i++) {
          const at = indices.start + i * indices.stride;
          const n =
            indices.width === 1
              ? data.getUint8(at)
              : indices.width === 2
                ? data.getUint16(at, true)
                : data.getUint32(at, true);
          if (n >= position.a.count) return false;
        }
      }
    }
    return triangles > 0;
  } catch {
    return false;
  }
}
