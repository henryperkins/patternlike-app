import { describe, expect, it } from "vitest";
import type {
  PatternFactPacket,
  PatternOntologyRecord,
  PatternPlan,
  PatternWriterOutput,
} from "@patternlike/shared";

import {
  PATTERN_PACKET_LIMITS_DEFAULT,
  buildCorrectionDocument,
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

  describe("regressions from the adversarial review", () => {
    it("refuses a chart id or consent id, not only the prefixes that looked reachable", () => {
      // The original list held nft_/usr_/cs_/pgen_/cyc_/cyp_/prel_ while the
      // module header promised no chart identifier and no consent id. Chart ids
      // are minted cht_ and consent ids cns_, so both passed both lines.
      for (const id of ["cht_0123456789abcdef", "cns_0123456789abcdef", "pat_abc", "gen_abc"]) {
        const poisoned = packet();
        poisoned.features[0]!.alias = id;
        const result = buildPlannerInput(poisoned, records(), PATTERN_PACKET_LIMITS_DEFAULT);
        expect(result.ok, `${id} must be refused`).toBe(false);
      }
    });

    it("refuses an id embedded mid-sentence, not only one at offset zero", () => {
      // Free text travels verbatim, so an id appears in prose, not at offset 0.
      // A single leading space defeated the anchored check.
      const poisoned = records();
      poisoned[0]!.normalized_proposition = `Feature nft_${"a".repeat(32)} indicates directness.`;
      const result = buildPlannerInput(packet(), poisoned, PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("pattern_input_forbidden_key");
    });

    it("refuses an id embedded in a plan working title or purpose", () => {
      const poisoned = plan();
      poisoned.chapters[0]!.working_title = `About usr_${"b".repeat(8)}`;
      const result = buildWriterInput(poisoned, packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(false);
    });

    it("inspects the bytes it sends, not the live object graph", () => {
      // A value carrying toJSON presents no own enumerable keys, so a walk over
      // the object graph sees nothing while JSON.stringify sends what toJSON
      // returned. The walk therefore runs on the serialized form.
      const smuggler = {
        toJSON() {
          return { consent_id: SENTINEL };
        },
      };
      const poisoned = packet();
      (poisoned.features[0]!.fact as Record<string, unknown>).body = smuggler as never;
      const result = buildPlannerInput(poisoned, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      // copyFactValue drops the non-scalar outright, which is the first line.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.serialized).not.toContain(SENTINEL);

      // And the walk itself, driven directly, catches what serialization emits.
      expect(findPatternInputViolation(JSON.parse(JSON.stringify({ fact: smuggler })))).not.toBeNull();
    });

    it("drops a nested object smuggled under an allowed fact key", () => {
      const poisoned = packet();
      (poisoned.features[0]!.fact as Record<string, unknown>).body = {
        id: SENTINEL,
        title: SENTINEL,
      };
      const result = buildPlannerInput(poisoned, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.serialized).not.toContain(SENTINEL);
    });

    it("gives the writer facts for aliases assigned to an additional signature", () => {
      const p = packet();
      p.features.push({
        alias: "f007",
        feature_class: "position",
        fact: { body: "venus", longitude: 44.4, sign: 2, house: 5 },
        coverage: "eligible",
        ontology_rule_ids: ["ont.sun.aries"],
        cluster_ids: [],
      });
      const withSignature = plan();
      withSignature.additional_signatures.push({
        signature_key: "signature_01",
        working_title: "A signature",
        feature_aliases: ["f007"],
        ontology_rule_ids: ["ont.sun.aries"],
      });

      const result = buildWriterInput(withSignature, p, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Without signature_assignments the writer is asked to write a signature
      // about a feature whose facts appear nowhere in the document.
      expect(result.document.signature_assignments).toHaveLength(1);
      expect(result.document.signature_assignments[0]!.facts.map((f) => f.alias)).toEqual(["f007"]);
    });

    it("supplies every ontology record the verifier graph names as an input", () => {
      // A plan may cite a derived synthesis without citing its inputs, which
      // left graph edges pointing at records the verifier was never shown --
      // while section 14.4 asks it whether a synthesis exceeds its dependencies.
      const citedSynthesisOnly = plan();
      citedSynthesisOnly.chapters[0]!.ontology_rule_ids = ["ont.mars.saturn.square"];

      const result = buildVerifierInput(
        candidate(),
        citedSynthesisOnly,
        packet(),
        records(),
        PATTERN_PACKET_LIMITS_DEFAULT,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const present = new Set(result.document.ontology_records.map((r) => r.id));
      for (const edge of result.document.derived_synthesis_graph) {
        for (const input of edge.inputs) {
          expect(present.has(input), `input ${input} must be supplied`).toBe(true);
        }
      }
    });

    it("keeps the required uncertainty-language records a plan need never cite", () => {
      const p = packet();
      p.uncertainty.required_language_rule_ids = ["ont.sun.aries"];
      const citingNothingElse = plan();
      citingNothingElse.chapters[0]!.ontology_rule_ids = ["ont.mars.saturn.square"];

      const result = buildWriterInput(citingNothingElse, p, records(), PATTERN_PACKET_LIMITS_DEFAULT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The writer is told to honour these rules; filtering by cited ids alone
      // made that instruction point at nothing.
      expect(result.document.ontology_records.map((r) => r.id)).toContain("ont.sun.aries");
    });
  });

  describe("writer correction document", () => {
    const PROSE = "ZZPROSEZZ";

    /** A rejected candidate whose every sentence is a recognizable sentinel. */
    function rejectedCandidate() {
      const c = candidate();
      c.title = `${PROSE} title`;
      c.chapters[0]!.title = `${PROSE} chapter title`;
      c.chapters[0]!.summary = `${PROSE} summary`;
      c.chapters[0]!.sections[0]!.text = `${PROSE} section prose`;
      c.chapters[0]!.tensions[0]!.text = `${PROSE} tension prose`;
      c.chapters[0]!.counter_expression.text = `${PROSE} counter prose`;
      return c;
    }

    it("carries codes, keys, and rule ids only -- never prose", () => {
      const document = buildCorrectionDocument(
        plan(),
        {
          deterministic: [
            { code: "section_count", message: "chapter_01" },
            { code: "chapter_mismatch", message: "writer chapters must match the frozen plan" },
          ],
          semantic: [
            {
              code: "claim_not_entailed",
              severity: "error",
              target_key: "chapter_01_section_01",
              feature_aliases: ["f001"],
              ontology_rule_ids: ["ont.sun.aries"],
              rationale: `${PROSE} the verifier explained at length why this failed`,
            },
          ],
        },
        2,
      );

      const blob = JSON.stringify(document);
      expect(blob).not.toContain(PROSE);
      // The verifier's rationale is prose about prose and never travels.
      expect(blob).not.toContain("rationale");
      // A deterministic message that is an explanation rather than a key is dropped.
      expect(blob).not.toContain("writer chapters must match");
    });

    it("recovers a chapter key from a deterministic message but drops an explanation", () => {
      const document = buildCorrectionDocument(
        plan(),
        {
          deterministic: [
            { code: "section_count", message: "chapter_01" },
            { code: "schema_version", message: "writer schema_version must be 0.7.0" },
          ],
        },
        2,
      );
      const byCode = new Map(document.items.map((i) => [i.code, i]));
      expect(byCode.get("section_count")?.target_key).toBe("chapter_01");
      expect(byCode.get("schema_version")?.target_key).toBeNull();
    });

    it("drops a finding whose code is prose rather than a code", () => {
      const document = buildCorrectionDocument(
        plan(),
        { deterministic: [{ code: `${PROSE} not a code at all`, message: "chapter_01" }] },
        2,
      );
      expect(document.items).toHaveLength(0);
      expect(JSON.stringify(document)).not.toContain(PROSE);
    });

    it("drops a target key that is not a chapter, section, or signature key", () => {
      const document = buildCorrectionDocument(
        plan(),
        {
          semantic: [
            {
              code: "one_sided_labeling",
              severity: "error",
              target_key: `${PROSE} smuggled through target_key`,
              feature_aliases: [],
              ontology_rule_ids: [],
              rationale: "",
            },
          ],
        },
        2,
      );
      expect(document.items[0]?.target_key).toBeNull();
      expect(JSON.stringify(document)).not.toContain(PROSE);
    });

    it("states what the writer must preserve, derived from the frozen plan", () => {
      const withSignature = plan();
      withSignature.additional_signatures.push({
        signature_key: "signature_01",
        working_title: "A signature",
        feature_aliases: ["f002"],
        ontology_rule_ids: ["ont.sun.aries"],
      });
      withSignature.omissions.push({
        feature_alias: "f009",
        reason: "capacity_omitted",
        covered_by: null,
      });

      const document = buildCorrectionDocument(withSignature, { deterministic: [] }, 3);
      expect(document.preserve.plan_hash).toBe(withSignature.plan_hash);
      expect(document.preserve.chapter_keys).toEqual(["chapter_01"]);
      expect(document.preserve.signature_keys).toEqual(["signature_01"]);
      expect(document.preserve.omitted_feature_aliases).toEqual(["f009"]);
      expect(document.preserve.authorized_ontology_rule_ids).toContain("ont.sun.aries");
      expect(document.attempt).toBe(3);
    });

    it("survives into a writer document with the plan and assignments unchanged", () => {
      const correction = buildCorrectionDocument(
        plan(),
        {
          semantic: [
            {
              code: "possibility_stated_as_certainty",
              severity: "error",
              target_key: "chapter_01",
              feature_aliases: ["f001"],
              ontology_rule_ids: ["ont.sun.aries"],
              rationale: `${PROSE} rationale`,
            },
          ],
        },
        2,
      );

      const plain = buildWriterInput(plan(), packet(), records(), PATTERN_PACKET_LIMITS_DEFAULT);
      const corrected = buildWriterInput(
        plan(),
        packet(),
        records(),
        PATTERN_PACKET_LIMITS_DEFAULT,
        correction,
      );
      expect(plain.ok && corrected.ok).toBe(true);
      if (!plain.ok || !corrected.ok) return;

      // The frozen plan and the evidence assignments are carried through
      // byte-identically; only the correction is added.
      expect(corrected.document.plan).toEqual(plain.document.plan);
      expect(corrected.document.assignments).toEqual(plain.document.assignments);
      expect(corrected.document.correction).toEqual(correction);
      expect(corrected.serialized).not.toContain(PROSE);
    });

    it("never echoes the rejected candidate into the rebuilt writer document", () => {
      // The whole point of the correction path: the writer is told what was
      // wrong, never shown the prose that was wrong.
      const rejected = rejectedCandidate();
      const correction = buildCorrectionDocument(
        plan(),
        {
          semantic: [
            {
              code: "voice_boundary_exceeded",
              severity: "error",
              target_key: rejected.chapters[0]!.sections[0]!.section_key,
              feature_aliases: [],
              ontology_rule_ids: [],
              rationale: rejected.chapters[0]!.sections[0]!.text,
            },
          ],
        },
        2,
      );
      const result = buildWriterInput(
        plan(),
        packet(),
        records(),
        PATTERN_PACKET_LIMITS_DEFAULT,
        correction,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.serialized).not.toContain(PROSE);
      // The section key it points at does survive -- that is the whole signal.
      expect(result.serialized).toContain("chapter_01_section_01");
    });
  });
});
