/**
 * The three provider-visible input documents: planner, writer, and verifier.
 *
 * Every document is assembled from an EXPLICIT ALLOWLIST of keys, copied field
 * by field into a fresh object. Never spread, never pass through. TypeScript's
 * excess-property check fires only on fresh object literals, so a *variable* of
 * a wider type — the whole `PatternSelectionResult`, with its `aliasMap` — is
 * assignable to a narrow parameter and carries its extra fields straight into
 * `JSON.stringify`. `PatternFactPacketFeature.fact` is additionally an open
 * `Record<string, unknown>`, and the M7 contract types it as a bare
 * `{"type": "object"}`, so no schema catches a forbidden key inside a fact.
 *
 * Narrow parameter types stay because they catch the easy mistakes at compile
 * time, but the guarantee is the runtime pair: allowlist construction, then a
 * post-serialisation walk that rejects anything outside it. A builder that
 * correctly omits leaves the walk nothing to catch, which is why both are
 * tested separately.
 *
 * The model receives no chart identifier, fingerprint, birth value, consent id,
 * user id, source-fragment text or id, previous Pattern, or personal context.
 */

import type {
  PatternFactPacket,
  PatternFactPacketFeature,
  PatternOntologyRecord,
  PatternPlan,
  PatternWriterOutput,
} from "@patternlike/shared";

/**
 * Mirrors `FORBIDDEN_IN_PATTERN_PACKET_KEYS` in `contracts/validate_schemas.py`
 * (17 members), which is the normative list.
 *
 * `chart_fingerprint_hash` is added deliberately. The Python check matches
 * naively on the substring `"<key>` over `json.dumps`, so `"chart_fingerprint`
 * is a prefix of `"chart_fingerprint_hash"` and catches it for free. This walk
 * compares whole keys, which loses that — and
 * `GeneratePatternCommandV1.chart_fingerprint_hash` is a real field one refactor
 * away from a packet.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
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
  "check_ins",
  "journal",
  "life_event",
  "life_events",
  "reading",
  "readings",
  "daily_reading",
  "latitude",
  // Not in the Python list because a fact packet has no alias map; forbidden
  // here because these builders are handed objects that do.
  "aliasMap",
  "alias_map",
]);

/**
 * Every id prefix minted anywhere in the system.
 *
 * Enumerated from `newId(...)` call sites rather than from the handful that
 * looked reachable: a value carrying any of these has escaped the alias
 * indirection, which is the whole point of `aliasMap`, and "reachable today" is
 * not a property this list should depend on. `cht_` (chart) and `cns_` (consent)
 * were the two the module header already promised to exclude while the list
 * omitted them.
 *
 * Matched as a SUBSTRING, not a prefix. `contracts/validate_schemas.py:840`
 * scans `if prefix in encoded` over the serialized document, and an anchored
 * check misses every id embedded mid-sentence — which is exactly where one would
 * appear, since ontology prose, working titles, purposes, and section text all
 * travel verbatim. A single leading space defeated the anchored form.
 *
 * A false positive here is a terminal refusal an operator can see. That is the
 * correct direction to fail for a privacy boundary.
 */
const FORBIDDEN_VALUE_PREFIXES: readonly string[] = [
  "asp_",
  "aud_",
  "cht_",
  "clm_",
  "cns_",
  "cs_",
  "csr_",
  "cyc_",
  "cyp_",
  "del_",
  "dsf_",
  "evt_",
  "exp_",
  "gen_",
  "idn_",
  "job_",
  "nft_",
  "paae_",
  "par_",
  "pat_",
  "pgc_",
  "pgen_",
  "prel_",
  "rdg_",
  "req_",
  "rfb_",
  "rsc_",
  "ses_",
  "sig_",
  "trc_",
  "tts_",
  "tzc_",
  "usr_",
];

