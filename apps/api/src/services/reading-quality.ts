import type { PreparedConstrainedReadingInput } from "@patternlike/reading-engine";
import type { ReadingGenerationOutput } from "@patternlike/shared";

/**
 * Aggregate quality signals, deliberately separate from the hard gates.
 *
 * A reading that repeats yesterday's framing is worse; it is not wrong. Folding
 * these into publication would mean an honest unavailable state instead of a
 * slightly dull reading, which is the wrong trade for the reader. They are
 * scored, reported, and allowed to regress a threshold — not to reject a
 * candidate.
 *
 * Every finding is a closed lowercase token, never candidate prose, and the
 * counters are content-free by construction: they are durable alongside the
 * publication receipt, not a new exposure of reader text.
 *
 * This module deliberately has no dependency on the offline evaluation corpus,
 * so the production publication path can import it without pulling the frozen
 * fixture bundle into the Worker.
 */

export const QUALITATIVE_FINDING_CODES = [
  "reflection_is_not_a_question",
  "lead_too_thin",
  "context_supplied_but_unused",
  "headline_repeats_a_recent_reading",
  "lead_repeats_a_recent_reading",
  "exclamation",
  "hype_vocabulary",
] as const;

export type QualitativeFindingCode = (typeof QUALITATIVE_FINDING_CODES)[number];

const HYPE = /\b(?:amazing|incredible|unlock|manifest|destiny|magical|epic|game[- ]chang\w+)\b/i;

export function qualitativeFindings(
  prepared: PreparedConstrainedReadingInput,
  candidate: ReadingGenerationOutput,
): string[] {
  const findings: QualitativeFindingCode[] = [];
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