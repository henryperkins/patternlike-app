import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sweph from "sweph";

import {
  jcsCanonicalize,
  type CycleResponse,
  type CycleResponseSuccess,
  type NormalizedCycle,
} from "@patternlike/shared";
import {
  LiftChain,
  handleCycleScan,
  jdFromUnixMs,
  jdToIso,
  orientedTargets,
  sampleBody,
  scanTargetBranch,
  swissEphemerisSource,
  wrap180,
  type EphemerisSource,
  type ScanOptions,
} from "./cycles.js";
import {
  BODY_SCAN_POLICY,
  MAX_WINDOW_DAYS,
  TRANSITING_BODIES,
  UNWRAPPING_EPOCH_JD,
  transitOrbDeg,
  type TransitingBody,
} from "./cycle-policy.js";
import { initSwissEphemeris } from "./engine.js";
import { resolveEphePath } from "./ephe-path.js";

initSwissEphemeris(resolveEphePath());
const C = sweph.constants;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FINGERPRINT = "sha256:" + "1a".repeat(32);

interface RequestOverrides {
  natal_positions?: Array<{ body: string; longitude_deg: number }>;
  natal_accuracy?: string;
  suppressed_features?: string[];
  window?: { from: string; to: string };
  [key: string]: unknown;
}

function req(overrides: RequestOverrides = {}): Record<string, unknown> {
  return {
    schema_version: "0.3.0",
    request_id: "req_01JAMPLECYCLEREQ0001",
    chart_fingerprint: FINGERPRINT,
    natal_positions: [
      { body: "sun", longitude_deg: 127.483921 },
      { body: "moon", longitude_deg: 12.004311 },
      { body: "saturn", longitude_deg: 301.774002 },
    ],
    natal_accuracy: "exact",
    suppressed_features: [],
    window: { from: "2026-07-30T07:00:00Z", to: "2026-07-31T07:00:00Z" },
    techniques: ["transits"],
    cycle_policy_id: "transit-scan-launch",
    cycle_policy_version: "1.4.0",
    orb_policy_id: "orb-launch",
    orb_policy_version: "1.0.0",
    contract_id: "patternlike.chart.launch",
    contract_version: "0.2.0",
    ...overrides,
  };
}

function succeed(body: Record<string, unknown>, options: ScanOptions = {}): CycleResponseSuccess {
  const res = handleCycleScan(body, options);
  assert.equal(res.ok, true, `expected success, got ${JSON.stringify(res)}`);
  return res as CycleResponseSuccess;
}

