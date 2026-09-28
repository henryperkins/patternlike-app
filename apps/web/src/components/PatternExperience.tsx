import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type {
  PatternPublicChapter,
  PatternRegenerationState,
  PatternResponseV7,
  PatternState,
  PatternStateDocumentV9,
  PatternStatePattern,
} from "@patternlike/shared";
import {
  ApiError,
  deleteGeneratedPattern,
  getGeneratedPattern,
  getPatternState,
  newIdempotencyKey,
  regeneratePattern,
  startPatternGeneration,
} from "../lib/api-client.js";
import { selectReaderReadiness, READER_COPY, type Observation, type ReaderPresentation } from "../lib/reader-readiness.js";
import { readerActionRoute } from "../lib/reader-routes.js";
import { ReaderConsequences, useReaderRefreshChart, useReaderScope } from "./ReaderReadiness.js";
import { withRequestId } from "../lib/api-status.js";
import { patternMatchesDocument } from "../lib/pattern-portrait.js";
import type { PortraitSky } from "../lib/portrait-sky.js";
import { AccountPatternPortrait } from "./AccountPatternPortrait.js";
import { PortraitAutomationControl } from "./PortraitAutomationControl.js";
import { PatternConsentTerms } from "./PatternConsent.js";
import { PreferenceConfirm } from "./PreferenceConfirm.js";
import { useClearPortraitSession } from "./portrait-explorer/portrait-session.js";

interface PatternExperienceProps {
  chartId: string;
  onUnauthorized: () => void;
  sky?: PortraitSky | null;
}

const PROGRESS: Record<"organizing_evidence" | "writing" | "checking_claims", string> = {
  organizing_evidence: "Organizing the evidence",
  writing: "Writing your Pattern",
  checking_claims: "Checking the draft",
};

const PROGRESS_ORDER = ["organizing_evidence", "writing", "checking_claims"] as const;

function isProgress(state: PatternState): state is "organizing_evidence" | "writing" | "checking_claims" {
  return state === "organizing_evidence" || state === "writing" || state === "checking_claims";
}

/** Letter case and extra spaces still count. The server phrase stays exact. */
export function confirmationMatches(value: string, phrase: string): boolean {
  return value.trim().replace(/\s+/g, " ").toUpperCase() === phrase;
}

function patternIntentSignature(value: PatternStateDocumentV9): string {
  return JSON.stringify({
    state: value.state,
    chartId: value.chart?.chart_id ?? null,
    consent: value.consent ? { status: value.consent.status, policy: value.consent.policy_version } : null,
    patternId: value.pattern?.pattern_id ?? null,
    generatedAt: value.pattern?.generated_at ?? null,
    retryable: value.generation?.retryable ?? null,
    generationId: value.generation?.generation_id ?? null,
    regeneration: value.regeneration ? {
      eligible: value.regeneration.eligible,
      generationId: value.regeneration.generation?.generation_id ?? null,
      failureId: value.regeneration.failure?.generation_id ?? null,
      retryable: value.regeneration.failure?.retryable ?? null,
    } : null,
  });
}

function announceFor(next: PatternStateDocumentV9): string {
  if (next.regeneration?.generation) {
    return `Replacing your Pattern. ${PROGRESS[next.regeneration.generation.stage]}.`;
  }
  if (isProgress(next.state)) return `${PROGRESS[next.state]}.`;
  if (next.state === "ontology_unavailable") return "Pattern generation is not available right now.";
  if (next.state === "ready") return "Your reading is available.";
  const copy: Partial<Record<PatternState, string>> = {
    chart_required: READER_COPY.chart_required,
    locale_confirmation_required: READER_COPY.locale_required,
    deleted: READER_COPY.deleted,
    withdrawn: READER_COPY.withdrawn,
    failed: READER_COPY.failed,
    consent_required: READER_COPY.consent_required,
    available: READER_COPY.available,
  };
  return copy[next.state] ?? READER_COPY.observation_unavailable;
}

