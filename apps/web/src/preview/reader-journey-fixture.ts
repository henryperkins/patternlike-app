import { canonicalJson, sha256Hex } from "@patternlike/shared";
import { createPortraitManifest } from "../lib/pattern-portrait.js";
import type { AuthorizedReaderUnit, CalculatedFeature, NatalParticipant, ReaderTarget } from "../lib/reader-relationships.js";
import { fictionalPattern } from "./pattern-portrait-fixture.js";

export const JOURNEY_SCENARIOS = {
  normal: "Complete fictional journey",
  missing_source: "Today is no longer available",
  replaced_source: "Today's edition was replaced",
  missing_pattern: "Pattern is no longer available",
  replaced_pattern: "Pattern's edition was replaced",
  inaccessible_timing: "Timing is no longer accessible",
  unknown_time: "Unknown birth time: unsupported evidence",
  no_support: "No supported connection",
} as const;
export type JourneyScenario = keyof typeof JOURNEY_SCENARIOS;

export interface FictionalReaderDocument {
  target: ReaderTarget;
  title: string;
  dateLabel: string;
  paragraphs: string[];
}

export interface ReaderJourneyFixture {
  source: ReaderTarget;
  documents: FictionalReaderDocument[];
  units: AuthorizedReaderUnit[];
  chapters: Array<{ title: string; paragraphs: string[] }>;
}

/** Every date, interpretation, and support coordinate here is authored fiction. */
export async function createReaderJourneyFixture(scenario: JourneyScenario = "normal"): Promise<ReaderJourneyFixture> {
  const manifest = createPortraitManifest(fictionalPattern);
  const chapter = manifest.chapters[2]!;
  const todayText = "A promise can stay meaningful even when its shape needs to change. Before you add another commitment, look at one you already carry: what still supports you, and what could be made smaller?";
  const historyText = "You might give one familiar routine a little more room. Keep the part that steadies you; let the rest meet the life you are actually living.";
  const source: ReaderTarget = { kind: "daily", reading_id: "fictional_daily_20260909", revision: 1, content_hash: `sha256:${await sha256Hex(canonicalJson({ todayText, local_date: "2026-09-09", revision: 1 }))}`, paragraph_id: "fictional_today_primary" };
  const pattern: ReaderTarget = {
    kind: "pattern", pattern_id: fictionalPattern.pattern_id, document_revision: manifest.revision,
    content_hash: `sha256:${await sha256Hex(canonicalJson(fictionalPattern))}`, chapter_index: 2,
    chapter_source_sha256: await sha256Hex(JSON.stringify({ title: chapter.title, summary: chapter.summary, sections: chapter.sections, tensions: chapter.tensions, resources: chapter.resources, counterExpression: chapter.counterExpression })),
  };
  const timing: ReaderTarget = { kind: "timing", cycle_id: "fictional_cycle_saturn_sun", cycle_hash: await sha256Hex("fictional retained cycle: Saturn square natal Sun, pass 2, 2026-09-02T11:35:00Z"), pass_index: 2, starts_at: "2026-08-22T00:00:00Z", ends_at: "2026-09-18T00:00:00Z", exact_at: "2026-09-02T11:35:00Z", local_date: "2026-09-02", time_zone: "America/New_York", policy_version: "fictional-cycle-policy/v1" };
  const saved: ReaderTarget = { kind: "daily", reading_id: "fictional_saved_20260902", revision: 2, content_hash: `sha256:${await sha256Hex(canonicalJson({ historyText, local_date: "2026-09-02", revision: 2 }))}`, paragraph_id: "fictional_saved_primary" };
  const feature: CalculatedFeature = { chart: "fictional_chart_a", policy: "fictional-features/v1", kind: "natal_aspect", frame: "tropical_geocentric", participants: [{ body: "Sun", role: "natal_subject" }, { body: "Saturn", role: "natal_object" }], coordinate: "trine:120deg", uncertainty_policy: "fictional-exact/v1", requires_birth_time: false };
  const natal: NatalParticipant = { chart: feature.chart, body: "Sun", frame: feature.frame, policy: feature.policy, role: "natal_interpretation", requires_birth_time: false };
  const base = { eligible: true, birth_time: "exact" as const };
  let units: AuthorizedReaderUnit[] = [
    { ...base, target: source, features: [feature], participants: [natal] },
    { ...base, target: pattern, features: [structuredClone(feature)], participants: [structuredClone(natal)] },
    { ...base, target: timing, features: [], participants: [{ ...natal, role: "transit_target" }], occurrence: { chart: feature.chart, exact_at: timing.exact_at } },
    { ...base, target: saved, features: [], participants: [], day: { chart: feature.chart, local_date: "2026-09-02", time_zone: "America/New_York", starts_at: "2026-09-02T04:00:00Z", ends_at: "2026-09-03T04:00:00Z" } },
  ];
  const documents: FictionalReaderDocument[] = [
    { target: source, title: "Room inside a commitment", dateLabel: "Wednesday, September 9, 2026", paragraphs: [todayText, "A useful question for today: what would keeping this promise look like at a scale you can sustain?"] },
    { target: pattern, title: chapter.title, dateLabel: "Pattern · Chapter 3 of 4 · September 5, 2026", paragraphs: [chapter.summary, ...chapter.sections] },
    { target: timing, title: "A moment to revisit your commitments", dateLabel: "Timing · September 2, 2026 · 7:35 am · America/New_York", paragraphs: ["This fictional timing result follows Saturn's square to the natal Sun. It is a temporary transit; the Pattern chapter describes a different, natal aspect.", "The second pass falls inside an August 22–September 18 envelope. This is the retained September 2 occurrence, not a new calculation for today."] },
    { target: saved, title: "Keep the part that steadies you", dateLabel: "Saved Daily · September 2, 2026 · Revision 2", paragraphs: [historyText, "This fictional saved edition stays as it was written. Sharing a date with the event does not prove that the reading used the event or that the event caused an experience."] },
  ];
  if (scenario === "missing_source") units = units.filter((unit) => unit.target !== source);
  if (scenario === "replaced_source") units[0] = { ...units[0]!, target: { ...source, revision: 2, content_hash: `sha256:${await sha256Hex("fictional replacement Daily")}` } };
  if (scenario === "missing_pattern") units = units.filter((unit) => unit.target !== pattern);
  if (scenario === "replaced_pattern") units[1] = { ...units[1]!, target: { ...pattern, document_revision: `${manifest.revision}:replacement`, content_hash: `sha256:${await sha256Hex("fictional replacement Pattern")}` } };
  if (scenario === "inaccessible_timing") units[2] = { ...units[2]!, eligible: false };
  if (scenario === "unknown_time") units = units.map((unit) => ({ ...unit, birth_time: "unknown", features: unit.features.map((value) => ({ ...value, kind: "natal_house", coordinate: "house:4", requires_birth_time: true })), participants: unit.participants.map((value) => ({ ...value, body: "Ascendant", requires_birth_time: true })) }));
  if (scenario === "no_support") units = units.map((unit) => ({ ...unit, features: [], participants: [], occurrence: undefined, day: undefined }));
  return { source, documents, units, chapters: manifest.chapters.map((value) => ({ title: value.title, paragraphs: [value.summary, ...value.sections, ...value.tensions, ...value.resources, value.counterExpression] })) };
}