/**
 * Every key legal at any depth of any of the three documents.
 *
 * A flat name set rather than a path grammar: the documents nest packet
 * features, ontology records, plan chapters, and writer chapters, and a path
 * grammar over four recursive shapes is a second contract to keep in step. A
 * name that appears nowhere in those shapes is rejected wherever it appears.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // envelope
  "schema_version",
  "pass",
  "packet",
  "plan",
  "candidate",
  "facts",
  "ontology_records",
  "derived_synthesis_graph",
  "uncertainty",
  "assignments",
  "signature_assignments",
  "correction",
  "attempt",
  "items",
  "code",
  "origin",
  "target_key",
  "preserve",
  "chapter_keys",
  "signature_keys",
  "omitted_feature_aliases",
  "authorized_ontology_rule_ids",
  "bounds",
  "locale",
  "effective_accuracy",
  // packet
  "features",
  "clusters",
  "selection_constraints",
  "suppressed_classes",
  "required_language_rule_ids",
  "alias",
  "feature_class",
  "fact",
  "coverage",
  "ontology_rule_ids",
  "cluster_ids",
  "cluster_id",
  "feature_aliases",
  "compatible_with",
  "core_chapters_min",
  "core_chapters_max",
  "additional_signatures_max",
  "sparse_pattern",
  // feature fact shapes, one per NatalFeatureClass
  "body",
  "longitude",
  "sign",
  "house",
  "body_a",
  "body_b",
  "aspect",
  "orb",
  "pattern",
  "member_bodies",
  "angle",
  "accuracy",
  "suppressed_features",
  // ontology record
  "id",
  "meaning_class",
  "feature_predicate",
  "normalized_proposition",
  "input_meaning_ids",
  "transformation_class",
  "tensions",
  "counter_expressions",
  "prohibited_claims",
  "salience_band",
  "presentation_priority",
  "cluster_tags",
  "type",
  // plan
  "plan_hash",
  "chapters",
  "additional_signatures",
  "omissions",
  "chapter_key",
  "working_title",
  "purpose",
  "derived_synthesis_ids",
  "required_tension_ids",
  "required_resource_ids",
  "required_counter_expression_ids",
  "signature_key",
  "feature_alias",
  "reason",
  "covered_by",
  // writer candidate
  "title",
  "summary",
  "sections",
  "section_key",
  "text",
  "claim_class",
  "resources",
  "counter_expression",
  "uncertainty_note",
  // derived-synthesis graph
  "node",
  "inputs",
  // writer bounds
  "sections_min",
  "sections_max",
  "chapter_word_min",
  "chapter_word_max",
  "signature_word_min",
  "signature_word_max",
  "uncertainty_word_min",
  "uncertainty_word_max",
  "paragraph_word_max",
  "title_char_max",
  "total_word_min",
  "total_word_max",
]);

export type PatternPacketRefusalCode =
  | "pattern_input_forbidden_key"
  | "pattern_input_too_large";

/**
 * A refusal is terminal and happens before any fetch, so it consumes no budget.
 * `key` is safe to carry: it is a name drawn from a closed list, never a value.
 */
export type PatternPacketResult<T> =
  | { ok: true; document: T; serialized: string; bytes: number }
  | { ok: false; code: PatternPacketRefusalCode; key?: string };

/**
 * Section and word bounds and the byte cap.
 *
 * Passed in rather than imported. Task 2's builders take "the fact packet, the
 * frozen plan, the authorized ontology records, and nothing else", while the
 * design compares the serialized document against `pin.input_max_bytes`; an
 * explicit limits parameter satisfies both without the builder reaching into a
 * wide config object or `env`. It also breaks what would otherwise be an import
 * cycle: `pattern-publisher.ts` will import the document types from here, so
 * importing its compiled constants back would close the loop.
 *
 * The word bounds live in `packages/pattern-engine/src/policy.ts`, which the
 * package barrel does not re-export and whose `exports` map blocks deep imports.
 * Whoever wires this up owns that decision; the builders only need the numbers.
 */
export interface PatternPacketLimits {
  maxBytes: number;
  bounds: {
    sections_min: number;
    sections_max: number;
    chapter_word_min: number;
    chapter_word_max: number;
    signature_word_min: number;
    signature_word_max: number;
    uncertainty_word_min: number;
    uncertainty_word_max: number;
    paragraph_word_max: number;
    title_char_max: number;
    total_word_min: number;
    total_word_max: number;
  };
}

/**
 * `PATTERN_INPUT_MAX_BYTES` and the pattern-engine policy numbers, restated.
 *
 * Restated rather than imported for the cycle reason above. The pin check in
 * `resolvePatternPublisherConfiguration` compares the deployed variable against
 * the compiled constant, so a drift between the two surfaces as a configuration
 * refusal rather than as a silently different bound.
 */
