import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PatternPortraitExplorerResponse, PatternResponseV7, PatternStatePattern } from "@patternlike/shared";
import { ApiError, downloadPatternPortraitExplorer, getPatternPortraitExplorer, getPatternPortraitImage, getPatternPortraitModel } from "../lib/api-client.js";
import { bindingsFor, validateResponse, verifyImage } from "../lib/account-portrait.js";
import { selectReaderReadiness } from "../lib/reader-readiness.js";
import { ReaderReadiness, useReaderScope } from "./ReaderReadiness.js";
import { withRequestId } from "../lib/api-status.js";
import { patternMatchesDocument, type PortraitObjectBinding } from "../lib/pattern-portrait.js";
import type { PortraitSky } from "../lib/portrait-sky.js";
import { PortraitExplorer } from "./portrait-explorer/PortraitExplorer.js";
import { useExplorerNavigation } from "./portrait-explorer/use-explorer-navigation.js";
import { usePortraitSession } from "./portrait-explorer/portrait-session.js";
import type { PortraitMeshAsset, PortraitMeshBundle } from "./portrait-explorer/types.js";

interface Props {
  chartId: string; document: PatternResponseV7; pattern: PatternStatePattern;
  sky?: PortraitSky | null;
  canCreate: boolean; onUnauthorized: () => void; children: ReactNode;
  /** Passed only after an exact relationship target has been server validated. */
  initialChapterIndex?: number;
  defaultOpen?: boolean;
}
interface LoadedPortrait { identity: string; bindings: PortraitObjectBinding[]; bundle: PortraitMeshBundle; }
const mismatch = "This 3D portrait no longer matches the current Pattern. Refresh its status to continue.";
const isHash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function validate(response: PatternPortraitExplorerResponse, chartId: string, document: PatternResponseV7): void {
  if (response.schema_version !== "pattern-portrait-explorer/v1"
    || !["unavailable", "not_started", "generating", "failed", "ready"].includes(response.status)
    || !Number.isInteger(response.completed_models) || response.completed_models < 0 || response.completed_models > 4
    || typeof response.retryable !== "boolean"
    || !Array.isArray(response.models)) throw new Error("This 3D portrait format is not supported.");
  if (response.status === "unavailable") return;
  validateResponse(response.portrait, chartId, document);
  if (response.status !== "ready") return;
  if (response.portrait.status !== "ready" || response.completed_models !== 4 || response.models.length !== 4
    || new Set(response.models.map((model) => model.chapter_id)).size !== 4
    || new Set(response.models.map((model) => model.reference_id)).size !== 4) throw new Error(mismatch);
  for (const model of response.models) {
    const chapter = response.portrait.chapters.find((chapter) => chapter.chapter_id === model.chapter_id);
    if (!chapter || model.source_text !== chapter.source_text || model.source_image_sha256 !== chapter.reference_sha256
      || model.document_revision !== response.portrait.document_revision || model.authoring !== "codex-parametric/v1"
      || model.compiler_version !== "portrait-mesh-compiler/v1" || typeof model.reference_id !== "string" || !model.reference_id.trim()
      || ![model.sha256, model.source_image_sha256, model.source_text_sha256, model.program_sha256].every(isHash)) throw new Error(mismatch);
  }
}

