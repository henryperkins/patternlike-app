import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
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
