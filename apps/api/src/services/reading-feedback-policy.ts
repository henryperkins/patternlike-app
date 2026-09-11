import { CATEGORIZED_FEEDBACK_SELECTION_VERSION } from "@patternlike/reading-engine";

/** New context semantics have their own pins; incumbent frozen commands remain supported. */
export const CATEGORIZED_FEEDBACK_PROMPT_VERSION = "1.0.4" as const;
export { CATEGORIZED_FEEDBACK_SELECTION_VERSION };

export function resolveFeedbackGenerationPolicy(raw: string | undefined) {
  const enabled = raw?.trim() ?? "";
  if (!["", "0", "1"].includes(enabled)) return null;
  return enabled === "1"
    ? { promptVersion: CATEGORIZED_FEEDBACK_PROMPT_VERSION, selectionVersion: CATEGORIZED_FEEDBACK_SELECTION_VERSION, categorical: true }
    : { promptVersion: "1.0.3", selectionVersion: "1.1.0", categorical: false };
}

export function supportsFeedbackGenerationPolicy(prompt: string, selection: string): boolean {
  return (prompt === "1.0.3" && selection === "1.1.0") ||
    (prompt === CATEGORIZED_FEEDBACK_PROMPT_VERSION && selection === CATEGORIZED_FEEDBACK_SELECTION_VERSION);
}
