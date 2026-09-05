import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PORTRAIT_CONSENT_POLICY_VERSION, PORTRAIT_SCHEMA_VERSION, isPortraitGraph, type PatternPortraitResponse, type PatternResponseV7, type PatternStatePattern } from "@patternlike/shared";
import { ApiError, downloadPatternPortrait, getPatternPortrait, getPatternPortraitImage, newIdempotencyKey, startPatternPortraitGeneration } from "../lib/api-client.js";
import { createPortraitManifest, patternMatchesDocument, type PortraitObjectBinding } from "../lib/pattern-portrait.js";
import { withRequestId } from "../lib/api-status.js";
import { PatternPortrait } from "./PatternPortrait.js";
import "./account-pattern-portrait.css";

interface AccountPatternPortraitProps {
  chartId: string;
  document: PatternResponseV7;
  pattern: PatternStatePattern;
  canCreate: boolean;
  onUnauthorized: () => void;
  children: ReactNode;
}

const mismatchMessage = "This constellation no longer matches the current Pattern. Refresh its status to continue.";

function bindingsFor(response: PatternPortraitResponse, urls: readonly string[] = []): PortraitObjectBinding[] {
  return response.chapters.map((chapter, index) => ({
    documentRevision: response.document_revision!, chapterId: chapter.chapter_id, sourceText: chapter.source_text,
    object: { label: chapter.label, rationale: chapter.rationale, referenceId: chapter.reference_id, referenceSha256: chapter.reference_sha256, imageUrl: urls[index] ?? "" },
  }));
}

function validateResponse(response: PatternPortraitResponse, chartId: string, document: PatternResponseV7): void {
  if (response.schema_version !== PORTRAIT_SCHEMA_VERSION) throw new Error("This constellation format is not supported.");
  if (response.status === "unavailable") return;
  const manifest = createPortraitManifest(document);
  if (response.chart_id !== chartId || response.pattern_id !== document.pattern_id
    || response.generated_at !== document.generated_at || response.document_revision !== manifest.revision) throw new Error(mismatchMessage);
  if (!["not_started", "generating", "failed", "ready"].includes(response.status)) throw new Error("This constellation status is not supported.");
  if (response.status !== "ready") return;
  if (!response.portrait_id || response.completed_chapters !== 4 || response.chapters.length !== 4
    || new Set(response.chapters.map((chapter) => chapter.chapter_id)).size !== 4
    || new Set(response.chapters.map((chapter) => chapter.reference_id)).size !== 4
    || !isPortraitGraph(response.graph)) throw new Error(mismatchMessage);
  const bound = createPortraitManifest(document, bindingsFor(response));
  if (bound.chapters.length !== 4 || bound.chapters.some((chapter) => !chapter.object
    || !chapter.object.referenceId.trim() || !chapter.object.label.trim() || !chapter.object.rationale.trim()
    || !/^[a-f0-9]{64}$/i.test(chapter.object.referenceSha256))) throw new Error(mismatchMessage);
}

async function verifyImage(blob: Blob, expectedHash: string, signal: AbortSignal): Promise<Blob> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== expectedHash.toLowerCase()) throw new Error("A chapter image did not match its saved reference.");
  return blob;
}

