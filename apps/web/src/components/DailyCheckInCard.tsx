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

const LEVELS: CheckInLevel[] = ["low", "medium", "high"];

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
  value,
  onChange,
}: {
  id: string;
  label: string;
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
        <option value="">Not set</option>
        {LEVELS.map((level) => (
          <option value={level} key={level}>{level[0]!.toUpperCase() + level.slice(1)}</option>
        ))}
      </select>
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
      setProblem("Choose an energy level before saving.");
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
    <section className="daily-check-in panel" aria-labelledby="daily-check-in-heading">
      <div className="daily-check-in__heading">
        <div>
          <p className="kicker">Private context · 24 hours</p>
          <h2 id="daily-check-in-heading">How are you arriving?</h2>
        </div>
        <span className="panel-code">USR-06</span>
      </div>

      {availability.status === "loading" ? (
        <p>Reading your check-in permission.</p>
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
            Daily check-in is {availability.label}. PatternLike will not save a
            check-in until you choose to enable that source.
          </p>
          <a className="button button--secondary" href="#privacy">
            Manage check-in permission
          </a>
        </div>
      ) : saved ? (
        <div className="daily-check-in__saved">
          <p className="daily-check-in__until">
            Saved · Active until {formatInstant(saved.freshness.expires_at)}
          </p>
          <p>
            {personalContextEligible === true
              ? "Available to the next eligible generation. Your current reading has not been rewritten."
              : personalContextEligible === false
                ? "Your check-in is saved but will not be sent to the reading publisher until Reading generation permission includes personal context. Your current reading has not been rewritten."
                : "Your check-in is saved. Reading generation permission could not be confirmed. Your current reading has not been rewritten."}
          </p>
          <button className="button button--secondary" type="button" onClick={beginEdit}>
            Edit
          </button>
        </div>
      ) : (
        <form className="daily-check-in__form" onSubmit={submit}>
          <fieldset className="daily-check-in__energy">
            <legend>Energy</legend>
            <div className="daily-check-in__levels">
              {LEVELS.map((level) => (
                <label key={level}>
                  <input
                    type="radio"
                    name="check-in-energy"
                    value={level}
                    checked={form.energy === level}
                    onChange={() => editForm("energy", level)}
                    required
                  />
                  <span>{level[0]!.toUpperCase() + level.slice(1)}</span>
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
            {detailsOpen ? "Hide detail" : "Add detail"}
          </button>

          {detailsOpen ? (
            <div className="daily-check-in__details" id="daily-check-in-details">
              <div className="daily-check-in__selects">
                <LevelSelect
                  id="check-in-pressure"
                  label="Pressure"
                  value={form.pressure}
                  onChange={(value) => editForm("pressure", value)}
                />
                <LevelSelect
                  id="check-in-clarity"
                  label="Clarity"
                  value={form.clarity}
                  onChange={(value) => editForm("clarity", value)}
                />
                <LevelSelect
                  id="check-in-connection"
                  label="Connection"
                  value={form.connection}
                  onChange={(value) => editForm("connection", value)}
                />
              </div>
              <label className="daily-check-in__field" htmlFor="check-in-focus">
                <span>Focus domain</span>
                <input
                  id="check-in-focus"
                  type="text"
                  value={form.focusDomain}
                  onChange={(event) => editForm("focusDomain", event.target.value)}
                />
              </label>
              <label className="daily-check-in__field" htmlFor="check-in-note">
                <span>Optional note</span>
                <textarea
                  id="check-in-note"
                  value={form.note}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) => editForm("note", event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="daily-check-in__footer">
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || !form.energy}
              aria-busy={busy}
            >
              {busy ? "Saving" : "Save"}
            </button>
            <p
              className="daily-check-in__status"
              role="status"
              aria-label="Check-in status"
              aria-live="polite"
            >
              {busy ? "Saving your check-in." : problem}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
