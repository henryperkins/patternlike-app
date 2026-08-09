import { describe, it, expect } from "vitest";
import { canonicalJson, SCHEMA_VERSION } from "@patternlike/shared";
import {
  draftBundle,
  generateSigningKey,
  releaseKeysVar,
  signBundle,
  signedBundle,
  toBase64Url,
} from "../../test/content-release-fixtures.js";
import {
  bundleSigningPayload,
  computeBundleHash,
  computeObjectHash,
  hashesEqual,
  normalizeHash,
  parseReleaseKeyConfiguration,
  parseReleaseKeys,
  pendingFixtureIds,
  validateContentGraph,
  validateIngestionRequest,
  verifyBundleSignature,
  verifyObjectHashes,
  type ContentReleaseBundle,
} from "./content-release.js";

const KEY_ID = "wp-release-key-1";

async function keysFor(...args: Parameters<typeof generateSigningKey>) {
  const key = await generateSigningKey(...args);
  return { key, keys: parseReleaseKeys(releaseKeysVar([key])) };
}

describe("hash normalisation", () => {
  it("treats the optional sha256: prefix as punctuation", () => {
    const hex = "a".repeat(64);
    expect(normalizeHash(`sha256:${hex}`)).toBe(hex);
    expect(hashesEqual(`sha256:${hex}`, hex)).toBe(true);
    expect(hashesEqual(`SHA256:${hex.toUpperCase()}`, hex)).toBe(true);
  });

  it("does not equate different digests", () => {
    expect(hashesEqual("a".repeat(64), "b".repeat(64))).toBe(false);
  });
});