export const PATTERN_PACKET_LIMITS_DEFAULT: PatternPacketLimits = {
  maxBytes: 98_304,
  bounds: {
    sections_min: 2,
    sections_max: 6,
    chapter_word_min: 250,
    chapter_word_max: 550,
    signature_word_min: 70,
    signature_word_max: 160,
    uncertainty_word_min: 40,
    uncertainty_word_max: 140,
    paragraph_word_max: 180,
    title_char_max: 90,
    total_word_min: 1500,
    total_word_max: 4500,
  },
};

// ---------------------------------------------------------------------------
// Document shapes
//
// None of the three has a frozen contract: `contracts/m7` reserves the artifact
// classes `planner_request`, `writer_request`, and `verifier_request` in
// `common.schema.json`, but no request document schema exists. These interfaces
// are therefore the definition, derived from the design's three bullets.
// ---------------------------------------------------------------------------

export type PatternPass = "planner" | "writer" | "verifier";

export interface PatternPlannerInput {
  schema_version: "0.7.0";
  pass: "planner";
  packet: PatternFactPacket;
  ontology_records: PatternOntologyRecord[];
}

export interface PatternWriterInput {
  schema_version: "0.7.0";
  pass: "writer";
  plan: PatternPlan;
  assignments: PatternWriterAssignment[];
  signature_assignments: PatternWriterSignatureAssignment[];
  ontology_records: PatternOntologyRecord[];
  locale: string;
  effective_accuracy: string;
  uncertainty: { suppressed_classes: string[]; required_language_rule_ids: string[] };
  bounds: PatternPacketLimits["bounds"];
  /** Present only on a retry against the same frozen plan (section 13.5). */
  correction?: PatternCorrectionDocument;
}

/** One plan unit's aliases and the normalized facts behind them. */
export interface PatternWriterAssignment {
  chapter_key: string;
  feature_aliases: string[];
  facts: PatternNormalizedFact[];
  ontology_rule_ids: string[];
  derived_synthesis_ids: string[];
  required_tension_ids: string[];
  required_resource_ids: string[];
  required_counter_expression_ids: string[];
}

/** One additional-signature plan unit's aliases and the facts behind them. */
export interface PatternWriterSignatureAssignment {
  signature_key: string;
  feature_aliases: string[];
  facts: PatternNormalizedFact[];
  ontology_rule_ids: string[];
}

export interface PatternNormalizedFact {
  alias: string;
  feature_class: string;
  fact: Record<string, unknown>;
}

export interface PatternVerifierInput {
  schema_version: "0.7.0";
  pass: "verifier";
  candidate: PatternWriterOutput;
  plan: PatternPlan;
  facts: PatternNormalizedFact[];
  ontology_records: PatternOntologyRecord[];
  derived_synthesis_graph: PatternDerivedSynthesisEdge[];
  uncertainty: { suppressed_classes: string[]; required_language_rule_ids: string[] };
}

/** One derived-synthesis record and the meanings it is derived from. */
export interface PatternDerivedSynthesisEdge {
  node: string;
  inputs: string[];
}

// ---------------------------------------------------------------------------
// Allowlist copying
// ---------------------------------------------------------------------------

/**
 * A fact object reduced to the keys its feature class actually defines.
 *
 * `fact` is the one open type inside the packet, so it is rebuilt rather than
 * carried: an unknown key here is the most likely way a private value reaches
 * the provider, and the post-serialisation walk would only catch names it
 * already knows.
 */
function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * A fact value is a scalar or an array of scalars. Anything else is dropped.
 *
 * Every real shape `featureFact` produces is exactly that — `member_bodies` and
 * `suppressed_features` are string arrays, the rest are scalars — so nothing
 * legitimate is lost. Copying the top level only would let an object nested
 * under an allowed key travel whole, and the flat key allowlist would then be
 * the only thing between it and the provider: it contains generic names like
 * `id`, `title`, `text`, and `reason` that are legal elsewhere in the document
 * and would be accepted at that depth too.
 */
function copyFactValue(value: unknown): unknown | undefined {
  if (isScalar(value)) return value;
  if (Array.isArray(value) && value.every(isScalar)) return [...value];
  return undefined;
}

