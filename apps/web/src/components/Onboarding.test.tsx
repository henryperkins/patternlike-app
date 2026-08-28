import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimezoneLookupResponse } from "@patternlike/shared";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import {
  ACCOUNT_PROCESSING_CONSENT_PATH,
  accountProcessingGranted,
  accountProcessingNotGranted,
} from "../test/account-processing-fixture.js";
import { ApiError } from "../lib/api-client.js";
import { Onboarding } from "./Onboarding.js";

beforeEach(() => {
  mockApiResponses({
    [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
      status: 200,
      body: accountProcessingNotGranted,
    },
    [`PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
      status: 200,
      body: accountProcessingGranted,
    },
  });
});

async function reachReviewStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
  await user.type(screen.getByLabelText("Local time"), "12:34:00");
  await user.click(screen.getByRole("button", { name: /Continue/i }));
  await user.click(screen.getByRole("button", { name: /Continue/i }));
}

describe("birth onboarding", () => {
  it("keeps unknown birth time as a first-class path", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /I do not know/i }));
    expect(screen.queryByLabelText("Local time")).not.toBeInTheDocument();
    expect(screen.getByText("Suppressed")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByRole("group", { name: /Where was the birth/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracy: "unknown",
        birth_date: "1990-05-15",
        birth_time_local: null,
      }),
      expect.stringMatching(/^web-birth-/),
    );
  });

  /**
   * The primary button must stay a submit button on every step. When it changed
   * from type="button" to type="submit" on the way into step three, React
   * flushed that change during the click and the browser then ran the submit
   * default action on the very same node — posting the profile straight from
   * step two. jsdom does not run that default action, so this asserts the shape
   * that caused it rather than the symptom.
   */
  it("never swaps the type of the primary action button between steps", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    const primary = () => screen.getByRole("button", { name: /Continue|Create my chart/i });

    expect(primary()).toHaveAttribute("type", "submit");
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");

    await user.click(primary());
    expect(primary()).toHaveAttribute("type", "submit");
    expect(primary()).toHaveAccessibleName(/Create my chart/i);
  });

  it("reaches the review step without submitting anything", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("group", { name: /Review the boundary/i })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still requires the consent box once the review step has been seen", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );

    // Leaving and re-entering the review step must not stand in for pressing the
    // create button, even though consent is already recorded.
    await user.click(screen.getByRole("button", { name: /Back/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not advance without the required chart date", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a birth date");
    expect(screen.getByRole("group", { name: /How precise is the birth time/i })).toBeInTheDocument();
  });

  it("renders the current server policy and its links on the review step", async () => {
    const user = userEvent.setup();
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachReviewStep(user);

    expect(
      await screen.findByText("account-processing-v1-2026-08-28"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/API sends those values to Pattern\/Like's calculation service/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Terms/i })).toHaveAttribute(
      "href",
      "/terms.html",
    );
    expect(screen.getByRole("link", { name: /Privacy policy/i })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
  });

  it("keeps final submission disabled when the policy cannot be read", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 503,
        body: {
          error: {
            code: "storage_unavailable",
            message: "Consent storage is unavailable",
            request_id: "req_consent_unreadable",
          },
        },
      },
    });
    const onSubmit = vi.fn();
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);

    expect(await screen.findByRole("status", { name: /Calculation permission status/i }))
      .toHaveTextContent(/could not be read/i);
    expect(screen.getByRole("button", { name: /Create my chart/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats a malformed success response as unreadable rather than consentable", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 200,
        body: {
          ...accountProcessingNotGranted,
          disclosure: null,
        },
      },
    });
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachReviewStep(user);

    expect(await screen.findByRole("status", { name: /Calculation permission status/i }))
      .toHaveTextContent(/could not be read/i);
    expect(screen.getByRole("button", { name: /Create my chart/i })).toBeDisabled();
  });

  it("grants before birth and submits the exact returned consent id", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockImplementation(async (profile, birthKey) => {
      expect(capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)).toHaveLength(2);
      expect(
        capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH).at(-1)?.method,
      ).toBe("PUT");
      expect(profile.consent_id).toBe(accountProcessingGranted.consent_id);
      expect(birthKey).toMatch(/^web-birth-/);
    });
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const grant = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH).at(-1)!;
    expect(grant.headers.get("x-consent-ui-surface")).toBe("onboarding");
    expect(grant.headers.get("idempotency-key")).toMatch(
      /^web-account-processing-/,
    );
  });

  it("holds the grant and birth keys while the same visible intent is retried", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("The calculation service could not be reached."))
      .mockResolvedValueOnce(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached/i);
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const grantKeys = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers.get("idempotency-key"));
    expect(grantKeys).toHaveLength(2);
    expect(grantKeys[0]).toBe(grantKeys[1]);
    expect(onSubmit.mock.calls[0]![1]).toBe(onSubmit.mock.calls[1]![1]);
  });

  it("starts a new birth intent when submitted birth details are edited", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("Review the birth details."))
      .mockResolvedValueOnce(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Review the birth details/i);

    await user.click(screen.getByRole("button", { name: /Back/i }));
    await user.click(screen.getByRole("button", { name: /Back/i }));
    const date = screen.getByLabelText("Birth date");
    await user.clear(date);
    await user.type(date, "1991-06-16");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0]![1]).not.toBe(onSubmit.mock.calls[1]![1]);
    const grantKeys = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers.get("idempotency-key"));
    expect(grantKeys[0]).toBe(grantKeys[1]);
  });

  it("refreshes a stale policy and requires a new confirmation intent", async () => {
    const user = userEvent.setup();
    let reads = 0;
    let grants = 0;
    const responses: Parameters<typeof mockApiResponses>[0] = {};
    Object.defineProperty(responses, `GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`, {
      enumerable: true,
      get: () => ({
        status: 200,
        body: reads++ === 0
          ? { ...accountProcessingNotGranted, policy_version: "retired-policy" }
          : accountProcessingNotGranted,
      }),
    });
    Object.defineProperty(responses, `PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`, {
      enumerable: true,
      get: () => grants++ === 0
        ? {
            status: 409,
            body: {
              error: {
                code: "consent_policy_version_stale",
                message: "Re-read the current account-processing policy",
                request_id: "req_stale_policy",
              },
            },
          }
        : { status: 200, body: accountProcessingGranted },
    });
    mockApiResponses(responses);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);
    expect(await screen.findByText("retired-policy")).toBeInTheDocument();
    const confirmation = screen.getByRole("checkbox", {
      name: /allow Pattern\/Like to encrypt these details/i,
    });
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/permission changed/i);
    expect(confirmation).not.toBeChecked();
    expect(
      await screen.findByText("account-processing-v1-2026-08-28"),
    ).toBeInTheDocument();
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    const grantKeys = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers.get("idempotency-key"));
    expect(grantKeys).toHaveLength(2);
    expect(grantKeys[0]).not.toBe(grantKeys[1]);
  });

  it("refreshes an invalidated grant and starts new mutation and birth intents", async () => {
    const user = userEvent.setup();
    const replacementGrant = {
      ...accountProcessingGranted,
      consent_id: "cns_account_processing_0002",
      ui_surface: "privacy_center",
    };
    let reads = 0;
    let grants = 0;
    const responses: Parameters<typeof mockApiResponses>[0] = {};
    Object.defineProperty(responses, `GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`, {
      enumerable: true,
      get: () => ({
        status: 200,
        body: reads++ === 0 ? accountProcessingNotGranted : replacementGrant,
      }),
    });
    Object.defineProperty(responses, `PUT ${ACCOUNT_PROCESSING_CONSENT_PATH}`, {
      enumerable: true,
      get: () => ({
        status: 200,
        body: grants++ === 0 ? accountProcessingGranted : replacementGrant,
      }),
    });
    mockApiResponses(responses);
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(
        new ApiError(403, {
          error: {
            code: "consent_invalid",
            message: "The submitted consent is not current",
            request_id: "req_consent_invalid",
          },
        }),
      )
      .mockResolvedValueOnce(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachReviewStep(user);
    const confirmation = screen.getByRole("checkbox", {
      name: /allow Pattern\/Like to encrypt these details/i,
    });
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer current/i);
    await waitFor(() => {
      expect(
        capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH).filter(
          (request) => request.method === "GET",
        ),
      ).toHaveLength(2);
    });
    expect(confirmation).not.toBeChecked();
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(onSubmit.mock.calls[0]![0].consent_id).toBe(
      accountProcessingGranted.consent_id,
    );
    expect(onSubmit.mock.calls[1]![0].consent_id).toBe(
      replacementGrant.consent_id,
    );
    expect(onSubmit.mock.calls[0]![1]).not.toBe(onSubmit.mock.calls[1]![1]);
    const grantKeys = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)
      .filter((request) => request.method === "PUT")
      .map((request) => request.headers.get("idempotency-key"));
    expect(grantKeys[0]).not.toBe(grantKeys[1]);
  });
});

describe("historical timezone lookup", () => {
  const RESOLVED: TimezoneLookupResponse = {
    schema_version: "0.2.0",
    timezone: "America/Los_Angeles",
    source: "coordinates",
    confidence: "high",
    boundary_nearby: false,
    hint_overridden: null,
    tzdb_stable_from_year: 1970,
    local: {
      utc_instant: "1990-05-15T19:34:00.000Z",
      utc_offset_minutes: -420,
      utc_offset_label: "UTC-07:00",
      resolution: "unique",
      alternate_utc_instant: null,
      alternate_utc_offset_minutes: null,
    },
    qualifiers: [],
  };

  function mockLookup(response: TimezoneLookupResponse | "unreachable") {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === ACCOUNT_PROCESSING_CONSENT_PATH) {
        return new Response(
          JSON.stringify(init?.method === "PUT" ? accountProcessingGranted : accountProcessingNotGranted),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (response === "unreachable") throw new TypeError("network down");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** Fills step one and advances, returning the local time as the field kept it. */
  async function reachLocationStep(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<string> {
    await user.type(screen.getByLabelText("Birth date"), "1990-05-15");
    const time = screen.getByLabelText("Local time");
    await user.type(time, "12:34:00");
    const entered = (time as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    return entered;
  }

  it("resolves the zone from the birthplace instead of asking the user to vouch for it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    const localTime = await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByLabelText(/IANA timezone/)).toHaveValue("America/Los_Angeles"),
    );
    expect(screen.getByText("UTC-07:00 on this date")).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      latitude: 34.0522,
      longitude: -118.2437,
      birth_date: "1990-05-15",
      // The birth time goes with the request: whether the offset was daylight
      // or standard can turn on the hour, not just the date.
      birth_time_local: localTime,
    });
  });

  /** The copy this replaced said the lookup "is not connected yet". */
  it("no longer asks the user to confirm an unchecked value", async () => {
    const user = userEvent.setup();
    mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByLabelText(/IANA timezone/)).toHaveValue("America/Los_Angeles"),
    );
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
  });

  it("shows the caveats the resolution came back with", async () => {
    const user = userEvent.setup();
    mockLookup({
      ...RESOLVED,
      confidence: "low",
      boundary_nearby: true,
      qualifiers: [
        { code: "near_zone_boundary", message: "Sits on a timezone boundary." },
        { code: "pre_1970_zone_boundary", message: "Rules before 1970 are not guaranteed." },
      ],
    });
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "40.7377");
    await user.type(screen.getByLabelText("Longitude"), "-114.0372");

    await waitFor(() =>
      expect(screen.getByText("Sits on a timezone boundary.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Rules before 1970 are not guaranteed.")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
  });

  it("leaves the zone editable when there is no birthplace to resolve from", async () => {
    const user = userEvent.setup();
    const fetchMock = mockLookup(RESOLVED);
    render(<Onboarding onSubmit={vi.fn()} />);

    await reachLocationStep(user);

    const field = screen.getByLabelText(/IANA timezone/);
    expect(field).not.toHaveAttribute("readonly");
    await user.clear(field);
    await user.type(field, "Europe/Lisbon");
    expect(field).toHaveValue("Europe/Lisbon");
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        new URL(String(input), "http://localhost").pathname === "/v1/timezone-lookup"
      ),
    ).toHaveLength(0);
  });

  it("still lets the user continue when the lookup cannot be reached", async () => {
    const user = userEvent.setup();
    mockLookup("unreachable");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding onSubmit={onSubmit} />);

    await reachLocationStep(user);
    await user.type(screen.getByLabelText("Latitude"), "34.0522");
    await user.type(screen.getByLabelText("Longitude"), "-118.2437");

    await waitFor(() =>
      expect(screen.getByText(/could not be reached/i)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /allow Pattern\/Like to encrypt these details/i }),
    );
    await user.click(screen.getByRole("button", { name: /Create my chart/i }));

    // The server resolves from the same coordinates, so a failed preview costs
    // the confirmation, not the chart.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        birthplace: expect.objectContaining({ latitude: 34.0522, longitude: -118.2437 }),
      }),
      expect.stringMatching(/^web-birth-/),
    );
  });
});

describe("chart correction", () => {
  it("says the form cannot replay stored birth details", () => {
    render(<Onboarding mode="correct" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /Replace what the chart is built from/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/form starts empty/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fill local example/i })).not.toBeInTheDocument();
  });

  it("returns to the chart the reader already has", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Onboarding mode="correct" onSubmit={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("posts a replacement rather than a first chart", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding mode="correct" onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Birth date"), "1985-11-02");
    await user.type(screen.getByLabelText("Local time"), "12:34:00");
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(screen.getByRole("button", { name: /Continue/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /allow Pattern\/Like to encrypt these details/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Replace my chart/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracy: "exact",
        birth_date: "1985-11-02",
      }),
      expect.stringMatching(/^web-birth-/),
    );
  });
});
