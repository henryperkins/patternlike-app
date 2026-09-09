import { canonicalJson, RELATIONSHIP_REASONS, sha256Hex, type ReaderDailyTarget, type ReaderRelationshipsResponse, type ReaderTarget } from "@patternlike/shared";
import type { ReadingRelationshipTargetResponse } from "./api-client.js";
import { chapterSourceText, createPortraitManifest } from "./pattern-portrait.js";

export function sameReaderTarget(left: ReaderTarget, right: ReaderTarget): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** The Worker owns eligibility and stored hashes; the browser rejects mismatched projections. */
export function acceptsRelationshipGraph(graph: ReaderRelationshipsResponse, source: ReaderDailyTarget): boolean {
  return graph?.schema_version === "reader-relationships/v1" && sameReaderTarget(graph.source, source)
    && ["available", "no_supported_connection", "unavailable"].includes(graph.status)
    && typeof graph.truncated === "boolean" && Array.isArray(graph.items) && graph.items.length <= 12
    && new Set(graph.items.map((edge) => edge.id)).size === graph.items.length
    && graph.items.every((edge) => typeof edge.id === "string" && edge.id.length > 0
      && Object.hasOwn(RELATIONSHIP_REASONS, edge.kind) && edge.reason_code === edge.kind
      && ["daily", "pattern", "timing"].includes(edge.from?.kind)
      && ["daily", "pattern", "timing"].includes(edge.to?.kind));
}

export async function acceptsRelationshipTarget(response: ReadingRelationshipTargetResponse, expected: ReaderTarget): Promise<boolean> {
  if (response?.schema_version !== "reader-relationship-target/v1" || response.status !== "available"
    || response.kind !== expected.kind || !sameReaderTarget(response.target, expected)) return false;
  if (response.kind === "daily") {
    const reading = response.reading?.reading;
    return reading?.reading_id === response.target.reading_id && reading.revision === response.target.revision
      && reading.paragraphs.some((paragraph) => paragraph.paragraph_id === response.target.paragraph_id);
  }
  if (response.kind === "pattern") {
    const document = response.pattern;
    if (document?.pattern_id !== response.target.pattern_id || !Array.isArray(document.core_chapters)
      || document.core_chapters.length < 3 || document.core_chapters.length > 6) return false;
    const manifest = createPortraitManifest(document);
    const chapter = manifest.chapters[response.target.chapter_index];
    return manifest.revision === response.target.document_revision && !!chapter
      && await sha256Hex(chapterSourceText(chapter)) === response.target.chapter_source_sha256;
  }
  return sameReaderTarget(response.timing.target, response.target)
    && response.timing.passes.some((pass) => pass.pass_index === response.target.pass_index && pass.exact_at === response.target.exact_at);
}
