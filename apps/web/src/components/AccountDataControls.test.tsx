import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { AccountDataControls, EXPORT_SESSION_KEY } from "./AccountDataControls.js";

const EXPORTS = "/v1/exports";

function readyStatus(id: string) {
  return {
    schema_version: "0.6.0",
    export_request_id: id,
    status: "ready",
    requested_at: "2026-08-13T12:00:00.000Z",
    status_updated_at: "2026-08-13T12:01:00.000Z",
    completed_at: "2026-08-13T12:01:00.000Z",
    expires_at: "2026-08-20T12:01:00.000Z",
    download_available: true,
    error_class: null,
  };
}

describe("account data controls", () => {
  it("resumes a tab-scoped export and streams it through a same-origin link", async () => {
    const exportId = "exp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    window.sessionStorage.setItem(EXPORT_SESSION_KEY, exportId);
    mockApiResponses({
      [`${EXPORTS}/${exportId}`]: { status: 200, body: readyStatus(exportId) },
    });
    render(<AccountDataControls onDeletionAccepted={vi.fn()} />);

    const link = await screen.findByRole("link", { name: /Download export/i });
    expect(link).toHaveAttribute("href", `${EXPORTS}/${exportId}/download`);
    expect(screen.getByRole("status", { name: /Export status/i })).toHaveTextContent(
      /expires/i,
    );
    expect(capturedFor(EXPORTS)).toHaveLength(0);
  });

  it("stores a new opaque export id and polls it without minting another request", async () => {
    const user = userEvent.setup();
    const exportId = "exp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    mockApiResponses({
      [EXPORTS]: {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "ExportAccount",
          status: "queued",
          idempotency_key: "idem-web-export",
          job_id: "job_export_0001",
          resource_id: exportId,
        },
      },
      [`${EXPORTS}/${exportId}`]: { status: 200, body: readyStatus(exportId) },
    });
    render(<AccountDataControls onDeletionAccepted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Request export/i }));

    expect(await screen.findByRole("link", { name: /Download export/i }))
      .toBeInTheDocument();
    expect(window.sessionStorage.getItem(EXPORT_SESSION_KEY)).toBe(exportId);
    expect(capturedFor(EXPORTS)).toHaveLength(1);
    expect(capturedFor(`${EXPORTS}/${exportId}`)).toHaveLength(1);
  });

  it("keeps the typed deletion interlock and hands accepted work to the status route", async () => {
    const user = userEvent.setup();
    const accepted = vi.fn();
    const responses: Record<string, MockResponse> = {
      "/v1/account": {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "DeleteAccount",
          status: "queued",
          idempotency_key: "idem-web-delete",
          job_id: "job_delete_0001",
          resource_id: "del_delete_0001",
        },
      },
    };
    mockApiResponses(responses);
    render(<AccountDataControls onDeletionAccepted={accepted} />);

    const trigger = screen.getByRole("button", { name: /Delete account/i });
    await user.click(trigger);
    const field = screen.getByLabelText(/Type DELETE to confirm/i);
    expect(document.activeElement).toBe(field);
    await user.type(field, "DELETE");
    await user.click(screen.getByRole("button", { name: /Confirm deletion/i }));

    expect(accepted).toHaveBeenCalledOnce();
    expect(capturedFor("/v1/account")[0]!.body).toEqual({
      confirm: "DELETE",
      reason: null,
    });
  });
});
