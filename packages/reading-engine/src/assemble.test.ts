import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { assembleReading, AssemblyError, finalizeReading, resolveLocale } from "./assemble.js";
import { canonicalizeIdentity, renderAssemblyId } from "./identity.js";
import { evaluateDeclaredFixtures, evaluateFixture, UnknownFixtureError } from "./fixtures.js";
import type { AssemblyFixture } from "./fixtures.js";
import type { AssemblyInput, NormalizedContextSignal, VerifiedBundle } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const M3 = path.resolve(here, "../../../contracts/m3");

const read = (rel: string) => JSON.parse(readFileSync(path.join(M3, rel), "utf8"));

const bundleFixture = read("fixtures/valid/content-release.bundle.json");
const bundle: VerifiedBundle = bundleFixture;

const catalogue = new Map<string, AssemblyFixture>(
  readdirSync(path.join(M3, "fixtures/assembly"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const doc: AssemblyFixture = read(`fixtures/assembly/${f}`);
      return [doc.fixture_id, doc] as const;
    }),
);

function inputFrom(fixtureId: string, overrides: Partial<AssemblyInput> = {}): AssemblyInput {
  const f = catalogue.get(fixtureId)!;
  return {
    identity_profile: "patternlike.assembly-id.v1",
    schema_version: "0.3.0",
    output_schema: "daily-reading-v3",
    assembly_policy_id: "daily-reading-deterministic",
    assembly_policy_version: "1.4.0",
    reading_id: "rdg_01JAMPLEREADING00001",
    revision: 1,
    local_date: f.local_date,
    target_timezone: f.target_timezone,
    generation_anchor: "2026-07-30T09:00:00Z",
    day_start_at: f.day_start_at,
    day_end_at: f.day_end_at,
    chart: f.chart,
    cycles: f.cycles,
    release: bundle,
    context: f.context,
    locale: f.locale,
    domain_preference: f.domain_preference,
    ...overrides,
  };
}

const sha = (s: string) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

// ---------------------------------------------------------------------------

test("an eligible day produces a themed reading in fixed role order", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));

  assert.equal(outcome.reading.fallback_used, false);
  assert.deepEqual(
    outcome.reading.paragraphs.map((p) => p.role),
    ["primary_theme", "phase_context", "timing", "reflection"],
  );
  assert.deepEqual(
    outcome.reading.paragraphs.map((p) => p.order),
    [1, 2, 3, 4],
  );
  assert.equal(outcome.evidence.primary_theme?.phase, "building");
});

test("the renderer writes no original prose — every paragraph is reviewed copy", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));

  const reviewed = new Set<string>([
    ...bundle.objects.phases.flatMap((p) => [
      p.summary,
      p.constructive_expression,
      p.shadow_expression,
    ]),
    ...bundle.objects.prompts.map((p) => p.prompt_text),
    ...bundle.objects.modifiers.map((m) => m.body),
    ...bundle.objects.daily_fallbacks.map((f) => f.body),
  ]);

  for (const paragraph of outcome.reading.paragraphs) {
    if (paragraph.role === "timing") continue; // rendered from a reviewed template
    assert.ok(
      reviewed.has(paragraph.text),
      `paragraph ${paragraph.role} is not a reviewed string: ${paragraph.text}`,
    );
  }
});

test("a timing paragraph carries BOTH its calculated facts and its signed template", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  const timing = outcome.evidence.paragraphs.find((p) => p.role === "timing")!;

  assert.ok(timing.facts.length >= 1, "timing must cite at least one calculated fact");
  assert.ok(
    timing.content.some((c) => c.content_type === "timing_template"),
    "timing must cite the exact reviewed template that phrased it",
  );
  // Dates are rendered ISO rather than through Intl: output is hashed, and
  // Intl formatting varies with the runtime's ICU version.
  assert.match(
    outcome.reading.paragraphs.find((p) => p.role === "timing")!.text,
    /\d{4}-\d{2}-\d{2}/,
  );
});

