import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReadingFeedbackCard } from "./ReadingFeedbackCard.js";
import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { READING_ID, errorBody } from "../test/reading-fixture.js";

const PATH = `/v1/readings/${READING_ID}/feedback`;
const ok = (body: unknown, status = 200): MockResponse => ({ status, body });

describe("Reading feedback", () => {
  it("saves a resonance choice against the reading on screen", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`POST ${PATH}`]: ok(
        { id: "rfb_web_test_0001", reading_id: READING_ID, created_at: "2026-08-14T12:00:00Z" },
        201,
      ),
    });

    render(<ReadingFeedbackCard readingId={READING_ID} />);
    await user.click(await screen.findByRole("radio", { name: "This helped" }));
    await user.click(screen.getByRole("button", { name: /Save feedback/i }));

    const [write] = capturedFor(PATH).filter((call) => call.method === "POST");
    expect(write!.body).toEqual({ resonance: "helpful", note: null });
    expect(write!.headers.get("idempotency-key")).toMatch(/^web-reading-feedback-/);
    expect(
      await screen.findByText(/You marked this reading as this helped/i),
    ).toBeInTheDocument();
  });

  it("shows a previous choice instead of asking again", async () => {
    mockApiResponses({
      [`GET ${PATH}`]: ok({
        id: "rfb_web_test_0001",
        reading_id: READING_ID,
        resonance: "not_helpful",
        relevance_labels: [],
        created_at: "2026-08-14T12:00:00Z",
      }),
    });

    render(<ReadingFeedbackCard readingId={READING_ID} />);
    expect(
      await screen.findByText(/You marked this reading as not helpful/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save feedback/i })).not.toBeInTheDocument();
  });
});
