import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAiSynthesisConsent,
  grantAiSynthesisConsent,
  newIdempotencyKey,
  type AiSynthesisConsent,
} from "../lib/api-client.js";
import { AiConsentTerms } from "./AiConsent.js";
import { Icon } from "./icons.js";

interface AiConsentGateProps {
  requestId: string | null;
  /** Re-run the Today fetch. Granting alone generates nothing by itself. */
  onGranted: () => void;
  onUnauthorized: () => void;
}

type GateState =
  | { status: "loading" }
  | { status: "ready"; consent: AiSynthesisConsent }
  | { status: "unreadable"; message: string };

/**
 * The decision that stands between an eligible account and its first generated
 * reading.
 *
 * The policy is fetched rather than assumed. The reader has to be shown the
 * exact version and category list they are agreeing to, and the grant echoes
 * that version back — so a page left open across a policy change is refused with
 * `consent_policy_version_stale` instead of quietly consenting on the reader's
 * behalf to terms that changed while they were reading the old ones.
 */
export function AiConsentGate({
  requestId,
  onGranted,
  onUnauthorized,
}: AiConsentGateProps) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [granting, setGranting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * One key per policy version, not per mount. Granting is a single intent, so a
   * retry after a transient failure has to resume it rather than record a second
   * grant; a genuinely different policy version is a different intent and earns
   * its own key rather than a `409 idempotency_conflict`.
   */
  const submitted = useRef<{ version: string; key: string } | null>(null);
  const keyFor = (version: string): string => {
    if (submitted.current?.version !== version) {
      submitted.current = { version, key: newIdempotencyKey("web-ai-synthesis") };
    }
    return submitted.current.key;
  };

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const consent = await getAiSynthesisConsent(controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "ready", consent });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setState({
          status: "unreadable",
          // Without the terms there is nothing to agree to, so this state offers
          // no grant control at all rather than a button over unknown terms.
          message:
            error instanceof Error
              ? error.message
              : "The consent terms could not be read in this session.",
        });
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized]);

  const grant = async (consent: AiSynthesisConsent) => {
    setGranting(true);
    setProblem(null);
    try {
      const next = await grantAiSynthesisConsent(
        consent.policy_version,
        keyFor(consent.policy_version),
      );
      setState({ status: "ready", consent: next });
      onGranted();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      setProblem(
        error instanceof Error
          ? error.message
          : "That could not be saved in this session.",
      );
    } finally {
      setGranting(false);
    }
  };

  return (
    <section className="today-gate page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">Today / Permission</p>
          <h1>Your reading needs your say-so.</h1>
        </div>
      </header>

      <div className="today-gate__form panel">
        <p className="today-gate__body">
          Your chart and your day are calculated here. The words are written by a
          model at {state.status === "ready" ? state.consent.provider : "the configured provider"},
          from those calculated facts and whatever context you have enabled.
          Nothing is sent until you agree to it.
        </p>

        {state.status === "ready" ? (
          <AiConsentTerms consent={state.consent} privacyLink />
        ) : null}

        {state.status === "ready" ? (
          <button
            className="button button--primary"
            type="button"
            onClick={() => void grant(state.consent)}
            disabled={granting}
            aria-busy={granting}
          >
            Agree and generate my reading <Icon name="check" />
          </button>
        ) : null}

        <p className="today-gate__status" role="status" aria-live="polite">
          {state.status === "loading"
            ? "Reading the current consent terms."
            : state.status === "unreadable"
              ? state.message
              : (problem ?? "")}
        </p>

        {requestId ? (
          <small className="today-gate__request">Request {requestId}</small>
        ) : null}
      </div>
    </section>
  );
}
