import { PORTRAIT_SCHEMA_VERSION, isPortraitGraph, type PatternPortraitResponse, type PatternResponseV7 } from "@patternlike/shared";
import { createPortraitManifest, type PortraitObjectBinding } from "./pattern-portrait.js";

const mismatchMessage = "This constellation no longer matches the current Pattern. Refresh its status to continue.";

export function bindingsFor(response: PatternPortraitResponse, urls: readonly string[] = []): PortraitObjectBinding[] {
  return response.chapters.map((chapter, index) => ({
    documentRevision: response.document_revision!, chapterId: chapter.chapter_id, sourceText: chapter.source_text,
    object: { label: chapter.label, rationale: chapter.rationale, referenceId: chapter.reference_id, referenceSha256: chapter.reference_sha256, imageUrl: urls[index] ?? "" },
  }));
}

export function validateResponse(response: PatternPortraitResponse, chartId: string, document: PatternResponseV7): void {
  if (response.schema_version !== PORTRAIT_SCHEMA_VERSION) throw new Error("This constellation format is not supported.");
  if (response.status === "unavailable") return;
  const manifest = createPortraitManifest(document);
  if (response.chart_id !== chartId || response.pattern_id !== document.pattern_id
    || response.generated_at !== document.generated_at || response.document_revision !== manifest.revision) throw new Error(mismatchMessage);
  if (!["not_started", "generating", "failed", "ready"].includes(response.status)) throw new Error("This constellation status is not supported.");
  if (response.status !== "ready") return;
  if (!response.portrait_id || response.completed_chapters !== 4 || response.chapters.length !== 4
    || new Set(response.chapters.map((chapter) => chapter.chapter_id)).size !== 4
    || new Set(response.chapters.map((chapter) => chapter.reference_id)).size !== 4
    || !isPortraitGraph(response.graph)) throw new Error(mismatchMessage);
  const bound = createPortraitManifest(document, bindingsFor(response));
  if (bound.chapters.length !== 4 || bound.chapters.some((chapter) => !chapter.object
    || !chapter.object.referenceId.trim() || !chapter.object.label.trim() || !chapter.object.rationale.trim()
    || !/^[a-f0-9]{64}$/i.test(chapter.object.referenceSha256))) throw new Error(mismatchMessage);
}

export async function verifyImage(blob: Blob, expectedHash: string, signal: AbortSignal): Promise<Blob> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== expectedHash.toLowerCase()) throw new Error("A chapter image did not match its saved reference.");
  return blob;
}

