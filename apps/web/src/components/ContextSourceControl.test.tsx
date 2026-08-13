import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { ContextSourceControl } from "./ContextSourceControl.js";

const PATH = "/v1/context-sources";
const uses = ["theme_ranking", "tone", "reflection_prompt", "notification_timing"];

function sourceDocument(state: "active" | "paused" | "revoked" | "never_granted") {
  const enabled = state === "active";
  const updated = "2026-08-13T12:00:00.000Z";
  return {
    schema_version: "0.2.0" as const,
    user_id: "usr_test_0001",
    sources: [{
      schema_version: "0.2.0" as const,
      user_id: "usr_test_0001",
      source_id: "USR-06" as const,
      enabled,
      permission_state: state,
      allowed_uses: state === "never_granted" ? [] : uses,
      permission_tier: 1 as const,
      consent_id: state === "never_granted" ? null : "cns_usr06_0001",
      freshness: null,
      last_signal_id: null,
      scopes: [],
      connector_status: "not_applicable" as const,
      updated_at: updated,
    }] as const,
    updated_at: updated,
  };
}

describe("Daily check-in source control", () => {
  it("enables the synthetic source with the exact whole document", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [`GET ${PATH}`]: { status: 200, body: sourceDocument("never_granted") },
      [`PUT ${PATH}`]: { status: 200, body: sourceDocument("active") },
    };
    mockApiResponses(responses);
    render(<ContextSourceControl />);

    const row = await screen.findByRole("article", { name: /Daily check-in/i });
    expect(within(row).getByText("Not enabled")).toBeInTheDocument();
    const enable = within(row).getByRole("button", { name: "Enable" });
    enable.focus();
    await user.keyboard("{Enter}");

    const request = capturedFor(PATH).find((call) => call.method === "PUT")!;
    expect(request.body).toMatchObject({
      user_id: "usr_test_0001",
      sources: [{
        source_id: "USR-06",
        enabled: true,
        permission_state: "active",
        allowed_uses: [],
      }],
    });
    expect(request.headers.get("idempotency-key")).toMatch(/^web-context-source-/);
    expect(await within(row).findByText("Active")).toBeInTheDocument();
    expect(within(row).getByText(/Rank eligible themes/i)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(row).getByRole("button", { name: "Pause" }));
  });

  it("offers pause, resume, and revoke as distinct transitions", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [`GET ${PATH}`]: { status: 200, body: sourceDocument("active") },
      [`PUT ${PATH}`]: { status: 200, body: sourceDocument("paused") },
    };
    mockApiResponses(responses);
    render(<ContextSourceControl />);
    const row = await screen.findByRole("article", { name: /Daily check-in/i });

    expect(within(row).getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Revoke" })).toBeEnabled();
    await user.click(within(row).getByRole("button", { name: "Pause" }));
    expect(await within(row).findByText("Paused")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Resume" })).toBeEnabled();

    responses[`PUT ${PATH}`] = { status: 200, body: sourceDocument("active") };
    await user.click(within(row).getByRole("button", { name: "Resume" }));
    responses[`PUT ${PATH}`] = { status: 200, body: sourceDocument("revoked") };
    await user.click(await within(row).findByRole("button", { name: "Revoke" }));

    expect(await within(row).findByText("Revoked")).toBeInTheDocument();
    expect(within(row).getByText(/future use stops immediately/i)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Enable" })).toBeEnabled();
  });

  it("keeps the known state and announces a failed transition with its request id", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${PATH}`]: { status: 200, body: sourceDocument("active") },
      [`PUT ${PATH}`]: {
        status: 409,
        body: {
          error: {
            code: "consent_conflict",
            message: "The source state changed; reload it",
            request_id: "req_source_conflict",
          },
        },
      },
    });
    render(<ContextSourceControl />);
    const row = await screen.findByRole("article", { name: /Daily check-in/i });
    await user.click(within(row).getByRole("button", { name: "Pause" }));

    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByRole("status")).toHaveTextContent("req_source_conflict");
  });
});
