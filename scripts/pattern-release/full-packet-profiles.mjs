/**
 * Adds the two realistic packet profiles to the frozen Daily evaluation corpus
 * and bumps the corpus to the current selection policy.
 *
 * `exact_full_packet` carries a launch-shaped exact-birth-time packet: 21
 * active cycles, 11 lane-2 facts (10 house placements plus the exact contact),
 * 11 lane-3 collective facts, and 28 natal facts (13 positions, 15 aspects) —
 * 71 facts total, the pressure the production model actually faces (~69
 * modelled in docs/reviews/artifacts/2026-09-13-daily-packet-size). Its
 * `unknown_full_packet` counterpart drops the house placements, the
 * Moon/angle-target cycles, and the time-sensitive natal facts exactly as an
 * unknown-birth-time calculation would.
 *
 * Deterministic and idempotent: every handle is derived from a fixed seed and
 * every candidate is a frozen synthetic string. Run from the repository root:
 *
 *   node scripts/pattern-release/full-packet-profiles.mjs
 *
 * The script only ADDS profiles and cases and bumps the corpus version/gates;
 * it never rewrites historical frozen candidates.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  here,
  "../../apps/api/test/fixtures/reading-evaluation-corpus.json",
);

const hex32 = (seed) => {
  let out = "";
  for (let i = 0; out.length < 32; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i;
    out += "0123456789abcdef"[code % 16];
  }
  return out;
};

const hex64 = (seed) => `${hex32(seed)}${hex32(`${seed}!`)}`;

const ANCHOR = "2026-07-30T17:00:00Z";
const SKY_AT = "2026-07-30T19:00:00Z";
const DAY_MS = 86_400_000;
const iso = (offsetDays, hour = 12) => {
  const base = Date.parse("2026-07-30T00:00:00Z");
  return new Date(base + offsetDays * DAY_MS)
    .toISOString()
    .replace("00:00:00.000Z", `${String(hour).padStart(2, "0")}:00:00Z`);
};

const AS_ISO = {
  policyId: "daily-sky-launch",
  policyVersion: "1.0.0",
  calcId: "transit-scan-launch",
  calcVersion: "1.4.0",
  ephemeris: "swisseph-2.10.03",
  containerDigest: "30075e4cac990e7d535229706ecebb2030075e4caadaa1f8e644744b9280ee1e",
};

function skyFact(seed, kind, scope, label, detail, precision) {
  return {
    fact_id: `dsf_${hex32(seed)}`,
    content_digest: hex64(seed),
    kind,
    scope,
    effective_at: kind === "transit_natal_contact" ? "2026-07-30T14:11:07Z" : SKY_AT,
    label,
    precision,
    detail,
    daily_sky_policy_id: AS_ISO.policyId,
    daily_sky_policy_version: AS_ISO.policyVersion,
    calculation_policy_id: AS_ISO.calcId,
    calculation_policy_version: AS_ISO.calcVersion,
    ephemeris_data_version: AS_ISO.ephemeris,
    container_digest: AS_ISO.containerDigest,
  };
}

const FULL_PRECISION = { longitude_decimals: 6, instant_resolution_seconds: null };
const EXACT_PRECISION = { longitude_decimals: null, instant_resolution_seconds: 1 };

// Saturate the base packet's four facts verbatim: the exact contact and the
// collective anchor/lunar trio are the same calculated facts on the same day.
function baseSkyFacts() {
  return [
    skyFact("fullpacket.sun", "anchor_position", "collective", "Sun at 127.40 degrees Leo",
      { body: "sun", longitude_deg: 127.4, sign: "leo", sign_degree_deg: 7.4, speed_deg_per_day: 1, retrograde: false },
      FULL_PRECISION),
    skyFact("fullpacket.moon", "anchor_position", "collective", "Moon at 270.60 degrees Leo",
      { body: "moon", longitude_deg: 270.6, sign: "leo", sign_degree_deg: 150.6, speed_deg_per_day: 1, retrograde: false },
      FULL_PRECISION),
    skyFact("fullpacket.lunar", "lunar_phase", "collective", "Waxing gibbous Moon",
      { phase: "waxing_gibbous", elongation_deg: 143.2, illuminated_fraction: 0.9 },
      FULL_PRECISION),
    skyFact("fullpacket.contact", "transit_natal_contact", "personalized", "Transiting Saturn exactly square natal Sun",
      { transiting_body: "saturn", natal_target: "sun", aspect: "square", direction: "direct", speed_deg_per_day: 0.03 },
      EXACT_PRECISION),
  ];
}

const HOUSE_BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const HOUSE_LABEL = { sun: "Sun", moon: "Moon", mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto" };

const INGRESSES = [
  { body: "mercury", from: "gemini", to: "cancer" },
  { body: "venus", from: "leo", to: "virgo" },
  { body: "mars", from: "sagittarius", to: "capricorn" },
  { body: "jupiter", from: "pisces", to: "aries" },
];

const COLLECTIVES = [
  { body: "sun", other: "mercury", aspect: "conjunction" },
  { body: "moon", other: "venus", aspect: "square" },
  { body: "mars", other: "jupiter", aspect: "trine" },
  { body: "venus", other: "saturn", aspect: "sextile" },
];

const ZODIAC = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
const POSITION_BODIES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "true_node", "ascendant", "midheaven"];
const NATAL_ASPECTS = [
  ["sun", "moon", "sextile", 1.7],
  ["sun", "mercury", "conjunction", 2.1],
  ["sun", "venus", "square", 3.2],
  ["sun", "mars", "trine", 4.1],
  ["sun", "jupiter", "trine", 2.8],
  ["moon", "venus", "sextile", 1.9],
  ["moon", "mars", "square", 2.4],
  ["mercury", "venus", "conjunction", 1.1],
  ["mercury", "mars", "sextile", 2.2],
  ["venus", "mars", "conjunction", 3.0],
  ["venus", "jupiter", "opposition", 4.6],
  ["mars", "saturn", "square", 2.7],
  ["jupiter", "saturn", "sextile", 1.8],
  ["saturn", "pluto", "square", 2.9],
  ["uranus", "neptune", "trine", 3.4],
];

// 21 active cycles: the frozen Saturn-square-Sun base cycle plus twenty
// deterministic transit contacts spanning the orb table's body classes.
const BASE_CYCLE = {
  id: "cyc_3268633a9ebd1a14e4379744bafce2b2",
  technique: "transit",
  body: "saturn",
  target: "sun",
  aspect: "square",
  start_at: "2026-07-19T05:22:10Z",
  exact_at: "2026-08-02T14:11:07Z",
  end_at: "2027-01-26T18:44:02Z",
  pass_count: 1,
  orb_deg: 0.42,
  passes: [{ pass_index: 1, direction: "direct", exact_at: "2026-08-02T14:11:07Z", speed_deg_per_day: 0.0331 }],
};

const EXTRA_CYCLES = [
  ["jupiter", "sun", "conjunction", 4],
  ["jupiter", "moon", "trine", 3],
  ["jupiter", "venus", "opposition", 4],
  ["jupiter", "venus", "sextile", 2],
  ["saturn", "mercury", "trine", 3],
  ["saturn", "mars", "sextile", 2],
  ["uranus", "sun", "trine", 2],
  ["uranus", "moon", "square", 2],
  ["uranus", "true_node", "conjunction", 3],
  ["neptune", "sun", "sextile", 1.5],
  ["neptune", "mercury", "trine", 2],
  ["neptune", "uranus", "opposition", 3],
  ["pluto", "pluto", "conjunction", 3],
  ["pluto", "uranus", "sextile", 1.5],
  ["pluto", "saturn", "square", 2],
  ["jupiter", "jupiter", "trine", 3],
  ["saturn", "pluto", "sextile", 2],
  ["uranus", "mars", "opposition", 3],
  ["neptune", "neptune", "conjunction", 3],
  ["pluto", "venus", "trine", 2],
];

function extraCycle(index, [body, target, aspect, orbDeg]) {
  const startOffset = -(260 - index * 8);
  const exactOffset = startOffset + (200 - index * 9);
  const endOffset = startOffset + (380 - index * 10);
  const exactAt = iso(exactOffset);
  return {
    id: `cyc_${hex32(`fullpacket-cycle-${index}`)}`,
    technique: "transit",
    body,
    target,
    aspect,
    start_at: iso(startOffset),
    exact_at: exactAt,
    end_at: iso(endOffset),
    pass_count: 1,
    orb_deg: orbDeg,
    passes: [{ pass_index: 1, direction: index % 2 ? "retrograde" : "direct", exact_at: exactAt, speed_deg_per_day: 0.02 + index * 0.0014 }],
  };
}

function exactCycles() {
  return [BASE_CYCLE, ...EXTRA_CYCLES.map((entry, index) => extraCycle(index, entry))];
}

function cyclesForUnknown(cycles) {
  return cycles.filter((cycle) => !["moon", "ascendant", "midheaven"].includes(cycle.target));
}

function houseFacts() {
  return HOUSE_BODIES.map((body, index) =>
    skyFact(`fullpacket.house-${body}`, "house_placement", "personalized",
      `${HOUSE_LABEL[body]} in house ${index + 1}`,
      { body, house: index + 1, house_system: "placidus", longitude_deg: 15.5 + index * 31.7 },
      FULL_PRECISION));
}

function ingressFacts() {
  return INGRESSES.map((entry) =>
    skyFact(`fullpacket.ingress-${entry.body}`, "sign_ingress", "collective",
      `${HOUSE_LABEL[entry.body]} enters ${entry.to}`,
      { body: entry.body, from_sign: entry.from, to_sign: entry.to, direction: "direct" },
      EXACT_PRECISION));
}

function collectiveFacts() {
  return COLLECTIVES.map((entry) =>
    skyFact(`fullpacket.collective-${entry.body}-${entry.other}`, "collective_exact_aspect", "collective",
      `${HOUSE_LABEL[entry.body]} exactly ${entry.aspect} ${HOUSE_LABEL[entry.other]}`,
      { body: entry.body, other_body: entry.other, aspect: entry.aspect, direction: "direct" },
      EXACT_PRECISION));
}

function exactSkyFacts() {
  return [...baseSkyFacts(), ...houseFacts(), ...ingressFacts(), ...collectiveFacts()];
}

/**
 * Project first, filter second.
 *
 * A natal position is a property of the chart, and both profiles are the SAME
 * chart — they share `chart.fingerprint`, and each body keeps one `fact_id`
 * across both. Deriving sign and degree from the post-filter index made them a
 * property of the guest list instead: dropping the Moon and the two angles for
 * the unknown-time counterpart re-indexed every later body, moving Mercury from
 * gemini 4.76 to taurus 2.63 under an unchanged fact_id and an unchanged
 * fingerprint. That is not the same chart with time-sensitive facts suppressed,
 * which is the one thing this profile pair exists to model.
 */
