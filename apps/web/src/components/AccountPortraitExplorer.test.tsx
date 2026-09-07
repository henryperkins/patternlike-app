import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import type { PatternPortraitResponse, PatternPortraitExplorerResponse, PatternResponseV7, PatternStatePattern, PortraitGraph } from "@patternlike/shared";
import { ApiError, getPatternPortraitExplorer, getPatternPortraitImage, getPatternPortraitModel, downloadPatternPortraitExplorer, getPatternState, getGeneratedPattern } from "../lib/api-client.js";
import type { PortraitSky } from "../lib/portrait-sky.js";
import { AccountPortraitExplorer } from "./AccountPortraitExplorer.js";
import { PatternExperience } from "./PatternExperience.js";
import { PortraitExplorer } from "./portrait-explorer/PortraitExplorer.js";
vi.mock("../lib/api-client.js", async (original) => ({ ...await original<typeof import("../lib/api-client.js")>(), getPatternPortraitExplorer: vi.fn(), getPatternPortraitImage: vi.fn(), getPatternPortraitModel: vi.fn(), downloadPatternPortraitExplorer: vi.fn(), getPatternState: vi.fn(), getGeneratedPattern: vi.fn() }));
vi.mock("./PortraitAutomationControl.js", () => ({ PortraitAutomationControl: ({ onChanged, canEnable }: { onChanged: () => void; canEnable?: boolean }) => <button data-testid="automation-control" data-can-enable={String(canEnable)} onClick={onChanged}>Optional automation choice</button> }));
vi.mock("./portrait-explorer/PortraitExplorer.js", () => ({ PortraitExplorer: vi.fn(({ navigation }: { navigation: { close: () => void } }) => <section id="portrait-start" tabIndex={-1} aria-label="Pattern portrait explorer">Personal interactive explorer<button onClick={navigation.close}>Back to reading</button></section>) }));
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
const props = { chartId: "chart-current", document, pattern, canCreate: true, onUnauthorized: unauthorized, legacy: <><p>Legacy saved portrait</p><p>Complete written reading</p></> };
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function modelBytes(metadata: object) {
  const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "chapter-1", extras: metadata }] });
  const text = new TextEncoder().encode(json), size = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + size), view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}
