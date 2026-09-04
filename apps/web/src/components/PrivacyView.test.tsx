import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PrivacyView } from "./PrivacyView.js";
import { aiConsentCategoryLabel } from "../lib/reading-format.js";
import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import {
  consentGranted,
  consentNotGranted,
  errorBody,
} from "../test/reading-fixture.js";
import {
  ACCOUNT_PROCESSING_CONSENT_PATH,
  accountProcessingGranted,
  accountProcessingNotGranted,
  accountProcessingRevokedFreeze,
} from "../test/account-processing-fixture.js";
import {
  GEOCODER_CONSENT_PATH,
  geocoderGranted,
  geocoderGrantedFromPrivacy,
  geocoderNotGranted,
} from "../test/geocoder-consent-fixture.js";

const CONSENT = "/v1/consents/ai-synthesis";
const TOPICS = "/v1/preferences/topic-exclusions";

const ok = (body: unknown): MockResponse => ({ status: 200, body });

const emptyTopics = ok({
  schema_version: "0.2.0",
  excluded_topics: [],
  updated_at: null,
});

function renderPrivacy(
  responses: Record<string, MockResponse>,
  onProcessingFrozen = vi.fn(),
) {
  if (!(`GET ${TOPICS}` in responses) && !(TOPICS in responses)) {
    responses[`GET ${TOPICS}`] = emptyTopics;
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
        policy_version: "1.0.0",
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
    !(`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}` in responses) &&
    !(ACCOUNT_PROCESSING_CONSENT_PATH in responses)
  ) {
    responses[`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`] = ok(
      accountProcessingNotGranted,
    );
  }
  if (
    !(`GET ${GEOCODER_CONSENT_PATH}` in responses) &&
    !(GEOCODER_CONSENT_PATH in responses)
  ) {
    responses[`GET ${GEOCODER_CONSENT_PATH}`] = ok(geocoderNotGranted);
  }
  mockApiResponses(responses);
  return render(
    <PrivacyView
      hasChart
      onSignOut={() => undefined}
      onDeletionAccepted={() => undefined}
      onProcessingFrozen={onProcessingFrozen}
    />,
  );
}

function consentPanel(): HTMLElement {
  return screen.getByRole("region", { name: /Who writes your reading/i });
}

function processingPanel(): HTMLElement {
  return screen.getByRole("region", { name: /Birth calculation permission/i });
}

function geocoderPanel(): HTMLElement {
  return screen.getByRole("region", { name: /Geoapify birthplace search/i });
}

