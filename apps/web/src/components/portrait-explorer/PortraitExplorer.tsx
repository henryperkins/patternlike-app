import { Component, lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortraitManifest, type PortraitManifest, type PortraitObjectBinding, type PortraitSource } from "../../lib/pattern-portrait.js";
import { chapterPassages, validateMeshBundle } from "./content.js";
import { CompleteReading, ExplorerReader, ReaderFooter } from "./ExplorerReader.js";
import { currentFacet, selectedChapterIds, type ExplorerSnapshot } from "./explorer-state.js";
import { useExplorerNavigation, type ExplorerNavigation } from "./use-explorer-navigation.js";
import { ObservatoryControls } from "./ObservatoryControls.js";
import { SceneIcon } from "./SceneIcon.js";
import { signLabel, skyBodyLabels, SkyPlacements, SkyReader } from "./SkyReader.js";
import type { PortraitSky, PortraitSkyBody } from "../../lib/portrait-sky.js";
import { facets, type CameraBookmark, type CameraCommand, type ObservatoryExperience, type PortraitMeshBundle, type SceneStatus } from "./types.js";
import "./explorer.css";
import "./observatory.css";

class SceneModuleError extends Error {}
const loadScene = () => import("./PortraitScene.js").catch((cause: unknown) => { throw new SceneModuleError("The 3D view could not be loaded.", { cause }); });
const EMPTY_BINDINGS: readonly PortraitObjectBinding[] = [];
const EMPTY_ASSETS: PortraitMeshBundle["assets"] = [];
export function PortraitExplorer({ source, objectBindings = EMPTY_BINDINGS, meshBundle, navigation, sky = null }: {
  source: PortraitSource; objectBindings?: readonly PortraitObjectBinding[]; meshBundle?: PortraitMeshBundle; navigation?: ExplorerNavigation; sky?: PortraitSky | null;
}) {
  const manifest = useMemo(() => source.status === "ready" ? createPortraitManifest(source.document, objectBindings, source.sunSign) : null, [source, objectBindings]);
  const Root = navigation ? "section" : "main";
  if (!manifest) return <Root className="portrait-explorer"><p role="status">{source.status === "loading" ? "Your Pattern is loading…" : "No Pattern to display"}</p></Root>;
  const identity = JSON.stringify({ ...manifest, sunSign: null, chapters: manifest.chapters.map(({ object: _object, ...text }) => text) });
  return navigation ? <ReadyExplorer key={identity} manifest={manifest} meshBundle={meshBundle} navigation={navigation} sky={sky} embedded />
    : <StandaloneExplorer key={identity} manifest={manifest} meshBundle={meshBundle} sky={sky} />;
}