export function AccountPortraitExplorer({ chartId, document, pattern, onUnauthorized, children, sky, initialChapterIndex, defaultOpen }: Props) {
  const accountScope = useReaderScope();
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const requestGeneration = useRef(0);
  const sourceMatches = patternMatchesDocument(pattern, document);
  const canRender = sourceMatches && document.core_chapters.length >= 3 && document.core_chapters.length <= 6;
  // The v1 generated-artwork service is optional and supports four chapters.
  // Its eligibility must never gate the locally rendered observatory.
  const artworkEligible = sourceMatches && document.core_chapters.length === 4;
  const [response, setResponse] = useState<PatternPortraitExplorerResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = usePortraitSession(JSON.stringify([chartId, document]));
  const navigation = useExplorerNavigation(document.core_chapters.map((_, index) => `chapter-${index + 1}`), {
    embedded: true, defaultOpen: defaultOpen ?? canRender, memory: session.memory,
    initialActions: initialChapterIndex !== undefined && Number.isInteger(initialChapterIndex) && document.core_chapters[initialChapterIndex]
      ? [{ type: "select", chapterId: `chapter-${initialChapterIndex + 1}` }, { type: "presentation", presentation: "reading" }]
      : undefined,
  });
  const { isOpen: open, open: openExplorer, close: closeExplorer } = navigation;
  const [loaded, setLoaded] = useState<LoadedPortrait | null>(null);
  const [assetError, setAssetError] = useState(false);
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const statusRequest = useRef<AbortController | null>(null);
  const assetRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const ownedUrls = useRef(new Set<string>());
  const artifactUrls = useRef<string[]>([]);
  const artifactIdentity = useRef<string | null>(null);
  const contentElement = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const previousOpen = useRef(open);
  const initialOpening = useRef(true);
  const opened = useRef(open); opened.current = open;
  const discardArtifacts = useCallback(() => {
    assetRequest.current?.abort(); assetRequest.current = null;
    session.verified = null;
    for (const url of artifactUrls.current) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
    artifactUrls.current = []; artifactIdentity.current = null; setLoaded(null);
  }, [session]);
  const returnToReading = useCallback(() => {
    if (opened.current) pendingFocus.current = true;
    closeExplorer(); discardArtifacts();
  }, [closeExplorer, discardArtifacts]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const report = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { returnToReading(); onUnauthorized(); }
    else setError(cause instanceof Error ? withRequestId(cause.message, cause instanceof ApiError ? cause.requestId : null) : "Your portrait could not be loaded.");
  }, [onUnauthorized, returnToReading]);
  useEffect(() => {
    if (!artworkEligible) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController(); statusRequest.current = controller;
    void getPatternPortraitExplorer(controller.signal).then((next) => {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      validate(next, chartId, document);
      setObservedAt(Date.now());
      if (session.verified && session.verified.identity !== JSON.stringify(next)) session.verified = null;
      if (next.status !== "ready") discardArtifacts();
      else if (artifactIdentity.current && artifactIdentity.current !== JSON.stringify(next)) discardArtifacts();
      setResponse((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setError(null);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setResponse(null); discardArtifacts();
      if (!(cause instanceof ApiError && [404, 503].includes(cause.status))) report(cause);
    }).finally(() => { if (statusRequest.current === controller) statusRequest.current = null; });
    return () => { controller.abort(); if (statusRequest.current === controller) statusRequest.current = null; };
  }, [artworkEligible, chartId, document, attempt, report, returnToReading, discardArtifacts, session]);
  useEffect(() => {
    if (response?.status !== "generating" && !response?.retryable) return;
    const poll = () => { if (globalThis.document.visibilityState === "visible" && !statusRequest.current) refresh(); };
    const timer = window.setInterval(poll, 3000);
    globalThis.document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); globalThis.document.removeEventListener("visibilitychange", poll); };
  }, [response?.status, response?.retryable, refresh]);

  const saved = response?.status === "ready" ? response : null;
  const identity = saved ? JSON.stringify(saved) : null;
  // The source object stays stable while private images and models are hydrated.
  const source = useMemo(() => ({ status: "ready" as const, document, sunSign: saved?.portrait.sun_sign ?? null }), [document, saved?.portrait.sun_sign]);
  useEffect(() => {
    if (!saved || !open || loaded?.identity === identity) return;
    const controller = new AbortController(); assetRequest.current = controller; setAssetError(false);
    // Reuse only fully verified bytes after the current authenticated status
    // response passed validation. Object URLs still belong to this mount.
    const artifacts = session.verified?.identity === identity ? Promise.resolve(session.verified.artifacts)
      : import("./portrait-explorer/scene-utils.js").then(({ verifyGlbAsset }) => {
      controller.signal.throwIfAborted();
      return Promise.all(saved.portrait.chapters.map(async (chapter) => {
        const model = saved.models.find((model) => model.chapter_id === chapter.chapter_id)!;
        const asset: PortraitMeshAsset = { chapterId: model.chapter_id, url: "", sha256: model.sha256,
          sourceImageSha256: model.source_image_sha256, sourceText: model.source_text,
          provenance: { authoring: "codex-parametric/v1", documentRevision: model.document_revision,
            sourceTextSha256: model.source_text_sha256, programSha256: model.program_sha256, compilerVersion: "portrait-mesh-compiler/v1" } };
        const [image, mesh] = await Promise.all([
          getPatternPortraitImage(chapter.reference_id, controller.signal).then((blob) => verifyImage(blob, chapter.reference_sha256, controller.signal)),
          getPatternPortraitModel(model.reference_id, controller.signal),
        ]);
        const bytes = await mesh.arrayBuffer(); controller.signal.throwIfAborted();
        await verifyGlbAsset(bytes, model.sha256, model.chapter_id, asset); controller.signal.throwIfAborted();
        return { image, mesh, asset };
      }));
    });
    void artifacts.then((artifacts) => {
      controller.signal.throwIfAborted();
      session.verified = { identity: identity!, artifacts };
      const nextUrls: string[] = [];
      const own = (blob: Blob) => { const url = URL.createObjectURL(blob); nextUrls.push(url); ownedUrls.current.add(url); return url; };
      try {
        const imageUrls = artifacts.map(({ image }) => own(image));
        const assets = artifacts.map(({ mesh, asset }) => ({ ...asset, url: own(mesh) }));
        for (const url of artifactUrls.current) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
        artifactUrls.current = nextUrls; artifactIdentity.current = identity;
        setLoaded({ identity: identity!, bindings: bindingsFor(saved.portrait, imageUrls), bundle: {
          version: "portrait-mesh-1", authoring: "codex-parametric/v1", documentRevision: saved.portrait.document_revision!, assets,
        } });
      } catch (cause) {
        for (const url of nextUrls) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
        throw cause;
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      controller.abort();
      if (cause instanceof ApiError && cause.status === 401) report(cause); else setAssetError(true);
    });
    return () => { controller.abort(); if (assetRequest.current === controller) assetRequest.current = null; };
  }, [saved, identity, open, loaded?.identity, assetAttempt, report, session]);
  useEffect(() => () => {
    downloadRequest.current?.abort();
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    ownedUrls.current.clear();
  }, []);
  const download = async () => {
    if (!saved || downloadRequest.current) return;
    const controller = new AbortController(); downloadRequest.current = controller; setDownloading(true); setError(null);
    try {
      const blob = await downloadPatternPortraitExplorer({ chart_id: chartId, pattern_id: document.pattern_id, generated_at: document.generated_at }, controller.signal);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob); ownedUrls.current.add(url);
      const anchor = globalThis.document.createElement("a"); anchor.href = url; anchor.download = "pattern-portrait-complete.json"; anchor.click();
      window.setTimeout(() => { if (ownedUrls.current.delete(url)) URL.revokeObjectURL(url); }, 1000);
    } catch (cause) { if (!controller.signal.aborted) report(cause); }
    finally { if (downloadRequest.current === controller) downloadRequest.current = null; if (!controller.signal.aborted) setDownloading(false); }
  };

  const showingExplorer = sourceMatches && open;
  const verified = loaded?.identity === identity ? loaded : null;
  useLayoutEffect(() => {
    if (initialOpening.current && open) {
      initialOpening.current = false;
      if (!pendingFocus.current && initialChapterIndex === undefined) { previousOpen.current = open; return; }
    }
    if (previousOpen.current !== open) pendingFocus.current = true;
    previousOpen.current = open;
    if (!pendingFocus.current || (open && !showingExplorer)) return;
    const target = showingExplorer
      ? contentElement.current?.querySelector<HTMLElement>(initialChapterIndex === undefined ? "#portrait-start" : "[data-reader-heading]")
      : initialChapterIndex === undefined ? contentElement.current : contentElement.current?.querySelector<HTMLElement>(`[data-reading-chapter="chapter-${initialChapterIndex + 1}"]`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: "instant", block: "start" });
    pendingFocus.current = false;
  }, [open, showingExplorer, initialChapterIndex]);

  const scope = { ...accountScope, chartId, source: `${document.pattern_id}:${document.generated_at}` };
  const artwork = selectReaderReadiness({ scope, requestGeneration: requestGeneration.current, now: Date.now(), chapterCount: document.core_chapters.length,
    artwork: response && observedAt !== null ? { scope, requestGeneration: requestGeneration.current, observedAt, evidence: "known", value: response } : null }).artwork;
  if (!canRender) return <>{children}</>;
  return <>
    {!open && <button type="button" className="button button--primary" onClick={() => { pendingFocus.current = true; openExplorer(); }}>Explore your 3D portrait</button>}
    <div ref={contentElement} tabIndex={-1}>{showingExplorer ? <PortraitExplorer source={source} objectBindings={verified?.bindings} meshBundle={verified?.bundle} navigation={navigation} sky={sky?.chartId === chartId ? sky : null} /> : children}</div>
    {artwork.code !== "ready" && <ReaderReadiness presentation={artwork} onAction={artworkEligible ? () => refresh() : undefined} />}
    {error && <div className="account-portrait__status" role="alert"><p>{error}</p><button type="button" onClick={refresh}>Retry artwork</button></div>}
    {open && saved && !verified && (assetError
      ? <p className="account-portrait__status" role="alert">Your saved artwork could not be loaded. Reading stations are shown instead. <button type="button" onClick={() => setAssetAttempt((value) => value + 1)}>Retry portrait loading</button></p>
      : <p className="account-portrait__status" role="status">Loading your saved artwork.</p>)}
    {saved && <div className="account-portrait__utility"><button type="button" disabled={downloading} onClick={() => void download()}>{downloading ? "Preparing download…" : "Download complete portrait"}</button></div>}
  </>;
}