function fail(body: Record<string, unknown>, options: ScanOptions = {}): CycleResponse {
  const res = handleCycleScan(body, options);
  assert.equal(res.ok, false, `expected failure, got ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

/**
 * An analytic ephemeris.
 *
 * `lon(t)` is a lifted longitude in degrees from the unwrapping epoch, and the
 * source normalizes it — so a test can describe a trajectory that sweeps past
 * 0°/360° or turns around on a target, and check that the scanner recovers the
 * continuous curve it was built from. Neither of those is reachable by waiting
 * for the real sky to produce one on cue.
 */
function analytic(lifted: (t: number) => number, speed: (t: number) => number): EphemerisSource {
  return {
    stateAt(_body, jd) {
      const t = jd - UNWRAPPING_EPOCH_JD;
      const raw = lifted(t) % 360;
      return { lon: raw < 0 ? raw + 360 : raw, speed: speed(t) };
    },
  };
}

const isoAtEpochOffset = (days: number): string =>
  jdToIso(UNWRAPPING_EPOCH_JD + days);

/** Every UTF-16 surrogate must be half of a pair. */
function assertNoLoneSurrogate(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, `lone high surrogate at ${i}`);
      i++;
    } else {
      assert.ok(!(code >= 0xdc00 && code <= 0xdfff), `lone low surrogate at ${i}`);
    }
  }
}

// ---------------------------------------------------------------------------

describe("time conversion", () => {
  it("agrees with swe_julday to the last bit", () => {
    const cases: Array<[number, number, number, number, number, number]> = [
      [2026, 8, 2, 14, 11, 7],
      [1800, 1, 1, 0, 0, 0],
      [2399, 12, 31, 23, 59, 59],
      [1990, 5, 15, 19, 34, 0],
      [2000, 1, 1, 12, 0, 0],
    ];
    for (const [y, mo, d, h, mi, s] of cases) {
      const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;
      const linear = jdFromUnixMs(Date.parse(iso));
      const swiss = sweph.julday(y, mo, d, h + mi / 60 + s / 3600, C.SE_GREG_CAL);
      assert.ok(
        Math.abs(linear - swiss) < 1e-9,
        `${iso}: linear ${linear} vs swe_julday ${swiss}`,
      );
      assert.equal(jdToIso(linear), iso, `${iso} did not round-trip`);
    }
  });

  it("emits one normalized timestamp form, because the policy sorts raw strings", () => {
    for (const jd of [2451545.0, 2461255.09105324, 2378496.5]) {
      assert.match(jdToIso(jd), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });
});

describe("oriented targets", () => {
  it("collapses conjunction and opposition to one branch and splits the rest", () => {
    assert.deepEqual(orientedTargets(127.5, 0), [{ branch: "single", target_deg: 127.5 }]);
    // N + 180 and N - 180 are the same longitude; without the dedupe one
    // opposition is emitted twice.
    assert.deepEqual(orientedTargets(127.5, 180), [{ branch: "single", target_deg: 307.5 }]);

    const square = orientedTargets(127.5, 90);
    assert.equal(square.length, 2);
    assert.deepEqual(square.map((t) => t.branch), ["plus", "minus"]);
    assert.deepEqual(square.map((t) => t.target_deg), [217.5, 37.5]);
  });

  it("wraps both branches into [0, 360)", () => {
    const sextile = orientedTargets(350, 60);
    assert.deepEqual(sextile.map((t) => t.target_deg), [50, 290]);
    for (const { target_deg } of sextile) {
      assert.ok(target_deg >= 0 && target_deg < 360);
    }
  });

  it("wrap180 lands in [-180, 180)", () => {
    assert.equal(wrap180(0), 0);
    assert.equal(wrap180(360), 0);
    assert.equal(wrap180(-360), 0);
    assert.equal(wrap180(190), -170);
    assert.equal(wrap180(-190), 170);
    assert.equal(wrap180(180), -180);
  });
});

describe("epoch-anchored unwrapping", () => {
  const halfStep = () => 2;

  it("stays continuous through 0°/360° going forward", () => {
    // 1°/day starting at 350°, so the trajectory crosses 360 at t = 10.
    const source = analytic((t) => 350 + t, () => 1);
    const chain = new LiftChain(source, halfStep);
    let previous = chain.liftedLongitude("saturn", UNWRAPPING_EPOCH_JD, 350);
    for (let t = 0.5; t <= 40; t += 0.5) {
      const jd = UNWRAPPING_EPOCH_JD + t;
      const lift = chain.liftedLongitude("saturn", jd, source.stateAt("saturn", jd).lon);
      assert.ok(
        Math.abs(lift - previous - 0.5) < 1e-9,
        `discontinuity at t=${t}: ${previous} -> ${lift}`,
      );
      assert.ok(Math.abs(lift - (350 + t)) < 1e-9, `lift drifted at t=${t}: ${lift}`);
      previous = lift;
    }
  });

  it("stays continuous through 360°/0° going backward", () => {
    const source = analytic((t) => 10 - t, () => -1);
    const chain = new LiftChain(source, halfStep);
    for (let t = 0; t <= 40; t += 0.5) {
      const jd = UNWRAPPING_EPOCH_JD + t;
      const lift = chain.liftedLongitude("saturn", jd, source.stateAt("saturn", jd).lon);
      // Lifted longitude goes negative rather than jumping to 350.
      assert.ok(Math.abs(lift - (10 - t)) < 1e-9, `lift drifted at t=${t}: ${lift}`);
    }
    assert.ok(chain.liftedLongitude("saturn", UNWRAPPING_EPOCH_JD + 40, 330) < 0);
  });

  it("walks backward from the epoch as well as forward", () => {
    const source = analytic((t) => 350 + t, () => 1);
    const chain = new LiftChain(source, halfStep);
    const lift = chain.liftedLongitude(
      "saturn",
      UNWRAPPING_EPOCH_JD - 40,
      source.stateAt("saturn", UNWRAPPING_EPOCH_JD - 40).lon,
    );
    assert.ok(Math.abs(lift - 310) < 1e-9, `expected 310, got ${lift}`);
  });

  it("is a cache, not a source of identity: halving the step changes nothing", () => {
    // The design permits a checkpoint chain only on the condition that its
    // values match epoch recomputation. Halving the step is the cheapest
    // falsification of that claim available.
    const jd = jdFromUnixMs(Date.parse("2026-07-30T19:00:00Z"));
    for (const body of TRANSITING_BODIES) {
      const lon = swissEphemerisSource.stateAt(body, jd).lon;
      const coarse = new LiftChain(swissEphemerisSource).liftedLongitude(body, jd, lon);
      const fine = new LiftChain(swissEphemerisSource, (b) =>
        BODY_SCAN_POLICY[b].lift_step_days / 2,
      ).liftedLongitude(body, jd, lon);
      assert.ok(
        Math.abs(coarse - fine) < 1e-6,
        `${body}: coarse ${coarse} vs fine ${fine}`,
      );
      assert.equal(
        Math.round((coarse - lon) / 360),
        Math.round((fine - lon) / 360),
        `${body}: winding changed with the checkpoint step`,
      );
    }
  });
});

describe("root finding", () => {
  it("records a root the grid lands on exactly, once", () => {
    // 1°/day from 0° at the epoch, and saturn's grid is 1 day anchored at the
    // epoch — so longitude 100 is hit at a grid sample, not between two.
    const source = analytic((t) => t, () => 1);
    const chain = new LiftChain(source, () => 20);
    const samples = sampleBody(source, chain, "saturn", UNWRAPPING_EPOCH_JD + 90, UNWRAPPING_EPOCH_JD + 110);
    const roots = scanTargetBranch(source, "saturn", samples, 100, 4);
    const exact = roots.get(0)?.exact ?? [];
    assert.equal(exact.length, 1, "a grid-point root must not be recorded twice");
    assert.ok(Math.abs(exact[0]!.jd - (UNWRAPPING_EPOCH_JD + 100)) < 1 / 86400);
  });

  it("emits a station-on-target tangent once, with the outgoing direction", () => {
    // A retrograde-to-direct station whose vertex sits exactly on the target.
    // fT touches zero without changing sign, so nothing brackets it; only the
    // refined station does.
    const t0 = 50.5;
    const a = 0.002;
    const source = analytic((t) => 100 + a * (t - t0) ** 2, (t) => 2 * a * (t - t0));
    const res = succeed(
      req({
        natal_positions: [{ body: "sun", longitude_deg: 100 }],
        window: { from: isoAtEpochOffset(50), to: isoAtEpochOffset(51) },
      }),
      {
        source,
        bodies: ["saturn"],
        liftStepDaysOverride: () => 20,
        lookaroundDaysOverride: () => 100,
        maxRetrogradeArcOverride: () => 2,
      },
    );

    const conjunctions = res.cycles.filter((c) => c.aspect === "conjunction");
    assert.equal(conjunctions.length, 1, JSON.stringify(res.cycles.map((c) => c.aspect)));
    const cycle = conjunctions[0]!;
    assert.equal(cycle.pass_count, 1, "a tangent is one pass, not an arbitrary near-zero minimum");
    assert.equal(cycle.passes[0]!.direction, "direct", "retrograde→direct leaves direct");
    assert.equal(
      cycle.passes[0]!.speed_deg_per_day,
      0,
      "zero speed is reserved for exactly this case",
    );
    assert.equal(cycle.passes[0]!.exact_at, isoAtEpochOffset(t0));
  });

  it("refines every root to the declared ±1 s", () => {
    const source = analytic((t) => t * 0.37, () => 0.37);
    const chain = new LiftChain(source, () => 100);
    const samples = sampleBody(source, chain, "saturn", UNWRAPPING_EPOCH_JD, UNWRAPPING_EPOCH_JD + 200);
    const roots = scanTargetBranch(source, "saturn", samples, 40, 3);
    for (const [k, levels] of roots) {
      for (const [kind, offset] of [["exact", 0], ["lower", -3], ["upper", 3]] as const) {
        for (const root of levels[kind]) {
          const expected = (40 + offset + 360 * k) / 0.37;
          assert.ok(
            Math.abs(root.jd - UNWRAPPING_EPOCH_JD - expected) <= 1 / 86400,
            `${kind} root off by ${(root.jd - UNWRAPPING_EPOCH_JD - expected) * 86400}s`,
          );
        }
      }
    }
  });
});

describe("the canonical three-pass encounter", () => {
  // f(t) = k·t·(t² − 100²) has roots at −100, 0 and +100 days, local extrema of
  // ±6° at ±57.7 days, and derivative signs that give direct / retrograde /
  // direct. With a 4° orb the body leaves orb twice in the middle and comes
  // back, which is the case the envelope rule exists for.
  const K = 6 / (57.735 * (57.735 ** 2 - 10000));
  const f = (t: number): number => -K * t * (t * t - 10000);
  const fPrime = (t: number): number => -K * (3 * t * t - 10000);
  const NATAL = 200;
  const source = analytic((t) => NATAL + f(t), fPrime);
  // The excursion inside the encounter peaks at 6°, so a 4° orb plus a 4° arc
  // is a sound return bound for this trajectory: |f| > 8 is only reachable
  // outside it, at about ±120 days.
  const options: ScanOptions = {
    source,
    bodies: ["saturn"],
    liftStepDaysOverride: () => 10,
    lookaroundDaysOverride: () => 150,
    maxRetrogradeArcOverride: () => 4,
  };

  /** Where the trajectory is `value` degrees from the target, searching in [lo, hi]. */
  const solve = (value: number, lo: number, hi: number): number => {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 200; i++) {
      const mid = (a + b) / 2;
      if (Math.sign(f(mid) - value) === Math.sign(f(a) - value)) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  const body = req({
    natal_positions: [{ body: "sun", longitude_deg: NATAL }],
    window: { from: isoAtEpochOffset(0), to: isoAtEpochOffset(1) },
  });

  it("is one cycle with three chronological passes, not three cycles", () => {
    const res = succeed(body, options);
    assert.equal(res.cycles.length, 1, JSON.stringify(res.cycles, null, 1));
    const cycle = res.cycles[0]!;
    assert.equal(cycle.pass_count, 3);
    assert.equal(cycle.passes.length, 3);
    assert.deepEqual(cycle.passes.map((p) => p.pass_index), [1, 2, 3]);
    assert.deepEqual(
      cycle.passes.map((p) => p.direction),
      ["direct", "retrograde", "direct"],
    );
    assert.deepEqual(
      cycle.passes.map((p) => p.exact_at),
      [isoAtEpochOffset(-100), isoAtEpochOffset(0), isoAtEpochOffset(100)],
    );
    assert.equal(cycle.exact_at, cycle.passes[0]!.exact_at);
  });

  it("keeps intervening orb exits and re-entries inside the same cycle", () => {
    const res = succeed(body, options);
    const cycle = res.cycles[0]!;
    // The trajectory really does leave orb between passes: at ±57.7 days it is
    // 6° from the target and the orb is 4°.
    assert.equal(cycle.orb_deg, 4);
    assert.ok(Math.abs(f(-57.735)) > cycle.orb_deg);
    assert.ok(Math.abs(f(57.735)) > cycle.orb_deg);

    // The envelope is nevertheless the earliest entry to the latest exit, and
    // every pass sits inside it.
    assert.ok(cycle.start_at < cycle.passes[0]!.exact_at);
    assert.ok(cycle.end_at > cycle.passes[2]!.exact_at);
    for (const pass of cycle.passes) {
      assert.ok(cycle.start_at <= pass.exact_at && pass.exact_at <= cycle.end_at);
    }
    // Solved from fT = ±O, not read off a sample: the entry root is a fractional
    // day, nowhere near the 1-day grid the samples sit on.
    const entryDay = solve(-cycle.orb_deg, -150, -100);
    const exitDay = solve(cycle.orb_deg, 100, 150);
    assert.ok(Math.abs(entryDay % 1) > 0.01, "the entry landed on a grid point by coincidence");
    const startOffsetDays =
      (Date.parse(cycle.start_at) - Date.parse(isoAtEpochOffset(0))) / 86_400_000;
    const endOffsetDays =
      (Date.parse(cycle.end_at) - Date.parse(isoAtEpochOffset(0))) / 86_400_000;
    assert.ok(
      Math.abs(startOffsetDays - entryDay) < 2 / 86400,
      `start ${startOffsetDays} vs analytic ${entryDay}`,
    );
    assert.ok(
      Math.abs(endOffsetDays - exitDay) < 2 / 86400,
      `end ${endOffsetDays} vs analytic ${exitDay}`,
    );
  });

  it("fails the whole request rather than emit a partial cycle", () => {
    // 50 days of lookaround cannot reach |fT| > O + arc, so the encounter is
    // never proven over. A scanner that trusted "outside orb at the span edge"
    // would happily return a confident one-pass cycle here.
    const res = fail(body, { ...options, lookaroundDaysOverride: () => 50 });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error_class, "cycle_window_incomplete");
    assert.ok(!("cycles" in res), "a failure body must not carry a partial cycle set");
  });

  it("returns the identical cycle from two windows that both select it", () => {
    // All three windows sit inside the encounter and all three can reach the
    // return bound at ±120 days, so all three see the whole thing. Sliding
    // further would legitimately run out of lookaround — which is the next
    // test, not a failure of this one.
    const shifted = [
      { from: isoAtEpochOffset(0), to: isoAtEpochOffset(1) },
      { from: isoAtEpochOffset(-10), to: isoAtEpochOffset(-9) },
      { from: isoAtEpochOffset(10), to: isoAtEpochOffset(13) },
    ];
    const results = shifted.map((window) => succeed(req({
      natal_positions: [{ body: "sun", longitude_deg: NATAL }],
      window,
    }), options));
    for (const res of results) assert.equal(res.cycles.length, 1);
    const [first, ...rest] = results.map((r) => r.cycles[0]!);
    for (const cycle of rest) {
      assert.equal(cycle.id, first!.id, "the id must name the encounter, not the scan");
      assert.deepEqual(cycle, first);
    }
  });
});

describe("scanning the real sky", () => {
  it("agrees one-for-one with the Sun and Moon crossing oracle", () => {
    // solcross_ut / mooncross_ut independently find the next crossing of a
    // requested longitude. They are used HERE ONLY: they never seed a bracket,
    // never reach production output, and are never copied into a fixture.
    const from = jdFromUnixMs(Date.parse("2026-07-01T00:00:00Z"));
    const to = jdFromUnixMs(Date.parse("2026-09-01T00:00:00Z"));

    const oracle = (fn: "solcross_ut" | "mooncross_ut", level: number, lo: number, hi: number): number[] => {
      const out: number[] = [];
      let cursor = lo;
      for (let guard = 0; guard < 500; guard++) {
        const r = (sweph as unknown as Record<string, (a: number, b: number, c: number) => { date: number }>)[fn]!(
          ((level % 360) + 360) % 360,
          cursor,
          C.SEFLG_SWIEPH,
        );
        if (!r || typeof r.date !== "number" || r.date < cursor || r.date > hi) break;
        out.push(r.date);
        cursor = r.date + 0.01;
      }
      return out;
    };

    for (const [body, fn] of [["sun", "solcross_ut"], ["moon", "mooncross_ut"]] as const) {
      const samples = sampleBody(swissEphemerisSource, new LiftChain(swissEphemerisSource), body, from, to);
      const spanLo = samples[0]!.jd;
      const spanHi = samples[samples.length - 1]!.jd;
      let matched = 0;
      for (const targetDeg of [12.004311, 127.483921, 301.774002, 0, 359.9, 180]) {
        const orb = 3;
        const byWinding = scanTargetBranch(swissEphemerisSource, body, samples, targetDeg, orb);
        for (const [kind, level] of [
          ["exact", targetDeg],
          ["lower", targetDeg - orb],
          ["upper", targetDeg + orb],
        ] as const) {
          const mine: number[] = [];
          for (const levels of byWinding.values()) for (const r of levels[kind]) mine.push(r.jd);
          const expected = oracle(fn, level, from, to).filter((d) => d >= spanLo && d <= spanHi);

          for (const o of expected) {
            const best = mine.reduce((acc, m) => Math.min(acc, Math.abs(m - o)), Infinity);
            assert.ok(
              best <= 1 / 86400,
              `${body} ${kind} ${level}: oracle ${jdToIso(o)} unmatched (best ${best * 86400}s)`,
            );
            matched++;
          }
          for (const m of mine) {
            const best = expected.reduce((acc, o) => Math.min(acc, Math.abs(m - o)), Infinity);
            assert.ok(best <= 1 / 86400, `${body} ${kind} ${level}: spurious root at ${jdToIso(m)}`);
          }
        }
      }
      assert.ok(matched > 0, `${body}: the oracle produced nothing to compare against`);
    }
  });

  it("produces a response that satisfies every semantic rule the validator enforces", () => {
    const res = succeed(req());
    assertResponsePolicy(res);
    assert.ok(res.cycles.length > 0, "the reference window should contain cycles");
  });

  it("holds up on a worst-case request: every natal body, every angle, a month", () => {
    // 13 natal positions against 11 transiting bodies over 30 days is the
    // widest shape the contract allows, and it is where an ordering or
    // uniqueness bug would first show.
    const res = succeed(
      req({
        natal_positions: [
          { body: "sun", longitude_deg: 0.5 },
          { body: "moon", longitude_deg: 359.5 },
          { body: "mercury", longitude_deg: 90 },
          { body: "venus", longitude_deg: 180 },
          { body: "mars", longitude_deg: 270 },
          { body: "jupiter", longitude_deg: 45 },
          { body: "saturn", longitude_deg: 135 },
          { body: "uranus", longitude_deg: 225 },
          { body: "neptune", longitude_deg: 315 },
          { body: "pluto", longitude_deg: 60 },
          { body: "true_node", longitude_deg: 200 },
          { body: "ascendant", longitude_deg: 12.3 },
          { body: "midheaven", longitude_deg: 280.1 },
        ],
        window: { from: "2027-03-01T00:00:00Z", to: "2027-03-31T00:00:00Z" },
      }),
    );
    assertResponsePolicy(res);
    assert.ok(res.cycles.length > 50, `expected a busy month, got ${res.cycles.length}`);
    // Natal longitudes at 0.5 and 359.5 sit either side of the wrap, which is
    // where an unwrapping bug produces a target on the wrong branch.
    assert.ok(res.cycles.some((c) => c.target === "sun"));
    assert.ok(res.cycles.some((c) => c.target === "moon"));
    // Angles are legitimate targets under exact accuracy, and never bodies.
    assert.ok(res.cycles.some((c) => c.target === "ascendant" || c.target === "midheaven"));
    for (const cycle of res.cycles) {
      assert.notEqual(cycle.body, "ascendant", "an angle has no ephemeris and cannot transit");
      assert.notEqual(cycle.body, "midheaven");
    }
  });

  it("echoes every identifier the caller sent", () => {
    const res = succeed(req());
    assert.equal(res.request_id, "req_01JAMPLECYCLEREQ0001");
    assert.equal(res.chart_fingerprint, FINGERPRINT);
    assert.equal(res.cycle_policy_id, "transit-scan-launch");
    assert.equal(res.cycle_policy_version, "1.4.0");
    assert.equal(res.orb_policy_id, "orb-launch");
    assert.equal(res.orb_policy_version, "1.0.0");
    assert.equal(res.contract_id, "patternlike.chart.launch");
    assert.equal(res.contract_version, "0.2.0");
    assert.equal(res.ephemeris_data_version, "se-2.10.03-1800-2399");
    assert.match(res.container_digest, /^sha256:[a-f0-9]{64}$/);
  });

  it("is byte-identical across two runs of the same request", () => {
    assert.equal(JSON.stringify(succeed(req())), JSON.stringify(succeed(req())));
  });

  it("returns the same encounter from two overlapping windows", () => {
    const a = succeed(req({ window: { from: "2026-07-30T07:00:00Z", to: "2026-07-31T07:00:00Z" } }));
    const b = succeed(req({ window: { from: "2026-07-30T19:00:00Z", to: "2026-07-31T19:00:00Z" } }));
    const byId = new Map(b.cycles.map((c) => [c.id, c]));
    let shared = 0;
    for (const cycle of a.cycles) {
      const other = byId.get(cycle.id);
      if (!other) continue;
      shared++;
      assert.deepEqual(other, cycle, `cycle ${cycle.id} differs between windows`);
    }
    assert.ok(shared >= 5, `expected overlapping windows to share cycles, shared ${shared}`);
  });

  it("treats the window as a selection interval, never as a clip", () => {
    const res = succeed(req());
    const from = "2026-07-30T07:00:00Z";
    const to = "2026-07-31T07:00:00Z";
    let extendsOutside = 0;
    for (const cycle of res.cycles) {
      // Every returned envelope must intersect the window...
      assert.ok(cycle.end_at >= from, `${cycle.id} ends before the window`);
      assert.ok(cycle.start_at < to, `${cycle.id} starts after the window`);
      // ...but is free to begin before it and end after it.
      if (cycle.start_at < from || cycle.end_at > to) extendsOutside++;
    }
    assert.ok(extendsOutside > 0, "no envelope reached outside the window; that cannot be right");
  });
});

describe("suppression at the source", () => {
  it("refuses an angle target under unknown effective accuracy", () => {
    const res = fail(
      req({
        natal_accuracy: "unknown",
        natal_positions: [
          { body: "sun", longitude_deg: 127.483921 },
          { body: "ascendant", longitude_deg: 10 },
        ],
      }),
    );
    if (res.ok) return;
    assert.equal(res.error_class, "invalid_request");
    assert.match(res.error_message, /ascendant/);
  });

  it("refuses an angle target when angles are explicitly suppressed", () => {
    for (const feature of ["angles", "angle_transits"]) {
      const res = fail(
        req({
          suppressed_features: [feature],
          natal_positions: [
            { body: "sun", longitude_deg: 127.483921 },
            { body: "midheaven", longitude_deg: 10 },
          ],
        }),
      );
      if (res.ok) continue;
      assert.equal(res.error_class, "invalid_request");
    }
  });

  it("omits the natal Moon while keeping the transiting Moon", () => {
    // The natal longitude is set to where the transiting Moon actually is
    // mid-window, so "the transiting Moon still contacts a stable natal target"
    // is a fact about this scan rather than a hope about the sky.
    const midWindow = jdFromUnixMs(Date.parse("2026-07-30T19:00:00Z"));
    const moonNow = swissEphemerisSource.stateAt("moon", midWindow).lon;

    const res = succeed(
      req({
        natal_accuracy: "unknown",
        suppressed_features: ["houses", "angles", "angle_transits", "moon_time_sensitive"],
        natal_positions: [
          { body: "sun", longitude_deg: moonNow },
          { body: "moon", longitude_deg: 12.004311 },
        ],
      }),
    );

    assert.equal(
      res.cycles.filter((c) => c.target === "moon").length,
      0,
      "a natal Moon target must not be created and filtered — it must never be created",
    );
    for (const cycle of res.cycles) {
      assert.notEqual(cycle.target, "ascendant");
      assert.notEqual(cycle.target, "midheaven");
    }
    const transitingMoon = res.cycles.filter((c) => c.body === "moon" && c.target === "sun");
    assert.ok(
      transitingMoon.some((c) => c.aspect === "conjunction"),
      "the transiting Moon stays valid: its instant is known even when the birth instant is not",
    );
  });
});

describe("request validation", () => {
  const cases: Array<[string, RequestOverrides | Record<string, unknown>]> = [
    ["an undeclared property", { birth_time_local: "07:42" }],
    ["a second technique", { techniques: ["transits", "lunations_eclipses"] }],
    ["an unimplemented technique", { techniques: ["stations_ingresses"] }],
    ["a stale schema version", { schema_version: "0.2.0" }],
    ["an unknown cycle policy", { cycle_policy_version: "9.9.9" }],
    ["an unknown orb policy", { orb_policy_id: "orb-something-else" }],
    ["a non-semver contract version", { contract_version: "v2" }],
    ["a malformed fingerprint", { chart_fingerprint: "not-a-hash" }],
    ["a too-short request id", { request_id: "short" }],
    ["an empty natal position list", { natal_positions: [] }],
    ["a longitude outside [0, 360)", { natal_positions: [{ body: "sun", longitude_deg: 360 }] }],
    ["an unknown body", { natal_positions: [{ body: "chiron", longitude_deg: 10 }] }],
    [
      "a duplicated body",
      {
        natal_positions: [
          { body: "sun", longitude_deg: 10 },
          { body: "sun", longitude_deg: 20 },
        ],
      },
    ],
    ["an inverted window", { window: { from: "2026-07-31T07:00:00Z", to: "2026-07-30T07:00:00Z" } }],
    ["a zero-length window", { window: { from: "2026-07-30T07:00:00Z", to: "2026-07-30T07:00:00Z" } }],
    ["an undeclared window property", { window: { from: "2026-07-30T07:00:00Z", to: "2026-07-31T07:00:00Z", step: "1h" } }],
    ["a repeated suppressed feature", { suppressed_features: ["houses", "houses"] }],
    ["an undeclared suppressed feature", { suppressed_features: ["everything"] }],
  ];

  for (const [what, overrides] of cases) {
    it(`rejects ${what}`, () => {
      const res = fail(req(overrides as RequestOverrides));
      if (res.ok) return;
      assert.equal(res.error_class, "invalid_request", res.error_message);
      assert.ok(res.error_message.length > 0 && res.error_message.length <= 300);
    });
  }

  it("requires a designated offset on both window instants", () => {
    // Date.parse resolves an offset-less instant in the HOST timezone, which
    // would make the same request return different cycles depending on which
    // machine answered it. The schema's format: date-time does not permit it
    // either, so accepting it would also make this service laxer than its own
    // contract.
    const rejected = [
      "2026-07-30T07:00:00",
      "2026-07-30",
      "Aug 9, 2026",
      "1.4.0",
      "2026-07-30 07:00:00Z",
      "2026-02-30T07:00:00Z",
      "",
    ];
    for (const from of rejected) {
      const res = fail(req({ window: { from, to: "2026-07-31T07:00:00Z" } }));
      if (res.ok) continue;
      assert.equal(res.error_class, "invalid_request", `${from} was accepted`);
    }
    // Offsets other than Z are legitimate RFC 3339 and must still work.
    const offset = succeed(
      req({ window: { from: "2026-07-30T09:00:00+02:00", to: "2026-07-31T09:00:00+02:00" } }),
    );
    const zulu = succeed(
      req({ window: { from: "2026-07-30T07:00:00Z", to: "2026-07-31T07:00:00Z" } }),
    );
    assert.deepEqual(offset.cycles, zulu.cycles, "+02:00 must name the same instant as Z");
  });

  it("refuses a window wider than the policy scans", () => {
    // The scan is synchronous inside a single-threaded server, so an unbounded
    // window is one request that takes the machine out of rotation.
    const res = fail(
      req({ window: { from: "2026-01-01T00:00:00Z", to: "2036-01-01T00:00:00Z" } }),
    );
    if (res.ok) return;
    assert.equal(res.error_class, "invalid_request");
    assert.match(res.error_message, new RegExp(`${MAX_WINDOW_DAYS}-day maximum`));
    // The cap itself must still be answered.
    const to = jdToIso(jdFromUnixMs(Date.parse("2026-01-01T00:00:00Z")) + MAX_WINDOW_DAYS);
    succeed(req({ window: { from: "2026-01-01T00:00:00Z", to } }));
  });

  it("bounds a caller-supplied name and never splits a surrogate pair", () => {
    // Object keys are attacker-controlled and unbounded, and a naive
    // slice(0, 300) can cut between a surrogate pair. A lone surrogate is not
    // cosmetic: jcsCanonicalize rejects one outright rather than replacing it,
    // so a truncated message could make a downstream canonicalization throw.
    const hostile = [
      { ["x".repeat(277) + "\u{1F600}\u{1F600}"]: 1 },
      { ["\u{1F600}".repeat(400)]: 1 },
      { ["a\u{1F600}".repeat(200)]: 1 },
      req({ window: { from: "2026-07-30T07:00:00Z", to: "2026-07-31T07:00:00Z", ["\u{1F600}".repeat(500)]: 1 } }),
      req({ natal_positions: [{ body: "sun", longitude_deg: 1, ["\u{1F4A9}".repeat(300)]: 2 }] }),
    ];
    for (const body of hostile) {
      const res = handleCycleScan(body);
      assert.equal(res.ok, false);
      if (res.ok) continue;
      assert.ok(Array.from(res.error_message).length <= 300, "over the contract's cap");
      assertNoLoneSurrogate(res.error_message);
      // The message stays about the service's complaint, not the caller's text.
      assert.ok(res.error_message.startsWith("undeclared"), res.error_message);
      assert.ok(
        Array.from(res.error_message).length < 80,
        `the caller's text should not dominate the message: ${res.error_message}`,
      );
      // And it survives the canonicalizer, which is where a lone surrogate bites.
      assert.doesNotThrow(() => jcsCanonicalize({ error_message: res.error_message }));
    }
  });

  it("emits a well-formed message for every rejection it can produce", () => {
    for (const [, overrides] of cases) {
      const res = handleCycleScan(req(overrides as RequestOverrides));
      assert.equal(res.ok, false);
      if (res.ok) continue;
      const points = Array.from(res.error_message).length;
      assert.ok(points >= 1 && points <= 300, `${points} code points`);
      assertNoLoneSurrogate(res.error_message);
      assert.doesNotThrow(() => jcsCanonicalize({ error_message: res.error_message }));
    }
  });

  it("rejects a body that is not an object at all", () => {
    for (const body of [null, [], "cycles please", 42]) {
      const res = handleCycleScan(body);
      assert.equal(res.ok, false);
      if (res.ok) continue;
      assert.equal(res.error_class, "invalid_request");
      assert.equal(res.request_id, "req_unknown_0");
    }
  });

  it("echoes a readable request id even when the rest of the body is rejected", () => {
    const res = fail(req({ techniques: [] }));
    if (res.ok) return;
    assert.equal(res.request_id, "req_01JAMPLECYCLEREQ0001");
  });

  it("refuses a scan span that leaves the pinned ephemeris range", () => {
    for (const window of [
      { from: "1801-01-01T00:00:00Z", to: "1801-01-02T00:00:00Z" },
      { from: "2399-06-01T00:00:00Z", to: "2399-06-02T00:00:00Z" },
    ]) {
      const res = fail(req({ window }));
      if (res.ok) continue;
      assert.equal(res.error_class, "ephemeris_range");
    }
  });
});

