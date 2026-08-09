/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * https://www.rfc-editor.org/rfc/rfc8785.html
 *
 * This is a deliberate second copy of `packages/reading-engine/src/jcs.ts`, and
 * the duplication is the cheaper of two bad options. `@patternlike/reading-engine`
 * holds ranking weights and editorial assembly and must stay outside the AGPL
 * service's Corresponding Source, so `apps/calc-stub` — which mints `cyc_` ids
 * and therefore needs JCS — cannot import it. Inverting the dependency is worse:
 * reading-engine's `tsconfig.json` omits the DOM lib precisely so that `crypto`
 * and `fetch` are not in scope, and importing this package would put them back.
 *
 * Divergence is caught rather than trusted: both copies and the Python fixture
 * generator are pinned byte-for-byte to
 * `contracts/m3/fixtures/canonicalization/jcs-golden-vectors.json`, so three
 * independent implementations cross-check on one vector set.
 *
 * The repository's legacy `canonicalJson` (JSON.stringify over sorted keys)
 * stays exactly as it is: M0 release, object, and signature hashes are
 * byte-frozen on its behaviour, and reinterpreting them as JCS would invalidate
 * every stored bundle.
 */

export class CanonicalizationError extends Error {
  readonly code = "canonicalization_error";
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path || "<root>"})`);
    this.name = "CanonicalizationError";
  }
}

const SHORT_ESCAPES: Record<number, string> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

/**
 * RFC 8785 section 3.2.2.2. Only the two structural characters, the five short
 * escapes, and C0 controls are escaped; everything else — including all
 * non-ASCII — is emitted literally, because the output is UTF-8.
 *
 * Lone surrogates are rejected rather than replaced. A replacement character
 * would produce bytes that hash cleanly while meaning something else.
 */
function canonicalString(value: string, path: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const short = SHORT_ESCAPES[code];
    if (short !== undefined) {
      out += short;
      continue;
    }
    if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalizationError("unpaired high surrogate", path);
      }
      out += value[i] + value[i + 1];
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("unpaired low surrogate", path);
    }
    out += value[i];
  }
  return out + '"';
}

/**
 * RFC 8785 section 3.2.2.3 defers to the ECMAScript `Number::toString`
 * algorithm, which is exactly what `String(n)` implements.
 *
 * Exponential output is rejected rather than rewritten. JCS does define a form
 * for it, but nothing in this contract produces a magnitude that reaches it
 * (orbs, longitudes, speeds, integer windings), so an implementation here would
 * be untested code sitting inside a hash preimage. Rejecting keeps the failure
 * loud instead of silently interoperable-looking.
 */
function canonicalNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`non-finite number ${value}`, path);
  }
  const rendered = String(value);
  if (rendered.includes("e") || rendered.includes("E")) {
    throw new CanonicalizationError(
      `number ${rendered} requires exponential notation, which this profile does not emit`,
      path,
    );
  }
  // -0 serializes as "0" under Number::toString, which is what JCS wants.
  return rendered === "-0" ? "0" : rendered;
}

function canonicalize(value: unknown, path: string): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";

  const type = typeof value;
  if (type === "string") return canonicalString(value as string, path);
  if (type === "number") return canonicalNumber(value as number, path);
  if (type === "undefined") {
    throw new CanonicalizationError(
      "undefined is not an I-JSON value; use null or omit the key",
      path,
    );
  }
  if (type === "bigint" || type === "function" || type === "symbol") {
    throw new CanonicalizationError(`${type} is not an I-JSON value`, path);
  }

  if (Array.isArray(value)) {
    // JCS deliberately preserves array order. Anything that must be
    // order-independent is sorted into its contractual total order by the
    // caller BEFORE it reaches here.
    return "[" + value.map((v, i) => canonicalize(v, `${path}[${i}]`)).join(",") + "]";
  }

  if (type === "object") {
    const object = value as Record<string, unknown>;
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalizationError(
        "only plain objects can be canonicalized; Date, Map, and class instances have no I-JSON form",
        path,
      );
    }
    // Default string sort in ECMAScript compares UTF-16 code units, which is
    // precisely the RFC 8785 property-name ordering rule.
    const keys = Object.keys(object).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const child = object[key];
      if (child === undefined) {
        throw new CanonicalizationError(
          `property ${JSON.stringify(key)} is undefined; omit it or use null`,
          path,
        );
      }
      parts.push(
        canonicalString(key, path) + ":" + canonicalize(child, path ? `${path}.${key}` : key),
      );
    }
    return "{" + parts.join(",") + "}";
  }

  throw new CanonicalizationError(`unsupported value of type ${type}`, path);
}

/** Canonical UTF-8 text for `value`, per RFC 8785. */
export function jcsCanonicalize(value: unknown): string {
  return canonicalize(value, "");
}
