import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReadingFeedbackCard } from "./ReadingFeedbackCard.js";
import { capturedFor, deferred, mockApiResponses, type MockResponse } from "../test/api-mock.js";
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
    expect(screen.getByRole("status", { name: "Feedback receipt" }))
      .toHaveTextContent("Recorded for this chapter");
    expect(screen.getByText(/does not establish that a later reading used it/i)).toBeInTheDocument();
    expect(screen.getByText(/notes are not used to write readings/i)).toBeInTheDocument();
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
    expect(screen.getByText(/with active feedback permission/i)).toBeInTheDocument();
  });

  it("keeps labels bound to the visible feedback when a source reading remains mounted", async () => {
    const user = userEvent.setup();
    const nextReadingId = "rdg_feedback_000000000002";
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`GET /v1/readings/${nextReadingId}/feedback`]: {
        status: 404, body: errorBody("feedback_not_found", "No feedback"),
      },
    });
    const { container } = render(<>
      <div hidden><ReadingFeedbackCard readingId={READING_ID} /></div>
      <ReadingFeedbackCard readingId={nextReadingId} />
    </>);
    const feedback = within(screen.getByRole("region", { name: "Did this meet you?" }));
    await user.click(feedback.getByRole("radio", { name: "Mixed" }));
    await user.click(feedback.getByRole("button", { name: "A sentence, if you want" }));
    const note = feedback.getByRole("textbox", { name: "A sentence, if you want" });
    await user.type(note, "For this edition only.");
    expect(note).toHaveValue("For this edition only.");
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("delegates an authentication failure while loading prior feedback", async () => {
    const onUnauthorized = vi.fn();
    mockApiResponses({
      [`GET ${PATH}`]: {
        status: 401,
        body: errorBody("unauthorized", "Sign in again"),
      },
    });

    render(<ReadingFeedbackCard readingId={READING_ID} onUnauthorized={onUnauthorized} />);

    await act(async () => Promise.resolve());
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("delegates an authentication failure while submitting feedback", async () => {
    const user = userEvent.setup();
    const onUnauthorized = vi.fn();
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`POST ${PATH}`]: {
        status: 401,
        body: errorBody("unauthorized", "Sign in again"),
      },
    });

    render(<ReadingFeedbackCard readingId={READING_ID} onUnauthorized={onUnauthorized} />);
    await user.click(await screen.findByRole("radio", { name: "This helped" }));
    await user.click(screen.getByRole("button", { name: /Send this/i }));

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("keeps a successful submission when the initial feedback read resolves late", async () => {
    const user = userEvent.setup();
    const initialRead = deferred();
    mockApiResponses({
      [`GET ${PATH}`]: {
        status: 404,
        body: errorBody("feedback_not_found", "No feedback"),
        gate: initialRead.promise,
      },
      [`POST ${PATH}`]: ok(
        { id: "rfb_web_test_late", reading_id: READING_ID, created_at: "2026-08-14T12:00:00Z" },
        201,
      ),
    });

    render(<ReadingFeedbackCard readingId={READING_ID} />);
    await user.click(screen.getByRole("radio", { name: "This helped" }));
    await user.click(screen.getByRole("button", { name: /Send this/i }));
    expect(await screen.findByText(/Noted — this helped/i)).toBeInTheDocument();

    await act(async () => initialRead.release());
    expect(screen.getByText(/Noted — this helped/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "This helped" })).not.toBeInTheDocument();
  });

  it("ignores an in-flight submission after the displayed reading changes", async () => {
    const user = userEvent.setup();
    const submitted = deferred();
    const nextReadingId = "rdg_feedback_000000000002";
    const nextPath = `/v1/readings/${nextReadingId}/feedback`;
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`POST ${PATH}`]: {
        ...ok({ id: "rfb_stale", reading_id: READING_ID, created_at: "2026-08-14T12:00:00Z" }, 201),
        gate: submitted.promise,
      },
      [`GET ${nextPath}`]: ok({
        id: "rfb_current",
        reading_id: nextReadingId,
        resonance: "neutral",
        relevance_labels: [],
        created_at: "2026-08-15T12:00:00Z",
      }),
    });
    const rendered = render(<ReadingFeedbackCard readingId={READING_ID} />);
    await user.click(await screen.findByRole("radio", { name: "This helped" }));
    await user.click(screen.getByRole("button", { name: /Send this/i }));
    rendered.rerender(<ReadingFeedbackCard readingId={nextReadingId} />);

    expect(await screen.findByText(/Noted — mixed/i)).toBeInTheDocument();
    await act(async () => submitted.release());
    expect(screen.getByText(/Noted — mixed/i)).toBeInTheDocument();
  });

  it("rejects two same-tick feedback submissions", async () => {
    const user = userEvent.setup();
    const submitted = deferred();
    mockApiResponses({
      [`GET ${PATH}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
      [`POST ${PATH}`]: {
        ...ok({ id: "rfb_once", reading_id: READING_ID, created_at: "2026-08-14T12:00:00Z" }, 201),
        gate: submitted.promise,
      },
    });
    render(<ReadingFeedbackCard readingId={READING_ID} />);
    await user.click(await screen.findByRole("radio", { name: "This helped" }));
    const send = screen.getByRole("button", { name: /Send this/i });

    fireEvent.click(send);
    fireEvent.click(send);

    expect(capturedFor(PATH).filter((call) => call.method === "POST")).toHaveLength(1);
    await act(async () => submitted.release());
  });
});
