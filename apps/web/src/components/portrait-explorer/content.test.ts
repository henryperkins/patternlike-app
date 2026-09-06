import { describe, expect, it } from "vitest";
import type { PortraitChapter, PortraitManifest } from "../../lib/pattern-portrait.js";
import type { PortraitMeshBundle } from "./types.js";
import { chapterPassages, validateMeshBundle } from "./content.js";

const sourceText = '{"title":"Chapter","summary":"Exact summary.","sections":["First paragraph.\\nSecond line.","  Spaced paragraph.  "],"tensions":["A tension.","Another tension."],"resources":["A resource.","Another resource."],"counterExpression":"An alternative."}';
function fixture(): { manifest: PortraitManifest; bundle: PortraitMeshBundle } {
  const chapters: PortraitChapter[] = [1, 2, 3, 4].map((ordinal) => ({
    id: `chapter-${ordinal}`, ordinal, title: "Chapter", summary: "Exact summary.",
    sections: ["First paragraph.\nSecond line.", "  Spaced paragraph.  "],
    tensions: ["A tension.", "Another tension."], resources: ["A resource.", "Another resource."], counterExpression: "An alternative.",
    object: { label: "Metaphor", rationale: "Existing rationale.", referenceId: `reference-${ordinal}`, referenceSha256: String(ordinal).repeat(64), imageUrl: `/images/chapter-${ordinal}.png` },
  }));
  return {
    manifest: { revision: "pattern-1:2026-09-06", accuracy: "exact", uncertainty: "Preserved uncertainty.", sunSign: null, chapters, signatures: [{ title: "Signature", text: "Published signature." }] },
    bundle: { version: "portrait-mesh-1", documentRevision: "pattern-1:2026-09-06", authoring: "authored-fictional-fixtures", assets: chapters.map((chapter, index) => ({
      chapterId: chapter.id, url: `/portrait-explorer/${chapter.id}.glb`, sha256: String(index + 5).repeat(64), sourceImageSha256: String(index + 1).repeat(64), sourceText,
    })) },
  };
}

describe("portrait explorer source projection", () => {
  it("projects complete facet text exactly and leaves the separately rendered title and summary intact", () => {
    const { manifest } = fixture();
    const chapter = manifest.chapters[0];
    expect(chapterPassages(chapter, "overview")).toEqual(["First paragraph.\nSecond line.", "  Spaced paragraph.  "]);
    expect(chapterPassages(chapter, "tensions")).toEqual(["A tension.", "Another tension."]);
    expect(chapterPassages(chapter, "resources")).toEqual(["A resource.", "Another resource."]);
    expect(chapterPassages(chapter, "alternative")).toEqual(["An alternative."]);
    expect(chapter.summary).toBe("Exact summary.");
    expect(manifest.uncertainty).toBe("Preserved uncertainty.");
    expect(manifest.signatures).toEqual([{ title: "Signature", text: "Published signature." }]);
  });
});

