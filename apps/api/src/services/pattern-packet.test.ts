import { describe, expect, it } from "vitest";
import type {
  PatternFactPacket,
  PatternOntologyRecord,
  PatternPlan,
  PatternWriterOutput,
} from "@patternlike/shared";

import {
  PATTERN_PACKET_LIMITS_DEFAULT,
  buildPlannerInput,
  findPatternInputViolation,
  buildVerifierInput,
  buildWriterInput,
  type PatternPacketLimits,
} from "./pattern-packet.js";

/**
 * Every private value in these fixtures is a recognizable sentinel, so a deep
 * scan can prove absence rather than merely prove the happy path.
 */
const SENTINEL = "ZZSENTINELZZ";

function packet(): PatternFactPacket {
  return {
    schema_version: "0.7.0",
    locale: "en-US",
    effective_accuracy: "exact",
    uncertainty: { suppressed_classes: [], required_language_rule_ids: ["rule.uncertainty.1"] },
    features: [
      {
        alias: "f001",
        feature_class: "position",
        fact: { body: "sun", longitude: 12.5, sign: 1, house: 3 },
        coverage: "mandatory_core",
        ontology_rule_ids: ["ont.sun.aries"],
        cluster_ids: ["c1"],
      },
      {
        alias: "f002",
        feature_class: "aspect",
        fact: { body_a: "mars", body_b: "saturn", aspect: "square", orb: 1.2 },
        coverage: "eligible",
        ontology_rule_ids: ["ont.mars.saturn.square"],
        cluster_ids: ["c1"],
      },
    ],
    clusters: [{ cluster_id: "c1", feature_aliases: ["f001", "f002"], compatible_with: [] }],
    selection_constraints: {
      core_chapters_min: 4,
      core_chapters_max: 6,
      additional_signatures_max: 8,
      sparse_pattern: false,
    },
  };
}

function records(): PatternOntologyRecord[] {
  return [
    {
      id: "ont.sun.aries",
      meaning_class: "source_supported",
      locale: "en-US",
      feature_predicate: { type: "position", body: "sun" },
      normalized_proposition: "A directness that starts things.",
      source_fragment_ids: ["frag.1"],
      input_meaning_ids: [],
      transformation_class: null,
      tensions: ["ont.sun.aries#tension"],
      counter_expressions: ["ont.sun.aries#counter"],
      prohibited_claims: ["no fate claims"],
      salience_band: "high",
      presentation_priority: 1,
      cluster_tags: ["identity"],
    },
    {
      id: "ont.mars.saturn.square",
      meaning_class: "derived_synthesis",
      locale: "en-US",
      feature_predicate: { type: "aspect", body_a: "mars", body_b: "saturn", aspect: "square" },
      normalized_proposition: "Effort meeting its own brake.",
      source_fragment_ids: ["frag.2"],
      input_meaning_ids: ["ont.sun.aries"],
      transformation_class: "tension",
      tensions: [],
      counter_expressions: [],
      prohibited_claims: [],
      salience_band: "medium",
      presentation_priority: 2,
      cluster_tags: ["effort"],
    },
  ];
}

function plan(): PatternPlan {
  return {
    schema_version: "0.7.0",
    plan_hash: `sha256:${"a".repeat(64)}`,
    sparse_pattern: false,
    chapters: [
      {
        chapter_key: "chapter_01",
        working_title: "Effort meeting its brake",
        purpose: "Describe the tension.",
        feature_aliases: ["f001", "f002"],
        ontology_rule_ids: ["ont.sun.aries", "ont.mars.saturn.square"],
        derived_synthesis_ids: ["ont.mars.saturn.square"],
        required_tension_ids: ["ont.sun.aries#tension"],
        required_resource_ids: [],
        required_counter_expression_ids: ["ont.sun.aries#counter"],
      },
    ],
    additional_signatures: [],
    omissions: [],
  };
}

