import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiError,
  getAiSynthesisConsent,
  getContextSources,
  newIdempotencyKey,
  saveDailyCheckIn,
  type CheckInLevel,
  type CheckInRequest,
  type CheckInSignal,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";
import { Icon, type IconName } from "./icons.js";

type Availability =
  | { status: "loading" }
  | { status: "active" }
  | { status: "inactive"; label: string }
  | { status: "unavailable"; message: string; requestId: string | null };

interface CheckInForm {
  energy: CheckInLevel | "";
  pressure: CheckInLevel | "";
  clarity: CheckInLevel | "";
  connection: CheckInLevel | "";
  focusDomain: string;
  note: string;
}

const INITIAL_FORM: CheckInForm = {
  energy: "",
  pressure: "",
  clarity: "",
  connection: "",
  focusDomain: "",
  note: "",
};

const SOURCE_LABELS: Record<string, string> = {
  paused: "paused",
  revoked: "revoked",
  expired: "expired",
  never_granted: "not enabled",
};

/**
 * Wire values stay low/medium/high. The visible words are how a person might
 * answer "How are you arriving?" rather than a Likert scale.
 */
const ENERGY_LEVELS: ReadonlyArray<{
  value: CheckInLevel;
  label: string;
  hint: string;
  icon: IconName;
}> = [
  { value: "low", label: "Quiet", hint: "Held back", icon: "quiet" },
  { value: "medium", label: "Steady", hint: "Enough to move", icon: "steady" },
  { value: "high", label: "Full", hint: "A lot in motion", icon: "full" },
];

function buildRequest(form: CheckInForm): CheckInRequest {
  const request: CheckInRequest = {
    energy: form.energy as CheckInLevel,
    expires_in_seconds: 86400,
  };
  if (form.pressure) request.pressure = form.pressure;
  if (form.clarity) request.clarity = form.clarity;
  if (form.connection) request.connection = form.connection;
  if (form.focusDomain.trim()) request.focus_domain = form.focusDomain.trim();
  if (form.note.trim()) request.note = form.note.trim();
  return request;
}

function LevelSelect({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: CheckInLevel | "";
  onChange: (value: CheckInLevel | "") => void;
}) {
  return (
    <label className="daily-check-in__field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CheckInLevel | "")}
      >
        <option value="">Leave aside</option>
        {ENERGY_LEVELS.map((level) => (
          <option value={level.value} key={level.value}>{level.label}</option>
        ))}
      </select>
      <span className="daily-check-in__field-hint">{hint}</span>
    </label>
  );
}

