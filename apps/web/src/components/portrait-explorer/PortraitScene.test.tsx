import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PortraitScene from "./PortraitScene.js";
import type { PortraitSceneProps } from "./types.js";

const props = (): PortraitSceneProps => ({
  assets: [{ chapterId: "direction", url: "/portrait-explorer/compass.glb", sha256: "0".repeat(64), sourceImageSha256: "1".repeat(64), sourceText: "Exact source" }],
  chapters: [{ id: "direction", title: "Finding your own direction", ordinal: 1 }],
  selectedIds: ["direction"], facet: "tensions", activePassages: { direction: 1 }, unfolded: false, reducedMotion: true,
  expanded: false, quality: "standard", viewKey: "chapter:direction", command: { kind: "right", serial: 8 },
  onBookmark: vi.fn(), onSelect: vi.fn(), onAnnotation: vi.fn(), onStatus: vi.fn(),
});

afterEach(() => vi.unstubAllGlobals());

it("reports unavailable graphics without removing the separately rendered reading", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not a GLB")));
  const callbacks = props();
  render(<><p>Every original paragraph remains readable.</p><p role="status">Reading is always available.</p><PortraitScene {...callbacks} /></>);
  await waitFor(() => expect(callbacks.onStatus).toHaveBeenCalledWith("unavailable"));
  expect(screen.getByText("Every original paragraph remains readable.")).toBeVisible();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Reading is always available.");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("aborts pending model delivery on unmount and does not publish a late ready state", async () => {
  let requestSignal: AbortSignal | undefined;
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    requestSignal = options.signal as AbortSignal;
    return new Promise<Response>(done => { resolve = done; });
  }));
  const callbacks = props();
  const { unmount } = render(<PortraitScene {...callbacks} />);
  expect(requestSignal?.aborted).toBe(false);
  unmount();
  expect(requestSignal?.aborted).toBe(true);
  await act(async () => { resolve(new Response("late bytes")); });
  expect(callbacks.onStatus).not.toHaveBeenCalledWith("ready");
  expect(callbacks.onStatus).not.toHaveBeenCalledWith("unavailable");
});