function candidate(): PatternWriterOutput {
  return {
    schema_version: "0.7.0",
    title: "A pattern",
    chapters: [
      {
        chapter_key: "chapter_01",
        title: "Effort meeting its brake",
        summary: "A summary.",
        sections: [
          {
            section_key: "chapter_01_section_01",
            text: "Some prose.",
            claim_class: "reflective_interpretation",
            feature_aliases: ["f001"],
            ontology_rule_ids: ["ont.sun.aries"],
            derived_synthesis_ids: [],
          },
        ],
        tensions: [
          {
            text: "A tension.",
            claim_class: "tension",
            feature_aliases: ["f001"],
            ontology_rule_ids: ["ont.sun.aries"],
            derived_synthesis_ids: [],
          },
        ],
        resources: [],
        counter_expression: {
          text: "A counter.",
          claim_class: "counter_expression",
          feature_aliases: ["f001"],
          ontology_rule_ids: ["ont.sun.aries"],
          derived_synthesis_ids: [],
        },
      },
    ],
    additional_signatures: [],
    uncertainty_note: null,
  };
}

/** Every string leaf in a serialized document, for sentinel scanning. */
function deepScan(value: unknown): string {
  return JSON.stringify(value);
}

describe("Pattern provider packet builders", () => {
  describe("minimization", () => {
    it("emits no forbidden identifier from any of the three documents", () => {
      const p = packet();
      const r = records();
      const built = [
        buildPlannerInput(p, r, PATTERN_PACKET_LIMITS_DEFAULT),
        buildWriterInput(plan(), p, r, PATTERN_PACKET_LIMITS_DEFAULT),
        buildVerifierInput(candidate(), plan(), p, r, PATTERN_PACKET_LIMITS_DEFAULT),
      ];
      for (const result of built) {
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const blob = deepScan(result.document);
        for (const forbidden of [
          "user_id",
          "chart_id",
          "chart_fingerprint",
          "chart_fingerprint_hash",
          "fingerprint",
          "birth_date",
          "birth_time",
          "birthplace",
          "consent_id",
          "check_in",
          "journal",
          "life_event",
          "daily_reading",
          "latitude",
          "aliasMap",
          "generation_id",
          "claim_id",
          "pattern_id",
        ]) {
          expect(blob, `${forbidden} must not appear`).not.toContain(`"${forbidden}"`);
        }
        for (const prefix of ["nft_", "usr_", "cs_", "pgen_", "cyc_"]) {
          expect(blob, `${prefix} must not appear`).not.toContain(prefix);
        }
      }
    });

    it("permits a calculated longitude inside a packet feature fact", () => {
      const result = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The exemption survives being wrapped: the document nests the packet, so
      // a path rule written for a bare packet would reject every position.
      expect(deepScan(result.document)).toContain('"longitude":12.5');
    });

    it("omits every non-allowlisted field when handed a wider object than declared", () => {
      // TypeScript's excess-property check fires only on fresh object literals,
      // so a *variable* of a wider type is assignable here. The builder must
      // copy named fields rather than spread, or aliasMap reaches the provider.
      const wide = {
        ...packet(),
        aliasMap: { f001: `nft_${"a".repeat(32)}` },
        chart_fingerprint_hash: SENTINEL,
        user_id: `usr_${SENTINEL}`,
      } as unknown as PatternFactPacket;

      const result = buildPlannerInput(wide, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const blob = deepScan(result.document);
      expect(blob).not.toContain(SENTINEL);
      expect(blob).not.toContain("aliasMap");
      expect(blob).not.toContain("chart_fingerprint_hash");
    });

    it("rejects a document that already contains an unexpected key", () => {
      // The companion to the test above, and it must drive the walk DIRECTLY.
      // Through a builder this can never fail: the allowlist copy omits the
      // poison before the walk runs, so a builder-driven assertion would prove
      // the first line twice and the second line never.
      const clean = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(clean.ok).toBe(true);
      if (!clean.ok) return;

      const poisoned = JSON.parse(clean.serialized) as Record<string, unknown>;
      const features = (poisoned.packet as Record<string, unknown>).features as Record<
        string,
        unknown
      >[];
      (features[0]!.fact as Record<string, unknown>).consent_id = SENTINEL;

      const violation = findPatternInputViolation(poisoned);
      expect(violation).not.toBeNull();
      expect(violation?.code).toBe("pattern_input_forbidden_key");
      expect(violation?.key).toBe("consent_id");
    });

    it("rejects a longitude that appears outside a packet feature fact", () => {
      const clean = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(clean.ok).toBe(true);
      if (!clean.ok) return;

      const poisoned = JSON.parse(clean.serialized) as Record<string, unknown>;
      (poisoned.packet as Record<string, unknown>).longitude = 51.5;

      const violation = findPatternInputViolation(poisoned);
      expect(violation?.code).toBe("pattern_input_forbidden_key");
      expect(violation?.key).toBe("longitude");
    });

    it("accepts the wrapped calculated longitude the bare-packet rule exempts", () => {
      // The normative Python rule requires a path of exactly four segments.
      // These documents nest the packet, so the same longitude sits five deep;
      // a literal port would reject every position feature.
      const clean = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(clean.ok).toBe(true);
      if (!clean.ok) return;
      expect(findPatternInputViolation(JSON.parse(clean.serialized))).toBeNull();
    });

    it("carries no aliasMap into the writer or verifier documents", () => {
      const results = [
        buildWriterInput(plan(), packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT),
        buildVerifierInput(candidate(), plan(), packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT),
      ];
      for (const result of results) {
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(deepScan(result.document)).not.toContain("aliasMap");
      }
    });
  });

  describe("byte bound", () => {
    it("refuses rather than truncates when the document exceeds the cap", () => {
      const tiny: PatternPacketLimits = { ...PATTERN_PACKET_LIMITS_DEFAULT, maxBytes: 32 };
      const result = buildPlannerInput(packet(), records(), tiny);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("pattern_input_too_large");
    });

    it("reports the measured byte length of exactly the bytes it serialized", () => {
      const result = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.bytes).toBe(new TextEncoder().encode(result.serialized).length);
      expect(JSON.parse(result.serialized)).toEqual(result.document);
    });

    it("pins the default cap to the compiled PATTERN_INPUT_MAX_BYTES", () => {
      expect(PATTERN_PACKET_LIMITS_DEFAULT.maxBytes).toBe(98_304);
    });
  });

  describe("determinism", () => {
    it("serializes byte-identically across calls, which artifact reuse depends on", () => {
      const first = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      const second = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.serialized).toBe(second.serialized);
    });

    it("does not depend on the key order of its inputs", () => {
      const reordered = JSON.parse(
        JSON.stringify(packet(), ["schema_version", "locale", "effective_accuracy"]),
      ) as Record<string, unknown>;
      const rebuilt = { ...packet(), ...reordered } as PatternFactPacket;
      const a = buildPlannerInput(packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      const b = buildPlannerInput(rebuilt, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.serialized).toBe(b.serialized);
    });
  });

  describe("verifier independence", () => {
    it("gives the verifier the candidate, plan, facts, records, graph, and uncertainty only", () => {
      const result = buildVerifierInput(
        candidate(),
        plan(),
        packet(),
        records(),
        PATTERN_PACKET_LIMITS_DEFAULT,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Six items here; the seventh of section 14.1 is the strict verdict schema,
      // which rides text.format.schema on the request rather than the document.
      expect(Object.keys(result.document).sort()).toEqual(
        [
          "candidate",
          "derived_synthesis_graph",
          "facts",
          "ontology_records",
          "pass",
          "plan",
          "schema_version",
          "uncertainty",
        ].sort(),
      );
    });

    it("never carries source fragment ids into the verifier document", () => {
      const result = buildVerifierInput(
        candidate(),
        plan(),
        packet(),
        records(),
        PATTERN_PACKET_LIMITS_DEFAULT,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The raw corpus is out of scope for the verifier; the fragment ids are the
      // handle onto it, so they do not travel either.
      expect(deepScan(result.document)).not.toContain("source_fragment_ids");
      expect(deepScan(result.document)).not.toContain("frag.1");
    });
  });

  describe("writer input", () => {
    it("carries the frozen plan and the bounds, and no omitted or unassigned feature", () => {
      const p = packet();
      // f002 is assigned; add an unassigned feature the plan never names.
      p.features.push({
        alias: "f003",
        feature_class: "angle",
        fact: { angle: "ascendant", longitude: 200.1, sign: 7 },
        coverage: "eligible",
        ontology_rule_ids: [],
        cluster_ids: [],
      });
      const result = buildWriterInput(plan(), p, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const blob = deepScan(result.document);
      expect(blob).toContain("chapter_01");
      expect(blob).not.toContain("f003");
    });
  });
});
