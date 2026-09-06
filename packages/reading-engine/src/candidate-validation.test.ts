/**
 * Deterministic validation of one model candidate.
 *
 * There is no human review and no second model behind this file. Everything a
 * reader will ever see passed exactly these checks, so each one is written as
 * "what could a fluent, confident, wrong candidate say?" rather than "what does
 * a correct candidate look like?".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { DailySkyFact, ReadingGenerationOutput } from "@patternlike/shared";

import { isSupportedReadingLocale } from "./candidate-policy.js";
import {
  VALIDATION_POLICY_VERSION,
  type ConstrainedReadingInput,
} from "./constrained-types.js";
import { prepareConstrainedReadingInput } from "./constrained-input.js";
import { validateReadingCandidate } from "./candidate-validation.js";
import type { NormalizedCycle } from "./types.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const hex32 = (seed: string): string => {
  let out = "";
  for (let i = 0; out.length < 32; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i;
    out += (code % 16).toString(16);
  }
  return out;
};
const hex64 = (seed: string): string => hex32(seed) + hex32(seed + "!");

const CYCLE_ID = "cyc_" + hex32("saturn-square-sun");
const CONTACT_ID = "dsf_" + hex32("contact");
const LUNAR_ID = "dsf_" + hex32("lunar-phase");
const ANCHOR_ID = "dsf_" + hex32("anchor-sun");
const NATAL_ID = "nat_" + hex32("natal-sun");

const CYCLE: NormalizedCycle = {
  id: CYCLE_ID,
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

const skyBase = {
  daily_sky_policy_id: "daily-sky-launch" as const,
  daily_sky_policy_version: "1.0.0",
  calculation_policy_id: "transit-scan-launch",
  calculation_policy_version: "1.4.0",
  ephemeris_data_version: "swisseph-2.10.03",
  container_digest: hex64("container"),
};

const ANCHOR: DailySkyFact = {
  ...skyBase,
  fact_id: ANCHOR_ID,
  content_digest: hex64("anchor-sun"),
  kind: "anchor_position",
  scope: "collective",
  effective_at: "2026-07-30T17:00:00Z",
  label: "Sun at 7.40 degrees Leo",
  precision: { longitude_decimals: 6, instant_resolution_seconds: null },
  detail: {
    body: "sun",
    longitude_deg: 127.4,
    sign: "leo",
    sign_degree_deg: 7.4,
    speed_deg_per_day: 0.95,
    retrograde: false,
  },
};

const LUNAR: DailySkyFact = {
  ...skyBase,
  fact_id: LUNAR_ID,
  content_digest: hex64("lunar-phase"),
  kind: "lunar_phase",
  scope: "collective",
  effective_at: "2026-07-30T17:00:00Z",
  label: "Waxing gibbous Moon",
  precision: { longitude_decimals: 6, instant_resolution_seconds: null },
  detail: { phase: "waxing_gibbous", elongation_deg: 143.2, illuminated_fraction: 0.9 },
};

const CONTACT: DailySkyFact = {
  ...skyBase,
  fact_id: CONTACT_ID,
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
};

function input(overrides: Partial<ConstrainedReadingInput> = {}): ConstrainedReadingInput {
  return {
    schema_version: "0.5.0",
    prompt_version: "1.0.0",
    output_schema: "daily-reading-v5",
    selection_policy_version: "1.0.0",
    validation_policy_version: VALIDATION_POLICY_VERSION,
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
    daily_sky_facts: [ANCHOR, LUNAR, CONTACT],
    natal_facts: [
      {
        fact_id: NATAL_ID,
        fact_class: "natal_position",
        body: "sun",
        target: null,
        aspect: null,
        sign: "capricorn",
        degree_deg: 1.774002,
        house: null,
      },
    ],
    context_sources: [
      {
        source_id: "USR-02",
        permission_state: "active",
        permission_allowed_uses: ["life_domain_selection", "reflection_prompt", "theme_ranking"],
        permission_consent_id: "cns_usr02",
        consent_id: "cns_usr02",
        consent_source_id: "USR-02",
        consent_status: "granted",
        consent_version: 1,
        consent_allowed_uses: ["life_domain_selection", "reflection_prompt", "theme_ranking"],
      },
    ],
    context_signals: [
      {
        signal_id: "sig_1",
        source_id: "USR-02",
        category: "enabled_personal_context",
        allowed_uses: ["life_domain_selection"],
        evidence_lane: "user_and_context",
        normalized_hash: hex64("sig_1"),
        freshness_status: "fresh",
        observed_at: "2026-07-29T10:00:00Z",
        expires_at: null,
        content: { kind: "text", text: "Third week of the migration." },
      },
      {
        signal_id: "sig_2",
        source_id: "USR-02",
        category: "enabled_personal_context",
        allowed_uses: ["reflection_prompt"],
        evidence_lane: "user_and_context",
        normalized_hash: hex64("sig_2"),
        freshness_status: "fresh",
        observed_at: "2026-07-28T10:00:00Z",
        expires_at: null,
        content: { kind: "text", text: "I keep promising more than I finish." },
      },
    ],
    prior_readings: [],
    ...overrides,
  };
}

const prepared = prepareConstrainedReadingInput(input());

/** ctx_ handle for the one pin carrying `use`. */
function ref(use: string): string {
  const pin = prepared.selected_context.find((c) => c.allowed_use === use);
  assert.ok(pin, `no pin for ${use}`);
  return pin!.context_ref;
}

