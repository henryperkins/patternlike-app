import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { capturedFor, deferred, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { ReadingSaveButton } from "./ReadingSaveButton.js";

const READING_A = "rdg_history_000000000001";
const READING_B = "rdg_history_000000000002";

function state(readingId: string, saved: boolean) {
  return {
    schema_version: "0.8.0" as const,
    reading_id: readingId,
    saved,
    saved_at: saved ? "2026-08-10T12:00:00.000Z" : null,
  };
}

describe("ReadingSaveButton", () => {
  it("rejects two same-tick activations before React can render the busy state", async () => {
    const saving = deferred();
    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: { status: 200, body: state(READING_A, false) },
      [`PUT /v1/readings/${READING_A}/save`]: {
        status: 200,
        body: state(READING_A, true),
        gate: saving.promise,
      },
    });
    render(<ReadingSaveButton readingId={READING_A} onUnauthorized={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Save" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(capturedFor(`/v1/readings/${READING_A}/save`).filter((request) => request.method === "PUT"))
      .toHaveLength(1);
    await act(async () => saving.release());
  });

  it("waits for the server, disables duplicate intent, and commits Save and Saved states", async () => {
    const user = userEvent.setup();
    const saving = deferred();
    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: { status: 200, body: state(READING_A, false) },
      [`PUT /v1/readings/${READING_A}/save`]: {
        status: 200,
        body: state(READING_A, true),
        gate: saving.promise,
      },
      [`DELETE /v1/readings/${READING_A}/save`]: { status: 204, body: null },
    });
    const onStateChange = vi.fn();
    render(
      <ReadingSaveButton
        readingId={READING_A}
        onUnauthorized={vi.fn()}
        onStateChange={onStateChange}
      />,
    );

    const button = await screen.findByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Saving");
    await user.click(button);
    expect(capturedFor(`/v1/readings/${READING_A}/save`).filter((request) => request.method === "PUT"))
      .toHaveLength(1);

    await act(async () => saving.release());
    expect(await screen.findByRole("button", { name: "Saved" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Saved to your chapters.")).toBeInTheDocument();
    expect(onStateChange).toHaveBeenLastCalledWith(state(READING_A, true));

    await user.click(screen.getByRole("button", { name: "Saved" }));
    expect(await screen.findByRole("button", { name: "Save" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Removed from Saved.")).toBeInTheDocument();
    expect(onStateChange).toHaveBeenLastCalledWith(state(READING_A, false));
  });

  it("retains the confirmed state after a recoverable failure and retries", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const responses: Record<string, MockResponse> = {
      [`GET /v1/readings/${READING_A}/save`]: { status: 200, body: state(READING_A, false) },
    };
    Object.defineProperty(responses, `PUT /v1/readings/${READING_A}/save`, {
      enumerable: true,
      get: () => attempts++ === 0
        ? {
            status: 503,
            body: { error: { code: "save_unavailable", message: "Save is temporarily unavailable", request_id: "req_save" } },
          }
        : { status: 200, body: state(READING_A, true) },
    });
    mockApiResponses(responses);
    render(<ReadingSaveButton readingId={READING_A} onUnauthorized={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "Save" });
    await user.click(button);
    expect(await screen.findByText(/temporarily unavailable.*Request req_save/i))
      .toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toBeEnabled();

    await user.click(button);
    expect(await screen.findByRole("button", { name: "Saved" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("offers a retry when initial state cannot be read", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const responses: Record<string, MockResponse> = {};
    Object.defineProperty(responses, `GET /v1/readings/${READING_A}/save`, {
      enumerable: true,
      get: () => reads++ === 0
        ? { status: 503, body: { error: { code: "save_unavailable", message: "Unavailable" } } }
        : { status: 200, body: state(READING_A, true) },
    });
    mockApiResponses(responses);
    render(<ReadingSaveButton readingId={READING_A} onUnauthorized={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Try reading Save state again" }));
    expect(await screen.findByRole("button", { name: "Saved" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("delegates authentication failures and ignores an aborted stale response", async () => {
    const stale = deferred();
    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: {
        status: 200,
        body: state(READING_A, false),
        gate: stale.promise,
      },
      [`GET /v1/readings/${READING_B}/save`]: { status: 200, body: state(READING_B, true) },
    });
    const onStateChange = vi.fn();
    const onUnauthorized = vi.fn();
    const view = render(
      <ReadingSaveButton
        readingId={READING_A}
        onUnauthorized={onUnauthorized}
        onStateChange={onStateChange}
      />,
    );
    view.rerender(
      <ReadingSaveButton
        readingId={READING_B}
        onUnauthorized={onUnauthorized}
        onStateChange={onStateChange}
      />,
    );
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
    await act(async () => stale.release());
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(onStateChange).not.toHaveBeenCalledWith(state(READING_A, false));

    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: {
        status: 401,
        body: { error: { code: "unauthorized", message: "Sign in" } },
      },
    });
    view.rerender(
      <ReadingSaveButton
        readingId={READING_A}
        onUnauthorized={onUnauthorized}
      />,
    );
    await act(async () => Promise.resolve());
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("ignores an in-flight mutation after the displayed revision changes", async () => {
    const user = userEvent.setup();
    const staleSave = deferred();
    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: { status: 200, body: state(READING_A, false) },
      [`PUT /v1/readings/${READING_A}/save`]: {
        status: 200,
        body: state(READING_A, true),
        gate: staleSave.promise,
      },
      [`GET /v1/readings/${READING_B}/save`]: { status: 200, body: state(READING_B, false) },
    });
    const onStateChange = vi.fn();
    const view = render(
      <ReadingSaveButton readingId={READING_A} onUnauthorized={vi.fn()} onStateChange={onStateChange} />,
    );
    await user.click(await screen.findByRole("button", { name: "Save" }));
    view.rerender(
      <ReadingSaveButton readingId={READING_B} onUnauthorized={vi.fn()} onStateChange={onStateChange} />,
    );
    expect(await screen.findByRole("button", { name: "Save" })).toHaveAttribute("aria-pressed", "false");
    await act(async () => staleSave.release());
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-pressed", "false");
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("delegates an authentication failure from a Save mutation", async () => {
    const user = userEvent.setup();
    const onUnauthorized = vi.fn();
    mockApiResponses({
      [`GET /v1/readings/${READING_A}/save`]: { status: 200, body: state(READING_A, false) },
      [`PUT /v1/readings/${READING_A}/save`]: {
        status: 401,
        body: { error: { code: "unauthorized", message: "Sign in" } },
      },
    });
    render(<ReadingSaveButton readingId={READING_A} onUnauthorized={onUnauthorized} />);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
