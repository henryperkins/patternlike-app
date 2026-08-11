import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  deleteAccount,
  getAiSynthesisConsent,
  grantAiSynthesisConsent,
  newIdempotencyKey,
  requestAccountExport,
  revokeAiSynthesisConsent,
  type AiSynthesisConsent,
} from "../lib/api-client.js";
import {
  NOT_IMPLEMENTED_MESSAGE,
  isNotImplemented,
  withRequestId,
} from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";
import { AiConsentTerms } from "./AiConsent.js";
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

type ConsentPanelState =
  | { status: "loading" }
  | { status: "ready"; consent: AiSynthesisConsent }
  | { status: "unreadable"; message: string };

/**
 * The account-level AI-synthesis permission, shown where every other data
 * control lives.
 *
 * The same terms the Today gate shows, so reviewing a decision here and making
 * it there are the same disclosure. There are no per-category switches: the
 * categories belong to the policy version as one indivisible grant, and a
 * control that appeared to switch one off while the server still permitted it
 * would be worse than no control. Source-level switches arrive with the sources
 * themselves.
 */
function AiSynthesisConsentPanel() {
  const [state, setState] = useState<ConsentPanelState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const consent = await getAiSynthesisConsent(controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "ready", consent });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "unreadable",
          message:
            error instanceof Error
              ? error.message
              : "The consent record could not be read in this session.",
        });
      }
    })();
    return () => controller.abort();
  }, [reloads]);

  // One key per intent, minted at the press and held until it succeeds, so a
  // retry after a transient failure resumes the same mutation rather than
  // recording a second one.
  const keys = useRef<{ grant: string | null; revoke: string | null }>({
    grant: null,
    revoke: null,
  });

  const mutate = async (intent: "grant" | "revoke", consent: AiSynthesisConsent) => {
    setBusy(true);
    setProblem(null);
    try {
      if (intent === "grant") {
        keys.current.grant ??= newIdempotencyKey("web-ai-synthesis");
        const next = await grantAiSynthesisConsent(
          consent.policy_version,
          keys.current.grant,
        );
        keys.current.grant = null;
        keys.current.revoke = null;
        setState({ status: "ready", consent: next });
      } else {
        keys.current.revoke ??= newIdempotencyKey("web-ai-synthesis");
        const next = await revokeAiSynthesisConsent(keys.current.revoke);
        keys.current.revoke = null;
        keys.current.grant = null;
        setState({ status: "ready", consent: next });
      }
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? withRequestId(error.message, error.requestId)
          : error instanceof Error
            ? error.message
            : "That could not be saved in this session.",
      );
    } finally {
      setBusy(false);
    }
  };

  const granted = state.status === "ready" && state.consent.status === "granted";
  // Three states, not two. `granted` is false while loading and false when the
  // read failed, and rendering "Not granted" for either would have the privacy
  // surface state definitively that nothing is being sent - in the same words
  // and styling it uses for a real revocation - to a reader whose consent may
  // in fact be granted. Understating permission is the conservative direction,
  // but a definite claim about an unknown state does not belong here.
  const chip =
    state.status === "ready" ? (granted ? "Granted" : "Not granted") : "Unknown";

  return (
    <section className="ai-consent panel" aria-labelledby="ai-consent-heading">
      <div className="panel-heading">
        <div>
          <p className="kicker">Reading generation</p>
          <h2 id="ai-consent-heading">Who writes your reading</h2>
        </div>
        <span className={`source-state${granted ? " source-state--active" : ""}`}>
          <i /> {chip}
        </span>
      </div>

      {state.status === "ready" ? (
        <>
          {granted && state.consent.granted_at ? (
            <p className="ai-consent__since">
              Granted {formatInstant(state.consent.granted_at)}.
            </p>
          ) : null}

          <AiConsentTerms consent={state.consent} />

          <button
            className={`button ${granted ? "button--secondary" : "button--primary"}`}
            type="button"
            onClick={() => void mutate(granted ? "revoke" : "grant", state.consent)}
            disabled={busy}
            aria-busy={busy}
            aria-describedby="ai-consent-status"
          >
            {granted ? "Withdraw permission" : "Grant permission"}{" "}
            <Icon name={granted ? "shield" : "check"} />
          </button>
        </>
      ) : null}

      <p className="privacy-action__status" id="ai-consent-status" role="status" aria-live="polite">
        {state.status === "loading"
          ? "Reading your current permission."
          : state.status === "unreadable"
            ? state.message
            : (problem ?? "")}
      </p>

      {state.status === "unreadable" ? (
        // The read failed, so there is nothing to agree to and no state to
        // report. A retry is the only honest control to offer.
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setReloads((value) => value + 1)}
        >
          Try again <Icon name="refresh" />
        </button>
      ) : null}
    </section>
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

      <AiSynthesisConsentPanel />

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
