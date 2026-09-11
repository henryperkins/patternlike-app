import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderDailyTarget, ReaderRelationshipsResponse } from "@patternlike/shared";
import type { DailyReadingResponseV3, ReadingRelationshipTargetResponse } from "../lib/api-client.js";
import { createReaderJourneyFixture } from "../preview/reader-journey-fixture.js";
import { fictionalPattern } from "../preview/pattern-portrait-fixture.js";
import { resolveReaderRelationships } from "../lib/reader-relationships.js";
import { capturedFor, deferred, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { todayResponse } from "../test/reading-fixture.js";
import { PortraitSessionProvider } from "./portrait-explorer/portrait-session.js";
import { ReadingConnectionChartContext } from "./ReadingConnections.js";
import { ReadingArticle } from "./ReadingArticle.js";

const readingId = todayResponse.reading.reading_id;
const sourcePath = `/v1/readings/${readingId}/relationship-source`;
const graphPath = `/v1/readings/${readingId}/relationships`;
const targetPath = `/v1/readings/${readingId}/relationship-target`;

async function setup() {
  const fictional = await createReaderJourneyFixture();
  const source: ReaderDailyTarget = { ...fictional.source as ReaderDailyTarget, reading_id: readingId, revision: todayResponse.reading.revision, paragraph_id: todayResponse.reading.paragraphs[0]!.paragraph_id };
  fictional.units[0]!.target = source;
  const graph: ReaderRelationshipsResponse = { ...await resolveReaderRelationships(source, fictional.units), schema_version: "reader-relationships/v1" };
  graph.items = graph.items.map((edge) => ({ ...edge, evidence_identity: `sha256:${"c".repeat(64)}` }));
  const timing = fictional.documents[2]!.target;
  const saved = fictional.documents[3]!.target as ReaderDailyTarget;
  const savedReading: DailyReadingResponseV3 = { ...todayResponse, reading: { ...todayResponse.reading, reading_id: saved.reading_id, revision: saved.revision, local_date: "2026-09-02", paragraphs: [{ ...todayResponse.reading.paragraphs[0]!, paragraph_id: saved.paragraph_id, text: "The exact earlier saved passage." }] } };
  const patternResponse: ReadingRelationshipTargetResponse = { schema_version: "reader-relationship-target/v1", status: "available", kind: "pattern", target: fictional.documents[1]!.target as Extract<typeof timing, { kind: "pattern" }>, pattern: fictionalPattern };
  if (timing.kind !== "timing") throw new Error("Timing fixture missing");
  const timingResponse: ReadingRelationshipTargetResponse = { schema_version: "reader-relationship-target/v1", status: "available", kind: "timing", target: timing, timing: { target: timing, technique: "transit", body: "saturn", natal_target: "sun", aspect: "square", phase: "peak", orb_deg: 3, passes: [{ pass_index: 2, direction: "direct", exact_at: timing.exact_at }] } };
  const savedResponse: ReadingRelationshipTargetResponse = { schema_version: "reader-relationship-target/v1", status: "available", kind: "daily", target: saved, reading: savedReading, reading_status: "published" };
  const responses: Record<string, MockResponse> = {
    [sourcePath]: { status: 200, body: { schema_version: "reader-relationship-source/v1", status: "available", source } },
    [graphPath]: { status: 200, body: graph },
    [targetPath]: { status: 200, body: patternResponse },
    [`/v1/readings/${readingId}/save`]: { status: 200, body: { schema_version: "0.8.0", reading_id: readingId, saved: false, saved_at: null } },
    [`/v1/readings/${saved.reading_id}/save`]: { status: 200, body: { schema_version: "0.8.0", reading_id: saved.reading_id, saved: true, saved_at: "2026-09-02T12:00:00Z" } },
    [`GET /v1/readings/${saved.reading_id}/feedback`]: { status: 404, body: { error: { code: "feedback_not_found", message: "No response" } } },
    [`POST /v1/readings/${saved.reading_id}/feedback`]: { status: 201, body: { id: "feedback_1", reading_id: saved.reading_id, created_at: "2026-09-09T12:00:00Z" } },
    "/v1/context-sources": { status: 503, body: { error: { code: "context_unavailable", message: "Context unavailable" } } },
    "/v1/pattern-portrait/explorer": { status: 404, body: { error: { code: "unavailable", message: "No artwork" } } },
  };
  mockApiResponses(responses);
  return { source, graph, saved, patternResponse, timingResponse, savedResponse, responses };
}

function mount(onUnauthorized = vi.fn()) {
  const onReload = vi.fn();
  const rendered = render(<PortraitSessionProvider><ReadingConnectionChartContext value="chart-current"><ReadingArticle response={todayResponse} showCheckIn onReload={onReload} onUnauthorized={onUnauthorized} /></ReadingConnectionChartContext></PortraitSessionProvider>);
  return { ...rendered, onReload, onUnauthorized };
}

async function openFeedbackDraft() {
  const fixture = await setup(), user = userEvent.setup();
  fixture.responses[targetPath]!.body = fixture.timingResponse;
  const view = mount();
  await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
  await user.click(await screen.findByRole("link", { name: "Open Timing pass 2" }));
  await screen.findByRole("heading", { name: "Saturn square your Sun" });
  const timingEntry = window.history.state;
  fixture.responses[targetPath]!.body = fixture.savedResponse;
  await user.click(screen.getByRole("link", { name: "Open saved Daily reading" }));
  await screen.findByText("The exact earlier saved passage.");
  const mixed = screen.getByRole("radio", { name: "Mixed" });
  await user.click(mixed);
  await user.click(screen.getByRole("button", { name: "A sentence, if you want" }));
  const note = screen.getByRole("textbox", { name: "A sentence, if you want" });
  const draft = "An unsent thought about this reading.";
  await user.type(note, draft);
  return { fixture, user, view, timingEntry, mixed, note, draft };
}

beforeEach(() => {
  window.history.replaceState({ unrelated: "retained" }, "", "#today");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

describe("account reading connections", () => {
  it("uses authorized exact targets through the full journey, preserves Back, and submits existing feedback only on request", async () => {
    const fixture = await setup(), user = userEvent.setup();
    const view = mount();
    expect(capturedFor(sourcePath)).toHaveLength(0);
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await screen.findByRole("heading", { name: "Where this passage connects" });
    expect(document.body).not.toHaveTextContent("fictional_chart_a");
    const marker = window.history.state;
    vi.spyOn(window, "scrollY", "get").mockReturnValue(280);
    await user.click(screen.getByRole("link", { name: "Open Pattern chapter 3" }));
    const heading = await screen.findByRole("heading", { level: 2, name: "A steadiness of your own" });
    expect(heading.closest("article")).toHaveFocus();
    fireEvent.popState(window, { state: marker });
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Pattern chapter 3" })).toHaveFocus());
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 280, behavior: "instant" });
    await user.click(screen.getByRole("link", { name: "Open Pattern chapter 3" }));
    await screen.findByRole("heading", { level: 2, name: "A steadiness of your own" });
    fixture.responses[targetPath]!.body = fixture.timingResponse;
    await user.click(screen.getByRole("link", { name: "Open Timing pass 2" }));
    expect(await screen.findByRole("heading", { name: "Saturn square your Sun" })).toHaveFocus();
    expect(screen.getByText("Retained Timing result · 2026-09-02 · America/New_York")).toBeInTheDocument();
    fixture.responses[targetPath]!.body = fixture.savedResponse;
    await user.click(screen.getByRole("link", { name: "Open saved Daily reading" }));
    expect(await screen.findByText("The exact earlier saved passage.")).toBeInTheDocument();
    expect(screen.getByText(/Sending this uses feedback permission/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Mixed" }));
    await user.click(screen.getByRole("button", { name: /Send this/ }));
    await screen.findByText(/Noted — mixed/);
    expect(capturedFor(`/v1/readings/${fixture.saved.reading_id}/feedback`).filter((call) => call.method === "POST")).toHaveLength(1);
    expect(capturedFor("/v1/readings/today")).toHaveLength(0);
    expect(capturedFor("/v1/pattern-portrait/generate")).toHaveLength(0);
    expect(capturedFor(sourcePath)).toHaveLength(1);
    expect(capturedFor(graphPath).every((call) => new URLSearchParams(call.search).get("content_hash") === fixture.source.content_hash)).toBe(true);
    expect(window.location.hash).toBe("#today");
    expect(Object.keys(window.history.state.readerJourney).sort()).toEqual(["index", "scope"]);
    expect(window.history.state.unrelated).toBe("retained");
    expect(JSON.stringify(window.history.state)).not.toContain(fixture.source.reading_id);
    expect(view.onReload).not.toHaveBeenCalled();
  });

  it("opens a direct Timing branch without visiting Pattern", async () => {
    const fixture = await setup(), user = userEvent.setup();
    fixture.responses[targetPath]!.body = fixture.timingResponse;
    mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await user.click(await screen.findByRole("link", { name: "Open Timing pass 2" }));
    await screen.findByRole("heading", { name: "Saturn square your Sun" });
    expect(capturedFor("/v1/pattern-portrait/explorer")).toHaveLength(0);
  });

  it("restores each visit's source paragraph and stored hash after another paragraph was opened", async () => {
    const fixture = await setup(), user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await screen.findByRole("heading", { name: "Where this passage connects" });
    const firstVisit = window.history.state;
    fireEvent.popState(window, { state: { readerJourney: { ...firstVisit.readerJourney, index: 0 } } });
    await screen.findByRole("link", { name: "Connections for passage 2" });
    const secondSource = { ...fixture.source, paragraph_id: todayResponse.reading.paragraphs[1]!.paragraph_id };
    fixture.responses[sourcePath]!.body = { schema_version: "reader-relationship-source/v1", status: "available", source: secondSource };
    fixture.responses[graphPath]!.body = { ...fixture.graph, source: secondSource, status: "no_supported_connection", items: [] };
    await user.click(screen.getByRole("link", { name: "Connections for passage 2" }));
    await screen.findByRole("heading", { name: "No supported connection" });
    fixture.responses[graphPath]!.body = fixture.graph;
    fireEvent.popState(window, { state: firstVisit });
    await screen.findByRole("link", { name: "Open Pattern chapter 3" });
    expect(screen.getByText(todayResponse.reading.paragraphs[0]!.text)).toBeInTheDocument();
    expect(screen.queryByText(todayResponse.reading.paragraphs[1]!.text)).not.toBeInTheDocument();
    expect(new URLSearchParams(capturedFor(graphPath).at(-1)!.search).get("paragraph_id")).toBe(fixture.source.paragraph_id);
    expect(capturedFor(sourcePath)).toHaveLength(2);
  });

  it("keeps an older unsupported reading and restores its actual paragraph link", async () => {
    const fixture = await setup(), user = userEvent.setup();
    fixture.responses[graphPath]!.body = { ...fixture.graph, status: "no_supported_connection", items: [] };
    mount();
    const original = screen.getByRole("link", { name: "Connections for passage 1" });
    await user.click(original);
    await screen.findByRole("heading", { name: "No supported connection" });
    const reader = window.history.state.readerJourney;
    fireEvent.popState(window, { state: { readerJourney: { scope: reader.scope, index: 0 } } });
    await waitFor(() => expect(screen.getByRole("link", { name: "Connections for passage 1" })).toHaveFocus());
    expect(screen.getByText(todayResponse.reading.paragraphs[0]!.text)).toBeInTheDocument();
    expect(capturedFor(targetPath)).toHaveLength(0);
  });

  it.each(["unavailable", "wrong_hash", "wrong_chapter", "wrong_text"])("does not show another Pattern for %s", async (change) => {
    const fixture = await setup(), user = userEvent.setup();
    if (change === "unavailable") fixture.responses[targetPath]!.body = { schema_version: "reader-relationship-target/v1", status: "unavailable" };
    else {
      const changed = structuredClone(fixture.patternResponse);
      if (changed.status !== "available" || changed.kind !== "pattern") throw new Error("Pattern missing");
      if (change === "wrong_hash") changed.target.content_hash = `sha256:${"9".repeat(64)}`;
      if (change === "wrong_chapter") changed.target.chapter_index = 0;
      if (change === "wrong_text") changed.pattern.core_chapters[2]!.summary = "A substituted passage";
      fixture.responses[targetPath]!.body = changed;
    }
    mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await user.click(await screen.findByRole("link", { name: "Open Pattern chapter 3" }));
    await screen.findByRole("heading", { name: "This connection is unavailable" });
    expect(screen.queryByText("A substituted passage")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A steadiness of your own" })).not.toBeInTheDocument();
  });

  it("rechecks foreground access and removes an already opened destination", async () => {
    const fixture = await setup(), user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await user.click(await screen.findByRole("link", { name: "Open Pattern chapter 3" }));
    await screen.findByRole("heading", { level: 2, name: "A steadiness of your own" });
    fixture.responses[graphPath]!.body = { ...fixture.graph, status: "unavailable", items: [] };
    fireEvent.focus(window);
    await screen.findByRole("heading", { name: "This connection is unavailable" });
    expect(screen.queryByText("The routines that support you can be small enough to change with your life.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Timing pass 2" })).not.toBeInTheDocument();
  });

  it.each(["note", "radio"])("preserves the unsent draft and %s focus through paired foreground events", async (focus) => {
    const { fixture, mixed, note, draft } = await openFeedbackDraft();
    const focused = focus === "note" ? note : mixed;
    focused.focus();
    vi.spyOn(window, "scrollY", "get").mockReturnValue(720);
    const gate = deferred();
    fixture.responses[targetPath]!.gate = gate.promise;
    const previousChecks = capturedFor(graphPath).length;
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.focus(window);
    await waitFor(() => expect(capturedFor(targetPath).at(-1)!.signal!.aborted).toBe(false));
    expect(screen.getByRole("status")).toHaveTextContent("Checking the exact reading");
    expect(note).toBeInTheDocument();
    expect(note).not.toBeVisible();
    expect(note.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await act(async () => gate.release());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "A sentence, if you want" })).toBe(note));
    expect(note).toHaveValue(draft);
    expect(mixed).toBeChecked();
    expect(focused).toHaveFocus();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 720, behavior: "instant" });
    expect(capturedFor(graphPath)).toHaveLength(previousChecks + 1);
    expect(capturedFor(`/v1/readings/${fixture.saved.reading_id}/feedback`).map((call) => call.method)).toEqual(["GET"]);
  });

  it("keeps a draft hidden after a failed check and restores it only after a successful retry", async () => {
    const { fixture, user, mixed, note, draft } = await openFeedbackDraft();
    fixture.responses[graphPath]!.unreachable = true;
    fireEvent.focus(window);
    const failure = await screen.findByRole("heading", { name: "The connection could not be checked" });
    expect(failure).toHaveFocus();
    expect(note).toBeInTheDocument();
    expect(note).not.toBeVisible();
    expect(note.closest("[inert]")).not.toBeNull();
    fixture.responses[graphPath]!.unreachable = false;
    const gate = deferred();
    fixture.responses[graphPath]!.gate = gate.promise;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(note).not.toBeVisible();
    await act(async () => gate.release());
    await waitFor(() => expect(note).toBeVisible());
    expect(note).toHaveValue(draft);
    expect(mixed).toBeChecked();
    expect(note).toHaveFocus();
    expect(capturedFor(`/v1/readings/${fixture.saved.reading_id}/feedback`).map((call) => call.method)).toEqual(["GET"]);
  });

  it.each(["unavailable", "mismatched", "forbidden", "unauthorized"])("discards the retained draft when foreground access is %s", async (result) => {
    const { fixture, view, note } = await openFeedbackDraft();
    if (result === "unavailable") fixture.responses[graphPath]!.body = { ...fixture.graph, status: "unavailable", items: [] };
    else if (result === "mismatched") fixture.responses[targetPath]!.body = fixture.timingResponse;
    else fixture.responses[graphPath] = { status: result === "forbidden" ? 403 : 401, body: { error: { code: result, message: "Access denied" } } };
    fireEvent.focus(window);
    await screen.findByRole("heading", { name: "This connection is unavailable" });
    expect(note).not.toBeInTheDocument();
    expect(screen.queryByText("The exact earlier saved passage.")).not.toBeInTheDocument();
    if (result === "unauthorized") expect(view.onUnauthorized).toHaveBeenCalledOnce();
    expect(capturedFor(`/v1/readings/${fixture.saved.reading_id}/feedback`).map((call) => call.method)).toEqual(["GET"]);
  });

  it("discards a draft on Back and ignores a late foreground response", async () => {
    const { fixture, timingEntry, note } = await openFeedbackDraft();
    const gate = deferred();
    fixture.responses[targetPath]!.gate = gate.promise;
    const previousChecks = capturedFor(targetPath).length;
    fireEvent.focus(window);
    await waitFor(() => expect(capturedFor(targetPath)).toHaveLength(previousChecks + 1));
    const pending = capturedFor(targetPath).at(-1)!;
    fixture.responses[targetPath] = { status: 200, body: fixture.timingResponse };
    fireEvent.popState(window, { state: timingEntry });
    await screen.findByRole("heading", { name: "Saturn square your Sun" });
    expect(note).not.toBeInTheDocument();
    expect(pending.signal!.aborted).toBe(true);
    await act(async () => gate.release());
    expect(screen.getByRole("heading", { name: "Saturn square your Sun" })).toBeVisible();
    expect(screen.queryByText("The exact earlier saved passage.")).not.toBeInTheDocument();
  });

  it("hands an expired session to the app and aborts outstanding loads on unmount", async () => {
    const fixture = await setup(), user = userEvent.setup();
    fixture.responses[graphPath] = { status: 401, body: { error: { code: "unauthorized", message: "Sign in" } } };
    const view = mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    await waitFor(() => expect(view.onUnauthorized).toHaveBeenCalledOnce());
    view.unmount();
    const gate = deferred();
    fixture.responses[sourcePath]!.gate = gate.promise;
    fixture.responses[graphPath] = { status: 200, body: fixture.graph };
    const pending = mount();
    await user.click(screen.getByRole("link", { name: "Connections for passage 1" }));
    pending.unmount();
    expect(capturedFor(sourcePath).at(-1)!.signal!.aborted).toBe(true);
    await act(async () => gate.release());
    expect(screen.queryByRole("link", { name: "Open Pattern chapter 3" })).not.toBeInTheDocument();
  });
});
