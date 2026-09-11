import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import {
  READING_FEEDBACK_CATEGORIES,
  READING_FEEDBACK_USE_POLICY_VERSION,
  type ReadingFeedbackCategory,
  type ReadingFeedbackEventReceipt,
  type ReadingFeedbackEventRequest,
  type ReadingFeedbackOptionsResponse,
  type ReadingFeedbackTarget,
} from "@patternlike/shared";
import { ApiError, getReadingFeedbackOptions, newIdempotencyKey, submitReadingFeedbackEvent } from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";
import { ReadingFeedbackCard } from "./ReadingFeedbackCard.js";
import "./reading-response.css";

export const ReadingBirthCorrectionContext = createContext<(() => void) | null>(null);

interface ReadingResponseCardProps {
  readingId: string;
  revision: number;
  paragraphId?: string;
  onUnauthorized?: () => void;
}
type OptionsState =
  | { status: "loading" }
  | { status: "ready"; value: ReadingFeedbackOptionsResponse }
  | { status: "legacy" }
  | { status: "error"; message: string };
interface Attempt { key: string; body: ReadingFeedbackEventRequest; target: ReadingFeedbackTarget }
const LABELS: Record<ReadingFeedbackCategory, string> = {
  repetitive: "Repetitive",
  not_relevant_today: "Not relevant today",
  unclear: "Unclear",
};
const GRANT_COPY = {
  create: "Sending enables feedback permission for content quality, repetition control, and theme ranking.",
  reuse: "Sending uses your existing feedback permission for content quality, repetition control, and theme ranking.",
  renew: "Sending renews your feedback permission for content quality, repetition control, and theme ranking.",
};

function sameTarget(left: ReadingFeedbackTarget, right: ReadingFeedbackTarget): boolean {
  return left.reading_id === right.reading_id && left.revision === right.revision
    && left.content_hash === right.content_hash && left.paragraph_id === right.paragraph_id;
}

function validReceipt(value: ReadingFeedbackEventReceipt, target: ReadingFeedbackTarget): boolean {
  return value?.schema_version === "reading-feedback-event-receipt/v1"
    && value.feedback_use_policy_version === READING_FEEDBACK_USE_POLICY_VERSION
    && !!value.target && sameTarget(value.target, target)
    && READING_FEEDBACK_CATEGORIES.includes(value.category)
    && typeof value.id === "string" && value.id.length > 0
    && Number.isFinite(Date.parse(value.created_at)) && Number.isFinite(Date.parse(value.retention_expires_at))
    && (value.category === "unclear" ? value.effect_expires_at === null : Number.isFinite(Date.parse(value.effect_expires_at)));
}

function validOptions(value: ReadingFeedbackOptionsResponse, props: ReadingResponseCardProps): boolean {
  return value?.schema_version === "reading-feedback-options/v1"
    && value.feedback_use_policy_version === READING_FEEDBACK_USE_POLICY_VERSION
    && !!value.target && value.target.reading_id === props.readingId && value.target.revision === props.revision
    && value.target.paragraph_id === (props.paragraphId ?? null)
    && /^sha256:[a-f0-9]{64}$/.test(value.target.content_hash)
    && ["create", "reuse", "renew"].includes(value.grant_action)
    && typeof value.expected_grant_state === "string" && value.expected_grant_state.length > 0
    && value.effect_window_days === 7 && value.retention_months === 24
    && typeof value.generation_effects_active === "boolean"
    && Array.isArray(value.categories) && value.categories.length > 0 && value.categories.length <= 3
    && value.categories.every(category => READING_FEEDBACK_CATEGORIES.includes(category))
    && new Set(value.categories).size === value.categories.length
    && (value.latest_event === null || validReceipt(value.latest_event, value.target));
}

function EffectExplanation({ category, active }: { category: ReadingFeedbackCategory | ""; active: boolean }) {
  if (category === "unclear") return <p>Unclear responses are recorded for content quality and are not offered to generation.</p>;
  if (!active) return <p>Generation use is currently off. Recording a response does not show that it influenced a reading.</p>;
  if (!category) return null;
  return <p>{category === "repetitive"
    ? "Repetition control may use this response for up to seven days while feedback permission remains active."
    : "Theme ranking may use this response for up to seven days, only when this reading has supported theme associations and feedback permission remains active."}
    {" "}Eligibility does not establish that a later reading used it.</p>;
}