export function DailyCheckInCard() {
  const [availability, setAvailability] = useState<Availability>({ status: "loading" });
  const [personalContextEligible, setPersonalContextEligible] = useState<boolean | null>(null);
  const [form, setForm] = useState<CheckInForm>(INITIAL_FORM);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState<CheckInSignal | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [sourcesResult, consentResult] = await Promise.allSettled([
        getContextSources(controller.signal),
        getAiSynthesisConsent(controller.signal),
      ]);
      if (controller.signal.aborted) return;

      if (consentResult.status === "fulfilled") {
        setPersonalContextEligible(
          consentResult.value.status === "granted" &&
          consentResult.value.enabled_categories.includes("enabled_personal_context"),
        );
      }

      if (sourcesResult.status === "rejected") {
        const error = sourcesResult.reason;
        setAvailability({
          status: "unavailable",
          message:
            error instanceof Error
              ? error.message
              : "Daily check-in permission could not be read.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
        return;
      }

      const source = sourcesResult.value.sources[0];
      setAvailability(
        source.enabled && source.permission_state === "active"
          ? { status: "active" }
          : {
              status: "inactive",
              label: SOURCE_LABELS[source.permission_state] ?? "inactive",
            },
      );
    })();
    return () => controller.abort();
  }, []);

  const editForm = <Key extends keyof CheckInForm>(key: Key, value: CheckInForm[Key]) => {
    idempotencyKey.current = null;
    setProblem("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.energy || availability.status !== "active") {
      setProblem("Choose how you are arriving before keeping this.");
      return;
    }

    setBusy(true);
    setProblem("");
    idempotencyKey.current ??= newIdempotencyKey("web-check-in");
    try {
      const signal = await saveDailyCheckIn(
        buildRequest(form),
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      setSaved(signal);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? withRequestId(error.message, error.requestId)
          : error instanceof Error
            ? error.message
            : "This check-in could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = () => {
    idempotencyKey.current = null;
    setProblem("");
    setSaved(null);
  };

  return (
    <section className="daily-check-in" aria-labelledby="daily-check-in-heading">
      <div className="daily-check-in__heading">
        <h2 id="daily-check-in-heading">How are you arriving?</h2>
        <p className="daily-check-in__retention">Private · one day</p>
      </div>

      {availability.status === "loading" ? (
        <p>Seeing whether check-in is available.</p>
      ) : availability.status === "unavailable" ? (
        <>
          <p>{withRequestId(availability.message, availability.requestId)}</p>
          <a className="daily-check-in__privacy-link" href="#privacy">
            Review privacy controls
          </a>
        </>
      ) : availability.status === "inactive" ? (
        <div className="daily-check-in__inactive">
          <p>
            Check-in is {availability.label}. Nothing is recorded until you
            turn this source on.
          </p>
          <a className="button button--secondary" href="#privacy">
            Open check-in permission
          </a>
        </div>
      ) : saved ? (
        <div className="daily-check-in__saved">
          <p className="daily-check-in__until">
            <Icon name="check" />
            Held until {formatInstant(saved.freshness.expires_at)}
          </p>
          <p>
            {personalContextEligible === true
              ? "The next reading can use this. Today's chapter stays as it is."
              : personalContextEligible === false
                ? "Saved, and kept from the publisher until reading generation includes personal context. Today's chapter stays as it is."
                : "Saved. Today's chapter stays as it is."}
          </p>
          <button className="button button--secondary" type="button" onClick={beginEdit}>
            Edit
          </button>
        </div>
      ) : (
        <form className="daily-check-in__form" onSubmit={submit}>
          <p className="daily-check-in__invite" id="daily-check-in-invite">
            One mark is enough. Only a later reading can use it — never this one.
          </p>
          <fieldset className="daily-check-in__energy" aria-describedby="daily-check-in-invite">
            <legend>Energy</legend>
            <div className="daily-check-in__levels">
              {ENERGY_LEVELS.map((level) => (
                <label key={level.value}>
                  <input
                    type="radio"
                    name="check-in-energy"
                    value={level.value}
                    checked={form.energy === level.value}
                    onChange={() => editForm("energy", level.value)}
                    required
                  />
                  <span>
                    <Icon name={level.icon} />
                    <strong>{level.label}</strong>
                    <small>{level.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            className="daily-check-in__detail-toggle"
            type="button"
            aria-expanded={detailsOpen}
            aria-controls="daily-check-in-details"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <Icon name={detailsOpen ? "minus" : "plus"} />
            {detailsOpen ? "Hide the rest" : "Say a little more"}
          </button>

          {detailsOpen ? (
            <div className="daily-check-in__details" id="daily-check-in-details">
              <div className="daily-check-in__selects">
                <LevelSelect
                  id="check-in-pressure"
                  label="Pressure"
                  hint="How much is on you"
                  value={form.pressure}
                  onChange={(value) => editForm("pressure", value)}
                />
                <LevelSelect
                  id="check-in-clarity"
                  label="Clarity"
                  hint="How clearly you can see"
                  value={form.clarity}
                  onChange={(value) => editForm("clarity", value)}
                />
                <LevelSelect
                  id="check-in-connection"
                  label="Connection"
                  hint="How close you feel"
                  value={form.connection}
                  onChange={(value) => editForm("connection", value)}
                />
              </div>
              <label className="daily-check-in__field" htmlFor="check-in-focus">
                <span>Focus</span>
                <input
                  id="check-in-focus"
                  type="text"
                  value={form.focusDomain}
                  placeholder="Work, home, a conversation"
                  onChange={(event) => editForm("focusDomain", event.target.value)}
                />
                <span className="daily-check-in__field-hint">What's occupying you</span>
              </label>
              <label className="daily-check-in__field" htmlFor="check-in-note">
                <span>Note</span>
                <textarea
                  id="check-in-note"
                  value={form.note}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) => editForm("note", event.target.value)}
                />
                <span className="daily-check-in__field-hint">A sentence, if you want</span>
              </label>
            </div>
          ) : null}

          <div className="daily-check-in__footer">
            <button
              className="button button--secondary"
              type="submit"
              disabled={busy || !form.energy}
              aria-busy={busy}
            >
              {busy ? "Keeping…" : "Keep this"}
            </button>
            <p
              className="daily-check-in__status"
              role="status"
              aria-label="Check-in status"
              aria-live="polite"
            >
              {busy ? "Keeping your check-in." : problem}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
