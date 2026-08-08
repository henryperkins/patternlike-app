import { useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, deleteAccount, requestAccountExport } from "../lib/api-client.js";
import { Icon } from "./icons.js";

type PrivacyActionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "accepted" }
  | { status: "not_implemented"; requestId: string | null }
  | { status: "failed"; requestId: string | null };

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
  if (error instanceof ApiError && error.status === 501 && error.code === "not_implemented") {
    return { status: "not_implemented", requestId: error.requestId };
  }
  if (error instanceof Error) {
    return { status: "failed", requestId: error instanceof ApiError ? error.requestId : null };
  }
  return { status: "failed", requestId: null };
}

function actionLabel(state: PrivacyActionState): string | null {
  switch (state.status) {
    case "submitting":
      return "Submitting...";
    case "accepted":
      return "Request accepted";
    case "not_implemented":
      return `Available in a later milestone${state.requestId ? ` (Request ${state.requestId})` : ""}`;
    case "failed":
      return `Failed${state.requestId ? ` (Request ${state.requestId})` : ""}`;
    default:
      return null;
  }
}

function PrivacyActionStatus({ state }: { state: PrivacyActionState }) {
  const label = actionLabel(state);
  return label ? <p role="status" aria-live="polite">{label}</p> : null;
}

export function PrivacyView({ hasChart }: { hasChart: boolean }) {
  const [exportState, setExportState] = useState<PrivacyActionState>({ status: "idle" });
  const [deleteState, setDeleteState] = useState<PrivacyActionState>({ status: "idle" });
  const actionDisabled = !hasChart;
  const deferSubmit = () =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

  const requestExport = () => {
    flushSync(() => {
      setExportState({ status: "submitting" });
    });
    void deferSubmit().then(() => {
      requestAccountExport().then(
        () => {
          setExportState({ status: "accepted" });
        },
        (error) => {
          setExportState(parseActionError(error));
        },
      );
    });
  };

  const requestDelete = () => {
    flushSync(() => {
      setDeleteState({ status: "submitting" });
    });
    void deferSubmit().then(() => {
      deleteAccount().then(
        () => {
          setDeleteState({ status: "accepted" });
        },
        (error) => {
          setDeleteState(parseActionError(error));
        },
      );
    });
  };

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
            Export and deletion workflows are available as API actions. You can trigger them
            directly from here once a backend route is active.
          </p>
        </div>
        <div className="privacy-actions__buttons">
          <div>
            <button
              className="button button--secondary"
              type="button"
              onClick={requestExport}
              disabled={actionDisabled || exportState.status === "submitting"}
              aria-label="Request data export"
            >
              Request export <span>M1</span>
            </button>
            <PrivacyActionStatus state={exportState} />
          </div>
          <div>
            <button
              className="button button--danger"
              type="button"
              onClick={requestDelete}
              disabled={actionDisabled || deleteState.status === "submitting"}
              aria-label="Delete account"
            >
              Delete account <span>M1</span>
            </button>
            <PrivacyActionStatus state={deleteState} />
          </div>
        </div>
      </section>
    </div>
  );
}