function StandaloneExplorer(props: { manifest: PortraitManifest; meshBundle?: PortraitMeshBundle; sky: PortraitSky | null }) {
  const navigation = useExplorerNavigation(props.manifest.chapters.map((chapter) => chapter.id));
  return <ReadyExplorer {...props} navigation={navigation} />;
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Modal({ label, children, onClose, className = "", restoreFocus }: { label: string; children: ReactNode; onClose: () => void; className?: string; restoreFocus?: () => boolean }) {
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
      queueMicrotask(() => { if (restoreFocus?.() !== false && opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} className={`explorer-dialog ${className}`} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])
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

function ReadyExplorer({ manifest, meshBundle, navigation, sky, embedded = false }: { manifest: PortraitManifest; meshBundle?: PortraitMeshBundle; navigation: ExplorerNavigation; sky: PortraitSky | null; embedded?: boolean }) {
  const { state, dispatch: navigate } = navigation;
  const selectedIds = selectedChapterIds(state);
  const selected = manifest.chapters.filter((chapter) => selectedIds.includes(chapter.id)).sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id));
  const chapter = selected[0];
  const facet = currentFacet(state);
  const facetLabel = facets.find(item => item.id === facet)!.label;
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [artworkFallback, setArtworkFallback] = useState(false);
  const [retry, setRetry] = useState(0);
  const [moduleFailed, setModuleFailed] = useState(false);
  const [PortraitScene, setPortraitScene] = useState(() => lazy(loadScene));
  const [shortViewport, setShortViewport] = useState(() => window.matchMedia?.("(min-width: 600px) and (max-height: 480px)").matches ?? false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const restoreExpandedFocus = useRef(true);
  const compactExpanded = state.presentation === "scene" && shortViewport;
  useEffect(() => {
    const query = window.matchMedia?.("(min-width: 600px) and (max-height: 480px)");
    const update = () => setShortViewport(Boolean(query?.matches));
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  const [quality, setQuality] = useState<"standard" | "low">("standard");
  const skyView = state.sky !== null;
  const comparing = !skyView && state.view.kind === "compare";
  // Sky exploration temporarily reveals the scene without unwinding the reading's history.
  const presentation = skyView && state.presentation === "reading" ? "explore" : state.presentation;
  const requestedSkyBody = state.sky?.body;
  const selectedSkyBody = sky
    ? sky.placements.find(item => item.body === requestedSkyBody)?.body ?? sky.placements[0]?.body ?? null
    : manifest.sunSign ? "sun" : null;
  const skyPlacement = sky?.placements.find(item => item.body === selectedSkyBody);
  const skyAnnouncement = skyPlacement ? `${skyBodyLabels[skyPlacement.body]} in ${signLabel(skyPlacement.sign)}.`
    : !sky && manifest.sunSign ? `Sun in ${signLabel(manifest.sunSign)}.` : "Birth-chart placements are unavailable.";
  const [sceneMemory] = useState(() => {
    const sourceIdentity = JSON.stringify({ ...manifest, sunSign: null, chapters: manifest.chapters.map(({ object: _object, ...text }) => text) });
    const saved = navigation.memory?.scene;
    const memory = saved?.sourceIdentity === sourceIdentity ? saved : {
      sourceIdentity,
      experience: { roofOpen: true, lighting: "day" as const, inspect: false, openDesks: {}, turns: {} },
      bookmarks: new Map<string, CameraBookmark>(),
    };
    if (navigation.memory) navigation.memory.scene = memory;
    return memory;
  });
  const [experience, setExperience] = useState<ObservatoryExperience>(sceneMemory.experience);
  const updateExperience = (update: (value: ObservatoryExperience) => ObservatoryExperience) => setExperience(value => {
    const next = update(value);
    if (!navigation.memory || navigation.memory.scene === sceneMemory) sceneMemory.experience = next;
    return next;
  });
  const changeExperience = (update: Partial<ObservatoryExperience>) => updateExperience(value => ({ ...value, ...update }));
  const operate = (chapterId: string) => updateExperience(value => ({ ...value, openDesks: { ...value.openDesks, [chapterId]: !value.openDesks[chapterId] } }));
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [command, setCommand] = useState<CameraCommand>({ kind: "frame", serial: 0 });
  const bookmarks = useRef(sceneMemory.bookmarks);
  const passageElements = useRef(new Map<string, HTMLParagraphElement>());
  const scrollPositions = useRef(navigation.memory?.scrollPositions ?? new Map<string, { top: number; headingOffset?: number }>());
  const pendingPassage = useRef<{ chapterId: string; index: number } | null>(null);
  const [pendingScene, setPendingScene] = useState<string | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const fullReadingButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"heading" | "chapter" | "pattern" | "compare-start" | "compare-end" | "guide-end" | null>(null);
  const explorerElement = useRef<HTMLElement>(null);
  const readerElement = useRef<HTMLElement>(null);
  const readerId = useId();
  const lastFocused = useRef<HTMLElement | null>(null);
  const readerPositions = useRef(navigation.memory?.readerPositions ?? new Map<string, number>());
  const readerKey = skyView ? `sky:${selectedSkyBody ?? "unavailable"}` : `${selectedIds.join("+")}:${facet}`;
  const scrollKey = skyView ? `sky:${presentation}` : comparing ? `compare:${presentation}:${readerKey}` : presentation === "reading" ? `reading:${readerKey}` : presentation;
  const previousPresentation = useRef<string | null>(scrollPositions.current.has(scrollKey) ? null : presentation);
  const previousSkyView = useRef(skyView);
  const previousComparison = useRef(comparing);
  const validMeshes = meshBundle ? validateMeshBundle(manifest, meshBundle) : manifest.chapters.length >= 3 && manifest.chapters.length <= 6;
  const graphicsAvailable = validMeshes && status === "ready";
  const viewKey = skyView ? "sky" : `${selectedIds.join("+") || "whole"}:${state.unfolded ? "unfolded" : "assembled"}${experience.inspect && selectedIds.length === 1 ? ":inspect" : ""}`;
  const onBookmark = useCallback((key: string, bookmark: CameraBookmark) => {
    // A late renderer cleanup must not repopulate a cleared or replaced session.
    if (!navigation.memory || navigation.memory.scene === sceneMemory) bookmarks.current.set(key, bookmark);
  }, [navigation.memory, sceneMemory]);
  const issueCommand = (kind: CameraCommand["kind"]) => setCommand((value) => ({ kind, serial: value.serial + 1 }));
  const rememberScroll = useCallback(() => {
    const heading = presentation === "reading" ? readerElement.current?.querySelector("[data-reader-heading]") : null;
    scrollPositions.current.set(scrollKey, { top: window.scrollY, headingOffset: heading?.getBoundingClientRect().top });
  }, [scrollKey, presentation]);
  const dispatch = (action: Parameters<typeof navigate>[0]) => {
    rememberScroll();
    navigate(action);
  };
  const returnActions = (within: (snapshot: ExplorerSnapshot) => boolean) => {
    let steps = 1;
    for (let index = state.past.length - 1; index >= 0 && within(state.past[index]); index--) steps++;
    return Array.from({ length: steps }, () => ({ type: "back" as const }));
  };
  const select = (chapterId: string, focus: boolean | "scene" = false) => {
    changeExperience({ inspect: false });
    if (focus) pendingFocus.current = focus === "scene" ? "chapter" : "heading";
    dispatch([...(skyView ? returnActions((snapshot) => snapshot.sky !== null) : []), { type: "select", chapterId }]);
  };
  const back = () => dispatch({ type: "back" });
  const openSky = (body?: PortraitSkyBody) => {
    dispatch({ type: "sky", body: body ?? selectedSkyBody });
  };
  const returnPattern = (focus = false) => {
    if (!skyView) return;
    if (focus) pendingFocus.current = "pattern";
    dispatch(returnActions((snapshot) => snapshot.sky !== null));
  };
  const closeScene = () => dispatch(returnActions((snapshot) => snapshot.presentation === "scene"));
  const endView = (kind: "guided" | "compare") => {
    pendingFocus.current = kind === "compare" ? "compare-end" : "guide-end";
    let steps = 1;
    for (let index = state.past.length - 1; index >= 0 && state.past[index].view.kind === kind; index--) steps++;
    if (steps === 1) back(); else dispatch(Array.from({ length: steps }, () => ({ type: "back" as const })));
  };
  const bindPassage = (chapterId: string, index: number, element: HTMLParagraphElement | null) => {
    const key = `${chapterId}:${index}`;
    if (element) passageElements.current.set(key, element); else passageElements.current.delete(key);
  };
  const annotation = (chapterId: string) => {
    const linked = selected.find(item => item.id === chapterId);
    if (!linked) return;
    const index = Math.min(state.passages[chapterId] ?? 0, chapterPassages(linked, facet).length - 1);
    if (index < 0) return;
    if (presentation === "scene") {
      restoreExpandedFocus.current = false;
      pendingPassage.current = { chapterId, index };
      dispatch([{ type: "back" }, { type: "passage", chapterId, index }]);
      return;
    }
    dispatch({ type: "passage", chapterId, index });
    const element = passageElements.current.get(`${chapterId}:${index}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
  };
  const showPassage = (chapterId: string, index: number) => {
    const linked = selected.find(item => item.id === chapterId);
    if (!linked || index < 0 || index >= chapterPassages(linked, facet).length) return;
    setPendingScene(chapterId);
    if (presentation === "reading" && !comparing) dispatch([{ type: "back" }, { type: "select", chapterId }, { type: "facet", facet }, { type: "passage", chapterId, index }]);
    else dispatch({ type: "passage", chapterId, index });
  };
  useEffect(() => {
    if (!pendingScene || (presentation === "reading" && !comparing)) return;
    const handle = requestAnimationFrame(() => {
      const sceneAnnotation = explorerElement.current?.querySelector<HTMLButtonElement>(`.explorer-annotation[data-chapter-id="${pendingScene}"]`);
      const nativeLink = [...explorerElement.current?.querySelectorAll<HTMLButtonElement>(".explorer-chapters button") ?? []].find(button => button.dataset.chapterId === pendingScene);
      const element = sceneAnnotation && getComputedStyle(sceneAnnotation).visibility !== "hidden" ? sceneAnnotation : nativeLink;
      element?.focus({ preventScroll: true });
      if (element) {
        // Reveal the actual link between sticky bars. Scrolling the whole canvas
        // can leave its annotation covered in short windows; scrolling an absolute
        // label with scrollIntoView can move its clipped overlay away from the object.
        const style = getComputedStyle(element);
        const top = parseFloat(style.scrollMarginBlockStart) || 0;
        const bottom = window.innerHeight - (parseFloat(style.scrollMarginBlockEnd) || 0);
        const bounds = element.getBoundingClientRect();
        const offset = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
        if (offset) window.scrollBy({ top: offset, behavior: reducedMotion ? "instant" : "smooth" });
      }
      setPendingScene(null);
    });
    return () => cancelAnimationFrame(handle);
  }, [pendingScene, presentation, reducedMotion, comparing]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(Boolean(query?.matches));
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const root = explorerElement.current;
    if (!root) return;
    const bar = root.querySelector<HTMLElement>(".explorer-embedded-bar");
    const modes = root.querySelector<HTMLElement>(".explorer-mobile-modes");
    const title = root.querySelector<HTMLElement>(".explorer-title");
    const header = root.querySelector<HTMLElement>(".explorer-header");
    const workspace = root.querySelector<HTMLElement>(".explorer-workspace");
    // Measure the actual sticky rows, including wrapped titles and enlarged text.
    const measure = () => {
      root.style.setProperty("--explorer-bar-height", `${bar?.getBoundingClientRect().height ?? 0}px`);
      root.style.setProperty("--explorer-modes-height", `${modes?.getBoundingClientRect().height ?? 0}px`);
      if (workspace) root.style.setProperty("--explorer-reader-offset", `${workspace.getBoundingClientRect().top - root.getBoundingClientRect().top}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (bar) observer.observe(bar);
    if (modes) observer.observe(modes);
    if (title) observer.observe(title);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [presentation, readerKey]);
  useLayoutEffect(() => {
    const reader = readerElement.current;
    if (!reader) return;
    // Restore only after the header rows and reserved footer set the final height.
    reader.scrollTop = readerPositions.current.get(readerKey) ?? 0;
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
    if ((previousPresentation.current !== presentation || previousSkyView.current !== skyView || previousComparison.current !== comparing) && presentation !== "scene" && presentation !== "full") {
      const target = presentation === "reading" ? readerElement.current?.querySelector<HTMLElement>("[data-reader-heading]") : explorerElement.current;
      const savedPosition = scrollPositions.current.get(scrollKey);
      if (savedPosition !== undefined) {
        // Keep the same text in view even if the surrounding layout changes.
        const top = target && savedPosition.headingOffset !== undefined
          ? window.scrollY + target.getBoundingClientRect().top - savedPosition.headingOffset : savedPosition.top;
        window.scrollTo({ top, behavior: "instant" });
        if (presentation === "reading") {
          const inset = target ? parseFloat(getComputedStyle(target).scrollMarginBlockStart) || 0 : 0;
          const candidates = readerElement.current?.querySelectorAll<HTMLElement>(".explorer-passage p, button:not(:disabled), select:not(:disabled), a[href]") ?? [];
          const visibleTarget = [...candidates].find((element) => {
            const box = element.getBoundingClientRect();
            return box.bottom > inset && box.top < window.innerHeight;
          });
          (visibleTarget ?? target)?.focus({ preventScroll: true });
        }
      } else {
        if (presentation === "reading") target?.focus({ preventScroll: true });
        target?.scrollIntoView({ behavior: "instant", block: "start" });
      }
      if (previousPresentation.current === "scene" && presentation !== "reading") expandButton.current?.focus({ preventScroll: true });
      else if (previousPresentation.current === "reading") readButton.current?.focus({ preventScroll: true });
      else if (previousPresentation.current === "full") fullReadingButton.current?.focus({ preventScroll: true });
    }
    if (previousPresentation.current !== presentation && presentation === "full") {
      const element = chapter ? document.querySelector<HTMLElement>(`[data-reading-chapter="${chapter.id}"]`) : document.querySelector<HTMLElement>(".explorer-complete");
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "start" });
    }
    if (presentation !== "scene" && presentation !== "full" && pendingPassage.current !== null) {
      const element = passageElements.current.get(`${pendingPassage.current.chapterId}:${pendingPassage.current.index}`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: "instant", block: "center" });
      pendingPassage.current = null;
    }
    if (presentation !== "scene" && presentation !== "full") {
      const heading = readerElement.current?.querySelector<HTMLElement>("[data-reader-heading]");
      if (previousComparison.current && !comparing && !skyView && !pendingFocus.current) pendingFocus.current = "compare-end";
      if (previousSkyView.current !== skyView && !pendingFocus.current) {
        // The reading's pinned view switch moves when sky reveals the scene.
        // Keep focus on its replacement without scrolling the saved passage away.
        explorerElement.current?.querySelector<HTMLElement>('.observatory-views button[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
      if (pendingFocus.current === "chapter") {
        explorerElement.current?.querySelector<HTMLElement>('.explorer-chapters button[aria-pressed="true"]')?.focus({ preventScroll: true });
        explorerElement.current?.querySelector(".explorer-scene")?.scrollIntoView({ behavior: "instant", block: "start" });
      } else if (pendingFocus.current === "pattern") {
        const inset = heading ? parseFloat(getComputedStyle(heading).scrollMarginBlockStart) || 0 : 0;
        const top = Math.max(inset, readerElement.current?.getBoundingClientRect().top ?? 0);
        const bottom = Math.min(window.innerHeight, readerElement.current?.getBoundingClientRect().bottom ?? window.innerHeight);
        const candidates = readerElement.current?.querySelectorAll<HTMLElement>("[data-reader-heading], .explorer-passage p, button:not(:disabled), select:not(:disabled), a[href]") ?? [];
        const visible = [...candidates].find((element) => {
          const box = element?.getBoundingClientRect();
          return box && box.bottom > top && box.top < bottom;
        });
        (visible ?? heading)?.focus({ preventScroll: true });
      } else if (pendingFocus.current === "heading") {
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
    previousSkyView.current = skyView;
    previousComparison.current = comparing;
  }, [state, chapter?.id, scrollKey, skyView, comparing]);
  const present = (presentation: "reading" | "scene" | "full") => {
    if (presentation === "scene") { restoreExpandedFocus.current = true; setSecondaryOpen(false); }
    dispatch({ type: "presentation", presentation });
  };
  const readChapter = () => {
    if (comparing && presentation !== "scene") {
      const heading = readerElement.current?.querySelector<HTMLElement>("[data-reader-heading]");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ behavior: "instant", block: "start" });
      return;
    }
    if (presentation === "scene") restoreExpandedFocus.current = false;
    dispatch([
      ...(skyView || presentation === "scene" ? returnActions((snapshot) => snapshot.sky !== null || snapshot.presentation === "scene") : []),
      ...(!chapter ? [{ type: "select" as const, chapterId: manifest.chapters[0].id }] : []),
      { type: "presentation", presentation: "reading" },
    ]);
  };
  const passageLink = (chapterId: string) => `${facetLabel} · Read passage ${(state.passages[chapterId] ?? 0) + 1}`;
  const chapterRail = <nav aria-label="Pattern chapters" className="explorer-chapters">{manifest.chapters.map((item) => {
    const active = selectedIds.includes(item.id);
    return <button key={item.id} data-chapter-id={item.id} aria-pressed={active} onClick={() => active ? annotation(item.id) : select(item.id)}><span className="explorer-chapter-number" aria-hidden="true">{String(item.ordinal).padStart(2, "0")}</span><span><span className="explorer-sr-only">{item.ordinal}. </span>{item.title}{" "}{active && <span className="explorer-comparison-link">{passageLink(item.id)}</span>}</span></button>;
  })}</nav>;
  const comparisonRail = <nav aria-label="Compared chapters" className="explorer-chapters explorer-compared-chapters">{selected.map(item => <button key={item.id} data-chapter-id={item.id} onClick={() => annotation(item.id)}><span className="explorer-chapter-number" aria-hidden="true">{String(item.ordinal).padStart(2, "0")}</span><span>{item.title}{" "}<span className="explorer-comparison-link">{passageLink(item.id)}</span></span></button>)}</nav>;
  const scenePanel = <div className={`explorer-visual${compactExpanded ? " explorer-compact-expanded" : ""}`}>
    <div className="explorer-scene" aria-label="Interactive Pattern portrait">
      {!comparing && <div className="explorer-scene-top"><button onClick={() => {
        if (skyView) returnPattern(); else { dispatch({ type: "whole" }); issueCommand("frame"); }
      }} title={skyView ? undefined : "Show all chapter displays in the current layout"} aria-pressed={!skyView && state.view.kind === "whole"}>{skyView ? "Back to Pattern" : "Whole portrait"}</button><button disabled={!graphicsAvailable || skyView} title={state.unfolded ? "Bring all displays together and show the whole court" : "Separate all displays and show the whole court"} onClick={() => { dispatch({ type: "unfold", overview: true }); issueCommand("frame"); }}>{state.unfolded ? "Reassemble" : "Unfold portrait"}<span aria-hidden="true">{state.unfolded ? " ↙" : " ↗"}</span></button></div>}
      {validMeshes && <SceneBoundary key={JSON.stringify([retry, sky])} onFailure={(error) => { setModuleFailed(error instanceof SceneModuleError); setStatus("unavailable"); }}><Suspense fallback={null}><PortraitScene assets={meshBundle?.assets ?? EMPTY_ASSETS} chapters={manifest.chapters}
        selectedIds={selectedIds} facet={facet} activePassages={state.passages}
        unfolded={state.unfolded} reducedMotion={reducedMotion} expanded={presentation === "scene"} quality={quality}
        experience={experience} onOperate={operate}
        sky={sky} sunSign={manifest.sunSign} skyView={skyView} selectedSkyBody={selectedSkyBody} onSelectSkyBody={openSky}
        viewKey={viewKey} bookmark={bookmarks.current.get(viewKey)} command={command} onBookmark={onBookmark}
        onSelect={comparing ? annotation : select} onAnnotation={annotation} onStatus={setStatus} onArtworkFallback={setArtworkFallback} /></Suspense></SceneBoundary>}
      {(!validMeshes || status === "unavailable") && <div className="explorer-scene-message" role="status"><p>{moduleFailed ? "The 3D view could not be loaded." : "The portrait is taking a pause."}</p><p>{moduleFailed ? "Reload the page to fetch the current 3D view. Your saved chapters are still available." : "Your saved chapters are ready to read."}</p><div className="explorer-recovery-actions">{validMeshes && (moduleFailed
        ? <button onClick={() => window.location.reload()}>Reload page for 3D</button>
        : <button onClick={() => { setPortraitScene(() => lazy(loadScene)); setStatus("loading"); setRetry((value) => value + 1); }}>Try 3D again</button>)}<button onClick={readChapter}>Continue reading</button></div></div>}
      {validMeshes && status === "loading" && <p className="explorer-loading" role="status">Preparing your observatory…</p>}
      <div className="explorer-scene-toolbar" role="group" aria-label="3D controls" tabIndex={0} onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !graphicsAvailable) return;
        const key = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "closer", "-": "farther", Home: "reset" }[event.key] as CameraCommand["kind"] | undefined;
        if (key) { event.preventDefault(); issueCommand(key); }
      }}>
        <button disabled={!graphicsAvailable} aria-label="Rotate left" title="Rotate left" onClick={() => issueCommand("left")}><SceneIcon name="left" /></button>
        <button disabled={!graphicsAvailable} aria-label="Rotate right" title="Rotate right" onClick={() => issueCommand("right")}><SceneIcon name="right" /></button><span className="explorer-toolbar-divider" />
        <button disabled={!graphicsAvailable} aria-label="Zoom out" title="Zoom out" onClick={() => issueCommand("farther")}><SceneIcon name="minus" /></button>
        <button disabled={!graphicsAvailable} aria-label="Zoom in" title="Zoom in" onClick={() => issueCommand("closer")}><SceneIcon name="plus" /></button>
        <button disabled={!graphicsAvailable} aria-label="Reset view" title={skyView ? "Refit the sky" : comparing ? "Refit both chapter displays" : chapter ? "Refit the current chapter view" : "Refit the whole court"} onClick={() => issueCommand("reset")}><span className="explorer-mobile-icon"><SceneIcon name="home" /></span><span className="explorer-control-text">Reset view</span></button>
        {presentation !== "scene" && <button ref={expandButton} disabled={!validMeshes || status === "unavailable"} className="explorer-expand" aria-label="Expand scene" title="Expand scene" onClick={() => present("scene")}><span className="explorer-mobile-icon"><SceneIcon name="expand" /></span><span className="explorer-control-text">Expand scene</span></button>}
      </div>
    </div>
    <div className="explorer-scene-support">
      {artworkFallback && <p role="status">Some chapter artwork could not be displayed. Reading stations are shown instead.</p>}
      {compactExpanded && <button className="explorer-text-button" onClick={readChapter}>Read chapter</button>}
      {skyView ? <SkyPlacements sky={sky} sunSign={manifest.sunSign} selected={selectedSkyBody} onSelect={openSky} /> : comparing ? comparisonRail : chapterRail}
      <details className="explorer-secondary-controls" open={secondaryOpen} onToggle={(event) => setSecondaryOpen(event.currentTarget.open)}>
        <summary>Scene options</summary>
        {!comparing && <ObservatoryControls experience={experience} onChange={changeExperience} available={graphicsAvailable} skyView={skyView}
          chapterCount={manifest.chapters.length}
          chapterId={!skyView && selectedIds.length === 1 ? chapter?.id : undefined} onOperate={() => chapter && operate(chapter.id)} />}
        <details className="explorer-settings"><summary>Scene controls &amp; motion</summary><div><p>{graphicsAvailable ? "Drag horizontally to rotate. Scroll the page with one finger. In the expanded scene, pinch to zoom or use the camera buttons. Each object also has a named chapter button. Reset view refits the current view. Whole portrait keeps the current layout; Unfold and Reassemble show all displays. If the roof hides an object, use Cut away roof." : "Your reading is available while graphics are paused. You can adjust motion and graphics before trying 3D again."}</p><div className="explorer-setting-actions"><button disabled={!graphicsAvailable} onClick={() => issueCommand("up")}>Tilt up</button><button disabled={!graphicsAvailable} onClick={() => issueCommand("down")}>Tilt down</button></div><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><label>Graphics <select value={quality} onChange={(event) => setQuality(event.target.value as "standard" | "low")}><option value="standard">Standard</option><option value="low">Low power</option></select></label></div></details>
      </details>
      {!skyView && !comparing && <div className="explorer-visual-footer"><span>Choose a chapter to explore its reading.</span><button data-start-guide className="explorer-text-button" onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide" }); }}>Guide me through <span aria-hidden="true">→</span></button></div>}
    </div>
  </div>;
  const ReaderHeading = embedded ? "h3" : "h2";
  const reader = <div className="explorer-reader-shell"><aside id={readerId} ref={readerElement} tabIndex={0} className="explorer-reader" aria-label={skyView ? "Birth-chart reading" : "Chapter reading"} onScroll={(event) => { readerPositions.current.set(readerKey, event.currentTarget.scrollTop); }}><div className="explorer-reader-content">
    {manifest.uncertainty && <p className="explorer-uncertainty">{manifest.uncertainty}</p>}
    {skyView ? <SkyReader sky={sky} sunSign={manifest.sunSign} selected={selectedSkyBody} embedded={embedded} graphicsAvailable={graphicsAvailable}
      onPattern={() => returnPattern(true)} /> : chapter ? <>
      {state.view.kind === "guided" && <div className="explorer-guide"><span>Guided exploration · Stop {state.view.step + 1} of {manifest.chapters.length}</span><button onClick={() => endView("guided")}>Exit guide</button></div>}
      <ExplorerReader embedded={embedded} chapterCount={manifest.chapters.length} chapters={selected} facet={facet} activePassages={state.passages} onFacet={(value) => dispatch({ type: "facet", facet: value })}
        onPassage={showPassage} passageRef={bindPassage} graphicsAvailable={graphicsAvailable} />
      {state.view.kind === "guided" ? <div className="explorer-next"><button disabled={state.view.step === 0} onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step - 1 : 0 }); }}>Previous stop</button>{state.view.step < manifest.chapters.length - 1 ? <button onClick={() => { pendingFocus.current = "heading"; dispatch({ type: "guide-step", step: state.view.kind === "guided" ? state.view.step + 1 : 0 }); }}>Next stop</button> : <button onClick={() => endView("guided")}>Finish exploration</button>}</div>
        : state.view.kind === "chapter" && <button className="explorer-next-chapter" onClick={() => select(manifest.chapters[chapter.ordinal % manifest.chapters.length].id, true)}><span>Next chapter</span><strong>{manifest.chapters[chapter.ordinal % manifest.chapters.length].title} <span aria-hidden="true">→</span></strong></button>}
    </> : <div className="explorer-introduction"><ReaderHeading data-reader-heading tabIndex={-1}>Your Pattern, in {manifest.chapters.length} chapters</ReaderHeading>
      <p>Each reading station opens a saved chapter, with its tensions, resources, and another expression. Choose a station or its chapter name to explore.</p><button className="explorer-primary" onClick={() => select(manifest.chapters[0].id, "scene")}>Explore the first chapter <span aria-hidden="true">→</span></button>
      <p className="explorer-intro-note">Your birth chart supplies the placements. Your saved Pattern supplies the reading.</p></div>}
  </div></aside>
    {!skyView && chapter && <ReaderFooter readerRef={readerElement} readerId={readerId} contentKey={`${readerKey}:${presentation}`} reducedMotion={reducedMotion}>
      <div className="explorer-reader-actions">{chapter.object && <button className="explorer-text-button" onClick={() => dispatch({ type: "inspect", open: true })}>Inspect original image <span aria-hidden="true">↗</span></button>}
        {state.view.kind === "chapter" && <label className="explorer-compare-label"><span className="explorer-sr-only">Compare with another chapter</span><select aria-label="Compare with another chapter" value="" onChange={(event) => { pendingFocus.current = "compare-start"; dispatch({ type: "compare", chapterId: event.target.value }); }}><option value="" disabled>Compare with…</option>{manifest.chapters.filter((item) => item.id !== chapter.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>
    </ReaderFooter>}
  </div>;
  const Root = embedded ? "section" : "main";
  const observatoryViews = <nav className="observatory-views" aria-label="Observatory views"><button aria-pressed={!skyView} onClick={() => returnPattern()}>Your Pattern</button><button aria-pressed={skyView} onClick={() => openSky()}>Your sky</button></nav>;
  const fullReadingControl = <button ref={fullReadingButton} onClick={() => presentation === "full" ? back() : present("full")}>{presentation === "full" ? "Return to portrait" : "Full reading"}<span aria-hidden="true"> ↗</span></button>;
  return <Root onFocusCapture={(event) => { lastFocused.current = event.target as HTMLElement; }} ref={explorerElement} id="portrait-start" tabIndex={-1} aria-label="Pattern portrait explorer" className={`portrait-explorer observatory-explorer${skyView ? " observatory-sky" : ""}${comparing ? " explorer-comparing" : ""}${embedded ? " explorer-embedded" : ""} explorer-presentation-${presentation}`}>
    <span className="explorer-sr-only" aria-live="polite" aria-atomic="true">{presentation === "full" ? `Full Pattern reading. ${manifest.chapters.length} chapters available.` : skyView ? `Your sky. ${skyAnnouncement}` : selected.length ? selected.map(item => `${item.title}. ${facetLabel}, passage ${(state.passages[item.id] ?? 0) + 1}.`).join(" ") : `Whole portrait. ${manifest.chapters.length} chapters available.`}</span>
    {embedded ? <nav className="explorer-embedded-bar" aria-label="Portrait navigation"><button onClick={navigation.close}>Back to reading</button>{fullReadingControl}</nav> : (<header className="explorer-header"><a href="#portrait-start" className="explorer-wordmark" onClick={(event) => { event.preventDefault(); document.getElementById("portrait-start")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" }); }}>Pattern<span>/</span>Like</a><div><span className="explorer-study-label">{!meshBundle ? "Your Pattern" : meshBundle.authoring === "codex-parametric/v1" ? "Private portrait" : "Fictional study"}</span>{fullReadingControl}</div></header>)}

    {presentation === "full" ? <CompleteReading manifest={manifest} embedded={embedded} /> : <>
      <div className="explorer-title">{embedded ? <h2>Your zodiac observatory</h2> : <h1>Your zodiac observatory.</h1>}
        {presentation !== "reading" && !comparing && observatoryViews}
      </div>
      <div className="explorer-mobile-modes">{comparing ? <button data-end-comparison onClick={() => endView("compare")}>End comparison</button> : <button aria-pressed={presentation === "explore"} onClick={() => presentation !== "explore" && back()}>{presentation === "reading" ? "Return to portrait" : "Explore"}</button>}<button ref={readButton} aria-pressed={comparing ? undefined : presentation === "reading"} onClick={readChapter}>{comparing ? "Read both chapters" : "Read chapter"}</button>
        {comparing && <button onClick={() => { explorerElement.current?.querySelector<HTMLElement>(".explorer-compared-chapters button")?.focus({ preventScroll: true }); explorerElement.current?.querySelector(".explorer-scene")?.scrollIntoView({ behavior: "instant", block: "start" }); }}>View objects</button>}
        {(presentation === "reading" || comparing) && chapter && <p className="explorer-reading-identity">{selected.map((item) => item.title).join(" · ")}</p>}
        {(presentation === "reading" || comparing) && observatoryViews}
      </div>
      <div className={`explorer-workspace${!skyView && selected.length === 2 ? " explorer-is-comparing" : ""}`}>{presentation !== "scene" && scenePanel}{reader}</div>
      {presentation === "scene" && <Modal label="Expanded portrait scene" className="explorer-expanded-dialog" onClose={closeScene} restoreFocus={() => restoreExpandedFocus.current}><div className="explorer-dialog-heading"><h2>Portrait scene</h2><button onClick={closeScene}>Close expanded scene</button></div>{scenePanel}</Modal>}
    </>}
    {state.inspectImage && chapter?.object && <Modal label="Original chapter image" onClose={() => dispatch({ type: "inspect", open: false })}><div className="explorer-dialog-heading"><div><p className="explorer-eyebrow">Original chapter image</p><h2>{chapter.object.label}</h2></div><button onClick={() => dispatch({ type: "inspect", open: false })}>Close image</button></div><img src={chapter.object.imageUrl} alt={chapter.object.label} /><h3>Visual metaphor</h3><p>{chapter.object.rationale}</p><p className="explorer-image-source">{chapter.title} · Image reference {chapter.object.referenceId}</p></Modal>}
    {!embedded && <footer className="explorer-footer"><span>{!meshBundle ? "Reading stations for your saved chapters." : meshBundle.authoring === "codex-parametric/v1" ? "Four objects created from your chapters and their saved images." : "Four authored models based on the fictional chapter images."}</span><span>Personal meaning stays in the reading.</span></footer>}
  </Root>;
}
