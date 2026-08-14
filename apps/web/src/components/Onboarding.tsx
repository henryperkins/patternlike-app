import { useEffect, useState, type FormEvent } from "react";
import type {
  BirthProfileRequest,
  BirthTimeAccuracy,
  TimezoneLookupResponse,
} from "@patternlike/shared";
import { lookupTimezone, onboardingConsentId } from "../lib/api-client.js";
import { systemTimezone } from "../lib/device.js";
import { Icon } from "./icons.js";

interface OnboardingProps {
  onSubmit: (profile: BirthProfileRequest) => Promise<void>;
  /**
   * First-time calculation vs replacing an already-active chart. The API is
   * the same POST; this only changes the words, hides the local example, and
   * offers a way back to the chart the reader already has.
   */
  mode?: "create" | "correct";
  onCancel?: () => void;
}

/** Long enough that typing a decimal does not fire a request per keystroke. */
const LOOKUP_DEBOUNCE_MS = 350;

const confidenceCopy: Record<TimezoneLookupResponse["confidence"], string> = {
  high: "High confidence",
  medium: "Confirm this",
  low: "Low confidence",
  none: "Not verified",
};

const accuracyOptions: Array<{
  value: BirthTimeAccuracy;
  title: string;
  description: string;
}> = [
  {
    value: "exact",
    title: "I know the time",
    description: "Use the time shown on a birth record or remembered precisely.",
  },
  {
    value: "approximate",
    title: "I know roughly",
    description: "Record a best estimate and make uncertainty visible.",
  },
  {
    value: "unknown",
    title: "I do not know",
    description: "Keep stable planetary facts and omit houses and angles.",
  },
];