describe("canonical signing payload", () => {
  it("excludes the signature and the self-referential bundle_hash", () => {
    const bundle = draftBundle();
    const payload = JSON.parse(bundleSigningPayload(bundle)) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("signature");
    expect(payload.release).not.toHaveProperty("bundle_hash");
    expect(payload.objects).toBeTruthy();
    // fixtures travel under the signature; tampering with the smoke-test list
    // has to invalidate the bundle like any other edit.
    expect(payload.fixtures).toBeTruthy();
  });

  it("is stable under key reordering, so senders need not agree on field order", async () => {
    const bundle = draftBundle();
    const reordered = JSON.parse(
      canonicalJson({
        signature: bundle.signature,
        objects: bundle.objects,
        fixtures: bundle.fixtures,
        release: bundle.release,
        schema_version: bundle.schema_version,
      }),
    ) as ContentReleaseBundle;

    expect(bundleSigningPayload(reordered)).toBe(bundleSigningPayload(bundle));
    expect(await computeBundleHash(reordered)).toBe(await computeBundleHash(bundle));
  });

  it("changes when any content changes", async () => {
    const before = await computeBundleHash(draftBundle());
    const after = await computeBundleHash(
      draftBundle((bundle) => {
        bundle.objects.phases[0]!.summary = "Different copy entirely.";
      }),
    );

    expect(after).not.toBe(before);
  });

  it("recomputes an object hash without the field that carries it", async () => {
    const object = draftBundle().objects.phases[0]!;
    const withPlaceholder = await computeObjectHash(object);
    const { object_hash: _dropped, ...bare } = object;
    const withoutField = await computeObjectHash(bare as typeof object);

    expect(withPlaceholder).toBe(withoutField);
    expect(withPlaceholder).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("release key configuration", () => {
  it("parses key_id -> {alg, public_key}", () => {
    const keys = parseReleaseKeys(
      JSON.stringify({
        [KEY_ID]: { alg: "Ed25519", public_key: toBase64Url(new Uint8Array(32)) },
      }),
    );

    expect(keys.get(KEY_ID)).toEqual({
      alg: "Ed25519",
      publicKey: toBase64Url(new Uint8Array(32)),
    });
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ["not JSON", "{nope"],
    ["a JSON array", "[]"],
    ["missing public_key", JSON.stringify({ k: { alg: "Ed25519" } })],
    ["an unsupported alg", JSON.stringify({ k: { alg: "RS256", public_key: "AAAA" } })],
    ["a malformed raw public key", JSON.stringify({ k: { alg: "Ed25519", public_key: "AAAA" } })],
  ])("yields no usable key when %s", (_label, raw) => {
    expect(parseReleaseKeys(raw).size).toBe(0);
  });

  it("distinguishes malformed JSON from individually invalid key entries", () => {
    expect(parseReleaseKeyConfiguration("{nope")).toEqual({
      keys: new Map(),
      invalidKeyIds: [],
      malformed: true,
    });

    const parsed = parseReleaseKeyConfiguration(
      JSON.stringify({
        valid: { alg: "Ed25519", public_key: toBase64Url(new Uint8Array(32)) },
        invalid: { alg: "Ed25519", public_key: "AAAA" },
      }),
    );

    expect(parsed.malformed).toBe(false);
    expect(parsed.invalidKeyIds).toEqual(["invalid"]);
    expect(parsed.keys.get("valid")).toEqual({
      alg: "Ed25519",
      publicKey: toBase64Url(new Uint8Array(32)),
    });
  });
});

describe("signature verification", () => {
  it.each(["Ed25519", "ES256"] as const)("accepts a valid %s signature", async (alg) => {
    const { key, keys } = await keysFor(KEY_ID, alg);
    const bundle = await signedBundle(key);

    expect(await verifyBundleSignature(bundle, keys)).toBeNull();
  });

  it("rejects a body edited after signing", async () => {
    const { key, keys } = await keysFor(KEY_ID);
    const bundle = await signedBundle(key);
    bundle.objects.phases[0]!.shadow_expression = "Injected copy.";

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_invalid");
  });

  it("rejects a signature made by a key that is not configured", async () => {
    const { keys } = await keysFor(KEY_ID);
    const attacker = await generateSigningKey(KEY_ID);
    const bundle = await signedBundle(attacker);

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_invalid");
  });

  it("rejects an unknown key_id", async () => {
    const { key, keys } = await keysFor(KEY_ID);
    const bundle = await signBundle(draftBundle(), { ...key, keyId: "wp-release-key-9" });

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_key_unknown");
  });

  /**
   * The bundle names its own algorithm. Honouring that name would let a
   * compromised CMS choose which primitive its bytes are checked under, so the
   * configured algorithm wins and a disagreement is a refusal.
   */
  it("rejects a bundle whose declared alg differs from the configured key", async () => {
    const { key, keys } = await keysFor(KEY_ID);
    const bundle = await signedBundle(key);
    bundle.signature.alg = "ES256";

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_alg_mismatch");
  });

  it("rejects a malformed signature without throwing", async () => {
    const { key, keys } = await keysFor(KEY_ID);
    const bundle = await signedBundle(key);
    bundle.signature.signature = "not base64url!!";

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_malformed");
  });

  it("rejects a configured key that cannot be imported", async () => {
    const { key } = await keysFor(KEY_ID, "ES256");
    const bundle = await signedBundle(key);
    const invalidPoint = new Uint8Array(65);
    invalidPoint[0] = 4;
    const keys = parseReleaseKeys(
      JSON.stringify({
        [KEY_ID]: { alg: "ES256", public_key: toBase64Url(invalidPoint) },
      }),
    );

    expect((await verifyBundleSignature(bundle, keys))?.class).toBe("signature_key_unusable");
  });
});

describe("object hash verification", () => {
  it("accepts hashes this canonicalisation reproduces", async () => {
    const { key } = await keysFor(KEY_ID);
    expect(await verifyObjectHashes(await signedBundle(key))).toBeNull();
  });

  it("rejects the frozen fixture's placeholder hashes", async () => {
    expect((await verifyObjectHashes(draftBundle()))?.class).toBe("object_hash_mismatch");
  });

  it("rejects an object edited after its hash was computed", async () => {
    const { key } = await keysFor(KEY_ID);
    const bundle = await signedBundle(key);
    bundle.objects.prompts[0]!.prompt_text = "Rewritten prompt.";

    expect((await verifyObjectHashes(bundle))?.class).toBe("object_hash_mismatch");
  });
});

describe("ingestion request validation", () => {
  const wrap = (bundle: ContentReleaseBundle, extra: Record<string, unknown> = {}) => ({
    schema_version: SCHEMA_VERSION,
    bundle,
    idempotency_key: "release-ingest-key-0001",
    ...extra,
  });

  it("accepts the frozen fixture's shape", () => {
    expect(validateIngestionRequest(wrap(draftBundle()))).toHaveProperty("request");
  });

  it.each([
    ["a non-object body", "nope", "invalid_body"],
    ["a bad schema_version", { schema_version: "0.1.0" }, "schema_version_unsupported"],
  ])("rejects %s", (_label, body, expected) => {
    const result = validateIngestionRequest(body);
    expect("error" in result && result.error.class).toBe(expected);
  });

  it("rejects a short idempotency_key", () => {
    const result = validateIngestionRequest(wrap(draftBundle(), { idempotency_key: "short" }));
    expect("error" in result && result.error.class).toBe("invalid_body");
  });

  it("rejects a non-boolean activate", () => {
    const result = validateIngestionRequest(wrap(draftBundle(), { activate: "yes" }));
    expect("error" in result && result.error.class).toBe("invalid_body");
  });

  const boundaryCases: Array<[
    string,
    { version?: string; idempotencyKey?: string },
    boolean,
  ]> = [
    ["128-character release.version", { version: `r${"a".repeat(127)}` }, true],
    ["129-character release.version", { version: `r${"a".repeat(128)}` }, false],
    ["256-character idempotency_key", { idempotencyKey: "k".repeat(256) }, true],
    ["257-character idempotency_key", { idempotencyKey: "k".repeat(257) }, false],
  ];

  it.each(boundaryCases)("enforces the %s boundary", (_label, input, accepted) => {
    const bundle = draftBundle((draft) => {
      if (input.version) draft.release.version = input.version;
    });
    const result = validateIngestionRequest(
      wrap(bundle, input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    );

    expect("request" in result).toBe(accepted);
    if (!accepted) expect("error" in result && result.error.class).toBe("invalid_body");
  });

  it("reports the first schema path without echoing the rejected value", () => {
    const bundle = draftBundle((draft) => {
      delete (draft.objects.patterns[0] as Record<string, unknown>).evidence_requirements;
    });
    const result = validateIngestionRequest(wrap(bundle));

    expect("error" in result && result.error.message).toContain(
      "/bundle/objects/patterns/0 (required)",
    );
  });

  it.each([
    ["a missing schema-required pattern evidence_requirements", (bundle: ContentReleaseBundle) => {
      delete (bundle.objects.patterns[0] as Record<string, unknown>).evidence_requirements;
    }],
    ["an unsupported release status", (bundle: ContentReleaseBundle) => {
      bundle.release.status = "draft";
    }],
    ["an unexpected top-level request field", (_bundle: ContentReleaseBundle, body: Record<string, unknown>) => {
      body.unexpected = true;
    }],
  ])("rejects %s", (_label, mutate) => {
    const bundle = draftBundle();
    const body = wrap(bundle);
    mutate(bundle, body);

    const result = validateIngestionRequest(body);
    expect("error" in result && result.error.class).toBe("invalid_body");
  });

  it.each([
    [
      "an empty safety_rules array",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.safety_rules = [];
      },
      "objects_incomplete",
    ],
    [
      "an object filed under the wrong collection",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.phases[0]!.content_type = "astrology_cycle";
      },
      "objects_incomplete",
    ],
    [
      "a missing objects collection",
      (bundle: ContentReleaseBundle) => {
        delete (bundle.objects as Partial<ContentReleaseBundle["objects"]>).modifiers;
      },
      "invalid_body",
    ],
    [
      "a phase with no parent_cycle_id",
      (bundle: ContentReleaseBundle) => {
        delete (bundle.objects.phases[0] as Record<string, unknown>).parent_cycle_id;
      },
      "invalid_body",
    ],
    [
      "a bundle_hash that is not a digest",
      (bundle: ContentReleaseBundle) => {
        bundle.release.bundle_hash = "nope";
      },
      "invalid_body",
    ],
    [
      "an unsupported signature alg",
      (bundle: ContentReleaseBundle) => {
        bundle.signature.alg = "RS256" as never;
      },
      "invalid_body",
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    const result = validateIngestionRequest(wrap(draftBundle(mutate)));
    expect("error" in result && result.error.class).toBe(expected);
  });

  /**
   * `version` reaches a D1 primary key, an R2 object key, and the trailing
   * segment of the colon-delimited `reading_key`. The contract only asks for a
   * non-empty string, so the runtime narrows it here rather than repairing a
   * path or a key later.
   */
  it.each(["release/12", "release:12", "", "-release"])(
    "rejects the unusable release version %o",
    (version) => {
      const result = validateIngestionRequest(
        wrap(
          draftBundle((bundle) => {
            bundle.release.version = version;
          }),
        ),
      );
      expect("error" in result && result.error.class).toBe("invalid_body");
    },
  );
});

describe("content graph policy", () => {
  it("accepts the frozen fixture's graph", () => {
    expect(validateContentGraph(draftBundle())).toBeNull();
  });

  it.each([
    [
      "dual_control_violation",
      (bundle: ContentReleaseBundle) => {
        bundle.release.approver_id = bundle.release.last_author_id;
      },
    ],
    [
      "signature_payload_mismatch",
      (bundle: ContentReleaseBundle) => {
        bundle.signature.signed_payload_hash = `sha256:${"b".repeat(64)}`;
      },
    ],
    [
      "orphan_phase",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.phases[0]!.parent_cycle_id = "cycle.does.not.exist";
      },
    ],
    [
      "incomplete_cycle",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.cycles[0]!.phase_ids = ["phase.not.in.bundle"];
      },
    ],
    [
      "duplicate_fragment_id",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.prompts.push({ ...bundle.objects.prompts[0]! });
      },
    ],
    [
      "unresolved_prompt",
      (bundle: ContentReleaseBundle) => {
        bundle.objects.patterns[0]!.prompt_ids = ["prompt.missing@1"];
      },
    ],
  ])("rejects a bundle with %s", (expected, mutate) => {
    expect(validateContentGraph(draftBundle(mutate))?.class).toBe(expected);
  });

  /**
   * A cycle and a phase can each be internally valid and still disagree about
   * their relationship. The contract lane checks each direction separately, so
   * this contradiction resolves in neither.
   */
  it("rejects a cycle that claims a phase belonging to another cycle", () => {
    const reason = validateContentGraph(
      draftBundle((bundle) => {
        const [phase] = bundle.objects.phases;
        const orphanParent = { ...bundle.objects.cycles[0]!, id: "transit.other.cycle" };
        bundle.objects.cycles.push(orphanParent);
        phase!.parent_cycle_id = "transit.other.cycle";
      }),
    );

    expect(reason?.class).toBe("incomplete_cycle");
  });

  /**
   * A safety rule whose fallback resolves to nothing is a rule that fires and
   * produces nothing — the exact gap the launch criterion "model failure or
   * validation rejection always produces reviewed deterministic copy" closes.
   */
  it("rejects a safety rule with no resolvable fallback", () => {
    const reason = validateContentGraph(
      draftBundle((bundle) => {
        const rule = bundle.objects.safety_rules[0]!;
        rule.fallback_fragment_id = "fragment.not.here";
        rule.fallback_text = null;
      }),
    );

    expect(reason?.class).toBe("unresolved_safety_fallback");
  });

  it("accepts an unresolvable fallback fragment when reviewed fallback_text is present", () => {
    const bundle = draftBundle((draft) => {
      draft.objects.safety_rules[0]!.fallback_fragment_id = "fragment.not.here";
    });

    expect(bundle.objects.safety_rules[0]!.fallback_text).toBeTruthy();
    expect(validateContentGraph(bundle)).toBeNull();
  });
});

describe("smoke-test fixtures", () => {
  it("reports the fixture ids this milestone cannot evaluate", () => {
    expect(pendingFixtureIds(draftBundle())).toEqual(["golden_saturn_moon_building"]);
  });

  it("reports none when the bundle declares none", () => {
    expect(
      pendingFixtureIds(
        draftBundle((bundle) => {
          delete bundle.fixtures;
        }),
      ),
    ).toEqual([]);
  });
});
