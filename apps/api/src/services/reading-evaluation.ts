import {
  prepareConstrainedReadingInput,
  validateReadingCandidate,
  type ConstrainedReadingInput,
  type PreparedConstrainedReadingInput,
} from "@patternlike/reading-engine";
import type { ReadingGenerationOutput } from "@patternlike/shared";
import corpusJson from "../../test/fixtures/reading-evaluation-corpus.json";

/**
 * The quality gate for a model, reasoning/output configuration, prompt,
 * selection-policy, or validation-policy change.
 *
 * Two lanes read this module. The ordinary suite scores frozen candidates
 * offline, so a policy change that quietly widens or narrows what publishes is a
 * failing test. `scripts/run-openai-reading-eval.ts` sends the same synthetic
 * profiles to the real provider and scores whatever comes back. Neither lane
 * duplicates a rule: the hard gates ARE `validateReadingCandidate`, and the
 * prompts ARE `buildResponsesRequest`. A second copy of either would be a second
 * definition of what the product accepts, and the copy that drifted would be the
 * one nobody ran.
 *
 * The corpus is entirely synthetic. It contains no real account, no real birth
 * data, and nothing read from D1 — which is what makes the live lane safe to
 * point at a real key.
 */

/**
 * Bumped when the scoring rules below change, independently of the corpus
 * version: the corpus records which candidates are expected to pass, and this
 * records how a candidate is judged. Both are pinned by the corpus `gates`.
 */
export const EVALUATION_POLICY_VERSION = "1.0.0";

export interface EvaluationGates {
  model: string;
  reasoning_effort: string;
  max_output_tokens: number;
  prompt_version: string;
  selection_policy_version: string;
  validation_policy_version: string;
  evaluation_policy_version: string;
}

export interface EvaluationProfile {
  shape: string;
  description: string;
  overrides: Record<string, unknown>;
}

export interface EvaluationCase {
  id: string;
  profile: string;
  expect: "accept" | "reject";
  /** `code.detail_code`, for a rejection the corpus predicts exactly. */
  expect_detail?: string;
  notes?: string;
  candidate: ReadingGenerationOutput;
}

export interface QualitativeCase {
  id: string;
  profile: string;
  /** A finding code, or `clean` when the candidate should raise none. */
  expect: string;
  notes?: string;
  candidate: ReadingGenerationOutput;
}

export interface EvaluationCorpus {
  corpus_version: string;
  gates: EvaluationGates;
  base: ConstrainedReadingInput;
  profiles: Record<string, EvaluationProfile>;
  cases: EvaluationCase[];
  qualitative: QualitativeCase[];
}

export interface EvaluationFailure {
  code: string;
  detail_code: string;
}

export function loadEvaluationCorpus(): EvaluationCorpus {
  return corpusJson as unknown as EvaluationCorpus;
}

/**
 * The profile's own input, compiled by the real entry point.
 *
 * Overrides replace whole top-level members rather than merging into them: a
 * profile that means "no cycles today" says `"cycles": []`, and a deep merge
 * would quietly keep the base cycle underneath it.
 */
export function prepareProfile(
  corpus: EvaluationCorpus,
  profileId: string,
): PreparedConstrainedReadingInput {
  const profile = corpus.profiles[profileId];
  if (!profile) throw new Error(`unknown evaluation profile ${profileId}`);
  return prepareConstrainedReadingInput({
    ...corpus.base,
    ...profile.overrides,
  } as ConstrainedReadingInput);
}

/**
 * The hard gates: exactly what publication requires, and nothing this module
 * invented. A candidate that passes here is a candidate the Worker would have
 * published.
 */
export function hardGateFindings(
  prepared: PreparedConstrainedReadingInput,
  candidate: ReadingGenerationOutput,
): EvaluationFailure[] {
  const result = validateReadingCandidate(candidate, prepared);
  return result.ok ? [] : result.failures.map((f) => ({ ...f }));
}

export interface CaseResult {
  id: string;
  expected: "accept" | "reject";
  actual: "accept" | "reject";
  failures: EvaluationFailure[];
}

