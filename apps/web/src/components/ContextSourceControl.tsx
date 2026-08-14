import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  findContextSource,
  getContextSources,
  newIdempotencyKey,
  updateContextSource,
  type ContextSourceId,
  type ContextSourceProjection,
  type ContextSourceState,
  type ContextSourcesDocument,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";

const USE_LABELS: Record<string, string> = {
  theme_ranking: "Rank eligible themes",
  tone: "Shape tone",
  reflection_prompt: "Shape the reflection question",
  notification_timing: "Choose notification timing",
  time_travel: "Show saved events beside a reconstructed date",
};

const STATE_LABELS: Record<ContextSourceState, string> = {
  active: "Active",
  paused: "Paused",
  revoked: "Revoked",
  expired: "Expired",
  never_granted: "Not enabled",
};

type TransitionState = "active" | "paused" | "revoked";

interface SourceCopy {
  id: ContextSourceId;
  name: string;
  /** Shown when the source has no permitted use yet. */
  idle: string;
  /** What stops, and what is retained, when the reader revokes. */
  revoked: string;
}

/**
 * One entry per registry source this screen governs.
 *
 * They are listed separately, and mutated separately, because they are separate
 * consents: the Life-event timeline is the only grant that reaches Time Travel,
 * and enabling Daily check-in must never be a side door into it.
 */
const SOURCES: readonly SourceCopy[] = [
  {
    id: "USR-06",
    name: "Daily check-in",
    idle: "No uses are permitted until you enable this source.",
    revoked:
      "Future use stops immediately. Retained encrypted check-ins age out under the thirteen-month maximum retention policy.",
  },
  {
    id: "USR-09",
    name: "Life-event timeline",
    idle: "No uses are permitted until you enable this source.",
    revoked:
      "Saved events stop appearing in Time Travel immediately. They are retained, and remain listed and deletable, until you delete them.",
  },
];

type DocumentState =
  | { status: "loading" }
  | { status: "ready"; document: ContextSourcesDocument }
  | { status: "unreadable"; message: string; requestId: string | null };

/** Only `enabled` and `permission_state` are the reader's to change. */
function desiredSource(
  source: ContextSourceProjection,
  permissionState: TransitionState,
): ContextSourceProjection {
  return {
    ...source,
    enabled: permissionState === "active",
    permission_state: permissionState,
  };
}

interface SourceRowProps {
  copy: SourceCopy;
  state: DocumentState;
  /** Only the first row owns the reload: one document, one request. */
  canReload: boolean;
  busy: boolean;
  problem: string;
  focusPrimary: boolean;
  onReload: () => void;
  onTransition: (copy: SourceCopy, source: ContextSourceProjection, next: TransitionState) => void;
}

/**
 * One row per source, and always the same component at the same position.
 *
 * The loading, unreadable, and ready states are branches *inside* the row
 * rather than three different trees above it. Swapping element types at this
 * position would make React unmount and remount the row on every state change,
 * which moves focus and hands assistive technology a new node for the same
 * control.
 */
