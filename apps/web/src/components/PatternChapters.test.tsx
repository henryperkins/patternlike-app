import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PatternChapter, PatternResponse } from "@patternlike/shared";

import { capturedFor, mockApiResponses, notImplemented, type MockResponse } from "../test/api-mock.js";
import { PatternChapters } from "./PatternChapters.js";

const PATH = "/v1/pattern";

function chapter(id: string, title: string): PatternChapter {
  return {
    content_id: id,
    content_version: "1.0.0",
    title,
    summary: "A short mechanical summary of the pattern.",
    body: "The longer reviewed description of what this configuration describes.",
    resources: ["Sustained attention on one problem"],
    tensions: ["It can harden into refusal to revise"],
    counter_expression: "The same configuration can read as patience rather than stalling.",
    evidence: [
      {
        feature_id: "nft_0000000000000000000000000000000000000001",
        feature_class: "aspect",
        label: "mars square saturn within 1.2°",
      },
    ],
  };
}

function page(overrides: Partial<PatternResponse> = {}): PatternResponse {
  return {
    schema_version: "0.4.0",
    generated_at: "2026-08-13T18:00:00.000Z",
    chart_id: "cht_pattern_test_0001",
    chart_fingerprint: `sha256:${"a".repeat(64)}`,
    effective_accuracy: "exact",
    feature_policy_version: "1.0.0",
    feature_set_hash: `sha256:${"b".repeat(64)}`,
    release_version: "release-24",
    bundle_hash: `sha256:${"c".repeat(64)}`,
    locale: "en-US",
    items: [chapter("pattern.one", "Holding a line under pressure")],
    next_cursor: null,
    omissions: { accuracy: 0, houses_or_angles: 0, locale: 0, predicate_mismatch: 3 },
    ...overrides,
  };
}

const noop = () => {};

describe("Your Pattern chapters", () => {
  it("renders the reviewed chapter with its tensions, resources, counter-expression, and exact evidence", async () => {
    const user = userEvent.setup();
    mockApiResponses({ [PATH]: { status: 200, body: page() } });
    render(<PatternChapters onUnauthorized={noop} />);

    const article = await screen.findByRole("article", { name: /Holding a line under pressure/i });
    expect(within(article).getByText(/short mechanical summary/i)).toBeInTheDocument();
    expect(within(article).getByText(/harden into refusal to revise/i)).toBeInTheDocument();
    expect(within(article).getByText(/Sustained attention on one problem/i)).toBeInTheDocument();

    // The counter-expression is always visible, never behind the disclosure.
    expect(
      within(article).getByText(/patience rather than stalling/i),
    ).toBeInTheDocument();

    // Evidence names the exact derived facts, and it is a disclosure.
    expect(within(article).queryByText(/mars square saturn/i)).toBeInTheDocument();
    await user.click(within(article).getByText("Why this?"));
    expect(
      within(article).getByText("nft_0000000000000000000000000000000000000001"),
    ).toBeInTheDocument();
    expect(within(article).getByText(/Release release-24/)).toBeInTheDocument();

    expect(screen.getByText(/did not match your calculated facts/i)).toBeInTheDocument();
  });

  it("drains every page in the server's order rather than stopping at the first", async () => {
    const first = page({
      items: [chapter("pattern.one", "First chapter")],
      next_cursor: "cursor-two",
    });
    const second = page({ items: [chapter("pattern.two", "Second chapter")], next_cursor: null });

    let call = 0;
    const responses: Record<string, MockResponse> = { [PATH]: { status: 200, body: first } };
    mockApiResponses(responses);
    const original = globalThis.fetch as unknown as typeof fetch;
    vi.stubGlobal("fetch", (async (input: string | URL, init?: RequestInit) => {
      call += 1;
      responses[PATH] = { status: 200, body: call === 1 ? first : second };
      return original(input as never, init as never);
    }) as unknown as typeof fetch);

    render(<PatternChapters onUnauthorized={noop} />);

    expect(await screen.findByRole("article", { name: /Second chapter/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /First chapter/i })).toBeInTheDocument();
    const calls = capturedFor(PATH);
    expect(calls).toHaveLength(2);
    expect(calls[1].search).toBe("?cursor=cursor-two");
  });

  it("says an empty match is empty instead of substituting filler", async () => {
    mockApiResponses({
      [PATH]: {
        status: 200,
        body: page({
          items: [],
          effective_accuracy: "unknown",
          omissions: { accuracy: 4, houses_or_angles: 2, locale: 1, predicate_mismatch: 9 },
        }),
      },
    });
    render(<PatternChapters onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /No reviewed chapter matched this chart/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing generic is shown in their place/i)).toBeInTheDocument();
    expect(screen.getByText(/4 need a more exact birth time/i)).toBeInTheDocument();
    expect(screen.getByText(/2 need houses or angles/i)).toBeInTheDocument();
    expect(screen.getByText(/1 is published in another language/i)).toBeInTheDocument();
  });

  it("keeps an intentional M3 rollback honest and does not offer a pointless retry", async () => {
    mockApiResponses({
      [PATH]: {
        status: 503,
        body: {
          error: {
            code: "pattern_release_not_active",
            message: "No active Pattern release",
            request_id: "req_pattern_rollback",
          },
        },
      },
    });
    render(<PatternChapters onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /No reviewed Pattern content is published/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/will not invent them in the meantime/i)).toBeInTheDocument();
    expect(screen.getByText("Request req_pattern_rollback")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("keeps the 501 rollback state and retries only what retrying can fix", async () => {
    const responses: Record<string, MockResponse> = {
      [PATH]: notImplemented("Your Pattern chapters (M3)", "req_pattern_501"),
    };
    mockApiResponses(responses);
    const { unmount } = render(<PatternChapters onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /not active on this Worker/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
    unmount();

    const user = userEvent.setup();
    responses[PATH] = { status: 0, body: null, unreachable: true };
    mockApiResponses(responses);
    render(<PatternChapters onUnauthorized={noop} />);

    const retry = await screen.findByRole("button", { name: /Try again/i });
    retry.focus();
    await user.click(retry);
    // The control survives the reload it triggers rather than dropping focus.
    expect(document.activeElement).toBe(retry);
  });

  it("hands a mid-visit 401 to the application instead of rendering its own failure", async () => {
    const onUnauthorized = vi.fn();
    mockApiResponses({
      [PATH]: {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
    });
    render(<PatternChapters onUnauthorized={onUnauthorized} />);

    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });
});
