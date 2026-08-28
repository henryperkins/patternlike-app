import { describe, expect, it } from "vitest";
import {
  ApiError,
  createBirthProfile,
  ensureTodayReading,
  getAccountProcessingConsent,
  getAiSynthesisConsent,
  getReadingEvidence,
  getTiming,
  grantAiSynthesisConsent,
  grantAccountProcessingConsent,
  isDailyReadingV5,
  isReadingEvidenceV5,
  revokeAiSynthesisConsent,
  revokeAccountProcessingConsent,
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
  evidenceGraphV5Codex,
  todayResponse,
  todayResponseV5,
  todayResponseV5Codex,
} from "../test/reading-fixture.js";

const TODAY = "/v1/readings/today";
const TIMING = "/v1/timing";
const CONSENT = "/v1/consents/ai-synthesis";
const ACCOUNT_PROCESSING_CONSENT = "/v1/consents/account-processing";

const accountProcessingNotGranted = {
  schema_version: "0.8.0",
  kind: "account_processing",
  source_id: "AST-01",
  permission_tier: 0,
  allowed_uses: ["chart_fact", "cycle_detection", "uncertainty_model"],
  provider: null,
  scopes: [],
  connector_account_id: null,
  status: "not_granted",
  consent_id: null,
  account_status: "active",
  regrant_will_restore_access: false,
  policy_version: "account-processing-v1-2026-08-28",
  granted_at: null,
  ui_surface: null,
  disclosure: {
    text: "Current account-processing disclosure.",
    links: {
      patternlike_terms: "/terms.html",
      patternlike_privacy: "/privacy.html",
    },
  },
};

const accountProcessingGranted = {
  ...accountProcessingNotGranted,
  status: "granted",
  consent_id: "cns_account_processing_0001",
  granted_at: "2026-08-28T12:00:00.000Z",
  ui_surface: "onboarding",
};

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

  it("reads both publisher vintages as v5 and relabels neither", async () => {
    const path = `/v1/readings/${V5_READING_ID}/evidence`;
    expect(isReadingEvidenceV5(evidenceGraphV5Codex)).toBe(true);
    expect(evidenceGraphV5.model.provider).toBe("openai");
    expect(evidenceGraphV5Codex.model.provider).toBe("codex");

    mockApiResponses({ [path]: { status: 200, body: evidenceGraphV5Codex } });
    const fetched = await getReadingEvidence(V5_READING_ID);
    expect(isReadingEvidenceV5(fetched)).toBe(true);
    // Verbatim. A client that normalised the provider to whatever is currently
    // configured would be restating a stored artifact's provenance.
    expect((fetched as typeof evidenceGraphV5Codex).model.provider).toBe("codex");
    expect(fetched).toEqual(evidenceGraphV5Codex);
  });

  it("keeps each vintage's own disclosure sentence", () => {
    expect(isDailyReadingV5(todayResponseV5Codex)).toBe(true);
    expect(todayResponseV5.reading.disclosure).toBe(
      "Generated with OpenAI from your calculated chart and enabled context.",
    );
    expect(todayResponseV5Codex.reading.disclosure).toBe(
      "Generated with Codex by OpenAI from your calculated chart and enabled context.",
    );
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

describe("account-processing consent", () => {
  it("reads the current server-owned policy without mutation headers", async () => {
    mockApiResponses({
      [`GET ${ACCOUNT_PROCESSING_CONSENT}`]: {
        status: 200,
        body: accountProcessingNotGranted,
      },
    });

    await expect(getAccountProcessingConsent()).resolves.toEqual(
      accountProcessingNotGranted,
    );

    const [request] = capturedFor(ACCOUNT_PROCESSING_CONSENT);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(request.headers.get("idempotency-key")).toBeNull();
    expect(request.headers.get("x-consent-ui-surface")).toBeNull();
  });

  it("grants only the displayed policy under the onboarding intent", async () => {
    mockApiResponses({
      [`PUT ${ACCOUNT_PROCESSING_CONSENT}`]: {
        status: 200,
        body: accountProcessingGranted,
      },
    });

    await expect(
      grantAccountProcessingConsent(
        "account-processing-v1-2026-08-28",
        "web-account-processing-grant-0001",
        "onboarding",
      ),
    ).resolves.toEqual(accountProcessingGranted);

    const [request] = capturedFor(ACCOUNT_PROCESSING_CONSENT);
    expect(request.method).toBe("PUT");
    expect(request.body).toEqual({
      policy_version: "account-processing-v1-2026-08-28",
    });
    expect(request.headers.get("idempotency-key")).toBe(
      "web-account-processing-grant-0001",
    );
    expect(request.headers.get("x-consent-ui-surface")).toBe("onboarding");
  });

  it("echoes a newer policy version returned by the server instead of hardcoding launch", async () => {
    const currentServerPolicy: string = "account-processing-v2-2026-09-01";
    mockApiResponses({
      [`PUT ${ACCOUNT_PROCESSING_CONSENT}`]: {
        status: 200,
        body: {
          ...accountProcessingGranted,
          policy_version: currentServerPolicy,
          disclosure: {
            ...accountProcessingGranted.disclosure,
            text: "Updated current account-processing disclosure.",
          },
        },
      },
    });

    await grantAccountProcessingConsent(
      currentServerPolicy,
      "web-account-processing-grant-0002",
      "onboarding",
    );

    expect(capturedFor(ACCOUNT_PROCESSING_CONSENT)[0]!.body).toEqual({
      policy_version: currentServerPolicy,
    });
  });

  it("revokes with an empty body under the privacy-center intent", async () => {
    mockApiResponses({
      [`DELETE ${ACCOUNT_PROCESSING_CONSENT}`]: {
        status: 200,
        body: {
          ...accountProcessingNotGranted,
          account_status: "frozen",
          regrant_will_restore_access: true,
        },
      },
    });

    await revokeAccountProcessingConsent("web-account-processing-revoke-0001");

    const [request] = capturedFor(ACCOUNT_PROCESSING_CONSENT);
    expect(request.method).toBe("DELETE");
    expect(request.body).toBeNull();
    expect(request.headers.get("content-type")).toBeNull();
    expect(request.headers.get("idempotency-key")).toBe(
      "web-account-processing-revoke-0001",
    );
    expect(request.headers.get("x-consent-ui-surface")).toBe("privacy_center");
  });
});

describe("birth intent", () => {
  it("uses the caller-held idempotency key for a retryable visible intent", async () => {
    const profile = {
      accuracy: "unknown" as const,
      consent_id: "cns_account_processing_0001",
      birth_date: "1990-05-15",
      birth_time_local: null,
      timezone_hint: "America/Los_Angeles",
      approximate_window_minutes: null,
    };
    mockApiResponses({
      "/v1/birth-profiles": {
        status: 202,
        body: {
          schema_version: "0.2.0",
          workflow: "CalculateBirthChart",
          status: "queued",
          idempotency_key: "web-birth-visible-intent-0001",
          job_id: "job_birth_0001",
          resource_id: null,
        },
      },
    });

    await createBirthProfile(profile, "web-birth-visible-intent-0001");

    expect(
      capturedFor("/v1/birth-profiles")[0]!.headers.get("idempotency-key"),
    ).toBe("web-birth-visible-intent-0001");
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
