import type {
  AiSynthesisConsent,
  DailyReadingResponseV3,
  DailyReadingResponseV5,
  ReadingEvidenceV3,
  ReadingEvidenceV5,
} from "../lib/api-client.js";

/**
 * A themed reading in the shape `GET /v1/readings/today` actually returns.
 *
 * Field-for-field what `apps/api/src/routes/readings.ts` projects, so a change
 * to that projection that these tests do not notice is a change the API
 * integration suite's contract assertion will.
 */
export const READING_ID = "rdg_test_000000000001";

export const todayResponse: DailyReadingResponseV3 = {
  schema_version: "0.3.0",
  reading: {
    schema_version: "0.3.0",
    output_schema: "daily-reading-v3",
    reading_id: READING_ID,
    local_date: "2026-08-09",
    generated_at: "2026-08-09T09:00:00Z",
    assembly_mode: "deterministic",
    revision: 1,
    locale: "en-US",
    domain_preference: null,
    fallback_used: false,
    paragraphs: [
      {
        paragraph_id: "par_test_00000000001",
        role: "primary_theme",
        order: 1,
        text: "Steady pressure asks for a smaller, firmer commitment than the one you had in mind.",
      },
      {
        paragraph_id: "par_test_00000000002",
        role: "phase_context",
        order: 2,
        text: "This is the building stretch: the shape is set, the work is repetition.",
      },
      {
        paragraph_id: "par_test_00000000003",
        role: "timing",
        order: 3,
        text: "Closest on 2026-08-02, easing by 2027-01-26.",
      },
      {
        paragraph_id: "par_test_00000000004",
        role: "reflection",
        order: 4,
        text: "What would you keep doing if no one noticed for a month?",
      },
    ],
  },
  evidence_url: `/v1/readings/${READING_ID}/evidence`,
};

export const fallbackResponse: DailyReadingResponseV3 = {
  schema_version: "0.3.0",
  reading: {
    ...todayResponse.reading,
    fallback_used: true,
    paragraphs: [
      {
        paragraph_id: "par_test_fallback0001",
        role: "safety_fallback",
        order: 1,
        text: "Nothing in the sky is pressing on your chart today. A quiet day is still a day worth noticing.",
      },
    ],
  },
  evidence_url: `/v1/readings/${READING_ID}/evidence`,
};

export const evidenceGraph: ReadingEvidenceV3 = {
  schema_version: "0.3.0",
  reading_id: READING_ID,
  revision: 1,
  revision_reason: "initial",
  assembly_id: "asm_97e0e939b208250aecdde02747d367af",
  release_version: "release-12",
  created_at: "2026-08-09T09:00:00Z",
  paragraphs: [
    {
      paragraph_id: "par_test_00000000001",
      role: "primary_theme",
      evidence_lane: "celestial_facts",
      facts: [
        {
          id: "cyc_11111111111111111111111111111111",
          fact_type: "cycle_instance",
          phase: "building",
          orb_deg: 0.42,
          technique: "transit",
          pass_index: 1,
        },
      ],
      content: [
        {
          fragment_id: "phase.saturn-square-sun.building",
          content_version: "3",
          release_version: "release-12",
          content_type: "astrology_phase",
        },
      ],
      context_signals: [],
      /*
       * What `scoreFact` actually emits for this contact, not invented prose.
       *
       * `reason` is a machine code by contract — the weights below are the
       * ranker's own rounded contributions for a Saturn square Sun at 0.42°.
       * A fixture that read like a sentence let the drawer print codes to
       * production readers while these tests looked correct.
       */
      ranking_factors: [
        { factor: "exactness", weight: 0.258, reason: "orb_0.42" },
        { factor: "body_importance", weight: 0.17, reason: "transiting_saturn" },
      ],
    },
    {
      paragraph_id: "par_test_00000000003",
      role: "timing",
      evidence_lane: "celestial_facts",
      facts: [
        {
          id: "cyp_22222222222222222222222222222222",
          fact_type: "exact_pass",
          phase: null,
          orb_deg: null,
          technique: "transit",
          pass_index: 1,
        },
      ],
      content: [
        {
          fragment_id: "timing.default.en-US",
          content_version: "1",
          release_version: "release-12",
          content_type: "timing_template",
        },
      ],
      context_signals: [],
      ranking_factors: [],
    },
  ],
};

export const fallbackEvidenceGraph: ReadingEvidenceV3 = {
  ...evidenceGraph,
  paragraphs: [
    {
      paragraph_id: "par_test_fallback0001",
      role: "safety_fallback",
      evidence_lane: "operational",
      facts: [],
      content: [
        {
          fragment_id: "fallback.daily.en-US",
          content_version: "2",
          release_version: "release-12",
          content_type: "fallback_copy",
        },
      ],
      context_signals: [],
      ranking_factors: [],
    },
  ],
};

export function errorBody(code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, request_id: `req_${code}`, ...(details ? { details } : {}) } };
}

/**
 * The v5 artifact, field-for-field what `projectReadingV5` emits.
 *
 * No `fallback_used` and no `release_version`: v5 has neither, and a fixture
 * carrying them would let the reader keep rendering a pipeline that did not
 * write this reading.
 */
export const V5_READING_ID = "rdg_test_v5000000001";

