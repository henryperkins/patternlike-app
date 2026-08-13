import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiError,
  deleteAccount,
  getAccountExportStatus,
  newIdempotencyKey,
  requestAccountExport,
  type AccountExportStatus,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";

export const EXPORT_SESSION_KEY = "patternlike.account-export-id";
const DELETE_CONFIRMATION = "DELETE";
const EXPORT_POLL_MS = 1_500;

const actionKeys: { export: string | null; delete: string | null } = {
  export: null,
  delete: null,
};

type ExportState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "workflow"; request: AccountExportStatus }
  | { status: "failed"; message: string; requestId: string | null };

function exportStatusText(state: ExportState): string {
  if (state.status === "idle") return "";
  if (state.status === "submitting") return "Requesting your export.";
  if (state.status === "failed") return withRequestId(state.message, state.requestId);
  switch (state.request.status) {
    case "queued":
      return "Export queued. This page will keep checking.";
    case "running":
      return "Export processing. This page will keep checking.";
    case "ready":
      return state.request.expires_at
        ? `Export ready. It expires ${formatInstant(state.request.expires_at)}.`
        : "Export ready.";
    case "expired":
      return "This export has expired. You can request a new one.";
    case "failed":
      return "The export could not be completed. You can request a new one.";
  }
}

export function AccountDataControls({
  onDeletionAccepted,
}: {
  onDeletionAccepted: () => void;
}) {
  const [exportId, setExportId] = useState(
    () => window.sessionStorage.getItem(EXPORT_SESSION_KEY),
  );
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [exportRefresh, setExportRefresh] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState("");
  const confirmFieldRef = useRef<HTMLInputElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);

  useEffect(() => {
    if (!exportId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const request = await getAccountExportStatus(exportId, controller.signal);
        if (controller.signal.aborted) return;
        setExportState({ status: "workflow", request });
        if (request.status === "queued" || request.status === "running") {
          timer = setTimeout(() => void poll(), EXPORT_POLL_MS);
        } else if (request.status === "expired" || request.status === "failed") {
          window.sessionStorage.removeItem(EXPORT_SESSION_KEY);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setExportState({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Export status could not be checked.",
          requestId: error instanceof ApiError ? error.requestId : null,
        });
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [exportId, exportRefresh]);

  useEffect(() => {
    if (confirmingDelete) {
      confirmFieldRef.current?.focus();
    } else if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmingDelete]);

  const requestExport = async () => {
    const terminal =
      exportState.status === "workflow" &&
      ["ready", "expired", "failed"].includes(exportState.request.status);
    if (terminal) {
      window.sessionStorage.removeItem(EXPORT_SESSION_KEY);
      setExportId(null);
    }
    setExportState({ status: "submitting" });
    actionKeys.export ??= newIdempotencyKey("web-export");
    try {
      const accepted = await requestAccountExport(actionKeys.export);
      actionKeys.export = null;
      window.sessionStorage.setItem(EXPORT_SESSION_KEY, accepted.resource_id);
      setExportId(accepted.resource_id);
    } catch (error) {
      setExportState({
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "The export request could not be completed.",
        requestId: error instanceof ApiError ? error.requestId : null,
      });
    }
  };

  const confirmDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmText !== DELETE_CONFIRMATION || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteProblem("");
    actionKeys.delete ??= newIdempotencyKey("web-delete");
    try {
      await deleteAccount(actionKeys.delete);
      actionKeys.delete = null;
      onDeletionAccepted();
    } catch (error) {
      setDeleteProblem(
        error instanceof ApiError
          ? withRequestId(error.message, error.requestId)
          : error instanceof Error
            ? error.message
            : "The deletion request could not be completed.",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const cancelDelete = () => {
    restoreTriggerFocus.current = true;
    setConfirmingDelete(false);
    setConfirmText("");
    setDeleteProblem("");
  };

  const exportTerminal =
    exportState.status === "workflow" &&
    ["ready", "expired", "failed"].includes(exportState.request.status);
  const exportBusy =
    exportState.status === "submitting" ||
    (exportState.status === "workflow" &&
      ["queued", "running"].includes(exportState.request.status));

  return (
    <section className="privacy-actions" aria-labelledby="account-data-heading">
      <div>
        <p className="eyebrow">Account data</p>
        <h2 id="account-data-heading">Portable in. Portable out.</h2>
        <p>
          Exports are encrypted while they are prepared, available for seven
          days, and downloaded directly through this origin. Deletion locks the
          account as soon as the request is accepted and is irreversible when
          key erasure completes.
        </p>
      </div>
      <div className="privacy-actions__buttons">
        <div className="privacy-action">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void requestExport()}
            disabled={exportBusy}
            aria-describedby="export-status"
          >
            {exportTerminal ? "Request another export" : "Request export"}
          </button>
          {exportState.status === "workflow" &&
          exportState.request.status === "ready" ? (
            <a
              className="privacy-action__download"
              href={`/v1/exports/${encodeURIComponent(exportState.request.export_request_id)}/download`}
            >
              Download export
            </a>
          ) : null}
          {exportState.status === "failed" && exportId ? (
            <button
              className="privacy-action__retry"
              type="button"
              onClick={() => setExportRefresh((value) => value + 1)}
            >
              Check export status
            </button>
          ) : null}
          <p
            className="privacy-action__status"
            id="export-status"
            role="status"
            aria-label="Export status"
            aria-live="polite"
          >
            {exportStatusText(exportState)}
          </p>
        </div>

        <div className="privacy-action">
          {confirmingDelete ? (
            <form className="privacy-action__confirm" onSubmit={(event) => void confirmDelete(event)}>
              <label htmlFor="delete-confirm">
                Type {DELETE_CONFIRMATION} to confirm. Acceptance locks the
                account immediately; completion cannot be undone.
              </label>
              <input
                id="delete-confirm"
                name="delete-confirm"
                type="text"
                autoComplete="off"
                ref={confirmFieldRef}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
              <div className="privacy-action__confirm-actions">
                <button
                  className="button button--danger"
                  type="submit"
                  disabled={confirmText !== DELETE_CONFIRMATION || deleteBusy}
                >
                  Confirm deletion
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={cancelDelete}
                  disabled={deleteBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="button button--danger"
              type="button"
              ref={deleteTriggerRef}
              onClick={() => setConfirmingDelete(true)}
              aria-expanded={confirmingDelete}
              aria-describedby="delete-status"
            >
              Delete account
            </button>
          )}
          <p
            className="privacy-action__status"
            id="delete-status"
            role="status"
            aria-label="Deletion status"
            aria-live="polite"
          >
            {deleteBusy ? "Locking the account and starting deletion." : deleteProblem}
          </p>
        </div>
      </div>
    </section>
  );
}