describe("Context & privacy", () => {
  it("shows the server's own provider, purpose, policy, and category list", async () => {
    renderPrivacy({ [`GET ${CONSENT}`]: ok(consentNotGranted) });

    const panel = consentPanel();
    expect(await within(panel).findByText("OpenAI")).toBeInTheDocument();
    expect(within(panel).getByText(/Writing your daily reading/i)).toBeInTheDocument();
    expect(within(panel).getByText(`v${consentNotGranted.policy_version}`)).toBeInTheDocument();

    const listed = [...panel.querySelectorAll(".ai-consent-categories li")].map(
      (item) => item.textContent,
    );
    expect(listed).toEqual(consentNotGranted.enabled_categories.map(aiConsentCategoryLabel));
  });

  it("carries the same qualifications the Today gate states", async () => {
    renderPrivacy({ [`GET ${CONSENT}`]: ok(consentNotGranted) });
    const panel = consentPanel();
    await within(panel).findByText("OpenAI");

    expect(within(panel).getByText(/not consent to train a model/i)).toBeInTheDocument();
    expect(within(panel).getByText(/can name people and places/i)).toBeInTheDocument();
    expect(within(panel).getByText(/governed by the agreement and settings/i)).toBeInTheDocument();
    // The details surface does not link to itself.
    expect(
      within(panel).queryByRole("link", { name: /full privacy details/i }),
    ).not.toBeInTheDocument();
  });

  it("grants from the keyboard, echoing the displayed policy version", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [`GET ${CONSENT}`]: ok(consentNotGranted),
      [`PUT ${CONSENT}`]: ok(consentGranted),
    };
    renderPrivacy(responses);

    const grant = await screen.findByRole("button", { name: /Grant permission/i });
    grant.focus();
    await user.keyboard("{Enter}");

    const [request] = capturedFor(CONSENT).filter((call) => call.method === "PUT");
    expect(request!.body).toEqual({ policy_version: consentNotGranted.policy_version });
    expect(request!.headers.get("idempotency-key")).toMatch(/^web-ai-synthesis-/);

    // The control becomes its own inverse rather than disappearing, so focus
    // stays where the reader put it.
    expect(
      await screen.findByRole("button", { name: /Withdraw permission/i }),
    ).toBeInTheDocument();
    expect(within(consentPanel()).getByText("Granted")).toBeInTheDocument();
  });

  it("withdraws with an empty DELETE and reports the new state", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`DELETE ${CONSENT}`]: ok(consentNotGranted),
    });

    await user.click(await screen.findByRole("button", { name: /Withdraw permission/i }));

    const [request] = capturedFor(CONSENT).filter((call) => call.method === "DELETE");
    expect(request!.body).toBeNull();
    expect(request!.headers.get("idempotency-key")).toMatch(/^web-ai-synthesis-/);

    expect(
      await screen.findByRole("button", { name: /Grant permission/i }),
    ).toBeInTheDocument();
    expect(within(consentPanel()).getByText("Not granted")).toBeInTheDocument();
  });

  it("says when the permission was granted", async () => {
    renderPrivacy({ [`GET ${CONSENT}`]: ok(consentGranted) });

    expect(await screen.findByText(/^Granted /)).toBeInTheDocument();
  });

  it("announces a refused mutation instead of claiming it worked", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentNotGranted),
      [`PUT ${CONSENT}`]: {
        status: 409,
        body: errorBody("consent_conflict", "The consent state changed concurrently; retry the request"),
      },
    });

    await user.click(await screen.findByRole("button", { name: /Grant permission/i }));

    const status = within(consentPanel()).getByRole("status");
    expect(status).toHaveTextContent(/changed concurrently/i);
    expect(status).toHaveTextContent("req_consent_conflict");
    // Still not granted: the failed write did not move the displayed state.
    expect(screen.getByRole("button", { name: /Grant permission/i })).toBeInTheDocument();
  });

  it("says Unknown rather than Not granted when the permission cannot be read", async () => {
    // The privacy surface is exactly where a definite claim about an unknown
    // state does not belong: a reader whose consent IS granted, opening this
    // page offline, was told in the product's own words that nothing is being
    // sent to OpenAI.
    renderPrivacy({
      [`GET ${CONSENT}`]: { status: 0, body: null, unreachable: true },
    });

    const panel = consentPanel();
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      /could not be reached/i,
    );
    expect(within(panel).getByText("Unknown")).toBeInTheDocument();
    expect(within(panel).queryByText("Not granted")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Granted")).not.toBeInTheDocument();
    // Nothing to agree to, but the read is worth retrying.
    expect(
      within(panel).queryByRole("button", { name: /permission/i }),
    ).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("recovers the panel when the retry succeeds", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [`GET ${CONSENT}`]: { status: 0, body: null, unreachable: true },
    };
    renderPrivacy(responses);
    const retry = await within(consentPanel()).findByRole("button", { name: /Try again/i });

    responses[`GET ${CONSENT}`] = ok(consentGranted);
    await user.click(retry);

    expect(
      await screen.findByRole("button", { name: /Withdraw permission/i }),
    ).toBeInTheDocument();
    expect(within(consentPanel()).getByText("Granted")).toBeInTheDocument();
  });

  it("grants Geoapify birthplace search from Privacy under the privacy_center surface", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`GET ${GEOCODER_CONSENT_PATH}`]: ok(geocoderNotGranted),
      [`PUT ${GEOCODER_CONSENT_PATH}`]: ok(geocoderGrantedFromPrivacy),
    });

    const panel = geocoderPanel();
    expect(await within(panel).findByText("Not granted")).toBeInTheDocument();
    expect(within(panel).getByText(geocoderNotGranted.disclosure.text)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Geoapify privacy" })).toHaveAttribute(
      "href",
      geocoderNotGranted.disclosure.links.geoapify_privacy,
    );

    await user.click(
      within(panel).getByRole("button", { name: /Grant Geoapify search permission/i }),
    );

    const [request] = capturedFor(GEOCODER_CONSENT_PATH).filter((call) => call.method === "PUT");
    expect(request!.body).toEqual({ policy_version: geocoderNotGranted.policy_version });
    expect(request!.headers.get("x-consent-ui-surface")).toBe("privacy_center");
    expect(request!.headers.get("idempotency-key")).toMatch(/^web-geocoder-consent-/);

    // The control becomes its own inverse rather than disappearing.
    expect(
      await within(panel).findByRole("button", { name: /Withdraw Geoapify search permission/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Granted")).toBeInTheDocument();
    expect(within(panel).getByText(/^Granted .+\.$/)).toBeInTheDocument();
  });

  it("keeps the Geoapify grant offered and says why when the search is not enabled", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`PUT ${GEOCODER_CONSENT_PATH}`]: {
        status: 503,
        body: errorBody("geocoder_unavailable", "Place search is unavailable"),
      },
    });

    const panel = geocoderPanel();
    await user.click(
      await within(panel).findByRole("button", { name: /Grant Geoapify search permission/i }),
    );

    const status = await within(panel).findByText(/not available yet/i);
    expect(status).toHaveTextContent("enter the place, coordinates, and time zone by hand");
    expect(status).toHaveTextContent("Request req_geocoder_unavailable");
    expect(
      within(panel).getByRole("button", { name: /Grant Geoapify search permission/i }),
    ).toBeEnabled();
    expect(within(panel).getByText("Not granted")).toBeInTheDocument();
    expect(capturedFor(GEOCODER_CONSENT_PATH).filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("re-reads the Geoapify search terms when the grant names a stale policy", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`PUT ${GEOCODER_CONSENT_PATH}`]: {
        status: 409,
        body: errorBody(
          "consent_policy_version_stale",
          "Re-read the current geocoder policy and grant again",
        ),
      },
    });

    const panel = geocoderPanel();
    await user.click(
      await within(panel).findByRole("button", { name: /Grant Geoapify search permission/i }),
    );

    expect(await within(panel).findByText(/terms changed since this page was read/i))
      .toHaveTextContent("Request req_consent_policy_version_stale");
    await waitFor(() => {
      expect(
        capturedFor(GEOCODER_CONSENT_PATH).filter((call) => call.method === "GET"),
      ).toHaveLength(2);
    });
    expect(
      await within(panel).findByRole("button", { name: /Grant Geoapify search permission/i }),
    ).toBeEnabled();
  });

  it("withdraws Geoapify birthplace search from Privacy with an empty DELETE", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`GET ${GEOCODER_CONSENT_PATH}`]: ok(geocoderGranted),
      [`DELETE ${GEOCODER_CONSENT_PATH}`]: ok(geocoderNotGranted),
    });

    const panel = geocoderPanel();
    expect(await within(panel).findByText("Granted")).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /Grant Geoapify search permission/i }),
    ).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: /Withdraw Geoapify search permission/i }),
    );

    const [request] = capturedFor(GEOCODER_CONSENT_PATH).filter(
      (call) => call.method === "DELETE",
    );
    expect(request!.body).toBeNull();
    expect(request!.headers.get("x-consent-ui-surface")).toBe("privacy_center");
    expect(request!.headers.get("idempotency-key")).toMatch(/^web-geocoder-consent-/);

    expect(
      await within(panel).findByRole("button", { name: /Grant Geoapify search permission/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Not granted")).toBeInTheDocument();
  });

  it("says Unknown for Geoapify search when the permission cannot be read", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const responses: Record<string, MockResponse> = {};
    Object.defineProperty(responses, `GET ${GEOCODER_CONSENT_PATH}`, {
      enumerable: true,
      get: (): MockResponse =>
        reads++ === 0
          ? { status: 500, body: errorBody("internal_error", "The read failed") }
          : ok(geocoderNotGranted),
    });
    renderPrivacy(responses);

    const panel = geocoderPanel();
    expect(await within(panel).findByText("Unknown")).toBeInTheDocument();
    expect(within(panel).getByText(/The read failed/)).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /Geoapify search permission/i }),
    ).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: /Try again/i }));
    expect(
      await within(panel).findByRole("button", { name: /Grant Geoapify search permission/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Not granted")).toBeInTheDocument();
  });

  it("reports granted, not-granted, and unknown processing states honestly", async () => {
    const { unmount } = renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(accountProcessingGranted),
    });

    expect(await within(processingPanel()).findByText("Granted")).toBeInTheDocument();
    expect(
      within(processingPanel()).getByRole("button", {
        name: /Withdraw calculation permission/i,
      }),
    ).toBeInTheDocument();

    unmount();

    mockApiResponses({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${TOPICS}`]: emptyTopics,
      "GET /v1/consents/pattern-generation": ok({
        schema_version: "0.7.0",
        kind: "pattern_generation",
        status: "not_granted",
        provider: "OpenAI",
        purpose: "one_pattern_per_chart",
        policy_version: "1.0.0",
        enabled_categories: [],
        granted_at: null,
      }),
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(accountProcessingNotGranted),
    });
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(accountProcessingNotGranted),
    });
    expect(await within(processingPanel()).findByText("Not granted"))
      .toBeInTheDocument();
  });

  it("uses Unknown when processing consent cannot be read", async () => {
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: {
        status: 0,
        body: null,
        unreachable: true,
      },
    });

    const panel = processingPanel();
    expect(await within(panel).findByText("Unknown")).toBeInTheDocument();
    expect(within(panel).queryByText("Not granted")).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", {
        name: /Withdraw calculation permission/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("requires explicit freeze confirmation and enters frozen state immediately", async () => {
    const user = userEvent.setup();
    const onProcessingFrozen = vi.fn();
    renderPrivacy(
      {
        [`GET ${CONSENT}`]: ok(consentGranted),
        [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(accountProcessingGranted),
        [`DELETE ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(
          accountProcessingRevokedFreeze,
        ),
      },
      onProcessingFrozen,
    );

    const panel = processingPanel();
    await user.click(
      await within(panel).findByRole("button", {
        name: /Withdraw calculation permission/i,
      }),
    );
    expect(capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH)).toHaveLength(1);
    expect(within(panel).getByText(/freeze this account/i)).toBeInTheDocument();
    const confirm = within(panel).getByRole("checkbox", {
      name: /understand.*retained data.*stop being served/i,
    });
    const freeze = within(panel).getByRole("button", { name: /Freeze account/i });
    expect(freeze).toBeDisabled();
    await user.click(confirm);
    await user.click(freeze);

    await waitFor(() => expect(onProcessingFrozen).toHaveBeenCalledOnce());
    const revoke = capturedFor(ACCOUNT_PROCESSING_CONSENT_PATH).at(-1)!;
    expect(revoke.method).toBe("DELETE");
    expect(revoke.body).toBeNull();
    expect(revoke.headers.get("x-consent-ui-surface")).toBe("privacy_center");
    expect(revoke.headers.get("idempotency-key")).toMatch(
      /^web-account-processing-/,
    );
  });

  it("moves keyboard focus into freeze confirmation and restores it on cancel", async () => {
    const user = userEvent.setup();
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${ACCOUNT_PROCESSING_CONSENT_PATH}`]: ok(accountProcessingGranted),
    });

    const panel = processingPanel();
    const withdraw = await within(panel).findByRole("button", {
      name: /Withdraw calculation permission/i,
    });
    withdraw.focus();
    await user.keyboard("{Enter}");
    const confirmation = within(panel).getByRole("checkbox", {
      name: /understand.*retained data.*stop being served/i,
    });
    expect(document.activeElement).toBe(confirmation);

    await user.click(within(panel).getByRole("button", { name: /Cancel/i }));
    expect(document.activeElement).toBe(
      within(panel).getByRole("button", {
        name: /Withdraw calculation permission/i,
      }),
    );
  });

  it("shows the live daily check-in source without inventing external connectors", async () => {
    renderPrivacy({
      [`GET ${CONSENT}`]: ok(consentGranted),
      "GET /v1/context-sources": ok({
        schema_version: "0.2.0",
        user_id: "usr_test_0001",
        sources: [{
          schema_version: "0.2.0",
          user_id: "usr_test_0001",
          source_id: "USR-06",
          enabled: true,
          permission_state: "active",
          allowed_uses: ["theme_ranking", "tone"],
          permission_tier: 1,
          consent_id: "cns_usr06_0001",
          freshness: null,
          last_signal_id: null,
          scopes: [],
          connector_status: "not_applicable",
          updated_at: "2026-08-13T12:00:00.000Z",
        }],
        updated_at: "2026-08-13T12:00:00.000Z",
      }),
    });

    const checkIn = await screen.findByRole("article", { name: /Daily check-in/i });
    expect(within(checkIn).getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(within(checkIn).getByRole("button", { name: "Revoke" })).toBeEnabled();

    const unavailable = screen.getByText("Calendar, health, and device data")
      .closest(".source-row");
    expect(within(unavailable as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(within(unavailable as HTMLElement).getByText("Unavailable")).toBeInTheDocument();
  });

  it("keeps the export and deletion controls untouched", async () => {
    renderPrivacy({ [`GET ${CONSENT}`]: ok(consentGranted) });
    await screen.findByRole("button", { name: /Withdraw permission/i });

    expect(screen.getByRole("button", { name: /Request export/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Delete account/i })).toBeEnabled();
  });

  it("offers chart correction only when a chart exists", async () => {
    const onCorrectBirth = vi.fn();
    mockApiResponses({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${TOPICS}`]: emptyTopics,
      [`GET /v1/consents/pattern-generation`]: {
        status: 200,
        body: {
          schema_version: "0.7.0",
          kind: "pattern_generation",
          status: "not_granted",
          provider: "OpenAI",
          purpose: "one_pattern_per_chart",
          policy_version: "1.0.0",
          enabled_categories: [],
          granted_at: null,
        },
      },
    });
    const { rerender } = render(
      <PrivacyView
        hasChart
        onSignOut={() => undefined}
        onDeletionAccepted={() => undefined}
        onCorrectBirth={onCorrectBirth}
        onProcessingFrozen={() => undefined}
      />,
    );

    const birth = await screen.findByRole("article", { name: /Birth details/i });
    const user = userEvent.setup();
    await user.click(within(birth).getByRole("button", { name: /Correct/i }));
    expect(onCorrectBirth).toHaveBeenCalledOnce();

    rerender(
      <PrivacyView
        hasChart={false}
        onSignOut={() => undefined}
        onDeletionAccepted={() => undefined}
        onCorrectBirth={onCorrectBirth}
        onProcessingFrozen={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /Correct/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: /Birth details/i })).getByText("Account data"))
      .toBeInTheDocument();
  });

  it("offers sign out with the other account controls", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    mockApiResponses({
      [`GET ${CONSENT}`]: ok(consentGranted),
      [`GET ${TOPICS}`]: emptyTopics,
      [`GET /v1/consents/pattern-generation`]: {
        status: 200,
        body: {
          schema_version: "0.7.0",
          kind: "pattern_generation",
          status: "not_granted",
          provider: "OpenAI",
          purpose: "one_pattern_per_chart",
          policy_version: "1.0.0",
          enabled_categories: [],
          granted_at: null,
        },
      },
    });
    render(
      <PrivacyView
        hasChart
        onSignOut={onSignOut}
        onDeletionAccepted={() => undefined}
        onProcessingFrozen={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sign out/i }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
