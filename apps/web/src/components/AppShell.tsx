import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons.js";

export type ViewId = "today" | "pattern" | "timing" | "travel" | "privacy";

const navigation: Array<{ id: ViewId; label: string; icon: IconName; stage?: string }> = [
  { id: "today", label: "Today", icon: "today", stage: "M3" },
  { id: "pattern", label: "Your pattern", icon: "pattern" },
  { id: "timing", label: "Timing", icon: "timing", stage: "M3" },
  { id: "travel", label: "Time travel", icon: "travel", stage: "M4" },
  { id: "privacy", label: "Privacy", icon: "privacy" },
];

interface AppShellProps {
  activeView: ViewId;
  chartStatus: "loading" | "ready" | "missing" | "offline";
  children: ReactNode;
}

function StatusMark({ status }: { status: AppShellProps["chartStatus"] }) {
  const copy = {
    loading: "Checking chart",
    ready: "Chart verified",
    missing: "Setup needed",
    offline: "API unavailable",
  }[status];

  return (
    <div className={`shell-status shell-status--${status}`}>
      <span className="shell-status__dot" />
      <span>{copy}</span>
    </div>
  );
}

function NavItems({ activeView, mobile = false }: { activeView: ViewId; mobile?: boolean }) {
  return navigation.map((item) => (
    <a
      className={`nav-item${activeView === item.id ? " nav-item--active" : ""}`}
      href={`#${item.id}`}
      aria-current={activeView === item.id ? "page" : undefined}
      key={item.id}
    >
      <Icon name={item.icon} className="nav-item__icon" />
      <span className="nav-item__label">{mobile && item.id === "pattern" ? "Pattern" : item.label}</span>
      {item.stage && !mobile ? <span className="nav-item__stage">{item.stage}</span> : null}
    </a>
  ));
}

export function AppShell({ activeView, chartStatus, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="sidebar">
        <a className="wordmark" href="#pattern" aria-label="Pattern Like home">
          <span className="wordmark__mark" aria-hidden="true">
            <span />
          </span>
          <span className="wordmark__text">
            Pattern<span>/Like</span>
          </span>
        </a>

        <nav className="sidebar__nav" aria-label="Desktop navigation">
          <NavItems activeView={activeView} />
        </nav>

        <div className="sidebar__foot">
          <StatusMark status={chartStatus} />
          <p>Private by design.<br />Inspectable by default.</p>
        </div>
      </aside>

      <header className="mobile-header">
        <a className="wordmark wordmark--mobile" href="#pattern" aria-label="Pattern Like home">
          <span className="wordmark__mark" aria-hidden="true"><span /></span>
          <span className="wordmark__text">Pattern<span>/Like</span></span>
        </a>
        <StatusMark status={chartStatus} />
      </header>

      <main className="main-content" id="main-content">
        {children}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavItems activeView={activeView} mobile />
      </nav>
    </div>
  );
}
