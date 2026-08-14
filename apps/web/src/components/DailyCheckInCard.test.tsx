import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { consentGranted, consentNotGranted } from "../test/reading-fixture.js";
import { DailyCheckInCard } from "./DailyCheckInCard.js";

const SOURCES = "/v1/context-sources";
const CHECK_INS = "/v1/check-ins";
const CONSENT = "/v1/consents/ai-synthesis";

function sourceDocument(state: "active" | "paused") {
  const updatedAt = "2026-08-13T12:00:00.000Z";
  return {
    schema_version: "0.2.0",
    user_id: "usr_test_0001",
    sources: [{
      schema_version: "0.2.0",
      user_id: "usr_test_0001",
      source_id: "USR-06",
      enabled: state === "active",
      permission_state: state,
      allowed_uses: ["theme_ranking", "tone", "reflection_prompt"],
      permission_tier: 1,
      consent_id: "cns_usr06_0001",
      freshness: null,
      last_signal_id: null,
      scopes: [],
      connector_status: "not_applicable",
      updated_at: updatedAt,
    }],
    updated_at: updatedAt,
  };
}

function signal(energy: "low" | "medium" | "high") {
  return {
    schema_version: "0.2.0",
    id: "ctx_checkin_0001",
    user_id: "usr_test_0001",
    source_id: "USR-06",
    source_window: "2026-08-13",
    evidence_lane: "user_and_context",
    allowed_uses: ["theme_ranking", "tone", "reflection_prompt"],
    permission_state: "active",
    conflict_status: "none",
    freshness: {
      status: "fresh",
      observed_at: "2026-08-13T12:30:00.000Z",
      ingested_at: "2026-08-13T12:30:00.000Z",
      expires_at: "2026-08-14T12:30:00.000Z",
      max_age_seconds: 86400,
      age_seconds: 0,
    },
    value: {
      encoding: "structured",
      structured: {
        energy,
        pressure: null,
        clarity: null,
        connection: null,
        focus_domain: null,
        note: null,
      },
    },
    supersedes_signal_id: null,
    normalized_hash: `sha256:${"a".repeat(64)}`,
  };
}

describe("daily check-in card", () => {
  it("links to Privacy instead of granting an inactive source implicitly", async () => {
    mockApiResponses({
      [`GET ${SOURCES}`]: { status: 200, body: sourceDocument("paused") },
      [`GET ${CONSENT}`]: { status: 200, body: consentGranted },
    });

    render(<DailyCheckInCard />);

    const link = await screen.findByRole("link", { name: /Open check-in permission/i });
    expect(link).toHaveAttribute("href", "#privacy");
    expect(screen.queryByRole("button", { name: /Keep this/i })).not.toBeInTheDocument();
    expect(capturedFor(CHECK_INS)).toHaveLength(0);
  });

  it("keeps the five-second path compact and sends the 24-hour default", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${SOURCES}`]: { status: 200, body: sourceDocument("active") },
      [`GET ${CONSENT}`]: { status: 200, body: consentGranted },
      [`POST ${CHECK_INS}`]: { status: 201, body: signal("high") },
    });

    render(<DailyCheckInCard />);
    expect(await screen.findByText(/One mark is enough/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("radio", { name: /Full/i }));
    expect(screen.queryByLabelText("Pressure")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Keep this/i }));

    expect(capturedFor(CHECK_INS)[0]!.body).toEqual({
      energy: "high",
      expires_in_seconds: 86400,
    });
    expect(capturedFor(CHECK_INS)[0]!.headers.get("idempotency-key"))
      .toMatch(/^web-check-in-/);
    expect(await screen.findByText(/Held until/i)).toBeInTheDocument();
    expect(screen.getByText(/The next reading can use this/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Today's chapter stays as it is/i))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("preserves expanded values and one idempotency key across a safe conflict", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [`GET ${SOURCES}`]: { status: 200, body: sourceDocument("active") },
      [`GET ${CONSENT}`]: { status: 200, body: consentNotGranted },
      [`POST ${CHECK_INS}`]: {
        status: 409,
        body: {
          error: {
            code: "consent_conflict",
            message: "Check-in permission changed; review it and retry",
            request_id: "req_checkin_conflict",
          },
        },
      },
    };
    mockApiResponses(responses);

    render(<DailyCheckInCard />);
    await user.click(await screen.findByRole("radio", { name: /Steady/i }));
    await user.click(screen.getByRole("button", { name: /Say a little more/i }));
    await user.selectOptions(screen.getByLabelText(/Pressure/i), "high");
    await user.type(screen.getByRole("textbox", { name: /Focus/i }), "Work transition");
    await user.type(screen.getByRole("textbox", { name: /Note/i }), "Waiting on a decision.");
    await user.click(screen.getByRole("button", { name: /Keep this/i }));

    expect(await screen.findByRole("status", { name: /Check-in status/i }))
      .toHaveTextContent("req_checkin_conflict");
    expect(screen.getByRole("textbox", { name: /Focus/i })).toHaveValue("Work transition");
    expect(screen.getByRole("textbox", { name: /Note/i })).toHaveValue("Waiting on a decision.");

    responses[`POST ${CHECK_INS}`] = { status: 201, body: signal("medium") };
    await user.click(screen.getByRole("button", { name: /Keep this/i }));

    const writes = capturedFor(CHECK_INS);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.headers.get("idempotency-key"))
      .toBe(writes[1]!.headers.get("idempotency-key"));
    expect(writes[0]!.body).toEqual({
      energy: "medium",
      pressure: "high",
      focus_domain: "Work transition",
      note: "Waiting on a decision.",
      expires_in_seconds: 86400,
    });
    expect(await screen.findByText(/kept from the publisher/i)).toBeInTheDocument();
    expect(screen.getByText(/Today's chapter stays as it is/i))
      .toBeInTheDocument();
  });
});
