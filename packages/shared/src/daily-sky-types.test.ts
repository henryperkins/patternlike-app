import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { jcsCanonicalize } from "./jcs.js";
import {
  ANCHOR_SAMPLED_KINDS,
  DAILY_SKY_FACT_IDENTITY_PROFILE,
  DAILY_SKY_FACT_KIND_RANK,
  DAILY_SKY_FACT_KINDS,
  DAILY_SKY_POLICY_ID,
  DAILY_SKY_POLICY_VERSION,
  DailySkyIdentityError,
  LOCAL_DAY_RESOLUTION_POLICY_VERSION,
  LUNAR_PHASE_NAMES,
  PERSONALIZED_KINDS,
  ZODIAC_SIGNS,
  buildDailySkyFactIdentity,
  classifyV5CalculationFailure,
  lunarPhaseOf,
  orderDailySkyFacts,
  renderDailySkyFactId,
  zodiacSignOf,
  type DailySkyFact,
  type DailySkyFactCore,
  type DailySkyRequest,
} from "./daily-sky-types.js";
import { M5_SCHEMA_VERSION } from "./m5-reading-types.js";
import { sealDailySkyFact } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(here, "../../../contracts/m5");

interface Vector {
  name: string;
  input: Record<string, unknown>;
  canonical: string;
  full_digest: string;
  rendered_id: string;
}

const vectors: Vector[] = JSON.parse(
  readFileSync(
    path.join(CONTRACTS, "fixtures/canonicalization/daily-sky-fact-golden-vectors.json"),
    "utf8",
  ),
).vectors;

const vector = (name: string): Vector => {
  const found = vectors.find((v) => v.name === name);
  assert.ok(found, `vector ${name} is present`);
  return found;
};

const readFixture = (rel: string): any =>
  JSON.parse(readFileSync(path.join(CONTRACTS, "fixtures", rel), "utf8"));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("the pinned policy identifiers match the contract package", () => {
  const request = readFixture("valid/daily-sky-request.exact.json") as DailySkyRequest;
  assert.equal(M5_SCHEMA_VERSION, "0.5.0");
  assert.equal(DAILY_SKY_POLICY_ID, "daily-sky-launch");
  assert.equal(DAILY_SKY_POLICY_VERSION, "1.0.0");
  assert.equal(LOCAL_DAY_RESOLUTION_POLICY_VERSION, "1.0.0");
  assert.equal(request.daily_sky_policy_id, DAILY_SKY_POLICY_ID);
  assert.equal(request.daily_sky_policy_version, DAILY_SKY_POLICY_VERSION);
  assert.equal(
    request.local_day_resolution_policy_version,
    LOCAL_DAY_RESOLUTION_POLICY_VERSION,
  );
});

test("the closed vocabularies are exactly the contract enums, in order", () => {
  const common = JSON.parse(readFileSync(path.join(CONTRACTS, "common.schema.json"), "utf8"));
  assert.deepEqual([...DAILY_SKY_FACT_KINDS], common.$defs.dailySkyFactKind.enum);
  assert.deepEqual([...LUNAR_PHASE_NAMES], common.$defs.lunarPhaseName.enum);
  assert.deepEqual([...ZODIAC_SIGNS], common.$defs.zodiacSign.enum);
  assert.deepEqual([...DAILY_SKY_FACT_KINDS], Object.keys(DAILY_SKY_FACT_KIND_RANK));
});

