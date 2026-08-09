import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { jcsCanonicalize } from "./jcs.js";
import {
  buildCycleHashPreimage,
  buildCyclePassIdentity,
  CycleIdentityError,
  type NormalizedCycle,
} from "./cycle-types.js";
import { cycleHash, cyclePassId } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = path.resolve(
  here,
  "../../../contracts/m3/fixtures/canonicalization/cycle-derivation-golden-vectors.json",
);

interface Vector {
  name: string;
  input: unknown;
  canonical: string;
  full_digest: string;
  rendered_id?: string;
}

const vectors: Vector[] = JSON.parse(readFileSync(VECTORS, "utf8")).vectors;
const vector = (name: string): Vector => {
  const found = vectors.find((v) => v.name === name);
  assert.ok(found, `vector ${name} is present`);
  return found;
};

/** The scanned cycle the vectors were generated from, importance_score included. */
const SATURN_SQUARE_SUN: NormalizedCycle = {
  id: "cyc_32d9bc34a5d9a4f42481de9da06defbe",
  technique: "transit",
  body: "saturn",
  target: "sun",
  aspect: "square",
  start_at: "2026-07-19T05:22:10Z",
  exact_at: "2026-08-02T14:11:07Z",
  end_at: "2027-01-26T18:44:02Z",
  pass_count: 3,
  passes: [
    { pass_index: 1, direction: "direct", exact_at: "2026-08-02T14:11:07Z", speed_deg_per_day: 0.0331 },
    { pass_index: 2, direction: "retrograde", exact_at: "2026-10-19T03:52:44Z", speed_deg_per_day: -0.0288 },
    { pass_index: 3, direction: "direct", exact_at: "2027-01-11T21:07:19Z", speed_deg_per_day: 0.0302 },
  ],
  orb_deg: 3.0,
  importance_score: 0.82,
};

test("golden vectors reproduce byte-for-byte", () => {
  for (const v of vectors) {
    assert.equal(jcsCanonicalize(v.input), v.canonical, `canonical bytes for ${v.name}`);
  }
});

test("cyclePassId reproduces the pass-two vector", async () => {
  const expected = vector("cycle-pass-identity-pass-two");
  assert.ok(expected.rendered_id);
  assert.equal(await cyclePassId(SATURN_SQUARE_SUN.id, 2), expected.rendered_id);
  assert.equal(expected.rendered_id, "cyp_ed2d8c5b7059b5b12d4131ee5d2fbb65");
});

test("every pass of one cycle gets a distinct id", async () => {
  const ids = await Promise.all(
    SATURN_SQUARE_SUN.passes.map((p) => cyclePassId(SATURN_SQUARE_SUN.id, p.pass_index)),
  );
  assert.equal(new Set(ids).size, 3);
});

test("the same pass index under a different cycle is a different id", async () => {
  const other = "cyc_00000000000000000000000000000001";
  assert.notEqual(await cyclePassId(SATURN_SQUARE_SUN.id, 1), await cyclePassId(other, 1));
});

test("a pass id is stable when refinement moves the pass timestamp", async () => {
  // The preimage carries no timestamp precisely so this holds: two overlapping
  // scan windows that refine exact_at differently must still name the same pass.
  const before = await cyclePassId(SATURN_SQUARE_SUN.id, 2);
  const refined: NormalizedCycle = {
    ...SATURN_SQUARE_SUN,
    passes: SATURN_SQUARE_SUN.passes.map((p) =>
      p.pass_index === 2 ? { ...p, exact_at: "2026-10-19T03:52:45Z" } : p,
    ),
  };
  assert.equal(await cyclePassId(refined.id, 2), before);
});

test("pass identity rejects a non-cycle parent and a zero index", () => {
  assert.throws(() => buildCyclePassIdentity("asm_deadbeef", 1), CycleIdentityError);
  assert.throws(() => buildCyclePassIdentity(SATURN_SQUARE_SUN.id, 0), CycleIdentityError);
  assert.throws(() => buildCyclePassIdentity(SATURN_SQUARE_SUN.id, 1.5), CycleIdentityError);
});

test("cycleHash reproduces the retrograde vector and drops importance_score", async () => {
  const expected = vector("cycle-hash-retrograde");
  assert.equal(expected.rendered_id, undefined);
  assert.equal(await cycleHash(SATURN_SQUARE_SUN), expected.full_digest);

  // The whole point of the exclusion: an advisory score change must not fail a
  // claimed job, because it cannot change what the reading says.
  const rescored = { ...SATURN_SQUARE_SUN, importance_score: 0.11 };
  assert.equal(await cycleHash(rescored), await cycleHash(SATURN_SQUARE_SUN));

  const absent = { ...SATURN_SQUARE_SUN };
  delete absent.importance_score;
  assert.equal(await cycleHash(absent), await cycleHash(SATURN_SQUARE_SUN));

  assert.ok(!("importance_score" in buildCycleHashPreimage(SATURN_SQUARE_SUN)));
});

test("cycleHash changes when the envelope or the pass list changes", async () => {
  const base = await cycleHash(SATURN_SQUARE_SUN);

  const widened = { ...SATURN_SQUARE_SUN, end_at: "2027-01-27T18:44:02Z" };
  assert.notEqual(await cycleHash(widened), base);

  const dropped: NormalizedCycle = {
    ...SATURN_SQUARE_SUN,
    pass_count: 2,
    passes: SATURN_SQUARE_SUN.passes.slice(0, 2),
  };
  assert.notEqual(await cycleHash(dropped), base);

  // JCS preserves array order, so a reordered pass list is a different scan —
  // which is correct: the contract requires chronological order.
  const reordered: NormalizedCycle = {
    ...SATURN_SQUARE_SUN,
    passes: [...SATURN_SQUARE_SUN.passes].reverse(),
  };
  assert.notEqual(await cycleHash(reordered), base);
});
