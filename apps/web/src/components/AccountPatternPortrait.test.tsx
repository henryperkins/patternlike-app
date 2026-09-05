import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import type { PatternPortraitResponse, PatternResponseV7, PatternStatePattern, PortraitGraph } from "@patternlike/shared";
import { ApiError, downloadPatternPortrait, getPatternPortrait, getPatternPortraitImage, startPatternPortraitGeneration } from "../lib/api-client.js";
import { AccountPatternPortrait } from "./AccountPatternPortrait.js";
import { PatternPortrait } from "./PatternPortrait.js";

vi.mock("../lib/api-client.js", async (original) => ({ ...await original<typeof import("../lib/api-client.js")>(), getPatternPortrait: vi.fn(), getPatternPortraitImage: vi.fn(), startPatternPortraitGeneration: vi.fn(), downloadPatternPortrait: vi.fn() }));
vi.mock("./PatternPortrait.js", () => ({ PatternPortrait: vi.fn(() => <div>Saved constellation</div>) }));

const document: PatternResponseV7 = {
  schema_version: "0.7.0", pattern_id: "pat_account", generated_at: "2026-09-05T12:00:00Z", locale: "en-US", effective_accuracy: "exact",
  provenance: { assembly_mode: "constrained_model", provider: "OpenAI", model_family: "gpt", raw_birth_details_sent: false },
  core_chapters: Array.from({ length: 4 }, (_, index) => ({ title: `Chapter ${index + 1}`, summary: `Summary ${index}`, sections: [{ text: `Body ${index}` }], tensions: [{ text: `Tension ${index}` }], resources: [{ text: `Resource ${index}` }], counter_expression: { text: `Alternative ${index}` } })),
  additional_signatures: [], uncertainty: null,
};
const pattern: PatternStatePattern = { pattern_id: document.pattern_id, generated_at: document.generated_at, locale: document.locale, effective_accuracy: document.effective_accuracy };
const graph: PortraitGraph = { engine_version: "constellation-v1", positions: [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], source_indices: [0, 1, 2, 3], star_strengths: [1, 1, 1, 1], connections: [[0, 1], [1, 2], [2, 3]], color: [0.5, 0.4, 0.3], contributions: Array.from({ length: 4 }, (_, index) => ({ index, aspect: 1, coverage: 0.5, opening_area: 0, skew: 0, stars: 1, interior_lines: 0 })) };
const bytes = new Uint8Array([1, 2, 3]);
// SHA256 of the exact bytes returned by the private image fixture.
const imageHash = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const revision = `0.7.0:${document.pattern_id}:${document.generated_at}`;
function response(overrides: Partial<PatternPortraitResponse> = {}): PatternPortraitResponse {
  return { schema_version: "pattern-portrait/v1", status: "not_started", portrait_id: null, chart_id: "chart-current", pattern_id: document.pattern_id, generated_at: document.generated_at, document_revision: revision, sun_sign: "taurus", completed_chapters: 0, retryable: true, chapters: [], graph: null, ...overrides };
}
function ready(): PatternPortraitResponse {
  return response({ status: "ready", portrait_id: "portrait-current", completed_chapters: 4, retryable: false, graph, chapters: document.core_chapters.map((chapter, index) => ({ chapter_id: `chapter-${index + 1}`, reference_id: `reference-${index + 1}`, label: `Object ${index + 1}`, rationale: "The object illustrates this chapter.", reference_sha256: imageHash, source_text: JSON.stringify({ title: chapter.title, summary: chapter.summary, sections: chapter.sections.map(({ text }) => text), tensions: chapter.tensions.map(({ text }) => text), resources: chapter.resources.map(({ text }) => text), counterExpression: chapter.counter_expression.text }) })) });
}
const unauthorized = vi.fn();
const props = { chartId: "chart-current", document, pattern, canCreate: true, onUnauthorized: unauthorized };
function show(overrides: Partial<typeof props> = {}) {
  return render(<AccountPatternPortrait {...props} {...overrides}><p>Published reading remains available.</p></AccountPatternPortrait>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", NodeBlob);
  vi.mocked(getPatternPortrait).mockResolvedValue(response());
  vi.mocked(getPatternPortraitImage).mockResolvedValue(new Blob([bytes], { type: "image/png" }));
  vi.mocked(startPatternPortraitGeneration).mockResolvedValue(response({ status: "generating" }));
  vi.mocked(downloadPatternPortrait).mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
  let serial = 0;
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => `blob:http://localhost/${++serial}`); static revokeObjectURL = vi.fn(); });
});
afterEach(() => vi.useRealTimers());

