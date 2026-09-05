import * as THREE from "three";
import { createPortraitGraph, isPortraitGraph, type PortraitGraph, type PortraitImagePixels, type ZodiacSignName } from "@patternlike/shared";

export type ImagePixels = PortraitImagePixels;

/** Adapt the saved numeric graph to the two disposable renderer buffers. */
export function sculptureFromGraph(graph: PortraitGraph) {
  if (!isPortraitGraph(graph)) throw new Error("Portrait graph is invalid or unsupported");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(graph.positions, 3));
  geometry.setAttribute("sourceIndex", new THREE.Float32BufferAttribute(graph.source_indices, 1));
  geometry.setAttribute("starStrength", new THREE.Float32BufferAttribute(graph.star_strengths, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const linePositions: number[] = []; const lineSources: number[] = [];
  for (const edge of graph.connections) for (const vertex of edge) {
    linePositions.push(graph.positions[vertex * 3]!, graph.positions[vertex * 3 + 1]!, graph.positions[vertex * 3 + 2]!);
    lineSources.push(graph.source_indices[vertex]!);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("sourceIndex", new THREE.Float32BufferAttribute(lineSources, 1));
  lineGeometry.computeBoundingBox(); lineGeometry.computeBoundingSphere();
  return { geometry, lineGeometry, connections: graph.connections, color: graph.color,
    contributions: graph.contributions.map((source) => ({ index: source.index, aspect: source.aspect, coverage: source.coverage,
      openingArea: source.opening_area, skew: source.skew, stars: source.stars, interiorLines: source.interior_lines })),
  };
}

/** Both geometry buffers belong to the caller and must be disposed. */
export function createImageSculpture(images: readonly ImagePixels[], sunSign: ZodiacSignName | null = null) {
  return sculptureFromGraph(createPortraitGraph(images, sunSign));
}
