import { describe, expect, it } from "vitest";
import type { PatternPortraitResponseV2, PatternPortraitExplorerResponseV2 } from "@patternlike/shared";
import { adaptiveFixture } from "../test/adaptive-portrait-fixture.js";
import { validateResponse, validateExplorerResponse, validatePortraitDownload, verifyPortraitDownloadBlob } from "./account-portrait.js";

describe("adaptive private artwork validation", () => {
  it.each([3, 4, 5, 6] as const)("accepts exactly %i ordered images/models and downloads", count => {
    const f = adaptiveFixture(count);
    expect(() => validateResponse(f.portrait, "chart-fictional", f.document)).not.toThrow();
    expect(() => validateExplorerResponse(f.explorer, "chart-fictional", f.document)).not.toThrow();
    expect(() => validatePortraitDownload(f.download, "chart-fictional", f.document)).not.toThrow();
    expect(() => validatePortraitDownload(f.fullDownload, "chart-fictional", f.document, true)).not.toThrow();
    for (const change of [{ chapter_count: 2 }, { chapter_count: null }, { chapter_count: count === 3 ? 4 : 3 }, { completed_chapters: count - 1 }, { chapters: f.portrait.chapters.slice(1) }, { chapters: [...f.portrait.chapters].reverse() }, { graph: { ...f.portrait.graph, engine_version: "constellation-v1" } }]) expect(() => validateResponse({ ...f.portrait, ...change } as PatternPortraitResponseV2, "chart-fictional", f.document)).toThrow();
    for (const change of [{ chapter_count: 2 }, { document_revision: "different" }, { completed_models: count - 1 }, { models: f.explorer.models.slice(1) }, { models: [...f.explorer.models].reverse() }, { models: f.explorer.models.map(m => ({ ...m, chapter_index: 0 })) }, { models: f.explorer.models.map(m => ({ ...m, source_image_sha256: "e".repeat(64) })) }, { models: f.explorer.models.map(m => ({ ...m, authoring: "codex-parametric/v1" })) }]) expect(() => validateExplorerResponse({ ...f.explorer, ...change } as PatternPortraitExplorerResponseV2, "chart-fictional", f.document)).toThrow();
    expect(() => validatePortraitDownload({ ...f.download, images: f.download.images.slice(1) }, "chart-fictional", f.document)).toThrow();
    expect(() => validatePortraitDownload({ ...f.fullDownload, models: [f.fullDownload.models[0], ...f.fullDownload.models.slice(0, -1)] }, "chart-fictional", f.document, true)).toThrow();
  });
  it("keeps a null count only for a source-less unavailable response", () => {
    const f = adaptiveFixture(3);
    const response: PatternPortraitResponseV2 = { ...f.portrait, chapter_count: null, status: "unavailable", document_revision: null, completed_chapters: 0, chapters: [], graph: null };
    expect(() => validateResponse(response, "chart-fictional", f.document)).not.toThrow();
    expect(() => validateResponse({ ...response, document_revision: "current" }, "chart-fictional", f.document)).toThrow();
  });
});

import { createHash, webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { vi } from "vitest";
it("rejects downloaded bytes that disagree with their saved hashes before saving", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const f = adaptiveFixture(6);
  const sha = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
  for (const chapter of f.portrait.chapters) chapter.reference_sha256 = sha;
  for (const image of f.download.images) { image.sha256 = sha; image.data_base64 = "AQID"; }
  const signal = new AbortController().signal;
  await expect(verifyPortraitDownloadBlob(new NodeBlob([JSON.stringify(f.download)]) as Blob, "chart-fictional", f.document, signal)).resolves.toBeUndefined();
  f.download.images[5].data_base64 = "AQIE";
  await expect(verifyPortraitDownloadBlob(new NodeBlob([JSON.stringify(f.download)]) as Blob, "chart-fictional", f.document, signal)).rejects.toThrow(/no longer matches/);
});
