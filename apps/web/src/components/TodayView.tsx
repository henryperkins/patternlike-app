import { useCallback, useEffect, useState } from "react";
import {
  ensureTodayReading,
  type DailyReadingResponse,
} from "../lib/api-client.js";
import { NOT_IMPLEMENTED_MESSAGE, withRequestId } from "../lib/api-status.js";
import { classifyTodayError } from "../lib/reading-state.js";
import { formatLocalDate } from "../lib/reading-format.js";
import { AiConsentGate } from "./AiConsentGate.js";
import { PreferenceConfirm } from "./PreferenceConfirm.js";
import { ReadingArticle } from "./ReadingArticle.js";
import { Icon } from "./icons.js";

type TodayState =
  | { status: "loading" }
  | { status: "ready"; response: DailyReadingResponse }
  | { status: "needs_onboarding"; requestId: string | null }
  | {
      status: "preparing";
      localDate: string;
      takingLonger: boolean;
      /** Which publisher is preparing it, so the wait can say what it is doing. */
      schemaVersion: string;
    }
  | {
      status: "needs_preference";
      preference: "timezone" | "locale";
      requestId: string | null;
    }
  | { status: "needs_ai_consent"; requestId: string | null }
  | { status: "not_implemented"; requestId: string | null }
  | {
      status: "error";
      message: string;
      requestId: string | null;
      retryable: boolean;
    };

interface TodayViewProps {
  /**
   * A 401 has a screen already. Rendering "Unreachable" for it, as the generic
   * route panel does, is a lie about a state the app knows how to handle.
   *
   * Must be referentially stable — it is one of the effect's dependencies.
   */
  onUnauthorized: () => void;
  /** Re-run a preference-gated load after foreground device sync settles. */
  preferenceSyncRevision: number;
}

interface NoticeAction {
  label: string;
  onClick: () => void;
}

/**
 * The one thing on a waiting screen that says the app is still working.
 *
 * Both waiting states poll — 500ms, then 1s, 2s, 5s — and neither drew anything
 * that moved, so a phone left on the preparing screen was indistinguishable
 * from a phone that had stopped. Purely decorative: the sentence beside it is
 * already in an `aria-live` region, and repeating "working" to a screen reader
 * every frame would be worse than silent. Under `prefers-reduced-motion` the
 * animation is suppressed and the three marks resolve to a static ellipsis.
 */
function WorkingMarks() {
  return (
    <span className="today-working" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
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

/**
 * A preparation response carries only its package version, so that is what
 * chooses the wait copy. Anything that is not the v5 package is described as the
 * reviewed-content assembly it is; a later package that still generates is told
 * apart by its own version, not by guessing from the shape.
 */
function isV5Preparation(schemaVersion: string): boolean {
  return schemaVersion.startsWith("0.5.");
}
const POLL_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;
const SLOW_PREPARATION_MS = 15_000;

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const settle = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    const timeoutId = setTimeout(settle, milliseconds);
    signal.addEventListener("abort", settle, { once: true });
  });
}

export function TodayView({
  onUnauthorized,
  preferenceSyncRevision,
}: TodayViewProps) {
  const [state, setState] = useState<TodayState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let slowPreparationTimer: ReturnType<typeof setTimeout> | undefined;
    let hasStartedPreparation = false;

    const clearSlowPreparationTimer = () => {
      if (slowPreparationTimer !== undefined) {
        clearTimeout(slowPreparationTimer);
        slowPreparationTimer = undefined;
      }
    };

    // Deliberately not reset to `loading`: a refresh keeps whatever is on screen
    // and only marks it busy, so the control the reader just pressed stays
    // mounted and keeps focus.
    setBusy(true);

    const load = async () => {
      let pollIndex = 0;
      try {
        while (!controller.signal.aborted) {
          const response = await ensureTodayReading(controller.signal);
          if (controller.signal.aborted) return;

          if ("reading" in response) {
            clearSlowPreparationTimer();
            setState({ status: "ready", response });
            return;
          }

          if (!hasStartedPreparation) {
            hasStartedPreparation = true;
            setState({
              status: "preparing",
              localDate: response.local_date,
              takingLonger: false,
              schemaVersion: response.schema_version,
            });
            slowPreparationTimer = setTimeout(() => {
              if (controller.signal.aborted) return;
              setState((current) =>
                current.status === "preparing"
                  ? { ...current, takingLonger: true }
                  : current,
              );
            }, SLOW_PREPARATION_MS);
          }

          const delay =
            POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)]!;
          pollIndex += 1;
          await abortableDelay(delay, controller.signal);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        clearSlowPreparationTimer();
        const failure = classifyTodayError(error);
        switch (failure.kind) {
          case "unauthorized":
            onUnauthorized();
            return;
          case "needs_onboarding":
            setState({ status: "needs_onboarding", requestId: failure.requestId });
            return;
          case "needs_preference":
            setState({
              status: "needs_preference",
              preference: failure.preference,
              requestId: failure.requestId,
            });
            return;
          case "needs_ai_consent":
            setState({ status: "needs_ai_consent", requestId: failure.requestId });
            return;
          case "not_implemented":
            setState({ status: "not_implemented", requestId: failure.requestId });
            return;
          case "error":
            setState({
              status: "error",
              message: failure.message,
              requestId: failure.requestId,
              retryable: failure.retryable,
            });
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      clearSlowPreparationTimer();
    };
  }, [attempt, onUnauthorized, preferenceSyncRevision]);

  switch (state.status) {
    case "ready":
      return (
        <ReadingArticle
          response={state.response}
          showCheckIn
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

    case "needs_ai_consent":
      return (
        <AiConsentGate
          requestId={state.requestId}
          onGranted={reload}
          onUnauthorized={onUnauthorized}
        />
      );

    case "loading":
      return (
        <TodayNotice title="Reading today.">
          <WorkingMarks />
          <p role="status" aria-live="polite">
            Starting your reading for today.
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

    case "preparing":
      return (
        <TodayNotice title="Preparing your reading.">
          <WorkingMarks />
          <p role="status" aria-live="polite">
            {state.takingLonger
              ? `Your reading for ${formatLocalDate(state.localDate)} is still being prepared. This is taking longer than usual; you can leave this page and come back.`
              : isV5Preparation(state.schemaVersion)
                ? `Your reading for ${formatLocalDate(state.localDate)} is being grounded in your calculated chart, today's calculated sky, and the context you have enabled. It will appear here when it is ready.`
                : `Your reading for ${formatLocalDate(state.localDate)} is being assembled from reviewed content. It will appear here when it is ready.`}
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
          // Offered only where the server said asking again can make progress.
          // An exhausted generation and an unconfigured publisher both end here,
          // and a control that cannot succeed is worse than no control.
          action={
            state.retryable ? { label: "Try again", onClick: reload } : undefined
          }
          busy={busy}
        >
          <p role="status" aria-live="polite">
            {withRequestId(state.message, state.requestId)}
          </p>
        </TodayNotice>
      );
  }
}
