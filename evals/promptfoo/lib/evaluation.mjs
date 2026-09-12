/**
 * The repository's Daily evaluation module, loaded once through tsx.
 *
 * `hardGateFindings` IS `validateReadingCandidate`; `prepareProfile` IS
 * `prepareConstrainedReadingInput`. Nothing in this directory re-implements a
 * rule, so a policy change is measured by the same code that enforces it.
 */
import { tsImport } from "tsx/esm/api";

let evaluationPromise;

export function loadEvaluation() {
  evaluationPromise ??= tsImport("../../../apps/api/src/services/reading-evaluation.ts", import.meta.url);
  return evaluationPromise;
}

/** Parse a provider output as a candidate; `null` when it is not JSON. */
export function parseCandidate(output) {
  if (typeof output !== "string") return output ?? null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

export const failureLabel = (failure) => `${failure.code}.${failure.detail_code}`;
