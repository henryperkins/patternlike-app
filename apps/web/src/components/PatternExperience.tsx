import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PatternConsent,
  PatternPublicChapter,
  PatternRegenerationState,
  PatternResponseV7,
  PatternState,
  PatternStateDocumentV9,
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
import { withRequestId } from "../lib/api-status.js";
import { PatternConsentTerms } from "./PatternConsent.js";

interface PatternExperienceProps {
  onUnauthorized: () => void;
}

const PROGRESS: Record<"organizing_evidence" | "writing" | "checking_claims", string> = {
  organizing_evidence: "Organizing the evidence",
  writing: "Writing your Pattern",
  checking_claims: "Checking every claim",
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
  onRegenerate,
  onRefresh,
  busy,
  error,
}: {
  regeneration: PatternRegenerationState | null;
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

  const failed = regeneration.failure;
  if (!regeneration.eligible && !failed) return null;

  return (
    <section
      className={`pattern-regeneration${failed ? " pattern-regeneration--failed" : ""}`}
      aria-labelledby="pattern-regeneration-heading"
    >
      <p className="kicker">{failed ? "Pattern update paused" : "Pattern update available"}</p>
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
            if (confirmText !== REGENERATE_CONFIRMATION || busy) return;
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
              disabled={confirmText !== REGENERATE_CONFIRMATION || busy}
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
      ) : failed && !failed.retryable ? (
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
  document,
  regeneration,
  onRegenerate,
  onRefresh,
  onDelete,
  busy,
  error,
}: {
  document: PatternResponseV7;
  regeneration: PatternRegenerationState | null;
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
      <div className="panel-heading">
        <div>
          <p className="kicker">Your Pattern</p>
          <h2 id="pattern-experience-heading">A private reading of this chart</h2>
        </div>
        <span className="panel-code">{document.locale}</span>
      </div>
      <p className="pattern-chapters__accuracy">
        Written for this chart. Chart facts above remain inspectable; individual
        paragraphs do not expose a claim-level evidence list.
      </p>
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
      <p className="pattern-provenance">
        AI-generated from your calculated chart · {generatedLabel} · Pattern {document.pattern_id}
      </p>
      <p className="pattern-provenance">
        Your birth date, time, birthplace, and coordinates were not sent to the
        model ({document.provenance.provider}).
      </p>
      <PatternRegenerationPanel
        regeneration={regeneration}
        onRegenerate={onRegenerate}
        onRefresh={onRefresh}
        busy={busy}
        error={error}
      />
      <div className="pattern-delete">
        {confirming ? (
          <form
            className="privacy-action__confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmText !== DELETE_CONFIRMATION || busy) return;
              onDelete();
            }}
          >
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
                disabled={confirmText !== DELETE_CONFIRMATION || busy}
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

export function PatternExperience({ onUnauthorized }: PatternExperienceProps) {
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

  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    try {
      const next = await getPatternState(signal);
      if (signal.aborted) return;
      setState(next);
      setError(null);
      setRequestId(null);
      if (next.state === "ready") {
        const generated = await getGeneratedPattern(signal);
        if (signal.aborted) return;
        setDocument(generated);
      } else {
        setDocument(null);
      }
    } catch (caught) {
      if (signal.aborted) return;
      if (caught instanceof ApiError && caught.status === 401) {
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
      if (!signal.aborted) setBusy(false);
    }
  }, [onUnauthorized]);

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

  const generate = async (consent: PatternConsent, reason: "first_open" | "first_open_retry" | "failed_attempt_retry") => {
    setBusy(true);
    setError(null);
    generateKey.current ??= newIdempotencyKey("web-pattern-generation");
    try {
      await startPatternGeneration(consent.policy_version, reason, generateKey.current);
      generateKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
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
    setBusy(true);
    deleteKey.current ??= newIdempotencyKey("web-pattern-delete");
    try {
      await deleteGeneratedPattern(deleteKey.current);
      deleteKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
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
      regenerationInFlight.current ||
      state?.state !== "ready" ||
      !state.regeneration?.eligible ||
      state.consent?.status !== "granted"
    ) {
      return;
    }
    regenerationInFlight.current = true;
    setBusy(true);
    setError(null);
    setRequestId(null);
    regenerateKey.current ??= newIdempotencyKey("web-pattern-regeneration");
    try {
      await regeneratePattern(state.consent.policy_version, regenerateKey.current);
      regenerateKey.current = null;
      setAttempt((value) => value + 1);
    } catch (caught) {
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

  if (error && !state) {
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

  if (!state || (busy && !state)) {
    return (
      <section className="pattern-chapters" aria-labelledby="pattern-experience-heading" aria-busy="true">
        {heading}
        <p className="pattern-chapters__status" role="status">Reading Pattern state.</p>
      </section>
    );
  }

  if (state.state === "ready" && document) {
    return (
      <ReadyDocument
        document={document}
        regeneration={state.regeneration}
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
        <p className="pattern-chapters__status" role="status">{PROGRESS[state.state]}</p>
        <p>This usually takes a short while. You can leave and come back.</p>
      </section>
    );
  }

  const titles: Partial<Record<PatternState, string>> = {
    chart_required: "Add a birth chart before a Pattern can be written.",
    locale_confirmation_required: "Confirm your content language to generate a Pattern.",
    ontology_unavailable: "Pattern generation is not available right now.",
    deleted: "This Pattern was deleted and cannot be regenerated for this chart.",
    withdrawn: "The interpretation basis for this Pattern was withdrawn.",
    failed: "This Pattern could not be finished.",
    consent_required: "Generate my Pattern",
    available: "Generate my Pattern",
  };

  const details: Partial<Record<PatternState, string>> = {
    chart_required: "Your Pattern is written from calculated natal facts, so it waits for an active chart.",
    locale_confirmation_required: "The Pattern is written in the language you confirm.",
    ontology_unavailable: "No activated interpretation meanings are available. Chart facts above are unaffected.",
    deleted: "Deleting a Pattern consumes this chart's one generation. A later chart correction can start a new one.",
    withdrawn: "The meanings used to write it were recalled. Chart facts above are unaffected.",
    failed: "A failed attempt does not use up this chart's one Pattern. You can try again.",
    consent_required:
      "The first visit is the consent surface. Review exactly what will and will not be sent, then generate one Pattern for this chart.",
    available:
      "Standing consent is already granted. Generate one Pattern for this chart from calculated facts only.",
  };

  const consent = state.consent;
  const canGenerate =
    (state.state === "consent_required" || state.state === "available" || state.state === "failed") &&
    consent !== null;
  const reason = state.state === "failed" ? "failed_attempt_retry" as const : "first_open" as const;

  return (
    <section className="pattern-chapters" aria-labelledby="pattern-experience-heading">
      {heading}
      <div className={state.state === "failed" ? "pattern-chapters__failure" : "pattern-chapters__empty"}>
        <h3>{titles[state.state] ?? "Your Pattern is not ready."}</h3>
        <p>{details[state.state] ?? "Chart facts above are unaffected."}</p>
        {error ? <p role="status">{withRequestId(error, requestId)}</p> : null}
        {canGenerate && consent ? (
          <>
            <PatternConsentTerms consent={consent} privacyLink />
            <button
              className="button"
              type="button"
              onClick={() => void generate(consent, reason)}
              disabled={busy}
            >
              Generate my Pattern
            </button>
          </>
        ) : null}
        {state.state === "failed" && canGenerate ? (
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
