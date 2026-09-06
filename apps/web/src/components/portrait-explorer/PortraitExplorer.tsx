import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortraitManifest, type PortraitManifest, type PortraitObjectBinding, type PortraitSource } from "../../lib/pattern-portrait.js";
import { chapterPassages, validateMeshBundle } from "./content.js";
import { CompleteReading, ExplorerReader } from "./ExplorerReader.js";
import { currentFacet, selectedChapterIds } from "./explorer-state.js";
import { useExplorerNavigation } from "./use-explorer-navigation.js";
import type { CameraBookmark, CameraCommand, PortraitMeshBundle, SceneStatus } from "./types.js";
import "./explorer.css";

const PortraitScene = lazy(() => import("./PortraitScene.js"));
const EMPTY_BINDINGS: readonly PortraitObjectBinding[] = [];
export function PortraitExplorer({ source, objectBindings = EMPTY_BINDINGS, meshBundle }: {
  source: PortraitSource; objectBindings?: readonly PortraitObjectBinding[]; meshBundle: PortraitMeshBundle;
}) {
  const manifest = useMemo(() => source.status === "ready" ? createPortraitManifest(source.document, objectBindings, source.sunSign) : null, [source, objectBindings]);
  if (!manifest) return <main className="portrait-explorer"><p role="status">{source.status === "loading" ? "Your Pattern is loading…" : "No Pattern to display"}</p></main>;
  const identity = JSON.stringify({ ...manifest, chapters: manifest.chapters.map(({ object: _object, ...text }) => text) });
  return <ReadyExplorer key={identity} manifest={manifest} meshBundle={meshBundle} />;
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Modal({ label, children, onClose, className = "" }: { label: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog?.showModal === "function") dialog.showModal(); else dialog?.setAttribute("open", "");
    return () => {
      document.body.style.overflow = overflow;
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      queueMicrotask(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} className={`explorer-dialog ${className}`} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((element) => {
        for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== ref.current; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector("summary")?.contains(element)) return false;
        }
        return true;
      });
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first?.focus(); }
  }}>{children}</dialog>;
}

