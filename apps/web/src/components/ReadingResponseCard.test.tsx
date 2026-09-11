import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReadingFeedbackEventReceipt, ReadingFeedbackOptionsResponse } from "@patternlike/shared";
import { capturedFor, deferred, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { READING_ID, errorBody } from "../test/reading-fixture.js";
import { ReadingResponseCard, ReadingBirthCorrectionContext } from "./ReadingResponseCard.js";

const optionsPath = `/v1/readings/${READING_ID}/feedback-options`;
const eventPath = `/v1/readings/${READING_ID}/feedback-events`;
const legacyPath = `/v1/readings/${READING_ID}/feedback`;
const options: ReadingFeedbackOptionsResponse = {
  schema_version: "reading-feedback-options/v1",
  target: { reading_id: READING_ID, revision: 2, content_hash: `sha256:${"a".repeat(64)}`, paragraph_id: null },
  feedback_use_policy_version: "categorized-feedback-use/v1",
  expected_grant_state: "opaque-grant-1",
  grant_action: "create",
  categories: ["repetitive", "not_relevant_today", "unclear"],
  effect_window_days: 7,
  retention_months: 24,
  generation_effects_active: false,
  latest_event: null,
};
const receipt: ReadingFeedbackEventReceipt = {
  schema_version: "reading-feedback-event-receipt/v1",
  id: "rfe_test_1",
  target: options.target,
  category: "repetitive",
  created_at: "2026-09-09T12:00:00Z",
  effect_expires_at: "2026-09-16T12:00:00Z",
  retention_expires_at: "2028-09-09T12:00:00Z",
  feedback_use_policy_version: options.feedback_use_policy_version,
};
function setup(document = options) {
  const responses: Record<string, MockResponse> = {
    [`GET ${optionsPath}`]: { status: 200, body: document },
    [`POST ${eventPath}`]: { status: 201, body: receipt },
    [`GET ${legacyPath}`]: { status: 404, body: errorBody("feedback_not_found", "No feedback") },
  };
  mockApiResponses(responses);
  return responses;
}
function mount(props: { readingId?: string; revision?: number; paragraphId?: string; onUnauthorized?: () => void } = {}) {
  return render(<ReadingResponseCard readingId={READING_ID} revision={2} {...props} />);
}

describe("categorical reading response", () => {
  it("submits a category and encrypted-note input to its exact server-provided edition without fabricating resonance", async () => {
    const responses = setup(), user = userEvent.setup();
    const view = mount();
    await user.click(await screen.findByRole("radio", { name: "Repetitive" }));
    expect(screen.getByText(/24 months/)).toBeInTheDocument();
    expect(screen.getByText(/not used to write readings/)).toBeInTheDocument();
    expect(screen.getByText(/generation use is currently off/i)).toBeInTheDocument();
    expect(screen.queryByText(/seven days/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "Optional note" }), "This framing repeats.");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    const saved = await screen.findByRole("status", { name: "Categorical feedback receipt" });
    expect(saved).toHaveTextContent("Recorded for this chapter: Repetitive");
    expect(saved).toHaveFocus();
    const [write] = capturedFor(eventPath);
    expect(write!.body).toEqual({ schema_version: "reading-feedback-event/v1", category: "repetitive", revision: 2, content_hash: options.target.content_hash, paragraph_id: null, note: "This framing repeats.", feedback_use_policy_version: options.feedback_use_policy_version, expected_grant_state: options.expected_grant_state, confirm_feedback_use: true });
    expect(write!.headers.get("idempotency-key")).toMatch(/^web-feedback-event-/);
    expect(capturedFor(optionsPath)[0]!.search).toBe("?revision=2");
    expect(capturedFor(legacyPath).filter(call => call.method === "POST")).toHaveLength(0);
    responses[`GET ${optionsPath}`]!.body = { ...options, latest_event: receipt };
    view.unmount();
    mount();
    expect(await screen.findByRole("status", { name: "Categorical feedback receipt" })).toHaveTextContent("Repetitive");
    expect(capturedFor(eventPath)).toHaveLength(1);
  });

  it.each(["create", "reuse", "renew"] as const)("explains the actual %s permission action before submission", async grant_action => {
    setup({ ...options, grant_action });
    mount();
    await screen.findByRole("radio", { name: "Unclear" });
    expect(screen.getByText(grant_action === "create" ? /Sending enables feedback permission/ : grant_action === "reuse" ? /Sending uses your existing feedback permission/ : /Sending renews your feedback permission/)).toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(0);
  });

  it("keeps unclear out of generation and makes theme relevance conditional on supported associations", async () => {
    setup({ ...options, generation_effects_active: true });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: "Not relevant today" }));
    expect(screen.getByText(/supported theme associations/)).toBeInTheDocument();
    expect(screen.getByText(/seven days/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Unclear" }));
    expect(screen.getByText(/not offered to generation/)).toBeInTheDocument();
    expect(screen.queryByText(/seven days/)).not.toBeInTheDocument();
  });

  it("distinguishes an expired generation window from retained feedback", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-17T12:00:00Z"));
    setup({ ...options, generation_effects_active: true, latest_event: receipt });
    mount();
    await screen.findByRole("status", { name: "Categorical feedback receipt" });
    expect(screen.getByText(/generation window has expired/)).toBeInTheDocument();
    expect(screen.getByText(/retained until/)).toBeInTheDocument();
    expect(screen.queryByText(/Repetition control may use/)).not.toBeInTheDocument();
  });

  it("refreshes a changed permission explanation and requires a new deliberate submission", async () => {
    const responses = setup(), user = userEvent.setup();
    responses[`POST ${eventPath}`] = { status: 409, body: errorBody("feedback_use_changed", "Permission changed") };
    mount();
    await user.click(await screen.findByRole("radio", { name: "Repetitive" }));
    responses[`GET ${optionsPath}`]!.body = { ...options, grant_action: "renew", expected_grant_state: "opaque-grant-2" };
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(await screen.findByText(/Review the updated explanation/)).toBeInTheDocument();
    expect(screen.getByText(/Sending renews your feedback permission/)).toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(1);
    responses[`POST ${eventPath}`] = { status: 201, body: receipt };
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("status", { name: "Categorical feedback receipt" });
    const writes = capturedFor(eventPath);
    expect(writes).toHaveLength(2);
    expect((writes[1]!.body as { expected_grant_state: string }).expected_grant_state).toBe("opaque-grant-2");
    expect(writes[1]!.headers.get("idempotency-key")).not.toBe(writes[0]!.headers.get("idempotency-key"));
  });

  it("retries an unconfirmed submission with the original request and idempotency key", async () => {
    const responses = setup(), user = userEvent.setup();
    responses[`POST ${eventPath}`] = { status: 503, body: errorBody("unavailable", "Temporarily unavailable") };
    mount();
    await user.click(await screen.findByRole("radio", { name: "Repetitive" }));
    await user.click(screen.getByRole("button", { name: "Send response" }));
    const retry = await screen.findByRole("button", { name: "Retry response" });
    expect(screen.getByRole("radio", { name: "Unclear" })).toBeDisabled();
    responses[`POST ${eventPath}`] = { status: 201, body: receipt };
    await user.click(retry);
    await screen.findByRole("status", { name: "Categorical feedback receipt" });
    const writes = capturedFor(eventPath);
    expect(writes[1]!.body).toEqual(writes[0]!.body);
    expect(writes[1]!.headers.get("idempotency-key")).toBe(writes[0]!.headers.get("idempotency-key"));
  });

  it("reloads permission before another response and preserves the deliberate draft after a changed grant", async () => {
    const responses = setup({ ...options, latest_event: receipt }), user = userEvent.setup();
    mount();
    await screen.findByRole("status", { name: "Categorical feedback receipt" });
    responses[`GET ${optionsPath}`]!.body = { ...options, grant_action: "reuse", expected_grant_state: "grant-reused", latest_event: receipt };
    await user.click(screen.getByRole("button", { name: "Give another response" }));
    await screen.findByRole("radio", { name: "Unclear" });
    expect(screen.getByRole("heading", { name: "Report a problem with this chapter" })).toHaveFocus();
    await user.click(await screen.findByRole("radio", { name: "Unclear" }));
    expect(screen.getByText(/Sending uses your existing feedback permission/)).toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(0);
    responses[`POST ${eventPath}`] = { status: 409, body: errorBody("feedback_use_changed", "Changed") };
    responses[`GET ${optionsPath}`]!.body = { ...options, grant_action: "renew", expected_grant_state: "grant-renewed", latest_event: receipt };
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(await screen.findByText(/Review the updated explanation/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Unclear" })).toBeChecked();
    expect(screen.queryByRole("status", { name: "Categorical feedback receipt" })).not.toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(1);
  });

  it.each([404, 503])("preserves existing resonance compatibility when options return %s", async status => {
    const responses = setup();
    responses[`GET ${optionsPath}`] = { status, body: errorBody("unavailable", "Options unavailable") };
    mount();
    await screen.findByRole("radio", { name: "This helped" });
    expect(screen.queryByRole("radio", { name: "Repetitive" })).not.toBeInTheDocument();
    if (status === 503) expect(screen.getByText("Response options could not be checked.")).toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(0);
  });

  it("refuses a different edition or unknown option policy", async () => {
    setup({ ...options, target: { ...options.target, revision: 3 } });
    mount();
    await screen.findByText("Response options could not be checked.");
    expect(screen.queryByRole("radio", { name: "Repetitive" })).not.toBeInTheDocument();
    expect(capturedFor(eventPath)).toHaveLength(0);
  });

  it("pins paragraph responses and rejects a receipt for another paragraph", async () => {
    setup({ ...options, target: { ...options.target, paragraph_id: "paragraph-two" } });
    const user = userEvent.setup();
    mount({ paragraphId: "paragraph-two" });
    await user.click(await screen.findByRole("radio", { name: "Repetitive" }));
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("button", { name: "Retry response" });
    expect(screen.queryByRole("status", { name: "Categorical feedback receipt" })).not.toBeInTheDocument();
    expect(capturedFor(optionsPath)[0]!.search).toBe("?revision=2&paragraph_id=paragraph-two");
    expect((capturedFor(eventPath)[0]!.body as { paragraph_id: string }).paragraph_id).toBe("paragraph-two");
  });

  it("ignores late writes after moving to another reading and delegates unauthorized options", async () => {
    const gate = deferred(), responses = setup(), user = userEvent.setup(), onUnauthorized = vi.fn();
    responses[`POST ${eventPath}`]!.gate = gate.promise;
    const view = mount({ onUnauthorized });
    await user.click(await screen.findByRole("radio", { name: "Repetitive" }));
    await user.click(screen.getByRole("button", { name: "Send response" }));
    responses["GET /v1/readings/next-reading/feedback-options"] = { status: 401, body: errorBody("unauthorized", "Sign in") };
    view.rerender(<ReadingResponseCard readingId="next-reading" revision={1} onUnauthorized={onUnauthorized} />);
    await act(async () => gate.release());
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "Categorical feedback receipt" })).not.toBeInTheDocument();
  });

  it("opens existing birth correction without feedback or a permission mutation", async () => {
    setup();
    const user = userEvent.setup(), correct = vi.fn();
    render(<ReadingBirthCorrectionContext value={correct}><ReadingResponseCard readingId={READING_ID} revision={2} /></ReadingBirthCorrectionContext>);
    await user.click(await screen.findByRole("link", { name: "My birth details are wrong" }));
    expect(correct).toHaveBeenCalledOnce();
    expect(capturedFor(eventPath)).toHaveLength(0);
    expect(capturedFor(legacyPath).filter(call => call.method === "POST")).toHaveLength(0);
  });
});
