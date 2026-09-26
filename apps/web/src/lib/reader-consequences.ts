export type ConsequenceAction = "correct_birth" | "withdraw_pattern" | "withdraw_daily" | "disable_artwork" | "delete_pattern" | "withdraw_calculation";
type Effect = {
  content: "retained" | "invalidated" | "erased" | "unchanged" | null;
  unfinished: "stops" | "continues" | "unchanged" | null;
  future: "eligible" | "blocked" | "requires_permission" | "unchanged" | null;
};
export const CONSEQUENCE_COPY: Record<ConsequenceAction, string> = {
  correct_birth: "The previous chart is superseded and retained. Today readings based on its old facts may be withheld until a successor exists; historical Daily access follows its own rules. The previous Pattern and retained generation material are erased, and unfinished work for the old chart stops. If Pattern permission is still on, a Pattern for the corrected chart is written automatically and the same kind of minimized content is sent again; otherwise permission is required. Automatic artwork needs a separate grant for the new chart.",
  withdraw_pattern: "Your accepted Pattern and completed artwork are retained. Unfinished Pattern, replacement, and artwork work stops. Future Pattern generation requires permission again. Withdrawing also turns automatic artwork off, and granting Pattern permission again does not turn it back on.",
  withdraw_daily: "Published Daily readings are retained. Unfinished synthesis stops, and future synthesis requires permission again.",
  disable_artwork: "Turning this off stops unfinished and future portraits. Saved portraits remain until you delete their Pattern; your written reading stays available.",
  delete_pattern: "This Pattern is removed from your account and cannot be written again for this chart. Saved artwork is erased; download it first if you want to keep it. Encrypted provider copies of the requests and the prose follow the 30-day deletion schedule. Unfinished replacements and portraits stop. Your Daily readings and calculated chart are unchanged.",
  withdraw_calculation: "Your account freezes and retained account content stops being served until calculation permission is restored. Withdrawing permission does not automatically erase that data.",
};
export function selectReaderConsequences(action: ConsequenceAction, observation: {
  observedAt: number | null; evidence: "known" | "unavailable";
  receipt?: "none" | "accepted" | "choice_saved" | "content_unavailable";
  standingPatternConsent?: boolean;
}) {
  const unchanged: Effect = { content: "unchanged", unfinished: "unchanged", future: "unchanged" };
  const effects: Record<"chart" | "daily" | "pattern" | "artwork", Effect> = {
    chart: { ...unchanged }, daily: { ...unchanged }, pattern: { ...unchanged }, artwork: { ...unchanged },
  };
  switch (action) {
    case "correct_birth":
      effects.chart = { ...unchanged, content: "retained" };
      effects.daily = { content: "invalidated", unfinished: "stops", future: "unchanged" };
      effects.pattern = { content: "erased", unfinished: "stops", future: observation.standingPatternConsent === undefined ? null : observation.standingPatternConsent ? "eligible" : "requires_permission" };
      effects.artwork = { content: "erased", unfinished: "stops", future: "requires_permission" }; break;
    case "withdraw_pattern":
      effects.pattern = { content: "retained", unfinished: "stops", future: "requires_permission" };
      effects.artwork = { content: "retained", unfinished: "stops", future: "requires_permission" }; break;
    case "withdraw_daily": effects.daily = { content: "retained", unfinished: "stops", future: "requires_permission" }; break;
    case "disable_artwork": effects.artwork = { content: "retained", unfinished: "stops", future: "blocked" }; break;
    case "delete_pattern":
      effects.pattern = { content: "erased", unfinished: "stops", future: "blocked" };
      effects.artwork = { content: "erased", unfinished: "stops", future: "blocked" }; break;
    case "withdraw_calculation":
      for (const resource of Object.keys(effects) as Array<keyof typeof effects>) effects[resource] = { content: "retained", unfinished: "stops", future: "requires_permission" };
  }
  if (observation.evidence === "unavailable") for (const resource of Object.keys(effects) as Array<keyof typeof effects>) effects[resource] = { content: null, unfinished: null, future: null };
  return { action, observedAt: observation.observedAt, evidence: observation.evidence, effects,
    reason: observation.evidence === "unavailable" ? "observation_unavailable" as const : null,
    receipt: observation.receipt ?? "none", erasureCompleted: null,
    text: observation.evidence === "known" ? CONSEQUENCE_COPY[action] : "Current consequences could not be checked. Reload the current state before continuing.",
  };
}
