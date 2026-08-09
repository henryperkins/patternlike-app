import { useCallback, useEffect, useId, useState } from "react";
import {
  getTodayReading,
  type DailyReading,
  type DailyReadingResponse,
  type ReadingParagraph,
} from "../lib/api-client.js";
import { NOT_IMPLEMENTED_MESSAGE, withRequestId } from "../lib/api-status.js";
import { classifyTodayError } from "../lib/reading-state.js";
import {
  ROLE_PRESENTATION,
  domainPreferenceLabel,
  formatLocalDate,
} from "../lib/reading-format.js";
import { PreferenceConfirm } from "./PreferenceConfirm.js";
import { WhyThisDrawer } from "./WhyThisDrawer.js";
import { Icon } from "./icons.js";

type TodayState =
  | { status: "loading" }
  | { status: "ready"; response: DailyReadingResponse }
  | { status: "needs_onboarding"; requestId: string | null }
  | { status: "not_generated"; requestId: string | null; localDate: string | null }
  | {
      status: "needs_preference";
      preference: "timezone" | "locale";
      requestId: string | null;
    }
  | { status: "not_implemented"; requestId: string | null }
  | { status: "error"; message: string; requestId: string | null };

interface TodayViewProps {
  /**
   * A 401 has a screen already. Rendering "Unreachable" for it, as the generic
   * route panel does, is a lie about a state the app knows how to handle.
   *
   * Must be referentially stable — it is one of the effect's dependencies.
   */
  onUnauthorized: () => void;
}

/**
 * A fallback reading is the whole reading, not a decorated failure.
 *
 * Derived from the flag but checked against the shape: the contract says
 * `fallback_used` implies exactly one `safety_fallback` paragraph, and if a
 * response ever disagrees, rendering what is actually there beats assuming an
 * element that is not.
 */
function isFallbackShape(reading: DailyReading): boolean {
  return (
    reading.fallback_used &&
    reading.paragraphs.length === 1 &&
    reading.paragraphs[0]?.role === "safety_fallback"
  );
}

function Paragraph({ paragraph }: { paragraph: ReadingParagraph }) {
  const presentation = ROLE_PRESENTATION[paragraph.role];
  const kicker = presentation?.kicker;
  const tone = presentation?.tone ?? "body";

  const body = (
    <>
      {kicker ? <p className="kicker">{kicker}</p> : null}
      <p className={`reading-paragraph reading-paragraph--${tone}`}>{paragraph.text}</p>
    </>
  );

  if (tone === "aside") {
    return <aside className="reading-reflection">{body}</aside>;
  }
  if (tone === "notice") {
    return (
      <div className={`reading-notice reading-notice--${paragraph.role}`}>
        <Icon name="shield" aria-hidden="true" />
        <div>{body}</div>
      </div>
    );
  }
  return <div className={`reading-block reading-block--${paragraph.role}`}>{body}</div>;
}

