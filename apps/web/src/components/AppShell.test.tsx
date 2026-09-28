import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
  it("skips navigation by focusing the current content without changing the route", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ readerJourney: "current" }, "", "#today");
    const historyLength = window.history.length;
    render(
      <AppShell activeView="today" chartStatus="ready">
        <h1>Today's reading</h1>
      </AppShell>,
    );

    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("#today");
    expect(window.history.length).toBe(historyLength);
    expect(window.history.state).toEqual({ readerJourney: "current" });
  });

  it("names navigation destinations without internal milestone codes", () => {
    render(
      <AppShell activeView="today" chartStatus="ready">
        <p>Current view</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole("navigation", {
      name: "Desktop navigation",
    });
    expect(within(desktopNavigation).getByRole("link", { name: "Today" }))
      .toBeInTheDocument();
    expect(
      within(desktopNavigation).getByRole("link", { name: "Time travel" }),
    ).toBeInTheDocument();
    expect(within(desktopNavigation).queryByText(/^M[34]$/)).not.toBeInTheDocument();
  });
});
