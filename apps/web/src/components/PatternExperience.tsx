import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PatternConsent,
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
import { selectReaderReadiness, observationReason, type Observation, type ReaderPresentation } from "../lib/reader-readiness.js";
import { readerActionRoute } from "../lib/reader-routes.js";
import { ReaderConsequences, ReaderReadiness, useReaderScope } from "./ReaderReadiness.js";
import { withRequestId } from "../lib/api-status.js";
import { patternMatchesDocument } from "../lib/pattern-portrait.js";
import type { PortraitSky } from "../lib/portrait-sky.js";
import { AccountPatternPortrait } from "./AccountPatternPortrait.js";
import { PortraitAutomationControl } from "./PortraitAutomationControl.js";
import { PatternConsentTerms } from "./PatternConsent.js";
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

function isProgress(state: PatternState): state is "organizing_evidence" | "writing" | "checking_claims" {
  return state === "organizing_evidence" || state === "writing" || state === "checking_claims";
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

function PatternRegenerationPanel({
  regeneration,
  presentation,
  onRegenerate,
  onRefresh,
  busy,
  error,
}: {
  regeneration: PatternRegenerationState | null;
  presentation: ReaderPresentation;
  onRegenerate: () => void;
  onRefresh: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (!regeneration) return null;

  if (regeneration.generation) {
    return (
      <section
        className="pattern-regeneration pattern-regeneration--active"
        aria-labelledby="pattern-regeneration-heading"
        aria-busy="true"
      >
        <p className="kicker">Pattern update</p>
        <h3 id="pattern-regeneration-heading">Updating your Pattern</h3>
        <p className="pattern-regeneration__status" role="status">
          Updating your Pattern · {PROGRESS[regeneration.generation.stage]}
        </p>
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
      <p className="kicker">{failed ? "Pattern update not completed" : "Pattern update available"}</p>
      <h3 id="pattern-regeneration-heading">
        {failed ? "Your Pattern was not changed" : "A newer Pattern method is available"}
      </h3>
      <p>
        {failed
          ? "The update did not finish. Your current Pattern was not changed."
          : "The source code used to write Patterns has changed since this reading was created."}
      </p>
      {!failed ? (
        <p>
          Your current Pattern stays here while the replacement is written. If
          the update succeeds, this version is permanently erased and replaced.
        </p>
      ) : null}
      {error ? <p className="pattern-regeneration__error" role="status">{error}</p> : null}
      {confirming ? (
        <form
          className="pattern-regeneration__confirm"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmText !== REGENERATE_CONFIRMATION || busy || !canMutate) return;
            onRegenerate();
          }}
        >
          <label htmlFor="pattern-regeneration-confirm">
            Type {REGENERATE_CONFIRMATION} to confirm. The same minimized,
            chart-derived content will be sent again to Codex, run by OpenAI.
            If the replacement succeeds, this version is permanently erased
            and cannot be recovered.
          </label>
          <input
            id="pattern-regeneration-confirm"
            name="pattern-regeneration-confirm"
            type="text"
            autoComplete="off"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            disabled={busy}
          />
          <div className="pattern-regeneration__confirm-actions">
            <button
              className="button"
              type="submit"
              disabled={confirmText !== REGENERATE_CONFIRMATION || busy || !canMutate}
            >
              Replace my Pattern
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : !canMutate ? (
        <button
          className="button button--secondary"
          type="button"
          onClick={onRefresh}
          disabled={busy}
        >
          Check again
        </button>
      ) : (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          aria-expanded={confirming}
        >
          {failed ? "Try the update again" : "Review Pattern update"}
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
  fresh,
  observedAt,
  onRegenerate,
  onRefresh,
  onDelete,
  busy,
  error,
}: {
  chartId: string;
  sky?: PortraitSky | null;
  document: PatternResponseV7;
  pattern: PatternStatePattern;
  canCreatePortrait: boolean;
  onUnauthorized: () => void;
  regeneration: PatternRegenerationState | null;
  replacementPresentation: ReaderPresentation;
  fresh: boolean;
  observedAt: number | null;
  onRegenerate: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const generatedAt = new Date(document.generated_at);
  const generatedLabel = Number.isNaN(generatedAt.getTime())
    ? document.generated_at
    : generatedAt.toLocaleDateString(document.locale, { day: "numeric", month: "long", year: "numeric" });

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
        AI-generated from your calculated chart · {generatedLabel} · Pattern {document.pattern_id}
      </p>
      <p className="pattern-provenance">
        Your birth date, time, birthplace, and coordinates were not sent to the
        model ({document.provenance.provider}).
      </p>
      <PatternRegenerationPanel
        regeneration={regeneration}
        presentation={replacementPresentation}
        onRegenerate={onRegenerate}
        onRefresh={onRefresh}
        busy={busy}
        error={error}
      />
      {!fresh && <ReaderReadiness presentation={replacementPresentation} onAction={() => onRefresh()} />}
      <div className="pattern-delete">
        {confirming ? (
          <form
            className="privacy-action__confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmText !== DELETE_CONFIRMATION || busy || !fresh) return;
              onDelete();
            }}
          >
            <ReaderConsequences action="delete_pattern" observedAt={observedAt} evidence={fresh ? "known" : "unavailable"} />
            <label htmlFor="pattern-delete-confirm">
              Type {DELETE_CONFIRMATION} to confirm. This Pattern and retained
              generation material will be permanently erased and cannot be
              regenerated for this chart. Correcting birth details creates a
              different chart that may receive a new Pattern when consent remains
              active.
            </label>
            <input
              id="pattern-delete-confirm"
              name="pattern-delete-confirm"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              disabled={busy}
            />
            <div className="privacy-action__confirm-actions">
              <button
                className="button button--danger"
                type="submit"
                disabled={confirmText !== DELETE_CONFIRMATION || busy || !fresh}
              >
                Confirm deletion
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-expanded={confirming}
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
  const [observation, setObservation] = useState<Observation<PatternStateDocumentV9> | null>(null);
  const [, setClockRevision] = useState(0);
  const requestGeneration = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [deletionReceipt, setDeletionReceipt] = useState<"accepted" | "already_unavailable" | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort(); requestGeneration.current++; }; }, []);
  const [portraitPreferenceSaving, setPortraitPreferenceSaving] = useState(false);
  const [state, setState] = useState<PatternStateDocumentV9 | null>(null);
  const [document, setDocument] = useState<PatternResponseV7 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const generateKey = useRef<string | null>(null);
  const regenerateKey = useRef<string | null>(null);
  const regenerationInFlight = useRef(false);
  const deleteKey = useRef<string | null>(null);
  const currentDocument = useRef<PatternResponseV7 | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const generation = ++requestGeneration.current;
    const current = () => mounted.current && !signal.aborted && generation === requestGeneration.current;
    setBusy(true);
    setObservation(previous => previous ? { ...previous, evidence: "unavailable" } : previous);
    try {
      const next = await getPatternState(signal);
      if (!current()) return;
      if ((next.chart && next.chart.chart_id !== chartId) || (next.state === "ready" && (!next.chart || !next.pattern))) {
        clearPortraitSession();
        currentDocument.current = null;
        setDocument(null);
        setState(null);
        throw new Error("This reading no longer matches the current chart. Refresh to load its Pattern.");
      }
      setState(next);
      setObservation({ scope: { ...accountScope, chartId, source: next.pattern ? `${next.pattern.pattern_id}:${next.pattern.generated_at}` : null }, requestGeneration: generation, observedAt: Date.now(), evidence: "known", value: next });
      setError(null);
      setRequestId(null);
      if (next.state === "ready") {
        if (currentDocument.current && !patternMatchesDocument(next.pattern, currentDocument.current)) {
          clearPortraitSession();
          currentDocument.current = null;
          setDocument(null);
        }
        const generated = await getGeneratedPattern(signal);
        if (!current()) return;
        if (!patternMatchesDocument(next.pattern, generated)) {
          clearPortraitSession();
          currentDocument.current = null;
          setDocument(null);
          throw new Error("This reading no longer matches the current Pattern state. Refresh to load its latest revision.");
        }
        // Polling an unchanged reading must not remount its portrait or discard its selection.
        if (JSON.stringify(currentDocument.current) !== JSON.stringify(generated)) currentDocument.current = generated;
        setDocument(currentDocument.current);
      } else {
        clearPortraitSession();
        currentDocument.current = null;
        setDocument(null);
      }
    } catch (caught) {
      if (!current()) return;
      setObservation(previous => previous ? { ...previous, evidence: "unavailable" } : previous);
      if (caught instanceof ApiError && [401, 403, 404, 409, 410].includes(caught.status)) {
        clearPortraitSession(); currentDocument.current = null; setDocument(null); setState(null);
      }
      if (caught instanceof ApiError && caught.status === 401) {
        clearPortraitSession();
        onUnauthorized();
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Your Pattern could not be loaded in this session.",
      );
      setRequestId(caught instanceof ApiError ? caught.requestId : null);
    } finally {
      if (current()) setBusy(false);
    }
  }, [chartId, onUnauthorized, clearPortraitSession, accountScope]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [attempt, load]);

  useEffect(() => {
    const activeStage = state && isProgress(state.state)
      ? state.state
      : state?.regeneration?.generation?.stage;
    if (!activeStage) return;
    const page = globalThis.document;
    const tick = () => {
      if (page.visibilityState === "hidden") return;
      setAttempt((value) => value + 1);
    };
    const timer = window.setInterval(tick, 2000);
    const onVisibility = () => {
      if (page.visibilityState === "visible") setAttempt((value) => value + 1);
    };
    page.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      page.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state]);

  const scope = { ...accountScope, chartId, source: state?.pattern ? `${state.pattern.pattern_id}:${state.pattern.generated_at}` : null };
  const presentation = selectReaderReadiness({ scope, requestGeneration: requestGeneration.current, now: Date.now(), pattern: observation,
    patternDocumentMatches: Boolean(document && patternMatchesDocument(state?.pattern ?? null, document)),
    retainAcceptedPattern: Boolean(document), chapterCount: document?.core_chapters.length });
  const fresh = !busy && observation !== null && !observationReason(observation, scope, requestGeneration.current, Date.now());
  useEffect(() => {
    if (!observation || observation.evidence !== "known") return;
    const timer = window.setTimeout(() => setClockRevision(value => value + 1), Math.max(0, observation.observedAt + 60_001 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [observation]);

  const generate = async (consent: PatternConsent, reason: "first_open" | "first_open_retry" | "failed_attempt_retry") => {
    if (!fresh || observationReason(observation, scope, requestGeneration.current, Date.now()) || !presentation.pattern.actions.some(action => ["review_consent", "start_generation", "retry_generation"].includes(action.type))) return;
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true);
    setError(null);
    generateKey.current ??= newIdempotencyKey("web-pattern-generation");
    try {
      await startPatternGeneration(consent.policy_version, reason, generateKey.current, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      generateKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setObservation(previous => previous ? { ...previous, evidence: "unavailable" } : previous);
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Pattern generation could not be started.",
      );
      setRequestId(caught instanceof ApiError ? caught.requestId : null);
      setBusy(false);
    }
  };

  const erase = async () => {
    if (!fresh || observationReason(observation, scope, requestGeneration.current, Date.now()) || !document) return;
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true);
    deleteKey.current ??= newIdempotencyKey("web-pattern-delete");
    try {
      const receipt = await deleteGeneratedPattern(deleteKey.current, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setDeletionReceipt(receipt.receipt);
      clearPortraitSession();
      currentDocument.current = null;
      setDocument(null);
      deleteKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setObservation(previous => previous ? { ...previous, evidence: "unavailable" } : previous);
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(caught instanceof Error ? caught.message : "This Pattern could not be deleted.");
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (
      !fresh ||
      !presentation.patternReplacement.actions.some(action => action.type === "start_generation" || action.type === "retry_generation") ||
      regenerationInFlight.current ||
      state?.state !== "ready" ||
      !state.regeneration?.eligible ||
      state.consent?.status !== "granted"
    ) {
      return;
    }
    const controller = new AbortController(); mutation.current = controller;
    regenerationInFlight.current = true;
    setBusy(true);
    setError(null);
    setRequestId(null);
    regenerateKey.current ??= newIdempotencyKey("web-pattern-regeneration");
    try {
      // A confirmation may remain open while permission or source eligibility changes.
      const current = await getPatternState(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (current.chart?.chart_id !== chartId || current.state !== "ready" || !current.regeneration?.eligible
        || current.regeneration.generation || current.consent?.status !== "granted"
        || (current.regeneration.failure && current.regeneration.failure.retryable !== true)
        || !document || !patternMatchesDocument(current.pattern, document)) {
        setAttempt(value => value + 1);
        return;
      }
      await regeneratePattern(current.consent.policy_version, regenerateKey.current, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      regenerateKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setObservation(previous => previous ? { ...previous, evidence: "unavailable" } : previous);
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "This Pattern update could not be started.",
      );
      setRequestId(caught instanceof ApiError ? caught.requestId : null);
      setBusy(false);
    } finally {
      regenerationInFlight.current = false;
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

  if (error && (!state || (state.state === "ready" && !document))) {
    return (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
        {heading}
        <div className="pattern-chapters__failure">
          <h3>Your Pattern could not be loaded.</h3>
          <p>{withRequestId(error, requestId)}</p>
          <button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (!state || (state.state === "ready" && !document)) {
    return (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading" aria-busy="true">
        {heading}
        <p className="pattern-chapters__status" role="status">Reading Pattern state.</p>
      </section>
    );
  }

  if (state.state === "ready" && document && state.pattern) {
    return (
      <ReadyDocument
        key={`${document.pattern_id}:${document.generated_at}`}
        chartId={chartId}
        sky={sky}
        document={document}
        pattern={state.pattern}
        canCreatePortrait={fresh && state.consent?.status === "granted" && !state.regeneration?.generation}
        onUnauthorized={onUnauthorized}
        regeneration={state.regeneration}
        replacementPresentation={presentation.patternReplacement}
        fresh={fresh}
        observedAt={observation?.observedAt ?? null}
        onRegenerate={() => void regenerate()}
        onRefresh={() => setAttempt((value) => value + 1)}
        onDelete={() => void erase()}
        busy={busy}
        error={error ? withRequestId(error, requestId) : null}
      />
    );
  }

  if (isProgress(state.state)) {
    return (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading" aria-busy="true">
        {heading}
        <p className="pattern-chapters__status" role="status" data-readiness={presentation.pattern.code}>{presentation.pattern.text}</p>
        <p>This usually takes a short while. You can leave and come back.</p>
      </section>
    );
  }

  const canRetry = presentation.pattern.actions.some(action => action.type === "retry_generation");
  const details: Partial<Record<PatternState, string>> = {
    chart_required: "Your Pattern is written from calculated natal facts, so it waits for an active chart.",
    locale_confirmation_required: "The Pattern is written in the language you confirm.",
    ontology_unavailable: "No activated interpretation meanings are available. Chart facts above are unaffected.",
    deleted: "Deleting a Pattern consumes this chart's one generation. A later chart correction can start a new one.",
    withdrawn: "The meanings used to write it were recalled. Chart facts above are unaffected.",
    failed: canRetry
      ? "A failed attempt does not use up this chart's one Pattern. You can try again."
      : "A failed attempt does not use up this chart's one Pattern. A retry is not available right now. Check again for an updated status.",
    consent_required:
      "The first visit is the consent surface. Review exactly what will and will not be sent, then generate one Pattern for this chart.",
    available:
      "Standing consent is already granted. Generate one Pattern for this chart from calculated facts only.",
  };

  const consent = state.consent;
  const canGenerate =
    fresh && presentation.pattern.actions.some(action => ["review_consent", "start_generation", "retry_generation"].includes(action.type)) && consent !== null;
  const reason = state.state === "failed" ? "failed_attempt_retry" as const : "first_open" as const;

  return (
    <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
      {heading}
      <div className={state.state === "failed" ? "pattern-chapters__failure" : "pattern-chapters__empty"}>
        <h3 data-readiness={presentation.pattern.code}>{state.state === "ontology_unavailable" ? "Pattern generation is not available right now." : presentation.pattern.text}</h3>
        <p>{details[state.state] ?? "Chart facts above are unaffected."}</p>
        {deletionReceipt && <p role="status">{deletionReceipt === "accepted" ? "Deletion request accepted." : "The Pattern is already unavailable."} This is not a receipt for completed storage or provider erasure.</p>}
        {presentation.pattern.actions.filter(action => action.type === "open_birth_details" || action.type === "confirm_locale").map(action => <a className="button" key={action.type} href={readerActionRoute(action) ?? "#pattern"}>{action.type === "confirm_locale" ? "Confirm language" : "Open birth details"}</a>)}
        {error ? <p role="status">{withRequestId(error, requestId)}</p> : null}
        {canGenerate && consent ? (
          <>
            <PatternConsentTerms consent={consent} privacyLink />
            <PortraitAutomationControl chartId={chartId} onUnauthorized={onUnauthorized} onSavingChange={setPortraitPreferenceSaving} />
            <button
              className="button"
              type="button"
              onClick={() => void generate(consent, reason)}
              disabled={busy || portraitPreferenceSaving}
            >
              Generate my Pattern
            </button>
          </>
        ) : null}
        {state.state === "failed" || !fresh ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Check again
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** A corrected chart starts an isolated reader and aborts the previous chart's work. */
export function PatternExperience(props: PatternExperienceProps) {
  const scope = useReaderScope();
  return <CurrentChartPatternExperience key={`${scope.sessionEpoch}:${scope.accountId}:${props.chartId}:${scope.profileVersion}`} {...props} />;
}
