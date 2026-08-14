import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { capturedFor, mockApiResponses, type MockResponse } from "../test/api-mock.js";
import { lifeEvent, travelResponse } from "../test/travel-fixture.js";
import { TimeTravelView } from "./TimeTravelView.js";

const TRAVEL = "/v1/time-travel";
const EVENTS = "/v1/life-events";
const noop = () => {};

function emptyEvents(): MockResponse {
  return { status: 200, body: { schema_version: "0.4.0", items: [] } };
}

function refusal(status: number, code: string, details?: Record<string, unknown>): MockResponse {
  return {
    status,
    body: {
      error: {
        code,
        message: `operator prose for ${code}`,
        request_id: `req_${code}`,
        ...(details ? { details } : {}),
      },
    },
  };
}

describe("Time Travel", () => {
  it("renders both references, their provenance, and every comparison group", async () => {
    const user = userEvent.setup();
    mockApiResponses({ [TRAVEL]: { status: 200, body: travelResponse() }, [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /Selected date against now/i }),
    ).toBeInTheDocument();

    // Provenance is disclosed per reference: reconstructed now versus reused.
    expect(screen.getByText("Calculated now")).toBeInTheDocument();
    expect(screen.getByText("Reused calculation")).toBeInTheDocument();

    // All three primary groups are named, and phase change is extra metadata on
    // a continuing cycle rather than a fourth group.
    expect(screen.getByText("Still running now")).toBeInTheDocument();
    expect(screen.getByText("Only on the selected date")).toBeInTheDocument();
    expect(screen.getByText("Only now")).toBeInTheDocument();
    expect(screen.getAllByText("Phase changed")).toHaveLength(1);

    // Pass detail is a disclosure over the same facts, not a replacement of them.
    const cycles = screen.getAllByRole("article", { name: /Saturn square your Sun/i });
    await user.click(within(cycles[0]).getByText(/Exact passes and orb/i));
    expect(within(cycles[0]).getByText("Pass 1")).toBeInTheDocument();
    expect(within(cycles[0]).getByText("Direct")).toBeInTheDocument();
    expect(
      within(cycles[0]).getByText("cyc_travel_fixture_00000000000001"),
    ).toBeInTheDocument();
  });

  it("steps the date, returns to today, and asks the route for exactly that date", async () => {
    const user = userEvent.setup();
    mockApiResponses({ [TRAVEL]: { status: 200, body: travelResponse() }, [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);

    const field = await screen.findByLabelText("Selected date");
    const today = (field as HTMLInputElement).value;

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await vi.waitFor(() => expect(capturedFor(TRAVEL)).toHaveLength(2));
    const stepped = (screen.getByLabelText("Selected date") as HTMLInputElement).value;
    expect(stepped).not.toBe(today);
    expect(capturedFor(TRAVEL)[1].search).toBe(`?date=${stepped}`);

    await user.click(screen.getByRole("button", { name: "Return to today" }));
    await vi.waitFor(() => expect(capturedFor(TRAVEL)).toHaveLength(3));
    expect(capturedFor(TRAVEL)[2].search).toBe(`?date=${today}`);
  });

  it("calls a successful empty scan complete rather than missing", async () => {
    const empty = travelResponse();
    empty.selected.cycles = [];
    empty.comparison = { continuing: [], selected_only: [], present_only: [], phase_changed: [] };
    empty.present.cycles = [];
    mockApiResponses({ [TRAVEL]: { status: 200, body: empty }, [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findAllByText(/No calculated cycle overlaps this reference/i),
    ).toHaveLength(2);
    expect(screen.getAllByText(/does not say nothing was happening/i)).toHaveLength(2);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("offers the deterministic recovery for a civil date the zone skipped", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TRAVEL]: refusal(422, "skipped_local_date", { next_representable_date: "2026-03-09" }),
      [EVENTS]: emptyEvents(),
    };
    mockApiResponses(responses);
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /skipped that calendar date entirely/i }),
    ).toBeInTheDocument();
    const field = screen.getByLabelText("Selected date") as HTMLInputElement;
    const attempted = field.value;
    expect(screen.getByText(new RegExp(`Selected date kept`))).toBeInTheDocument();

    responses[TRAVEL] = { status: 200, body: travelResponse() };
    await user.click(screen.getByRole("button", { name: /Go to/i }));

    expect(
      (screen.getByLabelText("Selected date") as HTMLInputElement).value,
    ).toBe("2026-03-09");
    expect(attempted).not.toBe("2026-03-09");
  });

  it("shows the UTC reset instant when the daily scan budget is spent, without a retry", async () => {
    mockApiResponses({
      [TRAVEL]: refusal(429, "time_travel_scan_budget_exhausted", {
        resets_at: "2026-08-15T00:00:00.000Z",
      }),
      [EVENTS]: emptyEvents(),
    });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /reconstruction limit is used up/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/New reconstructions resume/i)).toBeInTheDocument();
    expect(screen.getByText(/already reconstructed still open immediately/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("separates a deterministic range refusal from transient unavailability", async () => {
    mockApiResponses({
      [TRAVEL]: refusal(422, "date_not_supported"),
      [EVENTS]: emptyEvents(),
    });
    const { unmount } = render(<TimeTravelView onUnauthorized={noop} />);
    expect(
      await screen.findByRole("heading", { name: /outside the calculation's supported range/i }),
    ).toBeInTheDocument();
    // A deterministic refusal answers identically forever.
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
    // Upstream calculation prose never reaches the reader.
    expect(screen.queryByText(/operator prose/)).not.toBeInTheDocument();
    unmount();

    mockApiResponses({ [TRAVEL]: refusal(503, "calc_unavailable"), [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);
    expect(
      await screen.findByRole("heading", { name: /calculation service could not be reached/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("keeps calculated cycles while disclosing the exact omitted private-context count", async () => {
    mockApiResponses({
      [TRAVEL]: {
        status: 200,
        body: travelResponse({
          life_event_source_state: "active",
          unreadable_context_count: 2,
        }),
      },
      [EVENTS]: emptyEvents(),
    });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findByText(/2 saved events could not be read/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/calculated cycles above are unaffected/i)).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /Saturn square your Sun/i })).toHaveLength(2);
  });

  it("labels an authorized saved event and never claims the sky caused it", async () => {
    mockApiResponses({
      [TRAVEL]: {
        status: 200,
        body: travelResponse({
          life_event_source_state: "active",
          saved_context: [{ event: lifeEvent(), recording_relation: "added_later" }],
        }),
      },
      [EVENTS]: { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } },
    });
    render(<TimeTravelView onUnauthorized={noop} />);

    const savedForDate = await screen.findByRole("region", { name: /What you saved/i });
    expect(within(savedForDate).getByText("Left the old job")).toBeInTheDocument();
    expect(within(savedForDate).getByText("Added later")).toBeInTheDocument();
    expect(screen.getByText(/never evidence for it/i)).toBeInTheDocument();
  });

  it("does not enable the source implicitly and points at the privacy control", async () => {
    mockApiResponses({
      [TRAVEL]: { status: 200, body: travelResponse({ life_event_source_state: "paused" }) },
      [EVENTS]: { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } },
    });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(await screen.findByText(/Life-event timeline is paused/i)).toBeInTheDocument();
    // Listing survives a paused source; writing does not.
    expect(screen.getByRole("article", { name: "Left the old job" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add an event/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop showing in Time Travel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete/i })).toBeEnabled();
    expect(screen.getByRole("link", { name: /Context & privacy/i })).toHaveAttribute(
      "href",
      "#privacy",
    );
  });

  it("drops a previous date's reconstruction when a new date fails", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TRAVEL]: { status: 200, body: travelResponse() },
      [EVENTS]: emptyEvents(),
    };
    mockApiResponses(responses);
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(
      await screen.findByRole("heading", { name: /Selected date against now/i }),
    ).toBeInTheDocument();

    responses[TRAVEL] = refusal(503, "calc_unavailable");
    await user.click(screen.getByRole("button", { name: "Previous day" }));

    expect(
      await screen.findByRole("heading", { name: /calculation service could not be reached/i }),
    ).toBeInTheDocument();
    // The previous date's panels are gone: showing them beside a field naming a
    // different date would present a stale answer as the current one.
    expect(
      screen.queryByRole("heading", { name: /Selected date against now/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Calculated now")).not.toBeInTheDocument();
  });

  it("hands a mid-visit 401 to the application", async () => {
    const onUnauthorized = vi.fn();
    mockApiResponses({
      [TRAVEL]: {
        status: 401,
        body: { error: { code: "unauthorized", message: "Authentication required" } },
      },
      [EVENTS]: emptyEvents(),
    });
    render(<TimeTravelView onUnauthorized={onUnauthorized} />);

    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});

describe("Life-event timeline", () => {
  const active = () => ({
    status: 200,
    body: travelResponse({ life_event_source_state: "active" }),
  }) as MockResponse;

  it("creates an event, defaulting Time Travel use to an explicit choice", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TRAVEL]: active(),
      [`GET ${EVENTS}`]: emptyEvents(),
      [`POST ${EVENTS}`]: { status: 201, body: lifeEvent() },
    };
    mockApiResponses(responses);
    render(<TimeTravelView onUnauthorized={noop} />);

    await user.click(await screen.findByRole("button", { name: /Add an event/i }));
    const useToggle = screen.getByLabelText(/Show this event beside a reconstructed date/i);
    expect(useToggle).not.toBeChecked();

    await user.type(screen.getByLabelText("Title"), "Left the old job");
    await user.click(useToggle);
    responses[`GET ${EVENTS}`] = { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } };
    await user.click(screen.getByRole("button", { name: /Save this event/i }));

    const posted = capturedFor(EVENTS).find((call) => call.method === "POST")!;
    expect(posted.body).toMatchObject({
      schema_version: "0.4.0",
      title: "Left the old job",
      precision: "day",
      end_date: null,
      use_in_time_travel: true,
    });
    expect(posted.headers.get("idempotency-key")).toMatch(/^web-life-event-/);
    expect(await screen.findByRole("article", { name: "Left the old job" })).toBeInTheDocument();
  });

  it("explains a precision whose window has not finished before spending a request", async () => {
    const user = userEvent.setup();
    mockApiResponses({ [TRAVEL]: active(), [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);

    await user.click(await screen.findByRole("button", { name: /Add an event/i }));
    await user.type(screen.getByLabelText("Title"), "This month");
    // The default start date is today, so widening to a month pushes the end of
    // the window past today. The server refuses that; the client names it.
    await user.selectOptions(
      screen.getByLabelText(/How exactly do you know when/i),
      "month",
    );
    await user.click(screen.getByRole("button", { name: /Save this event/i }));

    expect(screen.getByText(/has not finished yet/i)).toBeInTheDocument();
    expect(capturedFor(EVENTS).filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("refuses an impossible range before spending a request", async () => {
    const user = userEvent.setup();
    mockApiResponses({ [TRAVEL]: active(), [EVENTS]: emptyEvents() });
    render(<TimeTravelView onUnauthorized={noop} />);

    await user.click(await screen.findByRole("button", { name: /Add an event/i }));
    await user.type(screen.getByLabelText("Title"), "A trip");
    await user.selectOptions(
      screen.getByLabelText(/How exactly do you know when/i),
      "range",
    );
    await user.click(screen.getByRole("button", { name: /Save this event/i }));

    expect(screen.getByText("A range needs an end date.")).toBeInTheDocument();
    expect(capturedFor(EVENTS).filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("writes a new revision when the reader opts an event out of Time Travel", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TRAVEL]: active(),
      [`GET ${EVENTS}`]: { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } },
      [`PUT ${EVENTS}/${lifeEvent().id}`]: {
        status: 200,
        body: lifeEvent({ revision: 2, use_in_time_travel: false }),
      },
    };
    mockApiResponses(responses);
    render(<TimeTravelView onUnauthorized={noop} />);

    await user.click(
      await screen.findByRole("button", { name: /Stop showing in Time Travel/i }),
    );

    const put = capturedFor(`${EVENTS}/${lifeEvent().id}`).find((call) => call.method === "PUT")!;
    expect(put.body).toMatchObject({ use_in_time_travel: false, title: "Left the old job" });
    expect(put.headers.get("idempotency-key")).toMatch(/^web-life-event-use-/);
  });

  it("requires a deliberate confirmation before deleting an event", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TRAVEL]: active(),
      [`GET ${EVENTS}`]: { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } },
      [`DELETE ${EVENTS}/${lifeEvent().id}`]: { status: 204, body: null },
    };
    mockApiResponses(responses);
    render(<TimeTravelView onUnauthorized={noop} />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // The first press only asks; nothing has been sent.
    expect(capturedFor(`${EVENTS}/${lifeEvent().id}`)).toHaveLength(0);
    expect(screen.getByText(/every stored revision of it/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(capturedFor(`${EVENTS}/${lifeEvent().id}`)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    responses[`GET ${EVENTS}`] = emptyEvents();
    await user.click(screen.getByRole("button", { name: /Delete permanently/i }));

    const deleted = capturedFor(`${EVENTS}/${lifeEvent().id}`).find(
      (call) => call.method === "DELETE",
    )!;
    expect(deleted.headers.get("idempotency-key")).toMatch(/^web-life-event-delete-/);
    expect(await screen.findByText(/Nothing saved yet/i)).toBeInTheDocument();
  });

  it("keeps the saved-event surface usable when a reconstruction failed", async () => {
    mockApiResponses({
      [TRAVEL]: refusal(503, "calc_unavailable"),
      [EVENTS]: { status: 200, body: { schema_version: "0.4.0", items: [lifeEvent()] } },
    });
    render(<TimeTravelView onUnauthorized={noop} />);

    expect(await screen.findByRole("article", { name: "Left the old job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});
