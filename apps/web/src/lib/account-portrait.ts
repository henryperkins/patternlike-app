import { PORTRAIT_SCHEMA_VERSION, PORTRAIT_V2_SCHEMA_VERSION, isPortraitChapterCount, isPortraitGraph, isPortraitMeshAudit, parsePortraitMeshProgram, type PatternPortraitExplorerResponse, type PatternPortraitResponse, type PatternResponseV7 } from "@patternlike/shared";
import { createPortraitManifest, type PortraitObjectBinding } from "./pattern-portrait.js";

const mismatchMessage = "This constellation no longer matches the current Pattern. Refresh its status to continue.";

export function bindingsFor(response: PatternPortraitResponse, urls: readonly string[] = []): PortraitObjectBinding[] {
  return response.chapters.map((chapter, index) => ({
    documentRevision: response.document_revision!, chapterId: chapter.chapter_id, sourceText: chapter.source_text,
    object: { label: chapter.label, rationale: chapter.rationale, referenceId: chapter.reference_id, referenceSha256: chapter.reference_sha256, imageUrl: urls[index] ?? "" },
  }));
}

const closed = (value: object, required: readonly string[], optional: readonly string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const responseKeys = ["schema_version", "status", "portrait_id", "pattern_id", "generated_at", "chart_id", "document_revision", "sun_sign", "completed_chapters", "retryable", "chapters", "graph"];
const isHash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function portraitChapterCount(response: PatternPortraitResponse): number | null {
  return response.schema_version === PORTRAIT_V2_SCHEMA_VERSION ? response.chapter_count : 4;
}
export function validateResponse(response: PatternPortraitResponse, chartId: string, document: PatternResponseV7): void {
  if (!response || !closed(response, response.schema_version === PORTRAIT_V2_SCHEMA_VERSION ? [...responseKeys, "chapter_count"] : responseKeys)
    || ![PORTRAIT_SCHEMA_VERSION, PORTRAIT_V2_SCHEMA_VERSION].includes(response.schema_version)
    || !["unavailable", "not_started", "generating", "failed", "ready"].includes(response.status)
    || !Array.isArray(response.chapters) || !Number.isInteger(response.completed_chapters)
    || response.completed_chapters < 0 || typeof response.retryable !== "boolean") throw new Error("This constellation format is not supported.");
  const count = portraitChapterCount(response);
  if (response.schema_version === PORTRAIT_V2_SCHEMA_VERSION && count === null) {
    if (response.status !== "unavailable" || response.document_revision !== null || response.completed_chapters !== 0
      || response.chapters.length || response.graph !== null) throw new Error(mismatchMessage);
    return;
  }
  if (!isPortraitChapterCount(count) || response.completed_chapters > count || response.chapters.length > count) throw new Error(mismatchMessage);
  // Older servers can explicitly withhold artwork for an unsupported source.
  if (response.status === "unavailable" && response.schema_version === PORTRAIT_SCHEMA_VERSION) return;
  const manifest = createPortraitManifest(document);
  if (count !== manifest.chapters.length || response.chart_id !== chartId || response.pattern_id !== document.pattern_id
    || response.generated_at !== document.generated_at || response.document_revision !== manifest.revision) throw new Error(mismatchMessage);
  if (response.status !== "ready") {
    if (response.graph !== null) throw new Error(mismatchMessage);
    return;
  }
  if (!response.portrait_id || response.completed_chapters !== count || response.chapters.length !== count
    || new Set(response.chapters.map((chapter) => chapter.chapter_id)).size !== count
    || new Set(response.chapters.map((chapter) => chapter.reference_id)).size !== count
    || response.chapters.some((chapter, index) => chapter.chapter_id !== `chapter-${index + 1}`)
    || !isPortraitGraph(response.graph)
    || (response.schema_version === PORTRAIT_SCHEMA_VERSION ? response.graph.engine_version !== "constellation-v1"
      : response.graph.engine_version !== "constellation-v2" || response.graph.chapter_count !== count)) throw new Error(mismatchMessage);
  const bound = createPortraitManifest(document, bindingsFor(response));
  if (bound.chapters.length !== count || bound.chapters.some((chapter) => !chapter.object
    || !chapter.object.referenceId.trim() || !chapter.object.label.trim() || !chapter.object.rationale.trim()
    || !isHash(chapter.object.referenceSha256))) throw new Error(mismatchMessage);
}

export function validateExplorerResponse(response: PatternPortraitExplorerResponse, chartId: string, document: PatternResponseV7): void {
  if (!response || !closed(response, ["schema_version", "status", "portrait", "completed_models", "retryable", "models", ...(response.schema_version === "pattern-portrait-explorer/v2" ? ["chapter_count", "document_revision"] : [])])
    || !["pattern-portrait-explorer/v1", "pattern-portrait-explorer/v2"].includes(response.schema_version)
    || !["unavailable", "not_started", "generating", "failed", "ready"].includes(response.status)
    || !Number.isInteger(response.completed_models) || response.completed_models < 0
    || typeof response.retryable !== "boolean" || !Array.isArray(response.models)) throw new Error("This 3D portrait format is not supported.");
  validateResponse(response.portrait, chartId, document);
  const v2 = response.schema_version === "pattern-portrait-explorer/v2";
  const count = portraitChapterCount(response.portrait);
  if (v2 ? response.portrait.schema_version !== PORTRAIT_V2_SCHEMA_VERSION || response.chapter_count !== count
    || response.document_revision !== response.portrait.document_revision
    : response.portrait.schema_version !== PORTRAIT_SCHEMA_VERSION) throw new Error(mismatchMessage);
  if (response.completed_models > (count ?? 0) || response.models.length > (count ?? 0)) throw new Error(mismatchMessage);
  if (response.status !== "ready") return;
  if (response.portrait.status !== "ready" || !isPortraitChapterCount(count) || response.completed_models !== count || response.models.length !== count
    || new Set(response.models.map(model => model.chapter_id)).size !== count
    || new Set(response.models.map(model => model.reference_id)).size !== count) throw new Error(mismatchMessage);
  for (const [index, model] of response.models.entries()) {
    const chapter = response.portrait.chapters[index];
    if (!chapter || model.chapter_id !== chapter.chapter_id || model.source_text !== chapter.source_text
      || model.source_image_sha256 !== chapter.reference_sha256 || model.document_revision !== response.portrait.document_revision
      || model.authoring !== (v2 ? "codex-parametric/v2" : "codex-parametric/v1")
      || model.compiler_version !== (v2 ? "portrait-mesh-compiler/v2" : "portrait-mesh-compiler/v1")
      || (v2 && (!("chapter_count" in model) || model.chapter_count !== count || model.chapter_index !== index))
      || typeof model.reference_id !== "string" || !model.reference_id.trim()
      || ![model.sha256, model.source_image_sha256, model.source_text_sha256, model.program_sha256].every(isHash)) throw new Error(mismatchMessage);
  }
}

/** Validate private download metadata before offering a file for this exact reading. */
export function validatePortraitDownload(value: unknown, chartId: string, document: PatternResponseV7, explorer = false): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(mismatchMessage);
  const download = value as Record<string, any>;
  if (!closed(download, explorer ? ["schema_version", "reading", "explorer", "images", "models"] : ["schema_version", "portrait", "images"])) throw new Error(mismatchMessage);
  const response = explorer ? download.explorer : download.portrait;
  if (explorer) validateExplorerResponse(response, chartId, document); else validateResponse(response, chartId, document);
  const portrait: PatternPortraitResponse = explorer ? response.portrait : response;
  const version = portrait.schema_version === PORTRAIT_V2_SCHEMA_VERSION ? "v2" : "v1";
  if (download.schema_version !== `pattern-portrait-${explorer ? "explorer-" : ""}download/${version}` || response.status !== "ready"
    || !Array.isArray(download.images) || download.images.length !== portrait.chapters.length
    || new Set(download.images.map((image: any) => image.reference_id)).size !== portrait.chapters.length) throw new Error(mismatchMessage);
  for (const [index, image] of download.images.entries()) {
    const chapter = portrait.chapters[index]!;
    if (image.reference_id !== chapter.reference_id || image.sha256 !== chapter.reference_sha256 || image.content_type !== "image/png"
      || typeof image.data_base64 !== "string" || !image.data_base64) throw new Error(mismatchMessage);
  }
  if (!explorer) return;
  if (JSON.stringify(download.reading) !== JSON.stringify(document) || !Array.isArray(download.models)
    || download.models.length !== response.models.length || new Set(download.models.map((model: any) => model.reference_id)).size !== response.models.length) throw new Error(mismatchMessage);
  for (const [index, model] of download.models.entries()) {
    const expected = response.models[index];
    const program = parsePortraitMeshProgram(model.program);
    if (model.reference_id !== expected.reference_id || model.sha256 !== expected.sha256 || model.content_type !== "model/gltf-binary"
      || typeof model.data_base64 !== "string" || !model.data_base64 || !isPortraitMeshAudit(model.audit)
      || !program || program.version !== `portrait-mesh-program/${version}`
      || (program.version === "portrait-mesh-program/v2" && (program.chapter_count !== portraitChapterCount(portrait) || program.chapter_id !== expected.chapter_id))) throw new Error(mismatchMessage);
  }
}

