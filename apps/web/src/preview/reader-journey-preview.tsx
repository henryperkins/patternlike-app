import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { exactReaderUnit, readerTargetKey, RELATIONSHIP_REASONS, resolveReaderRelationships, type ReaderRelationship, type ReaderRelationships, type ReaderTarget } from "../lib/reader-relationships.js";
import { createReaderJourneyFixture, JOURNEY_SCENARIOS, type JourneyScenario, type ReaderJourneyFixture } from "./reader-journey-fixture.js";
import "../styles.css";
import "./reader-journey-preview.css";

type View = { kind: "today" } | { kind: "explanation" } | { kind: "target"; target: ReaderTarget };
type Visit = { view: View; focusId: string; scrollY: number };
interface ReadyPreview { scenario: JourneyScenario; fixture: ReaderJourneyFixture; graph: ReaderRelationships }

const RESPONSE_OPTIONS = [
  { value: "helpful", label: "This helped" }, { value: "neutral", label: "Mixed" },
  { value: "not_helpful", label: "Not quite" }, { value: "off", label: "Off the mark" },
] as const;

function targetLabel(target: ReaderTarget): string {
  if (target.kind === "pattern") return `Open Pattern chapter ${target.chapter_index + 1}`;
  if (target.kind === "timing") return `Open Timing pass ${target.pass_index}`;
  return "Open saved Daily reading";
}

function routeHash(view: View): string {
  return `#journey-${view.kind === "target" ? view.target.kind : view.kind}`;
}

function EvidenceDetails({ edge }: { edge: ReaderRelationship }) {
  return <details className="journey-evidence"><summary>Edition and evidence details</summary>
    <p>These support coordinates are authored examples. They demonstrate the connection rule; they are not a calculation or evidence about a person.</p>
    <dl><dt>Connection</dt><dd>{edge.kind.replaceAll("_", " ")}</dd><dt>Exact destination</dt><dd><code>{readerTargetKey(edge.to)}</code></dd><dt>Fictional support</dt><dd><code>{edge.evidence_identity}</code></dd></dl>
  </details>;
}

