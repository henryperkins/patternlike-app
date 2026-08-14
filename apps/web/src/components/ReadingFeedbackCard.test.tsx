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
    expect(screen.queryByText("USR-12")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".reading-feedback__options svg")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Send this/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("radio", { name: "This helped" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Send this/i }));

    const [write] = capturedFor(PATH).filter((call) => call.method === "POST");
    expect(write!.body).toEqual({ resonance: "helpful", note: null });
    expect(write!.headers.get("idempotency-key")).toMatch(/^web-reading-feedback-/);
    expect(
      await screen.findByText(/Noted — this helped/i),
    ).toBeInTheDocument();
  });

  it("keeps the optional note behind a second ask", async () => {
    const user = userEvent.setup();
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`POST ${PATH}`]: ok(
        { id: "rfb_web_test_0002", reading_id: READING_ID, created_at: "2026-08-14T12:00:00Z" },
        201,
      ),
    });

    render(<ReadingFeedbackCard readingId={READING_ID} />);
    await user.click(await screen.findByRole("radio", { name: "Mixed" }));
    await user.click(screen.getByRole("button", { name: /A sentence, if you want/i }));
    await user.type(
      screen.getByRole("textbox", { name: /A sentence, if you want/i }),
      "Too sharp on work.",
    );
    await user.click(screen.getByRole("button", { name: /Send this/i }));

    const [write] = capturedFor(PATH).filter((call) => call.method === "POST");
    expect(write!.body).toEqual({
      resonance: "neutral",
      note: "Too sharp on work.",
    });
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
      await screen.findByText(/Noted — not quite/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send this/i })).not.toBeInTheDocument();
  });
});