describe("failure envelopes", () => {
  it("never echoes an upstream message, which has carried filesystem paths", () => {
    const leaky =
      "swe_calc_ut failed: SwissEph file 'sepl_18.se1' not found in PATH '/srv/app/apps/calc-stub/data/ephe/'";
    const source: EphemerisSource = {
      stateAt() {
        throw new Error(leaky);
      },
    };
    const res = fail(req(), { source, bodies: ["saturn"] });
    if (res.ok) return;
    assert.equal(res.error_class, "calculation_failed");
    assert.ok(!res.error_message.includes("sepl_18.se1"));
    assert.ok(!res.error_message.includes("/srv/app"));
    assert.ok(!res.error_message.includes("swe_calc_ut"));
  });

  it("reports an unsupported body without naming the engine internals", () => {
    const source: EphemerisSource = {
      stateAt(body) {
        throw new (class extends Error {
          readonly code = "unsupported_body";
        })(`no Swiss Ephemeris body id for ${body}`);
      },
    };
    // The thrown class is not the module's own, so this exercises the generic
    // path; the named path is covered by the swiss source's own guard.
    const res = fail(req(), { source, bodies: ["saturn"] });
    if (res.ok) return;
    assert.equal(res.error_class, "calculation_failed");
  });
});

// ---------------------------------------------------------------------------
// The validator's semantic rules, ported rather than paraphrased
// ---------------------------------------------------------------------------

