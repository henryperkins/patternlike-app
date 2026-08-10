import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
} from "react";
import {
  ApiError,
  getTiming,
  type TimingCycle,
  type TimingDurationFilter,
  type TimingPhaseFilter,
  type TimingResponse,
} from "../lib/api-client.js";
import { isNotImplemented } from "../lib/api-status.js";
import {
  DURATION_OPTIONS,
  PHASE_OPTIONS,
  formatTimingDuration,
  formatTimingInstant,
  formatTimingOrb,
  timingCycleTitle,
  timingDirectionLabel,
  timingPhaseLabel,
} from "../lib/timing-format.js";
import { Icon } from "./icons.js";

type TimingFailure =
  | { kind: "not_implemented"; requestId: string | null }
  | { kind: "error"; message: string; requestId: string | null };

interface TimingViewProps {
  onUnauthorized: () => void;
}

type TimelineStyle = CSSProperties & { "--timing-position": string };

function timelinePosition(
  instant: string,
  startAt: string,
  endAt: string,
): number {
  const instantMs = new Date(instant).valueOf();
  const startMs = new Date(startAt).valueOf();
  const endMs = new Date(endAt).valueOf();
  if (
    !Number.isFinite(instantMs) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((instantMs - startMs) / (endMs - startMs)) * 100));
}

function markerStyle(
  instant: string,
  cycle: Pick<TimingCycle, "start_at" | "end_at">,
): TimelineStyle {
  return {
    "--timing-position": `${timelinePosition(
      instant,
      cycle.start_at,
      cycle.end_at,
    )}%`,
  };
}

function scanStateLabel(state: TimingResponse["calculation_status"]["state"]): string {
  switch (state) {
    case "current":
      return "Current scan";
    case "stale":
      return "Stale scan";
    case "not_scanned":
      return "Not scanned";
  }
}

function unreadableMessage(count: number): string {
  return `${count} stored ${count === 1 ? "cycle" : "cycles"} could not be read.`;
}

function Timeline({ cycle, asOf }: { cycle: TimingCycle; asOf: string }) {
  const nextPass = cycle.passes.find(
    (pass) => new Date(pass.exact_at).valueOf() >= new Date(asOf).valueOf(),
  );

  return (
    <div className="timing-cycle__timeline" aria-hidden="true">
      <span className="timing-cycle__timeline-rule" />
      {cycle.status === "active" ? (
        <span
          className="timing-cycle__marker timing-cycle__marker--current"
          style={markerStyle(asOf, cycle)}
        />
      ) : null}
      {cycle.passes.map((pass) => (
        <span
          className={`timing-cycle__marker timing-cycle__marker--pass${
            pass === nextPass ? " timing-cycle__marker--next" : ""
          }`}
          key={pass.pass_index}
          style={markerStyle(pass.exact_at, cycle)}
        />
      ))}
    </div>
  );
}

