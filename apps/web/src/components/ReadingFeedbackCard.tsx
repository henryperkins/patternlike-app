import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  getReadingFeedback,
  newIdempotencyKey,
  submitReadingFeedback,
  type FeedbackResonance,
  type ReadingFeedbackRecord,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { Icon, type IconName } from "./icons.js";

const OPTIONS: ReadonlyArray<{
  value: FeedbackResonance;
  label: string;
  icon: IconName;
}> = [
  { value: "helpful", label: "This helped", icon: "check" },
  { value: "neutral", label: "Mixed", icon: "mixed" },
  { value: "not_helpful", label: "Not quite", icon: "almost" },
  { value: "off", label: "Off the mark", icon: "miss" },
];

function resonanceLabel(value: FeedbackResonance): string {
  return OPTIONS.find((option) => option.value === value)?.label ?? value;
}

interface ReadingFeedbackCardProps {
  readingId: string;
  onUnauthorized?: () => void;
}

/**
 * A quiet postscript, not a second panel.
 *
 * The receipt confirms storage for this reading. Permission and generation
 * admission determine later use; note text is never generation context.
 */
export function ReadingFeedbackCard({
  readingId,
  onUnauthorized,
}: ReadingFeedbackCardProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const inviteId = `${id}-invite`;
  const permissionId = `${id}-permission`;
  const noteId = `${id}-note`;
  const [existing, setExisting] = useState<ReadingFeedbackRecord | null>(null);
  const [resonance, setResonance] = useState<FeedbackResonance | "">("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const epoch = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    mutationController.current?.abort();
    mutationPending.current = false;
    const currentEpoch = ++epoch.current;
    setExisting(null);
    setResonance("");
    setNote("");
    setNoteOpen(false);
    setBusy(false);
    setProblem(null);
    key.current = null;
    void (async () => {
      try {
        const record = await getReadingFeedback(readingId, controller.signal);
        if (controller.signal.aborted || epoch.current !== currentEpoch) return;
        setExisting(record);
        setResonance(record.resonance);
      } catch (error) {
        if (controller.signal.aborted || epoch.current !== currentEpoch) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorizedRef.current?.();
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setExisting(null);
          return;
        }
        // A load failure must not hide the reading. The form stays available.
        setExisting(null);
      }
    })();
    return () => {
      controller.abort();
      mutationController.current?.abort();
      mutationPending.current = false;
      epoch.current += 1;
    };
  }, [readingId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!resonance || mutationPending.current) return;
    mutationPending.current = true;
    loadController.current?.abort();
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    const currentEpoch = epoch.current;
    const submittedResonance = resonance;
    setBusy(true);
    setProblem(null);
    key.current ??= newIdempotencyKey("web-reading-feedback");
    try {
      const created = await submitReadingFeedback(
        readingId,
        { resonance, note: note.trim() || null },
        key.current,
        controller.signal,
      );
      if (controller.signal.aborted || epoch.current !== currentEpoch) return;
      key.current = null;
      setExisting({
        id: created.id,
        reading_id: created.reading_id,
        resonance: submittedResonance,
        relevance_labels: [],
        created_at: created.created_at,
      });
    } catch (error) {
      if (controller.signal.aborted || epoch.current !== currentEpoch) return;
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorizedRef.current?.();
        return;
      }
      setProblem(
        withRequestId(
          error instanceof Error
            ? error.message
            : "The feedback could not be saved.",
          error instanceof ApiError ? error.requestId : null,
        ),
      );
    } finally {
      if (epoch.current === currentEpoch) {
        mutationPending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <section className="reading-feedback" aria-labelledby={headingId}>
      <h2 id={headingId}>Did this meet you?</h2>
      {existing ? (
        <>
          <p className="reading-feedback__saved" role="status" aria-label="Feedback receipt">
            Noted — {resonanceLabel(existing.resonance).toLowerCase()}.
            {" "}Recorded for this chapter. The published text stays as it is.
          </p>
          <p className="reading-feedback__permission">
            With active feedback permission, your choice may be used for repetition
            control and theme ranking in later readings. This receipt does not
            establish that a later reading used it. Notes are not used to write
            readings.
          </p>
        </>
      ) : (
        <form className="reading-feedback__form" onSubmit={(event) => void submit(event)}>
          <p className="reading-feedback__invite" id={inviteId}>
            Optional feedback on this chapter. It never changes the published text.
          </p>
          <p className="reading-feedback__permission" id={permissionId}>
            Sending this uses feedback permission for content quality, repetition
            control, and theme ranking, turning it back on if you had turned it off.
            An optional note is stored encrypted and is not used to write readings.
            This does not enable model training.
          </p>
          <fieldset
            className="reading-feedback__choices"
            aria-describedby={`${inviteId} ${permissionId}`}
          >
            <legend>How this reading landed</legend>
            <div className="reading-feedback__options">
              {OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name={`${id}-resonance`}
                    value={option.value}
                    checked={resonance === option.value}
                    onChange={() => setResonance(option.value)}
                  />
                  <span>
                    <Icon name={option.icon} />
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {resonance ? (
            <>
              <button
                className="reading-feedback__note-toggle"
                type="button"
                aria-expanded={noteOpen}
                aria-controls={noteId}
                onClick={() => setNoteOpen((open) => !open)}
              >
                <Icon name={noteOpen ? "minus" : "plus"} />
                {noteOpen ? "Hide the note" : "A sentence, if you want"}
              </button>
              {noteOpen ? (
                <label className="reading-feedback__note" htmlFor={noteId}>
                  <span>A sentence, if you want</span>
                  <textarea
                    id={noteId}
                    rows={2}
                    maxLength={2000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              ) : null}
              {problem ? (
                <p className="reading-feedback__status" role="status">
                  {problem}
                </p>
              ) : null}
              <div className="reading-feedback__footer">
                <button className="reading-feedback__send" type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send this"}
                  <Icon name="arrow" />
                </button>
              </div>
            </>
          ) : null}
        </form>
      )}
    </section>
  );
}