/**
 * A TypeScript port of `cycle_response_policy()` in `contracts/validate_schemas.py`,
 * plus the structural constraints the JSON Schema carries.
 *
 * It is a port and not a rewrite on purpose: the Python runs over committed
 * fixtures and this runs over live engine output, and they have to agree about
 * what a valid response is.
 */
const SUCCESS_KEYS = [
  "ok",
  "schema_version",
  "request_id",
  "chart_fingerprint",
  "cycle_policy_id",
  "cycle_policy_version",
  "orb_policy_id",
  "orb_policy_version",
  "contract_id",
  "contract_version",
  "container_digest",
  "ephemeris_data_version",
  "cycles",
].sort();

const CYCLE_KEYS = [
  "id",
  "technique",
  "body",
  "target",
  "aspect",
  "start_at",
  "exact_at",
  "end_at",
  "pass_count",
  "passes",
  "orb_deg",
].sort();

const PASS_KEYS = ["pass_index", "direction", "exact_at", "speed_deg_per_day"].sort();

function assertResponsePolicy(res: CycleResponseSuccess): void {
  // Every one of these objects is additionalProperties:false in the schema, so
  // an extra key is a rejection rather than a tolerated addition. Asserting the
  // exact key set is the cheapest way to notice a field being added here
  // without being added to the contract.
  assert.deepEqual(Object.keys(res).sort(), SUCCESS_KEYS);

  const ids = res.cycles.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate cycle ids in one response");

  const ordered = [...res.cycles].sort((a, b) =>
    a.exact_at !== b.exact_at ? (a.exact_at < b.exact_at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  assert.deepEqual(res.cycles, ordered, "cycles are not ordered by (exact_at, id)");

  for (const cycle of res.cycles) assertCyclePolicy(cycle);
}

function assertCyclePolicy(cycle: NormalizedCycle): void {
  const where = `cycle ${cycle.id}`;
  assert.deepEqual(Object.keys(cycle).sort(), CYCLE_KEYS, where);
  for (const pass of cycle.passes) {
    assert.deepEqual(Object.keys(pass).sort(), PASS_KEYS, where);
  }
  assert.match(cycle.id, /^cyc_[a-f0-9]{32}$/, where);
  assert.equal(cycle.technique, "transit", where);
  assert.ok(cycle.target.length > 0, where);
  assert.ok(cycle.orb_deg >= 0 && cycle.orb_deg <= 12, `${where}: orb_deg ${cycle.orb_deg}`);
  assert.ok(!("importance_score" in cycle), `${where}: ranking is not the calc service's job`);

  assert.equal(cycle.pass_count, cycle.passes.length, `${where}: pass_count`);
  assert.ok(cycle.passes.length >= 1, `${where}: at least one pass`);
  assert.deepEqual(
    cycle.passes.map((p) => p.pass_index),
    cycle.passes.map((_, i) => i + 1),
    `${where}: pass indices contiguous from 1`,
  );

  const times = cycle.passes.map((p) => p.exact_at);
  assert.deepEqual(times, [...times].sort(), `${where}: passes chronological`);
  assert.equal(new Set(times).size, times.length, `${where}: passes strictly chronological`);
  assert.equal(cycle.exact_at, times[0], `${where}: exact_at equals passes[0].exact_at`);

  assert.ok(cycle.start_at <= cycle.end_at, `${where}: start_at after end_at`);
  for (const t of times) {
    assert.ok(cycle.start_at <= t && t <= cycle.end_at, `${where}: pass ${t} outside the envelope`);
  }
  for (const pass of cycle.passes) {
    assert.ok(
      pass.direction === "direct" || pass.direction === "retrograde",
      `${where}: direction ${pass.direction}`,
    );
    assert.equal(typeof pass.speed_deg_per_day, "number", where);
    assert.match(pass.exact_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, where);
  }
}

/**
 * Measured against the pinned 1800-2399 ephemeris, at 0.5-day resolution for the
 * fast bodies and 2-day for the slow ones. These are the numbers the policy has
 * to bound, and they are recorded here rather than remeasured on every run
 * because a full-range sweep takes minutes.
 *
 * An UNDERESTIMATE in `arc` is the dangerous direction: it lets `solveEnvelope`
 * declare an encounter proven-over while the body can still return inside orb,
 * which drops whole cycles and truncates envelopes with no error.
 */
const MEASURED = {
  moon: { arc: 0, lookaround: 2 },
  sun: { arc: 0, lookaround: 13 },
  mercury: { arc: 16.316, lookaround: 77 },
  venus: { arc: 16.53, lookaround: 141 },
  mars: { arc: 19.509, lookaround: 272 },
  jupiter: { arc: 10.07, lookaround: 628 },
  saturn: { arc: 6.974, lookaround: 1020 },
  uranus: { arc: 4.157, lookaround: 1744 },
  neptune: { arc: 2.821, lookaround: 2474 },
  pluto: { arc: 2.828, lookaround: 5066 },
  true_node: { arc: 0.118, lookaround: 157 },
} satisfies Record<TransitingBody, { arc: number; lookaround: number }>;

describe("policy geometry", () => {
  it("keeps every lift step under half a revolution for its body", () => {
    // The checkpoint recurrence is only unambiguous while this holds. Measured
    // against the fastest motion each body actually reaches, not a mean.
    const from = jdFromUnixMs(Date.parse("2020-01-01T00:00:00Z"));
    for (const body of TRANSITING_BODIES) {
      const step = BODY_SCAN_POLICY[body].lift_step_days;
      let worst = 0;
      for (let jd = from; jd < from + 3650; jd += step) {
        const a = swissEphemerisSource.stateAt(body, jd).lon;
        const b = swissEphemerisSource.stateAt(body, jd + step).lon;
        worst = Math.max(worst, Math.abs(wrap180(b - a)));
      }
      assert.ok(worst < 150, `${body}: ${worst.toFixed(1)}° in one ${step}-day lift step`);
    }
  });

  it("bounds every body's real retrograde arc", () => {
    for (const body of TRANSITING_BODIES) {
      const policy = BODY_SCAN_POLICY[body].max_retrograde_arc_deg;
      const measured = MEASURED[body].arc;
      // The Sun and Moon never retrograde, so 0 bounds 0 exactly; every body
      // that does must have strict headroom.
      assert.ok(
        measured === 0 ? policy === 0 : policy > measured,
        `${body}: policy arc ${policy} does not bound the measured ${measured}`,
      );
    }
  });

  it("gives every body enough lookaround to prove a widest-orb encounter", () => {
    // The proof needs |fT| > O + arc on BOTH sides, so the lookaround has to buy
    // 2(O + arc) of lifted travel — not (O + arc). The window can sit at either
    // end of the encounter, so one side may have to cover the whole span.
    for (const body of TRANSITING_BODIES) {
      assert.ok(
        BODY_SCAN_POLICY[body].lookaround_days >= MEASURED[body].lookaround,
        `${body}: lookaround ${BODY_SCAN_POLICY[body].lookaround_days}d < the measured ${MEASURED[body].lookaround}d needed`,
      );
    }
  });

  it("spot-checks the measured arcs against a live decade", () => {
    // Cheap regression guard on the recorded table above: a decade cannot
    // contain every extreme, but it catches an arc that is wrong by a lot.
    const from = jdFromUnixMs(Date.parse("2015-01-01T00:00:00Z"));
    for (const body of TRANSITING_BODIES) {
      const chain = new LiftChain(swissEphemerisSource);
      let peak = -Infinity;
      let arc = 0;
      for (let jd = from; jd < from + 3650; jd += 0.5) {
        const state = swissEphemerisSource.stateAt(body, jd);
        const lifted = chain.liftedLongitude(body, jd, state.lon);
        const signed = body === "true_node" ? -lifted : lifted;
        if (signed > peak) peak = signed;
        else arc = Math.max(arc, peak - signed);
      }
      assert.ok(
        arc <= BODY_SCAN_POLICY[body].max_retrograde_arc_deg,
        `${body}: measured ${arc.toFixed(3)}° over 2015-2025 exceeds the policy bound`,
      );
    }
  });

  it("keeps every transit orb inside the schema's ceiling", () => {
    const aspects = ["conjunction", "sextile", "square", "trine", "opposition"] as const;
    for (const body of TRANSITING_BODIES) {
      for (const aspect of aspects) {
        const orb = transitOrbDeg(body, aspect);
        assert.ok(orb > 0 && orb <= 12, `${body} ${aspect}: orb_deg ${orb}`);
      }
    }
  });
});
