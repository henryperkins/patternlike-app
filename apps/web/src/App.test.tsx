import axe from "axe-core";
import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  initialContext,
  type Auth0ContextInterface,
  type IdToken,
} from "@auth0/auth0-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import {
  capturedFor,
  deferred,
  mockApiResponses as stubApiResponses,
  notImplemented,
  type MockResponse,
} from "./test/api-mock.js";
import { lifeEvent, travelResponse } from "./test/travel-fixture.js";
import {
  READING_ID,
  consentGranted,
  evidenceGraph,
  todayResponse,
} from "./test/reading-fixture.js";
import {
  ACCOUNT_PROCESSING_CONSENT_PATH,
  accountProcessingGranted,
  accountProcessingNotGranted,
  accountProcessingRevokedFreeze,
  accountProcessingUnexplainedFreeze,
} from "./test/account-processing-fixture.js";

const auth0Harness = vi.hoisted(() => ({
  current: null as Auth0ContextInterface | null,
}));

const preferenceSyncHarness = vi.hoisted(() => ({
  sync: vi.fn<
    (signal?: AbortSignal) => Promise<{
      status: "settled" | "unauthorized" | "unavailable";
    }>
  >(),
}));

vi.mock("@auth0/auth0-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auth0/auth0-react")>();
  return {
    ...actual,
    useAuth0: () => {
      if (!auth0Harness.current) throw new Error("Auth0 test context missing");
      return auth0Harness.current;
    },
  };
});

vi.mock("./lib/device-preference-sync.js", () => ({
  DevicePreferenceSynchronizer: class {
    sync(signal?: AbortSignal) {
      return preferenceSyncHarness.sync(signal);
    }
  },
}));

function setAuth0(
  overrides: Partial<Auth0ContextInterface> = {},
): Auth0ContextInterface {
  const current = {
    ...initialContext,
    isLoading: false,
    error: undefined,
    getIdTokenClaims: vi.fn().mockResolvedValue({
      __raw: "header.payload.signature",
      sub: "auth0|test-only",
    } as IdToken),
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Auth0ContextInterface;
  auth0Harness.current = current;
  return current;
}

const emptyTopics: MockResponse = {
  status: 200,
  body: { schema_version: "0.2.0", excluded_topics: [], updated_at: null },
};

function mockApiResponses(responses: Record<string, MockResponse>) {
  // Privacy mounts TopicExclusionsPanel on every visit. Defaults land on the
  // same object later tests mutate (chart getters, poll transitions), matching
  // TodayView's feedback stubs.
  if (
    !("GET /v1/preferences/topic-exclusions" in responses) &&
    !("/v1/preferences/topic-exclusions" in responses)
  ) {
    responses["GET /v1/preferences/topic-exclusions"] = emptyTopics;
  }
  if (
    !("GET /v1/consents/pattern-generation" in responses) &&
    !("/v1/consents/pattern-generation" in responses)
  ) {
    responses["GET /v1/consents/pattern-generation"] = {
      status: 200,
      body: {
        schema_version: "0.7.0",
        kind: "pattern_generation",
        status: "not_granted",
        provider: "OpenAI",
        purpose: "one_pattern_per_chart",
        policy_version: "1.1.0",
        enabled_categories: [
          "calculated_natal_features",
          "accuracy_and_suppression",
          "confirmed_content_locale",
          "activated_interpretation_ontology",
          "generated_pattern_plan_and_draft_for_validation",
        ],
        granted_at: null,
      },
    };
  }
  if (
    !("GET /v1/pattern-state" in responses) &&
    !("/v1/pattern-state" in responses)
  ) {
    responses["GET /v1/pattern-state"] = {
      status: 200,
      body: {
        schema_version: "0.9.0",
        // The default for suites that are not about Pattern. Every
        // authenticated account is in the generated flow now, and an account
        // with no chart waits on one.
        state: "chart_required",
        chart: null,
        consent: null,
        generation: null,
        pattern: null,
        regeneration: null,
      },
    };
  }
  if (
    !(`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}` in responses) &&
    !(ACCOUNT_PROCESSING_CONSENT_PATH in responses)
  ) {
    responses[`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`] = {
      status: 200,
      body: accountProcessingGranted,
    };
  }
  if (!(`PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}` in responses)) {
    responses[`PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`] = {
      status: 200,
      body: accountProcessingGranted,
    };
  }
  stubApiResponses(responses);
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

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  setAuth0();
  preferenceSyncHarness.sync.mockReset();
  preferenceSyncHarness.sync.mockResolvedValue({ status: "settled" });
  mockApiResponses({});
});

