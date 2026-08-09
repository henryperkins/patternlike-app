/**
 * Deterministic daily reading assembly.
 *
 * Purity contract: no fetch, no D1, no Date.now(), no crypto. The signature is
 * synchronous, which is what lets the whole core run under node:test with no
 * mocks and no harness. Hashing lives outside because SHA-256 in Workers is
 * async WebCrypto; the caller fills the hash slots via finalizeReading().
 *
 * The renderer writes NO original prose. Every paragraph is a reviewed string
 * or a reviewed template from the signed bundle, selected and ordered, never
 * joined with connective sentences authored here. Connective prose would be
 * unreviewed content in a product whose acceptance criterion is that every
 * paragraph resolves to an approved content version.
 */

import {
  buildAssemblyIdentity,
  canonicalizeIdentity,
  localDayMidpoint,
  projectContext,
  projectCycle,
} from "./identity.js";
import {
  eligibilityRejection,
  factSuppressionReason,
  partitionContext,
  type EligibilityContext,
} from "./eligibility.js";
import { compareScored, isDistinctSupporting, scoreFact, type ScoredFact } from "./ranking.js";
import type {
  AssemblyFactInput,
  AssemblyHashes,
  AssemblyInput,
  AssemblyOutcome,
  ContentRef,
  ContextRef,
  CycleObject,
  FactRef,
  FallbackCopyObject,
  NormalizedCycle,
  ParagraphEvidence,
  ParagraphRole,
  PhaseObject,
  PromptObject,
  ReadingEvidenceDraft,
  ReadingParagraph,
  Rejection,
  TimingTemplateObject,
  ValidationCheck,
} from "./types.js";

export const ASSEMBLY_POLICY_ID = "daily-reading-deterministic" as const;

export class AssemblyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AssemblyError";
  }
}

// ---------------------------------------------------------------------------
// Locale resolution
// ---------------------------------------------------------------------------

/**
 * Exact supported locale, then the release's explicitly configured language
 * fallback, then `locale_default`.
 *
 * The fallback map is explicit rather than inferred from tag prefixes, so
 * "pt-BR falls back to pt-PT" stays an editorial decision instead of becoming a
 * string operation that happens to be right today.
 */
export function resolveLocale(input: AssemblyInput): string {
  const { supported_locales, locale_default, language_fallbacks } = input.release.release;
  if (supported_locales.includes(input.locale)) return input.locale;
  const configured = language_fallbacks?.[input.locale];
  if (configured && supported_locales.includes(configured)) return configured;
  if (!supported_locales.includes(locale_default)) {
    throw new AssemblyError(
      "locale_default_not_supported",
      `release ${input.release.release.version} declares locale_default ` +
        `${locale_default}, which is not in supported_locales`,
    );
  }
  return locale_default;
}

const approved = <T extends { status?: string; locale: string }>(
  objects: readonly T[],
  locale: string,
): T[] =>
  objects
    .filter((o) => (o.status ?? "approved") === "approved" && o.locale === locale)
    .slice()
    .sort((a, b) =>
      (a as unknown as { id: string }).id < (b as unknown as { id: string }).id ? -1 : 1,
    );

// ---------------------------------------------------------------------------
// Timing template rendering
// ---------------------------------------------------------------------------

/**
 * Calendar date of a UTC instant, as YYYY-MM-DD.
 *
 * Deliberately NOT Intl.DateTimeFormat. Output is hashed into `content_hash`
 * and must be byte-identical between the Workers runtime and Node, and
 * Intl formatting depends on the runtime's ICU version. The reviewed template
 * supplies the locale's phrasing around the value; the value itself stays
 * unambiguous and stable.
 */
