import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  getReadingFeedback,
  newIdempotencyKey,
  submitReadingFeedback,
  type FeedbackResonance,
  type ReadingFeedbackRecord,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";

const OPTIONS: ReadonlyArray<{ value: FeedbackResonance; label: string }> = [
  { value: "helpful", label: "This helped" },
  { value: "neutral", label: "Mixed" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "off", label: "Off the mark" },
];

function resonanceLabel(value: FeedbackResonance): string {
  return OPTIONS.find((option) => option.value === value)?.label ?? value;
}

interface ReadingFeedbackCardProps {
  readingId: string;
}

/**
 * Structured usefulness feedback for the reading on screen.
 *
 * Resonance is stored so later readings can avoid repeating a framing the
 * reader already rejected. It does not feed the deterministic ranker —
 * `resonance_feedback` is not a ranking factor.
 */
export function ReadingFeedbackCard({ readingId }: ReadingFeedbackCardProps) {
  const [existing, setExisting] = useState<ReadingFeedbackRecord | null>(null);
  const [resonance, setResonance] = useState<FeedbackResonance | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const record = await getReadingFeedback(readingId, controller.signal);
        if (controller.signal.aborted) return;
        setExisting(record);
        setResonance(record.resonance);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setExisting(null);
          return;
        }
        // A load failure must not hide the reading. The form stays available.
        setExisting(null);
      }
    })();
    return () => controller.abort();
  }, [readingId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!resonance || busy) return;
    setBusy(true);
    setProblem(null);
    key.current ??= newIdempotencyKey("web-reading-feedback");
    try {
      const created = await submitReadingFeedback(
        readingId,
        { resonance, note: note.trim() || null },
        key.current,
      );
      key.current = null;
      setExisting({
        id: created.id,
        reading_id: created.reading_id,
        resonance,
        relevance_labels: [],
        created_at: created.created_at,
      });
    } catch (error) {
      setProblem(
        withRequestId(
          error instanceof Error
            ? error.message
            : "The feedback could not be saved.",
          error instanceof ApiError ? error.requestId : null,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reading-feedback panel" aria-labelledby="feedback-heading">
      <div className="reading-feedback__heading">
        <div>
          <p className="kicker">USR-12</p>
          <h2 id="feedback-heading">Was this useful?</h2>
        </div>
      </div>
      {existing ? (
        <p className="reading-feedback__saved">
          You marked this reading as {resonanceLabel(existing.resonance).toLowerCase()}.
        </p>
      ) : (
        <form className="reading-feedback__form" onSubmit={(event) => void submit(event)}>
          <fieldset className="reading-feedback__choices">
            <legend>How this reading landed</legend>
            <div className="reading-feedback__options">
              {OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="resonance"
                    value={option.value}
                    checked={resonance === option.value}
                    onChange={() => setResonance(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="reading-feedback__note" htmlFor="reading-feedback-note">
            <span>Optional note</span>
            <textarea
              id="reading-feedback-note"
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {problem ? (
            <p className="reading-feedback__status" role="status">
              {problem}
            </p>
          ) : null}
          <div className="reading-feedback__footer">
            <button className="button" type="submit" disabled={!resonance || busy}>
              {busy ? "Saving…" : "Save feedback"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
