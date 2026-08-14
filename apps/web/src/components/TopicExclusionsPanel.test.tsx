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
});
