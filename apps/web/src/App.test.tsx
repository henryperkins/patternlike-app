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

type MockResponse = { status: number; body: unknown; delayMs?: number };

function mockApiResponses(responses: Record<string, MockResponse>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: string | URL | Request) => {
      const path = new URL(typeof input === "string" ? input : input.toString(), "http://localhost").pathname;

      const entry = responses[path];
      if (!entry) {
        return Promise.resolve(
          jsonResponse(500, {
            error: {
              code: "unexpected_path",
              message: `No stubbed response for ${path}`,
            },
          }),
        );
      }

      const response = Promise.resolve(jsonResponse(entry.status, entry.body));
      if (entry.delayMs == null || entry.delayMs <= 0) return response;

      return new Promise((resolve) => {
        window.setTimeout(() => {
          resolve(response);
        }, entry.delayMs);
      });
    }),
  );
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
    mockApiResponses({
      "/v1/chart": {
        status: 404,
        body: { error: { code: "chart_not_found", message: "No active chart for user" } },
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Begin with what you know/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Setup needed").length).toBeGreaterThan(0);
  });

  it("renders calculated facts without inventing an interpretation", async () => {
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Taurus 24.1 deg").length).toBeGreaterThan(0);
    expect(screen.getByText("Facts first. Meaning second.")).toBeInTheDocument();
    expect(screen.getAllByText("Chart verified").length).toBeGreaterThan(0);
  });

  it("keeps the onboarding surface free of detectable structural accessibility violations", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 404,
        body: { error: { code: "chart_not_found", message: "No active chart for user" } },
      },
    });
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /Begin with what you know/i });

    const results = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it("navigates future routes through hash links and API-first states", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/readings/today": {
        status: 501,
        body: {
          error: {
            code: "not_implemented",
            message: "Daily readings lands in a later milestone",
            request_id: "req_today",
          },
        },
      },
      "/v1/timing": {
        status: 501,
        body: {
          error: {
            code: "not_implemented",
            message: "Timing cycles lands in a later milestone",
            request_id: "req_timing",
          },
        },
      },
      "/v1/time-travel": {
        status: 501,
        body: {
          error: {
            code: "not_implemented",
            message: "Time travel lands in a later milestone",
            request_id: "req_travel",
          },
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);
    expect(await screen.findByText("Available in a later milestone (Request req_today)")).toBeInTheDocument();
    expect(window.location.hash).toBe("#today");

    await user.click(screen.getAllByRole("link", { name: "Timing" })[0]);
    expect(await screen.findByText("Available in a later milestone (Request req_timing)")).toBeInTheDocument();
    expect(window.location.hash).toBe("#timing");

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    expect(await screen.findByText("Available in a later milestone (Request req_travel)")).toBeInTheDocument();
    expect(window.location.hash).toBe("#travel");
  });

  it("renders privacy action states and displays not implemented copy", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/exports": {
        status: 200,
        body: { workflow: "export", status: "queued", idempotency_key: "id", job_id: null, resource_id: null, schema_version: "0.2.0" },
        delayMs: 50,
      },
      "/v1/account": {
        status: 501,
        body: {
          error: {
            code: "not_implemented",
            message: "Account deletion lands in a later milestone",
            request_id: "req_delete",
          },
        },
        delayMs: 50,
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    const exportButton = screen.getByRole("button", { name: /Request data export/i });
    await user.click(exportButton);
    expect(await screen.findByText("Submitting...")).toBeInTheDocument();
    expect(await screen.findByText("Request accepted")).toBeInTheDocument();

    const deleteButton = screen.getByRole("button", { name: /Delete account/i });
    await user.click(deleteButton);
    expect(await screen.findByText("Submitting...")).toBeInTheDocument();
    expect(await screen.findByText("Available in a later milestone (Request req_delete)")).toBeInTheDocument();
  });
});
