import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PatternConsent, PatternResponseV7, PatternStateDocument } from "@patternlike/shared";
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

function stateDoc(overrides: Partial<PatternStateDocument> = {}): PatternStateDocument {
  return {
    schema_version: "0.7.0",
    state: "consent_required",
    chart: {
      chart_id: "cht_pattern_ai_0001",
      effective_accuracy: "exact",
      feature_policy_version: "1.0.0",
    },
    consent,
    generation: null,
    pattern: null,
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
  it("keeps the editorial catalog when the account is not in the AI cohort", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: { status: 200, body: stateDoc({ state: "editorial_catalog", consent: null, chart: null }) },
      [PATTERN]: {
        status: 200,
        body: {
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
          items: [
            {
              content_id: "pattern.one",
              content_version: "1.0.0",
              title: "Holding a line under pressure",
              summary: "A short mechanical summary of the pattern.",
              body: "The longer reviewed description.",
              resources: [],
              tensions: [],
              counter_expression: "The same configuration can read as patience.",
              evidence: [{ feature_id: "nft_1", feature_class: "aspect", label: "mars square saturn" }],
            },
          ],
          next_cursor: null,
          omissions: { accuracy: 0, houses_or_angles: 0, locale: 0, predicate_mismatch: 0 },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    expect(await screen.findByText("Holding a line under pressure")).toBeInTheDocument();
    expect(screen.getByText("Why this?")).toBeInTheDocument();
  });

  it("treats first visit as the consent surface and posts grant plus reservation together", async () => {
    mockApiResponses({
      [`GET ${STATE}`]: { status: 200, body: stateDoc() },
      [`POST ${GENERATIONS}`]: {
        status: 202,
        body: {
          schema_version: "0.7.0",
          consent: { ...consent, status: "granted", granted_at: "2026-08-14T18:00:00.000Z" },
          generation: { generation_id: "pgen_test_0001", stage: "organizing_evidence" },
        },
      },
    });

    render(<PatternExperience onUnauthorized={noop} />);
    expect(await screen.findByRole("button", { name: /Generate my Pattern/i })).toBeInTheDocument();
    expect(screen.getByText(/Birth date, time, place, and coordinates are not sent/i)).toBeInTheDocument();
    expect(screen.getByText("A successful Pattern cannot be rerolled for this chart.")).toBeInTheDocument();
    expect(screen.getByText("Deleting your Pattern is permanent.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Generate my Pattern/i }));
    const posted = capturedFor(GENERATIONS).find((request) => request.method === "POST");
    expect(posted?.body).toEqual({
      schema_version: "0.7.0",
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
});
