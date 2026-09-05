import { ZODIAC_SIGNS, type BirthTimeAccuracy, type PatternResponseV7, type PatternStatePattern, type ZodiacSignName } from "@patternlike/shared";

export interface PortraitChapter {
  id: string;
  ordinal: number;
  title: string;
  summary: string;
  sections: string[];
  tensions: string[];
  resources: string[];
  counterExpression: string;
  object?: PortraitObject;
}

export interface PortraitObject {
  label: string;
  rationale: string;
  referenceId: string;
  referenceSha256: string;
  imageUrl: string;
}

/** Generated references, explicitly bound to the published text they illustrate. */
export interface PortraitObjectBinding {
  documentRevision: string;
  chapterId: string;
  sourceText: string;
  object: PortraitObject;
}

function chapterSourceText({ title, summary, sections, tensions, resources, counterExpression }: PortraitChapter): string {
  return JSON.stringify({ title, summary, sections, tensions, resources, counterExpression });
}

export interface PortraitManifest {
  revision: string;
  accuracy: BirthTimeAccuracy;
  uncertainty: string | null;
  sunSign: ZodiacSignName | null;
  chapters: PortraitChapter[];
  signatures: Array<{ title: string; text: string }>;
}

export type PortraitSource =
  | { status: "ready"; document: PatternResponseV7; sunSign?: ZodiacSignName | null }
  | { status: "loading" }
  | { status: "unavailable" };

export function patternMatchesDocument(pattern: PatternStatePattern | null, document: PatternResponseV7): boolean {
  return pattern !== null && pattern.pattern_id === document.pattern_id
    && pattern.generated_at === document.generated_at && pattern.locale === document.locale
    && pattern.effective_accuracy === document.effective_accuracy;
}

/** Reader metadata stays upstream: only four asset locations cross into image loading. */
export function portraitImageUrls(manifest: PortraitManifest): readonly string[] | null {
  if (manifest.chapters.length !== 4) return null;
  const urls: string[] = [];
  for (const chapter of manifest.chapters) {
    const reference = chapter.object;
    if (!reference || !reference.referenceId.trim()
      || !/^[a-f0-9]{64}$/i.test(reference.referenceSha256)
      || !reference.imageUrl.trim()) return null;
    try {
      const url = new URL(reference.imageUrl, "https://portrait.invalid/");
      if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "blob:") return null;
    } catch {
      return null;
    }
    urls.push(reference.imageUrl);
  }
  return urls;
}

/** Local presentation only. Never copy evidence, provider packets, or inferred links. */
export function createPortraitManifest(
  document: PatternResponseV7,
  bindings: readonly PortraitObjectBinding[] = [],
  sunSign?: ZodiacSignName | null,
): PortraitManifest {
  const manifest: PortraitManifest = {
    revision: `${document.schema_version}:${document.pattern_id}:${document.generated_at}`,
    accuracy: document.effective_accuracy,
    uncertainty: document.uncertainty?.text ?? null,
    // Supplied by the caller from chart facts or an explicitly labeled preview control.
    sunSign: typeof sunSign === "string" && ZODIAC_SIGNS.includes(sunSign) ? sunSign : null,
    chapters: document.core_chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      ordinal: index + 1,
      title: chapter.title,
      summary: chapter.summary,
      sections: chapter.sections.map((unit) => unit.text),
      tensions: chapter.tensions.map((unit) => unit.text),
      resources: chapter.resources.map((unit) => unit.text),
      counterExpression: chapter.counter_expression.text,
    })),
    signatures: document.additional_signatures.map(({ title, text }) => ({ title, text })),
  };
  for (const chapter of manifest.chapters) {
    const binding = bindings.find((item) => item.documentRevision === manifest.revision
      && item.chapterId === chapter.id && item.sourceText === chapterSourceText(chapter));
    if (binding) chapter.object = { ...binding.object };
  }
  return manifest;
}