export async function verifyPortraitDownloadBlob(blob: Blob, chartId: string, document: PatternResponseV7, signal: AbortSignal, explorer = false): Promise<void> {
  const value = JSON.parse(await blob.text());
  signal.throwIfAborted();
  validatePortraitDownload(value, chartId, document, explorer);
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), byte => byte.toString(16).padStart(2, "0")).join("");
  const decode = (text: string, max: number) => {
    if (text.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error(mismatchMessage);
    const bytes = Uint8Array.from(atob(text), character => character.charCodeAt(0));
    if (!bytes.length || bytes.length > max) throw new Error(mismatchMessage);
    return bytes;
  };
  for (const image of value.images) {
    if (await digest(decode(image.data_base64, 2 * 1024 * 1024)) !== image.sha256) throw new Error(mismatchMessage);
    signal.throwIfAborted();
  }
  if (!explorer) return;
  for (const [index, model] of value.models.entries()) {
    const expected = value.explorer.models[index];
    if (await digest(decode(model.data_base64, 750000)) !== model.sha256
      || await digest(new TextEncoder().encode(JSON.stringify(model.program))) !== expected.program_sha256
      || await digest(new TextEncoder().encode(expected.source_text)) !== expected.source_text_sha256) throw new Error(mismatchMessage);
    signal.throwIfAborted();
  }
}

export async function verifyImage(blob: Blob, expectedHash: string, signal: AbortSignal): Promise<Blob> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== expectedHash.toLowerCase()) throw new Error("A chapter image did not match its saved reference.");
  return blob;
}

