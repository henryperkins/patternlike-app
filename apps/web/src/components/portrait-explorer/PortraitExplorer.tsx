import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortraitManifest, type PortraitManifest, type PortraitObjectBinding, type PortraitSource } from "../../lib/pattern-portrait.js";
import { chapterPassages, validateMeshBundle } from "./content.js";
import { CompleteReading, ExplorerReader } from "./ExplorerReader.js";
import { currentFacet, selectedChapterIds } from "./explorer-state.js";
import { useExplorerNavigation, type ExplorerNavigation } from "./use-explorer-navigation.js";
import { ObservatoryControls } from "./ObservatoryControls.js";
import { SceneIcon } from "./SceneIcon.js";
import { signLabel, skyBodyLabels, SkyPlacements, SkyReader } from "./SkyReader.js";
import type { PortraitSky, PortraitSkyBody } from "../../lib/portrait-sky.js";
import type { CameraBookmark, CameraCommand, ObservatoryExperience, PortraitMeshBundle, SceneStatus } from "./types.js";
import "./explorer.css";
import "./observatory.css";

const PortraitScene = lazy(() => import("./PortraitScene.js"));
const EMPTY_BINDINGS: readonly PortraitObjectBinding[] = [];
export function PortraitExplorer({ source, objectBindings = EMPTY_BINDINGS, meshBundle, navigation, sky = null }: {
  source: PortraitSource; objectBindings?: readonly PortraitObjectBinding[]; meshBundle: PortraitMeshBundle; navigation?: ExplorerNavigation; sky?: PortraitSky | null;
}) {
  const manifest = useMemo(() => source.status === "ready" ? createPortraitManifest(source.document, objectBindings, source.sunSign) : null, [source, objectBindings]);
  const Root = navigation ? "section" : "main";
  if (!manifest) return <Root className="portrait-explorer"><p role="status">{source.status === "loading" ? "Your Pattern is loading…" : "No Pattern to display"}</p></Root>;
  const identity = JSON.stringify({ ...manifest, chapters: manifest.chapters.map(({ object: _object, ...text }) => text) });
  return navigation ? <ReadyExplorer key={identity} manifest={manifest} meshBundle={meshBundle} navigation={navigation} sky={sky} embedded />
    : <StandaloneExplorer key={identity} manifest={manifest} meshBundle={meshBundle} sky={sky} />;
}