export function evaluateCase(
  corpus: EvaluationCorpus,
  entry: EvaluationCase,
): CaseResult {
  const prepared = prepareProfile(corpus, entry.profile);
  const failures = hardGateFindings(prepared, entry.candidate);
  return {
    id: entry.id,
    expected: entry.expect,
    actual: failures.length === 0 ? "accept" : "reject",
    failures,
  };
}

const HYPE = /\b(?:amazing|incredible|unlock|manifest|destiny|magical|epic|game[- ]chang\w+)\b/i;

/**
 * Aggregate quality signals, deliberately separate from the hard gates.
 *
 * A reading that repeats yesterday's framing is worse; it is not wrong. Folding
 * these into publication would mean an honest unavailable state instead of a
 * slightly dull reading, which is the wrong trade for the reader. They are
 * scored, reported, and allowed to regress a threshold — not to reject a
 * candidate.
 */
export function qualitativeFindings(
  prepared: PreparedConstrainedReadingInput,
  candidate: ReadingGenerationOutput,
): string[] {
  const findings: string[] = [];
  const units = [
    candidate.lead,
    ...candidate.paragraphs,
    candidate.reflection_prompt,
    ...(candidate.uncertainty_note ? [candidate.uncertainty_note] : []),
  ];
  const allText = [candidate.headline, ...units.map((unit) => unit.text)].join(" ");

  // Usefulness: the reflection has to be a question the reader can sit with,
  // not a restatement of the lead.
  if (!candidate.reflection_prompt.text.trim().endsWith("?")) {
    findings.push("reflection_is_not_a_question");
  }
  if (candidate.lead.text.trim().split(/\s+/).length < 12) {
    findings.push("lead_too_thin");
  }

  // Personalization: context was compiled and permitted, and nothing used it.
  if (
    prepared.request.context.length > 0 &&
    units.every((unit) => unit.context_refs.length === 0)
  ) {
    findings.push("context_supplied_but_unused");
  }

  // Repetition: the reader saw these words recently.
  for (const prior of prepared.request.prior_readings) {
    if (prior.headline.trim().toLowerCase() === candidate.headline.trim().toLowerCase()) {
      findings.push("headline_repeats_a_recent_reading");
    }
    if (prior.lead.trim().toLowerCase() === candidate.lead.text.trim().toLowerCase()) {
      findings.push("lead_repeats_a_recent_reading");
    }
  }

  // Tone: the product's voice is calm, precise, and non-mystifying.
  if (/!/.test(allText)) findings.push("exclamation");
  if (HYPE.test(allText)) findings.push("hype_vocabulary");

  return [...new Set(findings)];
}

export interface CorpusReport {
  corpus_version: string;
  gates: EvaluationGates;
  total: number;
  hard_pass: number;
  hard_fail: number;
  qualitative_findings: Record<string, number>;
  failures: Array<{ id: string; expected: string; actual: string; codes: string[] }>;
}

/**
 * An aggregate report, safe to print.
 *
 * Ids, verdicts, counts, and failure CODES only. No prompt, no candidate prose,
 * no context — the same rule the Worker's own logs follow, and the reason this
 * can be run against a real key and pasted into a rollout record.
 */
export function summarize(
  corpus: EvaluationCorpus,
  results: Array<{ result: CaseResult; qualitative: string[] }>,
): CorpusReport {
  const qualitative: Record<string, number> = {};
  for (const entry of results) {
    for (const finding of entry.qualitative) {
      qualitative[finding] = (qualitative[finding] ?? 0) + 1;
    }
  }
  const failures = results
    .filter((entry) => entry.result.actual !== entry.result.expected)
    .map((entry) => ({
      id: entry.result.id,
      expected: entry.result.expected,
      actual: entry.result.actual,
      codes: entry.result.failures.map((failure) => `${failure.code}.${failure.detail_code}`),
    }));

  return {
    corpus_version: corpus.corpus_version,
    gates: corpus.gates,
    total: results.length,
    hard_pass: results.length - failures.length,
    hard_fail: failures.length,
    qualitative_findings: qualitative,
    failures,
  };
}
