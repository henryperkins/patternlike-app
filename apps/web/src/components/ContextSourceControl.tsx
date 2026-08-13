import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  getContextSources,
  newIdempotencyKey,
  updateContextSources,
  type ContextSourceState,
  type ContextSourcesDocument,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";

const USE_LABELS: Record<string, string> = {
  theme_ranking: "Rank eligible themes",
  tone: "Shape tone",
  reflection_prompt: "Shape the reflection question",
  notification_timing: "Choose notification timing",
};

const STATE_LABELS: Record<ContextSourceState, string> = {
  active: "Active",
  paused: "Paused",
  revoked: "Revoked",
  expired: "Expired",
  never_granted: "Not enabled",
};

type SourceState =
  | { status: "loading" }
  | { status: "ready"; document: ContextSourcesDocument }
  | { status: "unreadable"; message: string; requestId: string | null };

function desiredDocument(
  document: ContextSourcesDocument,
  permissionState: "active" | "paused" | "revoked",
): ContextSourcesDocument {
  return {
    ...document,
    sources: [{
      ...document.sources[0],
      enabled: permissionState === "active",
      permission_state: permissionState,
    }],
  };
}

export function ContextSourceControl() {
  const [state, setState] = useState<SourceState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [reload, setReload] = useState(0);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const keys = useRef<Partial<Record<"active" | "paused" | "revoked", string>>>({});

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const document = await getContextSources(controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", document });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "unreadable",
          message:
            error instanceof Error
              ? error.message
              : "Daily check-in permission could not be read.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      }
    })();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (restoreFocus && state.status === "ready") {
      setRestoreFocus(false);
      primaryActionRef.current?.focus();
    }
  }, [restoreFocus, state]);

  const mutate = async (next: "active" | "paused" | "revoked") => {
    if (state.status !== "ready") return;
    setBusy(true);
    setProblem("");
    keys.current[next] ??= newIdempotencyKey("web-context-source");
    try {
      const document = await updateContextSources(
        desiredDocument(state.document, next),
        keys.current[next],
      );
      keys.current = {};
      setState({ status: "ready", document });
      setRestoreFocus(true);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? withRequestId(error.message, error.requestId)
          : error instanceof Error
            ? error.message
            : "That source change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") {
    return (
      <article className="source-row source-row--live" aria-label="Daily check-in">
        <span className="source-state"><i /> Reading state</span>
        <div><h3>Daily check-in</h3><p>Reading its current permission.</p></div>
        <p className="source-row__status" role="status" aria-live="polite" />
      </article>
    );
  }

  if (state.status === "unreadable") {
    return (
      <article className="source-row source-row--live" aria-label="Daily check-in">
        <span className="source-state"><i /> Unknown</span>
        <div>
          <h3>Daily check-in</h3>
          <p>{withRequestId(state.message, state.requestId)}</p>
        </div>
        <div className="source-row__actions">
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
        <p className="source-row__status" role="status" aria-live="polite" />
      </article>
    );
  }

  const source = state.document.sources[0];
  const inactive = source.permission_state !== "active";
  return (
    <article className="source-row source-row--live" aria-label="Daily check-in">
      <span className={`source-state${source.enabled ? " source-state--active" : ""}`}>
        <i /> {STATE_LABELS[source.permission_state]}
      </span>
      <div className="source-row__body">
        <h3>Daily check-in</h3>
        {source.allowed_uses.length > 0 ? (
          <ul className="source-row__uses" aria-label="Permitted uses">
            {source.allowed_uses.map((use) => (
              <li key={use}>{USE_LABELS[use] ?? use}</li>
            ))}
          </ul>
        ) : (
          <p>No uses are permitted until you enable this source.</p>
        )}
        {source.permission_state === "revoked" ? (
          <p className="source-row__consequence">
            Future use stops immediately. Retained encrypted check-ins age out
            under the thirteen-month maximum retention policy.
          </p>
        ) : null}
      </div>
      <div className="source-row__actions">
        {inactive ? (
          <button
            type="button"
            ref={primaryActionRef}
            onClick={() => void mutate("active")}
            disabled={busy}
          >
            {source.permission_state === "paused" ? "Resume" : "Enable"}
          </button>
        ) : (
          <button
            type="button"
            ref={primaryActionRef}
            onClick={() => void mutate("paused")}
            disabled={busy}
          >
            Pause
          </button>
        )}
        {source.permission_state === "active" || source.permission_state === "paused" ? (
          <button
            type="button"
            className="source-row__revoke"
            onClick={() => void mutate("revoked")}
            disabled={busy}
          >
            Revoke
          </button>
        ) : null}
      </div>
      <p className="source-row__status" role="status" aria-live="polite">
        {busy ? "Saving permission." : problem}
      </p>
    </article>
  );
}
