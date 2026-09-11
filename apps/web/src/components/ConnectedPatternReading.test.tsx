import { useEffect } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, type ReaderPatternTarget } from "@patternlike/shared";
import { fictionalPattern } from "../preview/pattern-portrait-fixture.js";
import { chapterSourceText, createPortraitManifest } from "../lib/pattern-portrait.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import { PortraitSessionProvider } from "./portrait-explorer/portrait-session.js";
import type { PortraitSceneProps } from "./portrait-explorer/types.js";
import { ConnectedPatternReading } from "./ConnectedPatternReading.js";

vi.mock("./portrait-explorer/PortraitScene.js", () => ({ default: (props: PortraitSceneProps) => {
  useEffect(() => { props.onStatus("unavailable"); }, [props.onStatus]);
  return <div>Graphics unavailable in this test</div>;
} }));

beforeEach(() => {
  window.history.replaceState({ readerJourney: { scope: "source-reader", index: 2 } }, "", "#today");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  mockApiResponses({ "/v1/pattern-portrait/explorer": { status: 404, body: { error: { code: "unavailable", message: "No artwork" } } } });
});

describe("an exact Pattern connection", () => {
  it.each([3, 4, 5, 6])("opens the bound chapter of a %i-chapter Pattern and returns without artwork or grants", async (count) => {
    const user = userEvent.setup();
    const document = { ...fictionalPattern, core_chapters: Array.from({ length: count }, (_, index) => ({ ...fictionalPattern.core_chapters[index % 4]!, title: `Published chapter ${index + 1}` })) };
    const manifest = createPortraitManifest(document);
    const target: ReaderPatternTarget = { kind: "pattern", pattern_id: document.pattern_id, document_revision: manifest.revision, content_hash: `sha256:${"a".repeat(64)}`, chapter_index: count - 1, chapter_source_sha256: await sha256Hex(chapterSourceText(manifest.chapters[count - 1]!)) };
    render(<PortraitSessionProvider><ConnectedPatternReading document={document} target={target} chartId="chart-current" onUnauthorized={vi.fn()} /></PortraitSessionProvider>);
    const originState = window.history.state;
    await user.tab();
    expect(screen.getByRole("button", { name: "Explore your 3D portrait" })).toHaveFocus();
    await user.keyboard("{Enter}");
    const explorer = await screen.findByRole("region", { name: "Pattern portrait explorer" });
    const heading = within(explorer).getByRole("heading", { name: `Published chapter ${count}` });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(explorer).getByText(`Chapter ${count} of ${count}`)).toBeInTheDocument();
    expect(window.history.state.readerJourney).toEqual(originState.readerJourney);
    await user.click(within(explorer).getByRole("button", { name: "Back to reading" }));
    await waitFor(() => expect(window.history.state).toEqual(originState));
    await waitFor(() => expect(globalThis.document.querySelector(`[data-reading-chapter="chapter-${count}"]`)).toHaveFocus());
    const artworkReads = capturedFor("/v1/pattern-portrait/explorer");
    expect(artworkReads).toHaveLength(1);
    expect(artworkReads[0].headers.get("x-patternlike-portrait-protocol")).toBe("v2");
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
});
