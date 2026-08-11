import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ASPECT_ANGLE_BY_TYPE,
  initSwissEphemeris,
  norm360,
  signOf,
} from "./engine.js";
import { jdFromUnixMs, orientedTargets, swissEphemerisSource, wrap180 } from "./cycles.js";
import type { TransitingBody } from "./cycle-policy.js";
import { handleDailySky } from "./daily-sky.js";
import { assertEphePresent, resolveEphePath } from "./ephe-path.js";
import type { AspectType, DailySkyFact, DailySkyResponseSuccess } from "@patternlike/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.join(here, "fixtures/daily-sky-golden-vectors.json"), "utf8"),
) as {
  days: Array<{
    label: string;
    request: Record<string, unknown>;
    response: DailySkyResponseSuccess;
  }>;
};

const day = (label: string) => {
  const found = vectors.days.find((d) => d.label === label);
  assert.ok(found, `golden day "${label}" is present`);
  return found;
};

const detailOf = <T,>(fact: DailySkyFact) => fact.detail as T;

/**
 * The claimed instant, recomputed from the ephemeris rather than from the
 * root finder.
 *
 * Pinning this module's own output only catches regressions; it cannot catch an
 * error that was there on day one. So every claimed root is re-evaluated
 * directly: at the instant the fact names, the angle it says is exact has to
 * actually be zero. A root finder that converged to the wrong place, an
 * oriented branch that picked the wrong target, or a label that named the wrong
 * aspect all fail this even though they would sail through a byte comparison.
 */
function angleAt(body: TransitingBody, instant: string): number {
  return norm360(swissEphemerisSource.stateAt(body, jdFromUnixMs(Date.parse(instant))).lon);
}

/** One arcsecond, in degrees. The roots are solved to 0.05 s of time. */
const ARCSECOND = 1 / 3600;

