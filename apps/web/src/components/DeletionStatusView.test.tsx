import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { DeletionStatusView } from "./DeletionStatusView.js";

const STATUS = "/v1/account/deletion-status";

afterEach(() => vi.useRealTimers());

describe("deletion status surface", () => {
  it("polls with only the receipt cookie and announces completion before signing out", async () => {
    vi.useFakeTimers();
    const responses: Record<string, MockResponse> = {
      [STATUS]: {
        status: 200,
        body: {
          schema_version: "0.6.0",
          deletion_request_id: "del_test_0001",
          status: "queued",
          requested_at: "2026-08-13T12:00:00.000Z",
          status_updated_at: "2026-08-13T12:00:00.000Z",
          completed_at: null,
          error_class: null,
        },
      },
    };
    mockApiResponses(responses);
    const completed = vi.fn();
    render(<DeletionStatusView onComplete={completed} />);

    await act(async () => undefined);
    expect(screen.getByRole("status")).toHaveTextContent(/locked/i);
    responses[STATUS] = {
      status: 200,
      body: {
        ...(responses[STATUS]!.body as Record<string, unknown>),
        status: "completed",
        completed_at: "2026-08-13T12:01:00.000Z",
      },
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(screen.getByRole("heading", { name: /account has been deleted/i }))
      .toBeInTheDocument();
    expect(completed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(completed).toHaveBeenCalledOnce();
  });

  it("calls a missing receipt status unavailable rather than deleted", async () => {
    mockApiResponses({
      [STATUS]: {
        status: 401,
        body: {
          error: {
            code: "unauthorized",
            message: "Deletion status is unavailable",
            request_id: "req_receipt_missing",
          },
        },
      },
    });
    render(<DeletionStatusView onComplete={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: /status is unavailable/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("req_receipt_missing");
    expect(screen.queryByText(/has been deleted/i)).not.toBeInTheDocument();
  });
});