function candidate(
  overrides: Partial<ReadingGenerationOutput> = {},
): ReadingGenerationOutput {
  return {
    schema_version: "0.5.0",
    output_schema: "daily-reading-v5",
    local_date: "2026-07-30",
    locale: "en-US",
    headline: "A narrower commitment",
    lead: {
      text: "Saturn is square your Sun today. The pressure may call for a smaller promise rather than a larger effort.",
      fact_ids: [CYCLE_ID],
      context_refs: [ref("life_domain_selection")],
    },
    paragraphs: [
      {
        role: "supporting_theme",
        text: "Transiting Saturn is exactly square your natal Sun today. A recurring concern may feel easier to name.",
        fact_ids: [CONTACT_ID],
        context_refs: [],
      },
      {
        role: "collective_context",
        text: "The Moon is waxing gibbous tonight. Leave room to revise a small plan.",
        fact_ids: [LUNAR_ID],
        context_refs: [],
      },
    ],
    reflection_prompt: {
      text: "Which promise would you keep if nobody was watching?",
      fact_ids: [],
      context_refs: [ref("reflection_prompt")],
    },
    uncertainty_note: null,
    ...overrides,
  };
}

function reject(
  overrides: Partial<ReadingGenerationOutput>,
  expectedCode: string,
): void {
  const result = validateReadingCandidate(candidate(overrides), prepared);
  assert.equal(result.ok, false, `expected ${expectedCode} to fail validation`);
  if (result.ok) return;
  assert.ok(
    result.failures.some((f) => f.code === expectedCode),
    `expected check ${expectedCode}, got ${result.failures.map((f) => f.code).join(", ")}`,
  );
}

const REVIEW_SUN_ID = "nat_" + hex32("review-sun-aries");
const REVIEW_MOON_ID = "nat_" + hex32("review-moon-taurus");
const REVIEW_CONTACT_ID = "dsf_" + hex32("review-other-contact");
const REVIEW_INGRESS_ID = "dsf_" + hex32("review-ingress");

function relationshipInput() {
  return prepareConstrainedReadingInput(input({
    natal_facts: [
      { fact_id: REVIEW_SUN_ID, fact_class: "natal_position", body: "sun", target: null, aspect: null, sign: "aries", degree_deg: 10, house: 2 },
      { fact_id: REVIEW_MOON_ID, fact_class: "natal_position", body: "moon", target: null, aspect: null, sign: "taurus", degree_deg: 20, house: 3 },
    ],
    daily_sky_facts: [ANCHOR, LUNAR, CONTACT, {
      ...CONTACT,
      fact_id: REVIEW_CONTACT_ID,
      effective_at: "2026-07-30T17:00:00Z",
      label: "Transiting Mars exactly trine natal Moon",
      detail: { ...CONTACT.detail, transiting_body: "mars", natal_target: "moon", aspect: "trine" },
    }, {
      ...skyBase,
      fact_id: REVIEW_INGRESS_ID,
      content_digest: hex64("review-ingress"),
      kind: "sign_ingress",
      scope: "collective",
      effective_at: "2026-07-30T22:05:31Z",
      label: "Mercury enters Virgo from Leo",
      precision: { longitude_decimals: null, instant_resolution_seconds: 1 },
      detail: { body: "mercury", from_sign: "leo", to_sign: "virgo", direction: "direct" },
    }],
  }));
}

