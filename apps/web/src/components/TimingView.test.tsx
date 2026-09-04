import axe from "axe-core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimingView } from "./TimingView.js";
import {
  capturedFor,
  deferred,
  mockApiResponses,
  notImplemented,
  type MockResponse,
} from "../test/api-mock.js";
import {
  ACTIVE_TIMING_CYCLE,
  TIMING_RESPONSE,
  UPCOMING_TIMING_CYCLE,
  timingResponseFixture,
} from "../test/timing-fixture.js";
import {
  formatTimingDate,
  formatTimingDuration,
  formatTimingLocalDate,
  formatTimingOrb,
} from "../lib/timing-format.js";

const TIMING = "/v1/timing";
const AS_OF = TIMING_RESPONSE.as_of;
const ok = (body: unknown): MockResponse => ({ status: 200, body });

function renderTiming(responses: Record<string, MockResponse>) {
  mockApiResponses(responses);
  const onUnauthorized = vi.fn();
  const view = render(<TimingView onUnauthorized={onUnauthorized} />);
  return { ...view, onUnauthorized };
}

describe("TimingView", () => {
  it("renders factual cycle arcs, semantic exact passes, and evidence metadata", async () => {
    const { container } = renderTiming({ [TIMING]: ok(TIMING_RESPONSE) });

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Where each cycle stands today.",
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
    expect(
      screen.getByText(/lining up at a set angle with a point in your birth chart/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/calculated dates, not predicted events/i)).toBeInTheDocument();
    expect(
      screen.getByText("Calculated today, when your daily reading was prepared."),
    ).toBeInTheDocument();

    // Cycles are grouped by status, so the reader sees "what is in play" before
    // reading a single card. The group heading owns the level the cards sat at.
    expect(screen.getByRole("heading", { level: 2, name: /Active now/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Upcoming/ })).toBeInTheDocument();

    const activeHeading = screen.getByRole("heading", {
      level: 3,
      name: "Saturn square your Sun",
    });
    const activeArticle = activeHeading.closest("article");
    expect(activeArticle).not.toBeNull();
    const active = within(activeArticle!);
    expect(active.getByText("Reconsidering")).toBeInTheDocument();
    expect(active.getByText(/Next exact/)).toBeInTheDocument();
    expect(
      active.getByText(formatTimingDate(ACTIVE_TIMING_CYCLE.start_at, AS_OF)),
    ).toBeInTheDocument();
    expect(
      active.getByText(formatTimingDate(ACTIVE_TIMING_CYCLE.end_at, AS_OF)),
    ).toBeInTheDocument();
    expect(active.getByText("about 6 months")).toBeInTheDocument();
    expect(active.getByText("Pass 1")).toBeInTheDocument();
    expect(active.getByText("Pass 2")).toBeInTheDocument();
    expect(active.getByText("Pass 3")).toBeInTheDocument();
    expect(active.getByText("Retrograde")).toBeInTheDocument();
    // The next pass is named twice on purpose: once as the headline fact and
    // once in its row, which is the one tagged.
    expect(
      active.getAllByText(formatTimingDate(ACTIVE_TIMING_CYCLE.passes[1]!.exact_at, AS_OF)),
    ).toHaveLength(2);
    expect(active.getByText("Next")).toBeInTheDocument();
    expect(active.getByText("Transit")).toBeInTheDocument();
    expect(active.getByText(formatTimingOrb(3))).toBeInTheDocument();
    expect(
      active.getByText(formatTimingDuration(ACTIVE_TIMING_CYCLE.duration_days)),
    ).toBeInTheDocument();
    expect(active.getByText(ACTIVE_TIMING_CYCLE.cycle_id)).toBeInTheDocument();
    expect(active.getByText("Calculation details").closest("details")).not.toHaveAttribute("open");

    const upcomingHeading = screen.getByRole("heading", {
      level: 3,
      name: "Jupiter trine your Moon",
    });
    const upcoming = within(upcomingHeading.closest("article")!);
    expect(upcoming.getByText("Upcoming")).toBeInTheDocument();
    expect(upcoming.getByText(/Starts/)).toBeInTheDocument();
    expect(upcoming.getByText("about 3 weeks")).toBeInTheDocument();

    const dateTimes = Array.from(container.querySelectorAll("time"), (time) =>
      time.getAttribute("datetime"),
    );
    expect(dateTimes).toEqual(
      expect.arrayContaining([
        ACTIVE_TIMING_CYCLE.start_at,
        ACTIVE_TIMING_CYCLE.end_at,
        ...ACTIVE_TIMING_CYCLE.passes.map((pass) => pass.exact_at),
        UPCOMING_TIMING_CYCLE.start_at,
        UPCOMING_TIMING_CYCLE.end_at,
        UPCOMING_TIMING_CYCLE.passes[0]!.exact_at,
      ]),
    );
    expect(
      container.querySelectorAll('.timing-track[aria-hidden="true"]'),
    ).toHaveLength(2);
  });

  it("explains the vocabulary once, in a disclosure that starts closed", async () => {
    renderTiming({ [TIMING]: ok(TIMING_RESPONSE) });
    await screen.findByRole("heading", { name: "Saturn square your Sun" });

    const summary = screen.getByText("What the terms mean");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(
      screen.getByText(/Reconsidering is between the first and last pass/),
    ).toBeInTheDocument();
    expect(screen.getByText(/called the orb/)).toBeInTheDocument();
  });

  it("limits a current empty claim to the stored scan window and hides the filters", async () => {
    renderTiming({
      [TIMING]: ok(timingResponseFixture({ cycles: [] })),
    });

    expect(await screen.findByText(/Nothing is in range right now/i)).toBeInTheDocument();
    expect(
      screen.getByText(/says nothing about dates outside the window/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Phase")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duration")).not.toBeInTheDocument();
  });

  it("keeps stale facts visible and links to Today for preparation", async () => {
    renderTiming({
      [TIMING]: ok(timingResponseFixture({ state: "stale" })),
    });

    expect(
      await screen.findByRole("heading", { name: "Saturn square your Sun" }),
    ).toBeInTheDocument();
    expect(screen.getByText(formatTimingLocalDate("2026-08-09", AS_OF))).toBeInTheDocument();
    expect(
      screen.getByText(/It updates when today's reading is prepared/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Today/i })).toHaveAttribute(
      "href",
      "#today",
    );
  });

  it("explains not-scanned prerequisites without promising immediate population", async () => {
    renderTiming({
      [TIMING]: ok(
        timingResponseFixture({ state: "not_scanned", cycles: [] }),
      ),
    });

    expect(
      await screen.findByText(/No cycles have been calculated yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/chart, a confirmed time zone and language, and your AI-synthesis consent/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Today/i })).toHaveAttribute(
      "href",
      "#today",
    );
    expect(screen.queryByText(/will populate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Calculated/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Phase")).not.toBeInTheDocument();
  });

  it("keeps stored cycles and omissions visible when no receipt exists", async () => {
    const first = renderTiming({
      [TIMING]: ok(
        timingResponseFixture({
          state: "not_scanned",
          cycles: [ACTIVE_TIMING_CYCLE],
          unreadableCycleCount: 1,
        }),
      ),
    });

    expect(
      await screen.findByRole("heading", { level: 3, name: "Saturn square your Sun" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 stored cycle could not be read.")).toBeInTheDocument();
    expect(screen.getByText(/did not finish preparing/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Today/i })).toHaveAttribute(
      "href",
      "#today",
    );
    expect(screen.queryByText(/No cycles have been calculated yet/i)).not.toBeInTheDocument();
    first.unmount();

    renderTiming({
      [TIMING]: ok(
        timingResponseFixture({
          state: "not_scanned",
          cycles: [],
          unreadableCycleCount: 2,
        }),
      ),
    });
    expect(
      await screen.findByText(/None of the stored cycles could be shown/i),
    ).toBeInTheDocument();
    expect(screen.getByText("2 stored cycles could not be read.")).toBeInTheDocument();
    expect(screen.queryByText(/No cycles have been calculated yet/i)).not.toBeInTheDocument();
  });

  it("keeps filters visible on an empty match and resets to the unfiltered URL", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TIMING]: ok(TIMING_RESPONSE),
    };
    renderTiming(responses);
    await screen.findByRole("heading", { name: "Saturn square your Sun" });

    responses[TIMING] = ok(
      timingResponseFixture({
        cycles: [],
        filters: { phase: "building", duration: null },
      }),
    );
    await user.selectOptions(screen.getByLabelText("Phase"), "building");

    expect(
      await screen.findByText(/No cycles match these filters/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Duration")).toBeInTheDocument();
    expect(capturedFor(TIMING).at(-1)!.search).toBe("?phase=building");

    responses[TIMING] = ok(timingResponseFixture({ cycles: [] }));
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(capturedFor(TIMING).at(-1)!.search).toBe(""));
  });

  it("reports unreadable artifacts with facts and with no readable cycles", async () => {
    const first = renderTiming({
      [TIMING]: ok(timingResponseFixture({ unreadableCycleCount: 1 })),
    });

    expect(
      await screen.findByText("1 stored cycle could not be read."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saturn square your Sun" })).toBeInTheDocument();
    first.unmount();

    renderTiming({
      [TIMING]: ok(
        timingResponseFixture({ cycles: [], unreadableCycleCount: 2 }),
      ),
    });
    expect(
      await screen.findByText(/None of the stored cycles could be shown/i),
    ).toBeInTheDocument();
    expect(screen.getByText("2 stored cycles could not be read.")).toBeInTheDocument();
  });

  it("aborts superseded filter requests and sends only contract-shaped filters", async () => {
    const user = userEvent.setup();
    const phaseGate = deferred();
    const durationGate = deferred();
    const responses: Record<string, MockResponse> = {
      [TIMING]: ok(TIMING_RESPONSE),
    };
    renderTiming(responses);
    await screen.findByRole("heading", { name: "Saturn square your Sun" });

    responses[TIMING] = {
      status: 200,
      gate: phaseGate.promise,
      body: timingResponseFixture({
        filters: { phase: "peak", duration: null },
      }),
    };
    await user.selectOptions(screen.getByLabelText("Phase"), "peak");
    await waitFor(() => expect(capturedFor(TIMING)).toHaveLength(2));
    const phaseSignal = capturedFor(TIMING)[1]!.signal;

    responses[TIMING] = {
      status: 200,
      gate: durationGate.promise,
      body: timingResponseFixture({
        filters: { phase: "peak", duration: "medium" },
      }),
    };
    await user.selectOptions(screen.getByLabelText("Duration"), "medium");
    await waitFor(() => expect(capturedFor(TIMING)).toHaveLength(3));

    // Pending: the filters carry the visible busy cue and the results stay
    // rendered, undimmed, under an aria-busy marker.
    const filters = screen.getByLabelText("Phase").closest("section")!;
    expect(filters).toHaveClass("timing-filters--busy");
    expect(screen.getByRole("heading", { name: "Saturn square your Sun" })).toBeInTheDocument();

    expect(phaseSignal?.aborted).toBe(true);
    expect(capturedFor(TIMING)[1]!.search).toBe("?phase=peak");
    expect(capturedFor(TIMING)[2]!.search).toBe("?phase=peak&duration=medium");
    expect(capturedFor(TIMING)[2]!.search).not.toContain("domain");

    await act(async () => durationGate.release());
    await screen.findByRole("heading", { name: "Saturn square your Sun" });
    await waitFor(() => expect(filters).not.toHaveClass("timing-filters--busy"));
    await act(async () => phaseGate.release());
  });

  it("mounts the page heading and polite status while the first request loads", async () => {
    const gate = deferred();
    renderTiming({
      [TIMING]: { status: 200, gate: gate.promise, body: TIMING_RESPONSE },
    });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Where each cycle stands today.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Loading your cycles/i);

    await act(async () => gate.release());
    await screen.findByRole("heading", { name: "Saturn square your Sun" });
    expect(screen.getByRole("status")).toHaveTextContent(/Cycles loaded/i);
  });

  it("keeps the cached-PWA rollback state honest without milestone or JSON copy", async () => {
    const { container } = renderTiming({
      [TIMING]: notImplemented("Timing cycles (M3)", "req_timing_rollback"),
    });

    expect(
      await screen.findByRole("heading", {
        name: /Timing is not available on this server/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Request req_timing_rollback/i)).toBeInTheDocument();
    expect(screen.queryByText(/Worker/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planned \/ M3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/route is returning data/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("shows a network recovery action", async () => {
    renderTiming({
      [TIMING]: { status: 0, body: null, unreachable: true },
    });

    expect(
      await screen.findByText("The Pattern/Like API could not be reached."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("preserves server request ids and retry focus while the retry is busy", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    const responses: Record<string, MockResponse> = {
      [TIMING]: {
        status: 500,
        body: {
          error: {
            code: "internal_error",
            message: "Timing could not be loaded.",
            request_id: "req_timing_error",
          },
        },
      },
    };
    renderTiming(responses);

    expect(
      await screen.findByRole("heading", { name: "Timing could not be loaded." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Request req_timing_error/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /Try again/i });
    retry.focus();
    responses[TIMING] = {
      status: 200,
      gate: gate.promise,
      body: TIMING_RESPONSE,
    };
    await user.click(retry);

    expect(document.activeElement).toBe(retry);
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute("aria-busy", "true");

    await act(async () => gate.release());
    await screen.findByRole("heading", { name: "Saturn square your Sun" });
  });

  it("hands a 401 back to App and renders no cycle data", async () => {
    const { onUnauthorized } = renderTiming({
      [TIMING]: {
        status: 401,
        body: {
          error: {
            code: "unauthorized",
            message: "Authentication required",
            request_id: "req_timing_unauthorized",
          },
        },
      },
    });

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Saturn square your Sun" })).not.toBeInTheDocument();
  });

  it("has no detectable structural accessibility violations", async () => {
    const { container } = renderTiming({ [TIMING]: ok(TIMING_RESPONSE) });
    await screen.findByRole("heading", { name: "Saturn square your Sun" });

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });
});
