import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { consentGranted, fallbackResponse, todayResponse, todayResponseV5, V5_READING_ID, READING_ID } from "../test/reading-fixture.js";
import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { ReadingArticle } from "./ReadingArticle.js";
import type { DailyReadingResponse } from "../lib/api-client.js";

function saveState(readingId: string) {
  return { schema_version: "0.8.0", reading_id: readingId, saved: false, saved_at: null };
}

function renderHistorical(
  response: DailyReadingResponse = todayResponse,
  status: "published" | "superseded" | "invalidated" = "published",
) {
  const readingId = response.reading.reading_id;
  mockApiResponses({
    [`GET /v1/readings/${readingId}/save`]: { status: 200, body: saveState(readingId) },
    [`GET /v1/readings/${readingId}/feedback`]: {
      status: 404,
      body: { error: { code: "feedback_not_found", message: "No feedback" } },
    },
  });
  return render(
    <ReadingArticle
      response={response}
      status={status}
      showCheckIn={false}
      onReload={vi.fn()}
      onUnauthorized={vi.fn()}
    />,
  );
}

describe("ReadingArticle", () => {
  it("preserves every v3 paragraph, fallback disclosure, revision, evidence, and feedback", async () => {
    const response = {
      ...fallbackResponse,
      reading: { ...fallbackResponse.reading, revision: 3 },
    };
    renderHistorical(response, "invalidated");

    expect(await screen.findByText(response.reading.paragraphs[0]!.text)).toBeInTheDocument();
    expect(screen.getByText(/not tailored to your chart/i)).toBeInTheDocument();
    expect(screen.getByText("Revised · r3")).toBeInTheDocument();
    expect(screen.getByText("Removed from Today")).toBeInTheDocument();
    expect(screen.getByText("Why this reading?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sunday, August 9, 2026");
    expect(screen.getByRole("heading", { name: "Did this meet you?" })).toBeInTheDocument();
    expect(screen.queryByText("How are you arriving?")).not.toBeInTheDocument();
  });

  it("preserves v5 headline, ordered prose, model disclosure, and exact revision status", async () => {
    const reversed = {
      ...todayResponseV5,
      reading: {
        ...todayResponseV5.reading,
        revision: 2,
        paragraphs: [...todayResponseV5.reading.paragraphs].reverse(),
      },
    };
    const { container } = renderHistorical(reversed, "superseded");

    expect(await screen.findByText(todayResponseV5.reading.headline)).toBeInTheDocument();
    expect(screen.getByText(todayResponseV5.reading.disclosure)).toBeInTheDocument();
    expect(screen.getByText("Revised")).toBeInTheDocument();
    const text = container.textContent ?? "";
    const positions = todayResponseV5.reading.paragraphs.map((paragraph) => text.indexOf(paragraph.text));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("offers feedback on Today even when the separate check-in is unavailable", async () => {
    mockApiResponses({
      [`GET /v1/readings/${READING_ID}/save`]: { status: 200, body: saveState(READING_ID) },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: { error: { code: "feedback_not_found", message: "No feedback" } },
      },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "GET /v1/context-sources": {
        status: 503,
        body: { error: { code: "context_unavailable", message: "Unavailable" } },
      },
    });
    render(
      <ReadingArticle
        response={todayResponse}
        showCheckIn
        onReload={vi.fn()}
        onUnauthorized={vi.fn()}
      />,
    );

    expect(await screen.findByRole("link", { name: "Past chapters" }))
      .toHaveAttribute("href", "#history");
    expect(screen.getByRole("heading", { name: "Did this meet you?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "This helped" })).toBeInTheDocument();
    expect(screen.getByText("How are you arriving?")).toBeInTheDocument();
    expect(V5_READING_ID).not.toBe(READING_ID);
  });

  it("submits feedback and check-in separately, then restores the same edition's receipt in History", async () => {
    const user = userEvent.setup();
    const feedbackPath = `/v1/readings/${READING_ID}/feedback`;
    const receipt = {
      id: "rfb_today_history",
      reading_id: READING_ID,
      resonance: "neutral",
      relevance_labels: [],
      created_at: "2026-08-13T12:00:00Z",
    };
    const responses: Record<string, MockResponse> = {
      [`GET /v1/readings/${READING_ID}/save`]: { status: 200, body: saveState(READING_ID) },
      [`GET ${feedbackPath}`]: {
        status: 404,
        body: { error: { code: "feedback_not_found", message: "No feedback" } },
      },
      [`POST ${feedbackPath}`]: { status: 201, body: receipt },
      "GET /v1/context-sources": {
        status: 200,
        body: { sources: [{ source_id: "USR-06", enabled: true, permission_state: "active" }] },
      },
      "GET /v1/consents/ai-synthesis": { status: 200, body: consentGranted },
      "POST /v1/check-ins": {
        status: 201,
        body: { freshness: { expires_at: "2026-08-14T12:00:00Z" } },
      },
    };
    mockApiResponses(responses);
    const onReload = vi.fn();
    const props = { response: todayResponse, onReload, onUnauthorized: vi.fn() };
    const today = render(<ReadingArticle {...props} showCheckIn />);
    const feedback = within(await screen.findByRole("region", { name: "Did this meet you?" }));
    const checkIn = within(screen.getByRole("region", { name: "How are you arriving?" }));

    await user.click(await checkIn.findByRole("radio", { name: /Steady/ }));
    await user.click(feedback.getByRole("radio", { name: "Mixed" }));
    await user.click(feedback.getByRole("button", { name: /Send this/ }));
    expect(await feedback.findByText(/Noted — mixed/)).toBeInTheDocument();
    const [write] = capturedFor(feedbackPath).filter((call) => call.method === "POST");
    expect(write!.body).toEqual({ resonance: "neutral", note: null });
    expect(capturedFor("/v1/check-ins")).toHaveLength(0);
    expect(checkIn.getByRole("radio", { name: /Steady/ })).toBeChecked();

    await user.click(checkIn.getByRole("button", { name: "Keep this" }));
    expect(await checkIn.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(capturedFor("/v1/check-ins")[0]!.body).toEqual({ energy: "medium", expires_in_seconds: 86400 });
    expect(feedback.getByText(/Noted — mixed/)).toBeInTheDocument();
    for (const paragraph of todayResponse.reading.paragraphs) {
      expect(screen.getByText(paragraph.text)).toBeInTheDocument();
    }
    expect(onReload).not.toHaveBeenCalled();

    responses[`GET ${feedbackPath}`] = { status: 200, body: receipt };
    today.unmount();
    render(<ReadingArticle {...props} showCheckIn={false} />);
    expect(await screen.findByText(/Noted — mixed/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "How are you arriving?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send this/ })).not.toBeInTheDocument();
    expect(capturedFor(feedbackPath).filter((call) => call.method === "POST")).toHaveLength(1);
  });
});