function natalPositions(includeTimeSensitive) {
  return POSITION_BODIES.map((body, index) => ({
    fact_id: `nat_${hex32(`fullpacket-position-${body}`)}`,
    fact_class: "natal_position",
    body,
    target: null,
    aspect: null,
    sign: ZODIAC[index % 12],
    degree_deg: Math.round((0.5 + index * 2.13) * 1e6) / 1e6,
    house: null,
  })).filter(
    ({ body }) =>
      includeTimeSensitive || !["moon", "ascendant", "midheaven"].includes(body),
  );
}

function natalAspects(includeMoon) {
  return NATAL_ASPECTS.filter(([a, b]) => includeMoon || !(a === "moon" || b === "moon")).map(([body, target, aspect, orb]) => ({
    fact_id: `nat_${hex32(`fullpacket-aspect-${body}-${target}`)}`,
    fact_class: "natal_aspect",
    body,
    target,
    aspect,
    sign: null,
    degree_deg: orb,
    house: null,
  }));
}

const UNKNOWN_CHART = {
  fingerprint: "393588e8add3df2282477d79cc2ce1173935869f9becf5f1425b57a8b1bd0e17",
  contract_id: "calc-contract-launch",
  contract_version: "0.2.0",
  container_digest: "30075e4cac990e7d535229706ecebb2030075e4caadaa1f8e644744b9280ee1e",
  effective_accuracy: "unknown",
  uncertainty: {
    accuracy: "unknown",
    window_plus_minus_minutes: null,
    suppressed_features: [
      { feature_class: "houses", reason: "birth_time_unknown" },
      { feature_class: "angles", reason: "birth_time_unknown" },
      { feature_class: "moon_time_sensitive", reason: "birth_time_unknown" },
    ],
    qualified_features: [],
  },
};

