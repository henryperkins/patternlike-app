import { useEffect, useState } from "react";

import {
  ApiError,
  getAccountDeletionStatus,
  type AccountDeletionStatus,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";
import { Icon } from "./icons.js";

const POLL_INTERVAL_MS = 1_500;
const COMPLETION_DISPLAY_MS = 1_500;

type DeletionViewState =
  | { status: "loading" }
  | { status: "working"; request: AccountDeletionStatus }
  | { status: "completed"; request: AccountDeletionStatus }
  | { status: "failed"; request: AccountDeletionStatus }
  | { status: "unavailable"; message: string; requestId: string | null };

export function DeletionStatusView({ onComplete }: { onComplete: () => void }) {
  const [state, setState] = useState<DeletionViewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const request = await getAccountDeletionStatus(controller.signal);
        if (controller.signal.aborted) return;
        if (request.status === "completed") {
          setState({ status: "completed", request });
          completionTimer = setTimeout(onComplete, COMPLETION_DISPLAY_MS);
          return;
        }
        if (request.status === "failed") {
          setState({ status: "failed", request });
          return;
        }
        setState({ status: "working", request });
        pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "unavailable",
          message:
            error instanceof Error
              ? error.message
              : "Deletion status is unavailable in this browser.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      if (completionTimer !== undefined) clearTimeout(completionTimer);
    };
  }, [onComplete]);

  const heading =
    state.status === "completed"
      ? "Your account has been deleted."
      : state.status === "failed"
        ? "Deletion needs attention."
        : state.status === "unavailable"
          ? "Deletion status is unavailable."
          : "Closing your account.";

  return (
    <main className="deletion-status-page">
      <div className="deletion-status-page__mark" aria-hidden="true">
        <Icon name="shield" />
      </div>
      <p className="eyebrow">Account deletion</p>
      <h1>{heading}</h1>
      <div className="deletion-status-page__body" role="status" aria-live="polite">
        {state.status === "loading" ? (
          <p>Reading the deletion receipt held by this browser.</p>
        ) : state.status === "working" ? (
          <>
            <p>
              Your account is locked. New sessions, readings, and context writes
              are disabled while encrypted artifacts and account data are removed.
            </p>
            <p className="deletion-status-page__meta">
              {state.request.status === "queued" ? "Queued" : "Deletion in progress"}
              {` · requested ${formatInstant(state.request.requested_at)}`}
            </p>
          </>
        ) : state.status === "completed" ? (
          <p>
            Encrypted account data and export artifacts were removed, and the
            account key was irreversibly erased. Returning to the signed-out view.
          </p>
        ) : state.status === "failed" ? (
          <p>
            The account remains locked. Deletion has not been reported complete;
            contact support with request {state.request.deletion_request_id}.
          </p>
        ) : (
          <p>{withRequestId(state.message, state.requestId)}</p>
        )}
      </div>
    </main>
  );
}