function CycleArticle({ cycle, asOf }: { cycle: TimingCycle; asOf: string }) {
  const headingId = useId();

  return (
    <article className="timing-cycle" aria-labelledby={headingId}>
      <header className="timing-cycle__header">
        <h2 id={headingId}>
          {timingCycleTitle(cycle.body, cycle.aspect, cycle.target)}
        </h2>
        <span className="timing-cycle__phase">
          {timingPhaseLabel(cycle.phase, cycle.status)}
        </span>
      </header>

      <div className="timing-cycle__envelope">
        <p>
          <span>Starts</span>{" "}
          <time dateTime={cycle.start_at}>
            {formatTimingInstant(cycle.start_at)}
          </time>
        </p>
        <p>
          <span>Ends</span>{" "}
          <time dateTime={cycle.end_at}>{formatTimingInstant(cycle.end_at)}</time>
        </p>
      </div>

      <Timeline cycle={cycle} asOf={asOf} />

      <div className="timing-cycle__passes">
        <h3>Exact passes</h3>
        <ol>
          {cycle.passes.map((pass) => (
            <li key={pass.pass_index}>
              <span className="timing-cycle__pass-number">
                Pass {pass.pass_index}
              </span>
              <time dateTime={pass.exact_at}>
                {formatTimingInstant(pass.exact_at)}
              </time>
              <span className="timing-cycle__direction">
                {timingDirectionLabel(pass.direction)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <dl className="timing-cycle__evidence">
        <div>
          <dt>Technique</dt>
          <dd>Transit</dd>
        </div>
        <div>
          <dt>Orb</dt>
          <dd>{formatTimingOrb(cycle.orb_deg)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatTimingDuration(cycle.duration_days)}</dd>
        </div>
        <div className="timing-cycle__identity">
          <dt>Cycle id</dt>
          <dd>{cycle.cycle_id}</dd>
        </div>
      </dl>
    </article>
  );
}

function TimingEmptyState({ response }: { response: TimingResponse }) {
  const isFiltered =
    response.applied_filters.phase !== null ||
    response.applied_filters.duration !== null;

  if (response.calculation_status.state === "not_scanned") {
    return (
      <section className="timing-empty" aria-labelledby="timing-empty-heading">
        <h2 id="timing-empty-heading">Timing does not have a persisted scan yet.</h2>
        <p>
          Today is where preparation begins. It may first require chart,
          scheduling time zone, locale, or active release setup.
        </p>
        <a className="timing-empty__link" href="#today">
          Open Today <Icon name="arrow" />
        </a>
      </section>
    );
  }

  if (isFiltered) {
    return (
      <section className="timing-empty" aria-labelledby="timing-empty-heading">
        <h2 id="timing-empty-heading">
          {response.unreadable_cycle_count > 0
            ? "No readable cycles match the selected filters."
            : "No persisted cycles match the selected filters."}
        </h2>
        {response.unreadable_cycle_count > 0 ? (
          <p>Omitted stored cycles could not be evaluated against the filters.</p>
        ) : null}
      </section>
    );
  }

  if (response.unreadable_cycle_count > 0) {
    return (
      <section className="timing-empty" aria-labelledby="timing-empty-heading">
        <h2 id="timing-empty-heading">No stored cycles could be displayed.</h2>
        <p>The persisted scan contained no other readable cycle artifacts.</p>
      </section>
    );
  }

  return (
    <section className="timing-empty" aria-labelledby="timing-empty-heading">
      <h2 id="timing-empty-heading">
        No stored cycles overlap the current scan window.
      </h2>
      <p>This does not describe activity outside that stored window.</p>
    </section>
  );
}

export function TimingView({ onUnauthorized }: TimingViewProps) {
  const [phase, setPhase] = useState<"" | TimingPhaseFilter>("");
  const [duration, setDuration] = useState<"" | TimingDurationFilter>("");
  const [response, setResponse] = useState<TimingResponse | null>(null);
  const [failure, setFailure] = useState<TimingFailure | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const resetFilters = useCallback(() => {
    setPhase("");
    setDuration("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);

    const load = async () => {
      try {
        const result = await getTiming(
          {
            ...(phase ? { phase } : {}),
            ...(duration ? { duration } : {}),
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResponse(result);
        setFailure(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setResponse(null);
          setFailure(null);
          onUnauthorized();
          return;
        }
        if (isNotImplemented(error)) {
          setFailure({
            kind: "not_implemented",
            requestId: error.requestId,
          });
          return;
        }
        setFailure({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Timing could not be loaded in this session.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [attempt, duration, onUnauthorized, phase]);

  const isFiltered = phase !== "" || duration !== "";
  const statusMessage = busy
    ? "Loading persisted cycle timing."
    : failure?.kind === "not_implemented"
      ? "Timing availability changed."
      : failure
        ? "Timing request failed."
        : response
          ? "Persisted cycle timing loaded."
          : "Timing is ready to load.";

  return (
    <section className="timing-page page-enter">
      <header className="timing-hero">
        <p className="eyebrow">Timing / Active cycles</p>
        <h1>See the whole arc, not just the peak.</h1>
        <p>
          Inspect calculated cycle windows and exact passes already stored with
          your daily reading. These are factual timing records, not promised
          events or outcomes.
        </p>
      </header>

      <p className="timing-page__status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      {failure ? (
        <section className="timing-failure panel" aria-labelledby="timing-failure-heading">
          <h2 id="timing-failure-heading">
            {failure.kind === "not_implemented"
              ? "Timing is not active on this Worker."
              : failure.message}
          </h2>
          {failure.kind === "not_implemented" ? (
            <p>
              An installed or cached copy of the app may be newer than the
              Worker currently serving this route.
            </p>
          ) : (
            <p>The persisted Timing facts remain unchanged. Try the request again.</p>
          )}
          {failure.requestId ? (
            <small className="timing-failure__request">
              Request {failure.requestId}
            </small>
          ) : null}
          {failure.kind === "error" ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={retry}
              disabled={busy}
              aria-busy={busy}
            >
              Try again <Icon name="refresh" />
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className="timing-scan" aria-label="Timing scan status">
            <div>
              <span className="timing-scan__label">Persisted daily-reading scan</span>
              <strong>
                {response
                  ? scanStateLabel(response.calculation_status.state)
                  : "Checking scan"}
              </strong>
            </div>
            {response?.calculation_status.last_refresh_at ? (
              <p>
                Last prepared{" "}
                <time dateTime={response.calculation_status.last_refresh_at}>
                  {formatTimingInstant(response.calculation_status.last_refresh_at)}
                </time>
              </p>
            ) : null}
            {response && response.unreadable_cycle_count > 0 ? (
              <p className="timing-scan__warning">
                {unreadableMessage(response.unreadable_cycle_count)}
              </p>
            ) : null}
          </section>

          <section className="timing-filters" aria-label="Timing filters">
            <label>
              <span>Phase</span>
              <select
                value={phase}
                onChange={(event) =>
                  setPhase(event.currentTarget.value as "" | TimingPhaseFilter)
                }
              >
                {PHASE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Duration</span>
              <select
                value={duration}
                onChange={(event) =>
                  setDuration(
                    event.currentTarget.value as "" | TimingDurationFilter,
                  )
                }
              >
                {DURATION_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {response?.calculation_status.state === "stale" ? (
            <aside className="timing-notice">
              <p>This persisted scan is from an earlier local day.</p>
              <a href="#today">Open Today</a>
            </aside>
          ) : null}

          {response && response.cycles.length > 0 ? (
            <ol className="timing-cycles">
              {response.cycles.map((cycle) => (
                <li key={cycle.cycle_id}>
                  <CycleArticle cycle={cycle} asOf={response.as_of} />
                </li>
              ))}
            </ol>
          ) : response ? (
            <>
              <TimingEmptyState response={response} />
              {isFiltered ? (
                <button
                  className="button button--secondary timing-filters__reset"
                  type="button"
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
