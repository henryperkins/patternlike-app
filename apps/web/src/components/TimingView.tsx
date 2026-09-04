import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
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
  TIMING_GLOSSARY,
  formatTimingDate,
  formatTimingDuration,
  formatTimingLength,
  formatTimingLocalDate,
  formatTimingOrb,
  nextPassIndex,
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

type TrackStyle = CSSProperties & { "--timing-at": string };

/** Where an instant sits along the envelope, clamped to the track. */
function trackPosition(
  instant: string,
  cycle: Pick<TimingCycle, "start_at" | "end_at">,
): number {
  const instantMs = new Date(instant).valueOf();
  const startMs = new Date(cycle.start_at).valueOf();
  const endMs = new Date(cycle.end_at).valueOf();
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

function at(
  instant: string,
  cycle: Pick<TimingCycle, "start_at" | "end_at">,
): TrackStyle {
  return { "--timing-at": `${trackPosition(instant, cycle)}%` };
}

function unreadableMessage(count: number): string {
  return `${count} stored ${count === 1 ? "cycle" : "cycles"} could not be read.`;
}

/**
 * The arc as a picture: a rule from start to end, filled as far as today,
 * with each exact pass ticked and numbered to match the list beneath it.
 *
 * Decorative by contract. Every date it plots is in the visible list and the
 * span line as real `<time>` elements, so nothing here is the only copy.
 */
function Track({
  cycle,
  asOf,
  nextIndex,
}: {
  cycle: TimingCycle;
  asOf: string;
  nextIndex: number;
}) {
  const active = cycle.status === "active";
  return (
    <div className="timing-track" aria-hidden="true">
      <span className="timing-track__rule" />
      {active ? (
        <span className="timing-track__elapsed" style={at(asOf, cycle)} />
      ) : null}
      {cycle.passes.map((pass, index) => (
        <span
          className={`timing-track__pass${
            index === nextIndex ? " timing-track__pass--next" : ""
          }`}
          key={pass.pass_index}
          style={at(pass.exact_at, cycle)}
        >
          {pass.pass_index}
        </span>
      ))}
      {active ? <span className="timing-track__now" style={at(asOf, cycle)} /> : null}
    </div>
  );
}

function CycleArticle({ cycle, asOf }: { cycle: TimingCycle; asOf: string }) {
  const headingId = useId();
  const nextIndex = nextPassIndex(cycle.passes, asOf);
  const nextPass = nextIndex === -1 ? null : cycle.passes[nextIndex] ?? null;
  const lastPass = cycle.passes[cycle.passes.length - 1] ?? null;

  let detail: ReactNode;
  if (cycle.status === "upcoming") {
    detail = (
      <>
        Starts{" "}
        <time dateTime={cycle.start_at}>{formatTimingDate(cycle.start_at, asOf)}</time>
      </>
    );
  } else if (nextPass) {
    detail = (
      <>
        Next exact{" "}
        <time dateTime={nextPass.exact_at}>
          {formatTimingDate(nextPass.exact_at, asOf)}
        </time>
      </>
    );
  } else if (lastPass) {
    detail = (
      <>
        Last exact{" "}
        <time dateTime={lastPass.exact_at}>
          {formatTimingDate(lastPass.exact_at, asOf)}
        </time>
      </>
    );
  } else {
    detail = null;
  }

  return (
    <article className="timing-cycle" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {timingCycleTitle(cycle.body, cycle.aspect, cycle.target)}
      </h3>
      <p className="timing-cycle__status">
        <span className="timing-cycle__phase">
          {timingPhaseLabel(cycle.phase, cycle.status)}
        </span>
        {detail ? (
          <span
            className={`timing-cycle__detail-line${
              cycle.status === "active" && nextPass
                ? " timing-cycle__detail-line--next"
                : ""
            }`}
          >
            {detail}
          </span>
        ) : null}
      </p>

      <Track cycle={cycle} asOf={asOf} nextIndex={nextIndex} />
      <p className="timing-cycle__span">
        <time dateTime={cycle.start_at}>{formatTimingDate(cycle.start_at, asOf)}</time>
        <span className="timing-cycle__length">
          {formatTimingLength(cycle.duration_days)}
        </span>
        <time dateTime={cycle.end_at}>{formatTimingDate(cycle.end_at, asOf)}</time>
      </p>

      <ol className="timing-cycle__passes" aria-label="Exact passes">
        {cycle.passes.map((pass, index) => {
          const relation =
            index === nextIndex
              ? "next"
              : nextIndex === -1 || index < nextIndex
                ? "past"
                : "later";
          return (
            <li className={`timing-pass timing-pass--${relation}`} key={pass.pass_index}>
              <span className="timing-pass__index">Pass {pass.pass_index}</span>
              <time className="timing-pass__date" dateTime={pass.exact_at}>
                {formatTimingDate(pass.exact_at, asOf)}
              </time>
              <span className="timing-pass__direction">
                {timingDirectionLabel(pass.direction)}
              </span>
              {relation === "next" ? (
                <span className="timing-pass__relation">Next</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <details className="timing-cycle__detail">
        <summary>
          <span>Calculation details</span>
          <span className="timing-toggle">Open</span>
        </summary>
        <dl className="timing-cycle__evidence">
          <div>
            <dt>Orb</dt>
            <dd>{formatTimingOrb(cycle.orb_deg)}</dd>
          </div>
          <div>
            <dt>In range for</dt>
            <dd>{formatTimingDuration(cycle.duration_days)}</dd>
          </div>
          <div>
            <dt>Technique</dt>
            <dd>Transit</dd>
          </div>
          <div className="timing-cycle__identity">
            <dt>Cycle id</dt>
            <dd>{cycle.cycle_id}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function CycleGroup({
  id,
  heading,
  cycles,
  asOf,
}: {
  id: string;
  heading: string;
  cycles: TimingCycle[];
  asOf: string;
}) {
  return (
    <section className="timing-group" aria-labelledby={id}>
      <h2 className="timing-group__heading" id={id}>
        {heading}{" "}
        <span className="timing-group__count">{cycles.length}</span>
      </h2>
      <ol className="timing-cycles">
        {cycles.map((cycle) => (
          <li key={cycle.cycle_id}>
            <CycleArticle cycle={cycle} asOf={asOf} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * When these cycles were found, in one sentence.
 *
 * The receipt is written by daily-reading preparation, so the honest way to
 * say "fresh" is to say which day's reading did the work. A stale receipt
 * keeps its facts on screen and names the one action that renews it.
 *
 * "Today" is the server's word: it compares the receipt's local date with the
 * reader's current local date in the confirmed scheduling zone. The receipt
 * instant would render in the browser's zone, which can sit on the other side
 * of midnight, so no clock time is placed next to that word.
 *
 * A response can carry stored cycles and no receipt at all — persistence
 * succeeded and the reading reservation did not — and the omission count is
 * independent of the receipt. Both stay visible in every state.
 */
function Freshness({ response }: { response: TimingResponse }) {
  const status = response.calculation_status;
  const unreadable = response.unreadable_cycle_count;
  const hasStoredCycles = response.cycles.length > 0 || unreadable > 0;
  if (status.state === "not_scanned" && !hasStoredCycles) return null;

  const refreshedAt = status.last_refresh_at;
  const refreshedOn = status.last_refresh_local_date;

  let sentence: ReactNode;
  if (status.state === "current") {
    sentence = <p>Calculated today, when your daily reading was prepared.</p>;
  } else if (status.state === "stale") {
    sentence = (
      <p>
        Calculated{" "}
        {refreshedOn ? (
          <time dateTime={refreshedOn}>
            {formatTimingLocalDate(refreshedOn, response.as_of)}
          </time>
        ) : refreshedAt ? (
          <time dateTime={refreshedAt}>
            {formatTimingDate(refreshedAt, response.as_of)}
          </time>
        ) : (
          "on an earlier day"
        )}{" "}
        with that day's reading. It updates when today's reading is prepared.{" "}
        <a href="#today">Open Today</a>
      </p>
    );
  } else {
    sentence = (
      <p>
        Calculated for a daily reading that did not finish preparing. It
        updates when today's reading is prepared.{" "}
        <a href="#today">Open Today</a>
      </p>
    );
  }

  return (
    <div className="timing-scan">
      {sentence}
      {unreadable > 0 ? (
        <p className="timing-scan__warning">{unreadableMessage(unreadable)}</p>
      ) : null}
    </div>
  );
}

function TimingEmptyState({ response }: { response: TimingResponse }) {
  const isFiltered =
    response.applied_filters.phase !== null ||
    response.applied_filters.duration !== null;

  if (
    response.calculation_status.state === "not_scanned" &&
    response.unreadable_cycle_count === 0
  ) {
    return (
      <section className="timing-empty" aria-labelledby="timing-empty-heading">
        <h2 id="timing-empty-heading">No cycles have been calculated yet.</h2>
        <p>
          They are calculated the first time your daily reading is prepared.
          That needs your chart, a confirmed time zone and language, and your
          AI-synthesis consent.
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
        <h2 id="timing-empty-heading">No cycles match these filters.</h2>
        {response.unreadable_cycle_count > 0 ? (
          <p>Cycles that could not be read were not checked against them.</p>
        ) : null}
      </section>
    );
  }

  if (response.unreadable_cycle_count > 0) {
    return (
      <section className="timing-empty" aria-labelledby="timing-empty-heading">
        <h2 id="timing-empty-heading">None of the stored cycles could be shown.</h2>
        <p>
          Every cycle stored by this calculation failed to read. There is
          nothing else to show.
        </p>
      </section>
    );
  }

  // The route drops a cycle the moment its envelope ends, so an empty list is
  // a statement about now, never about what the scan stored.
  return (
    <section className="timing-empty" aria-labelledby="timing-empty-heading">
      <h2 id="timing-empty-heading">Nothing is in range right now.</h2>
      <p>
        No stored cycle is in range today or about to come into range. That
        says nothing about dates outside the window the calculation covered.
      </p>
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
    ? "Loading your cycles."
    : failure?.kind === "not_implemented"
      ? "Timing is not available on this server."
      : failure
        ? "Timing could not be loaded."
        : response
          ? "Cycles loaded."
          : "Ready to load.";

  // Filters only appear when there is something they could narrow: a list, or
  // an applied filter the reader needs to be able to clear. The server's echo
  // counts too, so a filtered-empty answer can never strand the controls.
  const responseFiltered =
    response !== null &&
    (response.applied_filters.phase !== null ||
      response.applied_filters.duration !== null);
  const showFilters =
    response !== null &&
    (response.cycles.length > 0 || isFiltered || responseFiltered);
  const activeCycles = response?.cycles.filter((cycle) => cycle.status === "active") ?? [];
  const upcomingCycles =
    response?.cycles.filter((cycle) => cycle.status === "upcoming") ?? [];

  return (
    <section className="timing-page page-enter">
      <header className="timing-hero">
        <p className="eyebrow">Timing / Active cycles</p>
        <h1>Where each cycle stands today.</h1>
        <p className="timing-hero__lede">
          A cycle is a planet in the current sky lining up at a set angle with
          a point in your birth chart. It comes into range, is exact once or a
          few times, then moves on. These are the cycles your daily reading
          works from: calculated dates, not predicted events.
        </p>
        <details className="timing-glossary">
          <summary>
            <span>What the terms mean</span>
            <span className="timing-toggle">Open</span>
          </summary>
          <dl>
            {TIMING_GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt>{entry.term}</dt>
                <dd>{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>

      {failure ? (
        <section className="timing-failure panel" aria-labelledby="timing-failure-heading">
          <h2 id="timing-failure-heading">
            {failure.kind === "not_implemented"
              ? "Timing is not available on this server."
              : failure.message}
          </h2>
          {failure.kind === "not_implemented" ? (
            <p>
              An installed or cached copy of the app may be newer than the
              server answering it.
            </p>
          ) : (
            <p>Nothing stored has changed. Try the request again.</p>
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
          {response ? <Freshness response={response} /> : null}

          {showFilters ? (
            <section
              className={`timing-filters${busy ? " timing-filters--busy" : ""}`}
              aria-label="Timing filters"
            >
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
          ) : null}

          {busy && !response ? (
            <div className="timing-loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}

          {response && response.cycles.length > 0 ? (
            <div className="timing-groups" aria-busy={busy || undefined}>
              {activeCycles.length > 0 ? (
                <CycleGroup
                  id="timing-active-heading"
                  heading="Active now"
                  cycles={activeCycles}
                  asOf={response.as_of}
                />
              ) : null}
              {upcomingCycles.length > 0 ? (
                <CycleGroup
                  id="timing-upcoming-heading"
                  heading="Upcoming"
                  cycles={upcomingCycles}
                  asOf={response.as_of}
                />
              ) : null}
            </div>
          ) : response ? (
            <>
              <TimingEmptyState response={response} />
              {isFiltered || responseFiltered ? (
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