test("scope is a property of the kind, not of the prose", () => {
  // A collective configuration described as personal is the one claim a reader
  // cannot check, so which kinds are personalized is frozen here rather than
  // decided per fact.
  assert.deepEqual([...PERSONALIZED_KINDS].sort(), ["house_placement", "transit_natal_contact"]);
  assert.deepEqual(
    [...ANCHOR_SAMPLED_KINDS].sort(),
    ["anchor_position", "house_placement", "lunar_phase"],
  );
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("golden vectors reproduce byte-for-byte, not merely digest-for-digest", async () => {
  assert.ok(vectors.length >= 5, "expected the full vector set");
  for (const v of vectors) {
    assert.equal(jcsCanonicalize(v.input), v.canonical, `canonical bytes for ${v.name}`);
    const { fact_id, content_digest } = await sealDailySkyFact(
      v.input as unknown as DailySkyFactCore,
    );
    assert.equal(content_digest, `sha256:${v.full_digest}`, `digest for ${v.name}`);
    assert.equal(fact_id, v.rendered_id, `fact_id for ${v.name}`);
  }
});

test("the preimage carries the domain tag and drops the two derived members", async () => {
  const response = readFixture("valid/daily-sky-response.exact-events.json");
  const wire = response.facts[0] as DailySkyFact;
  const { fact_id, content_digest, ...core } = wire;
  const preimage = buildDailySkyFactIdentity(core as DailySkyFactCore);

  assert.equal(preimage.identity_profile, DAILY_SKY_FACT_IDENTITY_PROFILE);
  assert.equal(preimage.schema_version, M5_SCHEMA_VERSION);
  assert.ok(!("fact_id" in preimage), "fact_id cannot be inside its own preimage");
  assert.ok(!("content_digest" in preimage), "content_digest cannot be inside its own preimage");
  // No request_id: the digest names the FACT, so the same sky produces the same
  // handle in every reading that contains it.
  assert.ok(!("request_id" in preimage));

  const sealed = await sealDailySkyFact(core as DailySkyFactCore);
  assert.equal(sealed.fact_id, fact_id);
  assert.equal(sealed.content_digest, content_digest);
});

test("fact_id is exactly the first 32 hex characters of content_digest", () => {
  const response = readFixture("valid/daily-sky-response.exact-events.json");
  for (const fact of response.facts as DailySkyFact[]) {
    const hex = fact.content_digest.split(":")[1]!;
    assert.equal(fact.fact_id, `dsf_${hex.slice(0, 32)}`);
  }
});

test("moving an event to the next local day changes its identity", () => {
  const stays = vector("sign-ingress-mercury-virgo");
  const moves = vector("sign-ingress-mercury-virgo-at-day-end");
  assert.notEqual(stays.full_digest, moves.full_digest);
  assert.notEqual(stays.rendered_id, moves.rendered_id);
});

test("renderDailySkyFactId refuses anything that is not a full SHA-256 digest", () => {
  assert.throws(() => renderDailySkyFactId("abc"), DailySkyIdentityError);
  assert.throws(() => renderDailySkyFactId("A".repeat(64)), DailySkyIdentityError);
  assert.equal(renderDailySkyFactId("a".repeat(64)), `dsf_${"a".repeat(32)}`);
});

// ---------------------------------------------------------------------------
// Ordering and derived vocabulary
// ---------------------------------------------------------------------------

test("facts sort by kind rank, then instant, then id", () => {
  const response = readFixture("valid/daily-sky-response.exact-events.json");
  const facts = response.facts as DailySkyFact[];
  assert.deepEqual(orderDailySkyFacts(facts), facts, "the fixture is already in contract order");

  const shuffled = [...facts].reverse();
  assert.deepEqual(
    orderDailySkyFacts(shuffled).map((f) => f.fact_id),
    facts.map((f) => f.fact_id),
    "ordering is total, so any permutation lands back on the same sequence",
  );
});

test("lunar phase bins are 45 degrees wide and centred on their names", () => {
  assert.equal(lunarPhaseOf(0), "new_moon");
  assert.equal(lunarPhaseOf(22.4), "new_moon");
  assert.equal(lunarPhaseOf(22.6), "waxing_crescent");
  assert.equal(lunarPhaseOf(90), "first_quarter");
  assert.equal(lunarPhaseOf(180), "full_moon");
  assert.equal(lunarPhaseOf(270), "last_quarter");
  assert.equal(lunarPhaseOf(337.6), "new_moon", "the last bin wraps rather than becoming a ninth");
  assert.equal(lunarPhaseOf(359.9), "new_moon");
  assert.equal(lunarPhaseOf(-1), "new_moon", "a negative elongation normalizes first");
});

test("zodiacSignOf partitions the circle into twelve", () => {
  assert.equal(zodiacSignOf(0), "aries");
  assert.equal(zodiacSignOf(29.999), "aries");
  assert.equal(zodiacSignOf(30), "taurus");
  assert.equal(zodiacSignOf(127.423118), "leo");
  assert.equal(zodiacSignOf(359.999), "pisces");
  assert.equal(zodiacSignOf(-1), "pisces");
});

// ---------------------------------------------------------------------------
// Privacy and internal consistency of the request
// ---------------------------------------------------------------------------

test("a serialized request carries no account or birth identity", () => {
  const encoded = JSON.stringify(readFixture("valid/daily-sky-request.exact.json"));
  for (const token of [
    "user_id",
    "usr_",
    "cs_",
    "chart_id",
    "chart_fingerprint",
    "reading_id",
    "reading_key",
    "birth_date",
    "birth_time",
    "birth_instant",
    "birthplace",
    "latitude",
    "timezone",
  ]) {
    assert.ok(!encoded.includes(token), `daily-sky request must not contain ${token}`);
  }
});

test("effective_accuracy and the suppression set each have exactly one copy of the truth", () => {
  const request = readFixture("valid/daily-sky-request.exact.json") as DailySkyRequest;
  assert.equal(request.effective_accuracy, request.uncertainty.accuracy);
  assert.deepEqual(
    [...request.suppressed_features].sort(),
    [...new Set(request.uncertainty.suppressed_features.map((s) => s.feature_class))].sort(),
  );
});

test("the request identity pins the tz database and the resolution policy", () => {
  const request = readFixture("valid/daily-sky-request.exact.json") as DailySkyRequest;
  // A tzdb update can move a local day. Recording the version is what turns
  // that from a silent change of inputs into a visible one.
  assert.match(request.tzdb_version, /^\d{4}[a-z]$/);
  assert.equal(request.local_day_resolution_policy_version, "1.0.0");
});

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

test("only calculation_failed is worth another delivery", () => {
  assert.equal(classifyV5CalculationFailure("cycles", "calculation_failed"), "calc_unavailable");
  assert.equal(
    classifyV5CalculationFailure("daily_sky", "calculation_failed"),
    "daily_sky_unavailable",
  );
  for (const deterministic of [
    "invalid_request",
    "unsupported_body",
    "ephemeris_range",
    "cycle_window_incomplete",
  ] as const) {
    // A retry replays the exact frozen request, so a deterministic refusal
    // reproduces byte for byte. Treating it as retryable would spend the whole
    // job budget re-asking a question that already has its final answer.
    assert.equal(
      classifyV5CalculationFailure("cycles", deterministic),
      "policy_unsupported",
      deterministic,
    );
    assert.equal(
      classifyV5CalculationFailure("daily_sky", deterministic),
      "policy_unsupported",
      deterministic,
    );
  }
});