function copyFact(fact: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "body",
    "longitude",
    "sign",
    "house",
    "body_a",
    "body_b",
    "aspect",
    "orb",
    "pattern",
    "member_bodies",
    "angle",
    "accuracy",
    "suppressed_features",
  ]) {
    if (!Object.hasOwn(fact, key)) continue;
    const value = copyFactValue(fact[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function copyFeature(feature: PatternFactPacketFeature) {
  return {
    alias: feature.alias,
    feature_class: feature.feature_class,
    fact: copyFact(feature.fact),
    coverage: feature.coverage,
    ontology_rule_ids: [...feature.ontology_rule_ids],
    cluster_ids: [...feature.cluster_ids],
  };
}

function copyPacket(packet: PatternFactPacket): PatternFactPacket {
  const copied = {
    schema_version: packet.schema_version,
    locale: packet.locale,
    effective_accuracy: packet.effective_accuracy,
    uncertainty: {
      suppressed_classes: [...packet.uncertainty.suppressed_classes],
      required_language_rule_ids: [...packet.uncertainty.required_language_rule_ids],
    },
    features: packet.features.map(copyFeature),
    ...(packet.clusters
      ? {
          clusters: packet.clusters.map((cluster) => ({
            cluster_id: cluster.cluster_id,
            feature_aliases: [...cluster.feature_aliases],
            compatible_with: [...cluster.compatible_with],
          })),
        }
      : {}),
    selection_constraints: {
      core_chapters_min: packet.selection_constraints.core_chapters_min,
      core_chapters_max: packet.selection_constraints.core_chapters_max,
      additional_signatures_max: packet.selection_constraints.additional_signatures_max,
      sparse_pattern: packet.selection_constraints.sparse_pattern,
    },
  };
  return copied as PatternFactPacket;
}

/**
 * An ontology record without `source_fragment_ids`.
 *
 * The raw corpus is out of scope for every pass, and the fragment ids are the
 * handle onto it. Dropping them costs the model nothing — it cannot dereference
 * them — and removes the only field that points outside the release.
 */
function copyRecord(record: PatternOntologyRecord) {
  return {
    id: record.id,
    meaning_class: record.meaning_class,
    locale: record.locale,
    feature_predicate: copyPredicate(record.feature_predicate),
    normalized_proposition: record.normalized_proposition,
    input_meaning_ids: [...record.input_meaning_ids],
    transformation_class: record.transformation_class,
    tensions: [...record.tensions],
    counter_expressions: [...record.counter_expressions],
    prohibited_claims: [...record.prohibited_claims],
    salience_band: record.salience_band,
    presentation_priority: record.presentation_priority,
    cluster_tags: [...record.cluster_tags],
  } as PatternOntologyRecord;
}

function copyPredicate(
  predicate: PatternOntologyRecord["feature_predicate"],
): PatternOntologyRecord["feature_predicate"] {
  const out: Record<string, unknown> = { type: predicate.type };
  for (const key of ["body", "body_a", "body_b", "aspect", "pattern", "angle", "house", "accuracy"]) {
    const value = (predicate as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as PatternOntologyRecord["feature_predicate"];
}

function copyPlan(plan: PatternPlan): PatternPlan {
  return {
    schema_version: plan.schema_version,
    plan_hash: plan.plan_hash,
    sparse_pattern: plan.sparse_pattern,
    chapters: plan.chapters.map((chapter) => ({
      chapter_key: chapter.chapter_key,
      working_title: chapter.working_title,
      purpose: chapter.purpose,
      feature_aliases: [...chapter.feature_aliases],
      ontology_rule_ids: [...chapter.ontology_rule_ids],
      derived_synthesis_ids: [...chapter.derived_synthesis_ids],
      required_tension_ids: [...chapter.required_tension_ids],
      required_resource_ids: [...chapter.required_resource_ids],
      required_counter_expression_ids: [...chapter.required_counter_expression_ids],
    })),
    additional_signatures: plan.additional_signatures.map((signature) => ({
      signature_key: signature.signature_key,
      working_title: signature.working_title,
      feature_aliases: [...signature.feature_aliases],
      ontology_rule_ids: [...signature.ontology_rule_ids],
    })),
    omissions: plan.omissions.map((omission) => ({
      feature_alias: omission.feature_alias,
      reason: omission.reason,
      covered_by: omission.covered_by,
    })),
  };
}

function copyCandidate(candidate: PatternWriterOutput): PatternWriterOutput {
  const proseUnit = (unit: PatternWriterOutput["chapters"][number]["tensions"][number]) => ({
    text: unit.text,
    claim_class: unit.claim_class,
    feature_aliases: [...unit.feature_aliases],
    ontology_rule_ids: [...unit.ontology_rule_ids],
    derived_synthesis_ids: [...unit.derived_synthesis_ids],
  });
  return {
    schema_version: candidate.schema_version,
    title: candidate.title,
    chapters: candidate.chapters.map((chapter) => ({
      chapter_key: chapter.chapter_key,
      title: chapter.title,
      summary: chapter.summary,
      sections: chapter.sections.map((section) => ({
        section_key: section.section_key,
        text: section.text,
        claim_class: section.claim_class,
        feature_aliases: [...section.feature_aliases],
        ontology_rule_ids: [...section.ontology_rule_ids],
        derived_synthesis_ids: [...section.derived_synthesis_ids],
      })),
      tensions: chapter.tensions.map(proseUnit),
      resources: chapter.resources.map(proseUnit),
      counter_expression: proseUnit(chapter.counter_expression),
    })),
    additional_signatures: candidate.additional_signatures.map((signature) => ({
      signature_key: signature.signature_key,
      title: signature.title,
      text: signature.text,
      feature_aliases: [...signature.feature_aliases],
      ontology_rule_ids: [...signature.ontology_rule_ids],
    })),
    uncertainty_note: candidate.uncertainty_note
      ? proseUnit(candidate.uncertainty_note)
      : null,
  };
}

function normalizedFacts(
  packet: PatternFactPacket,
  aliases: ReadonlySet<string> | null,
): PatternNormalizedFact[] {
  return packet.features
    .filter((feature) => aliases === null || aliases.has(feature.alias))
    .map((feature) => ({
      alias: feature.alias,
      feature_class: feature.feature_class,
      fact: copyFact(feature.fact),
    }));
}

// ---------------------------------------------------------------------------
// Post-serialisation walk
// ---------------------------------------------------------------------------

/**
 * Whether a `longitude` key is the one calculated longitude that may travel.
 *
 * The normative rule in `contracts/validate_schemas.py` is written for a bare
 * fact packet, where the exempt path is exactly `features[i].fact.longitude` —
 * four segments. These documents WRAP the packet, so a literal port of the
 * length check would reject every position, angle, and house_cusp feature and
 * fail the whole planner document. The rule is therefore expressed as a suffix,
 * anchored on the packet root wherever it sits.
 */
function isAllowedLongitude(path: readonly (string | number)[]): boolean {
  const n = path.length;
  if (n < 4) return false;
  return (
    path[n - 1] === "longitude" &&
    path[n - 2] === "fact" &&
    typeof path[n - 3] === "number" &&
    (path[n - 4] === "features" || path[n - 4] === "facts")
  );
}

/**
 * Exported so it can be proved against an already-poisoned document.
 *
 * The builders copy from an allowlist, so they omit rather than reject — which
 * leaves this walk nothing to catch when it is driven through them. It is the
 * second line, and a second line that is only ever exercised through a correct
 * first line is not tested at all.
 */
export function findPatternInputViolation(
  document: unknown,
): { code: PatternPacketRefusalCode; key: string } | null {
  return walk(document, []);
}

function walk(
  value: unknown,
  path: readonly (string | number)[],
): { code: PatternPacketRefusalCode; key: string } | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = walk(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "string") {
    for (const prefix of FORBIDDEN_VALUE_PREFIXES) {
      // Substring, not prefix. An id embedded in prose is the likely case, and
      // free text reaches here verbatim from ontology propositions, working
      // titles, purposes, chapter titles, summaries, and section prose.
      if (value.includes(prefix)) {
        return { code: "pattern_input_forbidden_key", key: prefix };
      }
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (key === "longitude") {
      if (!isAllowedLongitude(childPath)) {
        return { code: "pattern_input_forbidden_key", key };
      }
    } else if (FORBIDDEN_KEYS.has(key) || !ALLOWED_KEYS.has(key)) {
      return { code: "pattern_input_forbidden_key", key };
    }
    const found = walk(child, childPath);
    if (found) return found;
  }
  return null;
}

/**
 * Serialize, walk, and measure — in that order.
 *
 * The bytes measured are the bytes sent. The M5 analogue measures a canonical
 * form and sends `JSON.stringify` of a different one; measuring a document you
 * do not send means the cap bounds nothing you can point at.
 */
function finish<T>(document: T, limits: PatternPacketLimits): PatternPacketResult<T> {
  // Serialize FIRST, then walk what serialization produced.
  //
  // This is a post-serialisation walk, and the ordering is the whole point: a
  // value carrying `toJSON` — a Date, or any class instance whose `toJSON` sits
  // on the prototype — presents no own enumerable keys to `Object.entries`, so a
  // walk over the live object graph inspects nothing while `JSON.stringify`
  // sends whatever `toJSON` returned. Checking bytes that are not the bytes sent
  // is not a check.
  const serialized = JSON.stringify(document);

  const offender = findPatternInputViolation(JSON.parse(serialized) as unknown);
  if (offender) return { ok: false, code: offender.code, key: offender.key };

  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > limits.maxBytes) return { ok: false, code: "pattern_input_too_large" };

  return { ok: true, document, serialized, bytes };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Writer correction document
// ---------------------------------------------------------------------------

/**
 * A code, not a sentence. Bounded to the contract's 64-character finding cap.
 *
 * Shape-checked rather than trusted because the two sources disagree about what
 * they carry: a semantic finding's `code` is a member of the closed vocabulary,
 * but a deterministic `ValidationFailure` is `{code, message}` where `message`
 * is sometimes a chapter key and sometimes an explanatory sentence. A value that
 * does not look like a code cannot be actioned by the writer anyway, so it is
 * dropped rather than forwarded.
 */
const CORRECTION_CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;

/** `chapter_01`, `chapter_01_section_02`, or `signature_01`. Nothing else. */
const CORRECTION_KEY_SHAPE = /^(chapter_\d{2}(_section_\d{2})?|signature_\d{2})$/;

/** `f001`. The alias grammar the selector mints. */
const CORRECTION_ALIAS_SHAPE = /^f\d{3}$/;

export interface PatternCorrectionItem {
  code: string;
  origin: "deterministic" | "semantic";
  target_key: string | null;
  feature_aliases: string[];
  ontology_rule_ids: string[];
}

/**
 * What the writer is told about a rejected attempt.
 *
 * Section 13.5: finding codes, affected chapter and section keys, the policy
 * rule violated, and the instruction to preserve the frozen plan and evidence
 * assignments. `preserve` is that instruction made checkable rather than
 * phrased — chapter membership, chapter count, omitted features, and ontology
 * authorization are exactly what the writer may not change.
 *
 * Rejected prose is never echoed here, and neither is the verifier's rationale,
 * which is prose about prose.
 */
export interface PatternCorrectionDocument {
  schema_version: "0.7.0";
  attempt: number;
  items: PatternCorrectionItem[];
  preserve: {
    plan_hash: string;
    chapter_keys: string[];
    signature_keys: string[];
    omitted_feature_aliases: string[];
    authorized_ontology_rule_ids: string[];
  };
}

/** A deterministic candidate-validation failure, structurally. */
export interface PatternDeterministicFailure {
  code: string;
  message: string;
}

/** A semantic verdict finding, structurally. `rationale` is read and discarded. */
export interface PatternSemanticFindingInput {
  code: string;
  severity?: string;
  target_key?: string | null;
  feature_aliases?: readonly string[];
  ontology_rule_ids?: readonly string[];
  rationale?: string;
}

function safeKey(value: unknown): string | null {
  return typeof value === "string" && CORRECTION_KEY_SHAPE.test(value) ? value : null;
}

function safeAliases(values: readonly string[] | undefined): string[] {
  return (values ?? []).filter((value) => CORRECTION_ALIAS_SHAPE.test(value));
}

/**
 * Build the closed correction document for the next writer attempt.
 *
 * Every field is either a shape-checked code, a shape-checked key, or an id the
 * writer already holds. Nothing is copied from the rejected candidate, and the
 * only text-bearing fields on the inputs — `message` and `rationale` — are read
 * for a key and otherwise discarded.
 */
export function buildCorrectionDocument(
  plan: PatternPlan,
  rejection: {
    deterministic?: readonly PatternDeterministicFailure[];
    semantic?: readonly PatternSemanticFindingInput[];
  },
  attempt: number,
): PatternCorrectionDocument {
  const items: PatternCorrectionItem[] = [];
  const authorizedOntologyRuleIds = citedRuleIds(plan);

  for (const failure of rejection.deterministic ?? []) {
    if (!CORRECTION_CODE_SHAPE.test(failure.code)) continue;
    items.push({
      code: failure.code,
      origin: "deterministic",
      // The validator puts a chapter key in `message` for keyed failures and an
      // explanatory sentence for the rest. Reading it as a key recovers the
      // signal without ever letting the sentence through.
      target_key: safeKey(failure.message),
      feature_aliases: [],
      ontology_rule_ids: [],
    });
  }

  for (const finding of rejection.semantic ?? []) {
    if (!CORRECTION_CODE_SHAPE.test(finding.code)) continue;
    items.push({
      code: finding.code,
      origin: "semantic",
      target_key: safeKey(finding.target_key),
      feature_aliases: safeAliases(finding.feature_aliases),
      ontology_rule_ids: (finding.ontology_rule_ids ?? []).filter((id) =>
        authorizedOntologyRuleIds.has(id),
      ),
    });
  }

  return {
    schema_version: "0.7.0",
    attempt,
    items,
    preserve: {
      plan_hash: plan.plan_hash,
      chapter_keys: plan.chapters.map((chapter) => chapter.chapter_key),
      signature_keys: plan.additional_signatures.map((signature) => signature.signature_key),
      omitted_feature_aliases: plan.omissions.map((omission) => omission.feature_alias),
      authorized_ontology_rule_ids: [...authorizedOntologyRuleIds],
    },
  };
}

/** Every ontology rule id the frozen plan cites, across chapters and signatures. */
function citedRuleIds(plan: PatternPlan): Set<string> {
  const ids = new Set<string>();
  for (const chapter of plan.chapters) {
    for (const id of chapter.ontology_rule_ids) ids.add(id);
  }
  for (const signature of plan.additional_signatures) {
    for (const id of signature.ontology_rule_ids) ids.add(id);
  }
  return ids;
}

/**
 * The packet as the selector produced it, plus the records its aliases activated.
 *
 * The planner sees only eligible features and the closed omission counts plan
 * validation needs; `redundant`, `suppressed`, `ontology_unsupported`, and
 * `capacity_omitted` never enter a packet, so no filtering is required here.
 */
export function buildPlannerInput(
  packet: PatternFactPacket,
  ontologyRecords: readonly PatternOntologyRecord[],
  limits: PatternPacketLimits,
): PatternPacketResult<PatternPlannerInput> {
  return finish(
    {
      schema_version: "0.7.0",
      pass: "planner",
      packet: copyPacket(packet),
      ontology_records: ontologyRecords.map(copyRecord),
    } satisfies PatternPlannerInput,
    limits,
  );
}

/**
 * The frozen plan, the facts assigned to each of its units, and the bounds.
 *
 * Unassigned and omitted features do not travel: an alias the plan never names
 * is an alias the writer must not write about, and sending it invites exactly
 * that. The correction path (Task 3a) adds structured codes to this document
 * and nothing else — never rejected prose.
 */
export function buildWriterInput(
  plan: PatternPlan,
  packet: PatternFactPacket,
  ontologyRecords: readonly PatternOntologyRecord[],
  limits: PatternPacketLimits,
  correction?: PatternCorrectionDocument,
): PatternPacketResult<PatternWriterInput> {
  const authorizedRuleIds = citedRuleIds(plan);
  // The uncertainty rules are ontology rule ids too, and a valid plan need never
  // cite them: they come from the packet's uncertainty features, not from a
  // chapter. Filtering by cited ids alone therefore drops the records the writer
  // is required to honour, and the policy line asking it to honour them would
  // point at nothing.
  for (const id of packet.uncertainty.required_language_rule_ids) authorizedRuleIds.add(id);

  // Facts are filtered per unit by that unit's aliases, so an alias the plan
  // never assigns has no route into the document.
  const assignments: PatternWriterAssignment[] = plan.chapters.map((chapter) => ({
    chapter_key: chapter.chapter_key,
    feature_aliases: [...chapter.feature_aliases],
    facts: normalizedFacts(packet, new Set(chapter.feature_aliases)),
    ontology_rule_ids: [...chapter.ontology_rule_ids],
    derived_synthesis_ids: [...chapter.derived_synthesis_ids],
    required_tension_ids: [...chapter.required_tension_ids],
    required_resource_ids: [...chapter.required_resource_ids],
    required_counter_expression_ids: [...chapter.required_counter_expression_ids],
  }));

  // Signatures are plan units too. Without these, an alias assigned only to an
  // additional signature has no facts anywhere in the document, and the writer
  // is asked to write a signature about a feature it cannot see.
  const signature_assignments: PatternWriterSignatureAssignment[] =
    plan.additional_signatures.map((signature) => ({
      signature_key: signature.signature_key,
      feature_aliases: [...signature.feature_aliases],
      facts: normalizedFacts(packet, new Set(signature.feature_aliases)),
      ontology_rule_ids: [...signature.ontology_rule_ids],
    }));

  return finish(
    {
      schema_version: "0.7.0",
      pass: "writer",
      plan: copyPlan(plan),
      assignments,
      signature_assignments,
      ontology_records: ontologyRecords
        .filter((record) => authorizedRuleIds.has(record.id))
        .map(copyRecord),
      locale: packet.locale,
      effective_accuracy: packet.effective_accuracy,
      uncertainty: {
        suppressed_classes: [...packet.uncertainty.suppressed_classes],
        required_language_rule_ids: [...packet.uncertainty.required_language_rule_ids],
      },
      bounds: { ...limits.bounds },
      ...(correction ? { correction } : {}),
    } satisfies PatternWriterInput,
    limits,
  );
}

/**
 * Six items, per the design's builder bullet.
 *
 * Section 14.1 enumerates seven, the seventh being the strict verdict schema —
 * which rides `text.format.schema` on the request rather than the document, so
 * the verifier still receives all seven. It never receives the raw corpus, the
 * writer's rejected candidates, the writer's correction documents, or the
 * planner's prompt or rejected attempts.
 */
export function buildVerifierInput(
  candidate: PatternWriterOutput,
  plan: PatternPlan,
  packet: PatternFactPacket,
  ontologyRecords: readonly PatternOntologyRecord[],
  limits: PatternPacketLimits,
): PatternPacketResult<PatternVerifierInput> {
  const authorizedRuleIds = citedRuleIds(plan);
  for (const id of packet.uncertainty.required_language_rule_ids) authorizedRuleIds.add(id);

  const byId = new Map(ontologyRecords.map((record) => [record.id, record]));

  // Close over `input_meaning_ids`. Section 14.4 asks the verifier whether "a
  // derived synthesis exceeds its dependencies", which it cannot judge against a
  // dependency it was not shown — and a plan is valid citing only the synthesis,
  // not its inputs, so the cited set alone leaves those edges dangling.
  //
  // This widens what the verifier SEES, never what the writer may CITE. Citation
  // authority stays with the plan, which is why the same closure is not applied
  // to the writer document.
  const closed = new Set(authorizedRuleIds);
  const queue = [...closed];
  while (queue.length > 0) {
    const record = byId.get(queue.shift()!);
    if (!record) continue;
    for (const input of record.input_meaning_ids) {
      if (!closed.has(input)) {
        closed.add(input);
        queue.push(input);
      }
    }
  }

  const authorized = ontologyRecords.filter((record) => closed.has(record.id));

  // The dependency graph is the derived-synthesis records and the meanings they
  // are derived from. No named type exists for it anywhere; this edge list is
  // the definition, and it carries ids only.
  const graph: PatternDerivedSynthesisEdge[] = authorized
    .filter((record) => record.meaning_class === "derived_synthesis")
    .map((record) => ({ node: record.id, inputs: [...record.input_meaning_ids] }));

  const assignedAliases = new Set<string>();
  for (const chapter of plan.chapters) {
    for (const alias of chapter.feature_aliases) assignedAliases.add(alias);
  }
  for (const signature of plan.additional_signatures) {
    for (const alias of signature.feature_aliases) assignedAliases.add(alias);
  }

  return finish(
    {
      schema_version: "0.7.0",
      pass: "verifier",
      candidate: copyCandidate(candidate),
      plan: copyPlan(plan),
      facts: normalizedFacts(packet, assignedAliases),
      ontology_records: authorized.map(copyRecord),
      derived_synthesis_graph: graph,
      uncertainty: {
        suppressed_classes: [...packet.uncertainty.suppressed_classes],
        required_language_rule_ids: [...packet.uncertainty.required_language_rule_ids],
      },
    } satisfies PatternVerifierInput,
    limits,
  );
}
