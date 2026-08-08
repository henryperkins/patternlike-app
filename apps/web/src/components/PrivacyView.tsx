import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  deleteAccount,
  newIdempotencyKey,
  requestAccountExport,
} from "../lib/api-client.js";
import {
  NOT_IMPLEMENTED_MESSAGE,
  isNotImplemented,
  withRequestId,
} from "../lib/api-status.js";
import { Icon } from "./icons.js";

type PrivacyActionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "accepted" }
  | { status: "not_implemented"; requestId: string | null }
  | { status: "failed"; message: string; requestId: string | null };

/** The literal the contract requires in the deletion body, typed by the user. */
const DELETE_CONFIRMATION = "DELETE";

/**
 * Module scope, not a ref: App unmounts PrivacyView on every hash navigation, so
 * instance-held keys would be reminted on return and a retried deletion would
 * queue a second workflow instead of resuming the first. One user intent, one
 * key, for the life of the page.
 */
const actionKeys: { export: string | null; delete: string | null } = {
  export: null,
  delete: null,
};

const sources = [
  {
    name: "Birth details",
    scope: "Chart calculation only",
    state: "Encrypted",
    active: true,
  },
  {
    name: "Calculated chart facts",
    scope: "Pattern and timing eligibility",
    state: "Active",
    active: true,
  },
  {
    name: "Check-ins and priorities",
    scope: "May rank valid themes",
    state: "Not connected",
    active: false,
  },
  {
    name: "Calendar, health, and device data",
    scope: "No access granted",
    state: "Off",
    active: false,
  },
];

function parseActionError(error: unknown): PrivacyActionState {
  if (isNotImplemented(error)) {
    return { status: "not_implemented", requestId: error.requestId };
  }
  if (error instanceof ApiError) {
    return { status: "failed", message: error.message, requestId: error.requestId };
  }
  return {
    status: "failed",
    // Losing this message left every network failure reading "Failed" with
    // nothing a user or a support thread could act on.
    message:
      error instanceof Error ? error.message : "The request could not be completed.",
    requestId: null,
  };
}

function actionLabel(state: PrivacyActionState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "submitting":
      return "Submitting...";
    case "accepted":
      return "Request accepted";
    case "not_implemented":
      return withRequestId(NOT_IMPLEMENTED_MESSAGE, state.requestId);
    case "failed":
      return withRequestId(state.message, state.requestId);
  }
}

/**
 * Mounted unconditionally rather than only once there is something to say — a
 * live region inserted alongside its first message is unreliably announced.
 */
function PrivacyActionStatus({ id, state }: { id: string; state: PrivacyActionState }) {
  return (
    <p className="privacy-action__status" id={id} role="status" aria-live="polite">
      {actionLabel(state)}
    </p>
  );
}

export function PrivacyView({ hasChart }: { hasChart: boolean }) {
  const [exportState, setExportState] = useState<PrivacyActionState>({ status: "idle" });
  const [deleteState, setDeleteState] = useState<PrivacyActionState>({ status: "idle" });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const confirmFieldRef = useRef<HTMLInputElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);

  // Opening and closing the disclosure unmounts whichever control had focus, so
  // focus is placed deliberately on both edges rather than falling to <body>.
  useEffect(() => {
    if (confirmingDelete) {
      confirmFieldRef.current?.focus();
    } else if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmingDelete]);

  // React no-ops a setState on an unmounted component, so no guard is needed
  // here — navigating away simply drops the status the view would have shown.
  const runAction = async (
    key: string,
    action: (idempotencyKey: string) => Promise<unknown>,
    setState: (next: PrivacyActionState) => void,
  ) => {
    setState({ status: "submitting" });
    try {
      await action(key);
      setState({ status: "accepted" });
    } catch (error) {
      setState(parseActionError(error));
    }
  };

  const requestExport = () => {
    actionKeys.export ??= newIdempotencyKey("web-export");
    void runAction(actionKeys.export, requestAccountExport, setExportState);
  };

  const confirmDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmText !== DELETE_CONFIRMATION) return;
    actionKeys.delete ??= newIdempotencyKey("web-delete");
    void runAction(actionKeys.delete, (key) => deleteAccount(key), setDeleteState);
  };

  const cancelDelete = () => {
    restoreTriggerFocus.current = true;
    setConfirmingDelete(false);
    setConfirmText("");
  };

  const exportBusy = exportState.status === "submitting";
  const deleteBusy = deleteState.status === "submitting";

  return (
    <div className="privacy-page page-enter">
      <header className="page-header privacy-page__header">
        <div>
          <p className="eyebrow">Context &amp; privacy</p>
          <h1>Your data has<br />clear edges.</h1>
        </div>
        <p className="page-header__lede">
          See what is active, what each source is allowed to do, and what remains
          outside the product. Context may frame a reading. It never changes chart facts.
        </p>
      </header>

      <section className="privacy-overview">
        <article className="privacy-score">
          <Icon name="shield" />
          <span>Data posture</span>
          <strong>{hasChart ? "2 active sources" : "No chart data"}</strong>
          <p>No external context sources connected.</p>
        </article>
        <article className="privacy-principle panel">
          <p className="kicker">The governing rule</p>
          <blockquote>
            Context can rank or frame a valid interpretation. It cannot alter the chart
            or be presented as something astrology discovered.
          </blockquote>
        </article>
      </section>

      <section className="source-ledger panel" aria-labelledby="source-heading">
        <div className="panel-heading">
          <div>
            <p className="kicker">Permission ledger</p>
            <h2 id="source-heading">Active and available sources</h2>
          </div>
          <span className="panel-code">M1 CONTROL SURFACE</span>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <article className="source-row" key={source.name}>
              <span className={`source-state${source.active ? " source-state--active" : ""}`}>
                <i /> {source.state}
              </span>
              <div>
                <h3>{source.name}</h3>
                <p>{source.scope}</p>
              </div>
              <button type="button" disabled title="Source controls arrive in M4">
                {source.active ? "Review" : "Unavailable"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-actions" aria-labelledby="account-data-heading">
        <div>
          <p className="eyebrow">Account data</p>
          <h2 id="account-data-heading">Portable in. Portable out.</h2>
          <p>
            Both controls call their real API route. Those routes answer with a
            not-implemented response until M1 ships, and whatever the API says is
            printed back to you here — nothing is quietly swallowed. Deletion asks
            you to type the confirmation the contract requires.
          </p>
        </div>
        <div className="privacy-actions__buttons">
          <div className="privacy-action">
            <button
              className="button button--secondary"
              type="button"
              onClick={requestExport}
              disabled={exportBusy || exportState.status === "accepted"}
              aria-describedby="export-status"
            >
              Request export <span>M1</span>
            </button>
            <PrivacyActionStatus id="export-status" state={exportState} />
          </div>
          <div className="privacy-action">
            {confirmingDelete ? (
              <form className="privacy-action__confirm" onSubmit={confirmDelete}>
                <label htmlFor="delete-confirm">
                  Type {DELETE_CONFIRMATION} to confirm. This cannot be undone.
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
                    disabled={
                      confirmText !== DELETE_CONFIRMATION ||
                      deleteBusy ||
                      deleteState.status === "accepted"
                    }
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
                disabled={deleteState.status === "accepted"}
                aria-expanded={confirmingDelete}
                aria-describedby="delete-status"
              >
                Delete account <span>M1</span>
              </button>
            )}
            <PrivacyActionStatus id="delete-status" state={deleteState} />
          </div>
        </div>
      </section>
    </div>
  );
}
