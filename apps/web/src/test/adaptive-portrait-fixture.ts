import type { PatternPortraitResponseV2, PatternPortraitExplorerResponseV2, PatternResponseV7, PortraitChapterCount } from "@patternlike/shared";
import { createPortraitManifest } from "../lib/pattern-portrait.js";

export function adaptiveFixture(count: PortraitChapterCount) {
  const document: PatternResponseV7 = { schema_version: "0.7.0", pattern_id: "pattern-fictional", generated_at: "2026-09-11T00:00:00Z", locale: "en-US", effective_accuracy: "exact",
    provenance: { assembly_mode: "constrained_model", provider: "OpenAI", model_family: "gpt", raw_birth_details_sent: false }, additional_signatures: [], uncertainty: null,
    core_chapters: Array.from({ length: count }, (_, i) => ({ title: `Chapter ${i + 1}`, summary: `Summary ${i}`, sections: [{ text: `Body ${i}` }], tensions: [{ text: `Tension ${i}` }], resources: [{ text: `Resource ${i}` }], counter_expression: { text: `Alternative ${i}` } })) };
  const portrait: PatternPortraitResponseV2 = { schema_version: "pattern-portrait/v2", chapter_count: count, status: "ready", portrait_id: "portrait-fictional", pattern_id: document.pattern_id, chart_id: "chart-fictional", generated_at: document.generated_at,
    document_revision: createPortraitManifest(document).revision, sun_sign: null, completed_chapters: count, retryable: false,
    chapters: document.core_chapters.map((c, i) => ({ chapter_id: `chapter-${i + 1}`, reference_id: `reference-${i}`, label: `Object ${i}`, rationale: "Fictional reference.", reference_sha256: "a".repeat(64), source_text: JSON.stringify({ title: c.title, summary: c.summary, sections: c.sections.map(x => x.text), tensions: c.tensions.map(x => x.text), resources: c.resources.map(x => x.text), counterExpression: c.counter_expression.text }) })),
    graph: { engine_version: "constellation-v2", chapter_count: count, positions: Array(count * 3).fill(0), source_indices: Array.from({ length: count }, (_, i) => i), star_strengths: Array(count).fill(1), connections: Array.from({ length: count - 1 }, (_, i) => [i, i + 1]), color: [0.3, 0.4, 0.5], contributions: Array.from({ length: count }, (_, i) => ({ index: i, aspect: 1, coverage: 1, opening_area: 0, skew: 0, stars: 1, interior_lines: 0 })) } };
  const explorer: PatternPortraitExplorerResponseV2 = { schema_version: "pattern-portrait-explorer/v2", chapter_count: count, document_revision: portrait.document_revision, portrait, status: "ready", completed_models: count, retryable: false,
    models: portrait.chapters.map((c, i) => ({ chapter_id: c.chapter_id, chapter_index: i, chapter_count: count, reference_id: `model-${i}`, sha256: "b".repeat(64), source_image_sha256: c.reference_sha256, source_text_sha256: "c".repeat(64), source_text: c.source_text, program_sha256: "d".repeat(64), compiler_version: "portrait-mesh-compiler/v2", authoring: "codex-parametric/v2", document_revision: portrait.document_revision! })) };
  const images = portrait.chapters.map(c => ({ reference_id: c.reference_id, content_type: "image/png", sha256: c.reference_sha256, data_base64: "AAAA" }));
  const download = { schema_version: "pattern-portrait-download/v2", portrait, images };
  const fullDownload = { schema_version: "pattern-portrait-explorer-download/v2", reading: document, explorer, images,
    models: explorer.models.map(m => ({ reference_id: m.reference_id, content_type: "model/gltf-binary", sha256: m.sha256, data_base64: "AAAA", provider_request_id: "request", audit_request_id: "audit",
      program: { version: "portrait-mesh-program/v2", chapter_count: count, chapter_id: m.chapter_id, materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }], parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1, 1], bevel: 0.04 } }] },
      audit: { schema_version: "portrait-mesh-audit/v1", accepted: true, recognizable: true, substantial: true, source_correspondence: true, no_severe_intersections: true, view_count: 4, notes: "Four views checked." } })) };
  return { document, portrait, explorer, download, fullDownload };
}