function acceptCandidate(id, profile, notes, withUncertaintyNote) {
  return {
    id,
    profile,
    expect: "accept",
    notes,
    candidate: {
      schema_version: "0.5.0",
      output_schema: "daily-reading-v5",
      local_date: "2026-07-30",
      locale: "en-US",
      headline: "A narrower commitment",
      lead: {
        text: "Saturn is square your Sun today. You could pause to consider which commitment would fit the time and attention available to you.",
        fact_ids: ["cyc_3268633a9ebd1a14e4379744bafce2b2"],
        context_refs: ["ctx_1"],
      },
      paragraphs: [{
        role: "supporting_theme",
        text: "If several versions of a plan are competing for your attention, consider which one would fit an ordinary day. A smaller commitment may be easier to revisit.",
        fact_ids: [],
        context_refs: ["ctx_1"],
      }],
      reflection_prompt: {
        text: "What would you keep doing if no one noticed for a month?",
        fact_ids: [],
        context_refs: ["ctx_1"],
      },
      uncertainty_note: withUncertaintyNote
        ? { text: "Your birth time is unknown, so this reading claims nothing about houses or angles.", fact_ids: [], context_refs: [] }
        : null,
    },
  };
}

function rejectCandidate(id, profile, notes, withUncertaintyNote) {
  return {
    id,
    profile,
    expect: "reject",
    expect_detail: "grounding.unsupported_fact_relationship",
    notes,
    candidate: {
      schema_version: "0.5.0",
      output_schema: "daily-reading-v5",
      local_date: "2026-07-30",
      locale: "en-US",
      headline: "A narrower commitment",
      lead: {
        text: "Saturn is square your Sun today, and the pressure asks for a smaller promise than the one you had in mind.",
        fact_ids: ["cyc_3268633a9ebd1a14e4379744bafce2b2"],
        context_refs: ["ctx_1"],
      },
      paragraphs: [{
        role: "supporting_theme",
        text: "You have been holding two versions of the same plan. Only one of them survives an ordinary Tuesday.",
        fact_ids: [],
        context_refs: ["ctx_1"],
      }],
      reflection_prompt: {
        text: "What would you keep doing if no one noticed for a month?",
        fact_ids: [],
        context_refs: ["ctx_1"],
      },
      uncertainty_note: withUncertaintyNote
        ? { text: "Your birth time is unknown, so this reading claims nothing about houses or angles.", fact_ids: [], context_refs: [] }
        : null,
    },
  };
}