test("every paragraph resolves to an approved content version", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  for (const paragraph of outcome.evidence.paragraphs) {
    assert.ok(
      paragraph.content.length >= 1,
      `paragraph ${paragraph.role} has no content ref`,
    );
    for (const ref of paragraph.content) {
      assert.equal(ref.release_version, bundle.release.version);
      assert.equal(ref.bundle_hash, bundle.release.bundle_hash);
    }
  }
});

test("a day with no cycle inside orb publishes reviewed fallback copy, never nothing", () => {
  const outcome = assembleReading(inputFrom("quiet-day-no-cycles"));

  assert.equal(outcome.reading.fallback_used, true);
  assert.equal(outcome.reading.paragraphs.length, 1);
  assert.equal(outcome.reading.paragraphs[0]!.role, "safety_fallback");
  assert.equal(
    outcome.reading.paragraphs[0]!.text,
    bundle.objects.daily_fallbacks.find((f) => f.locale === "en-US")!.body,
  );

  const evidence = outcome.evidence.paragraphs[0]!;
  assert.equal(evidence.evidence_lane, "operational");
  assert.deepEqual(evidence.facts, []);
  assert.deepEqual(evidence.context_signals, []);
  assert.equal(evidence.content.length, 1);
  assert.equal(evidence.content[0]!.content_type, "daily_fallback");
});

test("every supported locale has a byte-stable fallback outcome", () => {
  for (const locale of bundle.release.supported_locales) {
    const outcome = assembleReading(inputFrom("quiet-day-no-cycles", { locale }));
    assert.equal(outcome.reading.fallback_used, true);
    assert.equal(outcome.reading.locale, locale);
    assert.equal(
      outcome.reading.paragraphs[0]!.text,
      bundle.objects.daily_fallbacks.find((f) => f.locale === locale)!.body,
    );
    // Byte-stable: a second run reproduces it exactly.
    const again = assembleReading(inputFrom("quiet-day-no-cycles", { locale }));
    assert.deepEqual(again.reading, outcome.reading);
  }
});

test("locale resolution is exact, then configured fallback, then locale_default", () => {
  assert.equal(resolveLocale(inputFrom("quiet-day-no-cycles", { locale: "es-ES" })), "es-ES");
  // es-MX is mapped to es-ES explicitly by the release, not by tag-prefix guessing.
  assert.equal(resolveLocale(inputFrom("quiet-day-no-cycles", { locale: "es-MX" })), "es-ES");
  assert.equal(resolveLocale(inputFrom("quiet-day-no-cycles", { locale: "ja-JP" })), "en-US");
});

test("unknown birth time suppresses an angle theme rather than filtering it later", () => {
  const outcome = assembleReading(inputFrom("unknown-time-angle-theme"));

  assert.equal(outcome.reading.fallback_used, true);
  const reason = outcome.rejections.find((r) => r.subject_kind === "cycle");
  assert.match(reason!.reason_code, /^uncertainty_angle/);
  // The identity must reflect the suppression too, or the same day under a
  // corrected chart would reuse this id.
  assert.equal(outcome.identity.effective_accuracy, "unknown");
  assert.deepEqual(outcome.identity.facts, []);
});

test("identical inputs reproduce identical canonical bytes and assembly id", () => {
  const a = assembleReading(inputFrom("saturn-square-sun-building"));
  const b = assembleReading(inputFrom("saturn-square-sun-building"));
  assert.equal(a.identity_canonical, b.identity_canonical);
  assert.deepEqual(a.reading, b.reading);
  assert.deepEqual(a.evidence, b.evidence);
});

test("a changed generation anchor changes the id; a changed reading id does not", () => {
  const base = assembleReading(inputFrom("saturn-square-sun-building"));
  const laterAnchor = assembleReading(
    inputFrom("saturn-square-sun-building", { generation_anchor: "2026-07-30T10:00:00Z" }),
  );
  assert.notEqual(base.identity_canonical, laterAnchor.identity_canonical);

  // The reading id addresses a storage row and must not enter the preimage.
  const otherRow = assembleReading(
    inputFrom("saturn-square-sun-building", { reading_id: "rdg_01JOTHERREADING00001" }),
  );
  assert.equal(base.identity_canonical, otherRow.identity_canonical);
});

