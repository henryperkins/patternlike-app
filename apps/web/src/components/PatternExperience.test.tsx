import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  PatternConsent,
  PatternRegenerationState,
  PatternResponseV7,
  PatternStateDocumentV9,
} from "@patternlike/shared";
import { PATTERN_GENERATION_CONSENT_POLICY_VERSION } from "@patternlike/shared";
import { capturedFor, mockApiResponses } from "../test/api-mock.js";
import { PatternExperience } from "./PatternExperience.js";

const STATE = "/v1/pattern-state";
const PATTERN = "/v1/pattern";
const GENERATIONS = "/v1/pattern-generations";

const consent: PatternConsent = {
  schema_version: "0.7.0",
  kind: "pattern_generation",
  status: "not_granted",
  provider: "OpenAI",
  purpose: "one_pattern_per_chart",
  policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
  enabled_categories: [
    "calculated_natal_features",
    "accuracy_and_suppression",
    "confirmed_content_locale",
    "activated_interpretation_ontology",
    "generated_pattern_plan_and_draft_for_validation",
  ],
  granted_at: null,
};

function stateDoc(overrides: Partial<PatternStateDocumentV9> = {}): PatternStateDocumentV9 {
  return {
    schema_version: "0.9.0",
    state: "consent_required",
    chart: {
      chart_id: "cht_pattern_ai_0001",
      effective_accuracy: "exact",
      feature_policy_version: "1.0.0",
    },
    consent,
    generation: null,
    pattern: null,
    regeneration: null,
    ...overrides,
  };
}

function regeneration(
  overrides: Partial<PatternRegenerationState> = {},
): PatternRegenerationState {
  return {
    eligible: false,
    generation: null,
    failure: null,
    ...overrides,
  };
}

const generated: PatternResponseV7 = {
  schema_version: "0.7.0",
  pattern_id: "pat_test_0001",
  generated_at: "2026-08-14T18:00:00.000Z",
  locale: "en-US",
  effective_accuracy: "exact",
  provenance: {
    assembly_mode: "constrained_model",
    provider: "OpenAI",
    model_family: "gpt",
    raw_birth_details_sent: false,
  },
  core_chapters: [
    {
      title: "A standing emphasis",
      summary: "The chart holds a durable emphasis that can be used without being overused.",
      sections: [{ text: "The calculated facts describe a repeating emphasis rather than a verdict." }],
      tensions: [{ text: "It can harden into overuse." }],
      resources: [{ text: "It also names a usable strength." }],
      counter_expression: { text: "The same emphasis can read as a quieter form of persistence." },
    },
  ],
  additional_signatures: [],
  uncertainty: { text: "Birth-time accuracy bounds what can be said about houses and angles." },
};

const noop = () => undefined;