function saved() {
  const portrait = ready();
  const models = portrait.chapters.map((chapter) => ({ chapter_id: chapter.chapter_id, reference_id: `model-${chapter.chapter_id}`, sha256: "a".repeat(64), source_image_sha256: chapter.reference_sha256, source_text_sha256: hash(chapter.source_text), source_text: chapter.source_text, program_sha256: "c".repeat(64), compiler_version: "portrait-mesh-compiler/v1", document_revision: revision, authoring: "codex-parametric/v1" as const }));
  for (const model of models) {
    const bytes = modelBytes({ chapterId: model.chapter_id, documentRevision: revision, sourceImageSha256: model.source_image_sha256, sourceTextSha256: model.source_text_sha256, programSha256: model.program_sha256, compilerVersion: model.compiler_version, authoring: model.authoring });
    // Set the root name for each chapter, without bypassing the real source/hash validator.
    const json = new TextDecoder().decode(bytes.subarray(20)).trim().replace('"name":"chapter-1"', `"name":"${model.chapter_id}"`);
    const encoded = new TextEncoder().encode(json); bytes.fill(32, 20); bytes.set(encoded, 20);
    model.sha256 = hash(bytes);
    modelBlobs.set(model.reference_id, new Blob([bytes], { type: "model/gltf-binary" }));
  }
  return { schema_version: "pattern-portrait-explorer/v1", status: "ready", portrait, completed_models: 4, retryable: false, models } satisfies PatternPortraitExplorerResponse;
}
const modelBlobs = new Map<string, Blob>();
const sky: PortraitSky = { chartId: "chart-current", placements: [{ body: "sun", longitude: 42, sign: "taurus", degree: 12 }], unavailable: { moon: "missing", ascendant: "missing" } };
function show(overrides: Partial<typeof props> & { sky?: PortraitSky | null } = {}) { return render(<AccountPortraitExplorer {...props} {...overrides}><p>Complete written reading</p></AccountPortraitExplorer>); }
beforeEach(() => {
  vi.clearAllMocks(); modelBlobs.clear(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("Blob", NodeBlob);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({ route: "pattern" }, "");
  let serial = 0;
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => `blob:http://localhost/${++serial}`); static revokeObjectURL = vi.fn(); });
  vi.mocked(getPatternPortraitExplorer).mockResolvedValue(saved());
  vi.mocked(getPatternPortraitImage).mockResolvedValue(new Blob([bytes], { type: "image/png" }));
  vi.mocked(getPatternPortraitModel).mockImplementation(async (id) => modelBlobs.get(id)!);
});
describe("automated account portrait delivery", () => {
  it("carries supported sky facts through the Pattern account flow without changing saved source bindings", async () => {
    vi.mocked(getPatternState).mockResolvedValue({ schema_version: "0.9.0", state: "ready", chart: { chart_id: props.chartId, effective_accuracy: "exact", feature_policy_version: "1.0.0" }, consent: null, generation: null, pattern, regeneration: null });
    vi.mocked(getGeneratedPattern).mockResolvedValue(document);
    render(<PatternExperience chartId={props.chartId} onUnauthorized={unauthorized} sky={sky} />);
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await screen.findByText("Personal interactive explorer");
    const explorer = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(explorer.sky).toEqual(sky);
    expect(explorer.source).toEqual({ status: "ready", document, sunSign: "taurus" });
    expect(explorer.meshBundle.documentRevision).toBe(revision);
    expect(explorer.meshBundle.assets.map(asset => asset.sourceText)).toEqual(ready().chapters.map(chapter => chapter.source_text));
  });

  it("removes mismatched chart facts without discarding the saved portrait or refetching its assets", async () => {
    const view = show({ sky });
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await screen.findByText("Personal interactive explorer");
    const original = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(original.sky).toEqual(sky);
    view.rerender(<AccountPortraitExplorer {...props} sky={{ ...sky, chartId: "another-chart" }}><p>Complete written reading</p></AccountPortraitExplorer>);
    const current = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(current.sky).toBeNull();
    expect(current.source).toBe(original.source);
    expect(current.meshBundle).toBe(original.meshBundle);
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
  });

  it("keeps the automation preference reachable for a current Pattern with a different chapter count", () => {
    show({ document: { ...document, core_chapters: document.core_chapters.slice(0, 3) } });
    expect(screen.getByTestId("automation-control")).toBeInTheDocument();
    expect(screen.getByText(/3D portraits currently support four-chapter Patterns/)).toBeInTheDocument();
    expect(screen.getByText("Complete written reading")).toBeInTheDocument();
    expect(getPatternPortraitExplorer).not.toHaveBeenCalled();
  });

  it("loads the saved personal explorer on demand without a generation action, verifies private assets and cleans them up", async () => {
    const view = show();
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    expect(await screen.findByText("Personal interactive explorer")).toBeInTheDocument();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
    expect(getPatternPortraitImage).toHaveBeenCalledTimes(4);
    expect(vi.mocked(PortraitExplorer).mock.lastCall?.[0]).toMatchObject({ source: { document }, meshBundle: { authoring: "codex-parametric/v1", documentRevision: revision } });
    await userEvent.click(screen.getByRole("button", { name: "Back to reading" }));
    expect(screen.getByText("Complete written reading")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explore your 3D portrait" }));
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
  });
  it("rejects a stale model binding before fetching any assets", async () => {
    const value = saved(); value.models[2].source_text += "changed";
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue(value); show();
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer matches/);
    expect(getPatternPortraitModel).not.toHaveBeenCalled();
    expect(screen.getByText("Complete written reading")).toBeInTheDocument();
  });
  it("keeps reading visible and creates no URLs when an actual GLB hash differs", async () => {
    vi.mocked(getPatternPortraitModel).mockResolvedValue(new Blob(["different model"], { type: "model/gltf-binary" })); show();
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    expect(await screen.findByRole("button", { name: "Retry portrait loading" })).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText("Complete written reading")).toBeInTheDocument();
  });
  it("preserves the legacy account flow when connected model delivery is unavailable", async () => {
    vi.mocked(getPatternPortraitExplorer).mockRejectedValue(new ApiError(404, { error: { code: "not_found", message: "Not found" } })); show();
    expect(await screen.findByText("Legacy saved portrait")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows durable progress while keeping the complete reading available", async () => {
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue({ ...saved(), status: "generating", completed_models: 2, models: [] }); show();
    expect(await screen.findByText(/2 of 4 models/)).toBeInTheDocument();
    expect(screen.getByText("Complete written reading")).toBeInTheDocument();
    expect(getPatternPortraitModel).not.toHaveBeenCalled();
  });
  it("downloads the complete saved portrait with the current source identity", async () => {
    vi.mocked(downloadPatternPortraitExplorer).mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    show(); await userEvent.click(await screen.findByRole("button", { name: "Download complete portrait" }));
    expect(downloadPatternPortraitExplorer).toHaveBeenCalledWith({ chart_id: props.chartId, pattern_id: document.pattern_id, generated_at: document.generated_at }, expect.any(AbortSignal));
    expect(click).toHaveBeenCalledOnce();
  });
  it("aborts private downloads and ignores late assets after unmount", async () => {
    let release!: (value: Blob) => void;
    const gate = new Promise<Blob>((resolve) => { release = resolve; });
    vi.mocked(getPatternPortraitModel).mockReturnValue(gate); const view = show();
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await waitFor(() => expect(getPatternPortraitModel).toHaveBeenCalledTimes(4));
    const signal = vi.mocked(getPatternPortraitModel).mock.calls[0][1]!; view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => release(new Blob(["late"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("can cancel stalled asset loading and return to the original account history entry", async () => {
    vi.mocked(getPatternPortraitModel).mockReturnValue(new Promise(() => undefined));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await waitFor(() => expect(getPatternPortraitModel).toHaveBeenCalledTimes(4));
    const signal = vi.mocked(getPatternPortraitModel).mock.calls[0][1]!;
    await userEvent.click(screen.getByRole("button", { name: "Cancel portrait loading" }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Explore your 3D portrait" })).toBeEnabled();
    expect(screen.getByText("Complete written reading").parentElement).toHaveFocus();
    await waitFor(() => expect(window.history.state).toEqual({ route: "pattern" }));
  });

  it.each(["not_started", "generating", "failed"] as const)("keeps saved images and the legacy view available while mesh status is %s", async (status) => {
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue({ ...saved(), status, completed_models: 2, models: [] });
    show({ canCreate: false });
    expect(await screen.findByText("Legacy saved portrait")).toBeInTheDocument();
    expect(screen.getAllByText("Complete written reading")).toHaveLength(1);
    expect(screen.getByTestId("automation-control")).toHaveAttribute("data-can-enable", "false");
  });

  it("reveals and focuses the explorer after hydration and returns to reading when a status refresh fails", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    const explorer = await screen.findByText("Personal interactive explorer");
    await waitFor(() => expect(explorer).toHaveFocus());
    expect(vi.mocked(explorer.scrollIntoView).mock.contexts).toContain(explorer);
    expect(explorer.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    vi.mocked(getPatternPortraitExplorer).mockRejectedValueOnce(new Error("Refresh failed."));
    await userEvent.click(screen.getByTestId("automation-control"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed.");
    expect(screen.queryByText("Personal interactive explorer")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Complete written reading").parentElement).toHaveFocus());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
    await userEvent.click(screen.getByRole("button", { name: "Refresh portrait status" }));
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    expect(await screen.findByText("Personal interactive explorer")).toBeInTheDocument();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(8);
  });

  it("aborts asset hydration immediately when refreshed authorization fails", async () => {
    let release!: (blob: Blob) => void;
    vi.mocked(getPatternPortraitModel).mockReturnValue(new Promise(resolve => { release = resolve; }));
    show(); await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await waitFor(() => expect(getPatternPortraitModel).toHaveBeenCalledTimes(4));
    const signal = vi.mocked(getPatternPortraitModel).mock.calls[0][1]!;
    vi.mocked(getPatternPortraitExplorer).mockRejectedValueOnce(new Error("Current source unavailable."));
    await userEvent.click(screen.getByTestId("automation-control"));
    await screen.findByText("Current source unavailable.");
    expect(signal.aborted).toBe(true);
    await act(async () => release(modelBlobs.values().next().value!));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("preserves hydrated source and mesh props across an unchanged status refresh", async () => {
    show(); await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await screen.findByText("Personal interactive explorer");
    const original = vi.mocked(PortraitExplorer).mock.lastCall![0];
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue(saved());
    await userEvent.click(screen.getByTestId("automation-control"));
    await waitFor(() => expect(getPatternPortraitExplorer).toHaveBeenCalledTimes(2));
    const latest = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(latest.source).toBe(original.source); expect(latest.meshBundle).toBe(original.meshBundle);
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
