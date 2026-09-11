import type { PatternStateDocumentV9, PatternPortraitExplorerResponse, PortraitAutomationPreference } from "@patternlike/shared";

/** Client receipt time is not a backend job timestamp. No observation authorizes a server operation. */
export interface ReaderScope {
  accountId: string | null;
  sessionEpoch: number;
  chartId: string | null;
  profileVersion: number | null;
  source: string | null;
}
export interface Observation<T> {
  scope: ReaderScope;
  requestGeneration: number;
  observedAt: number;
  evidence: "known" | "unavailable";
  value: T;
}
export type PresentationCode = "needs_input" | "needs_permission" | "can_start" | "queued" | "working" | "ready" | "retryable_failure" | "paused" | "unavailable";
export type ReaderSurface = "daily" | "pattern" | "patternReplacement" | "artwork";
interface ActionTarget { surface: ReaderSurface; scope: ReaderScope; requestGeneration: number; }
type ReaderActionKind =
  | { type: "open_birth_details" }
  | { type: "confirm_locale"; preference: "locale" | "timezone" }
  | { type: "review_consent" }
  | { type: "start_generation" | "retry_generation" }
  | { type: "read_edition"; edition: string }
  | { type: "reload_status" };
export type ReaderAction = ActionTarget & ReaderActionKind;
export type ReadinessReason = "ready" | "chart_required" | "locale_required" | "timezone_required" | "consent_required" | "available" | "organizing_evidence" | "writing" | "checking_claims" | "preparing" | "failed" | "deleted" | "withdrawn" | "observation_unavailable" | "stale_observation" | "scope_mismatch" | "unsupported_artwork" | "automation_disabled" | "artwork_unavailable" | "not_generated";
export interface ReaderPresentation {
  code: PresentationCode;
  reason: ReadinessReason;
  text: string;
  observedAt: number | null;
  actions: ReaderAction[];
}
export type DailyObservation =
  | { kind: "ready"; edition: string }
  | { kind: "preparing" }
  | { kind: "needs_onboarding" }
  | { kind: "needs_preference"; preference: "timezone" | "locale" }
  | { kind: "needs_ai_consent" }
  | { kind: "absent" | "unavailable" };
