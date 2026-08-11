import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LUNAR_PHASE_NAMES,
  M5_SCHEMA_VERSION,
  jcsCanonicalize,
  type DailySkyFact,
  type DailySkyRequest,
  type SuppressedFeatureClass,
} from "@patternlike/shared";
import { jdFromUnixMs } from "./cycles.js";
import type { EphemerisSource } from "./cycles.js";
import type { TransitingBody } from "./cycle-policy.js";
import {
  DailySkyRequestError,
  calculateDailySky,
  handleDailySky,
  validateDailySkyRequest,
} from "./daily-sky.js";

/**
 * An analytic ephemeris: linear longitude, constant speed.
 *
 * The policy under test is root-finding, ordering, identity, and suppression —
 * none of which needs Swiss Ephemeris to be exercised, and all of which becomes
 * unfalsifiable if the expected answers are read out of the same library that
 * produced them. Real ephemeris agreement is `daily-sky-golden.test.ts`.
 */
const DAY0 = jdFromUnixMs(Date.parse("2026-07-30T00:00:00Z"));

function analytic(model: Partial<Record<TransitingBody, [base: number, rate: number]>>): EphemerisSource {
  return {
    stateAt(body, jd) {
      const entry = model[body];
      if (!entry) throw new Error(`analytic source has no ${body}`);
      const [base, rate] = entry;
      const t = jd - DAY0;
      const lon = base + rate * t;
      return { lon: ((lon % 360) + 360) % 360, speed: rate };
    },
  };
}

const DAY_START = "2026-07-30T07:00:00Z";
const DAY_END = "2026-07-31T07:00:00Z";
const ANCHOR = "2026-07-30T19:00:00Z";
const T_START = (Date.parse(DAY_START) - Date.parse("2026-07-30T00:00:00Z")) / 86_400_000;
const T_END = (Date.parse(DAY_END) - Date.parse("2026-07-30T00:00:00Z")) / 86_400_000;

/** The instant a linear body reaches `target`, as a whole-second ISO string. */
function crossingAt(base: number, rate: number, target: number): string {
  const t = (target - base) / rate;
  const ms = Date.parse("2026-07-30T00:00:00Z") + t * 86_400_000;
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/\.000Z$/, "Z");
}

const BODIES: readonly TransitingBody[] = ["sun", "moon", "saturn"];