for (const { name, text, ids } of [
  { name: "swapped placement", text: "Your Sun is in Taurus.", ids: [REVIEW_SUN_ID] },
  { name: "swapped placement with both facts cited", text: "Your Sun is in Taurus.", ids: [REVIEW_SUN_ID, REVIEW_MOON_ID] },
  { name: "wrong aspect participant", text: "Saturn is square your Moon today.", ids: [CYCLE_ID] },
  { name: "reversed transit and natal roles", text: "The transiting Sun is square your natal Saturn today.", ids: [CYCLE_ID] },
  { name: "borrowed degree", text: "Your Sun is at 20 degrees Aries.", ids: [REVIEW_SUN_ID, REVIEW_MOON_ID] },
  { name: "borrowed house", text: "Your Sun is in the third house.", ids: [REVIEW_SUN_ID, REVIEW_MOON_ID] },
  { name: "borrowed timestamp", text: "Saturn is square your Sun, exact at 17:00 UTC on 2026-07-30.", ids: [CONTACT_ID, REVIEW_CONTACT_ID] },
  { name: "irrelevant existing citation", text: "Saturn is square your Sun today.", ids: [REVIEW_SUN_ID] },
  { name: "cycle start date used as exact date", text: "Saturn is square your Sun, exact on 2026-07-19.", ids: [CYCLE_ID] },
  { name: "cycle exact date used as end date", text: "Saturn's square to your Sun ends on 2026-08-02.", ids: [CYCLE_ID] },
  { name: "orb used as a placement degree", text: "Saturn is at 0.42 degrees.", ids: [CYCLE_ID] },
  { name: "position degree used as an orb", text: "Your Sun has an orb of 10 degrees.", ids: [REVIEW_SUN_ID] },
  { name: "wrong timestamp seconds", text: "Saturn is square your Sun, exact at 14:11:08 UTC on 2026-07-30.", ids: [CONTACT_ID] },
  { name: "wrong ISO timestamp date", text: "Saturn is square your Sun, exact at 2026-08-02T14:11:07Z.", ids: [CONTACT_ID] },
  { name: "lunar phase assigned to the Sun", text: "The Sun is waxing gibbous tonight.", ids: [LUNAR_ID] },
  { name: "reversed ingress", text: "Mercury enters Leo from Virgo today.", ids: [REVIEW_INGRESS_ID] },
  { name: "mixed-citation collective laundering", text: "Your Sun is at 7.4 degrees Leo.", ids: [ANCHOR_ID, REVIEW_SUN_ID] },
  { name: "negated true placement", text: "Your Sun is not in Aries.", ids: [REVIEW_SUN_ID] },
  { name: "anaphoric swapped placement", text: "Your Sun is in Aries. It is in Taurus.", ids: [REVIEW_SUN_ID, REVIEW_MOON_ID] },
  { name: "reflexive aspect", text: "Saturn squares itself beside your Sun.", ids: [CYCLE_ID] },
  { name: "extra reflexive aspect clause", text: "Saturn squares your Sun; your Sun squares itself.", ids: [CYCLE_ID] },
  { name: "longitude substituted for sign degree", text: "The Sun has a longitude of 7.4 degrees.", ids: [ANCHOR_ID] },
  { name: "declination substituted for sign degree", text: "Your Sun is at 10 degrees of declination.", ids: [REVIEW_SUN_ID] },
  { name: "collective placement with remote natal qualifier", text: "The Sun is at 7.4 degrees Leo in your own natal chart.", ids: [ANCHOR_ID] },
  { name: "unparsed past-tense event", text: "Saturn's square to your Sun ended on 2026-08-02.", ids: [CYCLE_ID] },
  { name: "predicative wrong lunar phase", text: "The Moon is full tonight.", ids: [LUNAR_ID] },
  { name: "unprovided illumination", text: "A waxing gibbous Moon is 10 percent illuminated tonight.", ids: [LUNAR_ID] },
  { name: "UTC offset masquerading as UTC", text: "Saturn is square your Sun, exact at 14:11:07 UTC+9 on 2026-07-30.", ids: [CONTACT_ID] },
  { name: "unparsed calendar date", text: "Mercury enters Virgo on 07/30/2035.", ids: [REVIEW_INGRESS_ID] },
  { name: "clause retracting a fact", text: "Your Sun is in Aries, except it is not.", ids: [REVIEW_SUN_ID] },
  { name: "anaphoric unbound event", text: "Saturn is square your Sun. It begins in 2035.", ids: [CYCLE_ID] },
  { name: "unbound exact pass", text: "Saturn is square your Sun. Its exact pass happens next Monday.", ids: [CYCLE_ID] },
  { name: "cycle envelope orb as measured separation", text: "Saturn is square your Sun with an orb of 0.42 degrees.", ids: [CYCLE_ID] },
  { name: "comma does not authorize a borrowed orb", text: "Transiting Saturn is square your natal Sun, with a configured orb limit of 7.5 degrees.", ids: [CYCLE_ID] },
  { name: "comma does not authorize extra factual prose", text: "Transiting Saturn is square your natal Sun, with a configured orb limit of 0.42 degrees and your Sun in Taurus.", ids: [CYCLE_ID, REVIEW_MOON_ID] },
  { name: "current cycle phase assigned to future exact pass", text: "Saturn is square your Sun in the building phase, exact on 2026-08-02.", ids: [CYCLE_ID] },
  { name: "exact contact relabelled as sampled", text: "Saturn is square your Sun, sampled at 14:11:07 UTC on 2026-07-30.", ids: [CONTACT_ID] },
  { name: "future exact pass as implicitly present", text: "Saturn is exactly square your Sun.", ids: [CYCLE_ID] },
  { name: "future exact pass without its date", text: "Saturn is square your Sun, exact at 14:11:07 UTC.", ids: [CYCLE_ID] },
  { name: "unbound exact assertion", text: "Saturn is square your Sun. Exact tonight.", ids: [CYCLE_ID] },
]) {
  test(`claim support rejects ${name}`, () => {
    const result = validateReadingCandidate(candidate({
      lead: { text, fact_ids: ids, context_refs: [] },
    }), relationshipInput());
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.ok(result.failures.some((failure) => failure.code === "grounding"), JSON.stringify(result.failures));
  });
}