export const READER_OBSERVATION_MAX_AGE_MS = 60_000;
export const READER_COPY: Record<ReadinessReason, string> = {
  ready: "Your reading is available.", chart_required: "Add a birth chart before a Pattern can be written.",
  locale_required: "Confirm your content language to generate a Pattern.", timezone_required: "Confirm your scheduling time zone.",
  consent_required: "Generate my Pattern", available: "Generate my Pattern",
  organizing_evidence: "Organizing the evidence", writing: "Writing your Pattern", checking_claims: "Checking the draft",
  preparing: "Preparing your reading.", failed: "This Pattern could not be finished.",
  deleted: "This Pattern was deleted and cannot be regenerated for this chart.", withdrawn: "The interpretation basis for this Pattern was withdrawn.",
  observation_unavailable: "Current status could not be checked. Reload status before starting more work.",
  stale_observation: "This status needs to be refreshed before starting more work.", scope_mismatch: "This status no longer matches the current account, chart, or edition.",
  unsupported_artwork: "Saved artwork supports four-chapter Patterns. Your complete reading remains available.",
  automation_disabled: "Automatic artwork is paused. Saved artwork and your reading remain available.",
  artwork_unavailable: "Optional artwork is unavailable. Your complete reading remains available.",
  not_generated: "No published reading is available yet. Check status again to see whether it has appeared.",
};
export function sameReaderScope(a: ReaderScope, b: ReaderScope): boolean {
  return a.accountId === b.accountId && a.sessionEpoch === b.sessionEpoch && a.chartId === b.chartId
    && a.profileVersion === b.profileVersion && a.source === b.source;
}
export function observationReason<T>(observation: Observation<T> | null | undefined, scope: ReaderScope, requestGeneration: number, now: number): ReadinessReason | null {
  if (!observation) return "observation_unavailable";
  if (!sameReaderScope(observation.scope, scope)) return "scope_mismatch";
  if (observation.requestGeneration !== requestGeneration || !Number.isFinite(observation.observedAt)
    || observation.observedAt > now || now - observation.observedAt > READER_OBSERVATION_MAX_AGE_MS) return "stale_observation";
  return observation.evidence === "known" ? null : "observation_unavailable";
}
export interface ReaderReadinessInput {
  scope: ReaderScope; requestGeneration: number; now: number;
  daily?: Observation<DailyObservation> | null;
  pattern?: Observation<PatternStateDocumentV9> | null;
  patternDocumentMatches?: boolean;
  /** Only set while authorized read access remains valid, never after recall, 401/403/404 or a source change. */
  retainAcceptedPattern?: boolean;
  chapterCount?: number;
  artwork?: Observation<PatternPortraitExplorerResponse> | null;
  automation?: Observation<PortraitAutomationPreference> | null;
}
export function selectReaderReadiness(input: ReaderReadinessInput): Record<ReaderSurface, ReaderPresentation> {
  const { scope, requestGeneration, now } = input;
  const make = (surface: ReaderSurface, code: PresentationCode, reason: ReadinessReason, observation?: Observation<unknown> | null, actions: ReaderActionKind[] = []): ReaderPresentation => ({
    code, reason, text: READER_COPY[reason], observedAt: observation?.observedAt ?? null,
    actions: actions.map(action => ({ ...action, surface, scope, requestGeneration })),
  });
  const reload = [{ type: "reload_status" as const }];
  const unavailable = (surface: ReaderSurface, observation?: Observation<unknown> | null) => make(surface, "unavailable", observationReason(observation, scope, requestGeneration, now) ?? "observation_unavailable", observation, reload);
  let daily = unavailable("daily", input.daily);
  if (input.daily && !observationReason(input.daily, scope, requestGeneration, now)) {
    const value = input.daily.value;
    switch (value.kind) {
      case "ready": daily = make("daily", "ready", "ready", input.daily, [{ type: "read_edition", edition: value.edition }]); break;
      case "preparing": daily = make("daily", "working", "preparing", input.daily, reload); break;
      case "needs_onboarding": daily = make("daily", "needs_input", "chart_required", input.daily, [{ type: "open_birth_details" }]); break;
      case "needs_preference": daily = make("daily", "needs_input", value.preference === "timezone" ? "timezone_required" : "locale_required", input.daily, [{ type: "confirm_locale", preference: value.preference }]); break;
      case "needs_ai_consent": daily = make("daily", "needs_permission", "consent_required", input.daily, [{ type: "review_consent" }]); break;
      case "absent": daily = make("daily", "unavailable", "not_generated", input.daily, reload); break;
    }
  }
  let pattern = unavailable("pattern", input.pattern);
  let patternReplacement = unavailable("patternReplacement", input.pattern);
  const observation = input.pattern;
  if (observation) {
    const state = observation.value;
    const fresh = !observationReason(observation, scope, requestGeneration, now);
    const matchesScope = sameReaderScope(observation.scope, scope) && state.chart?.chart_id === scope.chartId;
    if (matchesScope && state.state === "ready" && state.pattern && input.patternDocumentMatches && (fresh || input.retainAcceptedPattern)) {
      pattern = make("pattern", "ready", "ready", observation, [{ type: "read_edition", edition: `${state.pattern.pattern_id}:${state.pattern.generated_at}` }]);
    }
    if (fresh && (matchesScope || state.state === "chart_required")) {
      switch (state.state) {
        case "chart_required": pattern = make("pattern", "needs_input", "chart_required", observation, [{ type: "open_birth_details" }]); break;
        case "locale_confirmation_required": pattern = make("pattern", "needs_input", "locale_required", observation, [{ type: "confirm_locale", preference: "locale" }]); break;
        case "consent_required": pattern = make("pattern", "needs_permission", "consent_required", observation, state.consent ? [{ type: "review_consent" }] : reload); break;
        case "available": pattern = make("pattern", state.consent?.status === "granted" ? "can_start" : "needs_permission", "available", observation, state.consent?.status === "granted" ? [{ type: "start_generation" }] : reload); break;
        case "organizing_evidence": case "writing": case "checking_claims": pattern = make("pattern", "working", state.state, observation, reload); break;
        case "failed": {
          const canRetry = state.generation?.retryable === true && state.consent?.status === "granted";
          pattern = make("pattern", canRetry ? "retryable_failure" : "unavailable", "failed", observation, canRetry ? [{ type: "retry_generation" }, ...reload] : reload); break;
        }
        case "deleted": case "withdrawn": pattern = make("pattern", "unavailable", state.state, observation, reload); break;
      }
      const replacement = state.regeneration;
      if (state.state === "ready" && replacement) {
        if (replacement.generation) patternReplacement = make("patternReplacement", "working", replacement.generation.stage, observation, reload);
        else if (replacement.failure) {
          const canRetry = replacement.eligible === true && replacement.failure.retryable === true && state.consent?.status === "granted";
          patternReplacement = make("patternReplacement", canRetry ? "retryable_failure" : "unavailable", "failed", observation, canRetry ? [{ type: "retry_generation" }, ...reload] : reload);
        } else if (replacement.eligible && state.consent?.status === "granted") patternReplacement = make("patternReplacement", "can_start", "available", observation, [{ type: "start_generation" }]);
      }
    }
  }
  let artwork = unavailable("artwork", input.artwork);
  if (input.chapterCount !== undefined && input.chapterCount !== 4) artwork = make("artwork", "unavailable", "unsupported_artwork");
  else if (input.artwork && !observationReason(input.artwork, scope, requestGeneration, now) && input.artwork.value.status === "ready") artwork = make("artwork", "ready", "ready", input.artwork);
  else if (input.automation && !observationReason(input.automation, scope, requestGeneration, now) && input.automation.value.available && input.automation.value.chart_id === scope.chartId && !input.automation.value.enabled) artwork = make("artwork", "paused", "automation_disabled", input.automation);
  else if (input.artwork && !observationReason(input.artwork, scope, requestGeneration, now)) artwork = make("artwork", input.artwork.value.status === "generating" ? "working" : "unavailable", input.artwork.value.status === "generating" ? "preparing" : "artwork_unavailable", input.artwork, reload);
  return { daily, pattern, patternReplacement, artwork };
}
