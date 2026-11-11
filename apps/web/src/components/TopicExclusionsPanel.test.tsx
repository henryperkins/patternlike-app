import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EXCLUDABLE_LIFE_DOMAINS } from "@patternlike/shared";
import { TopicExclusionsPanel } from "./TopicExclusionsPanel.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";

const PATH = "/v1/preferences/topic-exclusions";

describe("Topic exclusions", () => {
  it("saves the named domains the reader does not want interpreted", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${PATH}`]: {
        status: 200,
        body: { schema_version: "0.2.0", excluded_topics: [], updated_at: null },
      },
      [`PUT ${PATH}`]: {
        status: 200,
        body: {
          schema_version: "0.2.0",
          excluded_topics: ["relationships", "work"],
          updated_at: "2026-08-14T12:00:00Z",
        },
      },
    });

    render(<TopicExclusionsPanel />);
    expect(await screen.findAllByRole("checkbox")).toHaveLength(EXCLUDABLE_LIFE_DOMAINS.length);
    await user.click(await screen.findByRole("checkbox", { name: "Relationships" }));
    await user.click(screen.getByRole("checkbox", { name: "Work" }));
    await user.click(screen.getByRole("button", { name: /Save exclusions/i }));

    const [write] = capturedFor(PATH).filter((call) => call.method === "PUT");
    expect(write!.body).toEqual({ excluded_topics: ["relationships", "work"] });
    expect(write!.headers.get("idempotency-key")).toMatch(/^web-topic-exclusions-/);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("does not offer save when the exclusion list could not be read", async () => {
    mockApiResponses({
      [`GET ${PATH}`]: {
        status: 503,
        body: {
          error: {
            code: "unavailable",
            message: "Topic exclusions could not be read.",
            request_id: "req_topics_load",
          },
        },
      },
    });

    render(<TopicExclusionsPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be read/i);
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save exclusions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(capturedFor(PATH).filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("saves only the list loaded after a failed read is retried", async () => {
    const user = userEvent.setup();
    const responses: Record<string, { status: number; body: unknown }> = {
      [`GET ${PATH}`]: {
        status: 503,
        body: {
          error: {
            code: "unavailable",
            message: "Topic exclusions could not be read.",
            request_id: "req_topics_load",
          },
        },
      },
    };
    mockApiResponses(responses);

    render(<TopicExclusionsPanel />);
    expect(await screen.findByRole("button", { name: /Try again/i })).toBeInTheDocument();

    responses[`GET ${PATH}`] = {
      status: 200,
      body: {
        schema_version: "0.2.0",
        excluded_topics: ["work"],
        updated_at: "2026-08-14T12:00:00Z",
      },
    };
    responses[`PUT ${PATH}`] = {
      status: 200,
      body: {
        schema_version: "0.2.0",
        excluded_topics: ["work", "home"],
        updated_at: "2026-08-14T12:05:00Z",
      },
    };
    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByRole("checkbox", { name: "Work" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Home" }));
    await user.click(screen.getByRole("button", { name: /Save exclusions/i }));

    const [write] = capturedFor(PATH).filter((call) => call.method === "PUT");
    expect(write!.body).toEqual({ excluded_topics: ["work", "home"] });
  });
});
