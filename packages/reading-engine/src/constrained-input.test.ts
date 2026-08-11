/**
 * The one eligibility-and-identity entry point for constrained-model readings.
 *
 * These tests exist because `prepareConstrainedReadingInput()` is the only place
 * the product decides what a model is allowed to see. Every assertion here is
 * about what does NOT reach the provider: an ineligible source, a lane nobody
 * granted, a birth instant, a storage id, or a byte over the ceiling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  M5_SUPPORTED_USES,
  type CelestialBody,
  type DailySkyFact,
  type M5AllowedUse,
} from "@patternlike/shared";

import { INGESTIBLE_SOURCES } from "./source-allowlist.generated.js";
import {
  MAX_CONTEXT_TEXT_BYTES,
  MAX_FEEDBACK_RECORDS,
  MAX_PRIOR_READINGS,
  SELECTION_POLICY_VERSION,
  type ConstrainedContextSignalInput,
  type ConstrainedContextSourceInput,
  type ConstrainedReadingInput,
} from "./constrained-types.js";
import {
  ConstrainedInputError,
  prepareConstrainedReadingInput,
  utf8ByteLength,
} from "./constrained-input.js";
import type { NormalizedCycle } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const hex32 = (seed: string): string => {
  // A deterministic 32-hex handle. Not a digest — the compiler never hashes.
  let out = "";
  for (let i = 0; out.length < 32; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i;
    out += (code % 16).toString(16);
  }
  return out;
};

const hex64 = (seed: string): string => hex32(seed) + hex32(seed + "!");

const CYCLE: NormalizedCycle = {
  id: "cyc_" + hex32("saturn-square-sun"),
  technique: "transit",
  body: "saturn",
  target: "sun",
  aspect: "square",
  start_at: "2026-07-19T05:22:10Z",
  exact_at: "2026-08-02T14:11:07Z",
  end_at: "2027-01-26T18:44:02Z",
  pass_count: 1,
  orb_deg: 0.42,
  passes: [
    {
      pass_index: 1,
      direction: "direct",
      exact_at: "2026-08-02T14:11:07Z",
      speed_deg_per_day: 0.0331,
    },
  ],
};

function anchorFact(body: CelestialBody, longitude: number, seed: string): DailySkyFact {
  return {
    fact_id: "dsf_" + hex32(seed),
    content_digest: hex64(seed),
    kind: "anchor_position",
    scope: "collective",
    effective_at: "2026-07-30T19:00:00Z",
    label: `${body === "sun" ? "Sun" : "Moon"} at ${longitude.toFixed(2)} degrees Leo`,
    precision: { longitude_decimals: 6, instant_resolution_seconds: null },
    detail: {
      body,
      longitude_deg: longitude,
      sign: "leo",
      sign_degree_deg: longitude - 120,
      speed_deg_per_day: 1,
      retrograde: false,
    },
    daily_sky_policy_id: "daily-sky-launch",
    daily_sky_policy_version: "1.0.0",
    calculation_policy_id: "transit-scan-launch",
    calculation_policy_version: "1.4.0",
    ephemeris_data_version: "swisseph-2.10.03",
    container_digest: hex64("container"),
  };
}

const LUNAR_PHASE_FACT: DailySkyFact = {
  fact_id: "dsf_" + hex32("lunar-phase"),
  content_digest: hex64("lunar-phase"),
  kind: "lunar_phase",
  scope: "collective",
  effective_at: "2026-07-30T19:00:00Z",
  label: "Waxing gibbous Moon",
  precision: { longitude_decimals: 6, instant_resolution_seconds: null },
  detail: { phase: "waxing_gibbous", elongation_deg: 143.2, illuminated_fraction: 0.9 },
  daily_sky_policy_id: "daily-sky-launch",
  daily_sky_policy_version: "1.0.0",
  calculation_policy_id: "transit-scan-launch",
  calculation_policy_version: "1.4.0",
  ephemeris_data_version: "swisseph-2.10.03",
  container_digest: hex64("container"),
};

const CONTACT_FACT: DailySkyFact = {
  fact_id: "dsf_" + hex32("contact"),
  content_digest: hex64("contact"),
  kind: "transit_natal_contact",
  scope: "personalized",
  effective_at: "2026-07-30T14:11:07Z",
  label: "Transiting Saturn exactly square natal Sun",
  precision: { longitude_decimals: null, instant_resolution_seconds: 1 },
  detail: {
    transiting_body: "saturn",
    natal_target: "sun",
    aspect: "square",
    direction: "direct",
    speed_deg_per_day: 0.03,
  },
  daily_sky_policy_id: "daily-sky-launch",
  daily_sky_policy_version: "1.0.0",
  calculation_policy_id: "transit-scan-launch",
  calculation_policy_version: "1.4.0",
  ephemeris_data_version: "swisseph-2.10.03",
  container_digest: hex64("container"),
};

const MOON_CONTACT_FACT: DailySkyFact = {
  ...CONTACT_FACT,
  fact_id: "dsf_" + hex32("moon-contact"),
  content_digest: hex64("moon-contact"),
  label: "Transiting Venus exactly trine natal Moon",
  detail: {
    transiting_body: "venus",
    natal_target: "moon",
    aspect: "trine",
    direction: "direct",
    speed_deg_per_day: 1.1,
  },
};

const HOUSE_FACT: DailySkyFact = {
  fact_id: "dsf_" + hex32("house"),
  content_digest: hex64("house"),
  kind: "house_placement",
  scope: "personalized",
  effective_at: "2026-07-30T19:00:00Z",
  label: "Transiting Saturn in the seventh house",
  precision: { longitude_decimals: 6, instant_resolution_seconds: null },
  detail: {
    body: "saturn",
    house: 7,
    house_system: "placidus",
    longitude_deg: 12.5,
  },
  daily_sky_policy_id: "daily-sky-launch",
  daily_sky_policy_version: "1.0.0",
  calculation_policy_id: "transit-scan-launch",
  calculation_policy_version: "1.4.0",
  ephemeris_data_version: "swisseph-2.10.03",
  container_digest: hex64("container"),
};

const SUN_ANCHOR = anchorFact("sun", 127.4, "anchor-sun");
const MOON_ANCHOR = anchorFact("moon", 270.6, "anchor-moon");

function source(
  sourceId: string,
  uses: readonly string[],
  overrides: Partial<ConstrainedContextSourceInput> = {},
): ConstrainedContextSourceInput {
  const consentId = "cns_" + sourceId.toLowerCase().replace("-", "");
  return {
    source_id: sourceId,
    permission_state: "active",
    permission_allowed_uses: [...uses],
    permission_consent_id: consentId,
    consent_id: consentId,
    consent_source_id: sourceId,
    consent_status: "granted",
    consent_version: 1,
    consent_allowed_uses: [...uses],
    ...overrides,
  };
}

function signal(
  signalId: string,
  sourceId: string,
  uses: readonly string[],
  observedAt: string,
  overrides: Partial<ConstrainedContextSignalInput> = {},
): ConstrainedContextSignalInput {
  return {
    signal_id: signalId,
    source_id: sourceId,
    category: "enabled_personal_context",
    allowed_uses: [...uses],
    evidence_lane: "user_and_context",
    normalized_hash: hex64(signalId),
    freshness_status: "fresh",
    observed_at: observedAt,
    content: { kind: "text", text: `note ${signalId}` },
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<ConstrainedReadingInput> = {},
): ConstrainedReadingInput {
  return {
    schema_version: "0.5.0",
    prompt_version: "1.0.0",
    output_schema: "daily-reading-v5",
    selection_policy_version: SELECTION_POLICY_VERSION,
    validation_policy_version: "1.0.0",
    context_max_bytes: 98304,
    target_local_date: "2026-07-30",
    target_timezone: "America/Chicago",
    locale: "en-US",
    generation_anchor: "2026-07-29T23:30:00Z",
    revision: 1,
    domain_preference: null,
    consent_categories: [
      "birth_accuracy_and_uncertainty",
      "calculated_natal_facts",
      "active_calculated_cycles",
      "calculated_daily_sky",
      "enabled_personal_context",
      "prior_reading_excerpts",
      "reading_feedback",
    ],
    day: {
      day_start_at: "2026-07-30T05:00:00Z",
      day_end_at: "2026-07-31T05:00:00Z",
      anchor_at: "2026-07-30T17:00:00Z",
      anchor_resolution: "unique",
      tzdb_version: "2025b",
      local_day_resolution_policy_version: "1.0.0",
    },
    chart: {
      fingerprint: hex64("chart"),
      contract_id: "calc-contract-launch",
      contract_version: "0.2.0",
      container_digest: hex64("container"),
      effective_accuracy: "exact",
      uncertainty: {
        accuracy: "exact",
        window_plus_minus_minutes: null,
        suppressed_features: [],
        qualified_features: [],
      },
    },
    cycle_scan: {
      policy_id: "transit-scan-launch",
      policy_version: "1.4.0",
      orb_policy_id: "orb-launch",
      orb_policy_version: "1.0.0",
      request_digest: hex64("cycle-request"),
      response_digest: hex64("cycle-response"),
      container_digest: hex64("container"),
      ephemeris_data_version: "swisseph-2.10.03",
    },
    cycles: [CYCLE],
    daily_sky: {
      policy_id: "daily-sky-launch",
      policy_version: "1.0.0",
      orb_policy_id: null,
      orb_policy_version: null,
      request_digest: hex64("sky-request"),
      response_digest: hex64("sky-response"),
      container_digest: hex64("container"),
      ephemeris_data_version: "swisseph-2.10.03",
    },
    daily_sky_facts: [SUN_ANCHOR, MOON_ANCHOR, LUNAR_PHASE_FACT, CONTACT_FACT],
    natal_facts: [
      {
        fact_id: "nat_" + hex32("natal-sun"),
        fact_class: "natal_position",
        body: "sun",
        target: null,
        aspect: null,
        sign: "capricorn",
        degree_deg: 1.774002,
        house: null,
      },
    ],
    context_sources: [],
    context_signals: [],
    prior_readings: [],
    ...overrides,
  };
}

const ALL_FACT_IDS = (
  prepared: ReturnType<typeof prepareConstrainedReadingInput>,
): string[] => prepared.request.facts.map((f) => f.fact_id);

// ---------------------------------------------------------------------------
// Facts: always complete, always ordered, never birth data
// ---------------------------------------------------------------------------

test("every eligible calculated fact is included before any context budgeting", () => {
  const prepared = prepareConstrainedReadingInput(baseInput());

  assert.equal(prepared.request.facts.length, 6);
  assert.deepEqual(
    prepared.request.facts.map((f) => f.fact_class).sort(),
    [
      "anchor_position",
      "anchor_position",
      "cycle_instance",
      "lunar_phase",
      "natal_position",
      "transit_natal_contact",
    ],
  );
});

test("facts are ordered by (lane_rank, fact_id) and lanes follow reading priority", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({ daily_sky_facts: [SUN_ANCHOR, MOON_ANCHOR, LUNAR_PHASE_FACT, CONTACT_FACT, HOUSE_FACT] }),
  );

  const byId = new Map(prepared.request.facts.map((f) => [f.fact_id, f]));
  assert.equal(byId.get(CYCLE.id)?.lane_rank, 1);
  assert.equal(byId.get(CONTACT_FACT.fact_id)?.lane_rank, 2);
  assert.equal(byId.get(HOUSE_FACT.fact_id)?.lane_rank, 2);
  assert.equal(byId.get(LUNAR_PHASE_FACT.fact_id)?.lane_rank, 3);
  assert.equal(byId.get(SUN_ANCHOR.fact_id)?.lane_rank, 3);
  assert.equal(byId.get(prepared.request.facts.at(-1)!.fact_id)?.lane_rank, 4);

  const ordered = [...prepared.request.facts].sort((a, b) =>
    a.lane_rank !== b.lane_rank
      ? a.lane_rank - b.lane_rank
      : a.fact_id < b.fact_id
        ? -1
        : a.fact_id > b.fact_id
          ? 1
          : 0,
  );
  assert.deepEqual(ALL_FACT_IDS(prepared), ordered.map((f) => f.fact_id));
});

test("a zero-cycle day is still a factual day", () => {
  const prepared = prepareConstrainedReadingInput(baseInput({ cycles: [] }));

  assert.ok(prepared.request.facts.length >= 2);
  assert.ok(prepared.request.facts.some((f) => f.fact_class === "anchor_position"));
  assert.ok(prepared.request.facts.some((f) => f.fact_class === "lunar_phase"));
  assert.ok(!prepared.request.facts.some((f) => f.fact_class === "cycle_instance"));
});

test("a day with no calculated fact at all fails closed", () => {
  assert.throws(
    () =>
      prepareConstrainedReadingInput(
        baseInput({ cycles: [], daily_sky_facts: [], natal_facts: [] }),
      ),
    ConstrainedInputError,
  );
});

test("the provider packet carries no birth instant, coordinates, timezone, or storage id", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-02", ["life_domain_selection", "reflection_prompt", "theme_ranking"])],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z", {
          content: { kind: "text", text: "Third week of the migration." },
        }),
      ],
      prior_readings: [
        {
          local_date: "2026-07-29",
          headline: "A narrower commitment",
          lead: "The pressure is not asking for more effort.",
          reflection_prompt: "Which obligation would you keep?",
        },
      ],
    }),
  );

  const serialized = JSON.stringify(prepared.request);
  for (const forbidden of [
    "America/Chicago",
    "sig_1",
    "USR-02",
    "cns_usr02",
    hex64("chart"),
    "fingerprint",
    "user_id",
    "reading_key",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `packet leaked ${forbidden}`);
  }
  assert.equal("chart_fingerprint" in prepared.request, false);
});

// ---------------------------------------------------------------------------
// Uncertainty suppression
// ---------------------------------------------------------------------------

test("an unknown birth time suppresses houses, angles, and time-sensitive Moon facts", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      daily_sky_facts: [SUN_ANCHOR, LUNAR_PHASE_FACT, CONTACT_FACT, MOON_CONTACT_FACT, HOUSE_FACT],
      natal_facts: [
        {
          fact_id: "nat_" + hex32("natal-asc"),
          fact_class: "natal_position",
          body: "ascendant",
          target: null,
          aspect: null,
          sign: "virgo",
          degree_deg: 3.2,
          house: null,
        },
      ],
      chart: {
        ...baseInput().chart,
        effective_accuracy: "unknown",
        uncertainty: {
          accuracy: "unknown",
          window_plus_minus_minutes: null,
          suppressed_features: [
            { feature_class: "houses", feature_id: null, reason: "unknown_birth_time" },
            { feature_class: "angles", feature_id: null, reason: "unknown_birth_time" },
            { feature_class: "angle_transits", feature_id: null, reason: "unknown_birth_time" },
            {
              feature_class: "moon_time_sensitive",
              feature_id: null,
              reason: "unknown_birth_time",
            },
          ],
          qualified_features: [],
        },
      },
    }),
  );

  const ids = ALL_FACT_IDS(prepared);
  assert.equal(ids.includes(HOUSE_FACT.fact_id), false);
  assert.equal(ids.includes(MOON_CONTACT_FACT.fact_id), false);
  assert.equal(ids.some((id) => id.startsWith("nat_")), false);
  assert.equal(prepared.request.birth_time_accuracy, "unknown");
  assert.deepEqual(prepared.request.suppressed_features.slice().sort(), [
    "angle_transits",
    "angles",
    "houses",
    "moon_time_sensitive",
  ]);
  assert.equal(prepared.request.composition.uncertainty_note_required, true);
  assert.ok(
    prepared.rejections.some(
      (r) => r.subject_id === HOUSE_FACT.fact_id && r.subject_kind === "fact",
    ),
  );
});

test("an approximate birth time qualifies rather than suppresses", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      daily_sky_facts: [SUN_ANCHOR, LUNAR_PHASE_FACT, CONTACT_FACT, HOUSE_FACT],
      chart: {
        ...baseInput().chart,
        effective_accuracy: "approximate",
        uncertainty: {
          accuracy: "approximate",
          window_plus_minus_minutes: 30,
          suppressed_features: [],
          qualified_features: [{ feature_id: "houses", qualification: "approximate_only" }],
        },
      },
    }),
  );

  assert.ok(ALL_FACT_IDS(prepared).includes(HOUSE_FACT.fact_id));
  assert.equal(prepared.request.birth_time_accuracy, "approximate");
  assert.equal(prepared.request.composition.uncertainty_note_required, true);
});

test("an exact birth time needs no uncertainty note", () => {
  const prepared = prepareConstrainedReadingInput(baseInput());
  assert.equal(prepared.request.composition.uncertainty_note_required, false);
});

test("a chart whose effective accuracy disagrees with its uncertainty report fails closed", () => {
  assert.throws(
    () =>
      prepareConstrainedReadingInput(
        baseInput({
          chart: {
            ...baseInput().chart,
            effective_accuracy: "exact",
            uncertainty: {
              accuracy: "unknown",
              window_plus_minus_minutes: null,
              suppressed_features: [],
              qualified_features: [],
            },
          },
        }),
      ),
    ConstrainedInputError,
  );
});

// ---------------------------------------------------------------------------
// Context eligibility
// ---------------------------------------------------------------------------

test("one pin is produced per signal/use pair inside the exact intersection", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("CLD-06", ["journal_import", "narrative_continuity", "user_memory"])],
      context_signals: [
        signal(
          "sig_journal",
          "CLD-06",
          ["journal_import", "narrative_continuity", "user_memory", "theme_ranking"],
          "2026-07-29T10:00:00Z",
        ),
      ],
    }),
  );

  assert.deepEqual(
    prepared.request.context.map((c) => c.allowed_use).sort(),
    ["narrative_continuity", "user_memory"],
  );
  // journal_import is not an M5 lane; theme_ranking is not granted for CLD-06.
  assert.equal(prepared.selected_context.length, 2);
  assert.deepEqual(
    prepared.selected_context.map((c) => c.signal_id),
    ["sig_journal", "sig_journal"],
  );
  assert.deepEqual(
    prepared.request.context.map((c) => c.context_ref),
    ["ctx_1", "ctx_2"],
  );
});

test("every M5 supported use can be pinned by some registry source", () => {
  const covered = new Set<M5AllowedUse>();
  for (const use of M5_SUPPORTED_USES) {
    let sourceId: string | null = null;
    for (const [id, uses] of INGESTIBLE_SOURCES) {
      if (uses.includes(use)) {
        sourceId = id;
        break;
      }
    }
    assert.ok(sourceId, `no registry source permits ${use}`);
    const uses = INGESTIBLE_SOURCES.get(sourceId!)!;
    const prepared = prepareConstrainedReadingInput(
      baseInput({
        context_sources: [source(sourceId!, uses)],
        context_signals: [signal("sig_" + use, sourceId!, [use], "2026-07-29T10:00:00Z")],
      }),
    );
    const pinned = prepared.request.context.find((c) => c.allowed_use === use);
    assert.ok(pinned, `${use} produced no pin through ${sourceId}`);
    covered.add(use);
  }
  assert.equal(covered.size, M5_SUPPORTED_USES.length);
});

test("a source outside the registry allowlist is rejected by the shared partition", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("AMB-12", ["theme_ranking"])],
      context_signals: [signal("sig_news", "AMB-12", ["theme_ranking"], "2026-07-29T10:00:00Z")],
    }),
  );

  assert.equal(prepared.request.context.length, 0);
  assert.ok(
    prepared.rejections.some(
      (r) => r.reason_code === "context_source_not_in_registry_allowlist",
    ),
    "the engine must reuse contextRejection(), not reimplement the registry gate",
  );
});

test("a paused, revoked, or expired permission excludes the whole source", () => {
  for (const state of ["paused", "revoked", "expired", "never_granted"] as const) {
    const prepared = prepareConstrainedReadingInput(
      baseInput({
        context_sources: [
          source("USR-02", ["life_domain_selection", "reflection_prompt", "theme_ranking"], {
            permission_state: state,
          }),
        ],
        context_signals: [
          signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
        ],
      }),
    );
    assert.equal(prepared.request.context.length, 0, `${state} permission produced context`);
    assert.ok(prepared.rejections.some((r) => r.subject_kind === "source"));
  }
});

test("a revoked source consent excludes the whole source", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [
        source("USR-02", ["life_domain_selection"], { consent_status: "revoked" }),
      ],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
      ],
    }),
  );
  assert.equal(prepared.request.context.length, 0);
});

test("a permission and consent that disagree reject the source rather than intersecting", () => {
  const disagreements: Array<Partial<ConstrainedContextSourceInput>> = [
    { consent_allowed_uses: ["life_domain_selection", "reflection_prompt"] },
    { consent_source_id: "USR-03" },
    { permission_consent_id: "cns_other" },
  ];
  for (const overrides of disagreements) {
    const prepared = prepareConstrainedReadingInput(
      baseInput({
        context_sources: [source("USR-02", ["life_domain_selection"], overrides)],
        context_signals: [
          signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
        ],
      }),
    );
    assert.equal(
      prepared.request.context.length,
      0,
      `disagreement ${JSON.stringify(overrides)} still produced context`,
    );
    assert.ok(
      prepared.rejections.some((r) => r.reason_code === "context_source_consent_disagreement"),
    );
  }
});

test("a stale or expired signal is excluded even under an active source", () => {
  for (const freshness of ["stale", "expired", "unknown"] as const) {
    const prepared = prepareConstrainedReadingInput(
      baseInput({
        context_sources: [source("USR-02", ["life_domain_selection"])],
        context_signals: [
          signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z", {
            freshness_status: freshness,
          }),
        ],
      }),
    );
    assert.equal(prepared.request.context.length, 0, `${freshness} signal was included`);
  }
});

test("a signal naming a source with no permission row is excluded", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
      ],
    }),
  );
  assert.equal(prepared.request.context.length, 0);
  assert.ok(prepared.rejections.some((r) => r.reason_code === "context_source_not_permitted"));
});

test("a category the AI-synthesis grant does not name cannot be sent", () => {
  const withoutPersonalContext = baseInput().consent_categories.filter(
    (c) => c !== "enabled_personal_context",
  );
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      consent_categories: withoutPersonalContext,
      context_sources: [source("USR-02", ["life_domain_selection"])],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
      ],
    }),
  );
  assert.equal(prepared.request.context.length, 0);
  assert.ok(prepared.rejections.some((r) => r.reason_code === "consent_category_not_granted"));
});

// ---------------------------------------------------------------------------
// Selection policy
// ---------------------------------------------------------------------------

test("the newest signal of every source is reserved before any source gets a second", () => {
  const sources = [
    source("USR-02", ["life_domain_selection"]),
    source("CLD-06", ["narrative_continuity"]),
  ];
  const signals = [
    signal("sig_a1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
    signal("sig_a2", "USR-02", ["life_domain_selection"], "2026-07-28T10:00:00Z"),
    signal("sig_a3", "USR-02", ["life_domain_selection"], "2026-07-27T10:00:00Z"),
    signal("sig_b1", "CLD-06", ["narrative_continuity"], "2026-07-20T10:00:00Z"),
    signal("sig_b2", "CLD-06", ["narrative_continuity"], "2026-07-19T10:00:00Z"),
  ];

  const prepared = prepareConstrainedReadingInput(
    baseInput({ context_sources: sources, context_signals: signals }),
  );

  // Reservation runs first in source-id order, then the round-robin fill does.
  assert.deepEqual(
    prepared.selected_context.map((c) => c.signal_id),
    ["sig_b1", "sig_a1", "sig_b2", "sig_a2", "sig_a3"],
  );
});

test("selection is stable under input permutation", () => {
  const sources = [
    source("USR-02", ["life_domain_selection"]),
    source("CLD-06", ["narrative_continuity"]),
  ];
  const signals = [
    signal("sig_a1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
    signal("sig_a2", "USR-02", ["life_domain_selection"], "2026-07-28T10:00:00Z"),
    signal("sig_b1", "CLD-06", ["narrative_continuity"], "2026-07-20T10:00:00Z"),
  ];

  const forward = prepareConstrainedReadingInput(
    baseInput({ context_sources: sources, context_signals: signals }),
  );
  const reversed = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [...sources].reverse(),
      context_signals: [...signals].reverse(),
      daily_sky_facts: [CONTACT_FACT, LUNAR_PHASE_FACT, MOON_ANCHOR, SUN_ANCHOR],
    }),
  );

  assert.equal(forward.identity_canonical, reversed.identity_canonical);
  assert.equal(forward.input_manifest_canonical, reversed.input_manifest_canonical);
});

test("re-running the compiler over its own selected output reproduces both hashes", () => {
  const input = baseInput({
    context_sources: [
      source("USR-02", ["life_domain_selection"]),
      source("CLD-06", ["narrative_continuity"]),
    ],
    context_signals: [
      signal("sig_a1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
      signal("sig_a2", "USR-02", ["life_domain_selection"], "2026-07-28T10:00:00Z"),
      signal("sig_b1", "CLD-06", ["narrative_continuity"], "2026-07-20T10:00:00Z"),
      signal("sig_stale", "USR-02", ["life_domain_selection"], "2026-07-30T10:00:00Z", {
        freshness_status: "stale",
      }),
    ],
    prior_readings: [
      {
        local_date: "2026-07-29",
        headline: "Yesterday",
        lead: "Lead.",
        reflection_prompt: "Prompt?",
      },
    ],
  });

  const enqueue = prepareConstrainedReadingInput(input);

  // Execute sees only what the command froze: the selected signals, not the
  // corpus they were selected from.
  const selectedIds = new Set(enqueue.selected_context.map((c) => c.signal_id));
  const execute = prepareConstrainedReadingInput({
    ...input,
    context_signals: input.context_signals.filter((s) => selectedIds.has(s.signal_id)),
    prior_readings: enqueue.selected_prior_readings,
  });

  assert.equal(execute.identity_canonical, enqueue.identity_canonical);
  assert.equal(execute.input_manifest_canonical, enqueue.input_manifest_canonical);
});

test("at most the last seven published readings enter repetition control", () => {
  const priors = Array.from({ length: 12 }, (_, i) => ({
    local_date: `2026-07-${String(29 - i).padStart(2, "0")}`,
    headline: `Headline ${i}`,
    lead: `Lead ${i}`,
    reflection_prompt: `Prompt ${i}?`,
  }));

  const prepared = prepareConstrainedReadingInput(baseInput({ prior_readings: priors }));

  assert.equal(prepared.request.prior_readings.length, MAX_PRIOR_READINGS);
  assert.deepEqual(
    prepared.request.prior_readings.map((p) => p.days_ago),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(prepared.request.prior_readings[0]!.headline, "Headline 0");
  assert.equal(
    prepared.request.prior_readings.some((p) => "local_date" in p),
    false,
  );
});

test("a prior reading older than seven days never enters the packet", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      prior_readings: [
        {
          local_date: "2026-07-01",
          headline: "Old",
          lead: "Old lead.",
          reflection_prompt: "Old prompt?",
        },
      ],
    }),
  );
  assert.equal(prepared.request.prior_readings.length, 0);
});

test("at most twenty structured feedback records are selected", () => {
  const feedbackSignals = Array.from({ length: 26 }, (_, i) =>
    signal(
      `sig_fb_${String(i).padStart(2, "0")}`,
      "USR-12",
      ["repetition_control"],
      `2026-07-${String(29 - (i % 28)).padStart(2, "0")}T10:00:00Z`,
      {
        category: "reading_feedback",
        content: { kind: "structured", value: { resonance: "useful", index: i } },
      },
    ),
  );

  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-12", ["content_quality", "repetition_control", "theme_ranking"])],
      context_signals: feedbackSignals,
    }),
  );

  const feedback = prepared.selected_context.filter((c) => c.category === "reading_feedback");
  assert.equal(new Set(feedback.map((c) => c.signal_id)).size, MAX_FEEDBACK_RECORDS);
});

// ---------------------------------------------------------------------------
// Byte boundaries
// ---------------------------------------------------------------------------

test("free text is NFC-normalized and truncated on an exact UTF-8 code-point boundary", () => {
  // "é" is two bytes in NFC and three in NFD, so the decomposed form both
  // normalizes and truncates differently if either step is skipped.
  const filler = "a".repeat(MAX_CONTEXT_TEXT_BYTES - 1);
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-02", ["life_domain_selection"])],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z", {
          content: { kind: "text", text: filler + "é" + "tail" },
        }),
      ],
    }),
  );

  const item = prepared.request.context[0]!;
  assert.equal(item.content.kind, "untrusted_text");
  const text = (item.content as { kind: "untrusted_text"; text: string }).text;
  assert.equal(text.normalize("NFC"), text);
  assert.ok(utf8ByteLength(text) <= MAX_CONTEXT_TEXT_BYTES);
  // The composed "é" needs two bytes and only one remains, so it is dropped whole.
  assert.equal(utf8ByteLength(text), MAX_CONTEXT_TEXT_BYTES - 1);
  assert.equal(text.endsWith("a"), true);
});

test("the packet ceiling is an exact byte boundary, not an approximate one", () => {
  const sources = [source("USR-02", ["life_domain_selection"])];
  const signals = Array.from({ length: 6 }, (_, i) =>
    signal(
      `sig_${String(i).padStart(2, "0")}`,
      "USR-02",
      ["life_domain_selection"],
      `2026-07-${String(29 - i).padStart(2, "0")}T10:00:00Z`,
      { content: { kind: "text", text: "x".repeat(200) } },
    ),
  );

  const full = prepareConstrainedReadingInput(
    baseInput({ context_sources: sources, context_signals: signals }),
  );
  assert.equal(full.request.context.length, 6);

  const exact = prepareConstrainedReadingInput(
    baseInput({
      context_sources: sources,
      context_signals: signals,
      context_max_bytes: full.packet_bytes,
    }),
  );
  assert.equal(exact.request.context.length, 6);
  assert.equal(exact.packet_bytes, full.packet_bytes);

  const oneShort = prepareConstrainedReadingInput(
    baseInput({
      context_sources: sources,
      context_signals: signals,
      context_max_bytes: full.packet_bytes - 1,
    }),
  );
  assert.equal(oneShort.request.context.length, 5);
  assert.ok(oneShort.packet_bytes < full.packet_bytes);
  assert.ok(
    oneShort.rejections.some((r) => r.reason_code === "context_budget_exhausted"),
  );
});

test("mandatory facts that cannot fit the ceiling fail closed rather than dropping a fact", () => {
  assert.throws(
    () => prepareConstrainedReadingInput(baseInput({ context_max_bytes: 1024 })),
    ConstrainedInputError,
  );
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("identity and manifest are canonical JSON that excludes rejected candidates", () => {
  const withRejected = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-02", ["life_domain_selection"])],
      context_signals: [
        signal("sig_ok", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
        signal("sig_stale", "USR-02", ["life_domain_selection"], "2026-07-28T10:00:00Z", {
          freshness_status: "stale",
        }),
      ],
    }),
  );
  const withoutRejected = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-02", ["life_domain_selection"])],
      context_signals: [
        signal("sig_ok", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z"),
      ],
    }),
  );

  assert.equal(withRejected.identity_canonical, withoutRejected.identity_canonical);
  assert.equal(withRejected.input_manifest_canonical, withoutRejected.input_manifest_canonical);
  assert.notEqual(withRejected.rejections.length, withoutRejected.rejections.length);
});

test("the identity and the manifest are different preimages", () => {
  const prepared = prepareConstrainedReadingInput(baseInput());
  assert.notEqual(prepared.identity_canonical, prepared.input_manifest_canonical);
  assert.ok(prepared.identity_canonical.includes("patternlike.generation-input-id.v1"));
  assert.ok(
    prepared.input_manifest_canonical.includes("patternlike.generation-input-manifest.v1"),
  );
});

test("the identity carries no raw context text and no source secret", () => {
  const prepared = prepareConstrainedReadingInput(
    baseInput({
      context_sources: [source("USR-02", ["life_domain_selection"])],
      context_signals: [
        signal("sig_1", "USR-02", ["life_domain_selection"], "2026-07-29T10:00:00Z", {
          content: { kind: "text", text: "the private sentence" },
        }),
      ],
    }),
  );
  assert.equal(prepared.identity_canonical.includes("the private sentence"), false);
  assert.ok(prepared.identity_canonical.includes(hex64("sig_1")));
});

test("a changed selection policy version changes the identity", () => {
  const a = prepareConstrainedReadingInput(baseInput());
  const b = prepareConstrainedReadingInput(
    baseInput({ selection_policy_version: "1.0.1" }),
  );
  assert.notEqual(a.identity_canonical, b.identity_canonical);
});
