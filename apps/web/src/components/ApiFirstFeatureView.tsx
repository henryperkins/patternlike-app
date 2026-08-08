import { useEffect, useState } from "react";
import { ApiError } from "../lib/api-client.js";

type FeatureViewState =
  | { status: "loading" }
  | { status: "success"; data: unknown }
  | { status: "empty" }
  | { status: "not_implemented"; requestId: string | null }
  | { status: "error"; message: string; requestId: string | null };

type FeatureFetcher = (signal?: AbortSignal) => Promise<unknown>;

interface ApiFirstFeatureViewProps {
  eyebrow: string;
  title: string;
  description: string;
  milestone: "M3" | "M4";
  fetcher: FeatureFetcher;
}

function isEmptyPayload(data: unknown): boolean {
  if (data == null) return true;
  if (typeof data === "string") return data.trim().length === 0;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") return Object.keys(data).length === 0;
  return false;
}

function featureStatusMessage(state: FeatureViewState): string | null {
  switch (state.status) {
    case "loading":
      return "Loading data...";
    case "not_implemented":
      return `Available in a later milestone${state.requestId ? ` (Request ${state.requestId})` : ""}`;
    case "error":
      return `Failed${state.requestId ? ` (Request ${state.requestId})` : ""}. ${state.message}`;
    case "empty":
      return "Nothing available yet.";
    case "success":
      return "Data received.";
    default:
      return null;
  }
}

export function ApiFirstFeatureView({ eyebrow, title, description, milestone, fetcher }: ApiFirstFeatureViewProps) {
  const [state, setState] = useState<FeatureViewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    const load = async () => {
      try {
        const response = await fetcher(controller.signal);
        if (controller.signal.aborted) return;
        setState(isEmptyPayload(response) ? { status: "empty" } : { status: "success", data: response });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 501 && error.code === "not_implemented") {
          setState({ status: "not_implemented", requestId: error.requestId });
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "This route could not load in this session.";
        const requestId = error instanceof ApiError ? error.requestId : null;
        setState({ status: "error", message, requestId });
      }
    };

    void load();
    return () => controller.abort();
  }, [fetcher]);

  const body = state.status === "success" ? JSON.stringify(state.data, null, 2) : "";

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
          <span className="readiness-state">
            {state.status === "loading" ? "Loading" : "Loaded"}
          </span>
        </div>
        <p>{featureStatusMessage(state)}</p>

        {state.status === "success" ? (
          <pre>{body}</pre>
        ) : null}
      </section>

      <a className="return-link" href="#pattern">
        <span>Return to what is available now</span>
        View your calculated pattern
      </a>
    </section>
  );
}