export function Onboarding({ onSubmit, mode = "create", onCancel }: OnboardingProps) {
  const correcting = mode === "correct";
  const [step, setStep] = useState(1);
  const [accuracy, setAccuracy] = useState<BirthTimeAccuracy>("exact");
  const [birthDate, setBirthDate] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [approximateWindow, setApproximateWindow] = useState("30");
  const [placeLabel, setPlaceLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [timezone, setTimezone] = useState(systemTimezone());
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [zone, setZone] = useState<TimezoneLookupResponse | null>(null);
  const [zoneState, setZoneState] = useState<"idle" | "loading" | "failed">("idle");

  const coordinatesReady =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180;

  /**
   * Coordinates decide the zone, so the field stops being an input the moment
   * they are present: whatever the user typed there would be discarded by the
   * server anyway, and an editable box that has no effect is worse than none.
   */
  const zoneIsDerived = coordinatesReady;

  /**
   * Resolve the birthplace to a real historical zone. The same lookup runs
   * server-side on submit, so this is a preview of the actual value rather
   * than a second opinion the user has to reconcile.
   */
  useEffect(() => {
    if (!coordinatesReady) {
      setZone(null);
      setZoneState("idle");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setZoneState("loading");
      lookupTimezone(
        {
          latitude: Number(latitude),
          longitude: Number(longitude),
          birth_date: birthDate || null,
          birth_time_local: accuracy === "unknown" ? null : birthTime || null,
        },
        controller.signal,
      )
        .then((resolved) => {
          if (controller.signal.aborted) return;
          setZone(resolved);
          setZoneState("idle");
          setTimezone(resolved.timezone);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          // The server resolves from the same coordinates on submit, so a
          // failed preview costs the confirmation, not the calculation.
          setZone(null);
          setZoneState("failed");
        });
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [coordinatesReady, latitude, longitude, birthDate, birthTime, accuracy]);

  const validateStep = (targetStep: number): string | null => {
    if (targetStep === 1) {
      if (!birthDate) return "Enter a birth date to continue.";
      if (accuracy !== "unknown" && !birthTime) {
        return "Enter a local birth time, or choose that the time is unknown.";
      }
      // The API takes an integer 1..1440 here. The form is noValidate, so an
      // emptied or fractional field would otherwise reach it as a raw 400.
      if (accuracy === "approximate") {
        const minutes = Number(approximateWindow);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          return "The estimate range must be a whole number of minutes between 1 and 1440.";
        }
      }
    }
    if (targetStep === 2) {
      if (!timezone.trim()) return "Enter an IANA timezone, such as America/New_York.";
      if ((latitude && !longitude) || (!latitude && longitude)) {
        return "Latitude and longitude must be supplied together.";
      }
      if (latitude && (Number(latitude) < -90 || Number(latitude) > 90)) {
        return "Latitude must be between -90 and 90.";
      }
      if (longitude && (Number(longitude) < -180 || Number(longitude) > 180)) {
        return "Longitude must be between -180 and 180.";
      }
    }
    return null;
  };

  const next = () => {
    const validationError = validateStep(step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, 3));
  };

  /**
   * Every step submits this form, including the two that only advance. Swapping
   * the primary button between type="button" and type="submit" instead let React
   * flush the step change during the click, so the browser saw a submit button
   * by the time it ran the default action and posted the profile from step two —
   * skipping the consent review entirely when the box was already ticked.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < 3) {
      next();
      return;
    }

    const validationError = validateStep(1) ?? validateStep(2);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!consent) {
      setError(
        correcting
          ? "Confirm the calculation permission before replacing the chart."
          : "Confirm the calculation permission before creating the chart.",
      );
      return;
    }

    const profile: BirthProfileRequest = {
      accuracy,
      consent_id: onboardingConsentId(),
      birth_date: birthDate,
      birth_time_local: accuracy === "unknown" ? null : birthTime,
      timezone_hint: timezone.trim(),
      approximate_window_minutes:
        accuracy === "approximate" ? Number(approximateWindow) : null,
      birthplace:
        placeLabel || latitude || longitude
          ? {
              label: placeLabel.trim() || undefined,
              latitude: latitude ? Number(latitude) : null,
              longitude: longitude ? Number(longitude) : null,
            }
          : undefined,
    };

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(profile);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The chart could not be created.",
      );
      setSubmitting(false);
    }
  };

  const fillExample = () => {
    setAccuracy("exact");
    setBirthDate("1990-05-15");
    setBirthTime("12:34");
    setPlaceLabel("Los Angeles, CA");
    setLatitude("34.0522");
    setLongitude("-118.2437");
    setTimezone("America/Los_Angeles");
    setError(null);
  };

  return (
    <section className="onboarding page-enter">
      <div className="onboarding__intro">
        <p className="eyebrow">Chart foundation</p>
        {correcting ? (
          <h1 aria-label="Replace what the chart is built from.">
            Replace what<br />the chart is built from.
          </h1>
        ) : (
          <h1 aria-label="Begin with what you know.">Begin with<br />what you know.</h1>
        )}
        <p className="onboarding__lede">
          {correcting
            ? "Birth details are not returned after calculation, so this form starts empty. A replacement supersedes the current chart. Submitting the same details does not replace anything."
            : "Precision matters, but certainty is never assumed. Pattern/Like keeps unknowns visible and removes claims your details cannot support."}
        </p>
        <div className="privacy-note">
          <Icon name="shield" />
          <p>
            Birth details are encrypted before storage. The chart endpoint returns
            calculated facts without exposing those details again.
          </p>
        </div>
      </div>

      <form className="onboarding-card" onSubmit={submit} noValidate>
        <div className="step-heading">
          <span className="step-heading__count">0{step} / 03</span>
          <div className="step-heading__line">
            <span style={{ width: `${(step / 3) * 100}%` }} />
          </div>
        </div>

        {step === 1 ? (
          <fieldset className="form-step">
            <legend>How precise is the birth time?</legend>
            <p className="field-help">This controls which chart features can be used.</p>
            <div className="accuracy-grid">
              {accuracyOptions.map((option) => (
                <label
                  className={`accuracy-option${accuracy === option.value ? " accuracy-option--selected" : ""}`}
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="accuracy"
                    value={option.value}
                    checked={accuracy === option.value}
                    onChange={() => setAccuracy(option.value)}
                  />
                  <span className="accuracy-option__radio" />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>

            <div className="field-row">
              <label className="field">
                <span>Birth date</span>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                  required
                />
              </label>
              {accuracy !== "unknown" ? (
                <label className="field">
                  <span>Local time</span>
                  <input
                    type="time"
                    step="1"
                    value={birthTime}
                    onChange={(event) => setBirthTime(event.target.value)}
                    required
                  />
                </label>
              ) : (
                <div className="unknown-time-note">
                  <span>Time-sensitive features</span>
                  <strong>Suppressed</strong>
                </div>
              )}
            </div>

            {accuracy === "approximate" ? (
              <label className="field field--compact">
                <span>Estimate range, plus or minus minutes</span>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={approximateWindow}
                  onChange={(event) => setApproximateWindow(event.target.value)}
                />
              </label>
            ) : null}

            {import.meta.env.DEV && !correcting ? (
              <button className="text-button" type="button" onClick={fillExample}>
                Fill local example
              </button>
            ) : null}
          </fieldset>
        ) : null}

        {step === 2 ? (
          <fieldset className="form-step">
            <legend>Where was the birth?</legend>
            <p className="field-help">
              Location is optional, but houses and angles require coordinates and a real time.
            </p>
            <label className="field">
              <span>Place label</span>
              <input
                type="text"
                placeholder="City, region, country"
                value={placeLabel}
                onChange={(event) => setPlaceLabel(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Latitude</span>
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  placeholder="34.0522"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  placeholder="-118.2437"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>IANA timezone</span>
              <input
                type="text"
                placeholder="America/Los_Angeles"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                required
                spellCheck="false"
                readOnly={zoneIsDerived}
              />
              <small>
                {!zoneIsDerived
                  ? "Without coordinates this zone is used exactly as entered, and nothing can check it against a place."
                  : zone
                    ? "Resolved from the birthplace coordinates. Change the coordinates to change the zone."
                    : // Derived but not yet answered: the field still holds the
                      // browser's guess, and calling that "resolved" would be
                      // the same claim this lookup exists to stop making.
                      "The birthplace coordinates decide the zone. This is your browser's guess until the lookup answers."}
              </small>
            </label>

            {zoneIsDerived ? (
              <div className="zone-resolution" aria-live="polite">
                {zoneState === "loading" ? (
                  <p className="zone-resolution__status">Resolving the timezone...</p>
                ) : null}

                {zoneState === "failed" ? (
                  <p className="zone-resolution__status">
                    The timezone lookup could not be reached. The chart is still
                    calculated from the coordinates, which is where the zone comes
                    from — you just will not see it confirmed here first.
                  </p>
                ) : null}

                {zone ? (
                  <>
                    <div className="zone-resolution__head">
                      <strong>{zone.timezone}</strong>
                      {zone.local ? (
                        <span>{zone.local.utc_offset_label} on this date</span>
                      ) : (
                        <span>Enter a birth date to see the offset</span>
                      )}
                      <em
                        className={`zone-resolution__grade zone-resolution__grade--${zone.confidence}`}
                      >
                        {confidenceCopy[zone.confidence]}
                      </em>
                    </div>
                    {zone.qualifiers.length > 0 ? (
                      <ul className="zone-resolution__notes">
                        {zone.qualifiers.map((qualifier) => (
                          <li key={qualifier.code}>{qualifier.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {step === 3 ? (
          <fieldset className="form-step form-step--consent">
            <legend>Review the boundary.</legend>
            <p className="field-help">
              {correcting
                ? "The previous chart is superseded, not deleted. Today readings pinned to it may be withheld until a successor exists. Pattern chapters follow the new facts once a reviewed release is active."
                : "Your chart is a calculation, not a diagnosis or a prediction. You can revisit uncertainty and technical evidence at any time."}
            </p>

            <div className="consent-ledger">
              <div><span>Used now</span><strong>Birth details, chart calculation</strong></div>
              <div><span>Not connected</span><strong>Calendar, health, device, journal</strong></div>
              <div><span>Model access</span><strong>None during chart calculation</strong></div>
            </div>

            <label className="consent-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span className="consent-check__box"><Icon name="check" /></span>
              <span>
                {correcting
                  ? "I allow Pattern/Like to encrypt these details and calculate a replacement natal chart."
                  : "I allow Pattern/Like to encrypt these details and calculate my natal chart."}
              </span>
            </label>
          </fieldset>
        ) : null}

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <div className="form-actions">
          {step > 1 ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setError(null);
                setStep((current) => current - 1);
              }}
            >
              Back
            </button>
          ) : onCancel ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : <span />}
          <button className="button button--primary" type="submit" disabled={submitting}>
            {step < 3
              ? "Continue"
              : submitting
                ? "Calculating..."
                : correcting
                  ? "Replace my chart"
                  : "Create my chart"}
            {submitting ? <span className="button-spinner" /> : <Icon name="arrow" />}
          </button>
        </div>
      </form>
    </section>
  );
}
