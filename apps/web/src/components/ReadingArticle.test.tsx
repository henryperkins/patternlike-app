import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fallbackResponse, todayResponse, todayResponseV5, V5_READING_ID, READING_ID } from "../test/reading-fixture.js";
import { mockApiResponses } from "../test/api-mock.js";
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

  it("keeps Today's check-in and Past chapters entry point while omitting historical feedback", async () => {
    mockApiResponses({
      [`GET /v1/readings/${READING_ID}/save`]: { status: 200, body: saveState(READING_ID) },
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
    expect(screen.queryByRole("heading", { name: "Did this meet you?" })).not.toBeInTheDocument();
    expect(screen.getByText("How are you arriving?")).toBeInTheDocument();
    expect(V5_READING_ID).not.toBe(READING_ID);
  });
});
