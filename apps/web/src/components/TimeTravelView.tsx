import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ProjectedTimeTravelCycle,
  TimeTravelDateState,
  TimeTravelResponse,
} from "@patternlike/shared";

import { ApiError, getTimeTravel } from "../lib/api-client.js";
import { isNotImplemented } from "../lib/api-status.js";
import { formatLocalDate } from "../lib/reading-format.js";
import {
  formatTimingInstant,
  formatTimingOrb,
  timingCycleTitle,
  timingDirectionLabel,
} from "../lib/timing-format.js";
import {
  recordingRelationLabel,
  shiftIsoDate,
  todayIsoDate,
  travelPhaseLabel,
} from "../lib/travel-format.js";
import { Icon } from "./icons.js";
import { LifeEventTimeline } from "./LifeEventTimeline.js";

interface TimeTravelViewProps {
  onUnauthorized: () => void;
}

type Failure =
  | { kind: "not_implemented"; requestId: string | null }
  | {
      kind: "refused";
      code: string;
      message: string;
      requestId: string | null;
      /** `next_representable_date` for a skipped civil date. */
      nextDate: string | null;
      /** UTC instant the scan budget resets, when the server sent one. */
      resetsAt: string | null;
      retryable: boolean;
    };

/**
 * Reader words for the refusals this route can return.
 *
 * A `Record` with an explicit fallback rather than the server's message: the
 * envelope's prose is written for an operator, and two of these codes carry a
 * recovery the reader can actually perform. Upstream calculation detail never
 * reaches here by contract, and nothing below reintroduces it.
 */
const REFUSAL_TITLES: Record<string, string> = {
  chart_not_found: "There is no calculated chart to reconstruct from yet.",
  timezone_confirmation_required: "Confirm your time zone before reconstructing a date.",
  invalid_date: "That date could not be read.",
  skipped_local_date: "Your time zone skipped that calendar date entirely.",
  date_not_supported: "That date is outside the calculation's supported range.",
  time_travel_scan_budget_exhausted: "Today's reconstruction limit is used up.",
  calc_unavailable: "The calculation service could not be reached.",
  time_travel_integrity_failure: "This reconstruction could not be verified.",
  time_travel_configuration_error: "Time Travel is not configured on this deployment.",
  unreadable_response: "This reconstruction could not be read.",
};

function refusalDetail(failure: Extract<Failure, { kind: "refused" }>): string {
  switch (failure.code) {
    case "chart_not_found":
      return "Add your birth details first; Time Travel reconstructs from the stored chart, never from birth data sent again.";
    case "timezone_confirmation_required":
      return "A calendar date only means something in a zone. Confirm your scheduling time zone and this date will resolve.";
    case "skipped_local_date":
      return failure.nextDate
        ? `Daylight-saving moved the clock past it. The next date your zone actually has is ${formatLocalDate(failure.nextDate)}.`
        : "Daylight-saving moved the clock past it, so there is no local day to reconstruct.";
    case "date_not_supported":
      return "The pinned ephemeris does not cover it. The date you chose is kept above; choose one inside the supported range.";
    case "time_travel_scan_budget_exhausted":
      return failure.resetsAt
        ? `New reconstructions resume ${formatTimingInstant(failure.resetsAt)}. Dates already reconstructed still open immediately.`
        : "New reconstructions resume at the next UTC midnight. Dates already reconstructed still open immediately.";
    case "calc_unavailable":
      return "Nothing about your chart or your saved events changed. The request can be tried again.";
    case "time_travel_integrity_failure":
      return "A stored reconstruction did not match its own record, so it was withheld rather than shown.";
    case "unreadable_response":
      return "The answer did not match the shape this version expects, so nothing from it is shown. Reloading the app may resolve it.";
    default:
      return failure.message;
  }
}

/**
 * A 200 whose body is not the contract.
 *
 * `request()` already refuses a non-JSON 200, which is what an SPA fallback or
 * a captive portal produces. This is the next case down: valid JSON of the
 * wrong shape, from a proxy or a Worker rolled back mid-session. Reading
 * `selected.local_date` off it would white-screen the route, so it is refused
 * with a retry instead.
 */
