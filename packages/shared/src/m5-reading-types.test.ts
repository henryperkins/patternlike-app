import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  AI_CONSENT_DATA_CATEGORIES,
  GENERATED_PARAGRAPH_ROLES,
  M5_ASSEMBLY_MODE,
  M5_OUTPUT_SCHEMA,
  M5_SCHEMA_VERSION,
  M5_SUPPORTED_USES,
  PARAGRAPH_ROLES_V5,
  isM5SupportedUse,
  type DailyReadingV5,
  type ReadingEvidenceV5,
  type ReadingGenerationOutput,
  type ReadingGenerationRequest,
} from "./m5-reading-types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(here, "../../../contracts/m5");
const M0_COMMON = path.resolve(here, "../../../contracts/m0/common.schema.json");

const schema = (name: string): any =>
  JSON.parse(readFileSync(path.join(CONTRACTS, name), "utf8"));
const fixture = (rel: string): any =>
  JSON.parse(readFileSync(path.join(CONTRACTS, "fixtures", rel), "utf8"));

test("the package constants match the contract package", () => {
  assert.equal(M5_SCHEMA_VERSION, "0.5.0");
  assert.equal(M5_OUTPUT_SCHEMA, "daily-reading-v5");
  assert.equal(M5_ASSEMBLY_MODE, "constrained_model");

  const common = schema("common.schema.json");
  assert.equal(common.$defs.schemaVersion.const, M5_SCHEMA_VERSION);
  assert.equal(common.$defs.outputSchemaName.const, M5_OUTPUT_SCHEMA);
  assert.equal(common.$defs.assemblyMode.const, M5_ASSEMBLY_MODE);
});

test("the AI consent categories are the contract enum, in display order", () => {
  const common = schema("common.schema.json");
  assert.deepEqual([...AI_CONSENT_DATA_CATEGORIES], common.$defs.aiConsentDataCategory.enum);
  assert.equal(AI_CONSENT_DATA_CATEGORIES.length, 7);
  // Order is load-bearing: a consent screen that reorders its own categories
  // between a grant and a later read cannot prove what the user agreed to.
  assert.equal(AI_CONSENT_DATA_CATEGORIES[0], "birth_accuracy_and_uncertainty");
  assert.equal(AI_CONSENT_DATA_CATEGORIES[6], "reading_feedback");
});

test("M5_SUPPORTED_USES narrows the frozen M0 enum and adds nothing", () => {
  const common = schema("common.schema.json");
  const constrained = common.$defs.m5AllowedUse.allOf.find((s: any) => Array.isArray(s.enum));
  assert.deepEqual([...M5_SUPPORTED_USES], constrained.enum);

  const m0 = JSON.parse(readFileSync(M0_COMMON, "utf8"));
  const frozen: string[] = m0.$defs.allowedUse.enum;
  for (const use of M5_SUPPORTED_USES) {
    assert.ok(frozen.includes(use), `${use} must already exist in the frozen M0 enum`);
  }
  // ai_synthesis is the outer purpose consent, not a lane. If it were reachable
  // here it could make an otherwise ineligible signal eligible.
  assert.ok(!(M5_SUPPORTED_USES as readonly string[]).includes("ai_synthesis"));
  assert.ok(!isM5SupportedUse("ai_synthesis"));
  assert.ok(!isM5SupportedUse("model_training"));
  assert.ok(!isM5SupportedUse("editorial_context"));
  assert.ok(isM5SupportedUse("life_domain_selection"));
});

test("paragraph roles match both contracts and drop the reviewed fallback", () => {
  assert.deepEqual(
    [...GENERATED_PARAGRAPH_ROLES],
    schema("reading-generation-output.schema.json").$defs.generatedParagraphRole.enum,
  );
  assert.deepEqual(
    [...PARAGRAPH_ROLES_V5],
    schema("daily-reading.schema.json").$defs.paragraphRoleV5.enum,
  );
  assert.ok(!(PARAGRAPH_ROLES_V5 as readonly string[]).includes("safety_fallback"));
  assert.equal(PARAGRAPH_ROLES_V5[0], "primary_theme");
});