function StandaloneExplorer(props: { manifest: PortraitManifest; meshBundle: PortraitMeshBundle; sky: PortraitSky | null }) {
  const navigation = useExplorerNavigation(props.manifest.chapters.map((chapter) => chapter.id));
  return <ReadyExplorer {...props} navigation={navigation} />;
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

function ReadyExplorer({ manifest, meshBundle, navigation, sky, embedded = false }: { manifest: PortraitManifest; meshBundle: PortraitMeshBundle; navigation: ExplorerNavigation; sky: PortraitSky | null; embedded?: boolean }) {
  const { state, dispatch: navigate } = navigation;
  const selectedIds = selectedChapterIds(state);
  const selected = manifest.chapters.filter((chapter) => selectedIds.includes(chapter.id)).sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
  const chapter = selected[0];
  const facet = currentFacet(state);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [retry, setRetry] = useState(0);
  const [quality, setQuality] = useState<"standard" | "low">("standard");
  const [skyView, setSkyView] = useState(false);
  // Sky exploration temporarily reveals the scene without unwinding the reading's history.
  const presentation = skyView && state.presentation === "reading" ? "explore" : state.presentation;
  const [requestedSkyBody, setSelectedSkyBody] = useState<PortraitSkyBody | null>(sky?.placements[0]?.body ?? (manifest.sunSign ? "sun" : null));
  const selectedSkyBody = sky
    ? sky.placements.find(item => item.body === requestedSkyBody)?.body ?? sky.placements[0]?.body ?? null
    : manifest.sunSign ? "sun" : null;
  const skyPlacement = sky?.placements.find(item => item.body === selectedSkyBody);
  const skyAnnouncement = skyPlacement ? `${skyBodyLabels[skyPlacement.body]} in ${signLabel(skyPlacement.sign)}.`
    : !sky && manifest.sunSign ? `Sun in ${signLabel(manifest.sunSign)}.` : "Birth-chart placements are unavailable.";
  const [experience, setExperience] = useState<ObservatoryExperience>({ roofOpen: true, lighting: "day", inspect: false, openDesks: {}, turns: {} });
  const changeExperience = (update: Partial<ObservatoryExperience>) => setExperience(value => ({ ...value, ...update }));
  const operate = (chapterId: string) => setExperience(value => ({ ...value, openDesks: { ...value.openDesks, [chapterId]: !value.openDesks[chapterId] } }));
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [command, setCommand] = useState<CameraCommand>({ kind: "frame", serial: 0 });
  const bookmarks = useRef(new Map<string, CameraBookmark>());
  const passageElements = useRef(new Map<number, HTMLParagraphElement>());
  const scrollPositions = useRef(new Map<string, { top: number; headingOffset?: number }>());
  const pendingPassage = useRef<number | null>(null);
  const pendingScene = useRef(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const fullReadingButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"heading" | "compare-start" | "compare-end" | "guide-end" | null>(null);
  const explorerElement = useRef<HTMLElement>(null);
  const readerElement = useRef<HTMLElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const readerPositions = useRef(new Map<string, number>());
  const readerKey = skyView ? "sky" : `${selectedIds.join("+")}:${facet}`;
  const scrollKey = presentation === "reading" ? `reading:${readerKey}` : presentation;
  const previousPresentation = useRef(presentation);
  const validMeshes = validateMeshBundle(manifest, meshBundle);
  const graphicsAvailable = validMeshes && status === "ready";
  const viewKey = skyView ? "sky" : `${selectedIds.join("+") || "whole"}:${state.unfolded ? "unfolded" : "assembled"}${experience.inspect && selectedIds.length === 1 ? ":inspect" : ""}`;
  const onBookmark = useCallback((key: string, bookmark: CameraBookmark) => { bookmarks.current.set(key, bookmark); }, []);
  const issueCommand = (kind: CameraCommand["kind"]) => setCommand((value) => ({ kind, serial: value.serial + 1 }));
  const rememberScroll = useCallback(() => {
    const heading = presentation === "reading" ? readerElement.current?.querySelector("[data-reader-heading]") : null;
    scrollPositions.current.set(scrollKey, { top: window.scrollY, headingOffset: heading?.getBoundingClientRect().top });
  }, [scrollKey, presentation]);
  const dispatch = (action: Parameters<typeof navigate>[0]) => {
    rememberScroll();
    navigate(action);
  };
  const select = (chapterId: string, focus = false) => {
    setSkyView(false);
    changeExperience({ inspect: false });
    if (focus) pendingFocus.current = "heading";
    dispatch({ type: "select", chapterId });
  };
  const back = () => dispatch({ type: "back" });
  const openSky = (body?: PortraitSkyBody) => {
    if (body) setSelectedSkyBody(body);
    setSkyView(true);
  };
  const endView = (kind: "guided" | "compare") => {
    pendingFocus.current = kind === "compare" ? "compare-end" : "guide-end";
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
    if (presentation === "scene") {
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
    if (presentation === "reading") dispatch([{ type: "back" }, { type: "select", chapterId: chapter.id }, { type: "facet", facet }, { type: "passage", index }]);
    else dispatch({ type: "passage", index });
    issueCommand("frame");
  };
  useEffect(() => {
    if (!pendingScene.current || presentation === "reading") return;
    const handle = requestAnimationFrame(() => {
      const element = document.querySelector<HTMLButtonElement>(".explorer-annotation");
      element?.focus({ preventScroll: true });
      document.querySelector(".explorer-scene")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
      pendingScene.current = false;
    });
    return () => cancelAnimationFrame(handle);
  }, [command.serial, presentation, reducedMotion]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(Boolean(query?.matches));
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (readerElement.current) readerElement.current.scrollTop = readerPositions.current.get(readerKey) ?? 0;
  }, [readerKey, presentation]);
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    // Also retain the reading position when the browser's Back action leaves it.
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [rememberScroll]);
  useEffect(() => {
    if (previousPresentation.current !== presentation && presentation !== "scene" && presentation !== "full") {
      const target = presentation === "reading" ? readerElement.current?.querySelector<HTMLElement>("[data-reader-heading]") : explorerElement.current;
      const savedPosition = scrollPositions.current.get(scrollKey);
      if (savedPosition !== undefined) {
        // Keep the same text in view even if the surrounding layout changes.
        const top = target && savedPosition.headingOffset !== undefined
          ? window.scrollY + target.getBoundingClientRect().top - savedPosition.headingOffset : savedPosition.top;
        window.scrollTo({ top, behavior: "instant" });
        if (presentation === "reading") {
          const inset = target ? parseFloat(getComputedStyle(target).scrollMarginBlockStart) || 0 : 0;
          const controls = readerElement.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), a[href]") ?? [];
          const visibleTarget = [...passageElements.current.values(), ...controls].find((element) => {
            const box = element.getBoundingClientRect();
            return box.bottom > inset && box.top < window.innerHeight;
          });
          (visibleTarget ?? target)?.focus({ preventScroll: true });
        }
      } else {
        if (presentation === "reading") target?.focus({ preventScroll: true });
        target?.scrollIntoView({ behavior: "instant", block: "start" });
      }
      if (previousPresentation.current === "scene") expandButton.current?.focus({ preventScroll: true });
      else if (previousPresentation.current === "reading") readButton.current?.focus({ preventScroll: true });
      else if (previousPresentation.current === "full") fullReadingButton.current?.focus({ preventScroll: true });
    }
    if (previousPresentation.current !== presentation && presentation === "full") {
      const element = chapter ? document.querySelector<HTMLElement>(`[data-reading-chapter="${chapter.id}"]`) : document.querySelector<HTMLElement>(".explorer-complete");
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "start" });
    }
    if (presentation === "explore" && pendingPassage.current !== null) {
      const element = passageElements.current.get(pendingPassage.current);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "center" });
      pendingPassage.current = null;
    }
    if (presentation !== "scene" && presentation !== "full") {
      const heading = readerElement.current?.querySelector<HTMLElement>("[data-reader-heading]");
      if (pendingFocus.current === "heading") {
        if (readerElement.current) readerElement.current.scrollTop = 0;
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({ behavior: "instant", block: "start" });
      } else if (pendingFocus.current) {
        const selector = pendingFocus.current === "compare-start" ? "[data-end-comparison]"
          : pendingFocus.current === "compare-end" ? '[aria-label="Compare with another chapter"]' : "[data-start-guide]";
        const target = explorerElement.current?.querySelector<HTMLElement>(selector) ?? heading;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ behavior: "instant", block: "nearest" });
      }
      if (!pendingFocus.current && lastFocused.current && !lastFocused.current.isConnected && document.activeElement === document.body) {
        const target = explorerElement.current?.querySelector<HTMLElement>(state.view.kind === "compare" ? "[data-end-comparison]"
          : state.view.kind === "chapter" ? '[aria-label="Compare with another chapter"]' : "[data-start-guide]") ?? heading;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ behavior: "instant", block: "nearest" });
      }
      pendingFocus.current = null;
    }
    previousPresentation.current = presentation;
  }, [state, chapter?.id, scrollKey]);
  const present = (presentation: "reading" | "scene" | "full") => {
    dispatch({ type: "presentation", presentation });
  };
  const chapterRail = <nav aria-label="Pattern chapters" className="explorer-chapters">{manifest.chapters.map((item) => <button key={item.id} aria-label={`${item.ordinal}. ${item.title}`} aria-pressed={selectedIds.includes(item.id)} onClick={() => select(item.id)}><span className="explorer-chapter-number">{String(item.ordinal).padStart(2, "0")}</span><span><span className="explorer-sr-only">{item.ordinal}. </span>{item.title}</span></button>)}</nav>;
  const scenePanel = <div className="explorer-visual">
    <div className="explorer-scene" aria-label="Interactive Pattern portrait">
      <div className="explorer-scene-top"><button onClick={() => { setSkyView(false); if (!skyView) dispatch({ type: "whole" }); }} aria-pressed={!skyView && state.view.kind === "whole"}>{skyView ? "Back to Pattern" : "Whole portrait"}</button><button disabled={!graphicsAvailable || skyView} onClick={() => dispatch({ type: "unfold" })}>{state.unfolded ? "Reassemble" : "Unfold portrait"}<span aria-hidden="true">{state.unfolded ? " ↙" : " ↗"}</span></button></div>
      {validMeshes && <SceneBoundary key={JSON.stringify([retry, sky])} onFailure={() => setStatus("unavailable")}><Suspense fallback={null}><PortraitScene assets={meshBundle.assets} chapters={manifest.chapters}
        selectedIds={selectedIds} facet={facet} activePassage={chapter ? state.passages[chapter.id] ?? 0 : null}
        unfolded={state.unfolded} reducedMotion={reducedMotion} expanded={presentation === "scene"} quality={quality}
        experience={experience} onOperate={operate}
        sky={sky} sunSign={manifest.sunSign} skyView={skyView} selectedSkyBody={selectedSkyBody} onSelectSkyBody={openSky}
        viewKey={viewKey} bookmark={bookmarks.current.get(viewKey)} command={command} onBookmark={onBookmark}
        onSelect={select} onAnnotation={annotation} onStatus={setStatus} /></Suspense></SceneBoundary>}
      {(!validMeshes || status === "unavailable") && <div className="explorer-scene-message" role="status"><p>The portrait is taking a pause.</p><p>Your complete reading is available below.</p>{validMeshes && <button onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Try 3D again</button>}</div>}
      {validMeshes && status === "loading" && <p className="explorer-loading" role="status">Preparing four objects…</p>}
      <div className="explorer-scene-toolbar" role="group" aria-label="3D controls" tabIndex={0} onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !graphicsAvailable) return;
        const key = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "closer", "-": "farther", Home: "reset" }[event.key] as CameraCommand["kind"] | undefined;
        if (key) { event.preventDefault(); issueCommand(key); }
      }}>
        <button disabled={!graphicsAvailable} aria-label="Rotate left" title="Rotate left" onClick={() => issueCommand("left")}><SceneIcon name="left" /></button>
        <button disabled={!graphicsAvailable} aria-label="Rotate right" title="Rotate right" onClick={() => issueCommand("right")}><SceneIcon name="right" /></button><span className="explorer-toolbar-divider" />
        <button disabled={!graphicsAvailable} aria-label="Zoom out" title="Zoom out" onClick={() => issueCommand("farther")}><SceneIcon name="minus" /></button>
        <button disabled={!graphicsAvailable} aria-label="Zoom in" title="Zoom in" onClick={() => issueCommand("closer")}><SceneIcon name="plus" /></button>
        <button disabled={!graphicsAvailable} aria-label="Reset view" title="Reset view" onClick={() => issueCommand("reset")}><span className="explorer-mobile-icon"><SceneIcon name="home" /></span><span className="explorer-control-text">Reset view</span></button>
        {presentation !== "scene" && <button ref={expandButton} disabled={!validMeshes || status === "unavailable"} className="explorer-expand" aria-label="Expand scene" title="Expand scene" onClick={() => present("scene")}><span className="explorer-mobile-icon"><SceneIcon name="expand" /></span><span className="explorer-control-text">Expand scene</span></button>}
      </div>
    </div>
    {skyView && <SkyPlacements sky={sky} sunSign={manifest.sunSign} selected={selectedSkyBody} onSelect={openSky} />}
    <ObservatoryControls experience={experience} onChange={changeExperience} available={graphicsAvailable} skyView={skyView}
      chapterId={!skyView && selectedIds.length === 1 ? chapter?.id : undefined} onOperate={() => chapter && operate(chapter.id)} />
    {!skyView && <>{chapterRail}
    <div className="explorer-visual-footer"><span>Select an object or a chapter to explore.</span><button data-start-guide className="explorer-text-button" onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide" }); }}>Guide me through <span aria-hidden="true">→</span></button></div></>}
    <details className="explorer-settings"><summary>Scene controls &amp; motion</summary><div><p>Drag horizontally to rotate. Scroll the page with one finger. In the expanded scene, pinch to zoom or use the camera buttons. Each object also has a named chapter button.</p><div className="explorer-setting-actions"><button disabled={!graphicsAvailable} onClick={() => issueCommand("up")}>Tilt up</button><button disabled={!graphicsAvailable} onClick={() => issueCommand("down")}>Tilt down</button><button disabled={!graphicsAvailable} onClick={() => issueCommand("frame")}>Frame selection</button></div><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><label>Graphics <select value={quality} onChange={(event) => setQuality(event.target.value as "standard" | "low")}><option value="standard">Standard</option><option value="low">Low power</option></select></label></div></details>
  </div>;
  const ReaderHeading = embedded ? "h3" : "h2";
  const reader = <aside ref={readerElement} className="explorer-reader" aria-label={skyView ? "Birth-chart reading" : "Chapter reading"} onScroll={(event) => readerPositions.current.set(readerKey, event.currentTarget.scrollTop)}>
    {skyView ? <SkyReader sky={sky} sunSign={manifest.sunSign} selected={selectedSkyBody} embedded={embedded}
      onPattern={() => chapter ? setSkyView(false) : select(manifest.chapters[0].id, true)} /> : chapter ? <>
      {state.view.kind === "guided" && <div className="explorer-guide"><span>Guided exploration · Stop {state.view.step + 1} of {manifest.chapters.length}</span><button onClick={() => endView("guided")}>Exit guide</button></div>}
      {state.view.kind === "compare" && <button data-end-comparison className="explorer-text-button" onClick={() => endView("compare")}>End comparison</button>}
      <ExplorerReader embedded={embedded} chapterCount={manifest.chapters.length} chapters={selected} facet={facet} activePassage={state.passages[chapter.id] ?? 0} onFacet={(value) => dispatch({ type: "facet", facet: value })}
        onPassage={showPassage} passageRef={bindPassage} graphicsAvailable={graphicsAvailable} />
      <div className="explorer-reader-actions">{chapter.object && <button className="explorer-text-button" onClick={() => dispatch({ type: "inspect", open: true })}>Inspect original image <span aria-hidden="true">↗</span></button>}
        {state.view.kind === "chapter" && <label className="explorer-compare-label"><span className="explorer-sr-only">Compare with another chapter</span><select aria-label="Compare with another chapter" value="" onChange={(event) => { pendingFocus.current = "compare-start"; dispatch({ type: "compare", chapterId: event.target.value }); }}><option value="" disabled>Compare with…</option>{manifest.chapters.filter((item) => item.id !== chapter.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>
      {state.view.kind === "guided" ? <div className="explorer-next"><button disabled={state.view.step === 0} onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step - 1 : 0 }); }}>Previous stop</button>{state.view.step < manifest.chapters.length - 1 ? <button onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step + 1 : 0 }); }}>Next stop</button> : <button onClick={() => endView("guided")}>Finish exploration</button>}</div>
        : state.view.kind === "chapter" && <button className="explorer-next-chapter" onClick={() => select(manifest.chapters[chapter.ordinal % manifest.chapters.length].id, true)}><span>Next chapter</span><strong>{manifest.chapters[chapter.ordinal % manifest.chapters.length].title} <span aria-hidden="true">→</span></strong></button>}
    </> : <div className="explorer-introduction"><ReaderHeading data-reader-heading tabIndex={-1}>Your sky.<br />Your story, unfolding.</ReaderHeading><p>Find your Sun, Moon, and rising in the zodiac. Then step into the four chapters of your Pattern.</p>
      {(sky || manifest.sunSign) && <SkyPlacements sky={sky} sunSign={manifest.sunSign} onSelect={openSky} />}
      <p>Each chapter opens into its own tensions, resources, and another expression. Follow an object into the full reading, or begin at the zodiac instrument.</p><button className="explorer-primary" onClick={() => select(manifest.chapters[0].id, true)}>Explore the first chapter <span aria-hidden="true">→</span></button>
      <button className="sky-intro-link explorer-text-button" onClick={() => openSky()}>Explore your birth sky</button>
      <p className="explorer-intro-note">Your birth chart supplies the placements. Your saved Pattern supplies the reading.</p></div>}
  </aside>;
  const Root = embedded ? "section" : "main";
  const fullReadingControl = <button ref={fullReadingButton} onClick={() => presentation === "full" ? back() : present("full")}>{presentation === "full" ? "Return to portrait" : "Full reading"}<span aria-hidden="true"> ↗</span></button>;
  return <Root onFocusCapture={(event) => { lastFocused.current = event.target as HTMLElement; }} ref={explorerElement} id="portrait-start" tabIndex={-1} aria-label="Pattern portrait explorer" className={`portrait-explorer observatory-explorer${skyView ? " observatory-sky" : ""}${embedded ? " explorer-embedded" : ""} explorer-presentation-${presentation}`}>
    <span className="explorer-sr-only" aria-live="polite" aria-atomic="true">{presentation === "full" ? "Full Pattern reading. Four chapters available." : skyView ? `Your sky. ${skyAnnouncement}` : selected.length ? `${selected.map((item) => item.title).join(" and ")}. ${facet === "alternative" ? "Another expression" : facet}.` : "Whole portrait. Four chapters available."}</span>
    {embedded ? <nav className="explorer-embedded-bar" aria-label="Portrait navigation"><button onClick={navigation.close}>Back to reading</button>{fullReadingControl}</nav> : (<header className="explorer-header"><a href="#portrait-start" className="explorer-wordmark" onClick={(event) => { event.preventDefault(); document.getElementById("portrait-start")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" }); }}>Pattern<span>/</span>Like</a><div><span className="explorer-study-label">{meshBundle.authoring === "codex-parametric/v1" ? "Private portrait" : "Fictional study"}</span>{fullReadingControl}</div></header>)}

    {presentation === "full" ? <CompleteReading manifest={manifest} embedded={embedded} /> : <>
      <div className="explorer-title">{embedded ? <h2>Your zodiac observatory</h2> : <h1>Your zodiac observatory.</h1>}
        <nav className="observatory-views" aria-label="Observatory views"><button aria-pressed={!skyView} onClick={() => setSkyView(false)}>Your Pattern</button><button aria-pressed={skyView} onClick={() => openSky()}>Your sky</button></nav>
      </div>
      {manifest.uncertainty && <p className="explorer-uncertainty">{manifest.uncertainty}</p>}
      <div className="explorer-mobile-modes"><button aria-pressed={presentation === "explore"} onClick={() => presentation !== "explore" && back()}>{presentation === "reading" ? "Return to portrait" : "Explore"}</button><button ref={readButton} aria-pressed={presentation === "reading"} disabled={!chapter} onClick={() => { setSkyView(false); present("reading"); }}>Read chapter</button></div>
      <div className={`explorer-workspace${selected.length === 2 ? " explorer-is-comparing" : ""}`}>{presentation !== "scene" && scenePanel}{reader}</div>
      {presentation === "scene" && <Modal label="Expanded portrait scene" className="explorer-expanded-dialog" onClose={back}><div className="explorer-dialog-heading"><h2>Portrait scene</h2><button onClick={back}>Close expanded scene</button></div>{scenePanel}</Modal>}
    </>}
    {state.inspectImage && chapter?.object && <Modal label="Original chapter image" onClose={() => dispatch({ type: "inspect", open: false })}><div className="explorer-dialog-heading"><div><p className="explorer-eyebrow">Original chapter image</p><h2>{chapter.object.label}</h2></div><button onClick={() => dispatch({ type: "inspect", open: false })}>Close image</button></div><img src={chapter.object.imageUrl} alt={chapter.object.label} /><h3>Visual metaphor</h3><p>{chapter.object.rationale}</p><p className="explorer-image-source">{chapter.title} · Image reference {chapter.object.referenceId}</p></Modal>}
    {!embedded && <footer className="explorer-footer"><span>{meshBundle.authoring === "codex-parametric/v1" ? "Four objects created from your chapters and their saved images." : "Four authored models based on the fictional chapter images."}</span><span>Personal meaning stays in the reading.</span></footer>}
  </Root>;
}