test("claim support accepts separate, accurately cited factual sentences", () => {
  for (const [text, ids] of [
    ["Your Sun is at 10 degrees Aries in the second house. Your Moon is in Taurus.", [REVIEW_SUN_ID, REVIEW_MOON_ID]],
    ["Saturn is square your Sun, exact at 14:11:07 UTC on 2026-07-30.", [CONTACT_ID]],
    ["Saturn is square your Sun, exact at 2026-07-30T14:11:07Z.", [CONTACT_ID]],
    ["Saturn's square to your Sun ends on 2027-01-26.", [CYCLE_ID]],
    ["Saturn is square your Sun with a configured orb limit of 0.42 degrees.", [CYCLE_ID]],
    ["Transiting Saturn is square your natal Sun, with a configured orb limit of 0.42 degrees.", [CYCLE_ID]],
    ["Mercury enters Virgo from Leo today.", [REVIEW_INGRESS_ID]],
  ] as Array<[string, string[]]>) {
    const result = validateReadingCandidate(candidate({
      lead: { text, fact_ids: ids, context_refs: [] },
    }), relationshipInput());
    assert.equal(result.ok, true, `${text}: ${JSON.stringify(result)}`);
  }
});

test("headlines cannot make uncited factual assertions", () => {
  const result = validateReadingCandidate(candidate({ headline: "Your Sun in Leo" }), prepared);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some((failure) => failure.code === "grounding"));
});

test("timestamp support normalizes UTC offsets and respects the half-open local day", () => {
  for (const [instant, text, expected] of [
    ["2026-07-30T09:11:07-05:00", "Saturn is square your Sun, exact at 14:11:07 UTC on 2026-07-30.", true],
    ["2026-07-30T09:11:07-05:00", "Saturn is square your Sun, exact at 14:11:07 UTC today.", true],
    ["2026-07-30T09:11:07-05:00", "Saturn is square your Sun, exact at 09:11:07 UTC on 2026-07-30.", false],
    ["2026-07-30T05:00:00.000Z", "Saturn is square your Sun, exact today.", true],
    ["2026-07-31T05:00:00.000Z", "Saturn is square your Sun, exact today.", false],
    ["2026-07-31T05:00:00.000Z", "Saturn is square your Sun, exact at 05:00 UTC today.", false],
    ["2026-07-31T05:00:00.000Z", "Saturn is square your Sun today.", false],
    ["2026-07-31T05:00:00.000Z", "Saturn is square your Sun.", false],
  ] as const) {
    const calculated = prepareConstrainedReadingInput(input({
      daily_sky_facts: [ANCHOR, LUNAR, { ...CONTACT, effective_at: instant }],
    }));
    const result = validateReadingCandidate(candidate({
      lead: { text, fact_ids: [CONTACT_ID], context_refs: [] },
      paragraphs: [candidate().paragraphs[1]!],
    }), calculated);
    assert.equal(result.ok, expected, `${instant}: ${JSON.stringify(result)}`);
  }
});

