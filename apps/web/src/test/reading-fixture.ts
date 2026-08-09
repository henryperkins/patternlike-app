import type { DailyReadingResponse, ReadingEvidence } from "../lib/api-client.js";

/**
 * A themed reading in the shape `GET /v1/readings/today` actually returns.
 *
 * Field-for-field what `apps/api/src/routes/readings.ts` projects, so a change
 * to that projection that these tests do not notice is a change the API
 * integration suite's contract assertion will.
 */
export const READING_ID = "rdg_test_000000000001";

export const todayResponse: DailyReadingResponse = {
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

export const fallbackResponse: DailyReadingResponse = {
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

export const evidenceGraph: ReadingEvidence = {
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

export const fallbackEvidenceGraph: ReadingEvidence = {
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
