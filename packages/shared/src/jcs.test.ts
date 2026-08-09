import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CanonicalizationError, jcsCanonicalize } from "./jcs.js";
import { renderCycleId, renderCyclePassId, CycleIdentityError } from "./cycle-types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = path.resolve(
  here,
  "../../../contracts/m3/fixtures/canonicalization/jcs-golden-vectors.json",
);

interface Vector {
  name: string;
  description: string;
  input: unknown;
  canonical: string;
  full_digest: string;
  rendered_id: string;
}

const vectors: Vector[] = JSON.parse(readFileSync(VECTORS, "utf8")).vectors;

/**
 * This package's JCS is a second implementation of the one in
 * `@patternlike/reading-engine`, kept apart because the AGPL calculation
 * service may import this package and must not import that one. The
 * duplication is only safe while both are pinned to the same vectors, so this
 * file runs the identical vector set rather than a convenient subset.
 */
test("golden vectors reproduce byte-for-byte, not merely digest-for-digest", () => {
  assert.ok(vectors.length >= 7, "expected the full vector set");
  for (const vector of vectors) {
    const canonical = jcsCanonicalize(vector.input);
    // Byte equality, not digest equality: an implementation that produced
    // different bytes but happened to round-trip its own digests would still be
    // non-interoperable, and the rendered 128-bit suffix would hide it.
    assert.equal(canonical, vector.canonical, `canonical bytes for ${vector.name}`);

    const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
    assert.equal(digest, vector.full_digest, `digest for ${vector.name}`);

    const prefix = vector.rendered_id.slice(0, vector.rendered_id.indexOf("_") + 1);
    assert.equal(prefix + digest.slice(0, 32), vector.rendered_id, `id for ${vector.name}`);
  }
});

test("the cycle identity vector renders through renderCycleId", () => {
  const vector = vectors.find((v) => v.name === "cycle-identity-transit");
  assert.ok(vector, "cycle-identity-transit vector is present");
  const digest = createHash("sha256")
    .update(jcsCanonicalize(vector.input), "utf8")
    .digest("hex");
  assert.equal(renderCycleId(digest), vector.rendered_id);
  assert.equal(vector.rendered_id, "cyc_32d9bc34a5d9a4f42481de9da06defbe");
});

test("id rendering rejects anything that is not a full lowercase SHA-256 digest", () => {
  const short = "a".repeat(32);
  const upper = "A".repeat(64);
  for (const render of [renderCycleId, renderCyclePassId]) {
    assert.throws(() => render(short), CycleIdentityError);
    assert.throws(() => render(upper), CycleIdentityError);
    assert.throws(() => render(""), CycleIdentityError);
  }
  assert.equal(renderCyclePassId("b".repeat(64)), "cyp_" + "b".repeat(32));
});

test("reordering object keys does not change identity", () => {
  const a = vectors.find((v) => v.name === "assembly-identity-daily")!;
  const b = vectors.find((v) => v.name === "assembly-identity-daily-reordered")!;
  assert.equal(jcsCanonicalize(a.input), jcsCanonicalize(b.input));
  assert.equal(a.full_digest, b.full_digest);
});

test("array order is preserved, so a caller must sort before canonicalizing", () => {
  assert.notEqual(jcsCanonicalize([1, 2]), jcsCanonicalize([2, 1]));
});

test("JCS and the legacy canonicalJson are not interchangeable", async () => {
  // M0 release, object, and signature hashes are byte-frozen on canonicalJson.
  // If these two ever agreed on every input, someone would eventually swap one
  // for the other; this pins the fact that they must not be swapped.
  const { canonicalJson } = await import("./index.js");
  const value = { b: "line\nbreak", a: 3.0 };
  assert.equal(jcsCanonicalize(value), '{"a":3,"b":"line\\nbreak"}');
  assert.equal(canonicalJson(value), '{"a":3,"b":"line\\nbreak"}');
  // They agree on this input and diverge on a lone surrogate, which
  // JSON.stringify happily emits as an escape and JCS refuses outright.
  const lone = { a: "\ud800" };
  assert.equal(canonicalJson(lone), '{"a":"\\ud800"}');
  assert.throws(() => jcsCanonicalize(lone), CanonicalizationError);
});

test("non-I-JSON values are rejected rather than coerced", () => {
  assert.throws(() => jcsCanonicalize({ a: undefined }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ a: Number.NaN }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ a: Infinity }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ a: new Date(0) }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ a: 1e21 }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ a: 10n }), CanonicalizationError);
});

test("-0 canonicalizes as 0, matching Number::toString", () => {
  assert.equal(jcsCanonicalize({ a: -0 }), '{"a":0}');
});
