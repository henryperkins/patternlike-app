import { describe, expect, it } from "vitest";
import {
  ApiError,
  ensureTodayReading,
  getAiSynthesisConsent,
  getReadingEvidence,
  getTiming,
  grantAiSynthesisConsent,
  isDailyReadingV5,
  isReadingEvidenceV5,
  revokeAiSynthesisConsent,
  type TimingFilters,
  type TimingResponse,
} from "./api-client.js";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import {
  V5_READING_ID,
  consentGranted,
  consentNotGranted,
  evidenceGraph,
  evidenceGraphV5,
  todayResponse,
  todayResponseV5,
} from "../test/reading-fixture.js";

const TODAY = "/v1/readings/today";
const TIMING = "/v1/timing";
const CONSENT = "/v1/consents/ai-synthesis";

const timingResponse = {
  schema_version: "0.3.0" as const,
  as_of: "2026-08-10T05:15:00Z",
  calculation_status: {
    mode: "persisted_daily_reading_scan" as const,
    state: "current" as const,
    last_refresh_at: "2026-08-10T05:01:12Z",
    last_refresh_local_date: "2026-08-10",
  },
  applied_filters: {
    phase: "peak" as const,
    duration: "medium" as const,
  },
  unreadable_cycle_count: 0,
  cycles: [],
};

describe("ensureTodayReading", () => {
  it("returns the preparation response from a body-less PUT", async () => {
    const preparationResponse = {
      schema_version: "0.3.0",
      status: "preparing" as const,
      local_date: "2026-08-09",
    };
    mockApiResponses({
      [TODAY]: { status: 202, body: preparationResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(preparationResponse);

    const [request] = capturedFor(TODAY);
    expect(request.method).toBe("PUT");
    expect(request.body).toBeNull();
  });

  it("returns the published reading response unchanged", async () => {
    mockApiResponses({
      [TODAY]: { status: 200, body: todayResponse },
    });

    await expect(ensureTodayReading()).resolves.toEqual(todayResponse);
  });

  it("passes a v5 reading through the same call, untouched", async () => {
    mockApiResponses({ [TODAY]: { status: 200, body: todayResponseV5 } });

    await expect(ensureTodayReading()).resolves.toEqual(todayResponseV5);
  });
});

describe("publisher discrimination", () => {
  it("keys the reading on output_schema, not on the package version", () => {
    expect(isDailyReadingV5(todayResponseV5)).toBe(true);
    expect(isDailyReadingV5(todayResponse)).toBe(false);

    // A later package that still emits a v5 artifact is still a v5 artifact.
    expect(
      isDailyReadingV5({
        ...todayResponseV5,
        schema_version: "0.6.0",
        reading: { ...todayResponseV5.reading, schema_version: "0.6.0" },
      }),
    ).toBe(true);
  });

  it("keys the evidence graph on the record only v5 has", () => {
    expect(isReadingEvidenceV5(evidenceGraphV5)).toBe(true);
    expect(isReadingEvidenceV5(evidenceGraph)).toBe(false);
  });

  it("fetches evidence by reading id rather than by the server's own url", async () => {
    const path = `/v1/readings/${V5_READING_ID}/evidence`;
    mockApiResponses({ [path]: { status: 200, body: evidenceGraphV5 } });

    await expect(getReadingEvidence(V5_READING_ID)).resolves.toEqual(evidenceGraphV5);
    expect(capturedFor(path)[0]!.method).toBe("GET");
  });
});

describe("ApiError.retryable", () => {
  it("reads the flag when the envelope carries one", () => {
    const error = new ApiError(503, {
      error: {
        code: "publisher_budget_exhausted",
        message: "Daily reading capacity is temporarily exhausted",
        request_id: "req_1",
        retryable: false,
      },
    } as never);

    expect(error.retryable).toBe(false);
  });

  it("stays null rather than guessing when the envelope has no flag", () => {
    const error = new ApiError(503, {
      error: { code: "release_unreadable", message: "Unavailable", request_id: "req_2" },
    } as never);

    expect(error.retryable).toBeNull();
  });
});

describe("AI-synthesis consent", () => {
  it("reads the server-owned policy without sending anything", async () => {
    mockApiResponses({ [`GET ${CONSENT}`]: { status: 200, body: consentNotGranted } });

    await expect(getAiSynthesisConsent()).resolves.toEqual(consentNotGranted);

    const [request] = capturedFor(CONSENT);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(request.headers.get("idempotency-key")).toBeNull();
  });

  it("grants by echoing the displayed policy version, under an idempotency key", async () => {
    mockApiResponses({ [`PUT ${CONSENT}`]: { status: 200, body: consentGranted } });

    await expect(
      grantAiSynthesisConsent("1.0.0", "web-ai-synthesis-abc"),
    ).resolves.toEqual(consentGranted);

    const [request] = capturedFor(CONSENT);
    expect(request.method).toBe("PUT");
    // Only the policy version. The provider, purpose, and categories are the
    // server's to state; a client that sent them would be asking for agreement
    // to terms it made up.
    expect(request.body).toEqual({ policy_version: "1.0.0" });
    expect(request.headers.get("idempotency-key")).toBe("web-ai-synthesis-abc");
  });

  it("revokes with no body at all", async () => {
    mockApiResponses({ [`DELETE ${CONSENT}`]: { status: 200, body: consentNotGranted } });

    await expect(revokeAiSynthesisConsent("web-ai-synthesis-def")).resolves.toEqual(
      consentNotGranted,
    );

    const [request] = capturedFor(CONSENT);
    expect(request.method).toBe("DELETE");
    expect(request.body).toBeNull();
    expect(request.headers.get("idempotency-key")).toBe("web-ai-synthesis-def");
    expect(request.headers.get("content-type")).toBeNull();
  });

  it("surfaces a stale displayed policy as its own coded error", async () => {
    mockApiResponses({
      [`PUT ${CONSENT}`]: {
        status: 409,
        body: {
          error: {
            code: "consent_policy_version_stale",
            message: "Re-read the current AI synthesis policy and grant again",
            request_id: "req_stale",
          },
        },
      },
    });

    await expect(grantAiSynthesisConsent("0.9.0", "web-ai-synthesis-old")).rejects.toMatchObject(
      { code: "consent_policy_version_stale", status: 409 },
    );
  });
});

describe("getTiming", () => {
  it("serializes the closed phase and duration filters in contract order", async () => {
    mockApiResponses({
      [TIMING]: { status: 200, body: timingResponse },
    });

    const response: TimingResponse = await getTiming({
      phase: "peak",
      duration: "medium",
    });

    expect(response).toEqual(timingResponse);
    expect(capturedFor(TIMING)[0]!.search).toBe("?phase=peak&duration=medium");
  });

  it("omits the query delimiter when no filter is selected", async () => {
    mockApiResponses({
      [TIMING]: { status: 200, body: timingResponse },
    });

    await getTiming();

    expect(capturedFor(TIMING)[0]!.search).toBe("");
  });

  it("has no client-side domain filter", () => {
    const filters: TimingFilters = {
      // @ts-expect-error The API has no authoritative cycle-to-domain mapping.
      domain: "work",
    };

    expect(filters).toEqual({ domain: "work" });
  });
});
