import { useCallback, useEffect, useState } from "react";
import type { BirthProfileRequest } from "@patternlike/shared";
import { AppShell, type ViewId } from "./components/AppShell.js";
import { ChartView } from "./components/ChartView.js";
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
  getChart,
  type ChartResponse,
} from "./lib/api-client.js";
import { beginSignIn, completeSignIn, isRedirectCallback, signOut } from "./lib/auth.js";

type ChartState =
  | { status: "loading" }
  | { status: "ready"; chart: ChartResponse }
  | { status: "missing" }
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

function currentView(): ViewId {
  const hash = window.location.hash.replace(/^#/, "") as ViewId;
  return viewIds.has(hash) ? hash : "pattern";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function App() {
  const [view, setView] = useState<ViewId>(currentView);
  const [chartState, setChartState] = useState<ChartState>({ status: "loading" });
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });

  const load = async (signal?: AbortSignal) => {
    try {
      const chart = await getChart(signal);
      setAuthState({ status: "signed-in" });
      setChartState({ status: "ready", chart });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        // No session, or one that has expired or been revoked. The API answers
        // all three identically on purpose, so the client cannot distinguish
        // them either.
        setAuthState({ status: "signed-out" });
        return;
      }
      setAuthState({ status: "signed-in" });
      if (error instanceof ApiError && error.status === 404) {
        setChartState({ status: "missing" });
        return;
      }
      setChartState({
        status: "offline",
        message: error instanceof Error ? error.message : "The chart could not be loaded.",
        requestId: error instanceof ApiError ? error.requestId : null,
      });
    }
  };

  useEffect(() => {
    const onHashChange = () => setView(currentView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const start = async () => {
      // Finish an Auth0 redirect before asking the API anything: the session
      // cookie is set by that exchange, so probing /v1/chart first would 401 on
      // every single sign-in and flash the signed-out page at a user who just
      // authenticated successfully.
      if (isRedirectCallback()) {
        try {
          await completeSignIn();
        } catch (error) {
          setAuthState({
            status: "signed-out",
            error: error instanceof Error ? error.message : "Sign-in failed.",
          });
          return;
        }
      }
      await load(controller.signal);
    };

    void start();
    return () => controller.abort();
  }, []);

  /**
   * A 401 from a view, rather than from the mount probe.
   *
   * Sessions expire mid-visit, and the view that discovers it has no business
   * rendering the failure itself — "Unreachable with a retry" is wrong about a
   * state the app already has a screen for. Stable identity because TodayView
   * holds it as an effect dependency.
   */
  const handleSignedOut = useCallback(() => setAuthState({ status: "signed-out" }), []);

  const endSessionAndSignOut = async () => {
    await signOut(async () => {
      try {
        await endSession();
      } catch {
        // A failed revoke must not strand the user in a session they asked to
        // leave. Auth0's logout still runs (signOut calls it from `finally`),
        // and the cookie is cleared server-side on the next resolve attempt.
      }
    });
  };

  const createChart = async (profile: BirthProfileRequest) => {
    try {
      await createBirthProfile(profile);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "chart_already_exists")) {
        throw error;
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const chart = await getChart();
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

  // Rendered outside AppShell on purpose: every link in that navigation leads
  // to a view that requires a session, so showing the chrome to a signed-out
  // caller would offer five routes that all bounce straight back here.
  if (authState.status === "signed-out") {
    return <SignedOut onSignIn={beginSignIn} error={authState.error} />;
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
  } else if (view === "privacy") {
    content = <PrivacyView hasChart={chart !== null} />;
  } else if (view === "today") {
    content = <TodayView onUnauthorized={handleSignedOut} />;
  } else if (view === "timing") {
    content = <TimingView />;
  } else if (view === "travel") {
    content = <TimeTravelView />;
  } else if (chart) {
    content = <ChartView chart={chart} />;
  } else {
    content = <Onboarding onSubmit={createChart} />;
  }

  return (
    <AppShell
      activeView={view}
      chartStatus={shellStatus}
      onSignOut={() => void endSessionAndSignOut()}
    >
      {content}
    </AppShell>
  );
}
