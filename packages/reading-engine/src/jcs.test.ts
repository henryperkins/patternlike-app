import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CanonicalizationError, jcsCanonicalize } from "./jcs.js";
import { renderAssemblyId } from "./identity.js";

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

test("golden vectors reproduce byte-for-byte, not merely digest-for-digest", () => {
  assert.ok(vectors.length >= 6, "expected the full vector set");
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

test("reordering object keys does not change identity", () => {
  const a = vectors.find((v) => v.name === "assembly-identity-daily")!;
  const b = vectors.find((v) => v.name === "assembly-identity-daily-reordered")!;
  assert.equal(jcsCanonicalize(a.input), jcsCanonicalize(b.input));
  assert.equal(a.full_digest, b.full_digest);
});

test("an uncertainty change that can alter output changes the id", () => {
  const zero = vectors.find((v) => v.name === "assembly-identity-zero-facts")!;
  const unknown = vectors.find((v) => v.name === "assembly-identity-unknown-time")!;
  assert.notEqual(zero.full_digest, unknown.full_digest);
  assert.notEqual(zero.rendered_id, unknown.rendered_id);
});

test("array order is preserved, so a caller must sort before canonicalizing", () => {
  assert.notEqual(jcsCanonicalize([1, 2]), jcsCanonicalize([2, 1]));
});

test("keys sort by UTF-16 code unit, not by insertion", () => {
  assert.equal(jcsCanonicalize({ b: 1, a: 2, A: 3 }), '{"A":3,"a":2,"b":1}');
});

test("integral floats render as integers, per the ECMAScript number rule", () => {
  assert.equal(jcsCanonicalize({ n: 3.0 }), '{"n":3}');
  assert.equal(jcsCanonicalize({ n: -0 }), '{"n":0}');
  assert.equal(jcsCanonicalize({ n: 0.42 }), '{"n":0.42}');
});

test("non-ASCII is emitted literally; control characters are escaped", () => {
  assert.equal(jcsCanonicalize({ k: "ü" }), '{"k":"ü"}');
  assert.equal(jcsCanonicalize({ k: "a\nb\tc" }), '{"k":"a\\nb\\tc"}');
  assert.equal(jcsCanonicalize({ k: "" }), '{"k":"\\u0001"}');
});

test("values with no I-JSON form are rejected rather than coerced", () => {
  assert.throws(() => jcsCanonicalize({ n: NaN }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ n: Infinity }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ k: undefined }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ d: new Date(0) }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ m: new Map() }), CanonicalizationError);
  // A lone surrogate would otherwise be silently replaced, producing bytes that
  // hash cleanly while meaning something else.
  assert.throws(() => jcsCanonicalize({ k: "\ud800" }), CanonicalizationError);
  assert.throws(() => jcsCanonicalize({ k: "\udc00x" }), CanonicalizationError);
  // A magnitude that needs exponential notation is refused rather than guessed.
  assert.throws(() => jcsCanonicalize({ n: 1e21 }), CanonicalizationError);
});

test("a valid surrogate pair survives", () => {
  assert.equal(jcsCanonicalize({ k: "😀" }), '{"k":"😀"}');
});

test("renderAssemblyId refuses anything that is not a full lowercase digest", () => {
  assert.equal(renderAssemblyId("a".repeat(64)), "asm_" + "a".repeat(32));
  assert.throws(() => renderAssemblyId("A".repeat(64)));
  assert.throws(() => renderAssemblyId("ab"));
});