function CurrentAccountPortrait({ chartId, document, pattern, canCreate, onUnauthorized, children }: AccountPatternPortraitProps) {
  const eligible = patternMatchesDocument(pattern, document) && document.core_chapters.length === 4;
  const [response, setResponse] = useState<PatternPortraitResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [imageError, setImageError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const createKey = useRef<string | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const ownedUrls = useRef(new Set<string>());
  const viewRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const reportError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) { onUnauthorized(); return; }
    setError(caught instanceof Error ? withRequestId(caught.message, caught instanceof ApiError ? caught.requestId : null) : "The constellation could not be loaded.");
  }, [onUnauthorized]);
  const acceptResponse = useCallback((next: PatternPortraitResponse) => {
    validateResponse(next, chartId, document);
    setResponse(next);
    setError(null);
  }, [chartId, document]);

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    statusRequest.current = controller;
    setBusy(true);
    void getPatternPortrait(controller.signal).then((next) => {
      if (!controller.signal.aborted) acceptResponse(next);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setResponse(null);
      setOpen(false);
      reportError(caught);
    }).finally(() => {
      if (statusRequest.current === controller) statusRequest.current = null;
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => {
      controller.abort();
      if (statusRequest.current === controller) statusRequest.current = null;
    };
  }, [eligible, attempt, acceptResponse, reportError]);

  useEffect(() => {
    if (response?.status !== "generating") return;
    const page = globalThis.document;
    const refresh = () => {
      // Slow private status reads must finish before the next poll can begin.
      if (page.visibilityState === "visible" && !statusRequest.current && !actionRequest.current) setAttempt((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 3000);
    page.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); page.removeEventListener("visibilitychange", refresh); };
  }, [response?.status]);

  const saved = response?.status === "ready" ? response : null;
  // The saved envelope and graph remain stable as the four verified thumbnails arrive.
  const bindings = useMemo(() => saved ? bindingsFor(saved, urls) : [], [saved, urls]);
  const source = useMemo(() => ({ status: "ready" as const, document, sunSign: saved?.sun_sign ?? null }), [document, saved?.sun_sign]);
  useEffect(() => {
    if (!open || !saved || urls.length === 4) return;
    const controller = new AbortController();
    setImageError(false);
    void Promise.all(saved.chapters.map(async (chapter) => verifyImage(await getPatternPortraitImage(chapter.reference_id, controller.signal), chapter.reference_sha256, controller.signal)))
      .then((blobs) => {
        if (controller.signal.aborted) return;
        const next: string[] = [];
        try {
          for (const blob of blobs) {
            const url = URL.createObjectURL(blob);
            ownedUrls.current.add(url);
            next.push(url);
          }
          setUrls(next);
        } catch (caught) {
          for (const url of next) { URL.revokeObjectURL(url); ownedUrls.current.delete(url); }
          throw caught;
        }
      }).catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        controller.abort();
        if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
        else setImageError(true);
      });
    return () => controller.abort();
  }, [open, saved, imageAttempt, urls.length, onUnauthorized]);

  useEffect(() => () => {
    actionRequest.current?.abort();
    downloadRequest.current?.abort();
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    ownedUrls.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (!moved.current) return;
    (open ? viewRef.current : readingRef.current)?.focus({ preventScroll: true });
  }, [open]);

  const create = async () => {
    if (busy || actionRequest.current || !eligible || !canCreate) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    createKey.current ??= newIdempotencyKey("web-pattern-portrait");
    setBusy(true);
    setError(null);
    try {
      const next = await startPatternPortraitGeneration({ chart_id: chartId, pattern_id: document.pattern_id, generated_at: document.generated_at, confirm: "CREATE MY PORTRAIT", consent_policy_version: PORTRAIT_CONSENT_POLICY_VERSION }, createKey.current, controller.signal);
      if (controller.signal.aborted) return;
      acceptResponse(next);
      createKey.current = null;
    } catch (caught) { if (!controller.signal.aborted) reportError(caught); }
    finally { if (!controller.signal.aborted) { setBusy(false); actionRequest.current = null; } }
  };

  const download = async () => {
    if (downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadPatternPortrait({ chart_id: chartId, pattern_id: document.pattern_id, generated_at: document.generated_at }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      ownedUrls.current.add(url);
      const anchor = globalThis.document.createElement("a");
      anchor.href = url;
      anchor.download = "pattern-portrait.json";
      anchor.click();
      window.setTimeout(() => { if (ownedUrls.current.delete(url)) URL.revokeObjectURL(url); }, 1000);
    } catch (caught) { if (!controller.signal.aborted) reportError(caught); }
    finally { if (!controller.signal.aborted) { setDownloading(false); downloadRequest.current = null; } }
  };

  return <>
    {eligible ? <section className="account-portrait" aria-label="Your constellation">
      <div className="account-portrait__heading"><p className="kicker">Your constellation</p><h3>Four chapters, a shape of your own</h3></div>
      {!response && !error ? <p role="status">Checking your saved constellation.</p> : null}
      {response?.status === "unavailable" ? <p>Constellation creation is not available right now. Your reading is ready below.</p> : null}
      {response?.status === "not_started" || response?.status === "failed" ? <>
        <p>Creating a constellation sends each chapter’s text to Codex to generate one object image. The four saved images shape your constellation, arranged with your calculated Sun sign when available.</p>
        <p>Your images are saved privately with this Pattern. Opening it again reuses them.</p>
        {response.status === "failed" ? <p role="status">The constellation could not be completed. {response.completed_chapters} of 4 chapter images are saved.</p> : null}
        {canCreate && (response.status === "not_started" || response.retryable) ? <button className="button" type="button" disabled={busy} onClick={() => void create()}>{response.status === "failed" ? "Retry constellation creation" : "Create my constellation"}</button> : <p>New image creation is unavailable. Your published reading remains available.</p>}
      </> : null}
      {response?.status === "generating" ? <><p role="status">Creating your constellation · {response.completed_chapters} of 4 chapter images saved.</p><p>You can keep reading or return later.</p></> : null}
      {saved ? <>
        <p>Your constellation is saved. Its four images and shape will be reused whenever you open it.</p>
        <div className="account-portrait__actions">
          <button className="button" type="button" aria-expanded={open} onClick={() => { moved.current = true; setOpen((value) => !value); }}>{open ? "Back to reading" : "View constellation"}</button>
          <button className="button button--secondary" type="button" disabled={downloading} onClick={() => void download()}>{downloading ? "Preparing download…" : "Download constellation"}</button>
        </div>
        <p className="account-portrait__detail">The private download contains these four images and the saved shape. It is separate from your account data export.</p>
      </> : null}
      {error ? <div className="account-portrait__error" role="alert"><p>{error}</p>{!response ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Refresh constellation status</button> : null}</div> : null}
    </section> : null}
    {open && saved ? <div className="account-portrait__view" ref={viewRef} tabIndex={-1}>
      {imageError ? <p role="status">Chapter images could not be loaded. Your saved constellation and reading are still available. <button type="button" onClick={() => setImageAttempt((value) => value + 1)}>Retry chapter images</button></p> : urls.length !== 4 ? <p role="status">Loading the four chapter images. The saved constellation is ready to explore.</p> : null}
      <PatternPortrait source={source} objectBindings={bindings} graph={saved.graph!} />
    </div> : <div ref={readingRef} tabIndex={-1}>{children}</div>}
  </>;
}

export function AccountPatternPortrait(props: AccountPatternPortraitProps) {
  // Metadata and published prose both belong to this mounted account revision.
  const revision = JSON.stringify([props.chartId, props.document, props.pattern]);
  return <CurrentAccountPortrait key={revision} {...props} />;
}