function SourceRow({
  copy,
  state,
  canReload,
  busy,
  problem,
  focusPrimary,
  onReload,
  onTransition,
}: SourceRowProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const source = state.status === "ready" ? findContextSource(state.document, copy.id) : null;

  useEffect(() => {
    if (focusPrimary) primaryActionRef.current?.focus();
  }, [focusPrimary, source]);

  let stateLabel = "Reading state";
  if (state.status === "unreadable") stateLabel = "Unknown";
  else if (state.status === "ready") {
    stateLabel = source ? STATE_LABELS[source.permission_state] : "Unavailable";
  }
  const inactive = source !== null && source.permission_state !== "active";

  return (
    <article className="source-row source-row--live" aria-label={copy.name}>
      <span
        className={`source-state${source?.enabled ? " source-state--active" : ""}`}
      >
        <i /> {stateLabel}
      </span>

      <div className="source-row__body">
        <h3>{copy.name}</h3>

        {state.status === "loading" ? <p>Reading its current permission.</p> : null}

        {state.status === "unreadable" ? (
          <p>{withRequestId(state.message, state.requestId)}</p>
        ) : null}

        {/* A document that does not carry this source is not "off": there is
            nothing to compare-and-set against, so offering an action would
            promise a request the client cannot make. */}
        {state.status === "ready" && !source ? (
          <p>This API version does not offer this source yet.</p>
        ) : null}

        {source && source.allowed_uses.length > 0 ? (
          <ul className="source-row__uses" aria-label={`${copy.name} permitted uses`}>
            {source.allowed_uses.map((use) => (
              <li key={use}>{USE_LABELS[use] ?? use}</li>
            ))}
          </ul>
        ) : null}

        {source && source.allowed_uses.length === 0 ? <p>{copy.idle}</p> : null}

        {source?.permission_state === "revoked" ? (
          <p className="source-row__consequence">{copy.revoked}</p>
        ) : null}
      </div>

      <div className="source-row__actions">
        {state.status === "unreadable" && canReload ? (
          <button type="button" onClick={onReload}>
            Try again
          </button>
        ) : null}

        {source ? (
          <>
            <button
              type="button"
              ref={primaryActionRef}
              onClick={() => onTransition(copy, source, inactive ? "active" : "paused")}
              disabled={busy}
            >
              {inactive
                ? source.permission_state === "paused"
                  ? "Resume"
                  : "Enable"
                : "Pause"}
            </button>
            {source.permission_state === "active" || source.permission_state === "paused" ? (
              <button
                type="button"
                className="source-row__revoke"
                onClick={() => onTransition(copy, source, "revoked")}
                disabled={busy}
              >
                Revoke
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <p className="source-row__status" role="status" aria-live="polite">
        {busy ? "Saving permission." : problem}
      </p>
    </article>
  );
}

export function ContextSourceControl() {
  const [state, setState] = useState<DocumentState>({ status: "loading" });
  const [busyId, setBusyId] = useState<ContextSourceId | null>(null);
  const [problem, setProblem] = useState<{ id: ContextSourceId; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [restoreFocusId, setRestoreFocusId] = useState<ContextSourceId | null>(null);
  // Keyed by source and target state: the idempotency scope spans both sources,
  // so reusing one key across them is a 409 rather than a replay.
  const keys = useRef<Partial<Record<string, string>>>({});

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
              : "Context-source permissions could not be read.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const transition = useCallback(
    (copy: SourceCopy, source: ContextSourceProjection, next: TransitionState) => {
      if (state.status !== "ready") return;
      const current = state.document;
      void (async () => {
        setBusyId(copy.id);
        setProblem(null);
        const keyId = `${copy.id}:${next}`;
        keys.current[keyId] ??= newIdempotencyKey("web-context-source");
        try {
          // The whole returned document replaces state, not just the mutated
          // source: the other source's `updated_at` is a precondition for its
          // own next write, and dropping it would make that write a conflict.
          const document = await updateContextSource(
            current,
            desiredSource(source, next),
            keys.current[keyId]!,
          );
          keys.current = {};
          setState({ status: "ready", document });
          setRestoreFocusId(copy.id);
        } catch (error) {
          setProblem({
            id: copy.id,
            message:
              error instanceof ApiError
                ? withRequestId(error.message, error.requestId)
                : error instanceof Error
                  ? error.message
                  : "That source change could not be saved.",
          });
        } finally {
          setBusyId(null);
        }
      })();
    },
    [state],
  );

  const requestReload = useCallback(() => {
    setState({ status: "loading" });
    setReload((value) => value + 1);
  }, []);

  return (
    <>
      {SOURCES.map((copy, index) => (
        <SourceRow
          key={copy.id}
          copy={copy}
          state={state}
          canReload={index === 0}
          busy={busyId === copy.id}
          problem={problem?.id === copy.id ? problem.message : ""}
          focusPrimary={restoreFocusId === copy.id}
          onReload={requestReload}
          onTransition={transition}
        />
      ))}
    </>
  );
}
