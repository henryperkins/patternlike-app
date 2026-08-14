import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAiSynthesisConsent,
  grantAiSynthesisConsent,
  newIdempotencyKey,
  revokeAiSynthesisConsent,
  type AiSynthesisConsent,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { formatInstant } from "../lib/reading-format.js";
import { AccountDataControls } from "./AccountDataControls.js";
import { AiConsentTerms } from "./AiConsent.js";
import { ContextSourceControl } from "./ContextSourceControl.js";
import { Icon } from "./icons.js";

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

export function PrivacyView({
  hasChart,
  onSignOut,
  onDeletionAccepted,
  onCorrectBirth,
}: {
  hasChart: boolean;
  onSignOut: () => void;
  onDeletionAccepted: () => void;
  onCorrectBirth?: () => void;
}) {
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
          <strong>{hasChart ? "Chart data present" : "No chart data"}</strong>
          <p>Check-in permission is shown below.</p>
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
          <span className="panel-code">USR-06 CONTROL</span>
        </div>
        <div className="source-list">
          <article className={`source-row${hasChart && onCorrectBirth ? " source-row--live" : ""}`} aria-label="Birth details">
            <span className="source-state source-state--active"><i /> Encrypted</span>
            <div className="source-row__body">
              <h3>Birth details</h3>
              <p>
                {hasChart
                  ? "Used only to calculate your chart. The values are not shown again after calculation."
                  : "Used only to calculate your chart."}
              </p>
            </div>
            {hasChart && onCorrectBirth ? (
              <div className="source-row__actions">
                <button type="button" onClick={onCorrectBirth}>
                  Correct
                </button>
              </div>
            ) : (
              <span className="source-row__fixed">Account data</span>
            )}
          </article>
          <article className="source-row">
            <span className={`source-state${hasChart ? " source-state--active" : ""}`}>
              <i /> {hasChart ? "Active" : "Not calculated"}
            </span>
            <div>
              <h3>Calculated chart facts</h3>
              <p>Deterministic placements and aspects. Context cannot change them.</p>
            </div>
            <span className="source-row__fixed">Derived data</span>
          </article>
          <ContextSourceControl />
          <article className="source-row">
            <span className="source-state"><i /> Off</span>
            <div>
              <h3>Calendar, health, and device data</h3>
              <p>Not connected and not read by PatternLike.</p>
            </div>
            <span className="source-row__fixed">Unavailable</span>
          </article>
        </div>
      </section>

      <AccountDataControls onDeletionAccepted={onDeletionAccepted} />

      <section className="privacy-session panel" aria-labelledby="session-heading">
        <div>
          <p className="kicker">Session</p>
          <h2 id="session-heading">Finished on this device?</h2>
          <p>Sign out to end this browser session and protect your account on a shared device.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onSignOut}>
          Sign out <Icon name="arrow" />
        </button>
      </section>
    </div>
  );
}