export function ReadingResponseCard(props: ReadingResponseCardProps) {
  return <ReadingResponse key={`${props.readingId}:${props.revision}:${props.paragraphId ?? "whole"}`} {...props} />;
}

function ReadingResponse(props: ReadingResponseCardProps) {
  const { readingId, revision, paragraphId, onUnauthorized } = props;
  const id = useId();
  const correctBirth = useContext(ReadingBirthCorrectionContext);
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [category, setCategory] = useState<ReadingFeedbackCategory | "">("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReadingFeedbackEventReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [overallOpen, setOverallOpen] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const mutationPending = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const nextFocus = useRef<"heading" | "receipt" | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  async function loadOptions(showLatestReceipt = true) {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setOptions({ status: "loading" });
    try {
      const value = await getReadingFeedbackOptions(readingId, { revision, paragraph_id: paragraphId }, controller.signal);
      if (controller.signal.aborted) return;
      if (!validOptions(value, props)) throw new Error("The response options did not match this edition or supported policy.");
      setOptions({ status: "ready", value });
      setReceipt(showLatestReceipt ? value.latest_event : null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) { onUnauthorizedRef.current?.(); return; }
      if (error instanceof ApiError && error.status === 404) { setOptions({ status: "legacy" }); return; }
      setOptions({ status: "error", message: withRequestId(error instanceof Error ? error.message : "Try again when the connection is available.", error instanceof ApiError ? error.requestId : null) });
    }
  }

  useEffect(() => {
    void loadOptions();
    return () => {
      loadController.current?.abort();
      mutationController.current?.abort();
      attemptRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (options.status !== "ready" || !nextFocus.current) return;
    const target = nextFocus.current === "receipt" ? receiptRef.current : headingRef.current;
    if (target) { target.focus({ preventScroll: true }); nextFocus.current = null; }
  }, [options.status, receipt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (options.status !== "ready" || !category || mutationPending.current) return;
    const current = attemptRef.current ?? {
      key: newIdempotencyKey("web-feedback-event"),
      target: options.value.target,
      body: {
        schema_version: "reading-feedback-event/v1" as const,
        category,
        revision: options.value.target.revision,
        content_hash: options.value.target.content_hash,
        paragraph_id: options.value.target.paragraph_id,
        note: note.trim() || null,
        feedback_use_policy_version: options.value.feedback_use_policy_version,
        expected_grant_state: options.value.expected_grant_state,
        confirm_feedback_use: true as const,
      },
    };
    attemptRef.current = current;
    setAttempt(current);
    mutationPending.current = true;
    setBusy(true);
    setProblem("");
    const controller = new AbortController();
    mutationController.current = controller;
    try {
      const created = await submitReadingFeedbackEvent(readingId, current.body, current.key, controller.signal);
      if (controller.signal.aborted) return;
      if (!validReceipt(created, current.target) || created.category !== current.body.category) throw new Error("The response receipt did not match your submission.");
      nextFocus.current = "receipt";
      setReceipt(created);
      setNote("");
      attemptRef.current = null;
      setAttempt(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) { onUnauthorizedRef.current?.(); return; }
      if (error instanceof ApiError && error.status === 409) {
        nextFocus.current = "heading";
        attemptRef.current = null;
        setAttempt(null);
        setProblem(error.code === "feedback_use_changed"
          ? "Feedback permission changed. Review the updated explanation and send again if you want to continue."
          : "This response could not be confirmed. Review the refreshed options before sending again.");
        await loadOptions(false);
        return;
      }
      setProblem(withRequestId(
        `Your response is not confirmed. Retrying sends the same response with the same submission identity. ${error instanceof Error ? error.message : "Please try again."}`,
        error instanceof ApiError ? error.requestId : null,
      ));
    } finally {
      if (!controller.signal.aborted) { mutationPending.current = false; setBusy(false); }
    }
  }

  if (options.status === "legacy") return <ReadingFeedbackCard readingId={readingId} onUnauthorized={onUnauthorized} />;
  if (options.status === "loading") return <section className="reading-feedback" aria-label="Reading response"><p role="status">Checking response options.</p></section>;
  if (options.status === "error") return <>
    <section className="reading-feedback reading-response" aria-label="Reading response options">
      <p role="status">Response options could not be checked.</p><p>{options.message}</p>
      <button className="reading-feedback__send" type="button" onClick={() => void loadOptions()}>Retry response options</button>
    </section>
    <ReadingFeedbackCard readingId={readingId} onUnauthorized={onUnauthorized} />
  </>;
  const document = options.value;
  const targetLabel = paragraphId ? "passage" : "chapter";
  const effectExpired = receipt?.effect_expires_at != null && Date.parse(receipt.effect_expires_at) <= Date.now();
  return <section className="reading-feedback reading-response" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} ref={headingRef} tabIndex={-1}>Respond to this {targetLabel}</h2>
    {receipt ? <>
      <p className="reading-feedback__saved" role="status" aria-label="Categorical feedback receipt" ref={receiptRef} tabIndex={-1}>Recorded for this {targetLabel}: {LABELS[receipt.category]}. The published text stays as it is.</p>
      {document.generation_effects_active && effectExpired
        ? <p>The seven-day generation window has expired. The stored response remains available until its retention limit or deletion.</p>
        : <EffectExplanation category={receipt.category} active={document.generation_effects_active} />}
      {document.generation_effects_active && receipt.effect_expires_at && !effectExpired ? <p>Possible generation use expires {formatInstant(receipt.effect_expires_at)}.</p> : null}
      <p>The response and any encrypted note are retained until {formatInstant(receipt.retention_expires_at)} under the 24-month storage limit. Notes are not offered as generation context.</p>
      <button type="button" className="reading-feedback__send" onClick={() => { nextFocus.current = "heading"; setCategory(""); setNoteOpen(false); setProblem(""); void loadOptions(false); }}>Give another response</button>
    </> : <form onSubmit={event => void submit(event)}>
      <p id={`${id}-invite`}>Optional. This responds to the published {targetLabel}; it does not change its text or submit a check-in.</p>
      <p id={`${id}-permission`}>{GRANT_COPY[document.grant_action]} This does not enable model training.</p>
      <p id={`${id}-storage`}>Responses and optional encrypted notes are stored for up to 24 months. Notes are not offered as generation context. Turning permission off stops future use; it does not erase stored feedback.</p>
      <fieldset className="reading-feedback__choices" disabled={busy || attempt !== null} aria-describedby={`${id}-invite ${id}-permission ${id}-storage`}>
        <legend>What would you like to tell us?</legend>
        <div className="reading-feedback__options">
          {document.categories.map(value => <label key={value}><input name={`${id}-category`} type="radio" value={value} checked={category === value} onChange={() => setCategory(value)} /><span>{LABELS[value]}</span></label>)}
        </div>
      </fieldset>
      <div className="reading-response__effect" aria-live="polite"><EffectExplanation category={category} active={document.generation_effects_active} /></div>
      {category ? <>
        <button className="reading-feedback__note-toggle" type="button" aria-expanded={noteOpen} aria-controls={`${id}-note`} disabled={busy || attempt !== null} onClick={() => setNoteOpen(open => !open)}>{noteOpen ? "Hide note" : "Add a note"}</button>
        {noteOpen ? <label className="reading-feedback__note" htmlFor={`${id}-note`}><span>Optional note</span><textarea id={`${id}-note`} value={note} rows={2} maxLength={2000} disabled={busy || attempt !== null} onChange={event => setNote(event.target.value)} /></label> : null}
        {problem ? <p role="status">{problem}</p> : null}
        <div className="reading-feedback__footer"><button className="reading-feedback__send" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Sending…" : attempt ? "Retry response" : "Send response"}</button></div>
      </> : null}
    </form>}
    <div className="reading-response__correction">
      <a href="#privacy" onClick={event => { if (correctBirth) { event.preventDefault(); correctBirth(); } }}>My birth details are wrong</a>
      <p>Open birth correction in Privacy. Opening it changes nothing. Submitting different details supersedes your chart and may withhold Today readings tied to it until a successor is available.</p>
    </div>
    <details className="reading-response__overall" onToggle={event => setOverallOpen(event.currentTarget.open)}>
      <summary>Give an overall response</summary>
      {overallOpen ? <ReadingFeedbackCard readingId={readingId} onUnauthorized={onUnauthorized} /> : null}
    </details>
  </section>;
}