describe("PatternExperience", () => {
  it("renders the generated flow for a state document, never an editorial catalogue", async () => {
    // `editorial_catalog` survives in the wire enum for clients and documents
    // written while it was emitted. Nothing emits it now, and the client has no
    // editorial branch left to route it to: an account-wide reader gets the
    // generated flow's own answer for whatever state it is in.
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({ state: "editorial_catalog", consent: null, chart: null }),
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    expect(await screen.findByText("Your Pattern is not ready.")).toBeInTheDocument();
    expect(screen.queryByText("Why this?")).toBeNull();
    expect(screen.queryByText("Holding a line under pressure")).toBeNull();
  });

  it("treats first visit as the consent surface and posts grant plus reservation together", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: { status: 200, body: stateDoc() },
      [`POST ${GENERATIONS}`]: {
        status: 202,
        body: {
          schema_version: "0.9.0",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          generation: { generation_id: "pgen_test_0001", stage: "organizing_evidence" },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    expect(await screen.findByRole("button", { name: /Generate my Pattern/i })).toBeInTheDocument();
    expect(screen.getByText(/Birth date, time, place, and coordinates are not sent/i)).toBeInTheDocument();
    expect(screen.getByText(/A successful Pattern is not a rerollable reading/i)).toBeInTheDocument();
    expect(screen.getByText("Deleting your Pattern is permanent.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Generate my Pattern/i }));
    const posted = capturedFor(GENERATIONS).find((request) => request.method === "POST");
    expect(posted?.body).toEqual({
      schema_version: "0.9.0",
      consent_policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
      confirm: "GENERATE MY PATTERN",
      reason: "first_open",
    });
    expect(posted?.headers.get("idempotency-key")).toMatch(/^web-pattern-generation-/);
  });

  it("renders the generated Pattern without claim-level Why this? evidence", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "ready",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          pattern: {
            pattern_id: "pat_test_0001",
            generated_at: generated.generated_at,
            locale: "en-US",
            effective_accuracy: "exact",
          },
        }),
      },
      [`GET ${PATTERN}`]: { status: 200, body: generated },
      [`DELETE ${PATTERN}`]: { status: 204, body: null },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    expect(await screen.findByRole("heading", { name: "A standing emphasis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A private reading of this chart" })).toBeInTheDocument();
    expect(screen.queryByText("Why this?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete this Pattern/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Delete this Pattern/i }));
    expect(screen.getByLabelText(/Type DELETE PATTERN to confirm/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm deletion/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Type DELETE PATTERN to confirm/i), "DELETE PATTERN");
    await userEvent.click(screen.getByRole("button", { name: /Confirm deletion/i }));
    const deleted = capturedFor(PATTERN).find((request) => request.method === "DELETE");
    expect(deleted?.body).toEqual({ confirm: "DELETE PATTERN" });
  });

  it("offers a source update without starting it until the reader types the exact confirmation", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "ready",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          pattern: {
            pattern_id: generated.pattern_id,
            generated_at: generated.generated_at,
            locale: generated.locale,
            effective_accuracy: generated.effective_accuracy,
          },
          regeneration: regeneration({ eligible: true }),
        }),
      },
      [`GET ${PATTERN}`]: { status: 200, body: generated },
      [`POST ${GENERATIONS}`]: {
        status: 202,
        body: {
          schema_version: "0.9.0",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          generation: { generation_id: "pgen_source_update_0001", stage: "organizing_evidence" },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);

    expect(await screen.findByRole("heading", { name: "A standing emphasis" })).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review Pattern update" });
    expect(review).toBeInTheDocument();
    expect(capturedFor(GENERATIONS).filter((request) => request.method === "POST")).toEqual([]);

    await userEvent.click(review);
    const confirmation = screen.getByLabelText(/Type REGENERATE MY PATTERN to confirm/i);
    const replace = screen.getByRole("button", { name: "Replace my Pattern" });
    expect(replace).toBeDisabled();
    await userEvent.type(confirmation, "REGENERATE MY PATTERN");
    await userEvent.dblClick(replace);

    const posts = capturedFor(GENERATIONS).filter((request) => request.method === "POST");
    expect(posts).toHaveLength(1);
    const posted = posts[0];
    expect(posted?.body).toEqual({
      schema_version: "0.9.0",
      consent_policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
      confirm: "REGENERATE MY PATTERN",
      reason: "source_update",
    });
    expect(posted?.headers.get("idempotency-key")).toMatch(/^web-pattern-regeneration-/);
  });

  it("keeps the current Pattern readable while its source update is being written", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "ready",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          pattern: {
            pattern_id: generated.pattern_id,
            generated_at: generated.generated_at,
            locale: generated.locale,
            effective_accuracy: generated.effective_accuracy,
          },
          regeneration: regeneration({
            generation: {
              generation_id: "pgen_source_update_0002",
              stage: "writing",
              status_updated_at: "2026-08-29T12:00:00.000Z",
              started_at: "2026-08-29T11:59:00.000Z",
              retryable: false,
              request_id: null,
            },
          }),
        }),
      },
      [`GET ${PATTERN}`]: { status: 200, body: generated },
    });

    render(<PatternExperience onUnauthorized={noop} />);

    expect(await screen.findByRole("heading", { name: "A standing emphasis" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Updating your Pattern");
    expect(screen.getByRole("status")).toHaveTextContent("Writing your Pattern");
    expect(screen.getByText(/current Pattern stays readable until the replacement succeeds/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review Pattern update" })).toBeNull();
  });

  it("retains the current Pattern after a failed source update and offers a confirmed retry", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "ready",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          pattern: {
            pattern_id: generated.pattern_id,
            generated_at: generated.generated_at,
            locale: generated.locale,
            effective_accuracy: generated.effective_accuracy,
          },
          regeneration: regeneration({
            eligible: true,
            failure: {
              generation_id: "pgen_source_update_failed",
              stage: "checking_claims",
              status_updated_at: "2026-08-29T12:00:00.000Z",
              started_at: "2026-08-29T11:59:00.000Z",
              retryable: true,
              request_id: null,
            },
          }),
        }),
      },
      [`GET ${PATTERN}`]: { status: 200, body: generated },
    });

    render(<PatternExperience onUnauthorized={noop} />);

    expect(await screen.findByRole("heading", { name: "A standing emphasis" })).toBeInTheDocument();
    expect(screen.getByText(/The update did not finish. Your current Pattern was not changed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try the update again" }));
    expect(screen.getByLabelText(/Type REGENERATE MY PATTERN to confirm/i)).toBeInTheDocument();
  });

  it("does not expose regeneration controls when the current Pattern uses the current source", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "ready",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          pattern: {
            pattern_id: generated.pattern_id,
            generated_at: generated.generated_at,
            locale: generated.locale,
            effective_accuracy: generated.effective_accuracy,
          },
          regeneration: regeneration(),
        }),
      },
      [`GET ${PATTERN}`]: { status: 200, body: generated },
    });

    render(<PatternExperience onUnauthorized={noop} />);

    expect(await screen.findByRole("heading", { name: "A standing emphasis" })).toBeInTheDocument();
    expect(screen.queryByText(/Pattern update available/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Pattern update/i })).toBeNull();
  });

  it.each([
    ["chart_required", "Add a birth chart before a Pattern can be written."],
    ["locale_confirmation_required", "Confirm your content language to generate a Pattern."],
    ["ontology_unavailable", "Pattern generation is not available right now."],
    ["deleted", "This Pattern was deleted and cannot be regenerated for this chart."],
    ["withdrawn", "The interpretation basis for this Pattern was withdrawn."],
  ] as const)("names the %s state in a heading a screen reader reaches", async (state, title) => {
    mockApiResponses({
      [`GET ${STATE}`]: { status: 200, body: stateDoc({ state, consent: null }) },
    });

    render(<PatternExperience onUnauthorized={noop} />);

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    // None of these states can generate, so none of them offers the action.
    expect(screen.queryByRole("button", { name: /Generate my Pattern/i })).toBeNull();
  });

  it.each(["organizing_evidence", "writing", "checking_claims"] as const)(
    "announces %s as busy progress rather than a silent wait",
    async (state) => {
      mockApiResponses({
        [`GET ${STATE}`]: {
          status: 200,
          body: stateDoc({
            state,
            generation: {
              generation_id: "pgen_progress_0001",
              stage: state,
              status_updated_at: "2026-08-27T12:00:00.000Z",
              started_at: "2026-08-27T11:59:00.000Z",
              retryable: false,
              request_id: null,
            },
          }),
        },
      });

      render(<PatternExperience onUnauthorized={noop} />);

      const status = await screen.findByRole("status");
      expect(status).toBeInTheDocument();
      expect(status.textContent).toBeTruthy();
    },
  );

  it("never generates without the reader activating the reviewed action", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: { status: 200, body: stateDoc() },
      [`POST ${GENERATIONS}`]: {
        status: 202,
        body: {
          schema_version: "0.9.0",
          consent: { ...consent, status: "granted", granted_at: "2026-08-27T12:00:00.000Z" },
          generation: { generation_id: "pgen_test_0002", stage: "organizing_evidence" },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    await screen.findByRole("button", { name: /Generate my Pattern/i });

    // Reaching the consent surface is not agreeing to it. Account-wide
    // admission changed who sees this screen, not what it takes to leave it.
    expect(capturedFor(GENERATIONS).filter((request) => request.method === "POST"))
      .toEqual([]);
  });

  it("offers a retry on a failed attempt and keeps the request shape exact", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: {
        status: 200,
        body: stateDoc({
          state: "failed",
          consent: { ...consent, status: "granted", granted_at: "2026-08-27T12:00:00.000Z" },
          generation: {
            generation_id: "pgen_failed_0001",
            stage: "writing",
            status_updated_at: "2026-08-27T12:00:00.000Z",
            started_at: "2026-08-27T11:59:00.000Z",
            retryable: true,
            request_id: null,
          },
        }),
      },
      [`POST ${GENERATIONS}`]: {
        status: 202,
        body: {
          schema_version: "0.9.0",
          consent: { ...consent, status: "granted", granted_at: "2026-08-27T12:00:00.000Z" },
          generation: { generation_id: "pgen_failed_retry", stage: "organizing_evidence" },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Generate my Pattern/i }),
    );

    const posted = capturedFor(GENERATIONS).find((request) => request.method === "POST");
    expect(posted?.body).toEqual({
      schema_version: "0.9.0",
      consent_policy_version: PATTERN_GENERATION_CONSENT_POLICY_VERSION,
      confirm: "GENERATE MY PATTERN",
      reason: "failed_attempt_retry",
    });
  });
});
