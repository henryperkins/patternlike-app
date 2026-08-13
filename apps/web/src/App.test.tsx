import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Auth0Client } from "@auth0/auth0-spa-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { __setAuthClientForTests } from "./lib/auth.js";
import {
  NOT_BUILT,
  capturedFor,
  deferred,
  mockApiResponses,
  notImplemented,
  type MockResponse,
} from "./test/api-mock.js";
import {
  READING_ID,
  consentGranted,
  evidenceGraph,
  todayResponse,
} from "./test/reading-fixture.js";

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

afterEach(() => {
  // Leaks across files otherwise: the auth client is module-level state.
  __setAuthClientForTests(null);
});

describe("web application shell", () => {
  it("loads deletion status directly without probing the frozen account chart", async () => {
    window.location.hash = "deletion-status";
    mockApiResponses({
      "/v1/account/deletion-status": {
        status: 200,
        body: {
          schema_version: "0.6.0",
          deletion_request_id: "del_direct_0001",
          status: "running",
          requested_at: "2026-08-13T12:00:00.000Z",
          status_updated_at: "2026-08-13T12:01:00.000Z",
          completed_at: null,
          error_class: null,
        },
      },
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Closing your account/i }))
      .toBeInTheDocument();
    expect(screen.getByText(/account is locked/i)).toBeInTheDocument();
    expect(capturedFor("/v1/chart")).toHaveLength(0);
  });

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

  // Today and Timing now have modelled payloads and dedicated state owners.
  // Time Travel remains the one generic future-route surface.
  it("navigates the remaining future route through its hash link and reports honest route state", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": notImplemented("Time Travel (M4)", "req_travel"),
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    expect(await screen.findByText(`${NOT_BUILT} (Request req_travel)`)).toBeInTheDocument();
    expect(screen.getByText("Not active")).toBeInTheDocument();
    expect(window.location.hash).toBe("#travel");

    // `date` is required:true on GET /v1/time-travel; omitting it is a 400 the
    // moment the stub becomes a real handler.
    const now = new Date();
    const today = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
    expect(capturedFor("/v1/time-travel")[0].search).toBe(`?date=${today}`);
  });

  it("offers a retry when a future route cannot be reached", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": { status: 0, body: null, unreachable: true },
    };
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);

    expect(
      await screen.findByText("The Pattern/Like API could not be reached."),
    ).toBeInTheDocument();
    expect(screen.getByText("Unreachable")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /Try again/i });
    retryButton.focus();
    responses["/v1/time-travel"] = { status: 0, body: null, unreachable: true };
    await user.click(retryButton);

    // The button must survive the reload it triggers; rendering it on "error"
    // alone unmounted it mid-click and dumped focus to <body> every attempt.
    expect(document.activeElement).toBe(retryButton);

    responses["/v1/time-travel"] = notImplemented("Time Travel (M4)", "req_travel");
    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByText(`${NOT_BUILT} (Request req_travel)`)).toBeInTheDocument();
    expect(capturedFor("/v1/time-travel")).toHaveLength(3);
  });

  it("reports a live route without leaking the payload and without offering a retry", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": {
        status: 200,
        body: { items: [], calculation_status: { stale: false } },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    expect(await screen.findByText(/This route is returning data/i)).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("sends a contract-shaped export request and reports acceptance", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    const exportId = "exp_cccccccccccccccccccccccccccccccc";
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/exports": {
        status: 202,
        gate: gate.promise,
        body: {
          schema_version: "0.2.0",
          workflow: "ExportAccount",
          status: "queued",
          idempotency_key: "web-export-test",
          job_id: "job_export_app_0001",
          resource_id: exportId,
        },
      },
      [`/v1/exports/${exportId}`]: {
        status: 200,
        body: {
          schema_version: "0.6.0",
          export_request_id: exportId,
          status: "ready",
          requested_at: "2026-08-13T12:00:00.000Z",
          status_updated_at: "2026-08-13T12:01:00.000Z",
          completed_at: "2026-08-13T12:01:00.000Z",
          expires_at: "2026-08-20T12:01:00.000Z",
          download_available: true,
          error_class: null,
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Request export/i }));
    expect(screen.getByText("Requesting your export.")).toBeInTheDocument();

    gate.release();
    expect(await screen.findByRole("link", { name: /Download export/i }))
      .toHaveAttribute("href", `/v1/exports/${exportId}/download`);

    const [request] = capturedFor("/v1/exports");
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("idempotency-key")?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(request.body).toEqual({ include_readings: true, include_journal: true });
  });

  it("requires typed confirmation before deletion and enters the receipt route", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/account": {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "DeleteAccount",
          status: "queued",
          idempotency_key: "idem-web-delete",
          job_id: "job_delete_app_0001",
          resource_id: "del_app_0001",
        },
      },
      "/v1/account/deletion-status": {
        status: 200,
        body: {
          schema_version: "0.6.0",
          deletion_request_id: "del_app_0001",
          status: "running",
          requested_at: "2026-08-13T12:00:00.000Z",
          status_updated_at: "2026-08-13T12:01:00.000Z",
          completed_at: null,
          error_class: null,
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    expect(capturedFor("/v1/account")).toHaveLength(0);

    const confirmButton = screen.getByRole("button", { name: /Confirm deletion/i });
    const confirmField = screen.getByLabelText(/Type DELETE to confirm/i);
    expect(confirmButton).toBeDisabled();

    await user.type(confirmField, "delete");
    expect(confirmButton).toBeDisabled();
    expect(capturedFor("/v1/account")).toHaveLength(0);

    await user.clear(confirmField);
    await user.type(confirmField, "DELETE");
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(await screen.findByRole("heading", { name: /Closing your account/i }))
      .toBeInTheDocument();
    expect(window.location.hash).toBe("#deletion-status");

    const [request] = capturedFor("/v1/account");
    expect(request.method).toBe("DELETE");
    expect(request.headers.get("idempotency-key")?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(request.body).toEqual({ confirm: "DELETE", reason: null });
  });

  it("moves focus into the confirmation and back to the trigger on cancel", async () => {
    const user = userEvent.setup();
    mockApiResponses({ "/v1/chart": { status: 200, body: chart } });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Delete account/i }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Type DELETE to confirm/i));

    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    const trigger = screen.getByRole("button", { name: /Delete account/i });
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Cancel must reset the interlock — otherwise reopening finds the field
    // pre-filled and the destructive button already armed.
    await user.click(trigger);
    expect(screen.getByLabelText(/Type DELETE to confirm/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /Confirm deletion/i })).toBeDisabled();
  });

  it("reuses one idempotency key when a failed mutation is retried", async () => {
    const user = userEvent.setup();
    const exportId = "exp_dddddddddddddddddddddddddddddddd";
    const responses: Record<string, MockResponse> = {
      "/v1/chart": { status: 200, body: chart },
      "/v1/exports": { status: 0, body: null, unreachable: true },
    };
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Request export/i }));
    await screen.findByText("The Pattern/Like API could not be reached.");

    responses["/v1/exports"] = {
      status: 202,
      body: {
        schema_version: "0.2.0",
        workflow: "ExportAccount",
        status: "queued",
        idempotency_key: "web-export-test",
        job_id: "job_export_app_0002",
        resource_id: exportId,
      },
    };
    responses[`/v1/exports/${exportId}`] = {
      status: 200,
      body: {
        schema_version: "0.6.0",
        export_request_id: exportId,
        status: "ready",
        requested_at: "2026-08-13T12:00:00.000Z",
        status_updated_at: "2026-08-13T12:01:00.000Z",
        completed_at: "2026-08-13T12:01:00.000Z",
        expires_at: "2026-08-20T12:01:00.000Z",
        download_available: true,
        error_class: null,
      },
    };
    await user.click(screen.getByRole("button", { name: /Request export/i }));
    await screen.findByRole("link", { name: /Download export/i });

    // A second key would start a second export instead of resuming the first.
    const keys = capturedFor("/v1/exports").map((r) => r.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("surfaces the transport failure message instead of a bare failure", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/exports": { status: 0, body: null, unreachable: true },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Request export/i }));

    expect(
      await screen.findByText("The Pattern/Like API could not be reached."),
    ).toBeInTheDocument();
  });

  it("keeps export and deletion reachable for a user who has no chart", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": {
        status: 404,
        body: { error: { code: "chart_not_found", message: "No active chart for user" } },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /Begin with what you know/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    // Account data — and the right to take it out or delete it — exists whether
    // or not a chart was ever calculated.
    expect(await screen.findByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
  });

  it("keeps the privacy surface free of detectable structural accessibility violations", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/account": notImplemented("Account deletion (M1 privacy skeleton follows)", "req_delete"),
      // Stubbed so the AI-synthesis panel is checked in its loaded state, with
      // its category list and its live control, rather than in the one-line
      // failure state an unstubbed route would leave it in.
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await screen.findByRole("heading", { name: /Portable in. Portable out./i });
    await screen.findByRole("button", { name: /Withdraw permission/i });
    await user.click(screen.getByRole("button", { name: /Delete account/i }));

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });

  it("shows the signed-out surface, not an error, when the session is gone", async () => {
    // 401 is the one status that is not a failure to report: it is the API
    // saying "you are not signed in", which is a state the UI has a screen for.
    mockApiResponses({
      "/v1/chart": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Calculated, not invented/i })).toBeInTheDocument();
    // No navigation: every route behind it needs the session that just failed.
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
    expect(screen.queryByText(/API unavailable/)).not.toBeInTheDocument();
  });

  it("keeps the signed-out surface free of detectable structural accessibility violations", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
    });

    const { container } = render(<App />);
    await screen.findByRole("button", { name: /Sign in/i });

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });

  it("revokes the Worker session before handing off to the issuer's logout", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    __setAuthClientForTests({ logout } as unknown as Auth0Client);

    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/sessions/current": { status: 204, body: null },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Sign out/i }));

    const [request] = capturedFor("/v1/sessions/current");
    expect(request.method).toBe("DELETE");
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("keeps a future route surface free of detectable structural accessibility violations", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": notImplemented("Time Travel (M4)", "req_travel"),
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    await screen.findByText(`${NOT_BUILT} (Request req_travel)`);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });

  it("shows the signed-out surface when Today alone finds the session gone", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/readings/today": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);

    // A session can expire between the mount probe and a view's own fetch.
    // Rendering "Unreachable with a retry" would be wrong about a state the app
    // already has a screen for.
    expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
  });

  it("shows the signed-out surface when Timing alone finds the session gone", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/timing": {
        status: 401,
        body: {
          error: {
            code: "unauthorized",
            message: "Authentication required",
            request_id: "req_timing_unauthorized",
          },
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Timing" })[0]);

    expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
  });

  it("routes a chart-less reader from Today into onboarding", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": {
        status: 404,
        body: { error: { code: "chart_not_found", message: "No active chart for user" } },
      },
      "/v1/readings/today": {
        status: 404,
        body: {
          error: {
            code: "chart_not_found",
            message: "No active chart for user",
            request_id: "req_today",
          },
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /Begin with what you know/i });

    window.location.hash = "today";
    const link = await screen.findByRole("link", { name: /Set up your chart/i });
    expect(link).toHaveAttribute("href", "#pattern");

    // The affordance has to actually land somewhere: `#pattern` renders the
    // chart view when there is one and onboarding when there is not.
    await user.click(link);
    expect(
      await screen.findByRole("heading", { name: /Begin with what you know/i }),
    ).toBeInTheDocument();
  });

  it("keeps the Today surface free of detectable structural accessibility violations", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/readings/today": { status: 200, body: todayResponse },
      [`/v1/readings/${READING_ID}/evidence`]: { status: 200, body: evidenceGraph },
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

    // Opened, because the drawer's contents are the part with the most markup
    // and the only place a heading-order violation could hide.
    await user.click(screen.getByText("Why this reading?"));
    await screen.findByText("The weight of the moving body");

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });
});
