import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api-client.js";
import {
  NOT_IMPLEMENTED_MESSAGE,
  isNotImplemented,
  withRequestId,
} from "../lib/api-status.js";
import { Icon } from "./icons.js";

type FeatureViewState =
  | { status: "loading" }
  | { status: "success"; data: unknown }
  | { status: "not_implemented"; requestId: string | null }
  | { status: "error"; message: string; requestId: string | null };

type FeatureFetcher = (signal?: AbortSignal) => Promise<unknown>;

interface ApiFirstFeatureViewProps {
  eyebrow: string;
  title: string;
  description: string;
  milestone: "M3" | "M4";
  /**
   * Must be referentially stable — it is the effect's dependency. Callers that
   * need to bind an argument wrap it in `useCallback`.
   */
  fetcher: FeatureFetcher;
}

/**
 * Short, honest label for the panel chip. The previous version printed "Loaded"
 * for every non-loading state, so a 501 and an unreachable API both claimed the
 * route had loaded.
 */
function routeStateLabel(state: FeatureViewState): string {
  switch (state.status) {
    case "loading":
      return "Checking";
    case "success":
      return "Live";
    case "not_implemented":
      return "Not active";
    case "error":
      return "Unreachable";
  }
}

function featureStatusMessage(state: FeatureViewState): string {
  switch (state.status) {
    case "loading":
      return "Checking whether this route is serving yet.";
    case "success":
      return "This route is returning data. The surface that renders it lands with the milestone.";
    case "not_implemented":
      return withRequestId(NOT_IMPLEMENTED_MESSAGE, state.requestId);
    case "error":
      return withRequestId(state.message, state.requestId);
  }
}

export function ApiFirstFeatureView({
  eyebrow,
  title,
  description,
  milestone,
  fetcher,
}: ApiFirstFeatureViewProps) {
  const [state, setState] = useState<FeatureViewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    const load = async () => {
      try {
        const response = await fetcher(controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "success", data: response });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isNotImplemented(error)) {
          setState({ status: "not_implemented", requestId: error.requestId });
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "This route could not load in this session.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      }
    };

    void load();
    return () => controller.abort();
  }, [fetcher, attempt]);

  // A 501 is a roadmap answer, not a failure — retrying it would only ask the
  // same question again, so the control is withheld there.
  const showRetry =
    state.status === "error" || (state.status === "loading" && attempt > 0);

  return (
    <section className="unavailable-page page-enter">
      <header className="unavailable-hero">
        <p className="eyebrow">{eyebrow}</p>
        <span className="milestone-stamp">Planned / {milestone}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      <section className="readiness-panel panel">
        <div className="readiness-panel__header">
          <h2>Route status</h2>
          <span className="readiness-state">{routeStateLabel(state)}</span>
        </div>

        {/*
          The live region is mounted unconditionally: a region inserted into the
          DOM at the same moment as its first message is unreliably announced.
        */}
        <p className="route-status" role="status" aria-live="polite">
          {featureStatusMessage(state)}
        </p>

        {/*
          Kept mounted through the reload it triggers. Rendering it on `error`
          alone meant the button removed itself in the same commit as its own
          click, dropping focus to <body> on every attempt.
        */}
        {showRetry ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={retry}
            disabled={state.status === "loading"}
            aria-busy={state.status === "loading"}
          >
            Try again <Icon name="refresh" />
          </button>
        ) : null}

        {/*
          Payloads for these routes are not modelled yet, so there is no honest
          way to render one to a reader. Developers can still see the shape.
        */}
        {state.status === "success" && import.meta.env.DEV ? (
          <pre className="route-payload">{JSON.stringify(state.data, null, 2)}</pre>
        ) : null}
      </section>

      <a className="return-link" href="#pattern">
        <span>Return to what is available now</span>
        View your calculated pattern
      </a>
    </section>
  );
}
