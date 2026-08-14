import { render, screen, within } from "@testing-library/react";
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

const CONSENT = "/v1/consents/ai-synthesis";
const TOPICS = "/v1/preferences/topic-exclusions";

const ok = (body: unknown): MockResponse => ({ status: 200, body });

const emptyTopics = ok({
  schema_version: "0.2.0",
  excluded_topics: [],
  updated_at: null,
});

function renderPrivacy(responses: Record<string, MockResponse>) {
  if (!(`GET ${TOPICS}` in responses) && !(TOPICS in responses)) {
    responses[`GET ${TOPICS}`] = emptyTopics;
  }
  mockApiResponses(responses);
  return render(
    <PrivacyView
      hasChart
      onSignOut={() => undefined}
      onDeletionAccepted={() => undefined}
    />,
  );
}

function consentPanel(): HTMLElement {
  return screen.getByRole("region", { name: /Who writes your reading/i });
}

describe("Context & privacy", () => {
  it("shows the server's own provider, purpose, policy, and category list", async () => {
    renderPrivacy({ [`GET ${CONSENT}`]: ok(consentNotGranted) });

    const panel = consentPanel();
    expect(await within(panel).findByText("OpenAI")).toBeInTheDocument();
    expect(within(panel).getByText(/Writing your daily reading/i)).toBeInTheDocument();
    expect(within(panel).getByText("v1.0.0")).toBeInTheDocument();

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
    expect(within(panel).getByText(/not zero retention/i)).toBeInTheDocument();
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
    mockApiResponses({ [`GET ${CONSENT}`]: ok(consentGranted) });
    const { rerender } = render(
      <PrivacyView
        hasChart
        onSignOut={() => undefined}
        onDeletionAccepted={() => undefined}
        onCorrectBirth={onCorrectBirth}
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
    });
    render(
      <PrivacyView
        hasChart
        onSignOut={onSignOut}
        onDeletionAccepted={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sign out/i }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