function ReadyExplorer({ manifest, meshBundle }: { manifest: PortraitManifest; meshBundle: PortraitMeshBundle }) {
  const [state, dispatch] = useExplorerNavigation(manifest.chapters.map((chapter) => chapter.id));
  const selectedIds = selectedChapterIds(state);
  const selected = manifest.chapters.filter((chapter) => selectedIds.includes(chapter.id)).sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
  const chapter = selected[0];
  const facet = currentFacet(state);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [retry, setRetry] = useState(0);
  const [quality, setQuality] = useState<"standard" | "low">("standard");
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [command, setCommand] = useState<CameraCommand>({ kind: "frame", serial: 0 });
  const bookmarks = useRef(new Map<string, CameraBookmark>());
  const passageElements = useRef(new Map<number, HTMLParagraphElement>());
  const scrollPositions = useRef(new Map<string, number>());
  const pendingPassage = useRef<number | null>(null);
  const pendingScene = useRef(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const readerElement = useRef<HTMLElement>(null);
  const readerPositions = useRef(new Map<string, number>());
  const readerKey = `${selectedIds.join("+")}:${facet}`;
  const previousPresentation = useRef(state.presentation);
  const validMeshes = validateMeshBundle(manifest, meshBundle);
  const graphicsAvailable = validMeshes && status === "ready";
  const viewKey = `${selectedIds.join("+") || "whole"}:${state.unfolded ? "unfolded" : "assembled"}`;
  const onBookmark = useCallback((key: string, bookmark: CameraBookmark) => { bookmarks.current.set(key, bookmark); }, []);
  const issueCommand = (kind: CameraCommand["kind"]) => setCommand((value) => ({ kind, serial: value.serial + 1 }));
  const select = (chapterId: string) => dispatch({ type: "select", chapterId });
  const back = () => dispatch({ type: "back" });
  const endView = (kind: "guided" | "compare") => {
    let steps = 1;
    for (let index = state.past.length - 1; index >= 0 && state.past[index].view.kind === kind; index--) steps++;
    if (steps === 1) back(); else dispatch(Array.from({ length: steps }, () => ({ type: "back" as const })));
  };
  const bindPassage = (index: number, element: HTMLParagraphElement | null) => {
    if (element) passageElements.current.set(index, element); else passageElements.current.delete(index);
  };
  const annotation = () => {
    if (!chapter) return;
    const index = Math.min(state.passages[chapter.id] ?? 0, chapterPassages(chapter, facet).length - 1);
    if (index < 0) return;
    dispatch({ type: "passage", index });
    if (state.presentation === "scene") {
      pendingPassage.current = index;
      dispatch([{ type: "back" }, { type: "select", chapterId: chapter.id }, { type: "facet", facet }, { type: "passage", index }]);
      return;
    }
    const element = passageElements.current.get(index);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
  };
  const showPassage = (index: number) => {
    if (!chapter || index < 0 || index >= chapterPassages(chapter, facet).length) return;
    pendingScene.current = true;
    if (state.presentation === "reading") dispatch([{ type: "back" }, { type: "select", chapterId: chapter.id }, { type: "facet", facet }, { type: "passage", index }]);
    else dispatch({ type: "passage", index });
    issueCommand("frame");
  };
  useEffect(() => {
    if (!pendingScene.current || state.presentation === "reading") return;
    const handle = requestAnimationFrame(() => {
      const element = document.querySelector<HTMLButtonElement>(".explorer-annotation");
      element?.focus({ preventScroll: true });
      document.querySelector(".explorer-scene")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
      pendingScene.current = false;
    });
    return () => cancelAnimationFrame(handle);
  }, [command.serial, state.presentation, reducedMotion]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(Boolean(query?.matches));
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (readerElement.current) readerElement.current.scrollTop = readerPositions.current.get(readerKey) ?? 0;
  }, [readerKey, state.presentation]);
  useEffect(() => {
    if (previousPresentation.current !== state.presentation && state.presentation !== "scene" && state.presentation !== "full") {
      window.scrollTo({ top: scrollPositions.current.get(state.presentation) ?? 0, behavior: "instant" });
      if (previousPresentation.current === "scene") expandButton.current?.focus({ preventScroll: true });
    }
    if (previousPresentation.current !== state.presentation && state.presentation === "full") {
      const element = chapter ? document.querySelector<HTMLElement>(`[data-reading-chapter="${chapter.id}"]`) : document.querySelector<HTMLElement>(".explorer-complete");
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "start" });
    }
    if (state.presentation === "explore" && pendingPassage.current !== null) {
      const element = passageElements.current.get(pendingPassage.current);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "center" });
      pendingPassage.current = null;
    }
    previousPresentation.current = state.presentation;
  }, [state.presentation, chapter?.id]);
  const present = (presentation: "reading" | "scene" | "full") => {
    scrollPositions.current.set(state.presentation, window.scrollY);
    dispatch({ type: "presentation", presentation });
  };
  const chapterRail = <nav aria-label="Pattern chapters" className="explorer-chapters">{manifest.chapters.map((item) => <button key={item.id} aria-label={`${item.ordinal}. ${item.title}`} aria-pressed={selectedIds.includes(item.id)} onClick={() => select(item.id)}><span className="explorer-chapter-number">{String(item.ordinal).padStart(2, "0")}</span><span><span className="explorer-sr-only">{item.ordinal}. </span>{item.title}</span></button>)}</nav>;
  const scenePanel = <div className="explorer-visual">
    <div className="explorer-scene" aria-label="Interactive Pattern portrait">
      <div className="explorer-scene-top"><button onClick={() => dispatch({ type: "whole" })} aria-pressed={state.view.kind === "whole"}>Whole portrait</button><button disabled={!graphicsAvailable} onClick={() => dispatch({ type: "unfold" })}>{state.unfolded ? "Reassemble" : "Unfold portrait"}<span aria-hidden="true">{state.unfolded ? " ↙" : " ↗"}</span></button></div>
      {validMeshes && <SceneBoundary key={retry} onFailure={() => setStatus("unavailable")}><Suspense fallback={null}><PortraitScene assets={meshBundle.assets} chapters={manifest.chapters}
        selectedIds={selectedIds} facet={facet} activePassage={chapter ? state.passages[chapter.id] ?? 0 : null}
        unfolded={state.unfolded} reducedMotion={reducedMotion} expanded={state.presentation === "scene"} quality={quality}
        viewKey={viewKey} bookmark={bookmarks.current.get(viewKey)} command={command} onBookmark={onBookmark}
        onSelect={select} onAnnotation={annotation} onStatus={setStatus} /></Suspense></SceneBoundary>}
      {(!validMeshes || status === "unavailable") && <div className="explorer-scene-message" role="status"><p>The portrait is taking a pause.</p><p>Your complete reading is available below.</p>{validMeshes && <button onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Try 3D again</button>}</div>}
      {validMeshes && status === "loading" && <p className="explorer-loading" role="status">Preparing four objects…</p>}
      <div className="explorer-scene-toolbar" role="group" aria-label="3D controls" tabIndex={0} onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !graphicsAvailable) return;
        const key = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "closer", "-": "farther", Home: "reset" }[event.key] as CameraCommand["kind"] | undefined;
        if (key) { event.preventDefault(); issueCommand(key); }
      }}>
        <button disabled={!graphicsAvailable} aria-label="Rotate left" title="Rotate left" onClick={() => issueCommand("left")}>↶</button>
        <button disabled={!graphicsAvailable} aria-label="Rotate right" title="Rotate right" onClick={() => issueCommand("right")}>↷</button><span className="explorer-toolbar-divider" />
        <button disabled={!graphicsAvailable} aria-label="Zoom out" title="Zoom out" onClick={() => issueCommand("farther")}>−</button>
        <button disabled={!graphicsAvailable} aria-label="Zoom in" title="Zoom in" onClick={() => issueCommand("closer")}>+</button>
        <button disabled={!graphicsAvailable} aria-label="Reset view" title="Reset view" onClick={() => issueCommand("reset")}><span className="explorer-mobile-icon" aria-hidden="true">⌂</span><span className="explorer-control-text">Reset view</span></button>
        <button ref={expandButton} disabled={state.presentation !== "scene" && (!validMeshes || status === "unavailable")} className="explorer-expand" aria-label={state.presentation === "scene" ? "Close expanded scene" : "Expand scene"} title={state.presentation === "scene" ? "Close expanded scene" : "Expand scene"} onClick={() => state.presentation === "scene" ? back() : present("scene")}><span className="explorer-mobile-icon" aria-hidden="true">{state.presentation === "scene" ? "×" : "⛶"}</span><span className="explorer-control-text">{state.presentation === "scene" ? "Close expanded scene" : "Expand scene"} <span aria-hidden="true">↗</span></span></button>
      </div>
    </div>
    {chapterRail}
    <div className="explorer-visual-footer"><span>Select an object or a chapter to explore.</span><button className="explorer-text-button" onClick={() => dispatch({ type: "guide" })}>Guide me through <span aria-hidden="true">→</span></button></div>
    <details className="explorer-settings"><summary>Scene controls &amp; motion</summary><div><p>Drag horizontally to rotate. Scroll the page with one finger. In the expanded scene, pinch to zoom or use the camera buttons. Each object also has a named chapter button.</p><div className="explorer-setting-actions"><button disabled={!graphicsAvailable} onClick={() => issueCommand("up")}>Tilt up</button><button disabled={!graphicsAvailable} onClick={() => issueCommand("down")}>Tilt down</button><button disabled={!graphicsAvailable} onClick={() => issueCommand("frame")}>Frame selection</button></div><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><label>Graphics <select value={quality} onChange={(event) => setQuality(event.target.value as "standard" | "low")}><option value="standard">Standard</option><option value="low">Low power</option></select></label></div></details>
  </div>;
  const reader = <aside ref={readerElement} className="explorer-reader" aria-label="Chapter reading" onScroll={(event) => readerPositions.current.set(readerKey, event.currentTarget.scrollTop)}>
    {chapter ? <>
      {state.view.kind === "guided" && <div className="explorer-guide"><span>Guided exploration · Stop {state.view.step + 1} of {manifest.chapters.length}</span><button onClick={() => endView("guided")}>Exit guide</button></div>}
      {state.view.kind === "compare" && <button className="explorer-text-button" onClick={() => endView("compare")}>End comparison</button>}
      <ExplorerReader chapterCount={manifest.chapters.length} chapters={selected} facet={facet} activePassage={state.passages[chapter.id] ?? 0} onFacet={(value) => dispatch({ type: "facet", facet: value })}
        onPassage={showPassage} passageRef={bindPassage} graphicsAvailable={graphicsAvailable} />
      <div className="explorer-reader-actions">{chapter.object && <button className="explorer-text-button" onClick={() => dispatch({ type: "inspect", open: true })}>Inspect original image <span aria-hidden="true">↗</span></button>}
        {state.view.kind === "chapter" && <label className="explorer-compare-label"><span className="explorer-sr-only">Compare with another chapter</span><select aria-label="Compare with another chapter" value="" onChange={(event) => dispatch({ type: "compare", chapterId: event.target.value })}><option value="" disabled>Compare with…</option>{manifest.chapters.filter((item) => item.id !== chapter.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>
      {state.view.kind === "guided" ? <div className="explorer-next"><button disabled={state.view.step === 0} onClick={() => dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step - 1 : 0 })}>Previous stop</button>{state.view.step < manifest.chapters.length - 1 ? <button onClick={() => dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step + 1 : 0 })}>Next stop</button> : <button onClick={() => endView("guided")}>Finish exploration</button>}</div>
        : state.view.kind === "chapter" && <button className="explorer-next-chapter" onClick={() => select(manifest.chapters[chapter.ordinal % manifest.chapters.length].id)}><span>Next chapter</span><strong>{manifest.chapters[chapter.ordinal % manifest.chapters.length].title} <span aria-hidden="true">→</span></strong></button>}
    </> : <div className="explorer-introduction"><p className="explorer-eyebrow">A portrait in four parts</p><h2>A different way<br />to see your Pattern.</h2><p>Each object belongs to a chapter of your reading. Choose one to explore its tensions, resources, and another expression.</p><p>The objects are a way into the words. Your complete reading is always here.</p><button className="explorer-primary" onClick={() => select(manifest.chapters[0].id)}>Explore the first chapter <span aria-hidden="true">→</span></button><p className="explorer-intro-note">Rotate the portrait to see every side, or unfold it to give each chapter space.</p></div>}
  </aside>;
  return <main id="portrait-start" tabIndex={-1} className={`portrait-explorer explorer-presentation-${state.presentation}`}>
    <span className="explorer-sr-only" aria-live="polite" aria-atomic="true">{selected.length ? `${selected.map((item) => item.title).join(" and ")}. ${facet === "alternative" ? "Another expression" : facet}.` : "Whole portrait. Four chapters available."}</span>
    <header className="explorer-header"><a href="#portrait-start" className="explorer-wordmark" onClick={(event) => { event.preventDefault(); document.getElementById("portrait-start")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" }); }}>Pattern<span>/</span>Like</a><div><span className="explorer-study-label">{meshBundle.authoring === "codex-parametric/v1" ? "Private portrait" : "Fictional study"}</span><button onClick={() => state.presentation === "full" ? back() : present("full")}>{state.presentation === "full" ? "Return to portrait" : "Full reading"}<span aria-hidden="true"> ↗</span></button></div></header>
    {state.presentation === "full" ? <CompleteReading manifest={manifest} /> : <>
      <div className="explorer-title"><div><p className="explorer-eyebrow">Your Pattern</p><h1>{manifest.chapters.length === 4 ? "Four chapters. One portrait." : "Your Pattern."}</h1></div><p>Explore what connects you.</p></div>
      {manifest.uncertainty && <p className="explorer-uncertainty">{manifest.uncertainty}</p>}
      <div className="explorer-mobile-modes"><button aria-pressed={state.presentation === "explore"} onClick={() => state.presentation !== "explore" && back()}>{state.presentation === "reading" ? "Return to portrait" : "Explore"}</button><button aria-pressed={state.presentation === "reading"} disabled={!chapter} onClick={() => present("reading")}>Read chapter</button></div>
      <div className={`explorer-workspace${selected.length === 2 ? " explorer-is-comparing" : ""}`}>{state.presentation !== "scene" && scenePanel}{reader}</div>
      {state.presentation === "scene" && <Modal label="Expanded portrait scene" className="explorer-expanded-dialog" onClose={back}>{scenePanel}</Modal>}
    </>}
    {state.inspectImage && chapter?.object && <Modal label="Original chapter image" onClose={() => dispatch({ type: "inspect", open: false })}><div className="explorer-dialog-heading"><div><p className="explorer-eyebrow">Original chapter image</p><h2>{chapter.object.label}</h2></div><button onClick={() => dispatch({ type: "inspect", open: false })}>Close image</button></div><img src={chapter.object.imageUrl} alt={chapter.object.label} /><h3>Visual metaphor</h3><p>{chapter.object.rationale}</p><p className="explorer-image-source">{chapter.title} · Image reference {chapter.object.referenceId}</p></Modal>}
    <footer className="explorer-footer"><span>{meshBundle.authoring === "codex-parametric/v1" ? "Four objects created from your chapters and their saved images." : "Four authored models based on the fictional chapter images."}</span><span>Personal meaning stays in the reading.</span></footer>
  </main>;
}