test("nothing that names a person crosses into the identity preimage", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  const encoded = outcome.identity_canonical;
  for (const token of ["usr_", "cs_", "user_id", "reading_key", "reading_id", "session"]) {
    assert.ok(!encoded.includes(token), `identity preimage contains ${token}`);
  }
});

test("generated_at is the frozen anchor, never a clock read", () => {
  const outcome = assembleReading(
    inputFrom("saturn-square-sun-building", { generation_anchor: "2020-01-01T00:00:00Z" }),
  );
  assert.equal(outcome.reading.generated_at, "2020-01-01T00:00:00Z");
  assert.equal(outcome.evidence.created_at, "2020-01-01T00:00:00Z");
});

test("a context source outside the registry allowlist cannot enter assembly", () => {
  // AMB-12 is excluded by STATUS while carrying an ingestible id prefix, so the
  // `NOT GLOB 'NO-*'` rule used by the D1 CHECKs lets it through. This is the
  // launch acceptance criterion the engine is the first code able to violate.
  const amb12: NormalizedContextSignal = {
    signal_id: "sig_amb12",
    source_id: "AMB-12",
    allowed_use: "theme_ranking",
    evidence_lane: "user_and_context",
    permission_state: "active",
    freshness_status: "fresh",
  };
  const outcome = assembleReading(
    inputFrom("saturn-square-sun-building", { context: [amb12] }),
  );

  assert.deepEqual(outcome.identity.context, []);
  assert.ok(
    outcome.rejections.some(
      (r) => r.reason_code === "context_source_not_in_registry_allowlist",
    ),
  );
  for (const paragraph of outcome.evidence.paragraphs) {
    assert.deepEqual(paragraph.context_signals, []);
  }
});

test("a registered source used for a purpose it does not permit is rejected", () => {
  const misuse: NormalizedContextSignal = {
    signal_id: "sig_misuse",
    source_id: "USR-03",
    allowed_use: "ad_targeting" as never,
    evidence_lane: "user_and_context",
    permission_state: "active",
    freshness_status: "fresh",
  };
  const outcome = assembleReading(
    inputFrom("saturn-square-sun-building", { context: [misuse] }),
  );
  assert.ok(
    outcome.rejections.some((r) => r.reason_code === "context_use_not_permitted_for_source"),
  );
});

test("revoked or stale context is dropped with a recorded reason", () => {
  const base: NormalizedContextSignal = {
    signal_id: "sig_ok",
    source_id: "USR-03",
    allowed_use: "life_domain_selection",
    evidence_lane: "user_and_context",
    permission_state: "active",
    freshness_status: "fresh",
  };
  const revoked = assembleReading(
    inputFrom("saturn-square-sun-building", {
      context: [{ ...base, permission_state: "revoked" }],
    }),
  );
  assert.ok(revoked.rejections.some((r) => r.reason_code === "context_permission_inactive"));

  const stale = assembleReading(
    inputFrom("saturn-square-sun-building", {
      context: [{ ...base, freshness_status: "stale" }],
    }),
  );
  assert.ok(stale.rejections.some((r) => r.reason_code === "context_not_fresh"));
});

test("the validation log distinguishes verified from not-applicable", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  const checks = outcome.evidence.validation.checks;

  const skipped = checks.filter((c) => c.result === "skip");
  assert.deepEqual(
    skipped.map((c) => c.check).sort(),
    ["diagnosis", "fatalism"],
    "only the checks that need a classifier may skip",
  );
  for (const check of skipped) assert.equal(check.detail_code, "deterministic_mode");
  assert.equal(checks.some((c) => c.result === "fail"), false);
  assert.ok(checks.filter((c) => c.result === "pass").length >= 8);
});

