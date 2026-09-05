/*
 * DIRECTION: extend the Private Observatory with an image-derived reading constellation.
 * FIRST VIEWPORT: chapter forms on paper, a chapter index, readable prose.
 * INTERACTION: selecting a form brings its chapter into view; motion is deliberate and bounded.
 * FINISH: verify real desktop/mobile graphics, reading parity, lifecycle, and a11y before handoff.
 */
import { Component, Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortraitManifest, portraitImageUrls, type PortraitChapter, type PortraitManifest, type PortraitObjectBinding, type PortraitSource } from "../lib/pattern-portrait.js";
import { sunShapeProfiles } from "../lib/sun-sculpture.js";
import type { CameraAction } from "./PatternSculpture.js";
import "./pattern-portrait.css";

const PatternSculpture = lazy(() => import("./PatternSculpture.js"));
const accuracyLabels = { exact: "Exact birth time", approximate: "Approximate birth time", unknown: "Birth time unknown" };
type Expression = "overview" | "tensions" | "resources" | "alternative";
const expressions: Array<{ id: Expression; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tensions", label: "Tensions" },
  { id: "resources", label: "Resources" },
  { id: "alternative", label: "Another expression" },
];

class GraphicsBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable(); }
  render() {
    return this.state.failed
      ? <p className="portrait-graphics-message" role="status">3D is unavailable in this browser. You can still select and read every chapter.</p>
      : this.props.children;
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function Paragraphs({ paragraphs }: { paragraphs: string[] }) {
  return <>{paragraphs.map((text, index) => <p key={index}>{text}</p>)}</>;
}

function CompleteChapter({ chapter }: { chapter: PortraitChapter }) {
  return (
    <article className="portrait-full-chapter">
      <h3>{chapter.title}</h3>
      <p className="portrait-summary">{chapter.summary}</p>
      <Paragraphs paragraphs={chapter.sections} />
      <h4>Tensions</h4><Paragraphs paragraphs={chapter.tensions} />
      <h4>Resources</h4><Paragraphs paragraphs={chapter.resources} />
      <h4>Another expression</h4><p>{chapter.counterExpression}</p>
    </article>
  );
}

function ReadyPortrait({ manifest }: { manifest: PortraitManifest }) {
  const imageUrls = useMemo(() => portraitImageUrls(manifest), [manifest]);
  const [selected, setSelected] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<{ target: "reader" | "stage"; serial: number } | null>(null);
  const [expression, setExpression] = useState<Expression>("overview");
  const [reading, setReading] = useState(false);
  const sculptureKey = JSON.stringify([imageUrls, manifest.sunSign]);
  const sunProfile = manifest.sunSign ? sunShapeProfiles[manifest.sunSign] : null;
  const [readySculptureKey, setReadySculptureKey] = useState<string | null>(null);
  // Even a previously rendered sign needs a fresh renderer after a remount.
  useLayoutEffect(() => setReadySculptureKey(null), [sculptureKey]);
  const sceneReady = imageUrls !== null && readySculptureKey === sculptureKey;
  const [cameraAction, setCameraAction] = useState<CameraAction>({ kind: "reset", serial: 0 });
  const reducedMotion = useReducedMotion();
  const readerId = useId();
  const headingId = useId();
  const readerRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chapter = manifest.chapters.find((item) => item.id === selected) ?? null;
  const onReady = useCallback(() => setReadySculptureKey(sculptureKey), [sculptureKey]);
  const onUnavailable = useCallback(() => setReadySculptureKey(null), []);
  const navigateTo = useCallback((target: "reader" | "stage") => {
    setNavigation((previous) => ({ target, serial: (previous?.serial ?? 0) + 1 }));
  }, []);
  const selectChapter = useCallback((id: string | null, navigate = true) => {
    setSelected(id);
    setExpression("overview");
    if (navigate) setNavigation((previous) => ({ target: id ? "reader" : "stage", serial: (previous?.serial ?? 0) + 1 }));
    else setNavigation(null);
  }, []);
  useLayoutEffect(() => {
    if (!navigation || reading) return;
    const destination = navigation.target === "reader" ? readerRef.current : stageRef.current;
    if (!destination) return;
    const top = destination.getBoundingClientRect().top;
    destination.focus({ preventScroll: true });
    if (navigation.target === "stage" || window.matchMedia?.("(max-width: 850px)").matches || top < 0 || top > window.innerHeight - 150) {
      destination.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
    }
  }, [navigation, reading, reducedMotion]);
  const moveCamera = (kind: CameraAction["kind"]) => setCameraAction((previous) => ({ kind, serial: previous.serial + 1 }));

  return (
    <section className="pattern-portrait" aria-label="Pattern portrait">
      <div className="portrait-toolbar">
        <p>{manifest.chapters.length} chapters, one Pattern</p>
        <div className="portrait-mode" aria-label="Presentation">
          <button type="button" aria-pressed={!reading} onClick={() => { setReading(false); navigateTo("stage"); }}>3D view</button>
          <button type="button" aria-pressed={reading} onClick={() => { setReadySculptureKey(null); setReading(true); }}>Reading view</button>
        </div>
      </div>
      <div className="portrait-accuracy">
        <span>{accuracyLabels[manifest.accuracy]}</span>
        {manifest.uncertainty ? <p>{manifest.uncertainty}</p> : null}
      </div>
      {reading ? (
        <section className="portrait-complete" aria-label="Complete Pattern reading">
          {manifest.chapters.map((item) => <CompleteChapter key={item.id} chapter={item} />)}
        </section>
      ) : (
        <div className={`portrait-layout${chapter ? " portrait-layout--selected" : ""}`}>
          <div className="portrait-instrument">
            <div className="portrait-stage" role="group" aria-label="Interactive 3D constellation" ref={stageRef} tabIndex={-1}>
              <GraphicsBoundary key={sculptureKey} onUnavailable={onUnavailable}>
                <Suspense fallback={<p className="portrait-graphics-message" role="status">Loading the 3D view. The chapters are ready to read.</p>}>
                  {imageUrls ? <PatternSculpture key={sculptureKey} imageUrls={imageUrls} sunSign={manifest.sunSign} selectedIndex={manifest.chapters.findIndex((item) => item.id === selected)} onSelect={(index) => selectChapter(index === null ? null : manifest.chapters[index]?.id ?? null, false)} reducedMotion={reducedMotion} action={cameraAction} onReady={onReady} onUnavailable={onUnavailable} /> : <p className="portrait-graphics-message" role="status">Four chapter images are needed to draw this constellation. You can still read every chapter.</p>}
                </Suspense>
              </GraphicsBoundary>
            </div>
            {chapter ? <div className="portrait-selection" aria-label="Selected chapter">
              <p><span>Chapter {chapter.ordinal} of {manifest.chapters.length}</span>{chapter.title}</p>
              <button type="button" onClick={() => navigateTo("reader")}>Read chapter</button>
            </div> : null}
            <div className="portrait-camera-controls" aria-label="Sculpture controls">
              <button type="button" onClick={() => moveCamera("left")} disabled={!sceneReady || !imageUrls} aria-label="Rotate left">Rotate left</button>
              <button type="button" onClick={() => moveCamera("right")} disabled={!sceneReady || !imageUrls} aria-label="Rotate right">Rotate right</button>
              <button type="button" onClick={() => moveCamera("closer")} disabled={!sceneReady || !imageUrls} aria-label="Zoom in">+</button>
              <button type="button" onClick={() => moveCamera("farther")} disabled={!sceneReady || !imageUrls} aria-label="Zoom out">−</button>
              <button type="button" onClick={() => { selectChapter(null); moveCamera("reset"); }} disabled={!sceneReady || !imageUrls}>Reset view</button>
            </div>
            {sunProfile ? <p className="portrait-sun-influence" role="status"><strong>{sunProfile.label} Sun.</strong> {sunProfile.description}</p> : null}
            <p className="portrait-instruction">Drag to turn. Tap a star to choose a chapter.</p>
            <nav className="portrait-chapter-index" aria-label="Pattern chapters">
              {manifest.chapters.map((item) => (
                <button key={item.id} type="button" aria-pressed={selected === item.id} aria-controls={readerId} onClick={() => selectChapter(item.id)}>
                  <span className="portrait-chapter-number" aria-hidden="true">{String(item.ordinal).padStart(2, "0")}</span>
                  {item.object ? <img className="portrait-reference" src={item.object.imageUrl} alt={`Generated chapter object: ${item.object.label}`} width="64" height="76" /> : null}
                  <span>{item.title}</span>
                  <span aria-hidden="true" className="portrait-index-mark">{selected === item.id ? "−" : "+"}</span>
                </button>
              ))}
            </nav>
            <p className="portrait-legend">Four images trace one connected constellation. Their edges become stars and lines, with depth composed for this portrait.{sunProfile ? " Your Sun sign guides the arrangement." : ""} This is an artistic composition, not a map of the sky.</p>
          </div>
          <section className={`portrait-reader${chapter ? " portrait-reader--selected" : ""}`} id={readerId} aria-labelledby={headingId} ref={readerRef} tabIndex={-1}>
            {chapter ? (
              <>
                <div className="portrait-reader-nav">
                  <button className="portrait-back" type="button" aria-label="Back to constellation" onClick={() => navigateTo("stage")}>
                    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 4-6 6 6 6M2 10h16" /></svg>
                    Constellation
                  </button>
                  <select aria-label="Choose chapter" value={chapter.id} onChange={(event) => selectChapter(event.target.value || null)}>
                    <option value="">All chapters</option>
                    {manifest.chapters.map((item) => <option key={item.id} value={item.id}>{item.ordinal}. {item.title}</option>)}
                  </select>
                </div>
                <h2 id={headingId}>{chapter.title}</h2>
                <p className="portrait-summary">{chapter.summary}</p>
                {chapter.object ? <div className="portrait-object-note" role="note" aria-label="Chapter object">
                  <p><strong>{chapter.object.label}.</strong> {chapter.object.rationale}</p>
                  <button type="button" disabled={!sceneReady || !imageUrls} onClick={() => navigateTo("stage")}>View the whole constellation</button>
                </div> : null}
                <div className="portrait-expressions" aria-label="Chapter expressions">
                  {expressions.map((item) => <button key={item.id} type="button" aria-pressed={expression === item.id} onClick={() => setExpression(item.id)}>{item.label}</button>)}
                </div>
                <div className="portrait-prose">
                  {expression === "overview" ? <Paragraphs paragraphs={chapter.sections} /> : null}
                  {expression === "tensions" ? <Paragraphs paragraphs={chapter.tensions} /> : null}
                  {expression === "resources" ? <Paragraphs paragraphs={chapter.resources} /> : null}
                  {expression === "alternative" ? <p>{chapter.counterExpression}</p> : null}
                </div>
                <div className="portrait-next">
                  <button type="button" onClick={() => selectChapter(manifest.chapters[(chapter.ordinal % manifest.chapters.length)].id)}>Next chapter</button>
                  <span>{chapter.ordinal} of {manifest.chapters.length}</span>
                </div>
              </>
            ) : (
              <>
                <h2 id={headingId}>A little room to explore</h2>
                <p className="portrait-summary">There is more than one way to read your Pattern.</p>
                <p>Start with a chapter that catches your attention. Turn it over, explore what can feel difficult, and notice what you can draw on.</p>
                <p>Each chapter leaves room for another expression. You can return to the whole whenever you like.</p>
                <button className="portrait-begin" type="button" onClick={() => selectChapter(manifest.chapters[0].id)}>Explore the first chapter</button>
              </>
            )}
          </section>
        </div>
      )}
      {manifest.signatures.length > 0 ? <section className="portrait-signatures" aria-label="Additional signatures">{manifest.signatures.map((item, index) => <article key={index}><h3>{item.title}</h3><p>{item.text}</p></article>)}</section> : null}
      <span className="sr-only" role="status" aria-live="polite">{reading ? "Complete reading view" : chapter ? `${chapter.title}. ${expressions.find((item) => item.id === expression)?.label}.` : "Whole Pattern. Choose a chapter to explore."}</span>
    </section>
  );
}

export function PatternPortrait({ source, objectBindings }: { source: PortraitSource; objectBindings?: readonly PortraitObjectBinding[] }) {
  const manifest = useMemo(() => source.status === "ready" ? createPortraitManifest(source.document, objectBindings, source.sunSign) : null, [source, objectBindings]);
  if (source.status === "loading") return <div className="portrait-empty" role="status"><h2>Loading your Pattern</h2><p>The portrait will appear when its reading is available.</p></div>;
  if (!manifest || manifest.chapters.length === 0) return <div className="portrait-empty" role="status"><h2>No Pattern to display</h2><p>Its portrait and reading have been removed from this view.</p></div>;
  return <ReadyPortrait key={manifest.revision} manifest={manifest} />;
}