afterEach(() => {
  auth0Harness.current = null;
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

  it("classifies a proven consent freeze into recovery outside the app shell", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 403,
        body: {
          error: {
            code: "account_not_active",
            message: "The account is not active",
            request_id: "req_frozen_chart",
          },
        },
      },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingRevokedFreeze,
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /account is frozen/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("button", { name: /Restore access/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Sign out/i })).toBeEnabled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(preferenceSyncHarness.sync).not.toHaveBeenCalled();
  });

  it("does not label an unexplained frozen account as consent-recoverable", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 403,
        body: {
          error: {
            code: "account_not_active",
            message: "The account is not active",
          },
        },
      },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingUnexplainedFreeze,
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /access is paused/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore access/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("does not call a rejected consent read a consent freeze", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 403,
        body: {
          error: {
            code: "account_not_active",
            message: "The account is not active",
          },
        },
      },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 403,
        body: {
          error: {
            code: "account_not_active",
            message: "This account cannot read consent state",
            request_id: "req_consent_rejected",
          },
        },
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Account access is unavailable/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/consent freeze/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore access/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Sign out/i })).toBeEnabled();
  });

  it("offers current-policy reconfirmation for an active account without a grant", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 403,
        body: {
          error: {
            code: "account_processing_required",
            message: "Current account-processing permission is required",
          },
        },
      },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: { ...accountProcessingNotGranted, has_active_chart: true },
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Review calculation permission/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/account is frozen/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Grant permission and continue/i }),
    ).toBeEnabled();
  });

  it("routes a fresh account to onboarding without granting before final submit", async () => {
    mockApiResponses({
      "/v1/chart": {
        status: 403,
        body: {
          error: {
            code: "account_processing_required",
            message: "Current account-processing permission is required",
          },
        },
      },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingNotGranted,
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Begin with what you know/i }),
    ).toBeInTheDocument();
    const consentRequests = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH);
    expect(consentRequests.length).toBeGreaterThan(0);
    expect(consentRequests.every((request) => request.method === "GET")).toBe(true);
  });

  it("reloads the retained chart after a successful regrant", async () => {
    const user = userEvent.setup();
    let chartReads = 0;
    const responses: Record<string, MockResponse> = {
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingRevokedFreeze,
      },
      [`PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: {
          ...accountProcessingGranted,
          ui_surface: "privacy_center",
        },
      },
    };
    Object.defineProperty(responses, "/v1/chart", {
      enumerable: true,
      get: () => chartReads++ === 0
        ? {
            status: 403,
            body: {
              error: {
                code: "account_not_active",
                message: "The account is not active",
              },
            },
          }
        : { status: 200, body: chart },
    });
    mockApiResponses(responses);

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Restore access/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/chart")).toHaveLength(2);
  });

  it("enters recovery immediately after privacy withdrawal without probing a gated route", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingGranted,
      },
      [`DELETE ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: accountProcessingRevokedFreeze,
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]!);
    const withdraw = await screen.findByRole("button", {
      name: /Withdraw calculation permission/i,
    });
    await user.click(withdraw);
    await user.click(
      screen.getByRole("checkbox", {
        name: /understand.*retained data.*stop being served/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Freeze account/i }));

    expect(
      await screen.findByRole("heading", { name: /account is frozen/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/chart")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
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

  // Time Travel owns its own surface now, so these exercise the dedicated view
  // rather than the removed generic future-route panel.
  it("keeps the honest not-active state when the Worker is older than this app", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": notImplemented("Time Travel (M4)", "req_travel"),
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    expect(
      await screen.findByRole("heading", { name: /not active on this Worker/i }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#travel");

    // A 501 is a roadmap answer, not a failure: retrying only asks the same
    // question again, and the saved-event surface is withheld rather than
    // offering writes the Worker cannot accept.
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Saved life events/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Request req_travel/)).toBeInTheDocument();

    // `date` is required:true on GET /v1/time-travel; omitting it is a 400.
    const now = new Date();
    const today = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
    expect(capturedFor("/v1/time-travel")[0].search).toBe(`?date=${today}`);
  });

  it("keeps the selected date and the retry control when a reconstruction cannot be reached", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": { status: 0, body: null, unreachable: true },
      "/v1/life-events": { status: 200, body: { schema_version: "0.4.0", items: [] } },
    };
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);

    const now = new Date();
    const today = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
    const dateField = await screen.findByLabelText(/Selected date/i);
    expect(dateField).toHaveValue(today);

    const retryButton = await screen.findByRole("button", { name: /Try again/i });
    retryButton.focus();
    await user.click(retryButton);

    // The button must survive the reload it triggers; rendering it on the
    // failure alone unmounted it mid-click and dumped focus to <body>.
    expect(document.activeElement).toBe(retryButton);
    expect(dateField).toHaveValue(today);

    responses["/v1/time-travel"] = { status: 200, body: travelResponse() };
    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(
      await screen.findByRole("heading", { name: /Selected date against now/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/time-travel")).toHaveLength(3);
  });

  it("renders a reconstruction as facts and never as a development payload", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": { status: 200, body: travelResponse() },
      "/v1/life-events": { status: 200, body: { schema_version: "0.4.0", items: [] } },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });

    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);

    // Both references, their provenance, and the comparison group the two
    // states actually fall into.
    expect(await screen.findByRole("heading", { name: /Sunday, 14 June|June 14/i })).toBeInTheDocument();
    expect(screen.getByText("Calculated now")).toBeInTheDocument();
    expect(screen.getByText("Reused calculation")).toBeInTheDocument();
    expect(screen.getByText("Still running now")).toBeInTheDocument();
    expect(screen.getAllByText("Phase changed").length).toBeGreaterThan(0);

    // A successful empty context is distinguished from a failure, and the
    // source is not implicitly enabled by rendering it.
    expect(
      screen.getByText(/Life-event timeline is not enabled/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add an event/i })).not.toBeInTheDocument();

    expect(screen.queryByText(/"schema_version"/)).not.toBeInTheDocument();
  });

  it("sends a contract-shaped export request and reports acceptance", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    const exportId = "exp_cccccccccccccccccccccccccccccccc";
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "GET /v1/preferences/topic-exclusions": emptyTopics,
    });

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
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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

  it("opens birth correction from privacy and returns on cancel", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);

    await user.click(screen.getByRole("button", { name: /Correct/i }));
    expect(
      await screen.findByRole("heading", { name: /Replace what the chart is built from/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(
      await screen.findByRole("heading", { name: /Your data has/i }),
    ).toBeInTheDocument();
  });

  it("replaces the active chart when different birth data is submitted", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "/v1/birth-profiles": {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "NormalizeBirthAndCalculateChart",
          status: "succeeded",
          idempotency_key: "web-birth-test",
          job_id: "job_birth_corr_0001",
          resource_id: "cht_web_test_0002",
        },
      },
    };
    Object.defineProperty(responses, "/v1/chart", {
      enumerable: true,
      get() {
        const posted = capturedFor("/v1/birth-profiles").length > 0;
        return {
          status: 200,
          body: posted
            ? {
                ...chart,
                id: "cht_web_test_0002",
                profile_version: 2,
                fingerprint: `sha256:${"e".repeat(64)}`,
                positions: [
                  { body: "sun", longitude_deg: 120.4, sign: "leo", house: 1, retrograde: false },
                  { body: "moon", longitude_deg: 201.4, sign: "libra", house: 3, retrograde: false },
                  { body: "ascendant", longitude_deg: 10, sign: "aries", house: 1, retrograde: false },
                ],
              }
            : chart,
        };
      },
    });
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Correct/i }));

    await user.type(screen.getByLabelText("Birth date"), "1985-11-02");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );
    await user.click(screen.getByRole("button", { name: /Replace my chart/i }));

    expect((await screen.findAllByText("Leo 0.4 deg")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Taurus 24.1 deg")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#pattern");

    const [request] = capturedFor("/v1/birth-profiles");
    expect(request.method).toBe("POST");
    expect(request.headers.get("idempotency-key")?.startsWith("web-birth-")).toBe(true);
    expect(request.body).toEqual(
      expect.objectContaining({
        accuracy: "exact",
        birth_date: "1985-11-02",
      }),
    );
  });

  it("keeps the current chart when correction resubmits the same birth data", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "/v1/birth-profiles": {
        status: 409,
        body: {
          error: {
            code: "chart_already_exists",
            message: "This birth data already has a chart",
            request_id: "req_dup_chart",
            details: { chart_id: chart.id, fingerprint: chart.fingerprint },
          },
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Correct/i }));

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );
    await user.click(screen.getByRole("button", { name: /Replace my chart/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already has a chart/i);
    expect(
      screen.getByRole("heading", { name: /Replace what the chart is built from/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/birth-profiles")).toHaveLength(1);
  });

  it("maps only the birth calculation budget code to retry-tomorrow copy with its request id", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "GET /v1/consents/ai-synthesis": {
        status: 200,
        body: consentGranted,
      },
      "/v1/birth-profiles": {
        status: 429,
        body: {
          error: {
            code: "birth_calc_budget_exhausted",
            message: "The daily birth calculation limit has been reached",
            request_id: "req_birth_budget_0001",
            details: {
              resets_at: "2026-08-28T00:00:00.000Z",
            },
          },
        },
      },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Correct/i }));
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Replace my chart/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Today's birth calculation limit has been reached. Try again tomorrow. " +
      "(Request req_birth_budget_0001)",
    );
    expect(capturedFor("/v1/birth-profiles")).toHaveLength(1);
  });

  it("does not keep the superseded chart when GET still returns it after replace", async () => {
    const user = userEvent.setup();
    const replacement = {
      ...chart,
      id: "cht_web_test_0002",
      profile_version: 2,
      fingerprint: `sha256:${"e".repeat(64)}`,
      positions: [
        { body: "sun", longitude_deg: 120.4, sign: "leo", house: 1, retrograde: false },
        { body: "moon", longitude_deg: 201.4, sign: "libra", house: 3, retrograde: false },
        { body: "ascendant", longitude_deg: 10, sign: "aries", house: 1, retrograde: false },
      ],
    };
    let readsAfterPost = 0;
    const responses: Record<string, MockResponse> = {
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "/v1/birth-profiles": {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "NormalizeBirthAndCalculateChart",
          status: "succeeded",
          idempotency_key: "web-birth-test",
          job_id: "job_birth_corr_0002",
          resource_id: replacement.id,
        },
      },
    };
    Object.defineProperty(responses, "/v1/chart", {
      enumerable: true,
      get() {
        const posted = capturedFor("/v1/birth-profiles").length > 0;
        if (!posted) return { status: 200, body: chart };
        readsAfterPost += 1;
        return {
          status: 200,
          body: readsAfterPost === 1 ? chart : replacement,
        };
      },
    });
    mockApiResponses(responses);

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Correct/i }));

    await user.type(screen.getByLabelText("Birth date"), "1985-11-02");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );
    await user.click(screen.getByRole("button", { name: /Replace my chart/i }));

    expect(
      (await screen.findAllByText("Leo 0.4 deg", {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Taurus 24.1 deg")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#pattern");
    expect(readsAfterPost).toBeGreaterThan(1);
  });

  it("keeps export and deletion reachable for a user who has no chart", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": {
        status: 404,
        body: { error: { code: "chart_not_found", message: "No active chart for user" } },
      },
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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
      "GET /v1/preferences/topic-exclusions": emptyTopics,
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

  it("loads a valid Worker session without waiting for Auth0 initialization", async () => {
    const auth0 = setAuth0({ isLoading: true });
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/sessions")).toHaveLength(0);
    expect(auth0.getIdTokenClaims).not.toHaveBeenCalled();
  });

  it("syncs device preferences after sign-in and whenever the page returns visible", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await waitFor(() => expect(preferenceSyncHarness.sync).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(preferenceSyncHarness.sync).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(preferenceSyncHarness.sync).toHaveBeenCalledTimes(2));
  });

  it.each([
    {
      label: "an unreachable",
      response: { status: 0, body: null, unreachable: true },
    },
    {
      label: "a 503",
      response: {
        status: 503,
        body: {
          error: {
            code: "configuration_error",
            message: "The API is unavailable",
            request_id: "req_chart_unavailable",
          },
        },
      },
    },
  ] satisfies Array<{ label: string; response: MockResponse }>)(
    "does not sync device preferences after $label chart probe",
    async ({ response }) => {
      mockApiResponses({
        "/v1/chart": response,
      });

      render(<App />);

      expect(
        await screen.findByRole("heading", {
          name: /calculation record is out of reach/i,
        }),
      ).toBeInTheDocument();
      expect(preferenceSyncHarness.sync).not.toHaveBeenCalled();
    },
  );

  it("retries Today after a settled device preference sync", async () => {
    window.location.hash = "today";
    let settleSync!: (result: { status: "settled" }) => void;
    const pendingSync = new Promise<{ status: "settled" }>((resolve) => {
      settleSync = resolve;
    });
    preferenceSyncHarness.sync.mockReturnValue(pendingSync);
    const responses: Record<string, MockResponse> = {
      "/v1/chart": { status: 200, body: chart },
      "/v1/readings/today": {
        status: 409,
        body: {
          error: {
            code: "timezone_confirmation_required",
            message: "Confirm your scheduling time zone",
            request_id: "req_today_preference",
          },
        },
      },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: {
          error: {
            code: "feedback_not_found",
            message: "No feedback recorded for this reading",
          },
        },
      },
    };
    mockApiResponses(responses);

    render(<App />);

    await screen.findByLabelText("Scheduling time zone");
    expect(capturedFor("/v1/readings/today")).toHaveLength(1);
    responses["/v1/readings/today"] = { status: 200, body: todayResponse };

    await act(async () => {
      settleSync({ status: "settled" });
      await pendingSync;
    });

    expect(
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/readings/today")).toHaveLength(2);
  });

  it("shows the signed-out surface when device preference sync finds no session", async () => {
    preferenceSyncHarness.sync.mockResolvedValue({ status: "unauthorized" });
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(preferenceSyncHarness.sync).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
  });

  it("ignores an ordinary Auth0 initialization error when the Worker session is valid", async () => {
    setAuth0({ error: new Error("issuer unavailable") });
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in/i })).not.toBeInTheDocument();
  });

  it("waits for the SDK callback and exchanges one session before probing the chart", async () => {
    const sessionGate = deferred();
    setAuth0({ isLoading: true });
    mockApiResponses({
      "/v1/sessions": {
        status: 201,
        gate: sessionGate.promise,
        body: {
          token: "sess_test_only",
          expires_at: "2026-09-07T00:00:00Z",
        },
      },
      "/v1/chart": { status: 200, body: chart },
    });

    const { rerender } = render(
      <StrictMode>
        <App isAuth0Redirect />
      </StrictMode>,
    );

    expect(capturedFor("/v1/sessions")).toHaveLength(0);
    expect(capturedFor("/v1/chart")).toHaveLength(0);

    setAuth0({ isLoading: false });
    rerender(
      <StrictMode>
        <App isAuth0Redirect />
      </StrictMode>,
    );

    await waitFor(() => expect(capturedFor("/v1/sessions")).toHaveLength(1));
    expect(capturedFor("/v1/sessions")[0].body).toEqual({
      id_token: "header.payload.signature",
    });
    expect(capturedFor("/v1/chart")).toHaveLength(0);

    sessionGate.release();
    expect(
      await screen.findByRole("heading", { name: /architecture of your chart/i }),
    ).toBeInTheDocument();
    expect(capturedFor("/v1/sessions")).toHaveLength(1);
    expect(capturedFor("/v1/chart")).toHaveLength(1);
  });

  it("cleans a refused callback and shows its SDK error on the existing signed-out surface", async () => {
    window.history.replaceState(
      {},
      "",
      "/?error=access_denied&error_description=User%20declined&state=xyz#pattern",
    );
    setAuth0({ error: new Error("User declined") });

    render(<App isAuth0Redirect />);

    expect(await screen.findByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/User declined/i)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#pattern");
    expect(capturedFor("/v1/chart")).toHaveLength(0);
  });

  it("starts Universal Login from the existing Sign in button", async () => {
    const auth0 = setAuth0();
    mockApiResponses({
      "/v1/chart": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Sign in/i }));

    expect(auth0.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(auth0.loginWithRedirect).toHaveBeenCalledWith();
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
    const revokeGate = deferred();
    const auth0 = setAuth0();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/sessions/current": { status: 204, gate: revokeGate.promise, body: null },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "GET /v1/preferences/topic-exclusions": emptyTopics,
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Sign out/i }));

    await waitFor(() => {
      expect(capturedFor("/v1/sessions/current")).toHaveLength(1);
    });
    expect(auth0.logout).not.toHaveBeenCalled();

    revokeGate.release();
    await waitFor(() => expect(auth0.logout).toHaveBeenCalledTimes(1));
    expect(auth0.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("still hands off to Auth0 when Worker revocation is unreachable", async () => {
    const user = userEvent.setup();
    const auth0 = setAuth0();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/sessions/current": { status: 0, body: null, unreachable: true },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "GET /v1/preferences/topic-exclusions": emptyTopics,
    });

    render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Privacy" })[0]);
    await user.click(screen.getByRole("button", { name: /Sign out/i }));

    await waitFor(() => expect(auth0.logout).toHaveBeenCalledTimes(1));
  });

  it("keeps the Time Travel surface free of detectable structural accessibility violations", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      "/v1/chart": { status: 200, body: chart },
      "/v1/time-travel": {
        status: 200,
        body: travelResponse({ life_event_source_state: "active" }),
      },
      "/v1/life-events": {
        status: 200,
        body: { schema_version: "0.4.0", items: [lifeEvent()] },
      },
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Time travel" })[0]);
    await screen.findByRole("heading", { name: /Saved life events/i });

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
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: { error: { code: "feedback_not_found", message: "No feedback recorded for this reading" } },
      },
    });

    const { container } = render(<App />);
    await screen.findByRole("heading", { name: /architecture of your chart/i });
    await user.click(screen.getAllByRole("link", { name: "Today" })[0]);
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
    await screen.findByRole("heading", { name: /Did this meet you/i });

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