test("finalizeReading stamps the digests the engine could not compute", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  const digest = createHash("sha256")
    .update(outcome.identity_canonical, "utf8")
    .digest("hex");

  const hashes = {
    assembly_id: renderAssemblyId(digest),
    paragraph_text_hashes: Object.fromEntries(
      outcome.reading.paragraphs.map((p) => [p.paragraph_id, sha(p.text)]),
    ),
  };
  const evidence = finalizeReading(outcome, hashes);

  assert.match(evidence.assembly_id, /^asm_[a-f0-9]{32}$/);
  for (const paragraph of evidence.paragraphs) {
    assert.match(paragraph.text_hash!, /^sha256:[a-f0-9]{64}$/);
  }
  assert.equal(canonicalizeIdentity(outcome.identity), outcome.identity_canonical);
});

test("finalizeReading refuses to stamp a paragraph it was given no hash for", () => {
  const outcome = assembleReading(inputFrom("saturn-square-sun-building"));
  assert.throws(
    () => finalizeReading(outcome, { assembly_id: "asm_" + "a".repeat(32), paragraph_text_hashes: {} }),
    /missing_text_hash|no text hash/,
  );
});

// ---------------------------------------------------------------------------
// Fixture evaluation — what turns accepted_pending_tests from permanent into
// transient.
// ---------------------------------------------------------------------------

test("every fixture the canonical bundle declares evaluates as claimed", () => {
  const results = evaluateDeclaredFixtures(bundle, catalogue, bundleFixture.fixtures);
  assert.equal(results.length, bundleFixture.fixtures.length);
  for (const result of results) {
    assert.ok(
      result.passed,
      `${result.fixture_id}: expected ${result.expected}, got ${result.outcome}`,
    );
  }
});

test("an unresolvable fixture id fails closed rather than passing", () => {
  assert.throws(
    () => evaluateFixture(bundle, catalogue, "fixture-nobody-has"),
    UnknownFixtureError,
  );
});

test("ineligible and fallback are distinguished, not conflated", () => {
  // Both publish the reviewed fallback, but "a candidate existed and was ruled
  // out" is a different editorial fact from "nothing was offered".
  assert.equal(evaluateFixture(bundle, catalogue, "unknown-time-angle-theme").outcome, "ineligible");
  assert.equal(evaluateFixture(bundle, catalogue, "quiet-day-no-cycles").outcome, "fallback");
});

test("a zero-fact fixture in every supported locale evaluates to fallback", () => {
  for (const locale of bundle.release.supported_locales) {
    const fixture = catalogue.get("quiet-day-no-cycles")!;
    const scoped = new Map(catalogue);
    scoped.set("scoped", { ...fixture, fixture_id: "scoped", locale });
    assert.equal(evaluateFixture(bundle, scoped, "scoped").outcome, "fallback");
  }
});

test("a release with no universal fallback for the locale fails closed", () => {
  const broken: VerifiedBundle = {
    ...bundle,
    objects: { ...bundle.objects, daily_fallbacks: [] },
  };
  // An impossible active-release state — ingestion rejects it — so reaching it
  // means an unverified bundle got in. Throwing beats publishing blank,
  // unprovenanced text, or pressing an unrelated safety rule into service.
  assert.throws(
    () => assembleReading(inputFrom("quiet-day-no-cycles", { release: broken })),
    (err: unknown) =>
      err instanceof AssemblyError && err.code === "fallback_missing_for_locale",
  );
});

test("a locale with no reflection prompt records the gap instead of hiding it", () => {
  const withoutPrompts: VerifiedBundle = {
    ...bundle,
    objects: { ...bundle.objects, prompts: [] },
  };
  const outcome = assembleReading(
    inputFrom("saturn-square-sun-building", { release: withoutPrompts }),
  );
  assert.equal(
    outcome.reading.paragraphs.some((p) => p.role === "reflection"),
    false,
  );
  assert.ok(
    outcome.rejections.some((r) => r.reason_code === "no_reflection_prompt_for_locale"),
    "an absent prompt must surface in the evidence drawer, not vanish",
  );
});
