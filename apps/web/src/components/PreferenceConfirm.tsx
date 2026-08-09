import { useId, useRef, useState } from "react";
import { isValidIanaZone } from "@patternlike/shared";
import {
  ApiError,
  newIdempotencyKey,
  setContentLocale,
  setSchedulingTimezone,
} from "../lib/api-client.js";
import { knownTimezones, systemLocale, systemTimezone } from "../lib/device.js";
import { Icon } from "./icons.js";

type PreferenceKind = "timezone" | "locale";

interface PreferenceConfirmProps {
  kind: PreferenceKind;
  requestId: string | null;
  /** Re-run the Today fetch. The answer will usually be "not generated yet". */
  onSaved: () => void;
  onUnauthorized: () => void;
}

const COPY = {
  timezone: {
    eyebrow: "Today / Scheduling",
    title: "Which day is your day?",
    body:
      "A reading is generated for one local date, and the zone that decides which date has to be one you chose rather than a server default. Your birthplace zone is not used for this: it says where you were born, not where you are now.",
    label: "Scheduling time zone",
    help: "Detected from this device. Change it if it is wrong.",
    action: "Confirm time zone",
  },
  locale: {
    eyebrow: "Today / Language",
    title: "Which wording should you be shown?",
    body:
      "Readings are assembled from reviewed copy, and that copy is written per language. Choosing one tells us which reviewed wording to draw from — if your exact language has not been published, the closest published one is used.",
    label: "Content language",
    help: "Detected from this browser. A BCP 47 tag, such as en-US or es-ES.",
    action: "Confirm language",
  },
} as const;

export function PreferenceConfirm({
  kind,
  requestId,
  onSaved,
  onUnauthorized,
}: PreferenceConfirmProps) {
  const copy = COPY[kind];
  const fieldId = useId();
  const listId = useId();
  const [value, setValue] = useState(() =>
    kind === "timezone" ? systemTimezone() : systemLocale(),
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * One key per *value*, not per intent.
   *
   * A preference write is value-keyed server-side: replaying a key with a
   * different value is `409 idempotency_conflict`. Holding a single key for the
   * form's lifetime — the pattern the export and deletion flows use, where the
   * intent really is singular — would wedge this form permanently the first time
   * someone corrected a typo.
   */
  const submitted = useRef<{ value: string; key: string } | null>(null);
  const keyFor = (candidate: string): string => {
    if (submitted.current?.value !== candidate) {
      submitted.current = { value: candidate, key: newIdempotencyKey(`web-${kind}`) };
    }
    return submitted.current.key;
  };

  const zones = kind === "timezone" ? knownTimezones() : [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = value.trim();

    if (!candidate) {
      setProblem(`${copy.label} is required.`);
      return;
    }
    // The same check the Worker runs, so an obvious typo is refused without a
    // round trip. Locale is deliberately not gated: the server accepts any
    // well-formed tag and resolves *support* at read time, so rejecting against
    // a supported list this client does not have would refuse a legitimate one.
    if (kind === "timezone" && !isValidIanaZone(candidate)) {
      setProblem("That is not a time zone this browser recognises.");
      return;
    }

    setSaving(true);
    setProblem(null);
    try {
      const key = keyFor(candidate);
      if (kind === "timezone") {
        await setSchedulingTimezone(candidate, "user_confirmed", key);
      } else {
        await setContentLocale(candidate, "user_confirmed", key);
      }
      setSaved(true);
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      setProblem(
        error instanceof Error ? error.message : "That could not be saved in this session.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="today-gate page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
        </div>
      </header>

      <form className="today-gate__form panel" onSubmit={submit} noValidate>
        <p className="today-gate__body">{copy.body}</p>

        <label htmlFor={fieldId}>{copy.label}</label>
        <input
          id={fieldId}
          name={kind}
          type="text"
          value={value}
          list={zones.length ? listId : undefined}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
            setSaved(false);
          }}
          aria-describedby={`${fieldId}-help`}
          aria-invalid={problem ? true : undefined}
        />
        {zones.length ? (
          <datalist id={listId}>
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        ) : null}
        <small id={`${fieldId}-help`}>{copy.help}</small>

        <button className="button button--primary" type="submit" disabled={saving} aria-busy={saving}>
          {copy.action} <Icon name="check" />
        </button>

        <p className="today-gate__status" role="status" aria-live="polite">
          {problem
            ? problem
            : saved
              ? // Not a promise of a reading. A preference change affects only
                // commands enqueued afterwards, and a day already reserved never
                // moves — so the honest next screen is "not ready yet".
                "Saved. Your reading will be generated for your next local day."
              : ""}
        </p>

        {requestId ? (
          <small className="today-gate__request">Request {requestId}</small>
        ) : null}
      </form>
    </section>
  );
}
