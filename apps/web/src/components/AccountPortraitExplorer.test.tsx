import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import type { PatternPortraitResponseV1 as PatternPortraitResponse, PatternPortraitExplorerResponse, PatternResponseV7, PatternStatePattern, PortraitGraphV1 as PortraitGraph } from "@patternlike/shared";
import { ApiError, getPatternPortraitExplorer, getPatternPortraitImage, getPatternPortraitModel, downloadPatternPortraitExplorer, getPatternState, getGeneratedPattern, deleteGeneratedPattern } from "../lib/api-client.js";
import type { PortraitSky } from "../lib/portrait-sky.js";
import { AccountPortraitExplorer } from "./AccountPortraitExplorer.js";
import { PatternExperience } from "./PatternExperience.js";
import { PortraitExplorer } from "./portrait-explorer/PortraitExplorer.js";
import { PortraitSessionProvider, usePortraitSession } from "./portrait-explorer/portrait-session.js";
vi.mock("../lib/api-client.js", async (original) => ({ ...await original<typeof import("../lib/api-client.js")>(), getPatternPortraitExplorer: vi.fn(), getPatternPortraitImage: vi.fn(), getPatternPortraitModel: vi.fn(), downloadPatternPortraitExplorer: vi.fn(), getPatternState: vi.fn(), getGeneratedPattern: vi.fn(), deleteGeneratedPattern: vi.fn() }));
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
async function hydrated() {
  await waitFor(() => expect(vi.mocked(PortraitExplorer).mock.lastCall?.[0].meshBundle?.assets).toHaveLength(4));
}
beforeEach(async () => {
  await new Promise(resolve => window.setTimeout(resolve, 0));
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
  it.each([3, 4, 5, 6])("opens the observatory by default for a %i-chapter Pattern before artwork is available", async (count) => {
    vi.mocked(getPatternPortraitExplorer).mockReturnValue(new Promise(() => undefined));
    const current = { ...document, core_chapters: Array.from({ length: count }, (_, index) => ({ ...document.core_chapters[index % 4], title: `Chapter ${index + 1}` })) };
    show({ document: current, canCreate: false });
    expect(await screen.findByRole("region", { name: "Pattern portrait explorer" })).toBeInTheDocument();
    expect(vi.mocked(PortraitExplorer).mock.lastCall![0].source).toMatchObject({ document: current });
    expect(getPatternPortraitModel).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Chapter artwork" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("automation-control")).not.toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "not_started", "generating", "failed"] as const)("keeps the default observatory open when artwork is %s", async (status) => {
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue({ ...saved(), status, completed_models: 0, retryable: false, models: [] });
    show();
    await waitFor(() => expect(screen.queryByText("Checking your saved portrait.")).not.toBeInTheDocument());
    expect(await screen.findByRole("region", { name: "Pattern portrait explorer" })).toBeInTheDocument();
    expect(getPatternPortraitModel).not.toHaveBeenCalled();
  });

  it("releases retained portrait bytes and navigation when the Pattern is deleted", async () => {
    let session!: ReturnType<typeof usePortraitSession>;
    function CaptureSession() { session = usePortraitSession(JSON.stringify([props.chartId, document])); return null; }
    const state = { schema_version: "0.9.0" as const, state: "ready" as const, chart: { chart_id: props.chartId, effective_accuracy: "exact" as const, feature_policy_version: "1.0.0" }, consent: null, generation: null, pattern, regeneration: null };
    vi.mocked(getPatternState).mockResolvedValue(state);
    vi.mocked(getGeneratedPattern).mockResolvedValue(document);
    vi.mocked(deleteGeneratedPattern).mockResolvedValue({ receipt: "accepted", erasureCompleted: null });
    render(<PortraitSessionProvider><CaptureSession /><PatternExperience chartId={props.chartId} onUnauthorized={unauthorized} /></PortraitSessionProvider>);
    const accountEntry = window.history.state;
    await hydrated();
    act(() => {
      const { dispatch } = vi.mocked(PortraitExplorer).mock.lastCall![0].navigation!;
      dispatch({ type: "select", chapterId: "chapter-2" });
      dispatch({ type: "facet", facet: "resources" });
      dispatch({ type: "presentation", presentation: "reading" });
    });
    await hydrated();
    expect(session.verified?.artifacts).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Delete this Pattern" }));
    await userEvent.type(screen.getByLabelText(/Type DELETE PATTERN to confirm/), "DELETE PATTERN");
    vi.mocked(getPatternState).mockResolvedValue({ ...state, state: "deleted", pattern: null });
    await userEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await screen.findByRole("heading", { name: "This Pattern was deleted and cannot be regenerated for this chart." });
    expect(session.verified).toBeNull();
    expect(session.memory.snapshot).toBeNull();
    expect(session.memory.history.entries.size).toBe(0);
    await waitFor(() => expect(window.history.state).toEqual(accountEntry));
  });
  it("retains a deliberate reading choice across remounts and focuses an explicit reopen", async () => {
    function Routes() {
      const [visible, setVisible] = useState(true);
      return <PortraitSessionProvider><button onClick={() => setVisible(value => !value)}>Change page</button>
        {visible && <AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer>}
      </PortraitSessionProvider>;
    }
    render(<Routes />);
    await hydrated();
    await userEvent.click(screen.getByRole("button", { name: "Back to reading" }));
    await waitFor(() => expect(window.history.state).toEqual({ route: "pattern" }));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    expect(screen.queryByText("Personal interactive explorer")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explore your 3D portrait" }));
    expect(screen.getByText("Personal interactive explorer")).toHaveFocus();
  });

  it("reuses verified blobs with fresh URLs when returning to a retained history entry", async () => {
    function Routes() {
      const [visible, setVisible] = useState(true);
      return <PortraitSessionProvider><button onClick={() => setVisible(value => !value)}>Change page</button>
        {visible && <AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer>}
      </PortraitSessionProvider>;
    }
    render(<Routes />);
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    const original = vi.mocked(PortraitExplorer).mock.lastCall![0];
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await hydrated();
    const reopened = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(getPatternPortraitExplorer).toHaveBeenCalledTimes(2);
    expect(getPatternPortraitImage).toHaveBeenCalledTimes(4);
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
    expect(reopened.meshBundle!.assets[0].url).not.toBe(original.meshBundle!.assets[0].url);
    expect(reopened.meshBundle!.assets[0].sourceText).toBe(original.meshBundle!.assets[0].sourceText);
  });

  it("refetches assets when the authenticated response changes their identity", async () => {
    function Routes() {
      const [visible, setVisible] = useState(true);
      return <PortraitSessionProvider><button onClick={() => setVisible(value => !value)}>Change page</button>
        {visible && <AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer>}
      </PortraitSessionProvider>;
    }
    render(<Routes />);
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    const replacement = saved();
    for (const model of replacement.models) {
      const blob = modelBlobs.get(model.reference_id)!;
      model.reference_id += "-replacement";
      modelBlobs.set(model.reference_id, blob);
    }
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue(replacement);
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    expect(getPatternPortraitImage).toHaveBeenCalledTimes(8);
    await hydrated();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(8);
  });

  it("discards cached bytes when the session boundary is replaced", async () => {
    const renderSession = (key: number) => <PortraitSessionProvider key={key}><AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer></PortraitSessionProvider>;
    const view = render(renderSession(1));
    await hydrated();
    view.rerender(renderSession(2));
    await hydrated();
    await hydrated();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(8);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
  });

  it("does not reveal cached assets when a fresh status request is unauthorized", async () => {
    function Routes() {
      const [visible, setVisible] = useState(true);
      return <PortraitSessionProvider><button onClick={() => setVisible(value => !value)}>Change page</button>
        {visible && <AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer>}
      </PortraitSessionProvider>;
    }
    render(<Routes />);
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    vi.mocked(getPatternPortraitExplorer).mockRejectedValueOnce(new ApiError(401, { error: { code: "unauthorized", message: "Sign in again" } }));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await waitFor(() => expect(unauthorized).toHaveBeenCalledOnce());
    expect(screen.queryByText("Personal interactive explorer")).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(8);
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await userEvent.click(await screen.findByRole("button", { name: "Explore your 3D portrait" }));
    await hydrated();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(8);
  });
  it("carries supported sky facts through the Pattern account flow without changing saved source bindings", async () => {
    vi.mocked(getPatternState).mockResolvedValue({ schema_version: "0.9.0", state: "ready", chart: { chart_id: props.chartId, effective_accuracy: "exact", feature_policy_version: "1.0.0" }, consent: null, generation: null, pattern, regeneration: null });
    vi.mocked(getGeneratedPattern).mockResolvedValue(document);
    render(<PatternExperience chartId={props.chartId} onUnauthorized={unauthorized} sky={sky} />);
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    const explorer = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(explorer.sky).toEqual(sky);
    expect(explorer.source).toEqual({ status: "ready", document, sunSign: "taurus" });
    expect(explorer.meshBundle!.documentRevision).toBe(revision);
    expect(explorer.meshBundle!.assets.map(asset => asset.sourceText)).toEqual(ready().chapters.map(chapter => chapter.source_text));
  });

  it("removes mismatched chart facts without discarding the saved portrait or refetching its assets", async () => {
    const view = show({ sky });
    await screen.findByText("Personal interactive explorer");
    await hydrated();
    const original = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(original.sky).toEqual(sky);
    view.rerender(<AccountPortraitExplorer {...props} sky={{ ...sky, chartId: "another-chart" }}><p>Complete written reading</p></AccountPortraitExplorer>);
    const current = vi.mocked(PortraitExplorer).mock.lastCall![0];
    expect(current.sky).toBeNull();
    expect(current.source).toBe(original.source);
    expect(current.meshBundle).toBe(original.meshBundle);
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(4);
  });

  it("loads the saved personal explorer by default without a generation action, verifies private assets and cleans them up", async () => {
    const view = show();
    await screen.findByText("Personal interactive explorer");
    expect(await screen.findByText("Personal interactive explorer")).toBeInTheDocument();
    await hydrated();
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
    expect(screen.getByText("Personal interactive explorer")).toBeInTheDocument();
  });
  it("keeps reading visible and creates no URLs when an actual GLB hash differs", async () => {
    vi.mocked(getPatternPortraitModel).mockResolvedValue(new Blob(["different model"], { type: "model/gltf-binary" })); show();
    await screen.findByText("Personal interactive explorer");
    expect(await screen.findByRole("button", { name: "Retry portrait loading" })).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText("Personal interactive explorer")).toBeInTheDocument();
  });
  it("keeps the observatory when connected model delivery is unavailable", async () => {
    vi.mocked(getPatternPortraitExplorer).mockRejectedValue(new ApiError(404, { error: { code: "not_found", message: "Not found" } })); show();
    expect(await screen.findByText("Personal interactive explorer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps background artwork progress out of the reading", async () => {
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue({ ...saved(), status: "generating", completed_models: 2, models: [] }); show();
    expect(await screen.findByText("Personal interactive explorer")).toBeInTheDocument();
    expect(screen.queryByText(/2 of 4 models/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Chapter artwork" })).not.toBeInTheDocument();
    expect(getPatternPortraitModel).not.toHaveBeenCalled();
  });
  it("downloads the complete saved portrait with the current source identity", async () => {
    const explorer = saved();
    const download = { schema_version: "pattern-portrait-explorer-download/v1", reading: document, explorer,
      images: explorer.portrait.chapters.map(c => ({ reference_id: c.reference_id, content_type: "image/png", sha256: c.reference_sha256, data_base64: "AQID" })),
      models: explorer.models.map(m => ({ reference_id: m.reference_id, content_type: "model/gltf-binary", sha256: m.sha256, data_base64: "AAAA",
        program: { version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }], parts: [{ name: "body", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1, 1], bevel: 0.04 } }] },
        audit: { schema_version: "portrait-mesh-audit/v1", accepted: true, recognizable: true, substantial: true, source_correspondence: true, no_severe_intersections: true, view_count: 4, notes: "Four views checked." } })) };
    for (const [index, model] of download.models.entries()) {
      const bytes = new Uint8Array(await modelBlobs.get(model.reference_id)!.arrayBuffer());
      model.data_base64 = Buffer.from(bytes).toString("base64");
      explorer.models[index].program_sha256 = hash(JSON.stringify(model.program));
    }
    vi.mocked(downloadPatternPortraitExplorer).mockResolvedValue(new Blob([JSON.stringify(download)], { type: "application/json" }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    show(); await userEvent.click(await screen.findByRole("button", { name: "Download complete portrait" }));
    expect(downloadPatternPortraitExplorer).toHaveBeenCalledWith({ chart_id: props.chartId, pattern_id: document.pattern_id, generated_at: document.generated_at }, expect.any(AbortSignal));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
  });
  it("aborts private downloads and ignores late assets after unmount", async () => {
    let release!: (value: Blob) => void;
    const gate = new Promise<Blob>((resolve) => { release = resolve; });
    vi.mocked(getPatternPortraitModel).mockReturnValue(gate); const view = show();
    await screen.findByText("Personal interactive explorer");
    await waitFor(() => expect(getPatternPortraitModel).toHaveBeenCalledTimes(4));
    const signal = vi.mocked(getPatternPortraitModel).mock.calls[0][1]!; view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => release(new Blob(["late"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("can cancel stalled asset loading and return to the original account history entry", async () => {
    vi.mocked(getPatternPortraitModel).mockReturnValue(new Promise(() => undefined));
    show();
    await screen.findByText("Personal interactive explorer");
    await waitFor(() => expect(getPatternPortraitModel).toHaveBeenCalledTimes(4));
    const signal = vi.mocked(getPatternPortraitModel).mock.calls[0][1]!;
    await userEvent.click(screen.getByRole("button", { name: "Back to reading" }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Explore your 3D portrait" })).toBeEnabled();
    expect(screen.getByText("Complete written reading").parentElement).toHaveFocus();
    await waitFor(() => expect(window.history.state).toEqual({ route: "pattern" }));
  });

  it.each(["not_started", "generating", "failed"] as const)("keeps one complete reading without the legacy card while mesh status is %s", async (status) => {
    vi.mocked(getPatternPortraitExplorer).mockResolvedValue({ ...saved(), status, completed_models: 2, models: [] });
    show({ canCreate: false });
    await waitFor(() => expect(screen.queryByText("Checking your saved portrait.")).not.toBeInTheDocument());
    expect(screen.queryByText("Legacy saved portrait")).not.toBeInTheDocument();
    expect(screen.getAllByText("Personal interactive explorer")).toHaveLength(1);
    expect(screen.queryByTestId("automation-control")).not.toBeInTheDocument();
  });

  it("does not steal focus when the default observatory opens or artwork arrives", async () => {
    const button = globalThis.document.createElement("button");
    globalThis.document.body.append(button); button.focus();
    show(); await hydrated();
    expect(button).toHaveFocus();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    button.remove();
  });

  it("refreshes retryable artwork in the background without adding reading controls", async () => {
    vi.mocked(getPatternPortraitExplorer)
      .mockResolvedValueOnce({ ...saved(), status: "failed", completed_models: 2, retryable: true, models: [] })
      .mockResolvedValueOnce(saved());
    show();
    await waitFor(() => expect(getPatternPortraitExplorer).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /refresh portrait status/i })).not.toBeInTheDocument();
    act(() => globalThis.document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(getPatternPortraitExplorer).toHaveBeenCalledTimes(2));
    await hydrated();
    expect(screen.getByText("Personal interactive explorer")).toBeInTheDocument();
    expect(screen.queryByText("Legacy saved portrait")).not.toBeInTheDocument();
  });

  it("keeps navigation state when returning from privacy after artwork status changes", async () => {
    function Routes() {
      const [visible, setVisible] = useState(true);
      return <PortraitSessionProvider><button onClick={() => setVisible((value) => !value)}>Change page</button>
        {visible && <AccountPortraitExplorer {...props}><p>Complete written reading</p></AccountPortraitExplorer>}
      </PortraitSessionProvider>;
    }
    render(<Routes />); await hydrated();
    const navigation = vi.mocked(PortraitExplorer).mock.lastCall![0].navigation!;
    act(() => navigation.dispatch({ type: "select", chapterId: "chapter-2" }));
    vi.mocked(getPatternPortraitExplorer).mockRejectedValueOnce(new Error("Refresh failed."));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    await userEvent.click(screen.getByRole("button", { name: "Change page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed.");
    expect(screen.getByText("Personal interactive explorer")).toBeInTheDocument();
    expect(vi.mocked(PortraitExplorer).mock.lastCall![0].meshBundle).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
    await userEvent.click(screen.getByRole("button", { name: "Retry artwork" }));
    await hydrated();
    expect(getPatternPortraitModel).toHaveBeenCalledTimes(8);
    expect(vi.mocked(PortraitExplorer).mock.lastCall![0].navigation!.state.view).toMatchObject({ kind: "chapter", chapterId: "chapter-2" });
  });
});

import { adaptiveFixture } from "../test/adaptive-portrait-fixture.js";
it.each([3, 4, 5, 6] as const)("hydrates every accepted image/model for a %i-chapter adaptive portrait", async count => {
  const f = adaptiveFixture(count);
  for (const [index, chapter] of f.portrait.chapters.entries()) {
    chapter.reference_sha256 = imageHash;
    const model = f.explorer.models[index];
    model.source_image_sha256 = imageHash; model.source_text_sha256 = hash(model.source_text);
    const glb = modelBytes({ chapterId: model.chapter_id, chapterCount: count, documentRevision: model.document_revision,
      sourceImageSha256: imageHash, sourceTextSha256: model.source_text_sha256, programSha256: model.program_sha256,
      compilerVersion: model.compiler_version, authoring: model.authoring });
    const json = new TextDecoder().decode(glb.subarray(20)).trim().replace('"name":"chapter-1"', `"name":"${model.chapter_id}"`);
    glb.fill(32, 20); glb.set(new TextEncoder().encode(json), 20);
    model.sha256 = hash(glb); modelBlobs.set(model.reference_id, new Blob([glb], { type: "model/gltf-binary" }));
  }
  vi.mocked(getPatternPortraitExplorer).mockResolvedValue(f.explorer);
  show({ chartId: "chart-fictional", document: f.document, pattern: { ...pattern, pattern_id: f.document.pattern_id, generated_at: f.document.generated_at } });
  await waitFor(() => expect(vi.mocked(PortraitExplorer).mock.lastCall?.[0].meshBundle?.assets).toHaveLength(count));
  const delivered = vi.mocked(PortraitExplorer).mock.lastCall![0];
  expect(delivered.objectBindings).toHaveLength(count);
  expect(delivered.objectBindings?.at(-1)?.chapterId).toBe(`chapter-${count}`);
  expect(delivered.meshBundle?.authoring).toBe("codex-parametric/v2");
  expect(getPatternPortraitImage).toHaveBeenCalledTimes(count);
  expect(getPatternPortraitModel).toHaveBeenCalledTimes(count);
});
