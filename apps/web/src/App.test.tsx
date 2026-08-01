import axe from "axe-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const chart = {
  schema_version: "0.2.0",
  id: "cht_web_test_0001",
  user_id: "usr_web_test_0001",
  profile_version: 1,
  fingerprint: `sha256:${"d".repeat(64)}`,
  contract_id: "calc-contract-launch",
  contract_version: "0.2.0",
  container_digest: `sha256:${"c".repeat(64)}`,
  tzdb_version: "2026a",
  birth: {
    accuracy: "exact",
    utc_instant: null,
    timezone: null,
    place_label: null,
    latitude: null,
    longitude: null,
  },
  positions: [
    { body: "sun", longitude_deg: 54.12, sign: "taurus", house: 10, retrograde: false },
    { body: "moon", longitude_deg: 201.4, sign: "libra", house: 3, retrograde: false },
    { body: "ascendant", longitude_deg: 10, sign: "aries", house: 1, retrograde: false },
  ],
  houses: {
    system_used: "placidus",
    fallback_applied: false,
    cusps_deg: [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  },
  angles: { ascendant_deg: 10, midheaven_deg: 280 },
  aspects: [],
  uncertainty: {
    accuracy: "exact",
    window: null,
    suppressed_features: [],
    qualified_features: [],
    user_facing_summary: "Birth time is exact; houses and angles are included.",
  },
  calculated_at: "2026-07-30T15:00:00Z",
  status: "active",
};

describe("web application shell", () => {
  it("routes a user without a chart into honest onboarding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: "chart_not_found", message: "No active chart for user" },
        }),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Begin with what you know/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Setup needed").length).toBeGreaterThan(0);
  });

  it("renders calculated facts without inventing an interpretation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, chart)));

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Taurus 24.1 deg").length).toBeGreaterThan(0);
    expect(screen.getByText("Facts first. Meaning second.")).toBeInTheDocument();
    expect(screen.getAllByText("Chart verified").length).toBeGreaterThan(0);
  });

  it("keeps the onboarding surface free of detectable structural accessibility violations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: "chart_not_found", message: "No active chart for user" },
        }),
      ),
    );
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /Begin with what you know/i });

    const results = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it("opens future surfaces without presenting them as live", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, chart)));
    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /clear day, not a horoscope feed/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Planned / M3")).toBeInTheDocument();
  });
});
