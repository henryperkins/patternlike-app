import type { ValidateFunction } from "ajv";
import { validateTodayResponseV5, validateEvidenceGraphV5 } from "../generated/reading-validators.js";

function assertProjection(validator: ValidateFunction, value: unknown): void {
  if (!validator(value)) {
    // The response body and validator errors may contain decrypted prose or
    // private reference values. The route-level error boundary needs only a
    // closed failure signal; it must not receive those details.
    throw new Error("Stored V5 product projection is invalid");
  }
}

function hasContiguousParagraphOrders(
  paragraphs: readonly { order: number }[],
): boolean {
  return paragraphs.every((paragraph, index) => paragraph.order === index + 1);
}

function hasValidTodayPolicy(value: unknown): boolean {
  const response = value as {
    reading: { paragraphs: Array<{ order: number; role: string }> };
  };
  const paragraphs = response.reading.paragraphs;
  return (
    hasContiguousParagraphOrders(paragraphs) &&
    paragraphs[0]?.role === "primary_theme"
  );
}

function hasValidEvidencePolicy(value: unknown): boolean {
  const response = value as {
    paragraphs: Array<{
      order: number;
      role: string;
      fact_refs: Array<{ fact_id: string }>;
    }>;
  };
  if (!hasContiguousParagraphOrders(response.paragraphs)) return false;
  // Grounding is asserted only where the writer guarantees it. The candidate
  // validator demands a fact of the lead unconditionally, and of any other unit
  // that makes an astrological claim; a supporting, phase, timing, or
  // collective paragraph carried entirely by personal context is a legitimate
  // published output, and `paragraphEvidenceV5.fact_refs` is `minItems: 0` for
  // that reason. A stricter read-side rule would not fail closed on a bad
  // artifact — it would 500 forever on a good one. The prose is not in this
  // graph, so `hasAstrologyClaim` cannot be re-derived here and is not guessed.
  const lead = response.paragraphs[0];
  if (!lead || lead.role !== "primary_theme" || lead.fact_refs.length === 0) {
    return false;
  }
  return response.paragraphs.every((paragraph) => {
    const factIds = paragraph.fact_refs.map((reference) => reference.fact_id);
    return new Set(factIds).size === factIds.length;
  });
}

export function assertM5TodayResponse(value: unknown): void {
  assertProjection(validateTodayResponseV5, value);
  if (!hasValidTodayPolicy(value)) {
    throw new Error("Stored V5 product projection is invalid");
  }
}

export function assertM5EvidenceResponse(value: unknown): void {
  assertProjection(validateEvidenceGraphV5, value);
  if (!hasValidEvidencePolicy(value)) {
    throw new Error("Stored V5 product projection is invalid");
  }
}