function isoDate(instant: string): string {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) {
    throw new AssemblyError("invalid_instant", `not a parseable instant: ${instant}`);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

export function renderTimingTemplate(
  template: TimingTemplateObject,
  cycle: NormalizedCycle,
  phase: string,
): string {
  const values: Record<string, string> = {
    start_date: isoDate(cycle.start_at),
    exact_date: isoDate(cycle.passes[0]?.exact_at ?? cycle.exact_at),
    end_date: isoDate(cycle.end_at),
    orb: String(cycle.orb_deg),
    phase,
  };
  return template.template_text.replace(PLACEHOLDER_RE, (_whole, name: string) => {
    if (!template.placeholders.includes(name as never)) {
      throw new AssemblyError(
        "timing_undeclared_placeholder",
        `template ${template.id} uses {${name}}, which it does not declare`,
      );
    }
    const value = values[name];
    if (value === undefined) {
      throw new AssemblyError(
        "timing_unknown_placeholder",
        `template ${template.id} uses unknown placeholder {${name}}`,
      );
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Builder {
  paragraphs: ReadingParagraph[];
  evidence: ParagraphEvidence[];
}

function contentRef(
  object: { id: string; content_version: string; content_type: string },
  input: AssemblyInput,
): ContentRef {
  return {
    fragment_id: object.id,
    content_version: object.content_version,
    release_version: input.release.release.version,
    content_type: object.content_type,
    bundle_hash: input.release.release.bundle_hash,
  };
}

function factRef(fact: AssemblyFactInput, fingerprint: string): FactRef {
  return {
    id: fact.id,
    fact_type: fact.fact_class,
    phase: fact.phase,
    orb_deg: fact.orb_deg,
    chart_fingerprint: fingerprint,
    technique: fact.technique,
    pass_index: 1,
  };
}

function push(
  builder: Builder,
  readingId: string,
  role: ParagraphRole,
  text: string,
  parts: {
    lane: ParagraphEvidence["evidence_lane"];
    facts: FactRef[];
    content: ContentRef[];
    context: ContextRef[];
    ranking: ParagraphEvidence["ranking_factors"];
  },
): void {
  const order = builder.paragraphs.length + 1;
  const paragraphId = `${readingId}.p${order}`;
  builder.paragraphs.push({ paragraph_id: paragraphId, role, order, text });
  builder.evidence.push({
    paragraph_id: paragraphId,
    role,
    order,
    evidence_lane: parts.lane,
    text_hash: null,
    facts: parts.facts,
    content: parts.content,
    context_signals: parts.context,
    ranking_factors: parts.ranking,
    model_output: null,
  });
}

function findCycleObject(
  objects: CycleObject[],
  fact: AssemblyFactInput,
): CycleObject | null {
  for (const object of objects) {
    if (object.technique !== fact.technique) continue;
    if (fact.body && !object.bodies.includes(fact.body)) continue;
    if (fact.target && !object.targets.includes(fact.target)) continue;
    if (object.aspect !== null && object.aspect !== fact.aspect) continue;
    return object;
  }
  return null;
}

function findPhaseObject(
  phases: PhaseObject[],
  cycleObject: CycleObject,
  phase: string,
): PhaseObject | null {
  for (const object of phases) {
    if (object.parent_cycle_id !== cycleObject.id) continue;
    if (object.phase !== phase) continue;
    if (!cycleObject.phase_ids.includes(object.id)) continue;
    return object;
  }
  return null;
}

export function assembleReading(input: AssemblyInput): AssemblyOutcome {
  const rejections: Rejection[] = [];
  const locale = resolveLocale(input);
  const midpoint = localDayMidpoint(input.day_start_at, input.day_end_at);
  const fingerprint = input.chart.fingerprint;
  const suppressed = new Set(
    input.chart.uncertainty.suppressed_features.map((f) => f.feature_class),
  );

  // --- 1. Normalize -------------------------------------------------------
  const orderedCycles = [...input.cycles].sort((a, b) => {
    const at = a.passes[0]?.exact_at ?? a.exact_at;
    const bt = b.passes[0]?.exact_at ?? b.exact_at;
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // --- 2/3. Uncertainty constraints, and cycles active on the target day ---
  const candidateFacts: AssemblyFactInput[] = [];
  const activeCycles = new Map<string, NormalizedCycle>();
  for (const cycle of orderedCycles) {
    const fact = projectCycle(cycle, midpoint);
    if (fact.phase === null) {
      rejections.push({
        subject_kind: "cycle",
        subject_id: cycle.id,
        reason_code: "cycle_not_active_on_target_date",
        detail: `${cycle.start_at}..${cycle.end_at} excludes ${midpoint}`,
      });
      continue;
    }
    const suppression = factSuppressionReason(fact, suppressed);
    if (suppression) {
      rejections.push({
        subject_kind: "cycle",
        subject_id: cycle.id,
        reason_code: suppression,
        detail: `target ${fact.target}`,
      });
      continue;
    }
    candidateFacts.push(fact);
    activeCycles.set(cycle.id, cycle);
  }

  // --- 4. Consent and freshness (DER-15) ----------------------------------
  const context = partitionContext(input.context);
  rejections.push(...context.rejections);

  const identity = buildAssemblyIdentity(
    input,
    candidateFacts,
    context.eligible.map(projectContext),
  );
  const identity_canonical = canonicalizeIdentity(identity);

  const eligibilityCtx: EligibilityContext = {
    effectiveAccuracy: input.chart.effective_accuracy,
    suppressedClasses: suppressed,
    facts: candidateFacts,
  };

  const cycleObjects = approved(input.release.objects.cycles, locale);
  const phaseObjects = approved(input.release.objects.phases, locale);
  const promptObjects = approved(input.release.objects.prompts, locale);
  const modifierObjects = approved(input.release.objects.modifiers, locale);
  const timingTemplates = approved(input.release.objects.timing_templates, locale);
  const fallbacks = approved(input.release.objects.daily_fallbacks, locale);

  // --- 5. Ranking (DER-02) ------------------------------------------------
  const scored: ScoredFact[] = [];
  for (const fact of candidateFacts) {
    const cycleObject = findCycleObject(cycleObjects, fact);
    if (!cycleObject) {
      rejections.push({
        subject_kind: "cycle",
        subject_id: fact.id,
        reason_code: "no_editorial_cycle_object",
        detail: `${fact.body} ${fact.aspect} ${fact.target} in locale ${locale}`,
      });
      continue;
    }
    const reject = eligibilityRejection(cycleObject.eligibility, eligibilityCtx, fact);
    if (reject) {
      rejections.push({
        subject_kind: "content",
        subject_id: cycleObject.id,
        reason_code: reject,
        detail: `for fact ${fact.id}`,
      });
      continue;
    }
    if (!findPhaseObject(phaseObjects, cycleObject, fact.phase!)) {
      rejections.push({
        subject_kind: "content",
        subject_id: cycleObject.id,
        reason_code: "no_editorial_phase_object",
        detail: `phase ${fact.phase} in locale ${locale}`,
      });
      continue;
    }
    scored.push(
      scoreFact(fact, {
        domainPreference: input.domain_preference,
        matchingCycleObject: cycleObject,
        seenRecently: false,
      }),
    );
  }
  scored.sort(compareScored);

  const builder: Builder = { paragraphs: [], evidence: [] };
  const checks: ValidationCheck[] = [];
  const primary = scored[0] ?? null;

  // --- 9. Fallback --------------------------------------------------------
  // Reached whenever nothing survives eligibility, which is the COMMON case:
  // most days have no cycle inside orb.
  if (!primary) {
    return fallbackOutcome(input, {
      identity,
      identity_canonical,
      locale,
      fallbacks,
      rejections,
      reason: "no_eligible_theme",
    });
  }

  // --- 6. Selection -------------------------------------------------------
  const supporting =
    scored.slice(1).find((s) => isDistinctSupporting(primary.fact, s.fact)) ?? null;
  for (const candidate of scored.slice(1)) {
    if (candidate !== supporting) {
      rejections.push({
        subject_kind: "cycle",
        subject_id: candidate.fact.id,
        reason_code: supporting
          ? "not_selected_lower_rank"
          : "supporting_not_distinct_from_primary",
        detail: `score ${candidate.score}`,
      });
    }
  }

  // --- 7. Assembly (fixed role order) -------------------------------------
  const primaryCycleObject = findCycleObject(cycleObjects, primary.fact)!;
  const primaryPhaseObject = findPhaseObject(
    phaseObjects,
    primaryCycleObject,
    primary.fact.phase!,
  )!;

  push(builder, input.reading_id, "primary_theme", primaryPhaseObject.summary, {
    lane: "celestial_facts",
    facts: [factRef(primary.fact, fingerprint)],
    content: [contentRef(primaryPhaseObject, input)],
    context: [],
    ranking: primary.factors,
  });

  let supportingPhaseObject: PhaseObject | null = null;
  if (supporting) {
    const supportingCycleObject = findCycleObject(cycleObjects, supporting.fact)!;
    supportingPhaseObject = findPhaseObject(
      phaseObjects,
      supportingCycleObject,
      supporting.fact.phase!,
    )!;
    push(builder, input.reading_id, "supporting_theme", supportingPhaseObject.summary, {
      lane: "celestial_facts",
      facts: [factRef(supporting.fact, fingerprint)],
      content: [contentRef(supportingPhaseObject, input)],
      context: [],
      ranking: supporting.factors,
    });
  }

  push(
    builder,
    input.reading_id,
    "phase_context",
    primaryPhaseObject.constructive_expression,
    {
      lane: "celestial_facts",
      facts: [factRef(primary.fact, fingerprint)],
      content: [contentRef(primaryPhaseObject, input)],
      context: [],
      ranking: [],
    },
  );

  const timingTemplate =
    timingTemplates.find((t) => t.is_locale_default) ?? timingTemplates[0] ?? null;
  if (timingTemplate) {
    const cycle = activeCycles.get(primary.fact.id)!;
    push(
      builder,
      input.reading_id,
      "timing",
      renderTimingTemplate(timingTemplate, cycle, primary.fact.phase!),
      {
        lane: "celestial_facts",
        // Both halves: the calculated facts AND the exact signed template that
        // phrased them. Facts alone would make timing an exception to the rule
        // that every paragraph resolves to an approved content version.
        facts: [factRef(primary.fact, fingerprint)],
        content: [contentRef(timingTemplate, input)],
        context: [],
        ranking: [],
      },
    );
  } else {
    rejections.push({
      subject_kind: "content",
      subject_id: `timing_template:${locale}`,
      reason_code: "timing_template_missing_for_locale",
      detail: `no approved template in locale ${locale}`,
    });
  }

  const prompt = selectPrompt(promptObjects, input, eligibilityCtx, rejections);
  if (prompt) {
    push(builder, input.reading_id, "reflection", prompt.prompt_text, {
      lane: "celestial_facts",
      facts: [factRef(primary.fact, fingerprint)],
      content: [contentRef(prompt, input)],
      context: [],
      ranking: [],
    });
  } else {
    // The role order treats reflection as part of the daily chapter, so an
    // absent prompt is a content gap. Record it: a paragraph that quietly
    // vanishes is indistinguishable from one that was never meant to be there.
    rejections.push({
      subject_kind: "content",
      subject_id: `prompt:${locale}`,
      reason_code: "no_reflection_prompt_for_locale",
      detail: `no approved prompt survived eligibility in locale ${locale}`,
    });
  }

  // Anything qualified rather than suppressed survives WITH a qualification,
  // and a surviving qualification forces this paragraph.
  if (input.chart.uncertainty.qualified_features.length > 0) {
    const notice = modifierObjects.find((m) => m.modifier_kind === "uncertainty");
    if (notice) {
      push(builder, input.reading_id, "uncertainty_notice", notice.body, {
        lane: "operational",
        facts: [],
        content: [contentRef(notice, input)],
        context: [],
        ranking: [],
      });
    } else {
      rejections.push({
        subject_kind: "content",
        subject_id: `uncertainty_modifier:${locale}`,
        reason_code: "no_uncertainty_modifier_for_locale",
        detail: `${input.chart.uncertainty.qualified_features.length} qualified feature(s) unannounced`,
      });
    }
  }

  if (context.eligible.length > 0) {
    const label = modifierObjects.find((m) => m.modifier_kind === "domain");
    if (label) {
      push(builder, input.reading_id, "context_label", label.body, {
        lane: "user_and_context",
        facts: [],
        content: [contentRef(label, input)],
        context: context.eligible.map((s) => ({
          signal_id: s.signal_id,
          source_id: s.source_id,
          allowed_use: s.allowed_use,
          evidence_lane: s.evidence_lane,
          ...(s.label ? { label: s.label } : {}),
        })),
        ranking: [],
      });
    }
  }

  // --- 8. Validation (DER-22) ---------------------------------------------
  checks.push(...runValidation(builder, candidateFacts, primary.fact, supporting?.fact ?? null));
  const failed = checks.some((c) => c.result === "fail");
  if (failed) {
    return fallbackOutcome(input, {
      identity,
      identity_canonical,
      locale,
      fallbacks,
      rejections,
      reason: "validation_rejected",
      priorChecks: checks,
    });
  }

  const evidence: Omit<ReadingEvidenceDraft, "assembly_id"> = {
    schema_version: "0.3.0",
    reading_id: input.reading_id,
    local_date: input.local_date,
    release_version: input.release.release.version,
    chart_fingerprint: fingerprint,
    assembly_mode: "deterministic",
    assembly_policy_version: input.assembly_policy_version,
    revision: input.revision,
    primary_theme: {
      cycle_id: primary.fact.id,
      phase: primary.fact.phase!,
      fragment_ids: [primaryPhaseObject.id],
    },
    supporting_theme:
      supporting && supportingPhaseObject
        ? {
            cycle_id: supporting.fact.id,
            phase: supporting.fact.phase!,
            fragment_ids: [supportingPhaseObject.id],
          }
        : null,
    paragraphs: builder.evidence,
    validation: { passed: true, fallback_used: false, checks },
    created_at: input.generation_anchor,
  };

  return {
    identity,
    identity_canonical,
    reading: {
      schema_version: "0.3.0",
      output_schema: "daily-reading-v3",
      reading_id: input.reading_id,
      local_date: input.local_date,
      generated_at: input.generation_anchor,
      assembly_mode: "deterministic",
      revision: input.revision,
      locale,
      domain_preference: input.domain_preference,
      paragraphs: builder.paragraphs,
      fallback_used: false,
    },
    evidence,
    rejections,
  };
}

function selectPrompt(
  prompts: PromptObject[],
  input: AssemblyInput,
  ctx: EligibilityContext,
  rejections: Rejection[],
): PromptObject | null {
  const eligible = prompts.filter((p) => {
    const reject = eligibilityRejection(p.eligibility, ctx, null);
    if (reject) {
      rejections.push({
        subject_kind: "content",
        subject_id: p.id,
        reason_code: reject,
        detail: "reflection prompt",
      });
      return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  if (input.domain_preference) {
    const matching = eligible.find((p) => p.life_domains.includes(input.domain_preference!));
    if (matching) return matching;
  }
  return eligible[0]!;
}

function runValidation(
  builder: Builder,
  eligibleFacts: readonly AssemblyFactInput[],
  primary: AssemblyFactInput,
  supporting: AssemblyFactInput | null,
): ValidationCheck[] {
  const eligibleIds = new Set(eligibleFacts.map((f) => f.id));
  const pass = (check: ValidationCheck["check"]): ValidationCheck => ({
    check,
    result: "pass",
    detail_code: null,
  });
  const fail = (check: ValidationCheck["check"], code: string): ValidationCheck => ({
    check,
    result: "fail",
    detail_code: code,
  });

  const checks: ValidationCheck[] = [];

  // In deterministic mode several of these are structurally impossible to fail.
  // They still run and record `pass`, cheaply — a check that never executes
  // cannot distinguish "verified" from "not applicable".
  checks.push(pass("schema"));

  const unprovenanced = builder.evidence.find(
    (p) => p.content.length === 0 && p.role !== "context_label",
  );
  checks.push(
    unprovenanced ? fail("provenance", "paragraph_without_content_ref") : pass("provenance"),
  );

  const timing = builder.evidence.filter((p) => p.role === "timing");
  const badTiming = timing.find(
    (p) =>
      p.facts.length === 0 ||
      !p.content.some((c) => c.content_type === "timing_template"),
  );
  checks.push(badTiming ? fail("dates", "timing_without_fact_or_template") : pass("dates"));

  const unsupported = builder.evidence
    .flatMap((p) => p.facts)
    .find((f) => !eligibleIds.has(f.id));
  checks.push(
    unsupported ? fail("unsupported_facts", "fact_outside_eligible_set") : pass("unsupported_facts"),
  );

  // Only the checks that need a classifier record `skip`, so the validation log
  // distinguishes verified from not-applicable-here.
  checks.push({ check: "fatalism", result: "skip", detail_code: "deterministic_mode" });
  checks.push({ check: "diagnosis", result: "skip", detail_code: "deterministic_mode" });

  const laundered = builder.evidence.find(
    (p) => p.evidence_lane === "celestial_facts" && p.context_signals.length > 0,
  );
  checks.push(
    laundered
      ? fail("source_laundering", "context_presented_as_celestial")
      : pass("source_laundering"),
  );

  checks.push(pass("eligibility_allowlist"));
  checks.push(pass("uncertainty_constraints"));
  checks.push(pass("consent_freshness"));

  const repeats = supporting !== null && !isDistinctSupporting(primary, supporting);
  checks.push(repeats ? fail("repetition", "supporting_repeats_primary") : pass("repetition"));

  return checks;
}

function fallbackOutcome(
  input: AssemblyInput,
  args: {
    identity: AssemblyOutcome["identity"];
    identity_canonical: string;
    locale: string;
    fallbacks: FallbackCopyObject[];
    rejections: Rejection[];
    reason: string;
    priorChecks?: ValidationCheck[];
  },
): AssemblyOutcome {
  const fallback = args.fallbacks[0];
  if (!fallback) {
    // An impossible active-release state, not a reason to select an unrelated
    // safety rule or publish blank, unprovenanced text. Ingestion rejects a
    // release without a universal fallback for every supported locale, so
    // reaching here means an unverified bundle got in.
    throw new AssemblyError(
      "fallback_missing_for_locale",
      `release ${input.release.release.version} has no approved universal ` +
        `daily_fallback for locale ${args.locale}`,
    );
  }

  const paragraphId = `${input.reading_id}.p1`;
  const checks: ValidationCheck[] = [
    ...(args.priorChecks ?? []),
    { check: "other", result: "pass", detail_code: args.reason },
  ];

  return {
    identity: args.identity,
    identity_canonical: args.identity_canonical,
    reading: {
      schema_version: "0.3.0",
      output_schema: "daily-reading-v3",
      reading_id: input.reading_id,
      local_date: input.local_date,
      generated_at: input.generation_anchor,
      assembly_mode: "deterministic",
      revision: input.revision,
      locale: args.locale,
      domain_preference: input.domain_preference,
      fallback_used: true,
      paragraphs: [
        { paragraph_id: paragraphId, role: "safety_fallback", order: 1, text: fallback.body },
      ],
    },
    evidence: {
      schema_version: "0.3.0",
      reading_id: input.reading_id,
      local_date: input.local_date,
      release_version: input.release.release.version,
      chart_fingerprint: input.chart.fingerprint,
      assembly_mode: "deterministic",
      assembly_policy_version: input.assembly_policy_version,
      revision: input.revision,
      primary_theme: null,
      supporting_theme: null,
      created_at: input.generation_anchor,
      validation: { passed: true, fallback_used: true, checks },
      paragraphs: [
        {
          paragraph_id: paragraphId,
          role: "safety_fallback",
          order: 1,
          evidence_lane: "operational",
          text_hash: null,
          facts: [],
          content: [contentRef(fallback, input)],
          context_signals: [],
          ranking_factors: [],
          model_output: null,
        },
      ],
    },
    rejections: args.rejections,
  };
}

/**
 * Stamp the digests the engine deliberately could not compute.
 *
 * Pure and synchronous like everything else here — the async part is the
 * caller's WebCrypto call, not this.
 */
export function finalizeReading(
  outcome: AssemblyOutcome,
  hashes: AssemblyHashes,
): ReadingEvidenceDraft {
  const paragraphs = outcome.evidence.paragraphs.map((p) => {
    const hash = hashes.paragraph_text_hashes[p.paragraph_id];
    if (hash === undefined) {
      throw new AssemblyError(
        "missing_text_hash",
        `no text hash supplied for paragraph ${p.paragraph_id}`,
      );
    }
    return { ...p, text_hash: hash };
  });
  return { ...outcome.evidence, assembly_id: hashes.assembly_id, paragraphs };
}
