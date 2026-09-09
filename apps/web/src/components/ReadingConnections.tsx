import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { RELATIONSHIP_REASONS, type ReaderDailyTarget, type ReaderRelationship, type ReaderRelationshipsResponse, type ReadingHistoryStatus } from "@patternlike/shared";
import { ApiError, getReadingRelationshipSource, getReadingRelationships, getReadingRelationshipTarget, type DailyReadingResponse, type ReadingRelationshipTargetResponse } from "../lib/api-client.js";
import { acceptsRelationshipGraph, acceptsRelationshipTarget, sameReaderTarget } from "../lib/reading-connection-response.js";
import { ConnectedPatternReading } from "./ConnectedPatternReading.js";
import { ConnectedTimingReading } from "./ConnectedTimingReading.js";
import "./reading-connections.css";

export const ReadingConnectionChartContext = createContext<string | null>(null);
type Visit = { kind: "source" } | { kind: "explanation" } | { kind: "target"; edge: ReaderRelationship };
interface Entry { visit: Visit; focusId: string | null; scrollY: number; paragraphId: string; source: ReaderDailyTarget | null }
interface State {
  visit: Visit;
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  graph: ReaderRelationshipsResponse | null;
  destination: ReadingRelationshipTargetResponse | null;
}
export type ParagraphConnectionAction = (paragraphId: string, order: number) => ReactNode;

function destinationLabel(edge: ReaderRelationship): string {
  if (edge.to.kind === "pattern") return `Open Pattern chapter ${edge.to.chapter_index + 1}`;
  if (edge.to.kind === "timing") return `Open Timing pass ${edge.to.pass_index}`;
  return "Open saved Daily reading";
}

