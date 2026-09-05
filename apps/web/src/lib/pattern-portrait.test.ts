import { describe, expect, it } from "vitest";
import type { ZodiacSignName } from "@patternlike/shared";
import { fictionalPattern } from "../preview/pattern-portrait-fixture.js";
import { createPortraitManifest, portraitImageUrls } from "./pattern-portrait.js";
import { imageStudyBindings } from "../preview/image-study.js";

describe("portrait projection", () => {
  it.each([
    "aries", "taurus", "gemini", "cancer", "leo", "virgo",
    "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
  ] as const)("accepts the supplied %s Sun sign", (sunSign) => {
    expect(createPortraitManifest(fictionalPattern, imageStudyBindings, sunSign).sunSign).toBe(sunSign);
  });

  it("leaves Sun-sign influence absent for missing or unsupported input", () => {
    expect(createPortraitManifest(fictionalPattern).sunSign).toBeNull();
    for (const sunSign of [undefined, null, "", "Aries", "aries ", "ophiuchus", 0, {}, ["aries"]]) {
      const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings, sunSign as ZodiacSignName | null | undefined);
      expect(manifest.sunSign).toBeNull();
      expect(portraitImageUrls(manifest)).toEqual(imageStudyBindings.map((binding) => binding.object.imageUrl));
    }
  });

  it("preserves the document identity and chapter images when the Sun sign changes", () => {
    const initial = createPortraitManifest(fictionalPattern, imageStudyBindings, "aries");
    const replacement = createPortraitManifest(fictionalPattern, imageStudyBindings, "pisces");
    expect(replacement.sunSign).toBe("pisces");
    expect(replacement.revision).toBe(initial.revision);
    expect(replacement.chapters).toEqual(initial.chapters);
    expect(portraitImageUrls(replacement)).toEqual(imageStudyBindings.map((binding) => binding.object.imageUrl));
  });

  it("never infers a Sun sign from published prose", () => {
    const document = structuredClone(fictionalPattern);
    document.core_chapters[0].title = "Sun in Aries";
    document.core_chapters[0].summary = "Your Sun sign is Aries.";
    expect(createPortraitManifest(document).sunSign).toBeNull();
    expect(createPortraitManifest(document, [], "taurus").sunSign).toBe("taurus");
  });

  it("binds all four generated images to the exact reference document", () => {
    const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings);
    expect(manifest.chapters.map((chapter) => chapter.object?.label)).toEqual(["Door", "Notebook", "Metronome", "Lantern"]);
    expect(portraitImageUrls(manifest)).toEqual(imageStudyBindings.map((binding) => binding.object.imageUrl));
    expect(portraitImageUrls(createPortraitManifest(fictionalPattern))).toBeNull();
    const replacement = { ...fictionalPattern, pattern_id: "another-person" };
    expect(portraitImageUrls(createPortraitManifest(replacement, imageStudyBindings))).toBeNull();
  });

  it.each(["title", "summary", "sections", "tensions", "resources", "counter_expression"])("invalidates the reference when %s changes, even with the same document ID", (field) => {
    for (let index = 0; index < 4; index++) {
      const document = structuredClone(fictionalPattern);
      const chapter = document.core_chapters[index];
      if (field === "title" || field === "summary") chapter[field] += " Changed.";
      else if (field === "counter_expression") chapter.counter_expression.text += " Changed.";
      else chapter[field as "sections" | "tensions" | "resources"][0].text += " Changed.";
      const manifest = createPortraitManifest(document, imageStudyBindings);
      expect(manifest.chapters[index].object).toBeUndefined();
      expect(portraitImageUrls(manifest)).toBeNull();
      expect(manifest.chapters.filter((item) => item.object)).toHaveLength(3);
    }
  });

  it("rejects every missing reference and any chapter count other than four", () => {
    for (let index = 0; index < 4; index++) {
      expect(portraitImageUrls(createPortraitManifest(fictionalPattern, imageStudyBindings.filter((_, i) => index !== i)))).toBeNull();
    }
    const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings);
    expect(portraitImageUrls({ ...manifest, chapters: manifest.chapters.slice(0, 3) })).toBeNull();
    expect(portraitImageUrls({ ...manifest, chapters: [...manifest.chapters, manifest.chapters[0]] })).toBeNull();
  });

  it("rejects incomplete image references without substituting geometry", () => {
    for (const invalid of [{ imageUrl: "" }, { imageUrl: "javascript:alert(1)" }, { referenceId: "" }, { referenceSha256: "invalid" }]) {
      const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings);
      manifest.chapters[2].object = { ...manifest.chapters[2].object!, ...invalid };
      expect(portraitImageUrls(manifest)).toBeNull();
    }
  });

  it("accepts owned blob URLs for authenticated chapter images", () => {
    const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings);
    manifest.chapters.forEach((chapter, index) => { chapter.object!.imageUrl = `blob:https://pattern.example/${index}`; });
    expect(portraitImageUrls(manifest)).toEqual(manifest.chapters.map((chapter) => chapter.object!.imageUrl));
  });

  it("passes only ordered image URLs across the modeling boundary", () => {
    const manifest = createPortraitManifest(fictionalPattern, imageStudyBindings);
    const before = portraitImageUrls(manifest);
    for (const chapter of manifest.chapters) {
      chapter.title = "Changed reader title";
      chapter.summary = "Changed reader prose";
      chapter.object!.label = "Changed object label";
      chapter.object!.rationale = "Changed rationale";
      chapter.object!.referenceId = "changed-id";
      chapter.object!.referenceSha256 = "0".repeat(64);
    }
    expect(portraitImageUrls(manifest)).toEqual(before);
    manifest.chapters[1].object!.imageUrl = "/replacement.png";
    expect(portraitImageUrls(manifest)).toEqual([before![0], "/replacement.png", before![2], before![3]]);
  });

  it("preserves all published prose and carries accuracy without deriving claims", () => {
    const source = { ...fictionalPattern, effective_accuracy: "unknown" as const, uncertainty: { text: "Some chart details are unavailable." } };
    const manifest = createPortraitManifest(source);
    expect(manifest.accuracy).toBe("unknown");
    expect(manifest.uncertainty).toBe(source.uncertainty.text);
    expect(manifest.chapters).toHaveLength(4);
    for (const [index, chapter] of source.core_chapters.entries()) {
      expect(manifest.chapters[index]).toMatchObject({
        title: chapter.title, summary: chapter.summary,
        sections: chapter.sections.map((unit) => unit.text),
        tensions: chapter.tensions.map((unit) => unit.text),
        resources: chapter.resources.map((unit) => unit.text),
        counterExpression: chapter.counter_expression.text,
      });
    }
  });

  it("copies only public content, even when an upstream object contains private evidence", () => {
    const source = {
      ...fictionalPattern,
      private_evidence: "must-not-copy",
      core_chapters: fictionalPattern.core_chapters.map((chapter) => ({ ...chapter, feature_aliases: ["private-alias"] })),
    };
    const manifest = createPortraitManifest(source);
    expect(JSON.stringify(manifest)).not.toMatch(/must-not-copy|private-alias|feature_aliases|provider/);
    expect(manifest).not.toHaveProperty("relationships");
  });

  it("keeps document identity deterministic and invalidates it on replacement", () => {
    const before = createPortraitManifest(fictionalPattern);
    expect(createPortraitManifest(structuredClone(fictionalPattern))).toEqual(before);
    expect(createPortraitManifest({ ...fictionalPattern, pattern_id: "pat_replacement" }).revision).not.toBe(before.revision);
    expect(createPortraitManifest({ ...fictionalPattern, generated_at: "2026-09-06T12:00:00Z" }).revision).not.toBe(before.revision);
    expect(new Set(before.chapters.map((chapter) => chapter.id)).size).toBe(4);
  });

  it("preserves additional signatures without copying their private fields", () => {
    const manifest = createPortraitManifest({ ...fictionalPattern, additional_signatures: [{ title: "A smaller thread", text: "Additional published text." }] });
    expect(manifest.signatures).toEqual([{ title: "A smaller thread", text: "Additional published text." }]);
  });
});