function TodayReading({
  response,
  headingId,
  onReload,
  onUnauthorized,
}: {
  response: DailyReadingResponse;
  headingId: string;
  onReload: () => void;
  onUnauthorized: () => void;
}) {
  const { reading } = response;
  const paragraphs = [...reading.paragraphs].sort((a, b) => a.order - b.order);

  return (
    <article className="today-page page-enter" aria-labelledby={headingId}>
      <header className="page-header today-page__header">
        <div>
          <p className="eyebrow">Today / Daily chapter</p>
          <h1 id={headingId}>{formatLocalDate(reading.local_date)}</h1>
        </div>
        {/*
          The meta strip, never the prose. `revision_reason` lives only on the
          evidence graph, so the chip can say a reading was revised and only the
          drawer can say why.
        */}
        <div className="today-meta">
          {reading.domain_preference ? (
            <span className="today-chip">
              {domainPreferenceLabel(reading.domain_preference)}
            </span>
          ) : null}
          {reading.revision > 1 ? (
            <span className="today-chip today-chip--revised">
              Revised · r{reading.revision}
            </span>
          ) : null}
          <span className="today-chip today-chip--code">{reading.locale}</span>
        </div>
      </header>

      {isFallbackShape(reading) ? (
        <p className="today-fallback-note">
          Nothing in your chart was eligible to be written about today, so what
          follows is a reviewed passage shown in its place. It is not tailored to
          your chart.
        </p>
      ) : null}

      <div className="today-body">
        {paragraphs.map((paragraph) => (
          <Paragraph key={paragraph.paragraph_id} paragraph={paragraph} />
        ))}
      </div>

      {response.evidence_url ? (
        // Keyed for the same reason the preference form is: the drawer caches
        // its fetch for the reading it was opened against, and its 404 branch
        // deliberately does not re-arm. "Reload Today" after a reissue answers
        // with a different reading id into the same mounted instance, which
        // would leave the drawer reporting the old reading as missing and
        // refusing to fetch the new one. Same id keeps the cache.
        <WhyThisDrawer
          key={reading.reading_id}
          readingId={reading.reading_id}
          paragraphOrder={paragraphs.map((paragraph) => paragraph.paragraph_id)}
          onReload={onReload}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </article>
  );
}

interface NoticeAction {
  label: string;
  onClick: () => void;
}

/**
 * Every non-reading state, rendered through one component.
 *
 * The action button is a slot rather than part of `children` so it holds the
 * same position in the tree across a state change. Rendering it only on the
 * failed state — the obvious version — makes the button remove itself in the
 * same commit as its own click and drops focus to `<body>` every attempt.
 */
function TodayNotice({
  title,
  children,
  requestId,
  action,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  requestId?: string | null;
  action?: NoticeAction;
  busy?: boolean;
}) {
  return (
    <section className="today-empty page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">Today / Daily chapter</p>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="today-empty__panel panel">
        {children}
        {action ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={action.onClick}
            disabled={busy}
            aria-busy={busy}
          >
            {action.label} <Icon name="refresh" />
          </button>
        ) : null}
        {requestId ? <small className="today-empty__request">Request {requestId}</small> : null}
      </div>
    </section>
  );
}

const QUIET_LINE = "A clear day, not a horoscope feed.";

export function TodayView({ onUnauthorized }: TodayViewProps) {
  const [state, setState] = useState<TodayState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const headingId = useId();

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // Deliberately not reset to `loading`: a refresh keeps whatever is on screen
    // and only marks it busy, so the control the reader just pressed stays
    // mounted and keeps focus.
    setBusy(true);

    const load = async () => {
      try {
        const response = await getTodayReading(controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "ready", response });
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = classifyTodayError(error);
        switch (failure.kind) {
          case "unauthorized":
            onUnauthorized();
            return;
          case "needs_onboarding":
            setState({ status: "needs_onboarding", requestId: failure.requestId });
            return;
          case "not_generated":
            setState({
              status: "not_generated",
              requestId: failure.requestId,
              localDate: failure.localDate,
            });
            return;
          case "needs_preference":
            setState({
              status: "needs_preference",
              preference: failure.preference,
              requestId: failure.requestId,
            });
            return;
          case "not_implemented":
            setState({ status: "not_implemented", requestId: failure.requestId });
            return;
          case "error":
            setState({
              status: "error",
              message: failure.message,
              requestId: failure.requestId,
            });
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [attempt, onUnauthorized]);

  switch (state.status) {
    case "ready":
      return (
        <TodayReading
          response={state.response}
          headingId={headingId}
          onReload={reload}
          onUnauthorized={onUnauthorized}
        />
      );

    case "needs_preference":
      return (
        // Keyed, because both preferences render through this one element.
        // A first-run reader confirms the zone and the reload answers
        // `locale_confirmation_required` — the same component type in the same
        // position, so React would keep the instance and its state: the field
        // still holding the time zone, the status line still reading "Saved",
        // and the idempotency ref still pointing at the zone write. The key
        // makes the second question a new form.
        <PreferenceConfirm
          key={state.preference}
          kind={state.preference}
          requestId={state.requestId}
          onSaved={reload}
          onUnauthorized={onUnauthorized}
        />
      );

    case "loading":
      return (
        <TodayNotice title="Reading today.">
          <p role="status" aria-live="polite">
            Looking for the reading published for your local day.
          </p>
        </TodayNotice>
      );

    case "needs_onboarding":
      return (
        <TodayNotice title="Your chart is not calculated yet." requestId={state.requestId}>
          <p>
            A daily reading is assembled from your own chart facts. Until that
            calculation exists there is nothing to read — and nothing generic
            will be shown in its place.
          </p>
          <p className="today-empty__aside">{QUIET_LINE}</p>
          <a className="button button--primary" href="#pattern">
            Set up your chart <Icon name="arrow" />
          </a>
        </TodayNotice>
      );

    case "not_generated":
      return (
        <TodayNotice
          title="Today's reading is not ready."
          requestId={state.requestId}
          action={{ label: "Check again", onClick: reload }}
          busy={busy}
        >
          <p role="status" aria-live="polite">
            {state.localDate
              ? `Nothing has been published for ${formatLocalDate(state.localDate)} yet.`
              : "Nothing has been published for your local day yet."}{" "}
            {/*
              Deliberately no estimate. Readings are generated on a schedule
              against a frozen command, and this build has nothing honest to
              promise — a reader told "by morning" and then not given one has
              been lied to by the screen.
            */}
            Readings are assembled once per local day, on a schedule, from
            reviewed content — not on demand when you open the app.
          </p>
          <p className="today-empty__aside">{QUIET_LINE}</p>
        </TodayNotice>
      );

    case "not_implemented":
      // A roadmap answer, not a failure: no retry, because asking again can only
      // produce the same 501.
      return (
        <TodayNotice title="Today is not built yet.">
          <p role="status" aria-live="polite">
            {withRequestId(NOT_IMPLEMENTED_MESSAGE, state.requestId)}
          </p>
        </TodayNotice>
      );

    case "error":
      return (
        <TodayNotice
          title="Today could not load."
          action={{ label: "Try again", onClick: reload }}
          busy={busy}
        >
          <p role="status" aria-live="polite">
            {withRequestId(state.message, state.requestId)}
          </p>
        </TodayNotice>
      );
  }
}
