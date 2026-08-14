import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  LifeEvent,
  LifeEventCategory,
  LifeEventPrecision,
  LifeEventRequest,
  LifeEventSignificance,
  TimeTravelResponse,
} from "@patternlike/shared";

import {
  ApiError,
  createLifeEvent,
  deleteLifeEvent,
  listLifeEvents,
  newIdempotencyKey,
  updateLifeEvent,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import {
  LIFE_EVENT_CATEGORIES,
  LIFE_EVENT_PRECISIONS,
  LIFE_EVENT_SIGNIFICANCE,
  isIsoDate,
  lifeEventCategoryLabel,
  lifeEventWindowEnd,
  lifeEventSignificanceLabel,
  lifeEventWindowLabel,
  todayIsoDate,
} from "../lib/travel-format.js";
import { Icon } from "./icons.js";

const M4_SCHEMA_VERSION = "0.4.0" as const;

type SourceState = TimeTravelResponse["life_event_source_state"];

interface LifeEventTimelineProps {
  /** The most recent source state the Time Travel response reported. */
  sourceState: SourceState;
  /** Selected local date, used only to mark which saved events overlap it. */
  selectedDate: string;
  onUnauthorized: () => void;
  /** Lets the page re-read Time Travel after the saved set changes. */
  onEventsChanged: () => void;
}

type ListState =
  | { status: "loading" }
  | { status: "ready"; events: LifeEvent[] }
  | { status: "unreadable"; message: string };

interface DraftEvent {
  start_date: string;
  end_date: string;
  precision: LifeEventPrecision;
  category: LifeEventCategory;
  significance: LifeEventSignificance;
  title: string;
  note: string;
  use_in_time_travel: boolean;
}

function emptyDraft(): DraftEvent {
  return {
    start_date: todayIsoDate(),
    end_date: "",
    precision: "day",
    category: "other",
    significance: "medium",
    title: "",
    note: "",
    // Never pre-checked. Sending a saved event into a reconstruction is the
    // whole privacy decision this form exists to ask, so it is opt-in per event
    // even after the source itself is enabled.
    use_in_time_travel: false,
  };
}

function draftFromEvent(event: LifeEvent): DraftEvent {
  return {
    start_date: event.start_date,
    end_date: event.end_date ?? "",
    precision: event.precision,
    category: event.category,
    significance: event.significance,
    title: event.title,
    note: event.note ?? "",
    use_in_time_travel: event.use_in_time_travel,
  };
}

function toRequest(draft: DraftEvent): LifeEventRequest {
  return {
    schema_version: M4_SCHEMA_VERSION,
    start_date: draft.start_date,
    // Only a range carries an end date. The server derives a month's or a
    // year's window itself, and sending one there is a rejected request.
    end_date: draft.precision === "range" && draft.end_date ? draft.end_date : null,
    precision: draft.precision,
    category: draft.category,
    significance: draft.significance,
    title: draft.title.trim(),
    note: draft.note.trim() ? draft.note.trim() : null,
    use_in_time_travel: draft.use_in_time_travel,
  };
}

/** Client-side refusals that name the problem before a round trip spends one. */
function draftProblem(draft: DraftEvent): string | null {
  if (draft.title.trim().length === 0) return "Give the event a short title.";
  if (draft.title.trim().length > 160) return "Keep the title to 160 characters or fewer.";
  if (draft.note.length > 2000) return "Keep the note to 2000 characters or fewer.";
  if (!isIsoDate(draft.start_date)) return "Enter a real start date.";
  if (draft.precision === "range") {
    if (!isIsoDate(draft.end_date)) return "A range needs an end date.";
    if (draft.end_date < draft.start_date) return "The end date cannot precede the start date.";
  }
  const end = lifeEventWindowEnd(draft.start_date, draft.precision, draft.end_date);
  if (!end) return "That date and precision do not describe a real window.";
  if (end > todayIsoDate()) {
    // The whole window has to have happened. Naming the derived end date is
    // what makes a rejected "this month" comprehensible: the reader picked a
    // day in the past and the precision widened it into the future.
    return draft.precision === "day" || draft.precision === "range"
      ? "This records what happened, so the window cannot end in the future."
      : `A ${draft.precision} runs to ${end}, which has not finished yet. Choose an earlier one.`;
  }
  return null;
}

function overlapsSelected(event: LifeEvent, selectedDate: string): boolean {
  // Mirrors the server's normalization so the marker cannot claim an overlap
  // the route would not honour. It is a label, never an authorization.
  const [year, month] = event.start_date.split("-");
  if (!year || !month) return false;
  switch (event.precision) {
    case "day":
      return selectedDate === event.start_date;
    case "month":
      return selectedDate.slice(0, 7) === `${year}-${month}`;
    case "year":
      return selectedDate.slice(0, 4) === year;
    case "range":
      return (
        selectedDate >= event.start_date &&
        selectedDate <= (event.end_date ?? event.start_date)
      );
    default:
      return false;
  }
}

interface EventFormProps {
  legend: string;
  draft: DraftEvent;
  busy: boolean;
  problem: string;
  submitLabel: string;
  onChange: (next: DraftEvent) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function EventForm({
  legend,
  draft,
  busy,
  problem,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: EventFormProps) {
  const ids = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!busy) onSubmit();
  };

  return (
    <form className="life-event-form" onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <legend>{legend}</legend>

        <div className="life-event-form__grid">
          <label htmlFor={`${ids}-title`}>
            <span>Title</span>
            <input
              id={`${ids}-title`}
              ref={firstFieldRef}
              type="text"
              maxLength={160}
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
            />
          </label>

          <label htmlFor={`${ids}-precision`}>
            <span>How exactly do you know when?</span>
            <select
              id={`${ids}-precision`}
              value={draft.precision}
              onChange={(event) =>
                onChange({
                  ...draft,
                  precision: event.currentTarget.value as LifeEventPrecision,
                })
              }
            >
              {LIFE_EVENT_PRECISIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              {LIFE_EVENT_PRECISIONS.find((item) => item.value === draft.precision)?.hint}
            </small>
          </label>

          <label htmlFor={`${ids}-start`}>
            <span>{draft.precision === "range" ? "Start date" : "Date"}</span>
            <input
              id={`${ids}-start`}
              type="date"
              value={draft.start_date}
              max={todayIsoDate()}
              onChange={(event) =>
                onChange({ ...draft, start_date: event.currentTarget.value })
              }
            />
          </label>

          {draft.precision === "range" ? (
            <label htmlFor={`${ids}-end`}>
              <span>End date</span>
              <input
                id={`${ids}-end`}
                type="date"
                value={draft.end_date}
                max={todayIsoDate()}
                onChange={(event) =>
                  onChange({ ...draft, end_date: event.currentTarget.value })
                }
              />
            </label>
          ) : null}

          <label htmlFor={`${ids}-category`}>
            <span>Category</span>
            <select
              id={`${ids}-category`}
              value={draft.category}
              onChange={(event) =>
                onChange({
                  ...draft,
                  category: event.currentTarget.value as LifeEventCategory,
                })
              }
            >
              {LIFE_EVENT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor={`${ids}-significance`}>
            <span>Significance to you</span>
            <select
              id={`${ids}-significance`}
              value={draft.significance}
              onChange={(event) =>
                onChange({
                  ...draft,
                  significance: event.currentTarget.value as LifeEventSignificance,
                })
              }
            >
              {LIFE_EVENT_SIGNIFICANCE.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="life-event-form__note" htmlFor={`${ids}-note`}>
          <span>Private note (optional)</span>
          <textarea
            id={`${ids}-note`}
            rows={3}
            maxLength={2000}
            value={draft.note}
            onChange={(event) => onChange({ ...draft, note: event.currentTarget.value })}
          />
        </label>

        <label className="life-event-form__use" htmlFor={`${ids}-use`}>
          <input
            id={`${ids}-use`}
            type="checkbox"
            checked={draft.use_in_time_travel}
            onChange={(event) =>
              onChange({ ...draft, use_in_time_travel: event.currentTarget.checked })
            }
          />
          <span>
            Show this event beside a reconstructed date.
            <small>
              It is listed next to the calculation, never mixed into it. Nothing here
              claims one caused the other.
            </small>
          </span>
        </label>

        <div className="life-event-form__actions">
          <button className="button button--primary" type="submit" aria-busy={busy}>
            {submitLabel}
          </button>
          <button className="button button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>

      <p className="life-event-form__status" role="status" aria-live="polite">
        {busy ? "Saving this event." : problem}
      </p>
    </form>
  );
}

export function LifeEventTimeline({
  sourceState,
  selectedDate,
  onUnauthorized,
  onEventsChanged,
}: LifeEventTimelineProps) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftEvent>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [rowProblem, setRowProblem] = useState<{ id: string; message: string } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  // One key per user intent: a retry after a transient failure resumes the same
  // revision instead of stacking a second one.
  const keys = useRef<Partial<Record<string, string>>>({});

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await listLifeEvents(controller.signal);
        if (!controller.signal.aborted) {
          setList({ status: "ready", events: response.items });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setList({
          status: "unreadable",
          message:
            error instanceof ApiError
              ? withRequestId(error.message, error.requestId)
              : error instanceof Error
                ? error.message
                : "Saved events could not be read.",
        });
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized, reload]);

  useEffect(() => {
    if (returnFocus && !composing && editingId === null) {
      setReturnFocus(false);
      addButtonRef.current?.focus();
    }
  }, [composing, editingId, returnFocus]);

  const closeEditor = useCallback(() => {
    setComposing(false);
    setEditingId(null);
    setProblem("");
    setReturnFocus(true);
  }, []);

  const failureMessage = (error: unknown, fallback: string): string =>
    error instanceof ApiError
      ? withRequestId(error.message, error.requestId)
      : error instanceof Error
        ? error.message
        : fallback;

  const save = useCallback(() => {
    const invalid = draftProblem(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    void (async () => {
      setBusy(true);
      setProblem("");
      const request = toRequest(draft);
      const keyId = editingId ? `update:${editingId}` : "create";
      keys.current[keyId] ??= newIdempotencyKey("web-life-event");
      try {
        if (editingId) {
          await updateLifeEvent(editingId, request, keys.current[keyId]!);
        } else {
          await createLifeEvent(request, keys.current[keyId]!);
        }
        delete keys.current[keyId];
        setReload((value) => value + 1);
        onEventsChanged();
        closeEditor();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setProblem(failureMessage(error, "That event could not be saved."));
      } finally {
        setBusy(false);
      }
    })();
  }, [closeEditor, draft, editingId, onEventsChanged, onUnauthorized]);

  const toggleUse = useCallback(
    (event: LifeEvent) => {
      void (async () => {
        setBusy(true);
        setRowProblem(null);
        const next = { ...draftFromEvent(event), use_in_time_travel: !event.use_in_time_travel };
        const keyId = `use:${event.id}:${next.use_in_time_travel}`;
        keys.current[keyId] ??= newIdempotencyKey("web-life-event-use");
        try {
          await updateLifeEvent(event.id, toRequest(next), keys.current[keyId]!);
          delete keys.current[keyId];
          setReload((value) => value + 1);
          onEventsChanged();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            onUnauthorized();
            return;
          }
          setRowProblem({
            id: event.id,
            message: failureMessage(error, "That change could not be saved."),
          });
        } finally {
          setBusy(false);
        }
      })();
    },
    [onEventsChanged, onUnauthorized],
  );

  const remove = useCallback(
    (event: LifeEvent) => {
      void (async () => {
        setBusy(true);
        setRowProblem(null);
        const keyId = `delete:${event.id}`;
        keys.current[keyId] ??= newIdempotencyKey("web-life-event-delete");
        try {
          await deleteLifeEvent(event.id, keys.current[keyId]!);
          delete keys.current[keyId];
          setConfirmingId(null);
          setReload((value) => value + 1);
          onEventsChanged();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            onUnauthorized();
            return;
          }
          setRowProblem({
            id: event.id,
            message: failureMessage(error, "That event could not be deleted."),
          });
        } finally {
          setBusy(false);
        }
      })();
    },
    [onEventsChanged, onUnauthorized],
  );

  const canWrite = sourceState === "active";
  const editorOpen = composing || editingId !== null;

  return (
    <section className="life-events" aria-labelledby="life-events-heading">
      <div className="life-events__header">
        <div>
          <p className="kicker">Your record, kept separate</p>
          <h2 id="life-events-heading">Saved life events</h2>
        </div>
        {canWrite && !editorOpen ? (
          <button
            className="button button--secondary"
            type="button"
            ref={addButtonRef}
            onClick={() => {
              setDraft(emptyDraft());
              setProblem("");
              setComposing(true);
            }}
          >
            Add an event <Icon name="arrow" />
          </button>
        ) : null}
      </div>

      <p className="life-events__boundary">
        These are your own notes. They sit beside a reconstruction and are never
        evidence for it: nothing here says the sky caused, predicted, or explains
        what happened to you.
      </p>

      {/*
        Says what this section can and cannot do, not what the reconstruction
        above already said about the same permission. Listing and deleting stay
        available in every off state: retained data a reader cannot inspect or
        remove is the thing the source control is supposed to prevent.
      */}
      {!canWrite ? (
        <p className="life-events__source-off">
          {sourceState === "never_granted"
            ? "Adding an event needs the Life-event timeline permission. You can turn it on, one event at a time, without it ever writing into a calculation."
            : "Adding and editing are off while this permission is not active. Everything you saved stays listed here, and you can still delete it."}{" "}
          <a className="inline-link" href="#privacy">
            Open Context &amp; privacy <Icon name="arrow" />
          </a>
        </p>
      ) : null}

      {editorOpen ? (
        <EventForm
          legend={editingId ? "Edit this event" : "Add an event"}
          draft={draft}
          busy={busy}
          problem={problem}
          submitLabel={editingId ? "Save this revision" : "Save this event"}
          onChange={setDraft}
          onSubmit={save}
          onCancel={closeEditor}
        />
      ) : null}

      {list.status === "loading" ? (
        <p className="life-events__status" role="status" aria-live="polite">
          Reading your saved events.
        </p>
      ) : null}

      {list.status === "unreadable" ? (
        <div className="life-events__failure">
          <p>{list.message}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setList({ status: "loading" });
              setReload((value) => value + 1);
            }}
          >
            Try again <Icon name="refresh" />
          </button>
        </div>
      ) : null}

      {list.status === "ready" && list.events.length === 0 ? (
        <p className="life-events__empty">
          Nothing saved yet. An event you add is stored encrypted and is shown beside a
          reconstructed date only when you ask for it, one event at a time.
        </p>
      ) : null}

      {list.status === "ready" && list.events.length > 0 ? (
        <ul className="life-events__list">
          {list.events.map((event) => {
            const overlapping = overlapsSelected(event, selectedDate);
            return (
              <li key={event.id}>
                <article className="life-event" aria-label={event.title}>
                  <div className="life-event__head">
                    <h3>{event.title}</h3>
                    <p className="life-event__window">{lifeEventWindowLabel(event)}</p>
                  </div>

                  <dl className="life-event__facts">
                    <div>
                      <dt>Category</dt>
                      <dd>{lifeEventCategoryLabel(event.category)}</dd>
                    </div>
                    <div>
                      <dt>Significance</dt>
                      <dd>{lifeEventSignificanceLabel(event.significance)}</dd>
                    </div>
                    <div>
                      <dt>In Time Travel</dt>
                      <dd>{event.use_in_time_travel ? "Shown" : "Not shown"}</dd>
                    </div>
                    <div>
                      <dt>On the selected date</dt>
                      <dd>{overlapping ? "Overlaps" : "Does not overlap"}</dd>
                    </div>
                  </dl>

                  {event.note ? <p className="life-event__note">{event.note}</p> : null}

                  <div className="life-event__actions">
                    <button
                      type="button"
                      onClick={() => toggleUse(event)}
                      disabled={!canWrite || busy}
                    >
                      {event.use_in_time_travel
                        ? "Stop showing in Time Travel"
                        : "Show in Time Travel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(draftFromEvent(event));
                        setProblem("");
                        setEditingId(event.id);
                      }}
                      disabled={!canWrite || busy}
                    >
                      Edit
                    </button>
                    {confirmingId === event.id ? null : (
                      <button
                        type="button"
                        className="life-event__delete"
                        onClick={() => setConfirmingId(event.id)}
                        disabled={busy}
                        aria-expanded={false}
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {confirmingId === event.id ? (
                    <div className="life-event__confirm">
                      <p>
                        Delete “{event.title}” and every stored revision of it? This cannot
                        be undone.
                      </p>
                      <div className="life-event__confirm-actions">
                        <button
                          className="button button--danger"
                          type="button"
                          onClick={() => remove(event)}
                          disabled={busy}
                          aria-busy={busy}
                        >
                          Delete permanently
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={busy}
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <p className="life-event__status" role="status" aria-live="polite">
                    {rowProblem?.id === event.id ? rowProblem.message : ""}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