describe("account Pattern portrait", () => {
  it("discloses chapter text sharing and creates only after the explicit action", async () => {
    show();
    const create = await screen.findByRole("button", { name: "Create my constellation" });
    expect(screen.getByText(/each chapter.*Codex/i)).toBeInTheDocument();
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
    expect(startPatternPortraitGeneration).not.toHaveBeenCalled();
    await userEvent.click(create);
    expect(startPatternPortraitGeneration).toHaveBeenCalledWith({ chart_id: "chart-current", pattern_id: document.pattern_id, generated_at: document.generated_at, confirm: "CREATE MY PORTRAIT", consent_policy_version: "1.0.0" }, expect.stringMatching(/^web-pattern-portrait-/), expect.any(AbortSignal));
    expect(await screen.findByText(/0 of 4 chapter images/i)).toBeInTheDocument();
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
  });

  it("never reads portrait state for a mismatched published document", () => {
    show({ pattern: { ...pattern, pattern_id: "other-pattern" } });
    expect(getPatternPortrait).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create my constellation" })).toBeNull();
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
  });

  it.each([{ chart_id: "other-chart" }, { pattern_id: "other-pattern" }, { generated_at: "old" }, { document_revision: "old-revision" }])("rejects stale portrait identity %j", async (identity) => {
    vi.mocked(getPatternPortrait).mockResolvedValue({ ...ready(), ...identity });
    show();
    expect(await screen.findByText(/no longer matches/i)).toBeInTheDocument();
    expect(getPatternPortraitImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "View constellation" })).toBeNull();
  });

  it("renders the saved graph before image bytes arrive, verifies all four, and reopens without another fetch", async () => {
    let release!: (value: Blob) => void;
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    vi.mocked(getPatternPortraitImage).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    // Each image waits on the same explicit gate.
    const gate = new Promise<Blob>((resolve) => { release = resolve; });
    vi.mocked(getPatternPortraitImage).mockReturnValue(gate);
    const view = show();
    await userEvent.click(await screen.findByRole("button", { name: "View constellation" }));
    expect(screen.getByText("Saved constellation")).toBeInTheDocument();
    expect(vi.mocked(PatternPortrait).mock.lastCall?.[0]).toMatchObject({ graph, source: { document, sunSign: "taurus" } });
    expect(vi.mocked(PatternPortrait).mock.lastCall?.[0].objectBindings?.every((binding) => binding.object.imageUrl === "")).toBe(true);
    await act(async () => release(new Blob([bytes], { type: "image/png" })));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(4));
    expect(vi.mocked(PatternPortrait).mock.lastCall?.[0].objectBindings?.every((binding) => binding.object.imageUrl.startsWith("blob:"))).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Back to reading" }));
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View constellation" }));
    expect(getPatternPortraitImage).toHaveBeenCalledTimes(4);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("does not show mismatched chapter bindings or fetch their images", async () => {
    const saved = ready();
    saved.chapters[1].source_text += "Different prose";
    vi.mocked(getPatternPortrait).mockResolvedValue(saved);
    show();
    expect(await screen.findByText(/no longer matches/i)).toBeInTheDocument();
    expect(getPatternPortraitImage).not.toHaveBeenCalled();
  });

  it("keeps the saved graph and reading usable when an image hash is wrong", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    vi.mocked(getPatternPortraitImage).mockResolvedValue(new Blob(["wrong bytes"], { type: "image/png" }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "View constellation" }));
    expect(await screen.findByText(/images could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText("Saved constellation")).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back to reading" }));
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
  });

  it("preserves the idempotency key when retrying an uncertain start", async () => {
    vi.mocked(startPatternPortraitGeneration).mockRejectedValueOnce(new Error("Connection lost."));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Create my constellation" }));
    expect(await screen.findByText("Connection lost.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create my constellation" }));
    const calls = vi.mocked(startPatternPortraitGeneration).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toBe(calls[0][1]);
  });

  it("blocks creation after consent revocation but permits an already saved portrait", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    show({ canCreate: false });
    expect(await screen.findByRole("button", { name: "View constellation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create my constellation" })).toBeNull();
  });

  it("aborts old requests and ignores late completion after a chart change", async () => {
    let release!: (value: PatternPortraitResponse) => void;
    vi.mocked(getPatternPortrait).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const view = show();
    const signal = vi.mocked(getPatternPortrait).mock.calls[0][0]!;
    view.rerender(<AccountPatternPortrait {...props} chartId="replacement-chart"><p>Replacement reading</p></AccountPatternPortrait>);
    expect(signal.aborted).toBe(true);
    await act(async () => release(ready()));
    expect(screen.queryByRole("button", { name: "View constellation" })).toBeNull();
    expect(getPatternPortraitImage).not.toHaveBeenCalled();
  });

  it("reports image authentication failure to the app", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    vi.mocked(getPatternPortraitImage).mockRejectedValue(new ApiError(401, { error: { code: "unauthorized", message: "Sign in." } }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "View constellation" }));
    await waitFor(() => expect(unauthorized).toHaveBeenCalled());
  });

  it("polls visible in-progress work and stops when the saved portrait is ready", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValueOnce(response({ status: "generating", completed_chapters: 2 })).mockResolvedValue(ready());
    const visibility = vi.spyOn(globalThis.document, "visibilityState", "get").mockReturnValue("hidden");
    vi.useFakeTimers();
    const view = show();
    await act(async () => undefined);
    expect(screen.getByText(/2 of 4 chapter images/i)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getPatternPortrait).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await act(async () => globalThis.document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("button", { name: "View constellation" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getPatternPortrait).toHaveBeenCalledTimes(2);
    expect(getPatternPortraitImage).not.toHaveBeenCalled();
    view.unmount();
  });

  it("lets a slow status response finish instead of aborting it at every polling interval", async () => {
    let release!: (value: PatternPortraitResponse) => void;
    vi.mocked(getPatternPortrait).mockResolvedValueOnce(response({ status: "generating", completed_chapters: 3 }))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.spyOn(globalThis.document, "visibilityState", "get").mockReturnValue("visible");
    vi.useFakeTimers();
    const view = show();
    await act(async () => undefined);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const slowSignal = vi.mocked(getPatternPortrait).mock.calls[1][0]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(slowSignal.aborted).toBe(false);
    expect(getPatternPortrait).toHaveBeenCalledTimes(2);
    await act(async () => release(ready()));
    expect(screen.getByRole("button", { name: "View constellation" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getPatternPortrait).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("retries failed generation explicitly, retaining partial progress", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(response({ status: "failed", completed_chapters: 2 }));
    show();
    expect(await screen.findByText(/2 of 4 chapter images are saved/i)).toBeInTheDocument();
    expect(startPatternPortraitGeneration).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry constellation creation" }));
    expect(startPatternPortraitGeneration).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable and terminal failures readable without a create action", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(response({ status: "unavailable", chart_id: null, pattern_id: null, generated_at: null, document_revision: null }));
    const view = show();
    expect(await screen.findByText(/creation is not available/i)).toBeInTheDocument();
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create|Retry constellation/ })).toBeNull();
    view.unmount();
    vi.mocked(getPatternPortrait).mockResolvedValue(response({ status: "failed", retryable: false }));
    show();
    expect(await screen.findByText(/could not be completed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry constellation creation" })).toBeNull();
  });

  it("aborts pending private images and never creates URLs after unmount", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    let release!: (blob: Blob) => void;
    vi.mocked(getPatternPortraitImage).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const view = show();
    await userEvent.click(await screen.findByRole("button", { name: "View constellation" }));
    const requests = vi.mocked(getPatternPortraitImage).mock.calls;
    expect(requests).toHaveLength(4);
    view.unmount();
    expect(requests.every(([, signal]) => signal?.aborted)).toBe(true);
    await act(async () => release(new Blob([bytes], { type: "image/png" })));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("discards hydrated URLs when state metadata switches to a different Pattern", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    const view = show();
    await userEvent.click(await screen.findByRole("button", { name: "View constellation" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(4));
    view.rerender(<AccountPatternPortrait {...props} pattern={{ ...pattern, pattern_id: "replacement" }}><p>Published reading remains available.</p></AccountPatternPortrait>);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
    expect(screen.queryByText("Saved constellation")).toBeNull();
    expect(screen.getByText("Published reading remains available.")).toBeInTheDocument();
  });

  it("downloads only after a click and includes expected chart and Pattern identity", async () => {
    vi.mocked(getPatternPortrait).mockResolvedValue(ready());
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const view = show();
    const button = await screen.findByRole("button", { name: "Download constellation" });
    expect(downloadPatternPortrait).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(downloadPatternPortrait).toHaveBeenCalledWith({ chart_id: props.chartId, pattern_id: document.pattern_id, generated_at: document.generated_at }, expect.any(AbortSignal));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0]).toMatchObject({ download: "pattern-portrait.json", href: "blob:http://localhost/1" });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/1");
  });
});
