import { useRef, useState } from "react";
import {
  ApiError,
  getAccountProcessingConsent,
  grantAccountProcessingConsent,
  newIdempotencyKey,
  type AccountProcessingConsentDocument,
} from "../lib/api-client.js";
import { withRequestId } from "../lib/api-status.js";
import { isAccountProcessingConsentResponse } from "../lib/account-processing-consent.js";
import { AccountDataControls } from "./AccountDataControls.js";
import { Icon } from "./icons.js";

export function AccountAccessRecovery({
  consent,
  onRestored,
  onSignOut,
  onDeletionAccepted,
}: {
  consent: AccountProcessingConsentDocument;
  onRestored: () => void;
  onSignOut: () => void;
  onDeletionAccepted: () => void;
}) {
  const [current, setCurrent] = useState(consent);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const grantKey = useRef<string | null>(null);

  const recoverableFreeze =
    current.account_status === "frozen" && current.regrant_will_restore_access;
  const unexplainedFreeze =
    current.account_status === "frozen" && !current.regrant_will_restore_access;
  const canGrant = recoverableFreeze || current.account_status === "active";

  const restore = async () => {
    if (!canGrant || busy) return;
    setBusy(true);
    setProblem(null);
    grantKey.current ??= newIdempotencyKey("web-account-processing");
    try {
      const next = await grantAccountProcessingConsent(
        current.policy_version,
        grantKey.current,
        "privacy_center",
      );
      if (!isAccountProcessingConsentResponse(next)) {
        throw new Error("The updated calculation permission could not be read.");
      }
      setCurrent(next);
      if (
        next.status !== "granted" ||
        !next.consent_id ||
        next.account_status !== "active"
      ) {
        setProblem(
          "The account is not active yet. Export, deletion, and sign out remain available.",
        );
        return;
      }
      grantKey.current = null;
      onRestored();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "consent_policy_version_stale"
      ) {
        grantKey.current = null;
        try {
          const refreshed = await getAccountProcessingConsent();
          if (isAccountProcessingConsentResponse(refreshed)) {
            setCurrent(refreshed);
            setProblem(
              "The calculation permission changed. Review the current policy before trying again.",
            );
          } else {
            setProblem("The current calculation permission could not be read.");
          }
        } catch (refreshError) {
          setProblem(
            refreshError instanceof Error
              ? refreshError.message
              : "The current calculation permission could not be read.",
          );
        }
      } else {
        setProblem(
          error instanceof ApiError
            ? withRequestId(error.message, error.requestId)
            : error instanceof Error
              ? error.message
              : "Access could not be restored in this session.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="privacy-page page-enter" id="main-content">
      <header className="page-header privacy-page__header">
        <div>
          <p className="eyebrow">Account access</p>
          <h1>
            {recoverableFreeze
              ? "Your account is frozen."
              : unexplainedFreeze
                ? "Account access is paused."
                : "Review calculation permission."}
          </h1>
        </div>
        <p className="page-header__lede">
          {recoverableFreeze
            ? "Regrant will restore access to the retained data in this account."
            : unexplainedFreeze
              ? "This account is frozen, but the consent record cannot confirm that regranting will clear the hold."
              : "Ordinary product access needs the current birth-calculation policy. Review it before continuing."}
        </p>
      </header>

      <section className="ai-consent panel" aria-labelledby="recovery-policy-heading">
        <div className="panel-heading">
          <div>
            <p className="kicker">Current policy</p>
            <h2 id="recovery-policy-heading">Birth calculation permission</h2>
          </div>
          <span className="panel-code">{current.policy_version}</span>
        </div>
        <p>{current.disclosure.text}</p>
        <p>
          <a href={current.disclosure.links.patternlike_terms}>Terms</a>{" "}
          <a href={current.disclosure.links.patternlike_privacy}>Privacy policy</a>
        </p>

        {canGrant ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            aria-busy={busy}
            aria-describedby="account-recovery-status"
            onClick={() => void restore()}
          >
            {recoverableFreeze ? "Restore access" : "Grant permission and continue"}{" "}
            <Icon name="arrow" />
          </button>
        ) : null}

        <p
          className="privacy-action__status"
          id="account-recovery-status"
          role="status"
          aria-label="Account recovery status"
          aria-live="polite"
        >
          {busy ? "Saving the current calculation permission." : (problem ?? "")}
        </p>
      </section>

      <AccountDataControls onDeletionAccepted={onDeletionAccepted} />

      <section className="privacy-session panel" aria-labelledby="recovery-session-heading">
        <div>
          <p className="kicker">Session</p>
          <h2 id="recovery-session-heading">Leave this account?</h2>
          <p>Sign out remains available while ordinary product routes are paused.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onSignOut}>
          Sign out <Icon name="arrow" />
        </button>
      </section>
    </main>
  );
}
