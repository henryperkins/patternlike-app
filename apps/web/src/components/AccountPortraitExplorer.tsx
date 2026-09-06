import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PatternPortraitExplorerResponse, PatternResponseV7, PatternStatePattern } from "@patternlike/shared";
import { ApiError, downloadPatternPortraitExplorer, getPatternPortraitExplorer, getPatternPortraitImage, getPatternPortraitModel } from "../lib/api-client.js";
import { bindingsFor, validateResponse, verifyImage } from "../lib/account-portrait.js";
import { withRequestId } from "../lib/api-status.js";
import { patternMatchesDocument, type PortraitObjectBinding } from "../lib/pattern-portrait.js";
import { PortraitAutomationControl } from "./PortraitAutomationControl.js";
import { PortraitExplorer } from "./portrait-explorer/PortraitExplorer.js";
import type { PortraitMeshAsset, PortraitMeshBundle } from "./portrait-explorer/types.js";

interface Props {
  chartId: string; document: PatternResponseV7; pattern: PatternStatePattern;
  canCreate: boolean; onUnauthorized: () => void; children: ReactNode; legacy: ReactNode;
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

export function AccountPortraitExplorer({ chartId, document, pattern, canCreate, onUnauthorized, children, legacy }: Props) {
  const sourceMatches = patternMatchesDocument(pattern, document);
  const eligible = sourceMatches && document.core_chapters.length === 4;
  const [response, setResponse] = useState<PatternPortraitExplorerResponse | null>(null);
  const [useLegacy, setUseLegacy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
  const opened = useRef(open); opened.current = open;
  const discardArtifacts = useCallback(() => {
    assetRequest.current?.abort(); assetRequest.current = null;
    for (const url of artifactUrls.current) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
    artifactUrls.current = []; artifactIdentity.current = null; setLoaded(null);
  }, []);
  const returnToReading = useCallback(() => {
    if (opened.current) pendingFocus.current = true;
    setOpen(false); discardArtifacts();
  }, [discardArtifacts]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const report = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) { returnToReading(); onUnauthorized(); }
    else setError(cause instanceof Error ? withRequestId(cause.message, cause instanceof ApiError ? cause.requestId : null) : "Your portrait could not be loaded.");
  }, [onUnauthorized, returnToReading]);
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController(); statusRequest.current = controller;
    void getPatternPortraitExplorer(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      validate(next, chartId, document);
      if (next.status !== "ready") returnToReading();
      else if (artifactIdentity.current && artifactIdentity.current !== JSON.stringify(next)) discardArtifacts();
      setResponse((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setUseLegacy(next.status === "unavailable"); setError(null);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setResponse(null); returnToReading();
      if (cause instanceof ApiError && [404, 503].includes(cause.status)) setUseLegacy(true);
      else report(cause);
    }).finally(() => { if (statusRequest.current === controller) statusRequest.current = null; });
    return () => { controller.abort(); if (statusRequest.current === controller) statusRequest.current = null; };
  }, [eligible, chartId, document, attempt, report, returnToReading, discardArtifacts]);
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
    void import("./portrait-explorer/scene-utils.js").then(({ verifyGlbAsset }) => {
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
    }).then((artifacts) => {
      controller.signal.throwIfAborted();
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
  }, [saved, identity, open, loaded?.identity, assetAttempt, report]);
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

  const showingExplorer = Boolean(open && saved && loaded?.identity === identity);
  useLayoutEffect(() => {
    if (!pendingFocus.current || (open && !showingExplorer)) return;
    contentElement.current?.focus({ preventScroll: true });
    pendingFocus.current = false;
  }, [open, showingExplorer, useLegacy]);

  if (!sourceMatches) return <>{children}</>;
  if (!eligible) return <><PortraitAutomationControl chartId={chartId} canEnable={canCreate} onUnauthorized={onUnauthorized} onChanged={refresh} /><p>3D portraits currently support four-chapter Patterns. Your complete reading is available below.</p>{children}</>;
  if (useLegacy) return <><PortraitAutomationControl chartId={chartId} canEnable={canCreate} onUnauthorized={onUnauthorized} onChanged={refresh} /><div ref={contentElement} tabIndex={-1}>{legacy}</div></>;
  return <>
    <section className="account-portrait" aria-label="Your 3D portrait">
      <div className="account-portrait__heading"><p className="kicker">Your 3D portrait</p><h3>Four chapters, a shape of your own</h3></div>
      <PortraitAutomationControl chartId={chartId} canEnable={canCreate} onUnauthorized={onUnauthorized} onChanged={refresh} />
      {!response && !error && <p role="status">Checking your saved portrait.</p>}
      {response?.status === "not_started" && <p>Choose automatic portraits above to turn this Pattern into four objects you can explore. Your reading is ready below.</p>}
      {response?.status === "generating" && <><p role="status">Creating your portrait · {response.portrait.completed_chapters} of 4 images · {response.completed_models} of 4 models saved.</p><p>You can keep reading or leave and return. Each model is checked against its chapter image before it is saved.</p></>}
      {response?.status === "failed" && <><p role="status">Your 3D portrait could not be completed. {response.completed_models} of 4 models are saved.</p><p>Your complete reading remains available. Saved images and completed models are retained.</p></>}
      {saved && <>
        <p>Your four objects are saved privately with this Pattern. Exploring them reuses the saved models.</p>
        <div className="account-portrait__actions"><button type="button" className="button" aria-expanded={open} onClick={() => { pendingFocus.current = true; setOpen((value) => !value); }}>{open ? "Back to reading" : "Explore your 3D portrait"}</button>
          <button type="button" className="button button--secondary" disabled={downloading} onClick={() => void download()}>{downloading ? "Preparing download…" : "Download complete portrait"}</button></div>
        <p className="account-portrait__detail">The private download includes your complete reading, four images, four 3D models, and their saved source records. It is separate from your account data export.</p>
      </>}
      {error && <div role="alert"><p>{error}</p><button type="button" className="button button--secondary" onClick={refresh}>Refresh portrait status</button></div>}
      {open && saved && loaded?.identity !== identity && (assetError ? <p role="alert">Your saved portrait could not be loaded. Your reading is still available. <button type="button" onClick={() => setAssetAttempt((value) => value + 1)}>Retry portrait loading</button></p> : <p role="status">Loading your saved images and 3D models.</p>)}
    </section>
    <div ref={contentElement} tabIndex={-1}>{showingExplorer && loaded ? <PortraitExplorer source={source} objectBindings={loaded.bindings} meshBundle={loaded.bundle} />
      : response?.portrait.status === "ready" && !saved ? legacy : children}</div>
  </>;
}