describe("daily-sky golden vectors", () => {
  it("loads the pinned ephemeris data files", () => {
    const ephePath = resolveEphePath();
    assertEphePresent(ephePath);
    initSwissEphemeris(ephePath);
  });

  it("reproduces every recorded fact byte for byte", () => {
    for (const recorded of vectors.days) {
      const replayed = handleDailySky(recorded.request);
      assert.equal(replayed.ok, true, recorded.label);
      assert.deepEqual(replayed, recorded.response, recorded.label);
    }
  });

  it("carries the container digest and the ephemeris vintage on every fact", () => {
    for (const recorded of vectors.days) {
      const response = recorded.response;
      assert.match(response.container_digest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(response.ephemeris_data_version, "se-2.10.03-1800-2399");
      for (const fact of response.facts) {
        // A fact that could not name its vintage could not later prove which
        // data produced it, which is the whole point of freezing a command.
        assert.equal(fact.ephemeris_data_version, response.ephemeris_data_version);
        assert.equal(fact.container_digest, response.container_digest);
        assert.equal(fact.fact_id, `dsf_${fact.content_digest.slice(7, 39)}`);
      }
    }
  });

  it("gives every kind at least one real vector", () => {
    const kinds = new Set(vectors.days.flatMap((d) => d.response.facts.map((f) => f.kind)));
    assert.deepEqual(
      [...kinds].sort(),
      [
        "anchor_position",
        "collective_exact_aspect",
        "house_placement",
        "lunar_phase",
        "sign_ingress",
        "transit_natal_contact",
      ],
      "an unexercised kind is an unverified kind",
    );
  });

  // -------------------------------------------------------------------------
  // Independent recomputation
  // -------------------------------------------------------------------------

  it("anchor positions match a direct ephemeris call at the anchor", () => {
    for (const recorded of vectors.days) {
      const response = recorded.response;
      for (const fact of response.facts) {
        if (fact.kind !== "anchor_position") continue;
        const detail = detailOf<{ body: TransitingBody; longitude_deg: number; sign: string; sign_degree_deg: number }>(fact);
        const direct = angleAt(detail.body, response.anchor_at);
        assert.ok(
          Math.abs(wrap180(direct - detail.longitude_deg)) < 1e-5,
          `${detail.body} anchor longitude ${detail.longitude_deg} vs ${direct}`,
        );
        assert.equal(detail.sign, signOf(detail.longitude_deg));
        assert.ok(Math.abs(detail.sign_degree_deg - (detail.longitude_deg % 30)) < 1e-5);
      }
    }
  });

  it("every exact transit-to-natal contact is exact when recomputed", () => {
    const natal = new Map(
      (vectors as unknown as { natal_positions: Array<{ body: string; longitude_deg: number }> })
        .natal_positions.map((p) => [p.body, p.longitude_deg]),
    );
    let checked = 0;
    for (const recorded of vectors.days) {
      for (const fact of recorded.response.facts) {
        if (fact.kind !== "transit_natal_contact") continue;
        const detail = detailOf<{
          transiting_body: TransitingBody;
          natal_target: string;
          aspect: AspectType;
        }>(fact);
        const target = natal.get(detail.natal_target);
        assert.ok(target !== undefined, `natal ${detail.natal_target} is in the vector set`);
        const lon = angleAt(detail.transiting_body, fact.effective_at);
        const offsets = orientedTargets(target, ASPECT_ANGLE_BY_TYPE[detail.aspect]);
        const closest = Math.min(...offsets.map((o) => Math.abs(wrap180(lon - o.target_deg))));
        assert.ok(
          closest < ARCSECOND,
          `${fact.label} at ${fact.effective_at} is off by ${closest} degrees`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0, "at least one contact was recomputed");
  });

  it("every sign ingress lands on its 30-degree boundary when recomputed", () => {
    let checked = 0;
    for (const recorded of vectors.days) {
      for (const fact of recorded.response.facts) {
        if (fact.kind !== "sign_ingress") continue;
        const detail = detailOf<{ body: TransitingBody; to_sign: string }>(fact);
        const lon = angleAt(detail.body, fact.effective_at);
        const distance = Math.abs(wrap180(lon - Math.round(lon / 30) * 30));
        assert.ok(distance < ARCSECOND, `${fact.label} is ${distance} degrees off a boundary`);
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it("every exact collective aspect is exact when recomputed", () => {
    let checked = 0;
    for (const recorded of vectors.days) {
      for (const fact of recorded.response.facts) {
        if (fact.kind !== "collective_exact_aspect") continue;
        const detail = detailOf<{
          body: TransitingBody;
          other_body: TransitingBody;
          aspect: AspectType;
        }>(fact);
        const separation = wrap180(
          angleAt(detail.body, fact.effective_at) - angleAt(detail.other_body, fact.effective_at),
        );
        const expected = ASPECT_ANGLE_BY_TYPE[detail.aspect];
        assert.ok(
          Math.abs(Math.abs(separation) - expected) < ARCSECOND,
          `${fact.label} separation ${separation} vs ${expected}`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it("the lunar phase matches the recomputed Sun-to-Moon elongation", () => {
    for (const recorded of vectors.days) {
      const phase = recorded.response.facts.find((f) => f.kind === "lunar_phase");
      assert.ok(phase);
      const detail = detailOf<{ elongation_deg: number; phase: string }>(phase);
      const direct = norm360(
        angleAt("moon", recorded.response.anchor_at) - angleAt("sun", recorded.response.anchor_at),
      );
      assert.ok(Math.abs(wrap180(direct - detail.elongation_deg)) < 1e-5);
    }
  });

  it("house placements put each body between the cusps that bracket it", () => {
    const cusps = (vectors as unknown as { natal_house_cusps: { cusps_deg: number[] } })
      .natal_house_cusps.cusps_deg;
    let checked = 0;
    for (const recorded of vectors.days) {
      for (const fact of recorded.response.facts) {
        if (fact.kind !== "house_placement") continue;
        const detail = detailOf<{ house: number; longitude_deg: number }>(fact);
        const from = cusps[detail.house - 1]!;
        const to = cusps[detail.house % 12]!;
        const inside =
          from <= to
            ? detail.longitude_deg >= from && detail.longitude_deg < to
            : detail.longitude_deg >= from || detail.longitude_deg < to;
        assert.ok(inside, `${fact.label} at ${detail.longitude_deg} is not inside [${from}, ${to})`);
        checked += 1;
      }
    }
    assert.equal(checked, 20, "ten anchored bodies across two golden days");
  });

  // -------------------------------------------------------------------------
  // A value any published ephemeris can settle
  // -------------------------------------------------------------------------

  it("puts the Sun into Virgo on 2026-08-23 at 02:19 UTC", () => {
    // The one assertion here that owes nothing to this repository: the 2026
    // Virgo ingress is a published astronomical event, so a scanner that agreed
    // with itself and disagreed with the world would still fail.
    const ingress = day("the Sun's Virgo ingress").response.facts.find(
      (f) => f.kind === "sign_ingress" && detailOf<{ body: string }>(f).body === "sun",
    );
    assert.ok(ingress, "the Sun's ingress is in the vector");
    assert.equal(ingress.label, "Sun enters Virgo");
    assert.deepEqual(detailOf(ingress), {
      body: "sun",
      from_sign: "leo",
      to_sign: "virgo",
      direction: "direct",
    });
    assert.equal(ingress.effective_at, "2026-08-23T02:18:49Z");
    // The ingress falls inside a local day that STARTS on 2026-08-22: the
    // half-open interval is the reader's day, not a UTC calendar date.
    assert.ok(ingress.effective_at > day("the Sun's Virgo ingress").response.day_start_at);
    assert.ok(ingress.effective_at < day("the Sun's Virgo ingress").response.day_end_at);
  });

  it("orders a real day by kind rank, then instant, then id", () => {
    const facts = day("every fact kind in one day").response.facts;
    const rank = [
      "anchor_position",
      "lunar_phase",
      "transit_natal_contact",
      "sign_ingress",
      "collective_exact_aspect",
      "house_placement",
    ];
    const keys = facts.map((f) => [rank.indexOf(f.kind), f.effective_at, f.fact_id] as const);
    for (let i = 1; i < keys.length; i += 1) {
      assert.ok(
        keys[i - 1]! < keys[i]!,
        `${facts[i - 1]!.fact_id} should sort before ${facts[i]!.fact_id}`,
      );
    }
    assert.equal(new Set(facts.map((f) => f.fact_id)).size, facts.length);
  });
});
