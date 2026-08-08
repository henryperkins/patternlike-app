import { useEffect, useState } from "react";
import type { BirthProfileRequest } from "@patternlike/shared";
import { AppShell, type ViewId } from "./components/AppShell.js";
import { ChartView } from "./components/ChartView.js";
import { Icon } from "./components/icons.js";
import { Onboarding } from "./components/Onboarding.js";
import { PrivacyView } from "./components/PrivacyView.js";
import { TimeTravelView } from "./components/TimeTravelView.js";
import { TimingView } from "./components/TimingView.js";
import { TodayView } from "./components/TodayView.js";
import {
  ApiError,
  createBirthProfile,
  getChart,
  type ChartResponse,
} from "./lib/api-client.js";

type ChartState =
  | { status: "loading" }
  | { status: "ready"; chart: ChartResponse }
  | { status: "missing" }
  | { status: "offline"; message: string; requestId?: string | null };

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

  const load = async (signal?: AbortSignal) => {
    try {
      const chart = await getChart(signal);
      setChartState({ status: "ready", chart });
    } catch (error) {
      if (signal?.aborted) return;
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
    void load(controller.signal);
    return () => controller.abort();
  }, []);

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
    content = <TodayView />;
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
    <AppShell activeView={view} chartStatus={shellStatus}>
      {content}
    </AppShell>
  );
}