test("a cycle or sampled position supplies its own timestamp vocabulary", () => {
  const calculated = prepareConstrainedReadingInput(input({ daily_sky_facts: [ANCHOR, LUNAR] }));
  for (const [text, factId] of [
    ["Saturn is square your Sun, exact at 14:11:07 UTC on 2026-08-02.", CYCLE_ID],
    ["The Sun is at 7.4 degrees Leo, sampled at 17:00 UTC on 2026-07-30.", ANCHOR_ID],
  ]) {
    const result = validateReadingCandidate(candidate({
      lead: { text: text!, fact_ids: [factId!], context_refs: [] },
      paragraphs: [candidate().paragraphs[1]!],
    }), calculated);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test("a concise cycle-phase clause stays bound to its own cycle record", () => {
  for (const [text, factId, expected] of [
    ["Transiting Saturn is square your natal Sun, building today.", CYCLE_ID, true],
    ["Transiting Saturn is square your natal Sun building today.", CYCLE_ID, true],
    ["Transiting Saturn is square your natal Sun, waning today.", CYCLE_ID, false],
    ["Transiting Saturn is square your natal Sun, building today.", CONTACT_ID, false],
    ["Transiting Saturn is square your natal Sun, building today, and your Moon is in Taurus.", CYCLE_ID, false],
  ] as const) {
    const result = validateReadingCandidate(candidate({ lead: { text, fact_ids: [factId], context_refs: [] } }), prepared);
    assert.equal(result.ok, expected, `${text}: ${JSON.stringify(result.ok ? [] : result.failures)}`);
  }
});

test("an explicit shared-sky prefix retains the cited lunar phase and collective scope", () => {
  for (const [text, factId, expected] of [
    ["In today's shared sky, the Moon is waxing gibbous.", LUNAR_ID, true],
    ["In the collective sky, the Moon is waxing gibbous.", LUNAR_ID, true],
    ["In today's shared sky, the Moon is full.", LUNAR_ID, false],
    ["In today's shared sky, your natal Sun is at 1.77 degrees Capricorn.", NATAL_ID, false],
    ["In today's shared sky, the Moon is waxing gibbous and your Sun is in Leo.", LUNAR_ID, false],
  ] as const) {
    const result = validateReadingCandidate(candidate({
      paragraphs: [{ role: "collective_context", text, fact_ids: [factId], context_refs: [] }],
    }), prepared);
    assert.equal(result.ok, expected, `${text}: ${JSON.stringify(result.ok ? [] : result.failures)}`);
  }
});

test("qualified approximate data supports an honest note without inventing suppression", () => {
  const base = input();
  const calculated = prepareConstrainedReadingInput({
    ...base,
    chart: { ...base.chart, effective_accuracy: "approximate", uncertainty: {
      accuracy: "approximate", window_plus_minus_minutes: 30,
      suppressed_features: [], qualified_features: [{ feature_id: "houses", qualification: "approximate_only" }],
    } },
  });
  for (const [text, expected] of [
    ["Your birth time is approximate, so time-sensitive details remain uncertain.", true],
    ["Your birth time is approximate, so this reading omits houses.", false],
    ["Your birth time is unknown, so time-sensitive details remain uncertain.", false],
  ] as const) {
    const result = validateReadingCandidate(candidate({ uncertainty_note: { text, fact_ids: [], context_refs: [] } }), calculated);
    assert.equal(result.ok, expected, JSON.stringify(result));
  }
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a grounded candidate passes and yields the published paragraph plan", () => {
  const result = validateReadingCandidate(candidate(), prepared);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.validation.status, "passed");
  assert.equal(result.validation.policy_version, VALIDATION_POLICY_VERSION);
  assert.ok(result.validation.checks.length >= 12);
  assert.ok(result.validation.checks.every((c) => c.passed === true));

  assert.deepEqual(
    result.units.map((u) => u.role),
    ["primary_theme", "supporting_theme", "collective_context", "reflection"],
  );
  assert.deepEqual(
    result.units.map((u) => u.order),
    [1, 2, 3, 4],
  );
  assert.equal(result.units[0]!.text, candidate().lead.text);
  assert.deepEqual(
    result.units[0]!.fact_refs.map((f) => f.fact_id),
    [CYCLE_ID],
  );
  assert.equal(result.units[0]!.fact_refs[0]!.scope, "personalized");
  assert.equal(result.units[0]!.fact_refs[0]!.label.length > 0, true);
  assert.deepEqual(
    result.units[0]!.context_refs.map((c) => c.allowed_use),
    ["life_domain_selection"],
  );
  assert.equal(result.units[2]!.fact_refs[0]!.scope, "collective");
});

test("the reflection may cite only reflection-lane context", () => {
  const result = validateReadingCandidate(candidate(), prepared);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const reflection = result.units.find((u) => u.role === "reflection")!;
  assert.deepEqual(
    reflection.context_refs.map((c) => c.allowed_use),
    ["reflection_prompt"],
  );
  assert.equal(reflection.context_refs[0]!.category, "enabled_personal_context");
  assert.match(reflection.context_refs[0]!.private_ref, /^ctx_\d{1,3}$/);
});

// ---------------------------------------------------------------------------
// Echo and shape
// ---------------------------------------------------------------------------

test("the candidate must echo the supplied local date and locale exactly", () => {
  reject({ local_date: "2026-07-31" }, "echo");
  reject({ locale: "en-GB" }, "echo");
  reject({ schema_version: "0.3.0" as ReadingGenerationOutput["schema_version"] }, "echo");
});

test("a malformed candidate is rejected before any prose check runs", () => {
  const malformed = { ...candidate(), lead: { text: "x" } } as unknown as ReadingGenerationOutput;
  const result = validateReadingCandidate(malformed, prepared);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.failures.some((f) => f.code === "schema_shape"));
});

test("paragraph roles must be unique, allowed, and in the declared order", () => {
  const base = candidate();
  reject(
    {
      paragraphs: [base.paragraphs[1]!, base.paragraphs[0]!],
    },
    "role_order",
  );
  reject(
    {
      paragraphs: [base.paragraphs[0]!, base.paragraphs[0]!],
    },
    "role_order",
  );
  reject(
    {
      paragraphs: [
        {
          role: "timing" as const,
          text: "Nothing here is timed.",
          fact_ids: [],
          context_refs: [],
        },
        base.paragraphs[0]!,
      ],
    },
    "role_order",
  );
});

test("length bounds are enforced on the headline, lead, paragraphs, and reflection", () => {
  const base = candidate();
  reject({ headline: "x".repeat(400) }, "length_bounds");
  reject({ lead: { ...base.lead, text: "Saturn. ".repeat(400) } }, "length_bounds");
  reject(
    {
      reflection_prompt: { ...base.reflection_prompt, text: "Why? ".repeat(400) },
    },
    "length_bounds",
  );
  reject({ headline: "   " }, "length_bounds");
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

test("an unknown fact or context reference is rejected", () => {
  const base = candidate();
  reject({ lead: { ...base.lead, fact_ids: ["cyc_" + "0".repeat(32)] } }, "known_references");
  reject({ lead: { ...base.lead, context_refs: ["ctx_99"] } }, "known_references");
});

test("a context pin cited outside its authorized lane is rejected", () => {
  const base = candidate();
  // life_domain_selection may frame the lead; it may not become the reflection.
  reject(
    {
      reflection_prompt: {
        ...base.reflection_prompt,
        context_refs: [ref("life_domain_selection")],
      },
    },
    "context_lane",
  );
});

test("the uncertainty note may cite no personal context at all", () => {
  const withNote = prepareConstrainedReadingInput(
    input({
      chart: {
        ...input().chart,
        effective_accuracy: "unknown",
        uncertainty: {
          accuracy: "unknown",
          window_plus_minus_minutes: null,
          suppressed_features: [
            { feature_class: "houses", feature_id: null, reason: "unknown_birth_time" },
          ],
          qualified_features: [],
        },
      },
    }),
  );
  const lane = withNote.selected_context.find((c) => c.allowed_use === "life_domain_selection")!;
  const result = validateReadingCandidate(
    {
      ...candidate(),
      lead: { ...candidate().lead, context_refs: [lane.context_ref] },
      reflection_prompt: { ...candidate().reflection_prompt, context_refs: [] },
      uncertainty_note: {
        text: "Without a confirmed birth time this reading leaves houses out.",
        fact_ids: [],
        context_refs: [lane.context_ref],
      },
    },
    withNote,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.failures.some((f) => f.code === "context_lane"));
});

// ---------------------------------------------------------------------------
// Grounding and vocabulary
// ---------------------------------------------------------------------------

test("every substantive astrology unit must cite at least one supplied fact", () => {
  const base = candidate();
  reject({ lead: { ...base.lead, fact_ids: [] } }, "grounding");
  reject(
    {
      paragraphs: [
        {
          role: "supporting_theme" as const,
          text: "Saturn is asking for less.",
          fact_ids: [],
          context_refs: [],
        },
      ],
    },
    "grounding",
  );
});

test("a non-astrological reflection needs no fact", () => {
  const result = validateReadingCandidate(
    {
      ...candidate(),
      reflection_prompt: {
        text: "What would you stop carrying today?",
        fact_ids: [],
        context_refs: [],
      },
    },
    prepared,
  );
  assert.equal(result.ok, true);
});

test("a body, sign, aspect, house, degree, phase, or date nobody calculated is rejected", () => {
  const base = candidate();
  const cases: Array<[string, string]> = [
    ["Neptune is also square your Sun today.", "an uncalculated body"],
    ["Your Sun has moved into Pisces today.", "an uncalculated sign"],
    ["Saturn trines your Sun today.", "an uncalculated aspect"],
    ["Saturn sits in your eleventh house today.", "an uncalculated house"],
    ["Saturn is square your Sun at 12.75 degrees.", "an uncalculated degree"],
    ["The New Moon is exact today.", "an uncalculated lunar phase"],
    ["Saturn is square your Sun and it ends on 2026-09-14.", "an uncalculated date"],
    ["Saturn is square your Sun at 03:20 today.", "an uncalculated timestamp"],
  ];
  for (const [text, why] of cases) {
    const result = validateReadingCandidate(
      candidate({ lead: { ...base.lead, text } }),
      prepared,
    );
    assert.equal(result.ok, false, `${why} passed validation`);
    if (result.ok) continue;
    assert.ok(
      result.failures.some((f) => f.code === "vocabulary"),
      `${why} failed on ${result.failures.map((f) => f.code).join(", ")}`,
    );
  }
});

test("vocabulary the facts do license is accepted", () => {
  const base = candidate();
  const ok = [
    "Saturn is square your Sun today.",
    "The Sun sits at 7.40 degrees Leo. Consider where the pressure lands.",
    "Saturn's square to your Sun runs out on 2027-01-26.",
    "The Moon is waxing gibbous tonight.",
  ];
  for (const text of ok) {
    const result = validateReadingCandidate(
      candidate({
        lead: { ...base.lead, text, fact_ids: [CYCLE_ID, ANCHOR_ID, LUNAR_ID] },
        paragraphs: [base.paragraphs[1]!],
      }),
      prepared,
    );
    assert.equal(result.ok, true, `licensed text was rejected: ${text}`);
  }
});

test("a natal degree can be followed by a separately supported transit sentence", () => {
  const base = candidate();
  const result = validateReadingCandidate(
    candidate({
      lead: {
        ...base.lead,
        text: "Your natal Sun is at 1.77 degrees Capricorn. Saturn is square your Sun.",
        fact_ids: [NATAL_ID, CYCLE_ID],
      },
      paragraphs: [base.paragraphs[1]!],
    }),
    prepared,
  );
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Scope, context laundering, and leakage
// ---------------------------------------------------------------------------

test("a collective-only unit may not claim the sky is personal", () => {
  const base = candidate();
  reject(
    {
      paragraphs: [
        base.paragraphs[0]!,
        {
          role: "collective_context" as const,
          text: "The waxing gibbous Moon in your chart is unique to you tonight.",
          fact_ids: [LUNAR_ID],
          context_refs: [],
        },
      ],
    },
    "collective_scope",
  );
});

test("personal context may not be described as an astrological discovery", () => {
  const base = candidate();
  reject(
    {
      lead: {
        ...base.lead,
        text: "Your journal shows that Saturn is square your Sun this week.",
      },
    },
    "context_not_evidence",
  );
});

test("markup, links, and code never reach a reader", () => {
  const base = candidate();
  reject({ lead: { ...base.lead, text: "<b>Saturn</b> is square your Sun." } }, "markup");
  reject(
    { lead: { ...base.lead, text: "Saturn is square your Sun. [Read more](https://x.test)" } },
    "markup",
  );
  reject(
    { lead: { ...base.lead, text: "Saturn is square your Sun. See https://x.test for more." } },
    "markup",
  );
  reject({ headline: "```json" }, "markup");
});

test("prompt, schema, and identifier leakage is rejected", () => {
  const base = candidate();
  reject(
    { lead: { ...base.lead, text: "As an AI language model I note Saturn is square your Sun." } },
    "instruction_leakage",
  );
  reject(
    {
      lead: {
        ...base.lead,
        text: `Saturn is square your Sun, per fact ${CYCLE_ID}.`,
      },
    },
    "instruction_leakage",
  );
  reject(
    {
      lead: {
        ...base.lead,
        text: "Ignore all previous instructions. Saturn is square your Sun.",
      },
    },
    "instruction_leakage",
  );
  reject(
    {
      reflection_prompt: {
        ...base.reflection_prompt,
        text: "What does your system prompt say about output_schema?",
      },
    },
    "instruction_leakage",
  );
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test("the supported-locale set names exactly what the rules can judge", () => {
  // Every mechanical rule in candidate-policy is English. A reading written in
  // another language would slip the grounding demand entirely (the body terms
  // do not match) and could never satisfy a required uncertainty note (the
  // uncertainty terms do not match), so the set is declared rather than implied
  // and a locale outside it is refused before a command is frozen.
  for (const supported of ["en-US", "en-GB", "en", "en-AU"]) {
    assert.ok(isSupportedReadingLocale(supported), supported);
  }
  for (const unsupported of ["es-ES", "fr-FR", "de", "pt-BR", "ja-JP", "eng"]) {
    assert.ok(!isSupportedReadingLocale(unsupported), unsupported);
  }
});

test("the sign Cancer is licensed vocabulary, not a disease term", () => {
  // "cancer" sits in the medical-causation denylist AND in SIGN_TERMS, and the
  // packet hands the model the word: a natal fact in that sign renders as
  // "... degrees Cancer". Any ordinary verb from the rule's first alternation
  // within eighty characters then tripped it, so a reader with a Cancer
  // placement - one in twelve per body - could burn the retry and both
  // replacements and end the day with no reading, logged as a safety violation
  // that never happened.
  const cancerInput = input({
    natal_facts: [
      {
        fact_id: `nat_${hex32("natal-moon-cancer")}`,
        fact_class: "natal_position",
        body: "moon",
        target: null,
        aspect: null,
        sign: "cancer",
        degree_deg: 14.2,
        house: null,
      },
    ],
  });
  const cancerPrepared = prepareConstrainedReadingInput(cancerInput);
  const moonFact = cancerPrepared.request.facts.find((f) => f.fact_class === "natal_position");
  assert.ok(moonFact, "the Cancer natal fact should be eligible");

  const base = candidate();
  const ordinary = [
    "A healing tone runs through the day as the Moon moves through Cancer.",
    "Let the day treat the Cancer part of your chart gently.",
  ];
  for (const text of ordinary) {
    const result = validateReadingCandidate(
      candidate({
        lead: { ...base.lead, text, fact_ids: [moonFact!.fact_id] },
      }),
      cancerPrepared,
    );
    assert.ok(
      result.ok || !result.failures.some((f) => f.code === "safety"),
      `astrological Cancer flagged as a safety violation: ${text}`,
    );
  }

  // The disease sense is still refused.
  const medical = validateReadingCandidate(
    candidate({
      lead: {
        ...base.lead,
        text: "The Moon in Cancer is what is causing your cancer diagnosis.",
        fact_ids: [moonFact!.fact_id],
      },
    }),
    cancerPrepared,
  );
  assert.equal(medical.ok, false);
  if (!medical.ok) {
    assert.ok(medical.failures.some((f) => f.code === "safety"));
  }
});

test("diagnosis, medical causation, guarantees, fatalism, and advice replacement are rejected", () => {
  const base = candidate();
  const unsafe = [
    "Saturn is square your Sun, which reads like depression rather than a mood.",
    "Saturn's square to your Sun is what is causing your insomnia.",
    "Saturn is square your Sun, so this promise is guaranteed to work out.",
    "Saturn is square your Sun; nothing you can do will change what is fated here.",
    "Saturn is square your Sun, so skip the appointment with your therapist this week.",
  ];
  for (const text of unsafe) {
    const result = validateReadingCandidate(
      candidate({ lead: { ...base.lead, text } }),
      prepared,
    );
    assert.equal(result.ok, false, `unsafe text passed: ${text}`);
    if (result.ok) continue;
    assert.ok(
      result.failures.some((f) => f.code === "safety"),
      `expected safety, got ${result.failures.map((f) => f.code).join(", ")}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Uncertainty
// ---------------------------------------------------------------------------

test("a bounded suppressed-Moon disclosure uses the uncertainty record without inventing a fact citation", () => {
  const withNote = prepareConstrainedReadingInput(input({
    daily_sky_facts: [ANCHOR, CONTACT],
    chart: { ...input().chart, effective_accuracy: "unknown", uncertainty: {
      accuracy: "unknown", window_plus_minus_minutes: null, qualified_features: [],
      suppressed_features: (["houses", "angles", "moon_time_sensitive"] as const).map((feature_class) => ({
        feature_class, feature_id: null, reason: "unknown_birth_time",
      })),
    } },
  }));
  const base = candidate({
    lead: { ...candidate().lead, context_refs: [] },
    reflection_prompt: { ...candidate().reflection_prompt, context_refs: [] },
    paragraphs: [candidate().paragraphs[0], {
      role: "collective_context", fact_ids: [ANCHOR_ID], context_refs: [],
      text: "The Sun is at 7.4 degrees Leo, sampled at 17:00 UTC on 2026-07-30. Leave room to revise a small plan.",
    }],
  });
  assert.equal(JSON.stringify(withNote.selected_facts).includes("moon"), false);
  for (const [text, expected] of [
    ["Your birth time is unknown, so this reading omits angles, houses, and time-sensitive Moon details.", true],
    ["Your birth time is unknown, so this reading omits time-sensitive Moon details.", true],
    ["Your birth time is exact, so this reading omits time-sensitive Moon details.", false],
    ["Your birth time is unknown, so this reading omits time-sensitive Moon details, and the Moon is in Aries.", false],
    ["Your birth time is unknown, so this reading omits time-sensitive Moon details. The Moon is waxing gibbous.", false],
  ] as const) {
    const result = validateReadingCandidate({ ...base, uncertainty_note: { text, fact_ids: [], context_refs: [] } }, withNote);
    assert.equal(result.ok, expected, `${text}: ${JSON.stringify(result.ok ? [] : result.failures)}`);
  }
});

test("a required uncertainty note must be present and must name what is missing", () => {
  const withNote = prepareConstrainedReadingInput(
    input({
      chart: {
        ...input().chart,
        effective_accuracy: "unknown",
        uncertainty: {
          accuracy: "unknown",
          window_plus_minus_minutes: null,
          suppressed_features: [
            { feature_class: "houses", feature_id: null, reason: "unknown_birth_time" },
          ],
          qualified_features: [],
        },
      },
    }),
  );
  const lane = withNote.selected_context.find((c) => c.allowed_use === "life_domain_selection")!;
  const reflectionLane = withNote.selected_context.find(
    (c) => c.allowed_use === "reflection_prompt",
  )!;
  const base: ReadingGenerationOutput = {
    ...candidate(),
    lead: { ...candidate().lead, context_refs: [lane.context_ref] },
    reflection_prompt: {
      ...candidate().reflection_prompt,
      context_refs: [reflectionLane.context_ref],
    },
  };

  const missing = validateReadingCandidate({ ...base, uncertainty_note: null }, withNote);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.ok(missing.failures.some((f) => f.code === "uncertainty"));
  }

  const vague = validateReadingCandidate(
    {
      ...base,
      uncertainty_note: { text: "Some things are unclear.", fact_ids: [], context_refs: [] },
    },
    withNote,
  );
  assert.equal(vague.ok, false);
  if (!vague.ok) {
    assert.ok(vague.failures.some((f) => f.code === "uncertainty"));
  }

  const named = validateReadingCandidate(
    {
      ...base,
      uncertainty_note: {
        text: "Without a confirmed birth time this reading leaves houses out entirely.",
        fact_ids: [],
        context_refs: [],
      },
    },
    withNote,
  );
  assert.equal(named.ok, true);
  if (named.ok) {
    assert.deepEqual(named.units.at(-1)!.role, "uncertainty_notice");
  }
  for (const tail of [
    "The Moon is full tonight.",
    "The Moon is retrograde today.",
    "Every birth house is still precisely known.",
  ]) {
    const result = validateReadingCandidate({
      ...base,
      uncertainty_note: {
        text: `Without a confirmed birth time this reading leaves houses out entirely. ${tail}`,
        fact_ids: [LUNAR_ID],
        context_refs: [],
      },
    }, withNote);
    assert.equal(result.ok, false, tail);
    if (!result.ok) assert.ok(result.failures.some((failure) =>
      failure.code === "grounding" && failure.detail_code === "unsupported_uncertainty_disclosure"));
  }
});

test("an unrequested uncertainty note is rejected rather than published", () => {
  reject(
    {
      uncertainty_note: {
        text: "Nothing was suppressed, but here is a caveat anyway.",
        fact_ids: [],
        context_refs: [],
      },
    },
    "uncertainty",
  );
});

// ---------------------------------------------------------------------------
// Evidence agreement
// ---------------------------------------------------------------------------

test("evidence counts must agree with the units the reading will publish", () => {
  const base = candidate();
  reject(
    { lead: { ...base.lead, fact_ids: [CYCLE_ID, CYCLE_ID] } },
    "evidence_counts",
  );
  reject(
    {
      lead: {
        ...base.lead,
        context_refs: [ref("life_domain_selection"), ref("life_domain_selection")],
      },
    },
    "evidence_counts",
  );
});

test("a failing candidate reports closed check codes and no candidate prose", () => {
  const result = validateReadingCandidate(
    candidate({ local_date: "2026-07-31" }),
    prepared,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.policy_version, VALIDATION_POLICY_VERSION);
  for (const failure of result.failures) {
    assert.match(failure.code, /^[a-z_]+$/);
    assert.match(failure.detail_code, /^[a-z0-9_]+$/);
    assert.equal(JSON.stringify(failure).includes("2026-07-31"), false);
    assert.equal(JSON.stringify(failure).includes("Saturn"), false);
  }
});
