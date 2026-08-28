import { useAuth0 } from "@auth0/auth0-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BirthProfileRequest } from "@patternlike/shared";
import { AccountAccessRecovery } from "./components/AccountAccessRecovery.js";
import { AccountDataControls } from "./components/AccountDataControls.js";
import { AppShell, type ViewId } from "./components/AppShell.js";
import { ChartView } from "./components/ChartView.js";
import { DeletionStatusView } from "./components/DeletionStatusView.js";
import { Icon } from "./components/icons.js";
import { Onboarding } from "./components/Onboarding.js";
import { PrivacyView } from "./components/PrivacyView.js";
import { TimeTravelView } from "./components/TimeTravelView.js";
import { TimingView } from "./components/TimingView.js";
import { TodayView } from "./components/TodayView.js";
import { SignedOut } from "./components/SignedOut.js";
import {
  ApiError,
  createBirthProfile,
  endSession,
  getAccountProcessingConsent,
  getChart,
  type BirthWorkflowResponse,
  type AccountProcessingConsentDocument,
  type ChartResponse,
} from "./lib/api-client.js";
import {
  clearAuth0CallbackParams,
  completeSignIn,
  signOut,
} from "./lib/auth.js";
import { isAccountProcessingConsentResponse } from "./lib/account-processing-consent.js";
import {
  DevicePreferenceSynchronizer,
  type DevicePreferenceSyncResult,
} from "./lib/device-preference-sync.js";

type ChartState =
  | { status: "loading" }
  | { status: "ready"; chart: ChartResponse }
  | { status: "missing" }
  | { status: "access-recovery"; consent: AccountProcessingConsentDocument }
  | { status: "access-unavailable"; message: string; requestId?: string | null }
  | { status: "offline"; message: string; requestId?: string | null };

/**
 * Whether the caller holds a Worker session.
 *
 * Answered by calling the API and watching for a 401, never by asking Auth0.
 * The httpOnly `pl_session` cookie is the only thing that actually grants
 * access, so it is the only honest thing to test — and it keeps a cold load
 * from depending on the issuer being reachable.
 */
type AuthState =
  | { status: "checking" }
  | { status: "signed-in" }
  | { status: "signed-out"; error?: string | null };

const viewIds = new Set<ViewId>(["today", "pattern", "timing", "travel", "privacy"]);
type AppRoute = ViewId | "deletion-status";

function currentView(): AppRoute {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "deletion-status") return hash;
  return viewIds.has(hash as ViewId) ? hash as ViewId : "pattern";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

interface AppProps {
  isAuth0Redirect?: boolean;
}

