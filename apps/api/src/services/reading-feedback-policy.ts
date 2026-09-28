import {
  CATEGORIZED_FEEDBACK_SELECTION_VERSION,
  SELECTION_POLICY_VERSION,
} from "@patternlike/reading-engine";

/** Both prompt variants include typed Daily uncertainty; older tuples fail closed. */
export const CATEGORIZED_FEEDBACK_PROMPT_VERSION = "1.1.1" as const;
export { CATEGORIZED_FEEDBACK_SELECTION_VERSION };

export function resolveFeedbackGenerationPolicy(raw: string | undefined) {
  const enabled = raw?.trim() ?? "";
  if (!["", "0", "1"].includes(enabled)) return null;
  return enabled === "1"
    ? { promptVersion: CATEGORIZED_FEEDBACK_PROMPT_VERSION, selectionVersion: CATEGORIZED_FEEDBACK_SELECTION_VERSION, categorical: true }
    : { promptVersion: "1.1.0", selectionVersion: SELECTION_POLICY_VERSION, categorical: false };
}

export function supportsFeedbackGenerationPolicy(prompt: string, selection: string): boolean {
  return (prompt === "1.1.0" && selection === SELECTION_POLICY_VERSION) ||
    (prompt === CATEGORIZED_FEEDBACK_PROMPT_VERSION && selection === CATEGORIZED_FEEDBACK_SELECTION_VERSION);
}