export function ReadingConnections({ response, onUnauthorized, onReload, reloadLabel, renderSource, renderDaily }: {
  response: DailyReadingResponse;
  onUnauthorized: () => void;
  onReload: () => void;
  reloadLabel: string;
  renderSource: (action: ParagraphConnectionAction) => ReactNode;
  renderDaily: (response: DailyReadingResponse, status: ReadingHistoryStatus, onReload: () => void) => ReactNode;
}) {
  const chartId = useContext(ReadingConnectionChartContext);
  const [state, setState] = useState<State>({ visit: { kind: "source" }, status: "idle", graph: null, destination: null });
  const current = useRef(state); current.current = state;
  const source = useRef<ReaderDailyTarget | null>(null);
  const paragraph = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const position = useRef(0);
  const scope = useRef(`reading-${Math.random().toString(36).slice(2)}`);
  const entries = useRef(new Map<number, Entry>());
  const pendingFocus = useRef<{ id: string | null; scrollY?: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const refresh = useRef<() => void>(() => {});
  const visitEntry = useRef<(entry: Entry) => void>(() => {});

  async function load(visit: Visit) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++epoch.current;
    setState({ visit, status: "loading", graph: null, destination: null });
    const finish = (status: State["status"], graph: ReaderRelationshipsResponse | null = null, destination: ReadingRelationshipTargetResponse | null = null) => {
      if (!controller.signal.aborted && version === epoch.current) setState({ visit, status, graph, destination });
    };
    try {
      if (!paragraph.current) { finish("unavailable"); return; }
      if (!source.current) {
        const discovered = await getReadingRelationshipSource(response.reading.reading_id, { revision: response.reading.revision, paragraph_id: paragraph.current }, controller.signal);
        if (controller.signal.aborted) return;
        if (discovered.schema_version !== "reader-relationship-source/v1" || discovered.status !== "available" || !discovered.source
          || discovered.source.reading_id !== response.reading.reading_id || discovered.source.revision !== response.reading.revision
          || discovered.source.paragraph_id !== paragraph.current || !/^sha256:[a-f0-9]{64}$/.test(discovered.source.content_hash)) {
          finish("unavailable"); return;
        }
        source.current = discovered.source;
        for (const entry of entries.current.values()) {
          if (entry.paragraphId === paragraph.current && entry.source === null) entry.source = discovered.source;
        }
      }
      const boundSource = source.current;
      const graph = await getReadingRelationships(boundSource, controller.signal);
      if (controller.signal.aborted) return;
      if (!acceptsRelationshipGraph(graph, boundSource) || graph.status === "unavailable") { finish("unavailable"); return; }
      if (visit.kind !== "target") { finish("ready", graph); return; }
      const edge = graph.items.find((candidate) => candidate.id === visit.edge.id && candidate.kind === visit.edge.kind
        && sameReaderTarget(candidate.from, visit.edge.from) && sameReaderTarget(candidate.to, visit.edge.to));
      if (!edge) { finish("unavailable", graph); return; }
      const destination = await getReadingRelationshipTarget(boundSource, edge.id, controller.signal);
      if (controller.signal.aborted) return;
      if (!await acceptsRelationshipTarget(destination, edge.to) || (destination.status === "available" && destination.kind === "pattern" && !chartId)) {
        finish("unavailable", graph); return;
      }
      finish("ready", graph, destination);
    } catch (error) {
      if (controller.signal.aborted || version !== epoch.current) return;
      if (error instanceof ApiError && error.status === 401) {
        source.current = null; entries.current.clear(); onUnauthorized(); return;
      }
      finish(error instanceof ApiError && [403, 404, 409, 410].includes(error.status) ? "unavailable" : "error");
    }
  }

  refresh.current = () => {
    if (!paragraph.current) return;
    pendingFocus.current = { id: (document.activeElement as HTMLElement | null)?.id || null, scrollY: window.scrollY };
    void load(current.current.visit);
  };
  visitEntry.current = (entry) => {
    paragraph.current = entry.paragraphId;
    source.current = entry.source;
    pendingFocus.current = { id: entry.focusId, scrollY: entry.scrollY };
    void load(entry.visit);
  };

  useEffect(() => {
    const savedRestoration = window.history.scrollRestoration;
    const pop = (event: PopStateEvent) => {
      const marker = event.state?.readerJourney;
      // Portrait navigation owns its own entries within the same reader visit.
      if (marker?.scope !== scope.current || marker.index === position.current) return;
      const entry = entries.current.get(marker.index);
      if (!entry) return;
      position.current = marker.index;
      visitEntry.current(entry);
    };
    const foreground = () => { if (document.visibilityState === "visible") refresh.current(); };
    window.addEventListener("popstate", pop);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      request.current?.abort(); epoch.current += 1;
      source.current = null; entries.current.clear();
      window.removeEventListener("popstate", pop);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
      window.history.scrollRestoration = savedRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    if (state.status === "loading" || !pendingFocus.current) return;
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    let target = pending.id ? document.getElementById(pending.id) : null;
    if (!target && state.destination?.status === "available" && state.destination.kind === "pattern") {
      target = container.current?.querySelector<HTMLElement>(`[data-reading-chapter="chapter-${state.destination.target.chapter_index + 1}"]`) ?? null;
    }
    if (!target && state.destination?.status === "available" && state.destination.kind === "daily") {
      const paragraphId = state.destination.target.paragraph_id;
      target = [...container.current?.querySelectorAll<HTMLElement>("[data-reading-paragraph]") ?? []].find((element) => element.dataset.readingParagraph === paragraphId) ?? null;
    }
    target ??= container.current?.querySelector<HTMLElement>("[data-connection-heading], h1, h2") ?? null;
    target?.focus({ preventScroll: true });
    if (pending.scrollY !== undefined) window.scrollTo({ top: pending.scrollY, behavior: "instant" });
    else target?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [state]);

  function navigate(visit: Visit, opener: HTMLElement) {
    const previous = entries.current.get(position.current);
    if (previous) { previous.focusId = opener.id; previous.scrollY = window.scrollY; }
    const index = ++sequence.current;
    entries.current.set(index, { visit, focusId: null, scrollY: 0, paragraphId: paragraph.current!, source: source.current });
    position.current = index;
    const { portrait: _portrait, ...historyState } = window.history.state ?? {};
    window.history.pushState({ ...historyState, readerJourney: { scope: scope.current, index } }, "");
    window.history.scrollRestoration = "manual";
    pendingFocus.current = { id: null };
    void load(visit);
  }

  function explain(paragraphId: string, event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (paragraph.current !== paragraphId) source.current = null;
    paragraph.current = paragraphId;
    entries.current.set(position.current, { visit: { kind: "source" }, focusId: event.currentTarget.id, scrollY: window.scrollY, paragraphId, source: source.current });
    window.history.replaceState({ ...window.history.state, readerJourney: { scope: scope.current, index: position.current } }, "");
    navigate({ kind: "explanation" }, event.currentTarget);
  }

  const action: ParagraphConnectionAction = (paragraphId, order) => <a
    className="reading-connection-link"
    id={`reading-connection-${response.reading.reading_id}-${paragraphId}`}
    href={window.location.hash || "#today"}
    aria-label={`Connections for passage ${order}`}
    onClick={(event) => explain(paragraphId, event)}
  >Where this connects <span aria-hidden="true">↗</span></a>;

  const activeTarget = state.visit.kind === "target" ? state.visit.edge.to : source.current;
  const outgoing = state.graph && activeTarget ? state.graph.items.filter((edge) => sameReaderTarget(edge.from, activeTarget)) : [];
  const sourceParagraph = response.reading.paragraphs.find((item) => item.paragraph_id === paragraph.current);
  const links = <section className="reading-connections-links" aria-label="Supported reading connections">
    {outgoing.length ? <ul>{outgoing.map((edge) => <li key={edge.id}>
      <p>{RELATIONSHIP_REASONS[edge.reason_code]}</p>
      <a className="reading-connection-link" id={`reading-link-${edge.id}`} href={window.location.hash || "#today"} onClick={(event) => { event.preventDefault(); navigate({ kind: "target", edge }, event.currentTarget); }}>{destinationLabel(edge)}</a>
      <details className="reading-connection-evidence"><summary>Connection details</summary><p>Kind: {edge.kind.replaceAll("_", " ")}</p><p>This connection is bound to the exact published editions and retained evidence. It does not establish the interpretation as a fact about your life.</p><dl><dt>Evidence receipt</dt><dd><code>{edge.evidence_identity}</code></dd>{edge.to.kind === "daily" ? <><dt>Reading revision</dt><dd>{edge.to.revision}</dd></> : edge.to.kind === "pattern" ? <><dt>Pattern chapter</dt><dd>{edge.to.chapter_index + 1}</dd></> : <><dt>Local date and zone</dt><dd>{edge.to.local_date} · {edge.to.time_zone}</dd></>}</dl></details>
    </li>)}</ul> : <div className="reading-connection-empty"><h2>No supported connection</h2><p>The retained evidence does not establish another connection from this passage. Earlier editions may have no retained passage support. The reading can stand on its own.</p></div>}
    {state.graph?.truncated ? <p className="reading-connection-boundary">Showing a bounded selection of supported connections.</p> : null}
  </section>;

  if (state.visit.kind === "source" && (state.status === "idle" || state.status === "ready")) return <div ref={container} className="reading-connection-source">{renderSource(action)}</div>;
  return <div ref={container} className="reading-connections">
    <button className="reading-connection-back" type="button" onClick={() => window.history.back()}>Back to where you were</button>
    {state.status === "loading" ? <p role="status">Checking the exact reading and its connections.</p> : state.status === "error" ? <section><h1 data-connection-heading tabIndex={-1}>The connection could not be checked</h1><p>Your last reading has not been replaced.</p><button className="button button--secondary" type="button" onClick={() => refresh.current()}>Try again</button></section> : state.status === "unavailable" ? <section><h1 data-connection-heading tabIndex={-1}>This connection is unavailable</h1><p>The exact edition or its supporting evidence is no longer available. A newer reading will not be substituted.</p><button className="button button--secondary" type="button" onClick={onReload}>{reloadLabel}</button></section> : state.visit.kind === "explanation" ? <section><h1 data-connection-heading tabIndex={-1}>Where this passage connects</h1><blockquote>{sourceParagraph?.text}</blockquote><p className="reading-connection-boundary">These links follow retained support for this passage. Similar wording alone does not create a connection.</p>{links}</section> : state.destination?.status === "available" ? <>
      {state.destination.kind === "daily" ? renderDaily(state.destination.reading, state.destination.reading_status, () => refresh.current()) : state.destination.kind === "pattern" ? <ConnectedPatternReading document={state.destination.pattern} target={state.destination.target} chartId={chartId!} onUnauthorized={onUnauthorized} /> : <ConnectedTimingReading timing={state.destination.timing} />}
      {state.destination.kind !== "daily" ? links : null}
    </> : null}
  </div>;
}