const corpus = JSON.parse(readFileSync(fixturePath, "utf8"));

const HISTORICAL_COMMENT = [
  "Synthetic regression evaluation only. No real account, birth data, D1 input, provider call, or freshly sampled model output.",
  "Every candidate is a frozen authored test string. This corpus pins what the configured deterministic publication policies accept and reject.",
  "Changing the model, reasoning effort, response ceiling, prompt, selection policy, or validation policy requires re-running this corpus, incrementing corpus_version, and updating gates.",
  "Historical version 1.0.3 revalidated the same synthetic candidates for Sol/xhigh with unchanged prompts and scoring policies.",
  "Version 1.1.0 preserves every historical candidate and qualitative expectation, reclassifies six previous accepts under relational claim validation, and adds separately identified acceptance and adversarial cases.",
  "Version 1.1.1 revalidates the same frozen candidates after permitting a comma before a fully bound aspect-orb suffix and supporting bounded Moon-suppression disclosures directly from the uncertainty record, including Oxford commas. The fresh provider samples that exposed these rejections are separate evidence, not part of this synthetic corpus.",
  "The evaluation scoring policy is unchanged. These offline regressions do not measure live model quality or establish production deployment evidence.",
];
const VERSION_12_COMMENT =
  "Version 1.2.0 bumps the selection policy to 1.3.0 (within-lane DER-02 ranking, exactness temporal proxy) and adds the two realistic full-packet profiles generated by scripts/pattern-release/full-packet-profiles.mjs: exact_full_packet (71 facts) and its unknown-birth-time counterpart unknown_full_packet (53 facts). Historical candidate strings remain frozen.";