function request(overrides: Partial<DailySkyRequest> = {}): DailySkyRequest {
  const suppressed = (overrides.suppressed_features ?? []) as SuppressedFeatureClass[];
  return {
    schema_version: M5_SCHEMA_VERSION,
    request_id: "req_01JAMPLEDAILYSKY0001",
    day_start_at: DAY_START,
    day_end_at: DAY_END,
    anchor_at: ANCHOR,
    anchor_resolution: "unique",
    natal_positions: [{ body: "sun", longitude_deg: 0 }],
    natal_house_cusps: null,
    effective_accuracy: "exact",
    uncertainty: {
      accuracy: "exact",
      window_plus_minus_minutes: null,
      suppressed_features: suppressed.map((feature_class) => ({
        feature_class,
        feature_id: null,
        reason: "unknown_birth_time",
      })),
      qualified_features: [],
    },
    suppressed_features: suppressed,
    zodiac: "tropical",
    node: "true",
    ephemeris_data_version: "analytic-test",
    tzdb_version: "2026c",
    local_day_resolution_policy_version: "1.0.0",
    daily_sky_policy_id: "daily-sky-launch",
    daily_sky_policy_version: "1.0.0",
    calculation_policy_id: "swiss-ephemeris-launch",
    calculation_policy_version: "1.0.0",
    contract_id: "patternlike.chart.launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

function scan(
  req: DailySkyRequest,
  model: Partial<Record<TransitingBody, [number, number]>>,
  bodies: readonly TransitingBody[] = BODIES,
): DailySkyFact[] {
  return calculateDailySky(validateDailySkyRequest(req), {
    source: analytic(model),
    bodies,
    containerDigest: "sha256:" + "7e".repeat(32),
    ephemerisDataVersion: "analytic-test",
  });
}

/** A day on which nothing crosses anything. */
const QUIET = { sun: [100, 1], moon: [215, 12], saturn: [305, -0.05] } as const;
const kinds = (facts: DailySkyFact[]) => facts.map((f) => f.kind);

// ---------------------------------------------------------------------------
// The zero-event day
// ---------------------------------------------------------------------------

test("a day with no event still has anchor positions and exactly one phase", () => {
  const facts = scan(request(), { ...QUIET });
  // This is the whole reason the endpoint exists: an empty EVENT list must not
  // mean an empty FACTUAL day, or the publisher has nothing to be grounded in.
  assert.deepEqual(kinds(facts), [
    "anchor_position",
    "anchor_position",
    "anchor_position",
    "lunar_phase",
  ]);
  assert.equal(facts.filter((f) => f.kind === "lunar_phase").length, 1);
  for (const fact of facts) {
    assert.equal(fact.effective_at, ANCHOR, "an anchor-sampled fact carries the anchor instant");
    assert.equal(fact.scope, "collective");
  }
});

test("anchor positions carry sign, degree, speed, and retrograde state", () => {
  const facts = scan(request(), { ...QUIET });
  const saturn = facts.find(
    (f) => f.kind === "anchor_position" && (f.detail as { body: string }).body === "saturn",
  );
  assert.ok(saturn);
  assert.deepEqual(saturn.detail, {
    body: "saturn",
    longitude_deg: 304.960417,
    sign: "aquarius",
    sign_degree_deg: 4.960417,
    speed_deg_per_day: -0.05,
    retrograde: true,
  });
  assert.equal(saturn.label, "Saturn at 4.96 degrees Aquarius, retrograde");
  assert.deepEqual(saturn.precision, { longitude_decimals: 6, instant_resolution_seconds: null });
});

// ---------------------------------------------------------------------------
// Half-open boundaries
// ---------------------------------------------------------------------------

test("an event exactly at day start is included and one exactly at day end is not", () => {
  // The Sun crosses the natal conjunction target at whichever instant the base
  // is solved for, so the same model answers both halves of the rule.
  const atStart = scan(request(), { ...QUIET, sun: [0 - 1 * T_START, 1] });
  const startContacts = atStart.filter((f) => f.kind === "transit_natal_contact");
  assert.equal(startContacts.length, 1, "a root exactly at day_start_at belongs to this day");
  assert.equal(startContacts[0]!.effective_at, DAY_START);

  const atEnd = scan(request(), { ...QUIET, sun: [0 - 1 * T_END, 1] });
  assert.equal(
    atEnd.filter((f) => f.kind === "transit_natal_contact").length,
    0,
    "a root exactly at day_end_at belongs to the NEXT day",
  );
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test("an exact transit-to-natal contact is solved, labelled, and marked personalized", () => {
  // Saturn at 1 degree/day retrograde crosses natal Sun + 90 inside the day.
  const model = { ...QUIET, saturn: [91, -1] as [number, number] };
  const facts = scan(request(), model);
  const contact = facts.find((f) => f.kind === "transit_natal_contact");
  assert.ok(contact);
  assert.equal(contact.effective_at, crossingAt(91, -1, 90));
  assert.equal(contact.scope, "personalized");
  assert.equal(contact.label, "Transiting Saturn exactly square natal Sun");
  assert.deepEqual(contact.detail, {
    transiting_body: "saturn",
    natal_target: "sun",
    aspect: "square",
    direction: "retrograde",
    speed_deg_per_day: -1,
  });
  assert.deepEqual(contact.precision, {
    longitude_decimals: null,
    instant_resolution_seconds: 1,
  });
});

test("a sign ingress reports the sign it entered and the direction it entered from", () => {
  // The Moon crosses 240 degrees — the Sagittarius boundary — moving forward.
  const facts = scan(request(), { ...QUIET, moon: [236, 12] });
  const ingress = facts.find((f) => f.kind === "sign_ingress");
  assert.ok(ingress);
  assert.equal(ingress.effective_at, crossingAt(236, 12, 240));
  assert.equal(ingress.label, "Moon enters Sagittarius");
  assert.deepEqual(ingress.detail, {
    body: "moon",
    from_sign: "scorpio",
    to_sign: "sagittarius",
    direction: "direct",
  });

  // The same boundary crossed backwards is an ingress into the PREVIOUS sign,
  // not the same event relabelled.
  const back = scan(request(), { ...QUIET, moon: [244, -12] });
  const retro = back.find((f) => f.kind === "sign_ingress");
  assert.ok(retro);
  assert.equal(retro.label, "Moon enters Scorpio");
  assert.deepEqual((retro.detail as { direction: string }).direction, "retrograde");
});

test("an exact collective aspect is reported as collective, and the Moon is excluded", () => {
  // Sun and Saturn come to an exact trine; the Moon forms a major aspect to
  // something every few hours and would bury the facts that distinguish a day.
  const facts = scan(request(), { ...QUIET, sun: [100, 1], saturn: [221, -0.05] });
  const aspects = facts.filter((f) => f.kind === "collective_exact_aspect");
  assert.equal(aspects.length, 1);
  assert.equal(aspects[0]!.scope, "collective");
  assert.equal(aspects[0]!.label, "Sun exactly trine Saturn");
  assert.deepEqual(aspects[0]!.detail, {
    body: "sun",
    other_body: "saturn",
    aspect: "trine",
    direction: "direct",
  });
});

// ---------------------------------------------------------------------------
// Lunar phase
// ---------------------------------------------------------------------------

test("every lunar bin is reachable and centred on its name", () => {
  const t = (Date.parse(ANCHOR) - Date.parse("2026-07-30T00:00:00Z")) / 86_400_000;
  const seen = new Set<string>();
  for (const centre of [0, 45, 90, 135, 180, 225, 270, 315]) {
    // Solve for a Moon whose anchor elongation is exactly the bin centre.
    const sunAtAnchor = 100 + t;
    const facts = scan(request(), {
      ...QUIET,
      moon: [((sunAtAnchor + centre) % 360) - 12 * t, 12],
    });
    const phase = facts.find((f) => f.kind === "lunar_phase");
    assert.ok(phase, `bin ${centre} produced a phase`);
    const detail = phase.detail as { phase: string; elongation_deg: number };
    const offBy = Math.abs(((detail.elongation_deg - centre + 540) % 360) - 180);
    assert.ok(offBy < 0.001, `bin ${centre} landed at ${detail.elongation_deg}`);
    seen.add(detail.phase);
  }
  assert.deepEqual([...seen].sort(), [...LUNAR_PHASE_NAMES].sort());
});

// ---------------------------------------------------------------------------
// Houses and suppression
// ---------------------------------------------------------------------------

const CUSPS = {
  house_system: "placidus",
  cusps_deg: [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
};

test("a house placement appears only when the request supplies cusps", () => {
  const withCusps = scan(request({ natal_house_cusps: CUSPS }), { ...QUIET });
  const houses = withCusps.filter((f) => f.kind === "house_placement");
  assert.equal(houses.length, 3, "one per anchored body");
  const saturn = houses.find((f) => (f.detail as { body: string }).body === "saturn");
  assert.ok(saturn);
  assert.equal(saturn.scope, "personalized");
  assert.equal(saturn.effective_at, ANCHOR, "houses are sampled at the anchor, not solved");
  assert.equal(saturn.label, "Transiting Saturn in the tenth house");
  assert.equal((saturn.detail as { house: number }).house, 10);

  // Absent is the normal case, not a degraded one: a house computed from a noon
  // epoch and then labelled uncertain is a fact the engine should never have
  // made.
  assert.equal(scan(request(), { ...QUIET }).filter((f) => f.kind === "house_placement").length, 0);
});

test("the request object is closed, so private fields cannot ride along", () => {
  // The closure IS the enforcement: the M5 schema and the calc OpenAPI both say
  // so, and this service has no decryption path, so a user id or a birth
  // instant reaching it would be a field nobody can justify. /v1/cycles has
  // refused undeclared properties since M3; this endpoint shipped without it,
  // which made the guarantee a comment rather than a check.
  for (const injected of [
    { user_id: "usr_0000000000000001" },
    { birth_instant: "1991-01-14T17:42:00Z" },
    { latitude: 41.8781, longitude: -87.6298 },
    { timezone: "America/Chicago" },
    { chart_id: "cht_0000000000000001" },
  ]) {
    assert.throws(
      () => validateDailySkyRequest({ ...request(), ...injected }),
      /undeclared property/,
      `accepted ${Object.keys(injected).join(", ")}`,
    );
  }

  // Nested objects are closed too.
  assert.throws(
    () =>
      validateDailySkyRequest(
        request({
          natal_positions: [
            { body: "sun", longitude_deg: 0, chart_fingerprint: "a".repeat(64) } as never,
          ],
        }),
      ),
    /undeclared property .* in natal_positions/,
  );
  assert.throws(
    () =>
      validateDailySkyRequest(
        request({ natal_house_cusps: { ...CUSPS, birth_place: "Chicago" } as never }),
      ),
    /undeclared property .* in natal_house_cusps/,
  );

  // And a request carrying only declared properties still validates.
  assert.doesNotThrow(() => validateDailySkyRequest(request()));
});

test("suppressed features are refused as INPUTS rather than filtered from output", () => {
  // A longitude that reached the scanner would come back as a contact the
  // uncertainty report says is unavailable, so the refusal is at the door.
  assert.throws(
    () =>
      validateDailySkyRequest(
        request({
          suppressed_features: ["houses", "angles", "angle_transits", "moon_time_sensitive"],
          natal_house_cusps: CUSPS,
        }),
      ),
    /house cusps supplied while houses are suppressed/,
  );

  assert.throws(
    () =>
      validateDailySkyRequest(
        request({
          suppressed_features: ["angles", "angle_transits"],
          natal_positions: [
            { body: "sun", longitude_deg: 0 },
            { body: "ascendant", longitude_deg: 14 },
          ],
        }),
      ),
    /angle targets supplied while angles are suppressed/,
  );

  assert.throws(
    () =>
      validateDailySkyRequest(
        request({
          suppressed_features: ["moon_time_sensitive"],
          natal_positions: [
            { body: "sun", longitude_deg: 0 },
            { body: "moon", longitude_deg: 12 },
          ],
        }),
      ),
    /natal moon supplied while moon_time_sensitive is suppressed/,
  );
});

test("an unknown-time request still produces a full factual day", () => {
  const unknown = request({
    effective_accuracy: "unknown",
    suppressed_features: ["angle_transits", "angles", "houses", "moon_time_sensitive"],
    natal_positions: [{ body: "sun", longitude_deg: 0 }],
  });
  unknown.uncertainty.accuracy = "unknown";
  const facts = scan(unknown, { ...QUIET });
  assert.ok(facts.some((f) => f.kind === "anchor_position"));
  assert.equal(facts.filter((f) => f.kind === "lunar_phase").length, 1);
  assert.equal(facts.filter((f) => f.kind === "house_placement").length, 0);
  // A TRANSITING Moon remains valid against stable natal targets: the transit
  // instant is known even when the birth instant is not.
  const transitingMoon = scan(
    { ...unknown, natal_positions: [{ body: "sun", longitude_deg: 0 }] },
    { ...QUIET, moon: [354, 12] },
  );
  assert.ok(
    transitingMoon.some(
      (f) =>
        f.kind === "transit_natal_contact" &&
        (f.detail as { transiting_body: string }).transiting_body === "moon",
    ),
  );
});

// ---------------------------------------------------------------------------
// Determinism and identity
// ---------------------------------------------------------------------------

test("identical requests produce byte-identical output", () => {
  const model = { ...QUIET, saturn: [91, -1] as [number, number], moon: [236, 12] as [number, number] };
  const first = scan(request(), model);
  const second = scan(request(), model);
  assert.equal(jcsCanonicalize(first), jcsCanonicalize(second));
});

test("facts are ordered by kind rank, then instant, then id, with unique ids", () => {
  const facts = scan(request({ natal_house_cusps: CUSPS }), {
    ...QUIET,
    saturn: [91, -1],
    moon: [236, 12],
  });
  const rank = [
    "anchor_position",
    "lunar_phase",
    "transit_natal_contact",
    "sign_ingress",
    "collective_exact_aspect",
    "house_placement",
  ];
  const ranks = facts.map((f) => rank.indexOf(f.kind));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  const ids = facts.map((f) => f.fact_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const fact of facts) {
    assert.match(fact.fact_id, /^dsf_[a-f0-9]{32}$/);
    assert.match(fact.content_digest, /^sha256:[a-f0-9]{64}$/);
    // The two are one value seen twice, so their agreement is checkable without
    // recomputing the preimage.
    assert.equal(fact.fact_id, `dsf_${fact.content_digest.slice(7, 39)}`);
  }
});

test("a moved instant moves the identity", () => {
  const early = scan(request(), { ...QUIET, saturn: [91, -1] });
  const late = scan(request(), { ...QUIET, saturn: [91.2, -1] });
  const a = early.find((f) => f.kind === "transit_natal_contact")!;
  const b = late.find((f) => f.kind === "transit_natal_contact")!;
  assert.notEqual(a.effective_at, b.effective_at);
  assert.notEqual(a.fact_id, b.fact_id);
});

// ---------------------------------------------------------------------------
// The handler envelope
// ---------------------------------------------------------------------------

test("a refusal is a discriminated body, not a status", () => {
  const bad = handleDailySky({ ...request(), day_end_at: DAY_START });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error_class, "invalid_request");
    assert.equal(bad.request_id, "req_01JAMPLEDAILYSKY0001");
    // Payload-free: upstream Swiss Ephemeris messages have leaked absolute
    // filesystem paths.
    assert.ok(!/[A-Za-z]:\\|\/usr\/|\/home\//.test(bad.error_message));
  }
});

test("the success envelope echoes the day, the anchor, and every policy it was asked for", () => {
  const req = request();
  const response = handleDailySky(req, {
    source: analytic({ ...QUIET }),
    bodies: BODIES,
    containerDigest: "sha256:" + "7e".repeat(32),
    ephemerisDataVersion: "analytic-test",
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.day_start_at, req.day_start_at);
  assert.equal(response.day_end_at, req.day_end_at);
  assert.equal(response.anchor_at, req.anchor_at);
  assert.equal(response.anchor_resolution, req.anchor_resolution);
  assert.equal(response.effective_accuracy, req.effective_accuracy);
  assert.equal(response.tzdb_version, req.tzdb_version);
  assert.equal(response.daily_sky_policy_version, req.daily_sky_policy_version);
  assert.equal(response.contract_version, req.contract_version);
  assert.ok(response.facts.length >= 2);
});

test("a policy version this build does not implement is refused, not answered", () => {
  // Answering under the policy it has would put a policy label on facts that
  // policy never produced.
  const refused = handleDailySky(request({ daily_sky_policy_version: "9.9.9" }));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error_class, "invalid_request");

  const outOfRange = handleDailySky(
    request({ day_start_at: "1799-07-30T07:00:00Z", day_end_at: "1799-07-31T07:00:00Z", anchor_at: "1799-07-30T19:00:00Z" }),
  );
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.equal(outOfRange.error_class, "ephemeris_range");
});

test("validation rejects a request whose two copies of one decision disagree", () => {
  const mismatched = request();
  mismatched.effective_accuracy = "unknown";
  assert.throws(() => validateDailySkyRequest(mismatched), DailySkyRequestError);

  const drifted = request();
  drifted.suppressed_features = ["houses"];
  assert.throws(
    () => validateDailySkyRequest(drifted),
    /suppressed_features disagrees with the uncertainty report/,
  );
});