export const todayResponseV5: DailyReadingResponseV5 = {
  schema_version: "0.5.0",
  reading: {
    schema_version: "0.5.0",
    output_schema: "daily-reading-v5",
    reading_id: V5_READING_ID,
    local_date: "2026-08-11",
    generated_at: "2026-08-10T23:30:00Z",
    assembly_mode: "constrained_model",
    revision: 1,
    locale: "en-US",
    domain_preference: null,
    headline: "A narrower commitment",
    disclosure:
      "Generated with OpenAI from your calculated chart and enabled context.",
    paragraphs: [
      {
        paragraph_id: "par_test_v50000000001",
        role: "primary_theme",
        order: 1,
        text: "Saturn is square your Sun today, and the pressure asks for a smaller promise than the one you had in mind.",
      },
      {
        paragraph_id: "par_test_v50000000002",
        role: "collective_context",
        order: 2,
        text: "The Moon is full tonight for everyone; it is not a private signal about your week.",
      },
      {
        paragraph_id: "par_test_v50000000003",
        role: "reflection",
        order: 3,
        text: "What would you keep doing if no one noticed for a month?",
      },
    ],
  },
  evidence_url: `/v1/readings/${V5_READING_ID}/evidence`,
};

export const evidenceGraphV5: ReadingEvidenceV5 = {
  schema_version: "0.5.0",
  reading_id: V5_READING_ID,
  revision: 1,
  revision_reason: "initial",
  generated_at: "2026-08-10T23:30:00Z",
  generation_input_id: `gin_sha256_${"b".repeat(64)}`,
  input_manifest_hash: `sha256:${"c".repeat(64)}`,
  content_hash: `sha256:${"d".repeat(64)}`,
  provider_response_hash: `sha256:${"e".repeat(64)}`,
  calculation: {
    chart_contract_id: "calc-contract-launch",
    cycle_policy_version: "1.4.0",
    daily_sky_policy_version: "1.0.0",
    ephemeris_data_version: "swisseph-2.10.03",
    container_digest: `sha256:${"f".repeat(64)}`,
    tzdb_version: "2025b",
    local_day_resolution_policy_version: "1.0.0",
  },
  model: {
    provider: "openai",
    model: "gpt-5.6-sol",
    prompt_version: "1.0.0",
    selection_policy_version: "1.0.0",
    validation_policy_version: "1.0.0",
    provider_request_id: "resp_test_0001",
    input_tokens: 4210,
    output_tokens: 512,
  },
  paragraphs: [
    {
      paragraph_id: "par_test_v50000000001",
      role: "primary_theme",
      order: 1,
      fact_refs: [
        {
          fact_id: `cyc_${"1".repeat(32)}`,
          fact_class: "cycle_instance",
          label: "Saturn square your Sun, building",
          scope: "personalized",
        },
      ],
      context_refs: [
        { private_ref: "ctx_1", category: "enabled_personal_context", allowed_use: "tone" },
      ],
    },
    {
      paragraph_id: "par_test_v50000000002",
      role: "collective_context",
      order: 2,
      fact_refs: [
        {
          fact_id: `dsf_${"2".repeat(32)}`,
          fact_class: "lunar_phase",
          label: "Full moon",
          scope: "collective",
        },
      ],
      context_refs: [],
    },
    {
      paragraph_id: "par_test_v50000000003",
      role: "reflection",
      order: 3,
      fact_refs: [],
      context_refs: [
        {
          private_ref: "ctx_2",
          category: "enabled_personal_context",
          allowed_use: "reflection_prompt",
        },
      ],
    },
  ],
  validation: {
    status: "passed",
    policy_version: "1.0.0",
    checks: [
      { code: "grounding", passed: true },
      { code: "vocabulary", passed: true },
    ],
  },
};

/**
 * The same reader-facing artifact published through the Codex runner.
 *
 * Kept beside the OpenAI vintage rather than replacing it: both are readable at
 * once in production, and a browser that could only render one of them would be
 * hiding half its own history.
 */
export const todayResponseV5Codex: DailyReadingResponseV5 = {
  ...todayResponseV5,
  reading: {
    ...todayResponseV5.reading,
    disclosure:
      "Generated with Codex by OpenAI from your calculated chart and enabled context.",
  },
};

export const evidenceGraphV5Codex: ReadingEvidenceV5 = {
  ...evidenceGraphV5,
  model: {
    ...evidenceGraphV5.model,
    provider: "codex",
    // The safe provider-side thread handle the runner reported. Never the
    // Codex control-job id, its lease token, or an artifact key.
    provider_request_id: "thread_test_0001",
  },
};

/** The seven server-owned categories, in the order the API returns them. */
export const AI_CONSENT_CATEGORIES = [
  "birth_accuracy_and_uncertainty",
  "calculated_natal_facts",
  "active_calculated_cycles",
  "calculated_daily_sky",
  "enabled_personal_context",
  "prior_reading_excerpts",
  "reading_feedback",
];

export const consentNotGranted: AiSynthesisConsent = {
  kind: "ai_synthesis",
  status: "not_granted",
  // The wire field keeps its name and its value: it identifies the data
  // PROCESSOR, which is still OpenAI. The generation service is Codex, and the
  // consent copy names it separately.
  provider: "OpenAI",
  purpose: "daily_reading_generation",
  policy_version: "1.1.0",
  enabled_categories: AI_CONSENT_CATEGORIES,
  granted_at: null,
};

export const consentGranted: AiSynthesisConsent = {
  ...consentNotGranted,
  status: "granted",
  granted_at: "2026-08-10T18:04:00Z",
};
