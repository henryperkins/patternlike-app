import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface MockResponse {
  status: number;
  body: unknown;
  /**
   * Held open until the test releases it. Asserting a transient state such as
   * "Submitting..." against a wall-clock delay is a coin flip on a loaded CI
   * box — the label is monotonic, so a missed poll can never recover.
   */
  gate?: Promise<void>;
  /** Reject the fetch itself, i.e. the non-ApiError transport failure path. */
  unreachable?: boolean;
}

interface CapturedRequest {
  path: string;
  search: string;
  method: string;
  headers: Headers;
  body: unknown;
}

let captured: CapturedRequest[] = [];

function capturedFor(path: string): CapturedRequest[] {
  return captured.filter((request) => request.path === path);
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Mirrors the shape apps/api/src/routes/stubs.ts actually returns. */
function notImplemented(feature: string, requestId: string): MockResponse {
  return {
    status: 501,
    body: {
      error: {
        code: "not_implemented",
        message: `${feature} lands in a later milestone`,
        request_id: requestId,
      },
    },
  };
}

const NOT_BUILT = "Not built yet. The API answered with a not-implemented response.";

function mockApiResponses(responses: Record<string, MockResponse>) {
  captured = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      captured.push({
        path: url.pathname,
        search: url.search,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });

      const entry = responses[url.pathname];
      if (!entry) {
        return jsonResponse(500, {
          error: {
            code: "unexpected_path",
            message: `No stubbed response for ${url.pathname}`,
          },
        });
      }

      if (entry.gate) await entry.gate;
      if (entry.unreachable) throw new TypeError("Failed to fetch");
      return jsonResponse(entry.status, entry.body);
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

  it("navigates future routes through hash links and reports honest route state", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/readings/today": notImplemented("Daily readings (M3)", "req_today"),
      "/v1/timing": notImplemented("Timing cycles (M3)", "req_timing"),
      "/v1/time-travel": notImplemented("Time Travel (M4)", "req_travel"),
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);
    expect(await screen.findByText(`${NOT_BUILT} (Request req_today)`)).toBeInTheDocument();
    expect(screen.getByText("Not active")).toBeInTheDocument();
    expect(window.location.hash).toBe("#today");

    await user.click(screen.getAllByRole("link", { name: "Timing" })[0]);
    expect(await screen.findByText(`${NOT_BUILT} (Request req_timing)`)).toBeInTheDocument();
    expect(window.location.hash).toBe("#timing");

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    expect(await screen.findByText(`${NOT_BUILT} (Request req_travel)`)).toBeInTheDocument();
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
      "/v1/readings/today": { status: 0, body: null, unreachable: true },
    };
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);

    expect(
      await screen.findByText("The Pattern/Like API could not be reached."),
    ).toBeInTheDocument();
    expect(screen.getByText("Unreachable")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /Try again/i });
    retryButton.focus();
    responses["/v1/readings/today"] = { status: 0, body: null, unreachable: true };
    await user.click(retryButton);

    // The button must survive the reload it triggers; rendering it on "error"
    // alone unmounted it mid-click and dumped focus to <body> every attempt.
    expect(document.activeElement).toBe(retryButton);

    responses["/v1/readings/today"] = notImplemented("Daily readings (M3)", "req_today");
    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByText(`${NOT_BUILT} (Request req_today)`)).toBeInTheDocument();
    expect(capturedFor("/v1/readings/today")).toHaveLength(3);
  });

  it("reports a live route without leaking the payload and without offering a retry", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/timing": {
        status: 200,
        body: { items: [], calculation_status: { stale: false } },
      },
      "/v1/time-travel": notImplemented("Time Travel (M4)", "req_travel"),
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Timing" })[0]);
    expect(await screen.findByText(/This route is returning data/i)).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();

    // A 501 is a roadmap answer, not a transient failure: retrying it would only
    // ask the same question again.
    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    await screen.findByText(`${NOT_BUILT} (Request req_travel)`);
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("sends a contract-shaped export request and reports acceptance", async () => {
    const user = userEvent.setup();
    const gate = deferred();
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
          job_id: null,
          resource_id: null,
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Request export/i }));
    expect(screen.getByText("Submitting...")).toBeInTheDocument();

    gate.release();
    expect(await screen.findByText("Request accepted")).toBeInTheDocument();

    const [request] = capturedFor("/v1/exports");
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("idempotency-key")?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(request.body).toEqual({ include_readings: true, include_journal: true });
  });

  it("requires a typed confirmation before it will call account deletion", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/account": notImplemented("Account deletion (M1 privacy skeleton follows)", "req_delete"),
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

    expect(await screen.findByText(`${NOT_BUILT} (Request req_delete)`)).toBeInTheDocument();

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
        job_id: null,
        resource_id: null,
      },
    };
    await user.click(screen.getByRole("button", { name: /Request export/i }));
    await screen.findByText("Request accepted");

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
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await screen.findByRole("heading", { name: /Portable in. Portable out./i });
    await user.click(screen.getByRole("button", { name: /Delete account/i }));

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });

  it("keeps a future route surface free of detectable structural accessibility violations", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/timing": notImplemented("Timing cycles (M3)", "req_timing"),
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Timing" })[0]);
    await screen.findByText(`${NOT_BUILT} (Request req_timing)`);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });
});