function describeFailure(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    const known: Record<string, string> = {
      locale_unsupported: "Patterns are written in English (United States). Confirm that language, then try again.",
      idempotency_key_reused: "That action was already sent with different details. Check the status, then try again.",
      pattern_regeneration_not_available: "A replacement is not available for this Pattern right now.",
    };
    return withRequestId(known[caught.code] ?? fallback, caught.requestId);
  }
  if (caught instanceof TypeError) return fallback;
  if (caught instanceof Error && caught.message) return caught.message;
  return fallback;
}

function GeneratedChapter({ chapter, index }: { chapter: PatternPublicChapter; index: number }) {
  return (
    <article className="pattern-chapter" aria-labelledby={`generated-chapter-${index}`}>
      <h3 id={`generated-chapter-${index}`}>{chapter.title}</h3>
      <p className="pattern-chapter__summary">{chapter.summary}</p>
      {chapter.sections.map((section, sectionIndex) => (
        <p className="pattern-chapter__body" key={sectionIndex}>{section.text}</p>
      ))}
      {chapter.tensions.length > 0 ? (
        <div className="pattern-chapter__list">
          <h4>Where it pulls against itself</h4>
          <ul>
            {chapter.tensions.map((tension) => (
              <li key={tension.text}>{tension.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {chapter.resources.length > 0 ? (
        <div className="pattern-chapter__list">
          <h4>What it gives you to work with</h4>
          <ul>
            {chapter.resources.map((resource) => (
              <li key={resource.text}>{resource.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="pattern-chapter__counter">
        <span>The same pattern, expressed the other way</span>
        {chapter.counter_expression.text}
      </p>
    </article>
  );
}

const DELETE_CONFIRMATION = "DELETE PATTERN";
const REGENERATE_CONFIRMATION = "REGENERATE MY PATTERN";

function ConfirmField({
  id,
  phrase,
  describedBy,
  value,
  onChange,
  mismatch,
  inputRef,
}: {
  id: string;
  phrase: string;
  describedBy: string;
  value: string;
  onChange: (value: string) => void;
  mismatch: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const errorId = `${id}-error`;
  return (
    <>
      <label htmlFor={id}>Type {phrase} to confirm</label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={value}
        aria-invalid={mismatch || undefined}
        aria-describedby={mismatch ? `${describedBy} ${errorId}` : describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {mismatch ? (
        <p id={errorId} className="field-help">
          That does not match yet. Letter case and extra spaces are ignored.
        </p>
      ) : null}
    </>
  );
}

function PatternRegenerationPanel({
  regeneration,
  presentation,
  onRegenerate,
  onRefresh,
  mutating,
  error,
}: {
  regeneration: PatternRegenerationState | null;
  presentation: ReaderPresentation;
  onRegenerate: () => void;
  onRefresh: () => void;
  mutating: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const matches = confirmationMatches(confirmText, REGENERATE_CONFIRMATION);

  useEffect(() => {
    if (confirming) {
      opened.current = true;
      inputRef.current?.focus();
      return;
    }
    if (opened.current) openerRef.current?.focus();
  }, [confirming]);

  if (!regeneration) return null;

  if (regeneration.generation) {
    return (
      <section
        className="pattern-regeneration pattern-regeneration--active"
        aria-labelledby="pattern-regeneration-heading"
        aria-busy="true"
      >
        <p className="kicker">Pattern replacement</p>
        <h3 id="pattern-regeneration-heading">Replacing your Pattern</h3>
        <p>{PROGRESS[regeneration.generation.stage]}</p>
        <p>Your current Pattern stays readable until the replacement succeeds.</p>
      </section>
    );
  }

  const canMutate = presentation.actions.some(action => action.type === "start_generation" || action.type === "retry_generation");
  const failed = regeneration.failure;
  if (!regeneration.eligible && !failed) return null;

  return (
    <section
      className={`pattern-regeneration${failed ? " pattern-regeneration--failed" : ""}`}
      aria-labelledby="pattern-regeneration-heading"
    >
      <p className="kicker">{failed ? "Replacement not completed" : "Replacement available"}</p>
      <h3 id="pattern-regeneration-heading">
        {failed ? "Your Pattern was not changed" : "A replacement can be written"}
      </h3>
      <p>
        {failed
          ? "The update did not finish. Your current Pattern was not changed."
          : "Content in the same permitted categories will be sent again. If the replacement succeeds, this version is erased."}
      </p>
      <p>
        Saved artwork belongs to this version. Download it before you replace the Pattern if you want to keep it.
        Your current Pattern stays readable until the replacement succeeds.
      </p>
      {error ? <p className="pattern-regeneration__error">{error}</p> : null}
      {confirming ? (
        <form
          className="pattern-regeneration__confirm"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches || mutating || !canMutate) return;
            setConfirming(false);
            setConfirmText("");
            onRegenerate();
          }}
        >
          <ConfirmField
            id="pattern-regeneration-confirm"
            phrase={REGENERATE_CONFIRMATION}
            describedBy="pattern-regeneration-consequences"
            value={confirmText}
            onChange={setConfirmText}
            mismatch={confirmText.trim().length > 0 && !matches}
            inputRef={inputRef}
          />
          <p id="pattern-regeneration-consequences" className="field-help">
            Content in the same permitted categories will be sent again to Codex, run by OpenAI.
            If the replacement succeeds, this version and its saved artwork are erased.
          </p>
          <div className="pattern-regeneration__confirm-actions">
            <button className="button button--danger" type="submit" disabled={!matches || mutating || !canMutate}>
              Replace my Pattern
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              disabled={mutating}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : !canMutate ? (
        <button ref={openerRef} className="button button--secondary" type="button" onClick={onRefresh} disabled={mutating}>
          Check again
        </button>
      ) : (
        <button
          ref={openerRef}
          className="button button--secondary"
          type="button"
          onClick={() => setConfirming(true)}
          disabled={mutating}
        >
          {failed ? "Try the replacement again" : "Review replacement"}
        </button>
      )}
    </section>
  );
}

function ReadyDocument({
  chartId,
  sky,
  document,
  pattern,
  canCreatePortrait,
  onUnauthorized,
  regeneration,
  replacementPresentation,
  observedAt,
  onRegenerate,
  onRefresh,
  onDelete,
  mutating,
  error,
  consentGranted,
}: {
  chartId: string;
  sky?: PortraitSky | null;
  document: PatternResponseV7;
  pattern: PatternStatePattern;
  canCreatePortrait: boolean;
  onUnauthorized: () => void;
  regeneration: PatternRegenerationState | null;
  replacementPresentation: ReaderPresentation;
  observedAt: number | null;
  onRegenerate: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  mutating: boolean;
  error: string | null;
  consentGranted: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const openerRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const generatedAt = new Date(document.generated_at);
  const generatedLabel = Number.isNaN(generatedAt.getTime())
    ? document.generated_at
    : generatedAt.toLocaleDateString(document.locale, { day: "numeric", month: "long", year: "numeric" });
  const matches = confirmationMatches(confirmText, DELETE_CONFIRMATION);

  const deleteInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (confirming) {
      opened.current = true;
      deleteInputRef.current?.focus();
      return;
    }
    if (opened.current) openerRef.current?.focus();
  }, [confirming]);

  return (
    <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
      <h2 id="pattern-experience-heading" className="sr-only">A private reading of this chart</h2>
      <AccountPatternPortrait chartId={chartId} document={document} pattern={pattern} canCreate={canCreatePortrait} onUnauthorized={onUnauthorized} sky={sky}>
        <div className="pattern-chapters__list">
          {document.core_chapters.map((chapter, index) => (
            <GeneratedChapter chapter={chapter} index={index} key={`${chapter.title}-${index}`} />
          ))}
        </div>
        {document.additional_signatures.length > 0 ? (
          <section className="pattern-signatures" aria-labelledby="pattern-signatures-heading">
            <h3 id="pattern-signatures-heading">Additional signatures</h3>
            {document.additional_signatures.map((signature) => (
              <article key={signature.title}>
                <h4>{signature.title}</h4>
                <p>{signature.text}</p>
              </article>
            ))}
          </section>
        ) : null}
        {document.uncertainty ? (
          <p className="pattern-chapters__accuracy">
            <span>Uncertainty</span>
            {document.uncertainty.text}
          </p>
        ) : null}
      </AccountPatternPortrait>
      <p className="pattern-provenance">
        AI-generated from your calculated chart · {generatedLabel} · Pattern <span className="pattern-provenance__id">{document.pattern_id}</span>
      </p>
      <p className="pattern-provenance">
        Your birth date, time, birthplace, and coordinates were not sent as fields
        to Codex, operated by {document.provenance.provider}. The calculated positions
        that were sent can be used to reconstruct them.
      </p>
      {consentGranted ? (
        <p className="pattern-provenance">
          Pattern permission: on · <a href="#privacy">Privacy</a>
        </p>
      ) : null}
      <PatternRegenerationPanel
        regeneration={regeneration}
        presentation={replacementPresentation}
        onRegenerate={onRegenerate}
        onRefresh={onRefresh}
        mutating={mutating}
        error={error}
      />
      <div className="pattern-delete">
        {confirming ? (
          <form
            className="privacy-action__confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (!matches || mutating) return;
              setConfirming(false);
              setConfirmText("");
              onDelete();
            }}
          >
            <ReaderConsequences action="delete_pattern" observedAt={observedAt} evidence="known" retainEvidence />
            <ConfirmField
              id="pattern-delete-confirm"
              phrase={DELETE_CONFIRMATION}
              describedBy="pattern-delete-consequences"
              value={confirmText}
              onChange={setConfirmText}
              mismatch={confirmText.trim().length > 0 && !matches}
              inputRef={deleteInputRef}
            />
            <p id="pattern-delete-consequences" className="field-help">
              This Pattern and its saved artwork are removed from your account.
              Encrypted provider copies follow the 30-day deletion schedule.
              Download saved artwork first if you want to keep it.
            </p>
            {error ? <p className="pattern-delete__error">{error}</p> : null}
            <div className="privacy-action__confirm-actions">
              <button className="button button--danger" type="submit" disabled={!matches || mutating}>
                Confirm deletion
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
                disabled={mutating}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            ref={openerRef}
            className="button button--secondary"
            type="button"
            onClick={() => setConfirming(true)}
            disabled={mutating}
          >
            Delete this Pattern
          </button>
        )}
      </div>
    </section>
  );
}

function CurrentChartPatternExperience({ chartId, onUnauthorized, sky }: PatternExperienceProps) {
  const clearPortraitSession = useClearPortraitSession();
  const accountScope = useReaderScope();
  const refreshChart = useReaderRefreshChart();
  const [observation, setObservation] = useState<Observation<PatternStateDocumentV9> | null>(null);
  const loadGeneration = useRef(0);
  const mutatingRef = useRef(false);
  const mounted = useRef(true);
  const [deletionReceipt, setDeletionReceipt] = useState<"accepted" | "already_unavailable" | null>(null);
  const [portraitPreferenceSaving, setPortraitPreferenceSaving] = useState(false);
  const [state, setState] = useState<PatternStateDocumentV9 | null>(null);
  const [document, setDocument] = useState<PatternResponseV7 | null>(null);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [alert, setAlert] = useState("");
  const [announcement, setAnnouncement] = useState("Checking whether a Pattern is ready.");
  const [mutating, setMutating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const keys = useRef(new Map<string, string>());
  const regenerationInFlight = useRef(false);
  const currentDocument = useRef<PatternResponseV7 | null>(null);
  const stateRef = useRef<PatternStateDocumentV9 | null>(null);
  const noticeRef = useRef<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const ctx = useRef({ chartId, onUnauthorized, clearPortraitSession, accountScope, refreshChart });
  ctx.current = { chartId, onUnauthorized, clearPortraitSession, accountScope, refreshChart };
  stateRef.current = state;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, []);

  const focusAlert = () => {
    requestAnimationFrame(() => alertRef.current?.focus());
  };

  const keyFor = (intent: string, prefix: string) => {
    const existing = keys.current.get(intent);
    if (existing) return existing;
    const key = newIdempotencyKey(prefix);
    keys.current.set(intent, key);
    return key;
  };

  const publishAnnouncement = (next: PatternStateDocumentV9) => {
    const notice = noticeRef.current;
    noticeRef.current = null;
    setAnnouncement(notice ?? announceFor(next));
  };

  const refresh = useCallback(async (signal: AbortSignal, mode: "interactive" | "quiet") => {
    const generation = ++loadGeneration.current;
    const current = () => mounted.current && !signal.aborted && generation === loadGeneration.current;
    const { chartId: activeChart, onUnauthorized: deny, clearPortraitSession: clearSession, accountScope: scope, refreshChart: refreshActiveChart } = ctx.current;
    try {
      const next = await getPatternState(signal);
      if (!current()) return;
      if (next.chart && next.chart.chart_id !== activeChart) {
        if (refreshActiveChart) void refreshActiveChart();
        clearSession();
        currentDocument.current = null;
        setDocument(null);
        setState(null);
        stateRef.current = null;
        const message = "Your Pattern was removed because its birth chart changed.";
        setBlockingError(message);
        setAlert(message);
        setAnnouncement(message);
        return;
      }
      if (next.state === "ready" && (!next.chart || !next.pattern)) {
        clearSession();
        currentDocument.current = null;
        setDocument(null);
        setState(null);
        stateRef.current = null;
        const message = "This reading no longer matches the current Pattern state. Refresh to load its latest revision.";
        setBlockingError(message);
        setAlert(message);
        setAnnouncement(message);
        return;
      }
      const source = next.pattern ? `${next.pattern.pattern_id}:${next.pattern.generated_at}` : null;
      const observedAt = Date.now();
      if (next.state === "ready" && next.pattern) {
        const held = currentDocument.current;
        if (!(mode === "quiet" && held && patternMatchesDocument(next.pattern, held))) {
          const generated = await getGeneratedPattern(signal);
          if (!current()) return;
          if (!patternMatchesDocument(next.pattern, generated)) {
            if (mode === "quiet" && held) {
              setAlert("This reading no longer matches the current Pattern state. Refresh to load its latest revision.");
              return;
            }
            clearSession();
            currentDocument.current = null;
            setDocument(null);
            setState(null);
            stateRef.current = null;
            const message = "This reading no longer matches the current Pattern state. Refresh to load its latest revision.";
            setBlockingError(message);
            setAlert(message);
            setAnnouncement(message);
            return;
          }
          if (held && JSON.stringify(held) !== JSON.stringify(generated)) noticeRef.current = "Your Pattern was updated.";
          currentDocument.current = generated;
          setDocument(generated);
        }
      } else {
        clearSession();
        currentDocument.current = null;
        setDocument(null);
      }
      if (!current()) return;
      setBlockingError(null);
      if (mode === "interactive") setAlert("");
      setState(next);
      stateRef.current = next;
      setObservation({
        scope: { ...scope, chartId: activeChart, source },
        requestGeneration: 1,
        observedAt,
        evidence: "known",
        value: next,
      });
      publishAnnouncement(next);
    } catch (caught) {
      if (!current()) return;
      if (caught instanceof ApiError && caught.status === 401) {
        deny();
        return;
      }
      const message = describeFailure(caught, "Your Pattern could not be loaded in this session.");
      if (mode === "quiet" || stateRef.current) {
        setAlert(message);
        return;
      }
      if (caught instanceof ApiError && [403, 404, 409, 410].includes(caught.status)) {
        ctx.current.clearPortraitSession();
        currentDocument.current = null;
        setDocument(null);
        setState(null);
        stateRef.current = null;
      }
      setBlockingError(message);
      setAlert(message);
      setAnnouncement(message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal, "interactive");
    return () => controller.abort();
  }, [attempt, refresh]);

  const activeStage = state && isProgress(state.state)
    ? state.state
    : state?.regeneration?.generation?.stage ?? null;

  useEffect(() => {
    if (!activeStage) return;
    const waits = [2000, 4000, 8000, 15000, 30000];
    let index = 0;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (globalThis.document.visibilityState !== "hidden" && !mutatingRef.current) {
          const controller = new AbortController();
          void refresh(controller.signal, "quiet");
        }
        index = Math.min(index + 1, waits.length - 1);
        schedule();
      }, waits[index]);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [activeStage, refresh]);

  useEffect(() => {
    let last = Date.now();
    const reload = () => {
      if (globalThis.document.visibilityState === "hidden" || mutatingRef.current) return;
      const now = Date.now();
      if (now - last < 30_000) return;
      last = now;
      const controller = new AbortController();
      void refresh(controller.signal, "quiet");
    };
    const onPageShow = (event: Event) => {
      if (!(event as PageTransitionEvent).persisted) return;
      reload();
    };
    const onVisibility = () => {
      if (globalThis.document.visibilityState === "visible") reload();
    };
    globalThis.document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  useEffect(() => {
    if (!state || !isProgress(state.state)) {
      setSlow(false);
      return;
    }
    const started = Date.parse(state.generation?.started_at ?? "");
    const elapsed = Number.isFinite(started) ? Date.now() - started : 0;
    if (elapsed > 15_000) {
      setSlow(true);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 15_000 - elapsed);
    return () => window.clearTimeout(timer);
  }, [state]);

  const scope = {
    ...accountScope,
    chartId,
    source: state?.pattern ? `${state.pattern.pattern_id}:${state.pattern.generated_at}` : null,
  };
  const presentation = selectReaderReadiness({
    scope,
    requestGeneration: 1,
    now: observation?.observedAt ?? Date.now(),
    pattern: observation,
    patternDocumentMatches: Boolean(document && patternMatchesDocument(state?.pattern ?? null, document)),
    retainAcceptedPattern: Boolean(document),
    chapterCount: document?.core_chapters.length,
  });

  const changedBeforeSubmit = async (signal: AbortSignal, next: PatternStateDocumentV9) => {
    const previous = stateRef.current;
    if (previous && patternIntentSignature(previous) === patternIntentSignature(next)) return false;
    noticeRef.current = "This status changed. Review it before continuing.";
    await refresh(signal, "quiet");
    setAlert("This status changed. Review it before continuing.");
    return true;
  };

  const generate = async (reason: "first_open" | "failed_attempt_retry") => {
    if (mutatingRef.current || portraitPreferenceSaving) return;
    if (!presentation.pattern.actions.some(action => ["review_consent", "start_generation", "retry_generation"].includes(action.type))) return;
    const controller = new AbortController();
    mutatingRef.current = true;
    setMutating(true);
    setAlert("");
    const intent = `${reason}:${state?.generation?.generation_id ?? state?.state ?? "none"}`;
    try {
      const current = await getPatternState(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (await changedBeforeSubmit(controller.signal, current)) return;
      const granted = current.consent;
      if (!granted) return;
      await startPatternGeneration(granted.policy_version, reason, keyFor(intent, "web-pattern-generation"), controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      keys.current.delete(intent);
      await refresh(controller.signal, "quiet");
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      if (caught instanceof ApiError) keys.current.delete(intent);
      setAlert(describeFailure(caught, "Pattern generation could not be started."));
      focusAlert();
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  };

  const erase = async () => {
    if (mutatingRef.current || !currentDocument.current) return;
    const controller = new AbortController();
    mutatingRef.current = true;
    setMutating(true);
    const intent = `delete:${state?.pattern?.pattern_id ?? "pattern"}`;
    try {
      const current = await getPatternState(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (await changedBeforeSubmit(controller.signal, current)) return;
      const receipt = await deleteGeneratedPattern(keyFor(intent, "web-pattern-delete"), controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      keys.current.delete(intent);
      setDeletionReceipt(receipt.receipt);
      noticeRef.current = receipt.receipt === "accepted"
        ? "Deletion request accepted. This is not a receipt for completed storage or provider erasure."
        : "The Pattern is already unavailable. This is not a receipt for completed storage or provider erasure.";
      clearPortraitSession();
      currentDocument.current = null;
      setDocument(null);
      await refresh(controller.signal, "quiet");
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      if (caught instanceof ApiError) keys.current.delete(intent);
      setAlert(describeFailure(caught, "This Pattern could not be deleted."));
      focusAlert();
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  };

  const regenerate = async () => {
    if (mutatingRef.current || regenerationInFlight.current || state?.state !== "ready") return;
    if (!presentation.patternReplacement.actions.some(action => action.type === "start_generation" || action.type === "retry_generation")) return;
    const controller = new AbortController();
    regenerationInFlight.current = true;
    mutatingRef.current = true;
    setMutating(true);
    setAlert("");
    const intent = `source_update:${state.regeneration?.failure?.generation_id ?? state.pattern?.generated_at ?? "current"}`;
    try {
      const current = await getPatternState(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (
        current.chart?.chart_id !== chartId || current.state !== "ready" || !current.regeneration?.eligible
        || current.regeneration.generation || current.consent?.status !== "granted"
        || (current.regeneration.failure && current.regeneration.failure.retryable !== true)
        || !currentDocument.current || !patternMatchesDocument(current.pattern, currentDocument.current)
      ) {
        noticeRef.current = "This status changed. Review it before continuing.";
        await refresh(controller.signal, "quiet");
        setAlert("This status changed. Review it before continuing.");
        return;
      }
      await regeneratePattern(current.consent.policy_version, keyFor(intent, "web-pattern-regeneration"), controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      keys.current.delete(intent);
      await refresh(controller.signal, "quiet");
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      if (caught instanceof ApiError) keys.current.delete(intent);
      setAlert(describeFailure(caught, "This Pattern replacement could not be started."));
      focusAlert();
    } finally {
      regenerationInFlight.current = false;
      mutatingRef.current = false;
      setMutating(false);
    }
  };

  const heading = (
    <div className="panel-heading">
      <div>
        <p className="kicker">Your Pattern</p>
        <h2 id="pattern-experience-heading">A private reading of this chart</h2>
      </div>
    </div>
  );

  const visibleAlert = alert ? <p className="pattern-chapters__request">{alert}</p> : null;

  let body: ReactNode;
  if (blockingError && (!state || (state.state === "ready" && !document))) {
    body = (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
        {heading}
        <div className="pattern-chapters__failure">
          <h3>Your Pattern could not be loaded.</h3>
          <p>{blockingError}</p>
          <button className="button button--primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      </section>
    );
  } else if (!state || (state.state === "ready" && !document)) {
    body = (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading" aria-busy="true">
        {heading}
        <p className="pattern-chapters__status">Checking whether a Pattern is ready.</p>
      </section>
    );
  } else if (state.state === "ready" && document && state.pattern) {
    body = (
      <ReadyDocument
        key={`${document.pattern_id}:${document.generated_at}`}
        chartId={chartId}
        sky={sky}
        document={document}
        pattern={state.pattern}
        canCreatePortrait={state.consent?.status === "granted" && !state.regeneration?.generation && !mutating}
        onUnauthorized={onUnauthorized}
        regeneration={state.regeneration}
        replacementPresentation={presentation.patternReplacement}
        observedAt={observation?.observedAt ?? null}
        onRegenerate={() => void regenerate()}
        onRefresh={() => setAttempt((value) => value + 1)}
        onDelete={() => void erase()}
        mutating={mutating}
        error={alert || null}
        consentGranted={state.consent?.status === "granted"}
      />
    );
  } else if (isProgress(state.state)) {
    body = (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading" aria-busy="true">
        {heading}
        <div className="pattern-chapters__empty">
          <h3>{PROGRESS[state.state]}</h3>
          <ol className="pattern-progress">
            {PROGRESS_ORDER.map((stage) => (
              <li key={stage} aria-current={stage === state.state ? "step" : undefined}>{PROGRESS[stage]}</li>
            ))}
          </ol>
          <p className="pattern-progress__help">This usually takes a short while. You can leave and come back.</p>
          {slow ? <p className="pattern-progress__help">This is taking longer than usual.</p> : null}
          {visibleAlert}
        </div>
      </section>
    );
  } else {
    const canRetry = presentation.pattern.actions.some(action => action.type === "retry_generation");
    const canStart = presentation.pattern.actions.some(action => action.type === "start_generation" || action.type === "review_consent");
    const failedStage = state.generation && isProgress(state.generation.stage) ? PROGRESS[state.generation.stage] : null;
    const details: Partial<Record<PatternState, string>> = {
      chart_required: "Your Pattern is written from calculated natal facts, so it waits for an active chart.",
      locale_confirmation_required: "Patterns are written in English (United States). Confirm en-US. Another language tag can be saved, and a Pattern cannot be published in it.",
      ontology_unavailable: "No interpretation meanings are available right now. Your chart facts are unchanged.",
      deleted: "A deleted Pattern cannot be written again for this chart. Correcting birth details creates a different chart.",
      withdrawn: "A new Pattern cannot be written for this chart.",
      failed: canRetry
        ? `This attempt stopped${failedStage ? ` during “${failedStage}”` : ""}. You can try again.`
        : "A retry is not available right now. Check again for an updated status.",
      consent_required: "Review what will and will not be sent, then write your Pattern.",
      available: "Pattern permission is already on. A Pattern for this chart is written from calculated facts only.",
    };
    const consent = state.consent;
    const granted = consent?.status === "granted";
    const showConsentForm = state.state === "consent_required" || (state.state === "failed" && !granted && canStart);
    const showGenerate = Boolean(consent) && (canStart || canRetry) && (showConsentForm || granted);
    const reason = state.state === "failed" ? "failed_attempt_retry" as const : "first_open" as const;
    const showReload = presentation.pattern.actions.some(action => action.type === "reload_status");
    const title = state.state === "ontology_unavailable"
      ? "Pattern generation is not available right now."
      : presentation.pattern.text;
    body = (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
        {heading}
        <div className={state.state === "failed" ? "pattern-chapters__failure" : "pattern-chapters__empty"}>
          <h3 data-readiness={presentation.pattern.code}>{title}</h3>
          <p>{details[state.state] ?? "Your chart facts are unchanged."}</p>
          {deletionReceipt ? (
            <p>
              {deletionReceipt === "accepted" ? "Deletion request accepted." : "The Pattern is already unavailable."}
              {" "}This is not a receipt for completed storage or provider erasure.
            </p>
          ) : null}
          {presentation.pattern.actions.filter(action => action.type === "open_birth_details").map(action => (
            <a className="button button--primary" key={action.type} href={readerActionRoute(action) ?? "#privacy"}>Open birth details</a>
          ))}
          {state.state === "locale_confirmation_required" ? (
            <PreferenceConfirm
              kind="locale"
              embedded
              initialValue="en-US"
              requestId={null}
              body="Patterns are written in English (United States). Confirm en-US. Another language tag is saved, and a Pattern cannot be published in it."
              savedMessage="Language saved. Checking whether a Pattern can be written."
              onSaved={() => setAttempt((value) => value + 1)}
              onUnauthorized={onUnauthorized}
            />
          ) : null}
          {visibleAlert}
          {showGenerate && consent ? (
            <>
              {showConsentForm ? <PatternConsentTerms consent={consent} privacyLink /> : (
                <p>
                  Pattern permission is already on. <a href="#privacy">Privacy</a>
                </p>
              )}
              <PortraitAutomationControl chartId={chartId} onUnauthorized={onUnauthorized} onSavingChange={setPortraitPreferenceSaving} />
              <button
                className="button button--primary"
                type="button"
                onClick={() => void generate(reason)}
                disabled={mutating || portraitPreferenceSaving}
                aria-busy={mutating || undefined}
              >
                {mutating ? "Starting your Pattern…" : state.state === "failed" ? "Try again" : "Generate my Pattern"}
              </button>
            </>
          ) : null}
          {showReload ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              disabled={mutating}
            >
              Check again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <p className="sr-only" role="alert" tabIndex={-1} ref={alertRef}>{alert}</p>
      {body}
    </>
  );
}

/** A corrected chart starts an isolated reader and aborts the previous chart's work. */
export function PatternExperience(props: PatternExperienceProps) {
  const scope = useReaderScope();
  return <CurrentChartPatternExperience key={`${scope.sessionEpoch}:${scope.accountId}:${props.chartId}:${scope.profileVersion}`} {...props} />;
}