function isTimeTravelResponse(value: unknown): value is TimeTravelResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<TimeTravelResponse>;
  const readableState = (state: unknown): boolean => {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    const projected = state as Partial<TimeTravelDateState>;
    return (
      typeof projected.local_date === "string" &&
      typeof projected.reference_at === "string" &&
      typeof projected.calculated_at === "string" &&
      Array.isArray(projected.cycles)
    );
  };
  return (
    readableState(body.selected) &&
    readableState(body.present) &&
    !!body.comparison &&
    typeof body.comparison === "object" &&
    Array.isArray(body.comparison.continuing) &&
    Array.isArray(body.comparison.selected_only) &&
    Array.isArray(body.comparison.present_only) &&
    Array.isArray(body.comparison.phase_changed) &&
    Array.isArray(body.saved_context) &&
    typeof body.timezone === "string" &&
    !!body.calculation_policy
  );
}

function provenanceLabel(state: TimeTravelDateState): string {
  return state.provenance === "cache" ? "Reused calculation" : "Calculated now";
}

function CycleRow({ projected }: { projected: ProjectedTimeTravelCycle }) {
  const { cycle } = projected;
  return (
    <article className="travel-cycle" aria-label={timingCycleTitle(cycle.body, cycle.aspect, cycle.target)}>
      <div className="travel-cycle__head">
        <h3>{timingCycleTitle(cycle.body, cycle.aspect, cycle.target)}</h3>
        <span className="travel-cycle__phase">{travelPhaseLabel(projected.phase)}</span>
      </div>
      <p className="travel-cycle__envelope">
        <time dateTime={cycle.start_at}>{formatTimingInstant(cycle.start_at)}</time>
        <span aria-hidden="true">–</span>
        <time dateTime={cycle.end_at}>{formatTimingInstant(cycle.end_at)}</time>
      </p>
      <details className="travel-cycle__detail">
        <summary>
          <span>Exact passes and orb</span>
          <span className="travel-cycle__toggle">Open</span>
        </summary>
        <ol>
          {cycle.passes.map((pass) => (
            <li key={pass.pass_index}>
              <span className="travel-cycle__pass-number">Pass {pass.pass_index}</span>
              <time dateTime={pass.exact_at}>{formatTimingInstant(pass.exact_at)}</time>
              <span className="travel-cycle__direction">
                {timingDirectionLabel(pass.direction)}
              </span>
            </li>
          ))}
        </ol>
        <dl className="travel-cycle__evidence">
          <div>
            <dt>Orb</dt>
            <dd>{formatTimingOrb(cycle.orb_deg)}</dd>
          </div>
          <div>
            <dt>Technique</dt>
            <dd>Transit</dd>
          </div>
          <div className="travel-cycle__identity">
            <dt>Cycle id</dt>
            <dd>{cycle.id}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function DateStatePanel({
  state,
  heading,
  headingId,
  timezone,
}: {
  state: TimeTravelDateState;
  heading: string;
  headingId: string;
  timezone: string;
}) {
  const dominant = state.cycles.filter((projected) => projected.dominant);
  const rest = state.cycles.filter((projected) => !projected.dominant);

  return (
    <section className="travel-state" aria-labelledby={headingId}>
      <header className="travel-state__header">
        <p className="kicker">{heading}</p>
        <h2 id={headingId}>{formatLocalDate(state.local_date)}</h2>
        <p className="travel-state__reference">
          Read at{" "}
          <time dateTime={state.reference_at}>{formatTimingInstant(state.reference_at)}</time>
          <span className="travel-state__zone"> · {timezone}</span>
        </p>
      </header>

      <p className="travel-state__provenance">
        <span>{provenanceLabel(state)}</span>
        <time dateTime={state.calculated_at}>{formatTimingInstant(state.calculated_at)}</time>
      </p>

      {state.cycles.length === 0 ? (
        <p className="travel-state__empty">
          No calculated cycle overlaps this reference under the pinned policy. That is a
          complete result, not a gap — it does not say nothing was happening.
        </p>
      ) : (
        <>
          <ol className="travel-state__cycles">
            {dominant.map((projected) => (
              <li key={projected.cycle.id}>
                <CycleRow projected={projected} />
              </li>
            ))}
          </ol>
          {rest.length > 0 ? (
            <details className="travel-state__rest">
              <summary>
                <span>
                  {rest.length} further readable {rest.length === 1 ? "cycle" : "cycles"}
                </span>
                <span className="travel-cycle__toggle">Open</span>
              </summary>
              <ol>
                {rest.map((projected) => (
                  <li key={projected.cycle.id}>
                    <CycleRow projected={projected} />
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function ComparisonSection({ response }: { response: TimeTravelResponse }) {
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const state of [response.selected, response.present]) {
      for (const { cycle } of state.cycles) {
        map.set(cycle.id, timingCycleTitle(cycle.body, cycle.aspect, cycle.target));
      }
    }
    return map;
  }, [response]);

  const phaseChanged = new Set(response.comparison.phase_changed);
  const groups: Array<{ key: string; label: string; hint: string; ids: string[] }> = [
    {
      key: "continuing",
      label: "Still running now",
      hint: "Calculated at both references.",
      ids: response.comparison.continuing,
    },
    {
      key: "selected_only",
      label: "Only on the selected date",
      hint: "Calculated then, not now.",
      ids: response.comparison.selected_only,
    },
    {
      key: "present_only",
      label: "Only now",
      hint: "Calculated now, not on the selected date.",
      ids: response.comparison.present_only,
    },
  ];

  const total = groups.reduce((sum, group) => sum + group.ids.length, 0);

  return (
    <section className="travel-comparison" aria-labelledby="travel-comparison-heading">
      <p className="kicker">What changed between the two</p>
      <h2 id="travel-comparison-heading">Selected date against now</h2>
      {total === 0 ? (
        <p className="travel-comparison__empty">
          Neither reference has a calculated cycle, so there is nothing to compare.
        </p>
      ) : (
        <dl className="travel-comparison__groups">
          {groups.map((group) => (
            <div key={group.key}>
              <dt>
                {group.label}
                <small>{group.hint}</small>
              </dt>
              <dd>
                {group.ids.length === 0 ? (
                  <p className="travel-comparison__none">None.</p>
                ) : (
                  <ul>
                    {group.ids.map((id) => (
                      <li key={id}>
                        {titles.get(id) ?? id}
                        {phaseChanged.has(id) ? (
                          <span className="travel-comparison__changed">Phase changed</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function SavedContextSection({ response }: { response: TimeTravelResponse }) {
  const state = response.life_event_source_state;

  return (
    <section className="travel-context" aria-labelledby="travel-context-heading">
      <p className="kicker">Your own record for this date</p>
      <h2 id="travel-context-heading">What you saved</h2>

      {response.unreadable_context_count > 0 ? (
        <p className="travel-context__warning">
          {response.unreadable_context_count} saved{" "}
          {response.unreadable_context_count === 1 ? "event" : "events"} could not be read
          and {response.unreadable_context_count === 1 ? "was" : "were"} left out. The
          calculated cycles above are unaffected.
        </p>
      ) : null}

      {state !== "active" ? (
        <p className="travel-context__off">
          {state === "never_granted"
            ? "Life-event timeline is not enabled, so nothing you saved is shown here."
            : state === "paused"
              ? "Life-event timeline is paused, so nothing you saved is shown here."
              : "Life-event timeline is revoked, so nothing you saved is shown here."}{" "}
          Your events are still stored, listed, and deletable below.
        </p>
      ) : response.saved_context.length === 0 ? (
        <p className="travel-context__empty">
          Nothing you saved covers this date, or nothing covering it is marked for Time
          Travel. That is different from a calculation that failed.
        </p>
      ) : (
        <ul className="travel-context__list">
          {response.saved_context.map(({ event, recording_relation }) => (
            <li key={event.id}>
              <p className="travel-context__title">{event.title}</p>
              <p className="travel-context__meta">
                <span>{recordingRelationLabel(recording_relation)}</span>
                <time dateTime={event.recorded_at}>
                  {formatTimingInstant(event.recorded_at)}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TimeTravelView({ onUnauthorized }: TimeTravelViewProps) {
  const today = useMemo(() => todayIsoDate(), []);
  const [date, setDate] = useState(today);
  const [response, setResponse] = useState<TimeTravelResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const dateFieldId = useId();
  const retryRef = useRef<HTMLButtonElement>(null);
  const [restoreRetryFocus, setRestoreRetryFocus] = useState(false);

  const retry = useCallback(() => {
    setRestoreRetryFocus(true);
    setAttempt((value) => value + 1);
  }, []);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);

    void (async () => {
      try {
        const result = await getTimeTravel(date, controller.signal);
        if (controller.signal.aborted) return;
        if (!isTimeTravelResponse(result)) {
          setResponse(null);
          setFailure({
            kind: "refused",
            code: "unreadable_response",
            message: "The API answered with a reconstruction this app cannot read.",
            requestId: null,
            nextDate: null,
            resetsAt: null,
            retryable: true,
          });
          return;
        }
        setResponse(result);
        setFailure(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Whatever is on screen belongs to a date that is no longer selected.
        // Leaving it under a failure panel shows one date's headings beside
        // another date's field, which reads as a stale answer to the new
        // question rather than as no answer.
        setResponse(null);
        if (error instanceof ApiError && error.status === 401) {
          setFailure(null);
          onUnauthorized();
          return;
        }
        if (isNotImplemented(error)) {
          setFailure({ kind: "not_implemented", requestId: error.requestId });
          return;
        }
        if (error instanceof ApiError) {
          const details = error.details ?? {};
          const nextDate = details.next_representable_date;
          const resetsAt = details.resets_at;
          setFailure({
            kind: "refused",
            code: error.code,
            message: error.message,
            requestId: error.requestId,
            nextDate: typeof nextDate === "string" ? nextDate : null,
            resetsAt: typeof resetsAt === "string" ? resetsAt : null,
            // Only transport and integrity failures improve by asking again. A
            // date outside the ephemeris range answers identically forever, and
            // offering a button there teaches the reader the wrong recovery.
            retryable:
              error.code === "calc_unavailable" ||
              error.code === "time_travel_integrity_failure",
          });
          return;
        }
        setFailure({
          kind: "refused",
          code: "unreachable",
          message:
            error instanceof Error
              ? error.message
              : "Time Travel could not be loaded in this session.",
          requestId: null,
          nextDate: null,
          resetsAt: null,
          retryable: true,
        });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();

    return () => controller.abort();
  }, [attempt, date, onUnauthorized]);

  useEffect(() => {
    if (restoreRetryFocus && !busy) {
      setRestoreRetryFocus(false);
      retryRef.current?.focus();
    }
  }, [busy, restoreRetryFocus]);

  const statusMessage = busy
    ? `Reconstructing ${formatLocalDate(date)}.`
    : failure?.kind === "not_implemented"
      ? "Time Travel availability changed."
      : failure
        ? "This date could not be reconstructed."
        : response
          ? `Reconstruction ready for ${formatLocalDate(response.selected.local_date)}.`
          : "Time Travel is ready to load.";

  const selectDate = (next: string) => {
    if (next && next !== date) setDate(next);
  };

  return (
    <section className="travel-page page-enter">
      <header className="travel-hero">
        <p className="eyebrow">Time travel / Date reconstruction</p>
        <h1>Return to a date with the record intact.</h1>
        <p>
          Pick a date and Pattern/Like recalculates the cycle state your chart was in
          then, from stored chart facts alone. Anything you saved sits beside it, plainly
          separate: this compares two moments, it does not explain either one.
        </p>
      </header>

      <section className="travel-controls" aria-label="Date selection">
        <label className="travel-controls__field" htmlFor={dateFieldId}>
          <span>Selected date</span>
          <input
            id={dateFieldId}
            type="date"
            value={date}
            onChange={(event) => selectDate(event.currentTarget.value)}
          />
        </label>
        <div className="travel-controls__steps">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => selectDate(shiftIsoDate(date, -1))}
            disabled={busy}
          >
            Previous day
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => selectDate(shiftIsoDate(date, 1))}
            disabled={busy}
          >
            Next day
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => selectDate(today)}
            disabled={busy || date === today}
          >
            Return to today
          </button>
        </div>
      </section>

      <p className="travel-page__status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      {failure ? (
        <section className="travel-failure panel" aria-labelledby="travel-failure-heading">
          <h2 id="travel-failure-heading">
            {failure.kind === "not_implemented"
              ? "Time Travel is not active on this Worker."
              : (REFUSAL_TITLES[failure.code] ?? failure.message)}
          </h2>
          <p>
            {failure.kind === "not_implemented"
              ? "An installed or cached copy of the app may be newer than the Worker currently serving this route."
              : refusalDetail(failure)}
          </p>
          <p className="travel-failure__kept">
            Selected date kept: <strong>{formatLocalDate(date)}</strong>
          </p>
          {failure.kind === "refused" && failure.nextDate ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => selectDate(failure.nextDate!)}
            >
              Go to {formatLocalDate(failure.nextDate)}
            </button>
          ) : null}
          {failure.kind === "refused" && failure.code === "chart_not_found" ? (
            <a className="inline-link" href="#pattern">
              Set up your chart <Icon name="arrow" />
            </a>
          ) : null}
          {failure.kind === "refused" && failure.code === "timezone_confirmation_required" ? (
            <a className="inline-link" href="#today">
              Confirm your time zone <Icon name="arrow" />
            </a>
          ) : null}
          {failure.requestId ? (
            <small className="travel-failure__request">Request {failure.requestId}</small>
          ) : null}
          {/*
            Kept mounted through the reload it triggers. Rendering it only while
            failed would remove the button in the same commit as its own click
            and drop focus to <body> on every attempt.
          */}
          {failure.kind === "refused" && failure.retryable ? (
            <button
              className="button button--secondary"
              type="button"
              ref={retryRef}
              onClick={retry}
              disabled={busy}
              aria-busy={busy}
            >
              Try again <Icon name="refresh" />
            </button>
          ) : null}
        </section>
      ) : null}

      {response ? (
        <>
          <div className="travel-compare">
            <DateStatePanel
              state={response.selected}
              heading="The date you chose"
              headingId="travel-selected-heading"
              timezone={response.timezone}
            />
            <DateStatePanel
              state={response.present}
              heading="Where you are now"
              headingId="travel-present-heading"
              timezone={response.timezone}
            />
          </div>

          <ComparisonSection response={response} />
          <SavedContextSection response={response} />

          <details className="evidence-drawer travel-policy">
            <summary>
              <span>
                <small>Technical evidence</small>
                Reproduce this reconstruction
              </span>
              <span className="evidence-drawer__toggle">Open</span>
            </summary>
            <dl className="evidence-grid">
              <div>
                <dt>Calculation contract</dt>
                <dd>
                  {response.calculation_policy.contract_id}@
                  {response.calculation_policy.contract_version}
                </dd>
              </div>
              <div>
                <dt>Cycle policy</dt>
                <dd>
                  {response.calculation_policy.cycle_policy_id}@
                  {response.calculation_policy.cycle_policy_version}
                </dd>
              </div>
              <div>
                <dt>Orb policy</dt>
                <dd>
                  {response.calculation_policy.orb_policy_id}@
                  {response.calculation_policy.orb_policy_version}
                </dd>
              </div>
              <div>
                <dt>Receipt epoch</dt>
                <dd>{response.calculation_policy.receipt_epoch}</dd>
              </div>
              <div>
                <dt>Scheduling zone</dt>
                <dd>{response.timezone}</dd>
              </div>
              <div>
                <dt>Response time</dt>
                <dd>
                  <time dateTime={response.generated_at}>
                    {formatTimingInstant(response.generated_at)}
                  </time>
                </dd>
              </div>
            </dl>
          </details>
        </>
      ) : null}

      {/*
        Mounted whenever the account itself is usable, including after a failed
        reconstruction: a reader who cannot reach a date can still inspect and
        delete what they saved. `never_granted` is the honest default before a
        response has said otherwise.
      */}
      {failure?.kind === "not_implemented" ? null : (
        <LifeEventTimeline
          sourceState={response?.life_event_source_state ?? "never_granted"}
          selectedDate={date}
          onUnauthorized={onUnauthorized}
          onEventsChanged={reload}
        />
      )}
    </section>
  );
}
