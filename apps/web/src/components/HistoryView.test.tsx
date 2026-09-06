import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReadingHistoryItem, ReadingHistoryResponse } from "@patternlike/shared";
import { capturedFor, deferred, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { errorBody, evidenceGraph, READING_ID, todayResponse } from "../test/reading-fixture.js";
import { HistoryView } from "./HistoryView.js";

const ITEM_A: ReadingHistoryItem = {
  reading_id: READING_ID,
  local_date: "2026-08-09",
  revision: 1,
  revision_reason: "initial",
  status: "published",
  assembly_mode: "deterministic",
  headline: null,
  saved: false,
  saved_at: null,
  evidence_url: `/v1/readings/${READING_ID}/evidence`,
};

const ITEM_B: ReadingHistoryItem = {
  ...ITEM_A,
  reading_id: "rdg_history_000000000002",
  local_date: "2025-08-08",
  revision: 3,
  revision_reason: "chart_recalculated",
  status: "invalidated",
  assembly_mode: "constrained_model",
  headline: "A quieter line of effort",
  evidence_url: "/v1/readings/rdg_history_000000000002/evidence",
};

const ITEM_C: ReadingHistoryItem = {
  ...ITEM_B,
  reading_id: "rdg_history_000000000003",
  revision: 2,
  status: "superseded",
  saved: true,
  saved_at: "2026-08-10T10:00:00.000Z",
  evidence_url: "/v1/readings/rdg_history_000000000003/evidence",
};

function page(view: "history" | "saved", items: ReadingHistoryItem[], nextCursor: string | null = null): ReadingHistoryResponse {
  return { schema_version: "0.8.0", view, items, next_cursor: nextCursor };
}

function renderHistory(responses: Record<string, MockResponse>) {
  mockApiResponses(responses);
  const onUnauthorized = vi.fn();
  const view = render(<HistoryView onUnauthorized={onUnauthorized} />);
  return { ...view, onUnauthorized };
}

describe("HistoryView", () => {
  it("shows distinct empty History and Saved states and resets the request", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const responses: Record<string, MockResponse> = {};
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => reads++ === 0
        ? { status: 200, body: page("history", []) }
        : { status: 200, body: page("saved", []) },
    });
    renderHistory(responses);

    expect(await screen.findByText("No past chapters yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Saved" }));
    expect(await screen.findByText("No saved chapters yet.")).toBeInTheDocument();
    expect(capturedFor("/v1/readings").map((request) => request.search))
      .toEqual(["?view=history&limit=20", "?view=saved&limit=20"]);
  });

  it("renders chronological cards with honest revision states and appends pagination", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const responses: Record<string, MockResponse> = {};
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => reads++ === 0
        ? { status: 200, body: page("history", [ITEM_A, ITEM_B], "next-page") }
        : { status: 200, body: page("history", [ITEM_C]) },
    });
    renderHistory(responses);

    const list = await screen.findByRole("list", { name: "Reading chapters" });
    let articles = within(list).getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent("Sunday, August 9, 2026");
    expect(articles[1]).toHaveTextContent("A quieter line of effort");
    expect(articles[1]).toHaveTextContent("Revision 3");
    expect(articles[1]).toHaveTextContent("Removed from Today");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    articles = within(list).getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(articles[2]).toHaveTextContent("Revised");
    expect(capturedFor("/v1/readings")[1]!.search)
      .toBe("?view=history&limit=20&cursor=next-page");
    expect(screen.getByText("3 chapters shown.")).toBeInTheDocument();
  });

  it("shows every saved revision from one date and discards a stale filter response", async () => {
    const user = userEvent.setup();
    const historyGate = deferred();
    let reads = 0;
    const responses: Record<string, MockResponse> = {};
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => reads++ === 0
        ? { status: 200, body: page("history", [ITEM_A]), gate: historyGate.promise }
        : { status: 200, body: page("saved", [{ ...ITEM_B, saved: true }, ITEM_C]) },
    });
    renderHistory(responses);
    await user.click(screen.getByRole("button", { name: "Saved" }));

    expect(await screen.findByText("2 chapters shown.")).toBeInTheDocument();
    expect(screen.getAllByText("Friday, August 8, 2025")).toHaveLength(2);
    await act(async () => historyGate.release());
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Sunday, August 9, 2026")).not.toBeInTheDocument();
  });

  it("opens shared detail with evidence and feedback, then restores list state and focus", async () => {
    const user = userEvent.setup();
    renderHistory({
      "GET /v1/readings": { status: 200, body: page("history", [ITEM_A]) },
      [`GET /v1/readings/${READING_ID}`]: { status: 200, body: todayResponse },
      [`GET /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: { schema_version: "0.8.0", reading_id: READING_ID, saved: false, saved_at: null },
      },
      [`PUT /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: {
          schema_version: "0.8.0",
          reading_id: READING_ID,
          saved: true,
          saved_at: "2026-08-10T12:00:00.000Z",
        },
      },
      [`GET /v1/readings/${READING_ID}/evidence`]: { status: 200, body: evidenceGraph },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: { error: { code: "feedback_not_found", message: "No feedback" } },
      },
    });

    const opener = await screen.findByRole("button", { name: /Open Daily chapter from Sunday, August 9, 2026/i });
    await user.click(opener);
    expect(await screen.findByRole("button", { name: "Back to History" })).toHaveFocus();
    expect(await screen.findByText(todayResponse.reading.paragraphs[0]!.text)).toBeInTheDocument();
    expect(screen.getByText("Chapter loaded for Sunday, August 9, 2026.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Did this meet you?" })).toBeInTheDocument();
    expect(screen.getByText("Optional. It never changes the published chapter."))
      .toBeInTheDocument();
    expect(screen.queryByText("How are you arriving?")).not.toBeInTheDocument();
    await user.click(screen.getByText("Why this reading?"));
    expect(await screen.findByText("The weight of the moving body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to History" }));
    const restored = await screen.findByRole("button", { name: /Open Daily chapter from Sunday, August 9, 2026/i });
    expect(restored).toHaveFocus();
    expect(restored).toHaveTextContent("Saved");
    expect(capturedFor("/v1/readings")).toHaveLength(1);
  });

  it("removes an unsaved detail from Saved while retaining it in History", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const savedItem = { ...ITEM_A, saved: true, saved_at: "2026-08-10T11:00:00.000Z" };
    const responses: Record<string, MockResponse> = {
      [`GET /v1/readings/${READING_ID}`]: { status: 200, body: todayResponse },
      [`GET /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: { schema_version: "0.8.0", reading_id: READING_ID, saved: true, saved_at: savedItem.saved_at },
      },
      [`DELETE /v1/readings/${READING_ID}/save`]: { status: 204, body: null },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: { error: { code: "feedback_not_found", message: "No feedback" } },
      },
    };
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => {
        const read = reads++;
        if (read === 0) return { status: 200, body: page("history", [savedItem]) };
        if (read === 1) return { status: 200, body: page("saved", [savedItem]) };
        return { status: 200, body: page("history", [{ ...savedItem, saved: false, saved_at: null }]) };
      },
    });
    renderHistory(responses);
    await screen.findByText("1 chapter shown.");
    await user.click(screen.getByRole("button", { name: "Saved" }));
    await screen.findByText("1 chapter shown.");
    await user.click(screen.getByRole("button", { name: /Open Daily chapter/i }));
    await user.click(await screen.findByRole("button", { name: "Saved" }));
    await user.click(screen.getByRole("button", { name: "Back to Saved" }));
    expect(await screen.findByText("No saved chapters yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("button", { name: /Open Daily chapter/i })).toBeInTheDocument();
  });

  it("reinserts a re-saved detail into Saved in newest-first order", async () => {
    const user = userEvent.setup();
    const original = { ...ITEM_A, saved: true, saved_at: "2026-08-10T09:00:00.000Z" };
    const other = { ...ITEM_C, saved_at: "2026-08-10T10:00:00.000Z" };
    let reads = 0;
    const responses: Record<string, MockResponse> = {
      [`GET /v1/readings/${READING_ID}`]: { status: 200, body: todayResponse },
      [`GET /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: { schema_version: "0.8.0", reading_id: READING_ID, saved: true, saved_at: original.saved_at },
      },
      [`DELETE /v1/readings/${READING_ID}/save`]: { status: 204, body: null },
      [`PUT /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: {
          schema_version: "0.8.0",
          reading_id: READING_ID,
          saved: true,
          saved_at: "2026-08-10T11:00:00.000Z",
        },
      },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: errorBody("feedback_not_found", "No feedback"),
      },
    };
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => reads++ === 0
        ? { status: 200, body: page("history", [original, other]) }
        : { status: 200, body: page("saved", [original, other]) },
    });
    renderHistory(responses);
    await screen.findByText("2 chapters shown.");
    await user.click(screen.getByRole("button", { name: "Saved" }));
    await screen.findByText("2 chapters shown.");
    await user.click(screen.getByRole("button", { name: /Open Daily chapter/i }));
    await user.click(await screen.findByRole("button", { name: "Saved" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to Saved" }));

    const rows = within(await screen.findByRole("list", { name: "Reading chapters" }))
      .getAllByRole("button", { name: /Open/i });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName(/Daily chapter/);
    expect(rows[1]).toHaveAccessibleName(/A quieter line of effort/);
  });

  it("keeps Load more reachable when unsaving empties the loaded Saved page", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const savedItem = { ...ITEM_A, saved: true, saved_at: "2026-08-10T11:00:00.000Z" };
    const responses: Record<string, MockResponse> = {
      [`GET /v1/readings/${READING_ID}`]: { status: 200, body: todayResponse },
      [`GET /v1/readings/${READING_ID}/save`]: {
        status: 200,
        body: { schema_version: "0.8.0", reading_id: READING_ID, saved: true, saved_at: savedItem.saved_at },
      },
      [`DELETE /v1/readings/${READING_ID}/save`]: { status: 204, body: null },
      [`GET /v1/readings/${READING_ID}/feedback`]: {
        status: 404,
        body: errorBody("feedback_not_found", "No feedback"),
      },
    };
    Object.defineProperty(responses, "GET /v1/readings", {
      enumerable: true,
      get: () => reads++ < 2
        ? { status: 200, body: page(reads === 1 ? "history" : "saved", [savedItem], "remaining") }
        : { status: 200, body: page("saved", [ITEM_C]) },
    });
    renderHistory(responses);
    await screen.findByText("1 chapter shown.");
    await user.click(screen.getByRole("button", { name: "Saved" }));
    await screen.findByText("1 chapter shown.");
    await user.click(screen.getByRole("button", { name: /Open Daily chapter/i }));
    await user.click(await screen.findByRole("button", { name: "Saved" }));
    await user.click(screen.getByRole("button", { name: "Back to Saved" }));

    expect(await screen.findByText("More saved chapters are available.")).toBeInTheDocument();
    expect(screen.getByText("Load more to continue through your saved chapters."))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: /Open A quieter line of effort/i }))
      .toBeInTheDocument();
    expect(capturedFor("/v1/readings").at(-1)?.search)
      .toBe("?view=saved&limit=20&cursor=remaining");
  });

  it("delegates an unauthorized list without rendering a false error", async () => {
    const { onUnauthorized } = renderHistory({
      "GET /v1/readings": {
        status: 401,
        body: { error: { code: "unauthorized", message: "Sign in" } },
      },
    });
    await act(async () => Promise.resolve());
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(screen.queryByText("History could not load.")).not.toBeInTheDocument();
  });
});
