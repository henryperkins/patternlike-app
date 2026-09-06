# Fictional portrait fixture meshes

These four GLB files are deterministic, manually authored fictional reference-based fixtures. They are **not automatic image reconstruction**, recovered physical objects, or automatically generated account portraits. Their shapes and material details were authored after inspecting `native-01.png` through `native-04.png` and the approved visual reference.

The source images and the resulting GLB bytes are independently SHA-256 bound in `apps/web/public/portrait-explorer/fixtures.json`. Each GLB is glTF 2.0 with one named chapter root, one mesh containing merged material primitives, indexed geometry, vertex normals/colors, and opaque metallic/roughness materials. There are no images, texture planes, external buffers, network dependencies, or provider calls.

From the repository root, on the pinned Node 22:

```bash
node scripts/portrait-explorer/build-fixture-assets.mjs
node --test scripts/portrait-explorer/build-fixture-assets.test.mjs
```

The tests cover source binding, headers and chunk lengths, valid indexed positions and normals, actual geometry bounds/depth, standard Three.js GLTFLoader decoding, primitive identity, payload/triangle/draw-call budgets, byte-identical regeneration, checked-in asset parity, and rejected invalid/external data.

| Model | Chapter | Bytes | Triangles | Draw calls | Orientation |
| --- | --- | ---: | ---: | ---: | --- |
| Compass | `chapter-1` | 337,016 | 12,056 | 5 | Face +Y, bowl in XZ |
| Bench | `chapter-2` | 617,808 | 15,780 | 3 | Upright +Y, front +Z |
| Rope | `chapter-3` | 905,456 | 37,120 | 1 | Coil in XZ, knot above +Y |
| Spyglass | `chapter-4` | 525,308 | 14,240 | 7 | Length along X, objective -X |
| **Total** | | **2,385,588** | **79,196** | **16** | |

Each model is centered at its geometric bounds center with its longest axis normalized to 2 artistic world units. The scene renderer owns presentation transforms and lighting. Scale is a viewing convention and does not represent psychological strength.

For a local 32-angle contact sheet, start a static server at the repository root:

```bash
python3 -m http.server 5195 --bind 127.0.0.1
```

Open `http://127.0.0.1:5195/scripts/portrait-explorer/inspect-fixtures.html`. The harness loads the installed Three.js modules and local GLBs, then renders front, rear, left, right, both three-quarter views, above, and below. It is an authoring inspection tool, separate from the public product entry.

The compass has a solid back, recessed bowl, machined case, suspended gimbal ring, pivot pins, and a raised blued-steel needle. The bench has two carved seats, arched crowns, individual bowed slats, complete aprons/stretchers, mortise plugs, armrests, four full legs, and curved solid rockers. The rope uses three continuous helical strands for each routed portion, including a coil, standing part, open eye, binding knot, and uneven cut fibers. The spyglass has returned barrel profiles, nested drawtubes, convex lens solids, machined collars, focus knurling, and a sewn leather sleeve.

The complete fixture geometry has been inspected in the local contact sheet. Final assembly framing, selected-chapter appearance, and mobile clarity must also be checked in the integrated product renderer. Physical-device frame rates and memory behavior require separate measurement; this harness does not establish them.