// Profiles are pure functions of the tables above, so they are rebuilt on every
// run rather than skipped when already present. Skipping is what stopped a
// corrected generator from repairing the fixture it had previously written: the
// header promises "deterministic and idempotent", and idempotent has to mean
// "converges on the right bytes", not "declines to look". The frozen CANDIDATES
// are protected separately, by the id reconciliation below.
{
  corpus.corpus_version = "1.2.0";
  corpus["//"] = [...HISTORICAL_COMMENT, VERSION_12_COMMENT];
  corpus.gates.selection_policy_version = "1.3.0";
  corpus.base.selection_policy_version = "1.3.0";

  const exactCyclesList = exactCycles();
  const exactSky = exactSkyFacts();
  const exactNatal = [...natalPositions(true), ...natalAspects(true)];

  corpus.profiles.exact_full_packet = {
    shape: "exact_time",
    description:
      "A launch-shaped exact-birth-time packet: 21 cycles, 11 lane-2 facts, 11 lane-3 facts, and 28 natal facts. Selection, not validation, is what this profile stresses: the model must choose about six prose units from 71 ranked facts.",
    overrides: {
      cycles: exactCyclesList,
      daily_sky_facts: exactSky,
      natal_facts: exactNatal,
    },
  };

  corpus.profiles.unknown_full_packet = {
    shape: "unknown_time",
    description:
      "The unknown-birth-time counterpart: house placements, Moon/angle-target cycles, and time-sensitive natal facts are absent exactly as an unknown-time calculation would omit them.",
    overrides: {
      chart: UNKNOWN_CHART,
      cycles: cyclesForUnknown(exactCyclesList),
      daily_sky_facts: exactSky.filter((fact) => fact.kind !== "house_placement"),
      natal_facts: [...natalPositions(false), ...natalAspects(false)],
    },
  };
}

// Case reconciliation runs every time, so a corrected generator re-run repairs
// a fixture without duplicating or rewriting the historical frozen candidates.
{
  const NEW_CASES = [
    acceptCandidate("fullpacket.accept.relational", "exact_full_packet",
      "Relational acceptance control for the realistic 71-fact packet: the factual sentence names one supplied record, so selection pressure does not change what is checkable."),
    rejectCandidate("fullpacket.reject.ungrounded", "exact_full_packet",
      "The historical grounding rejection at full packet size: a factual sentence that combines a supported relationship with an unparsed reflective clause still fails exactly as it fails on a six-fact packet."),
    acceptCandidate("unknown_full.accept.relational", "unknown_full_packet",
      "Relational acceptance control for the unknown-time full packet, including the bounded uncertainty disclosure.", true),
    rejectCandidate("unknown_full.reject.ungrounded", "unknown_full_packet",
      "The unknown-time counterpart rejects the ungrounded reflective clause exactly as the exact-time packet does.", true),
  ];

  const existingIds = new Set(corpus.cases.map((entry) => entry.id));
  for (const entry of NEW_CASES) {
    if (!existingIds.has(entry.id)) corpus.cases.push(entry);
  }
}

writeFileSync(fixturePath, `${JSON.stringify(corpus, null, 2)}\n`);

const summary = {
  corpus_version: corpus.corpus_version,
  gates: corpus.gates,
  exact_full_packet_facts:
    corpus.profiles.exact_full_packet.overrides.cycles.length +
    corpus.profiles.exact_full_packet.overrides.daily_sky_facts.length +
    corpus.profiles.exact_full_packet.overrides.natal_facts.length,
  unknown_full_packet_facts:
    corpus.profiles.unknown_full_packet.overrides.cycles.length +
    corpus.profiles.unknown_full_packet.overrides.daily_sky_facts.length +
    corpus.profiles.unknown_full_packet.overrides.natal_facts.length,
  new_cases: corpus.cases.slice(-4).map((entry) => entry.id),
};
console.log(JSON.stringify(summary, null, 2));