test("the checked-in fixtures type-check as the exported wire shapes", () => {
  // Structural, not nominal: assigning the fixture through the exported type is
  // what makes a drifted local lookalike a compile error rather than a runtime
  // surprise on somebody's reading.
  const request: ReadingGenerationRequest = fixture("valid/reading-generation-request.json");
  const output: ReadingGenerationOutput = fixture("valid/reading-generation-output.json");
  const reading: DailyReadingV5 = fixture("valid/daily-reading.published.json");
  const evidence: ReadingEvidenceV5 = fixture("valid/reading-evidence.daily.json");

  assert.equal(request.schema_version, M5_SCHEMA_VERSION);
  assert.equal(request.output_schema, M5_OUTPUT_SCHEMA);
  assert.equal(output.local_date, request.local_date);
  assert.equal(output.locale, request.locale);
  assert.equal(reading.assembly_mode, M5_ASSEMBLY_MODE);
  assert.equal(evidence.model.provider, "openai");
});

test("a v5 reading carries no release pointer and no reviewed fallback", () => {
  const reading = fixture("valid/daily-reading.published.json") as Record<string, unknown>;
  assert.ok(!("release_version" in reading));
  assert.ok(!("fallback_used" in reading));
  assert.ok(reading.disclosure, "the AI disclosure is required, not optional");
  assert.ok(reading.headline, "the quiet kicker is part of the artifact");
});

test("every provider-packet context item maps to a disclosed consent category", () => {
  const request = fixture("valid/reading-generation-request.json") as ReadingGenerationRequest;
  for (const item of request.context) {
    assert.ok(
      (AI_CONSENT_DATA_CATEGORIES as readonly string[]).includes(item.category),
      `${item.context_ref} names an undisclosed category ${item.category}`,
    );
    assert.ok(isM5SupportedUse(item.allowed_use), `${item.context_ref} lane is outside M5`);
  }
});

test("a provider packet carries no stored-row handle", () => {
  const encoded = JSON.stringify(fixture("valid/reading-generation-request.json"));
  for (const key of [
    "user_id",
    "chart_fingerprint",
    "reading_key",
    "reading_id",
    "consent_id",
    "job_id",
    "birth_instant",
    "latitude",
    "longitude",
    "timezone",
    "release_version",
  ]) {
    assert.ok(!encoded.includes(`"${key}"`), `provider packet must not declare "${key}"`);
  }
  for (const prefix of ["usr_", "rdg_", "cht_", "cns_", "job_", "sgn_"]) {
    assert.ok(!encoded.includes(prefix), `provider packet must not carry ${prefix} handles`);
  }
});

test("user-authored text stays a value inside a closed object", () => {
  const request = fixture("valid/reading-generation-request.json") as ReadingGenerationRequest;
  const injected = request.context.find(
    (c) => c.content.kind === "untrusted_text" && /ignore all previous/i.test(c.content.text),
  );
  assert.ok(injected, "the fixture deliberately embeds instruction-shaped text");
  assert.equal(injected.content.kind, "untrusted_text");
  // It is addressable only as data: it has a context_ref, a category, and one
  // permitted lane, and nothing about it can reach the schema or the policy.
  assert.match(injected.context_ref, /^ctx_\d+$/);
});

test("every grounded unit declares both evidence arrays", () => {
  const output = fixture("valid/reading-generation-output.json") as ReadingGenerationOutput;
  const units = [output.lead, ...output.paragraphs, output.reflection_prompt];
  for (const unit of units) {
    assert.ok(Array.isArray(unit.fact_ids), "fact_ids is always present");
    assert.ok(Array.isArray(unit.context_refs), "context_refs is always present");
  }
  // A missing key and an empty list are the same claim, and only one of them is
  // checkable — which is why the schema requires both even when empty.
  assert.deepEqual(output.reflection_prompt.fact_ids, []);
  assert.equal(output.uncertainty_note, null);
});

test("evidence records the frozen input and the winning candidate separately", () => {
  const evidence = fixture("valid/reading-evidence.daily.json") as ReadingEvidenceV5;
  assert.match(evidence.generation_input_id, /^gin_sha256_[a-f0-9]{64}$/);
  assert.match(evidence.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.provider_response_hash, /^sha256:[a-f0-9]{64}$/);
  // The provider is nondeterministic, so one id cannot answer both "which input
  // was frozen" and "which candidate won".
  assert.notEqual(evidence.content_hash, evidence.provider_response_hash);
  assert.equal(evidence.validation.status, "passed");
  assert.ok(evidence.validation.checks.every((c) => c.passed === true));
});