describe("portrait mesh source binding", () => {
  function personalFixture() {
    const { manifest, bundle } = fixture();
    const personal = {
      ...bundle,
      authoring: "codex-parametric/v1",
      assets: bundle.assets.map((asset) => ({
        ...asset,
        url: `blob:https://pattern.example/model-${asset.chapterId}`,
        provenance: { authoring: "codex-parametric/v1", documentRevision: manifest.revision,
          compilerVersion: "portrait-mesh-compiler/v1", programSha256: "a".repeat(64), sourceTextSha256: "b".repeat(64) },
      })),
    };
    for (const chapter of manifest.chapters) chapter.object!.imageUrl = `blob:https://pattern.example/image-${chapter.id}`;
    return { manifest, bundle: personal as unknown as PortraitMeshBundle };
  }

  it("accepts authenticated personal models with complete compiler and source provenance", () => {
    const { manifest, bundle } = personalFixture();
    expect(validateMeshBundle(manifest, bundle)).toBe(true);
  });

  it("rejects personal models without provenance or with unverified remote asset locations", () => {
    for (const update of [
      { provenance: undefined },
      { url: "https://public.example/model.glb" },
      { provenance: { authoring: "codex-parametric/v1", documentRevision: "old", compilerVersion: "portrait-mesh-compiler/v1", programSha256: "a".repeat(64), sourceTextSha256: "b".repeat(64) } },
      { provenance: { authoring: "codex-parametric/v1", documentRevision: "pattern-1:2026-09-06", compilerVersion: "unknown", programSha256: "a".repeat(64), sourceTextSha256: "b".repeat(64) } },
    ]) {
      const { manifest, bundle } = personalFixture();
      Object.assign(bundle.assets[0], update);
      expect(validateMeshBundle(manifest, bundle)).toBe(false);
    }
    const { manifest, bundle } = personalFixture();
    manifest.chapters[0].object!.imageUrl = "https://public.example/source.png";
    expect(validateMeshBundle(manifest, bundle)).toBe(false);
  });

  it("accepts four complete source-bound assets without depending on asset order", () => {
    const { manifest, bundle } = fixture();
    expect(validateMeshBundle(manifest, bundle)).toBe(true);
    expect(validateMeshBundle(manifest, { ...bundle, assets: [...bundle.assets].reverse() })).toBe(true);
  });

  it.each(["title", "summary", "sections", "tensions", "resources", "counterExpression"] as const)("rejects stale %s even if the document revision has not changed", (field) => {
    for (let index = 0; index < 4; index++) {
      const { manifest, bundle } = fixture();
      const chapter = manifest.chapters[index];
      if (field === "sections" || field === "tensions" || field === "resources") chapter[field][1] += " Changed.";
      else chapter[field] += " Changed.";
      expect(validateMeshBundle(manifest, bundle)).toBe(false);
    }
  });

  it("rejects missing or tampered full source text and stale revisions", () => {
    for (const sourceText of ["", "Exact summary.", '{"title":"Chapter"}', fixture().bundle.assets[0].sourceText + " "]) {
      const { manifest, bundle } = fixture();
      bundle.assets[0].sourceText = sourceText;
      expect(validateMeshBundle(manifest, bundle)).toBe(false);
    }
    const { manifest, bundle } = fixture();
    expect(validateMeshBundle(manifest, { ...bundle, documentRevision: "older-pattern" })).toBe(false);
    expect(validateMeshBundle(manifest, { ...bundle, version: "portrait-mesh-2" } as unknown as PortraitMeshBundle)).toBe(false);
    expect(validateMeshBundle(manifest, { ...bundle, authoring: "generated-personal-mesh" } as unknown as PortraitMeshBundle)).toBe(false);
  });

  it("rejects missing, duplicated, unknown, and path-like chapter identities", () => {
    const { manifest, bundle } = fixture();
    expect(validateMeshBundle(manifest, { ...bundle, assets: bundle.assets.slice(0, 3) })).toBe(false);
    expect(validateMeshBundle(manifest, { ...bundle, assets: [...bundle.assets, bundle.assets[0]] })).toBe(false);
    expect(validateMeshBundle({ ...manifest, chapters: manifest.chapters.slice(0, 3) }, bundle)).toBe(false);
    for (const chapterId of ["chapter-1", "chapter-5", "../chapter-2", "chapter-2/child", "", "__proto__"]) {
      const input = fixture();
      input.bundle.assets[1].chapterId = chapterId;
      expect(validateMeshBundle(input.manifest, input.bundle)).toBe(false);
    }
    const duplicate = fixture();
    duplicate.manifest.chapters[1].id = "chapter-1";
    expect(validateMeshBundle(duplicate.manifest, duplicate.bundle)).toBe(false);
  });

  it("rejects a missing image reference, invalid hashes, and mismatched image identity", () => {
    for (let index = 0; index < 4; index++) {
      const missing = fixture();
      delete missing.manifest.chapters[index].object;
      expect(validateMeshBundle(missing.manifest, missing.bundle)).toBe(false);
      const mismatched = fixture();
      mismatched.bundle.assets[index].sourceImageSha256 = "f".repeat(64);
      expect(validateMeshBundle(mismatched.manifest, mismatched.bundle)).toBe(false);
    }
    for (const hash of ["", "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
      for (const field of ["sha256", "sourceImageSha256"] as const) {
        const input = fixture(); input.bundle.assets[0][field] = hash;
        expect(validateMeshBundle(input.manifest, input.bundle)).toBe(false);
      }
      const input = fixture(); input.manifest.chapters[0].object!.referenceSha256 = hash;
      expect(validateMeshBundle(input.manifest, input.bundle)).toBe(false);
    }
    const input = fixture(); input.manifest.chapters[0].object!.referenceId = " ";
    expect(validateMeshBundle(input.manifest, input.bundle)).toBe(false);
  });

  it("accepts relative, HTTPS, HTTP, and authenticated blob asset and image URLs", () => {
    for (const prefix of ["/assets/", "https://assets.example/", "http://localhost/", "blob:https://pattern.example/"]) {
      const { manifest, bundle } = fixture();
      for (let index = 0; index < 4; index++) {
        bundle.assets[index].url = `${prefix}chapter-${index + 1}.glb`;
        manifest.chapters[index].object!.imageUrl = `${prefix}chapter-${index + 1}.png`;
      }
      expect(validateMeshBundle(manifest, bundle)).toBe(true);
    }
  });

  it("rejects unsafe or empty mesh and image URLs and duplicate asset locations", () => {
    for (const url of ["", "   ", "javascript:alert(1)", "data:model/gltf-binary;base64,AAAA", "file:///tmp/private.glb", "ftp://assets.example/chapter.glb", "https://["]) {
      const mesh = fixture(); mesh.bundle.assets[0].url = url;
      expect(validateMeshBundle(mesh.manifest, mesh.bundle)).toBe(false);
      const image = fixture(); image.manifest.chapters[0].object!.imageUrl = url;
      expect(validateMeshBundle(image.manifest, image.bundle)).toBe(false);
    }
    const input = fixture(); input.bundle.assets[1].url = input.bundle.assets[0].url;
    expect(validateMeshBundle(input.manifest, input.bundle)).toBe(false);
  });

  it("treats malformed boundary data as unavailable without throwing", () => {
    const { manifest, bundle } = fixture();
    for (const input of [null, undefined, {}, { ...bundle, assets: null }, { ...bundle, assets: [null, null, null, null] }]) {
      expect(validateMeshBundle(manifest, input as PortraitMeshBundle)).toBe(false);
    }
    for (const input of [null, {}, { ...manifest, chapters: null }]) {
      expect(validateMeshBundle(input as PortraitManifest, bundle)).toBe(false);
    }
  });
});
