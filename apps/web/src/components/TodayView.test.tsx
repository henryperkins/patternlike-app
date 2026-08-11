import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TodayView } from "./TodayView.js";
import { aiConsentCategoryLabel, formatLocalDate } from "../lib/reading-format.js";
import {
  NOT_BUILT,
  capturedFor,
  deferred,
  mockApiResponses,
  notImplemented,
  type MockResponse,
} from "../test/api-mock.js";
import {
  READING_ID,
  V5_READING_ID,
  consentGranted,
  consentNotGranted,
  errorBody,
  evidenceGraph,
  evidenceGraphV5,
  fallbackEvidenceGraph,
  fallbackResponse,
  todayResponse,
  todayResponseV5,
} from "../test/reading-fixture.js";

const TODAY = "/v1/readings/today";
const EVIDENCE = `/v1/readings/${READING_ID}/evidence`;
const EVIDENCE_V5 = `/v1/readings/${V5_READING_ID}/evidence`;
const CONSENT = "/v1/consents/ai-synthesis";

function renderToday(responses: Record<string, MockResponse>) {
  mockApiResponses(responses);
  const onUnauthorized = vi.fn();
  const view = render(<TodayView onUnauthorized={onUnauthorized} />);
  return { ...view, onUnauthorized };
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const preparing = (localDate = "2026-08-09"): MockResponse => ({
  status: 202,
  body: {
    schema_version: "0.3.0",
    status: "preparing",
    local_date: localDate,
  },
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TodayView", () => {
  it("renders every paragraph it was given, and nothing it was not", async () => {
    renderToday({ [TODAY]: ok(todayResponse) });

    for (const paragraph of todayResponse.reading.paragraphs) {
      expect(await screen.findByText(paragraph.text)).toBeInTheDocument();
    }

    // The date is the title; the placeholder headline belongs to the empty
    // states now, and the screen's only non-engine words are chrome.
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(formatLocalDate("2026-08-09"));
    expect(screen.queryByText(/horoscope/i)).not.toBeInTheDocument();
  });

  it("orders paragraphs by `order`, not by array position", async () => {
    const shuffled = {
      ...todayResponse,
      reading: {
        ...todayResponse.reading,
        paragraphs: [...todayResponse.reading.paragraphs].reverse(),
      },
    };
    const { container } = renderToday({ [TODAY]: ok(shuffled) });
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

    const text = container.textContent ?? "";
    const positions = todayResponse.reading.paragraphs.map((p) => text.indexOf(p.text));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps the lead and provenance in one editorial column", async () => {
    const { container } = renderToday({
      [TODAY]: ok(todayResponse),
      [EVIDENCE]: ok(evidenceGraph),
    });
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

    const column = container.querySelector<HTMLElement>(".today-reading");
    expect(column).not.toBeNull();

    const body = column!.querySelector<HTMLElement>(".today-body");
    const lead = column!.querySelector<HTMLElement>(".reading-block--primary_theme");
    const evidence = column!.querySelector<HTMLDetailsElement>(".today-evidence");

    expect(body).not.toBeNull();
    expect(lead).toBe(body!.firstElementChild);
    expect(evidence).toBe(body!.nextElementSibling);
  });

  it("labels a fallback reading without dressing it as a failure", async () => {
    renderToday({ [TODAY]: ok(fallbackResponse) });

    expect(
      await screen.findByText(fallbackResponse.reading.paragraphs[0]!.text),
    ).toBeInTheDocument();
    expect(screen.getByText(/not tailored to your chart/i)).toBeInTheDocument();
    expect(screen.getByText("Reviewed standing guidance")).toBeInTheDocument();
    expect(screen.queryByText("Supporting influence")).not.toBeInTheDocument();
  });

  it("shows a revision chip only above the first revision", async () => {
    const { unmount } = renderToday({ [TODAY]: ok(todayResponse) });
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
    expect(screen.queryByText(/Revised/)).not.toBeInTheDocument();
    unmount();

    const revised = {
      ...todayResponse,
      reading: { ...todayResponse.reading, revision: 3 },
    };
    renderToday({ [TODAY]: ok(revised) });
    expect(await screen.findByText("Revised · r3")).toBeInTheDocument();
  });

  it("phrases a domain preference as ranking rather than as a category", async () => {
    const preferred = {
      ...todayResponse,
      reading: { ...todayResponse.reading, domain_preference: "work" },
    };
    renderToday({ [TODAY]: ok(preferred) });

    expect(await screen.findByText("Ranked toward work")).toBeInTheDocument();
  });

  it("sends a chart-less reader to onboarding", async () => {
    renderToday({
      [TODAY]: {
        status: 404,
        body: errorBody("chart_not_found", "No active chart for user"),
      },
    });

    const link = await screen.findByRole("link", { name: /Set up your chart/i });
    expect(link).toHaveAttribute("href", "#pattern");
    expect(screen.getByText(/assembled from your own chart facts/i)).toBeInTheDocument();
  });

  it("starts a body-less ensure request and renders the server-resolved day", async () => {
    renderToday({ [TODAY]: preparing() });

    expect(
      await screen.findByRole("heading", { name: "Preparing your reading." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(formatLocalDate("2026-08-09"));

    const [request] = capturedFor(TODAY);
    expect(request!.method).toBe("PUT");
    expect(request!.body).toBeNull();
    expect(screen.queryByRole("button", { name: /Check again/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/once per local day, on a schedule/i)).not.toBeInTheDocument();
  });

  it("renders a reading automatically after the first 500 ms poll", async () => {
    vi.useFakeTimers();
    try {
      const responses: Record<string, MockResponse> = { [TODAY]: preparing() };
      const { unmount } = renderToday(responses);
      await flushEffects();
      expect(capturedFor(TODAY)).toHaveLength(1);

      responses[TODAY] = ok(todayResponse);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(capturedFor(TODAY)).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(capturedFor(TODAY)).toHaveLength(2);
      expect(
        screen.getByText(todayResponse.reading.paragraphs[0]!.text),
      ).toBeInTheDocument();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps preparation polling at five seconds", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderToday({ [TODAY]: preparing() });
      await flushEffects();
      expect(capturedFor(TODAY)).toHaveLength(1);

      for (const [elapsed, count] of [
        [499, 1],
        [1, 2],
        [999, 2],
        [1, 3],
        [1_999, 3],
        [1, 4],
        [4_999, 4],
        [1, 5],
        [4_999, 5],
        [1, 6],
      ] as const) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(elapsed);
        });
        expect(capturedFor(TODAY)).toHaveLength(count);
      }
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll after a published response", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderToday({ [TODAY]: ok(todayResponse) });
      await flushEffects();
      expect(capturedFor(TODAY)).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(capturedFor(TODAY)).toHaveLength(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one live-region message until preparation has taken 15 seconds", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderToday({ [TODAY]: preparing() });
      await flushEffects();
      const status = screen.getByRole("status");
      const initialMessage = status.textContent;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent(initialMessage ?? "");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).not.toBe(initialMessage);
      expect(status).toHaveTextContent(/taking longer/i);
      expect(status).not.toHaveTextContent(/minute|hour|shortly|soon/i);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an active ensure request when unmounted", async () => {
    const held = deferred();
    const { unmount } = renderToday({
      [TODAY]: { ...preparing(), gate: held.promise },
    });
    await vi.waitFor(() => expect(capturedFor(TODAY)).toHaveLength(1));

    const signal = capturedFor(TODAY)[0]!.signal;
    expect(signal).not.toBeNull();
    expect(signal!.aborted).toBe(false);
    unmount();
    expect(signal!.aborted).toBe(true);
    held.release();
  });

  it("does not request again when unmounted during the poll delay", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderToday({ [TODAY]: preparing() });
      await flushEffects();
      expect(capturedFor(TODAY)).toHaveLength(1);
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(capturedFor(TODAY)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collects a scheduling zone and writes it back", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TODAY]: {
        status: 409,
        body: errorBody("timezone_confirmation_required", "Confirm your scheduling time zone"),
      },
      "/v1/preferences/timezone": ok({
        schema_version: "0.3.0",
        timezone: "America/Chicago",
        source: "user_confirmed",
        timezone_revision: 1,
        updated_at: "2026-08-09T09:00:00Z",
      }),
    };
    renderToday(responses);

    const field = await screen.findByLabelText("Scheduling time zone");
    await user.clear(field);
    await user.type(field, "America/Chicago");
    await user.click(screen.getByRole("button", { name: /Confirm time zone/i }));

    const [write] = capturedFor("/v1/preferences/timezone");
    expect(write!.method).toBe("PUT");
    expect(write!.body).toEqual({ timezone: "America/Chicago", source: "user_confirmed" });
    expect(write!.headers.get("content-type")).toBe("application/json");
    expect((write!.headers.get("idempotency-key") ?? "").length).toBeGreaterThanOrEqual(8);

    // Saving the gate starts a fresh desired-state operation immediately.
    expect(
      await screen.findByText(/generated for your next local day/i),
    ).toBeInTheDocument();
    expect(capturedFor(TODAY)).toHaveLength(2);
    expect(capturedFor(TODAY).map((request) => request.method)).toEqual(["PUT", "PUT"]);
  });

  it("asks the second preference on a blank form, not on the first one's answer", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TODAY]: {
        status: 409,
        body: errorBody("timezone_confirmation_required", "Confirm your scheduling time zone"),
      },
      "/v1/preferences/timezone": ok({
        schema_version: "0.3.0",
        timezone: "America/Chicago",
        source: "user_confirmed",
        timezone_revision: 1,
        updated_at: "2026-08-09T09:00:00Z",
      }),
      "/v1/preferences/locale": ok({
        schema_version: "0.3.0",
        locale: "es-ES",
        source: "user_confirmed",
        updated_at: "2026-08-09T09:00:00Z",
      }),
    };
    renderToday(responses);

    const zone = await screen.findByLabelText("Scheduling time zone");
    await user.clear(zone);
    await user.type(zone, "America/Chicago");

    // A first-run reader has both defaults unconfirmed, so the reload this save
    // triggers answers with the *other* preference — the same component, at the
    // same position in the tree, asked a different question.
    responses[TODAY] = {
      status: 409,
      body: errorBody("locale_confirmation_required", "Confirm your content locale"),
    };
    await user.click(screen.getByRole("button", { name: /Confirm time zone/i }));

    const language = (await screen.findByLabelText("Content language")) as HTMLInputElement;
    // Carrying the zone into the language field — with its "Saved" line still
    // under it — would invite the reader to confirm "America/Chicago" as the
    // language their reading is written in, and tell them it had worked.
    expect(language.value).not.toBe("America/Chicago");
    expect(language.value).toBe(navigator.language);
    expect(screen.queryByText(/generated for your next local day/i)).not.toBeInTheDocument();

    await user.clear(language);
    await user.type(language, "es-ES");
    await user.click(screen.getByRole("button", { name: /Confirm language/i }));

    const [write] = capturedFor("/v1/preferences/locale");
    expect(write!.body).toEqual({ locale: "es-ES", source: "user_confirmed" });
  });

  it("mints a new idempotency key when the value is corrected", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TODAY]: {
        status: 409,
        body: errorBody("locale_confirmation_required", "Confirm your content locale"),
      },
      "/v1/preferences/locale": {
        status: 400,
        body: errorBody("invalid_locale", "locale must be a BCP 47 tag"),
      },
    };
    renderToday(responses);

    const field = await screen.findByLabelText("Content language");
    await user.clear(field);
    await user.type(field, "not a locale");
    await user.click(screen.getByRole("button", { name: /Confirm language/i }));
    await screen.findByText("locale must be a BCP 47 tag");

    responses["/v1/preferences/locale"] = ok({
      schema_version: "0.3.0",
      locale: "es-ES",
      source: "user_confirmed",
      updated_at: "2026-08-09T09:00:00Z",
    });
    await user.clear(field);
    await user.type(field, "es-ES");
    await user.click(screen.getByRole("button", { name: /Confirm language/i }));
    await screen.findByText(/generated for your next local day/i);

    // A preference write is value-keyed server-side: replaying the first key
    // with the corrected value is 409 idempotency_conflict, which would wedge
    // the form permanently.
    const writes = capturedFor("/v1/preferences/locale");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.headers.get("idempotency-key")).not.toBe(
      writes[1]!.headers.get("idempotency-key"),
    );
  });

  it("reuses the key when the same value is retried", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TODAY]: {
        status: 409,
        body: errorBody("locale_confirmation_required", "Confirm your content locale"),
      },
      "/v1/preferences/locale": { status: 0, body: null, unreachable: true },
    };
    renderToday(responses);

    await screen.findByLabelText("Content language");
    await user.click(screen.getByRole("button", { name: /Confirm language/i }));
    await screen.findByText("The Pattern/Like API could not be reached.");
    await user.click(screen.getByRole("button", { name: /Confirm language/i }));

    const writes = capturedFor("/v1/preferences/locale");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.headers.get("idempotency-key")).toBe(
      writes[1]!.headers.get("idempotency-key"),
    );
  });

  it("escalates a 401 instead of rendering it as a failure", async () => {
    const { onUnauthorized } = renderToday({
      [TODAY]: { status: 401, body: errorBody("unauthorized", "Authentication required") },
    });

    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    expect(screen.queryByText(/could not be reached/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it.each([
    {
      // Automatic repair has already spent every command generation for this
      // local day, so the same request cannot produce a different answer.
      label: "a terminal generation failure",
      response: {
        status: 424,
        body: {
          error: {
            ...errorBody(
              "reading_generation_failed",
              "Today's reading could not be prepared",
            ).error,
            retryable: false,
          },
        },
      },
      message: "Today's reading could not be prepared",
      requestId: "req_reading_generation_failed",
      retry: false,
    },
    {
      label: "an exhausted provider budget",
      response: {
        status: 503,
        body: {
          error: {
            ...errorBody(
              "publisher_budget_exhausted",
              "Daily reading capacity is temporarily exhausted",
            ).error,
            retryable: false,
          },
        },
      },
      message: "Daily reading capacity is temporarily exhausted",
      requestId: "req_publisher_budget_exhausted",
      retry: false,
    },
    {
      label: "a retryable calculation outage",
      response: {
        status: 503,
        body: {
          error: {
            ...errorBody("calc_unavailable", "The calculation service is unavailable")
              .error,
            retryable: true,
          },
        },
      },
      message: "The calculation service is unavailable",
      requestId: "req_calc_unavailable",
      retry: true,
    },
    {
      label: "an unavailable content release",
      response: {
        status: 503,
        body: errorBody(
          "release_unreadable",
          "The active content release is unavailable",
        ),
      },
      message: "The active content release is unavailable",
      requestId: "req_release_unreadable",
      retry: true,
    },
    {
      label: "a network rejection",
      response: { status: 0, body: null, unreachable: true },
      message: "The Pattern/Like API could not be reached.",
      requestId: null,
      retry: true,
    },
  ] satisfies Array<{
    label: string;
    response: MockResponse;
    message: string;
    requestId: string | null;
    retry: boolean;
  }>)("stops polling after $label", async ({ response, message, requestId, retry }) => {
    vi.useFakeTimers();
    try {
      const { unmount, container } = renderToday({ [TODAY]: response });
      await flushEffects();

      expect(screen.getByRole("status")).toHaveTextContent(message);
      expect(screen.queryAllByRole("button", { name: /Try again/i })).toHaveLength(
        retry ? 1 : 0,
      );
      if (requestId) expect(container).toHaveTextContent(`Request ${requestId}`);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(capturedFor(TODAY)).toHaveLength(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the retry control mounted and focused across an attempt", async () => {
    const user = userEvent.setup();
    const responses: Record<string, MockResponse> = {
      [TODAY]: { status: 0, body: null, unreachable: true },
    };
    renderToday(responses);

    expect(
      await screen.findByText("The Pattern/Like API could not be reached."),
    ).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /Try again/i });
    retry.focus();
    await user.click(retry);

    expect(document.activeElement).toBe(retry);
    expect(capturedFor(TODAY)).toHaveLength(2);
  });

  it("reports a roadmap answer without offering a retry", async () => {
    renderToday({ [TODAY]: notImplemented("Daily readings (M3)", "req_today") });

    expect(await screen.findByText(`${NOT_BUILT} (Request req_today)`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  describe("the Why this? drawer", () => {
    it("does not fetch until it is opened, and not again after that", async () => {
      const user = userEvent.setup();
      renderToday({ [TODAY]: ok(todayResponse), [EVIDENCE]: ok(evidenceGraph) });
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

      expect(capturedFor(EVIDENCE)).toHaveLength(0);

      const summary = screen.getByText("Why this reading?");
      await user.click(summary);
      await screen.findByText("How close the contact is to exact");
      expect(capturedFor(EVIDENCE)).toHaveLength(1);

      await user.click(summary);
      await user.click(summary);
      expect(capturedFor(EVIDENCE)).toHaveLength(1);
    });

    it("shows the reasons and the reviewed content behind each paragraph", async () => {
      const user = userEvent.setup();
      renderToday({ [TODAY]: ok(todayResponse), [EVIDENCE]: ok(evidenceGraph) });
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));

      expect(await screen.findByText("The weight of the moving body")).toBeInTheDocument();
      expect(screen.getByText("phase.saturn-square-sun.building")).toBeInTheDocument();
      // Which crossing of the retrograde loop, and how close — the qualifiers a
      // reader can actually do something with.
      expect(screen.getByText(/Cycle · transit · Building · 0.4° · pass 1/)).toBeInTheDocument();
      expect(screen.getByText(evidenceGraph.assembly_id)).toBeInTheDocument();
    });

    it("names each ranking factor in words rather than printing its reason code", async () => {
      // `reason` is documented in the frozen schema as machine-readable, and the
      // ranker fills it with `orb_0.42`/`transiting_saturn`. Production is the
      // case worth asserting: under vitest `DEV` is true, which is the branch
      // that keeps the code visible as developer detail.
      vi.stubEnv("DEV", false);
      try {
        const user = userEvent.setup();
        const { container } = renderToday({
          [TODAY]: ok(todayResponse),
          [EVIDENCE]: ok(evidenceGraph),
        });
        await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
        await user.click(screen.getByText("Why this reading?"));

        expect(
          await screen.findByText("How close the contact is to exact"),
        ).toBeInTheDocument();
        expect(screen.getByText("The weight of the moving body")).toBeInTheDocument();

        for (const paragraph of evidenceGraph.paragraphs) {
          for (const factor of paragraph.ranking_factors ?? []) {
            expect(container.textContent).not.toContain(factor.reason);
          }
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("keeps opaque fact ids out of what a reader is shown", async () => {
      // An opaque id tells a reader nothing and reads as leaked internals, so it
      // is developer-only. Under vitest `DEV` is true, which is the branch that
      // renders it — production is the case worth asserting.
      vi.stubEnv("DEV", false);
      try {
        const user = userEvent.setup();
        const { container } = renderToday({
          [TODAY]: ok(todayResponse),
          [EVIDENCE]: ok(evidenceGraph),
        });
        await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
        await user.click(screen.getByText("Why this reading?"));
        await screen.findByText("The weight of the moving body");

        for (const paragraph of evidenceGraph.paragraphs) {
          for (const fact of paragraph.facts) {
            expect(container.textContent).not.toContain(fact.id);
          }
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("says a fallback had no eligible fact rather than showing empty lists", async () => {
      const user = userEvent.setup();
      renderToday({
        [TODAY]: ok(fallbackResponse),
        [EVIDENCE]: ok(fallbackEvidenceGraph),
      });
      await screen.findByText(fallbackResponse.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));

      expect(
        await screen.findByText(/No chart fact was eligible to be written about today/i),
      ).toBeInTheDocument();
      expect(screen.getByText("fallback.daily.en-US")).toBeInTheDocument();
    });

    it("explains a missing provenance record and leaves the reading standing", async () => {
      const user = userEvent.setup();
      renderToday({
        [TODAY]: ok(todayResponse),
        [EVIDENCE]: { status: 404, body: errorBody("reading_not_found", "No such reading") },
      });
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));

      expect(await screen.findByText(/may have been revised/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Reload Today/i })).toBeInTheDocument();
      // The reading itself must survive its drawer failing.
      expect(screen.getByText(todayResponse.reading.paragraphs[0]!.text)).toBeInTheDocument();
    });

    it("recovers when Reload Today replaces the reading it was opened against", async () => {
      const user = userEvent.setup();
      const REISSUED_ID = "rdg_test_000000000002";
      const REISSUED_EVIDENCE = `/v1/readings/${REISSUED_ID}/evidence`;
      const responses: Record<string, MockResponse> = {
        [TODAY]: ok(todayResponse),
        [EVIDENCE]: { status: 404, body: errorBody("reading_not_found", "No such reading") },
        [REISSUED_EVIDENCE]: ok({ ...evidenceGraph, reading_id: REISSUED_ID, revision: 2 }),
      };
      renderToday(responses);
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));
      await screen.findByText(/may have been revised/i);

      // Exactly what that copy sends the reader to do. The drawer caches its
      // fetch per reading and its 404 branch does not re-arm, so the button is
      // only honest if the reissue arrives as a new drawer rather than into the
      // one still reporting the old reading missing.
      responses[TODAY] = ok({
        ...todayResponse,
        reading: { ...todayResponse.reading, reading_id: REISSUED_ID, revision: 2 },
        evidence_url: REISSUED_EVIDENCE,
      });
      await user.click(screen.getByRole("button", { name: /Reload Today/i }));
      await screen.findByText("Revised · r2");

      await user.click(screen.getByText("Why this reading?"));
      expect(
        await screen.findByText("How close the contact is to exact"),
      ).toBeInTheDocument();
      expect(capturedFor(REISSUED_EVIDENCE)).toHaveLength(1);
      expect(screen.queryByText(/may have been revised/i)).not.toBeInTheDocument();
    });

    it("is absent when the response carries no evidence url", async () => {
      renderToday({
        [TODAY]: ok({ ...todayResponse, evidence_url: null }),
      });
      await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

      expect(screen.queryByText("Why this reading?")).not.toBeInTheDocument();
    });
  });
});

describe("formatLocalDate", () => {
  /**
   * `local_date` is a civil date already resolved in the reader's scheduling
   * zone. `new Date("2026-01-01")` parses it as UTC midnight, which then renders
   * as 31 December for every browser west of UTC — the one bug on this screen
   * that would look correct to whoever wrote it.
   */
  const cases = ["Pacific/Kiritimati", "Pacific/Midway", "UTC", "Europe/Berlin"];

  for (const zone of cases) {
    it(`names the same day in ${zone}`, () => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        expect(formatLocalDate("2026-01-01")).toContain("1");
        expect(formatLocalDate("2026-01-01")).toMatch(/January/);
        expect(formatLocalDate("2026-08-09")).toMatch(/August/);
      } finally {
        process.env.TZ = original;
      }
    });
  }

  it("returns the input unchanged when it is not a date", () => {
    expect(formatLocalDate("not-a-date")).toBe("not-a-date");
    expect(formatLocalDate("")).toBe("");
  });
});

describe("the Today surface", () => {
  it("keeps one heading level and labels its article", async () => {
    const { container } = renderToday({
      [TODAY]: ok(todayResponse),
      [EVIDENCE]: ok(evidenceGraph),
    });
    await screen.findByText(todayResponse.reading.paragraphs[0]!.text);

    const article = container.querySelector("article.today-page");
    expect(article).not.toBeNull();
    expect(within(article as HTMLElement).getAllByRole("heading")).toHaveLength(1);
  });

  describe("a v5 reading", () => {
    const v5 = (): Record<string, MockResponse> => ({
      [TODAY]: ok(todayResponseV5),
      [EVIDENCE_V5]: ok(evidenceGraphV5),
    });

    it("renders the headline as the lead's quiet kicker, not a second heading", async () => {
      const { container } = renderToday(v5());
      const lead = todayResponseV5.reading.paragraphs[0]!;
      await screen.findByText(lead.text);

      const headline = screen.getByText(todayResponseV5.reading.headline);
      expect(headline).toHaveClass("kicker");
      expect(headline.tagName).toBe("P");

      // Still exactly one page title, and it is still the date.
      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent(
        formatLocalDate(todayResponseV5.reading.local_date),
      );

      // The headline introduces the lead, in the same block.
      const block = container.querySelector(".reading-block--primary_theme");
      expect(block).toContainElement(headline);
      expect(block!.firstElementChild).toBe(headline);
    });

    it("shows the provider disclosure and no reviewed-fallback language", async () => {
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text);

      expect(
        screen.getByText(todayResponseV5.reading.disclosure),
      ).toBeInTheDocument();
      expect(screen.queryByText(/not tailored to your chart/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Reviewed standing guidance/i)).not.toBeInTheDocument();
    });

    it("names a collective paragraph as everyone's, in the prose column and the drawer", async () => {
      const user = userEvent.setup();
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[1]!.text);

      expect(screen.getByText("The sky everyone shares")).toBeInTheDocument();

      await user.click(screen.getByText("Why this reading?"));
      expect(await screen.findByText("Full moon")).toBeInTheDocument();
      expect(screen.getByText("Everyone's sky")).toBeInTheDocument();
      expect(screen.getByText("Your chart")).toBeInTheDocument();
    });

    it("keeps evidence unfetched until the drawer is opened, then caches it", async () => {
      const user = userEvent.setup();
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text);
      expect(capturedFor(EVIDENCE_V5)).toHaveLength(0);

      const summary = screen.getByText("Why this reading?");
      await user.click(summary);
      expect(await screen.findByText("Generation record")).toBeInTheDocument();
      expect(capturedFor(EVIDENCE_V5)).toHaveLength(1);

      await user.click(summary);
      await user.click(summary);
      expect(capturedFor(EVIDENCE_V5)).toHaveLength(1);
    });

    it("presents three provenance layers, ending in the exact generation record", async () => {
      const user = userEvent.setup();
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));

      const layers = await screen.findAllByRole("heading", { level: 2 });
      expect(layers.map((heading) => heading.textContent)).toEqual([
        "Calculated facts",
        "Personal context",
        "Generation record",
      ]);

      // Layer three names the model exactly; the consent copy never does.
      expect(screen.getByText(/gpt-5\.6-sol/)).toBeInTheDocument();
      expect(screen.getByText(evidenceGraphV5.generation_input_id)).toBeInTheDocument();
    });

    it("shows context categories and their permitted lane, never a raw value", async () => {
      const user = userEvent.setup();
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));
      await screen.findByText("Personal context");

      // One row per category, carrying every lane it was permitted - not the
      // same category repeated once per lane, which would read as three
      // separate permissions.
      const rows = [...document.querySelectorAll(".evidence-lanes > div")].map(
        (row) => [
          row.querySelector("dt")?.textContent,
          row.querySelector("dd")?.textContent,
        ],
      );
      expect(rows).toEqual([
        ["Personal context you have enabled", "Tone · The reflection question"],
      ]);
      // The opaque handle is technical detail, not reader copy.
      expect(document.body.textContent).not.toContain("ctx_1");
    });

    it("says plainly when a paragraph rests on context rather than on a fact", async () => {
      const user = userEvent.setup();
      renderToday(v5());
      await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text);
      await user.click(screen.getByText("Why this reading?"));

      expect(
        await screen.findByText(/No calculated fact stands behind this paragraph/i),
      ).toBeInTheDocument();
    });

    it("names the calculated chart, sky, and context while it prepares", async () => {
      renderToday({
        [TODAY]: {
          status: 202,
          body: { schema_version: "0.5.0", status: "preparing", local_date: "2026-08-11" },
        },
      });

      const status = await screen.findByText(/being grounded/i);
      expect(status).toHaveAttribute("role", "status");
      expect(status).toHaveTextContent(/calculated chart/i);
      expect(status).toHaveTextContent(/calculated sky/i);
      expect(status).toHaveTextContent(/context you have enabled/i);
      expect(status).not.toHaveTextContent(/reviewed content/i);
    });
  });

  describe("the AI-synthesis consent gate", () => {
    const gate = (
      consent: MockResponse = ok(consentNotGranted),
    ): Record<string, MockResponse> => ({
      [TODAY]: {
        status: 409,
        body: errorBody(
          "ai_synthesis_consent_required",
          "Grant AI synthesis consent before a daily reading can be generated",
        ),
      },
      [`GET ${CONSENT}`]: consent,
      [`PUT ${CONSENT}`]: ok(consentGranted),
    });

    it("states the processor, purpose, categories, and every qualification", async () => {
      const { container } = renderToday(gate());
      await screen.findByRole("heading", { name: /Your reading needs your say-so/i });

      expect(await screen.findByText("OpenAI")).toBeInTheDocument();
      // The exact model is a generation-record detail, never consent copy: a
      // version bump must not silently invalidate an agreement.
      expect(document.body.textContent).not.toContain("gpt-5.6-sol");

      expect(screen.getByText(/Writing your daily reading/i)).toBeInTheDocument();
      expect(screen.getByText("v1.0.0")).toBeInTheDocument();

      // Every category the server declared, in the server's order, and no
      // eighth invented locally.
      const listed = [...container.querySelectorAll(".ai-consent-categories li")].map(
        (item) => item.textContent,
      );
      expect(listed).toEqual(
        consentNotGranted.enabled_categories.map(aiConsentCategoryLabel),
      );

      expect(screen.getByText(/not consent to train a model/i)).toBeInTheDocument();
      expect(screen.getByText(/can name people and places/i)).toBeInTheDocument();
      expect(screen.getByText(/not zero retention/i)).toBeInTheDocument();
      expect(screen.getByText(/withdraw this at any time/i)).toBeInTheDocument();
    });

    it("offers a keyboard-reachable link to the full privacy details", async () => {
      const user = userEvent.setup();
      renderToday(gate());
      await screen.findByRole("heading", { name: /Your reading needs your say-so/i });

      const link = await screen.findByRole("link", { name: /full privacy details/i });
      expect(link).toHaveAttribute("href", "#privacy");
      await user.tab();
      // Reachable by keyboard rather than only by pointer.
      expect(document.activeElement?.tagName).toBe("A");
    });

    it("grants under the displayed policy version and re-runs Today", async () => {
      const user = userEvent.setup();
      const responses = gate();
      renderToday(responses);
      const grant = await screen.findByRole("button", { name: /Agree and generate/i });

      responses[TODAY] = ok(todayResponseV5);
      responses[EVIDENCE_V5] = ok(evidenceGraphV5);
      await user.click(grant);

      const [request] = capturedFor(CONSENT).filter((call) => call.method === "PUT");
      expect(request!.body).toEqual({ policy_version: consentNotGranted.policy_version });
      expect(request!.headers.get("idempotency-key")).toMatch(/^web-ai-synthesis-/);

      expect(
        await screen.findByText(todayResponseV5.reading.paragraphs[0]!.text),
      ).toBeInTheDocument();
    });

    it("offers nothing to agree to when the terms cannot be read", async () => {
      renderToday(
        gate({ status: 503, body: errorBody("configuration_error", "Unavailable") }),
      );
      await screen.findByRole("heading", { name: /Your reading needs your say-so/i });

      expect(
        screen.queryByRole("button", { name: /Agree and generate/i }),
      ).not.toBeInTheDocument();
      expect(await screen.findByRole("status")).toHaveTextContent("Unavailable");
    });

    it("reports a refused grant without claiming it succeeded", async () => {
      const user = userEvent.setup();
      const responses = gate();
      responses[`PUT ${CONSENT}`] = {
        status: 409,
        body: errorBody(
          "consent_policy_version_stale",
          "Re-read the current AI synthesis policy and grant again",
        ),
      };
      renderToday(responses);

      await user.click(await screen.findByRole("button", { name: /Agree and generate/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /Re-read the current AI synthesis policy/i,
      );
      expect(capturedFor(TODAY)).toHaveLength(1);
    });
  });

});