export default function App({ isAuth0Redirect = false }: AppProps) {
  const {
    error: auth0Error,
    getIdTokenClaims,
    isLoading: isAuth0Loading,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();
  const callbackSession = useRef<Promise<void> | null>(null);
  const preferenceSynchronizer = useRef<DevicePreferenceSynchronizer | null>(
    null,
  );
  preferenceSynchronizer.current ??= new DevicePreferenceSynchronizer();
  const [view, setView] = useState<AppRoute>(currentView);
  const [chartState, setChartState] = useState<ChartState>({ status: "loading" });
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });
  const [hasValidatedSession, setHasValidatedSession] = useState(false);
  const [preferenceSyncRevision, setPreferenceSyncRevision] = useState(0);
  const [correctingBirth, setCorrectingBirth] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const chart = await getChart(signal);
      setHasValidatedSession(true);
      setAuthState({ status: "signed-in" });
      setChartState({ status: "ready", chart });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        // No session, or one that has expired or been revoked. The API answers
        // all three identically on purpose, so the client cannot distinguish
        // them either.
        setHasValidatedSession(false);
        setAuthState({ status: "signed-out" });
        return;
      }
      setAuthState({ status: "signed-in" });
      if (error instanceof ApiError && error.status === 404) {
        setHasValidatedSession(true);
        setChartState({ status: "missing" });
        return;
      }
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        (error.code === "account_not_active" ||
          error.code === "account_processing_required")
      ) {
        setHasValidatedSession(false);
        try {
          const consent = await getAccountProcessingConsent(signal);
          if (signal?.aborted) return;
          if (!isAccountProcessingConsentResponse(consent)) {
            setChartState({
              status: "access-unavailable",
              message:
                "The current calculation permission could not be read safely.",
              requestId: error.requestId,
            });
          } else if (
            consent.account_status === "frozen" ||
            (consent.account_status === "active" && consent.status === "not_granted")
          ) {
            setChartState({ status: "access-recovery", consent });
          } else {
            setChartState({
              status: "access-unavailable",
              message:
                "The account state could not be reconciled with the current calculation permission.",
              requestId: error.requestId,
            });
          }
        } catch (consentError) {
          if (signal?.aborted) return;
          setChartState({
            status: "access-unavailable",
            message:
              "The account is unavailable. Export, deletion, and sign out may still be available.",
            requestId:
              consentError instanceof ApiError
                ? consentError.requestId
                : error.requestId,
          });
        }
        return;
      }
      setHasValidatedSession(false);
      setChartState({
        status: "offline",
        message: error instanceof Error ? error.message : "The chart could not be loaded.",
        requestId: error instanceof ApiError ? error.requestId : null,
      });
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(currentView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // Leaving Privacy abandons an in-progress correction rather than trapping
    // the reader in the form while the rest of the app looks reachable.
    if (view !== "privacy") setCorrectingBirth(false);
  }, [view]);

  useEffect(() => {
    if (isAuth0Redirect || currentView() === "deletion-status") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [isAuth0Redirect, load]);

  useEffect(() => {
    if (
      !isAuth0Redirect ||
      isAuth0Loading ||
      currentView() === "deletion-status"
    ) {
      return;
    }

    const controller = new AbortController();
    const start = async () => {
      if (auth0Error) {
        clearAuth0CallbackParams();
        setAuthState({
          status: "signed-out",
          error: auth0Error.message || "Sign-in failed.",
        });
        return;
      }

      callbackSession.current ??= completeSignIn(getIdTokenClaims);
      try {
        await callbackSession.current;
      } catch (error) {
        if (!controller.signal.aborted) {
          setAuthState({
            status: "signed-out",
            error: error instanceof Error ? error.message : "Sign-in failed.",
          });
        }
        return;
      }

      if (!controller.signal.aborted) await load(controller.signal);
    };

    void start();
    return () => controller.abort();
  }, [
    auth0Error,
    getIdTokenClaims,
    isAuth0Loading,
    isAuth0Redirect,
    load,
  ]);

  useEffect(() => {
    if (authState.status !== "signed-in" || !hasValidatedSession) return;

    const controller = new AbortController();
    let observed: Promise<DevicePreferenceSyncResult> | null = null;
    const sync = () => {
      const operation = preferenceSynchronizer.current!.sync(controller.signal);
      if (operation === observed) return;
      observed = operation;
      void operation
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.status === "unauthorized") {
            setAuthState({ status: "signed-out" });
          } else if (result.status === "settled") {
            setPreferenceSyncRevision((revision) => revision + 1);
          }
        })
        .finally(() => {
          if (observed === operation) observed = null;
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };

    sync();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authState.status, hasValidatedSession]);

  /**
   * A 401 from a view, rather than from the mount probe.
   *
   * Sessions expire mid-visit, and the view that discovers it has no business
   * rendering the failure itself — "Unreachable with a retry" is wrong about a
   * state the app already has a screen for. Stable identity because TodayView
   * holds it as an effect dependency.
   */
  const handleSignedOut = useCallback(() => setAuthState({ status: "signed-out" }), []);

  const showDeletionStatus = useCallback(() => {
    window.location.hash = "deletion-status";
    setView("deletion-status");
  }, []);

  const finishDeletionStatus = useCallback(() => {
    window.location.hash = "";
    setView("pattern");
    setAuthState({ status: "signed-out" });
  }, []);

  const endSessionAndSignOut = async () => {
    await signOut(async () => {
      try {
        await endSession();
      } catch {
        // A failed revoke must not strand the user in a session they asked to
        // leave. Auth0's logout still runs (signOut calls it from `finally`),
        // and the cookie is cleared server-side on the next resolve attempt.
      }
    }, auth0Logout);
  };

  const submitBirthProfile = async (
    profile: BirthProfileRequest,
    intent: "create" | "correct",
    idempotencyKey: string,
  ) => {
    let accepted: BirthWorkflowResponse | null = null;
    try {
      accepted = await createBirthProfile(profile, idempotencyKey);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "chart_already_exists")) {
        throw error;
      }
      // Identical fingerprint under a new key. First-time onboarding can land
      // here from a retry; correction must not pretend the active chart moved.
      if (intent === "correct") {
        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const chart = await getChart();
        // POST commits the replacement before it returns, but GET can still
        // answer the superseded snapshot (in-flight job, or a cached 200).
        // Accepting that 200 would leave Pattern on the chart the reader
        // just asked to replace.
        if (
          accepted &&
          (accepted.status === "running" ||
            (accepted.resource_id !== null && chart.id !== accepted.resource_id))
        ) {
          await wait(700);
          continue;
        }
        setCorrectingBirth(false);
        setChartState({ status: "ready", chart });
        window.location.hash = "pattern";
        return;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        await wait(700);
      }
    }
    throw new Error("The calculation was accepted but is not ready yet. Try again in a moment.");
  };

  const createChart = async (profile: BirthProfileRequest, idempotencyKey: string) => {
    await submitBirthProfile(profile, "create", idempotencyKey);
  };

  const correctChart = async (profile: BirthProfileRequest, idempotencyKey: string) => {
    await submitBirthProfile(profile, "correct", idempotencyKey);
  };

  if (view === "deletion-status") {
    return <DeletionStatusView onComplete={finishDeletionStatus} />;
  }

  // Rendered outside AppShell on purpose: every link in that navigation leads
  // to a view that requires a session, so showing the chrome to a signed-out
  // caller would offer five routes that all bounce straight back here.
  if (authState.status === "signed-out") {
    return (
      <SignedOut
        onSignIn={() => loginWithRedirect()}
        error={authState.error}
      />
    );
  }

  if (chartState.status === "access-recovery") {
    return (
      <AccountAccessRecovery
        consent={chartState.consent}
        onRestored={() => {
          setChartState({ status: "loading" });
          void load();
        }}
        onSignOut={() => void endSessionAndSignOut()}
        onDeletionAccepted={showDeletionStatus}
      />
    );
  }

  if (chartState.status === "access-unavailable") {
    return (
      <main className="privacy-page page-enter" id="main-content">
        <header className="page-header privacy-page__header">
          <div>
            <p className="eyebrow">Account access</p>
            <h1>Account access is unavailable.</h1>
          </div>
          <p className="page-header__lede">{chartState.message}</p>
        </header>
        {chartState.requestId ? <code>Request {chartState.requestId}</code> : null}
        <AccountDataControls onDeletionAccepted={showDeletionStatus} />
        <section className="privacy-session panel" aria-labelledby="unavailable-session-heading">
          <div>
            <p className="kicker">Session</p>
            <h2 id="unavailable-session-heading">Leave this account?</h2>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void endSessionAndSignOut()}
          >
            Sign out <Icon name="arrow" />
          </button>
        </section>
      </main>
    );
  }

  const shellStatus = chartState.status;
  const chart = chartState.status === "ready" ? chartState.chart : null;

  let content;
  if (chartState.status === "loading") {
    content = (
      <section className="loading-page" aria-live="polite">
        <div className="loading-orbit"><span /></div>
        <p className="eyebrow">Reading the calculation record</p>
        <h1>Checking your chart.</h1>
      </section>
    );
  } else if (chartState.status === "offline") {
    content = (
      <section className="error-page page-enter">
        <p className="eyebrow">Connection</p>
        <h1>The calculation record is out of reach.</h1>
        <p>{chartState.message}</p>
        {chartState.requestId ? <code>Request {chartState.requestId}</code> : null}
        <button className="button button--primary" type="button" onClick={() => {
          setChartState({ status: "loading" });
          void load();
        }}>
          Try again <Icon name="refresh" />
        </button>
        {import.meta.env.DEV ? (
          <small>Start the API on port 8787; Vite proxies authenticated local requests.</small>
        ) : null}
      </section>
    );
  } else if (correctingBirth && chart && view === "privacy") {
    content = (
      <Onboarding
        mode="correct"
        onSubmit={correctChart}
        onCancel={() => setCorrectingBirth(false)}
      />
    );
  } else if (view === "privacy") {
    content = (
      <PrivacyView
        hasChart={chart !== null}
        onSignOut={() => void endSessionAndSignOut()}
        onDeletionAccepted={showDeletionStatus}
        onCorrectBirth={chart ? () => setCorrectingBirth(true) : undefined}
        onProcessingFrozen={(consent) => {
          setHasValidatedSession(false);
          setChartState({ status: "access-recovery", consent });
        }}
      />
    );
  } else if (view === "today") {
    content = (
      <TodayView
        onUnauthorized={handleSignedOut}
        preferenceSyncRevision={preferenceSyncRevision}
      />
    );
  } else if (view === "timing") {
    content = <TimingView onUnauthorized={handleSignedOut} />;
  } else if (view === "travel") {
    content = <TimeTravelView onUnauthorized={handleSignedOut} />;
  } else if (chart) {
    content = <ChartView chart={chart} onUnauthorized={handleSignedOut} />;
  } else {
    content = <Onboarding onSubmit={createChart} />;
  }

  return (
    <AppShell
      activeView={view}
      chartStatus={shellStatus}
    >
      {content}
    </AppShell>
  );
}
