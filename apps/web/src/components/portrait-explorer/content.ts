import { isPortraitChapterCount } from "@patternlike/shared";
import type { PortraitChapter, PortraitManifest } from "../../lib/pattern-portrait.js";
import type { Facet, PortraitMeshBundle } from "./types.js";

/** The reader renders title and summary above these complete, unmodified facet paragraphs. */
export function chapterPassages(chapter: PortraitChapter, facet: Facet): readonly string[] {
  switch (facet) {
    case "overview": return chapter.sections;
    case "tensions": return chapter.tensions;
    case "resources": return chapter.resources;
    case "alternative": return [chapter.counterExpression];
  }
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function assetUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, "https://portrait.invalid/");
    return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isSourceChapter(chapter: PortraitChapter): boolean {
  return Boolean(chapter && typeof chapter.id === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(chapter.id)
    && typeof chapter.title === "string" && typeof chapter.summary === "string" && typeof chapter.counterExpression === "string"
    && [chapter.sections, chapter.tensions, chapter.resources].every((paragraphs) => Array.isArray(paragraphs) && paragraphs.every((text) => typeof text === "string")));
}

/** Match createPortraitManifest's full source binding, never just an annotation or summary. */
function chapterSourceText({ title, summary, sections, tensions, resources, counterExpression }: PortraitChapter): string {
  return JSON.stringify({ title, summary, sections, tensions, resources, counterExpression });
}

/** Metadata gate only: the renderer separately verifies the downloaded GLB bytes and structure. */
export function validateMeshBundle(manifest: PortraitManifest, bundle: PortraitMeshBundle): boolean {
  if (!manifest || !bundle || bundle.version !== "portrait-mesh-1" || !["authored-fictional-fixtures", "codex-parametric/v1", "codex-parametric/v2"].includes(bundle.authoring)
    || typeof manifest.revision !== "string" || !manifest.revision.trim() || bundle.documentRevision !== manifest.revision
    || !Array.isArray(manifest.chapters) || !isPortraitChapterCount(manifest.chapters.length) || !manifest.chapters.every(isSourceChapter)
    || !Array.isArray(bundle.assets) || bundle.assets.length !== manifest.chapters.length) return false;
  const chapters = new Map(manifest.chapters.map((chapter) => [chapter.id, chapter]));
  if (chapters.size !== manifest.chapters.length || (bundle.authoring === "codex-parametric/v1" && chapters.size !== 4)) return false;
  const seenChapters = new Set<string>();
  const seenUrls = new Set<string>();
  for (const [index, asset] of bundle.assets.entries()) {
    if (!asset || typeof asset.chapterId !== "string" || seenChapters.has(asset.chapterId) || (bundle.authoring === "codex-parametric/v2" && asset.chapterId !== manifest.chapters[index]?.id)
      || !isHash(asset.sha256) || !isHash(asset.sourceImageSha256)) return false;
    const chapter = chapters.get(asset.chapterId);
    const reference = chapter?.object;
    const url = assetUrl(asset.url);
    if (!chapter || !reference || typeof reference.referenceId !== "string" || !reference.referenceId.trim()
      || !isHash(reference.referenceSha256) || reference.referenceSha256.toLowerCase() !== asset.sourceImageSha256.toLowerCase()
      || !assetUrl(reference.imageUrl) || !url || seenUrls.has(url) || asset.sourceText !== chapterSourceText(chapter)) return false;
    if (bundle.authoring !== "authored-fictional-fixtures") {
      const provenance = asset.provenance;
      if (!provenance || provenance.authoring !== bundle.authoring || provenance.documentRevision !== manifest.revision
        || provenance.compilerVersion !== (bundle.authoring === "codex-parametric/v2" ? "portrait-mesh-compiler/v2" : "portrait-mesh-compiler/v1")
        || (bundle.authoring === "codex-parametric/v2" && provenance.chapterCount !== chapters.size)
        || (bundle.authoring === "codex-parametric/v1" && provenance.chapterCount !== undefined) || !isHash(provenance.programSha256)
        || !isHash(provenance.sourceTextSha256) || !url.startsWith("blob:") || !reference.imageUrl.startsWith("blob:")) return false;
    } else if (asset.provenance) return false;
    seenChapters.add(asset.chapterId);
    seenUrls.add(url);
  }
  return true;
}