export function ReaderJourneyPreview() {
  const [scenario, setScenario] = useState<JourneyScenario>("normal");
  const [ready, setReady] = useState<ReadyPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ kind: "today" });
  const [navigation, setNavigation] = useState(0);
  const [completePattern, setCompletePattern] = useState(false);
  const [response, setResponse] = useState("");
  const [responseShown, setResponseShown] = useState(false);
  const visits = useRef<Visit[]>([{ view: { kind: "today" }, focusId: "journey-heading", scrollY: 0 }]);
  const position = useRef(0);
  const session = useRef(`reader-preview-${Math.random().toString(36).slice(2)}`);
  const restore = useRef<Visit | null>(null);
  const shouldFocus = useRef(false);
  const loaded = ready?.scenario === scenario ? ready : null;

  useEffect(() => {
    let active = true;
    setFailed(false);
    void createReaderJourneyFixture(scenario).then(async (fixture) => ({ scenario, fixture, graph: await resolveReaderRelationships(fixture.source, fixture.units) }))
      .then((result) => { if (active) setReady(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [scenario]);

  useEffect(() => {
    const oldRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.history.replaceState({ readerJourney: session.current, position: 0 }, "", routeHash({ kind: "today" }));
    const pop = (event: PopStateEvent) => {
      if (event.state?.readerJourney !== session.current || !Number.isInteger(event.state.position)) return;
      const visit = visits.current[event.state.position as number];
      if (!visit) return;
      position.current = event.state.position as number;
      restore.current = visit;
      shouldFocus.current = true;
      setView(visit.view);
      setNavigation((value) => value + 1);
    };
    window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("popstate", pop); window.history.scrollRestoration = oldRestoration; };
  }, []);

  useLayoutEffect(() => {
    if (!loaded || !shouldFocus.current) return;
    shouldFocus.current = false;
    const previous = restore.current;
    restore.current = null;
    const destination = document.getElementById(previous?.focusId ?? "journey-heading") ?? document.getElementById("journey-heading");
    destination?.focus({ preventScroll: true });
    window.scrollTo({ top: previous?.scrollY ?? 0, behavior: "instant" });
  }, [loaded, navigation]);

  function navigate(next: View, event?: MouseEvent<HTMLAnchorElement>) {
    event?.preventDefault();
    const current = visits.current[position.current];
    if (current) { current.focusId = event?.currentTarget.id || "journey-heading"; current.scrollY = window.scrollY; }
    visits.current = visits.current.slice(0, position.current + 1);
    visits.current.push({ view: next, focusId: "journey-heading", scrollY: 0 });
    position.current += 1;
    restore.current = null;
    shouldFocus.current = true;
    window.history.pushState({ readerJourney: session.current, position: position.current }, "", routeHash(next));
    setView(next);
    setNavigation((value) => value + 1);
  }

  function restart() {
    setScenario("normal");
    setResponse("");
    setResponseShown(false);
    setCompletePattern(false);
    navigate({ kind: "today" });
  }

  const fixture = loaded?.fixture;
  const target = view.kind === "target" ? view.target : fixture?.source;
  const sourceAvailable = fixture && exactReaderUnit(fixture.source, fixture.units);
  const connected = view.kind !== "target" || loaded?.graph.items.some((edge) => readerTargetKey(edge.to) === readerTargetKey(view.target));
  const available = sourceAvailable && connected && target && exactReaderUnit(target, fixture.units);
  const documentView = available && fixture?.documents.find((item) => readerTargetKey(item.target) === readerTargetKey(target!));
  const outgoing = loaded && available && target ? loaded.graph.items.filter((edge) => readerTargetKey(edge.from) === readerTargetKey(target)) : [];
  const currentStage = view.kind === "target" ? view.target.kind === "daily" ? "Saved Daily" : view.target.kind === "pattern" ? "Pattern" : "Timing" : "Today";

  function connections(edges: ReaderRelationship[]) {
    return <div className="journey-connections">{edges.map((edge) => {
      const destination = fixture?.documents.find((item) => readerTargetKey(item.target) === readerTargetKey(edge.to));
      if (!destination) return null;
      return <section className="journey-connection" key={edge.id}>
        <h3>{destination.title}</h3><p>{RELATIONSHIP_REASONS[edge.reason_code]}</p>
        <a className="journey-link" id={`link-${edge.id}`} href={routeHash({ kind: "target", target: edge.to })} onClick={(event) => navigate({ kind: "target", target: edge.to }, event)}>{targetLabel(edge.to)}</a>
        <EvidenceDetails edge={edge} />
      </section>;
    })}</div>;
  }

  return <div className="reader-journey-preview">
    <a className="skip-link" href="#journey-heading">Skip to the reading</a>
    <header className="journey-header"><a className="journey-wordmark" href="/reader-journey.html"><img src="/mark.svg" width="28" height="28" alt="" />Pattern/Like</a><span>Fictional preview</span></header>
    <div className="journey-intro"><h1>Connected reading</h1><p>A thread from today’s paragraph to your Pattern, a moment in time, and a reading you kept.</p></div>
    <p className="journey-fictional">All readings and evidence on this page are fictional. This local study does not load an account, calculate a chart, or send responses.</p>
    <nav className="journey-progress" aria-label="Reading journey"><ol>{["Today", "Pattern", "Timing", "Saved Daily"].map((label) => <li key={label} aria-current={currentStage === label ? "step" : undefined}>{label}</li>)}</ol><p>Follow only the connections that have support.</p></nav>
    <main className="journey-main">
      <div className="journey-return">{position.current > 0 ? <button type="button" onClick={() => window.history.back()}>Back to where you were</button> : <span>Begin with today’s paragraph</span>}</div>
      {!loaded ? <section><h2 id="journey-heading" tabIndex={-1}>{failed ? "The fictional study could not open" : "Opening the fictional reading…"}</h2>{failed ? <p>Reload this page to try again.</p> : null}</section> : !documentView ? <section className="journey-unavailable"><h2 id="journey-heading" tabIndex={-1}>This exact reading is unavailable</h2><p>The original edition, its source, or the support for this connection is no longer available in this scenario. A different edition cannot take its place.</p><button type="button" onClick={restart}>Restart the fictional journey</button></section> : view.kind === "explanation" ? <article>
        <h2 id="journey-heading" tabIndex={-1}>Why this passage?</h2>
        <blockquote>{documentView.paragraphs[0]}</blockquote>
        <p className="journey-body">The connection follows specific support attached to this paragraph. Similar language alone is not enough.</p>
        {outgoing.length ? connections(outgoing) : <div className="journey-empty"><h3>No supported connection</h3><p>{scenario === "unknown_time" ? "This example depends on a house or angle that an unknown birth time cannot support." : "The retained evidence does not establish a connection to another reading."} You can still read this passage on its own.</p></div>}
      </article> : <article>
        <h2 id="journey-heading" tabIndex={-1}>{documentView.title}</h2><p className="journey-date">{documentView.dateLabel}</p>
        <div className="journey-prose">{documentView.paragraphs.map((paragraph, index) => <p key={index} className={index === 0 ? "journey-lead" : undefined}>{paragraph}</p>)}</div>
        {view.kind === "today" ? <div className="journey-explanation-link"><a id="today-why-link" className="journey-link" href="#journey-explanation" onClick={(event) => navigate({ kind: "explanation" }, event)}>Why this passage?</a><p>See what connects this paragraph to other readings.</p></div> : null}
        {view.kind === "target" && view.target.kind === "pattern" ? <details className="journey-complete" open={completePattern} onToggle={(event) => setCompletePattern(event.currentTarget.open)}><summary>Read the complete four-chapter Pattern</summary><p>Complete text is available without artwork.</p>{fixture?.chapters.map((chapter, index) => <section key={chapter.title} className={index === (view.target.kind === "pattern" ? view.target.chapter_index : -1) ? "journey-bound-chapter" : undefined}><h3>{chapter.title}</h3>{index === (view.target.kind === "pattern" ? view.target.chapter_index : -1) ? <p className="journey-date">The exact chapter linked from Today</p> : null}{chapter.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</section>)}</details> : null}
        {view.kind === "target" && outgoing.length ? <section className="journey-next"><h3>Continue this thread</h3>{connections(outgoing)}</section> : null}
        {view.kind === "target" && view.target.kind !== "daily" && !outgoing.length ? <p className="journey-boundary">No supported connection continues from this reading in this scenario.</p> : null}
        {view.kind === "target" && view.target.kind === "timing" ? <p className="journey-boundary">The shared participant explains this link. It does not establish that the interpretation will describe your experience.</p> : null}
        {view.kind === "target" && view.target.kind === "daily" ? <section className="journey-response"><h3>Did this meet you?</h3><p id="journey-response-help">Try the existing response choices. Your choice stays on this page until reload; it is not submitted or saved and grants no permission.</p><form onSubmit={(event) => { event.preventDefault(); setResponseShown(true); }}><fieldset aria-describedby="journey-response-help"><legend>How this reading landed</legend>{RESPONSE_OPTIONS.map((option) => <label key={option.value}><input type="radio" name="fictional-resonance" value={option.value} checked={response === option.value} onChange={() => { setResponse(option.value); setResponseShown(false); }} />{option.label}</label>)}</fieldset><button type="submit" disabled={!response}>Try this response</button>{responseShown ? <p role="status">Preview response: {RESPONSE_OPTIONS.find((option) => option.value === response)?.label}. Nothing was sent.</p> : null}</form></section> : null}
      </article>}
    </main>
    <aside className="journey-scenarios" aria-labelledby="journey-scenarios-heading"><h2 id="journey-scenarios-heading">Fictional scenarios</h2><p>Change a source while following a link to try the unavailable state. These controls simulate eligibility; they do not test account authorization.</p><div><label htmlFor="journey-scenario">Scenario<select id="journey-scenario" value={scenario} onChange={(event) => { setScenario(event.target.value as JourneyScenario); setResponse(""); setResponseShown(false); }}>{Object.entries(JOURNEY_SCENARIOS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" onClick={restart}>Start again</button></div></aside>
    <footer className="journey-footer">Pattern/Like · Local reading study · September 2026</footer>
  </div>;
}

const root = document.getElementById("reader-journey-root");
if (root) createRoot(root).render(<StrictMode><ReaderJourneyPreview /></StrictMode>);
