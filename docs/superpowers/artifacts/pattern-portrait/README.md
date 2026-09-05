# Frozen unified sculpture export

`unified-sculpture.glb` is the 2026-09-05 demonstration export from the four generated image references. It contains one mesh and 24,576 triangles. It was exported with Three GLTFExporter and parsed again with GLTFLoader.

`verification.json` records geometry, source and asset hashes, browser decoding dimensions, and actual-image substitution results. The fourth substitution changes topology; its vertex-by-vertex RMS value is not a meaningful geometric distance.

The interactive preview computes geometry from the PNGs, independently of this frozen download. Run `npm run dev:portrait -w @patternlike/web` from the repository root to inspect the current algorithm interactively. If the image set or modeling algorithm changes, regenerate the export and its receipt together.

This is a contour-derived abstract synthesis. It does not reconstruct the original objects or their hidden surfaces. See the portrait handoff for scope and validation.
