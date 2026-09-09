import { canonicalJson, sha256Hex } from "@patternlike/shared";

/** Local prototype inputs. These are not API contracts or an authorization boundary. */
export type ReaderTarget =
  | { kind: "daily"; reading_id: string; revision: number; content_hash: string; paragraph_id: string }
  | { kind: "pattern"; pattern_id: string; document_revision: string; content_hash: string; chapter_index: number; chapter_source_sha256: string }
  | { kind: "timing"; cycle_id: string; cycle_hash: string; pass_index: number; starts_at: string; ends_at: string; exact_at: string; local_date: string; time_zone: string; policy_version: string };

export interface CalculatedFeature {
  chart: string;
  policy: string;
  kind: "natal_aspect" | "natal_house" | "transit_aspect";
  frame: "tropical_geocentric" | "sidereal_geocentric";
  participants: Array<{ body: string; role: "natal_subject" | "natal_object" | "transiting" | "natal_target" }>;
  coordinate: string;
  uncertainty_policy: string;
  requires_birth_time: boolean;
}

export interface NatalParticipant {
  chart: string;
  body: string;
  frame: CalculatedFeature["frame"];
  policy: string;
  role: "natal_interpretation" | "transit_target";
  requires_birth_time: boolean;
}

export interface AuthorizedReaderUnit {
  target: ReaderTarget;
  eligible: boolean;
  birth_time: "exact" | "unknown";
  features: CalculatedFeature[];
  participants: NatalParticipant[];
  /** A retained Daily date and its original zone/day interval, not today's settings. */
  day?: { chart: string; local_date: string; time_zone: string; starts_at: string; ends_at: string };
  /** A retained occurrence in this exact timing pass. */
  occurrence?: { chart: string; exact_at: string };
}

export type RelationshipKind = "shared_calculated_feature" | "shared_natal_participant" | "dated_occurrence";
export const RELATIONSHIP_REASONS: Record<RelationshipKind, string> = {
  shared_calculated_feature: "Both passages refer to the same calculated feature.",
  shared_natal_participant: "Both involve the same natal participant. The transit and natal interpretation describe different facts.",
  dated_occurrence: "This event falls on the date of this saved reading. A shared date does not establish a cause.",
};

export interface ReaderRelationship {
  id: string;
  from: ReaderTarget;
  to: ReaderTarget;
  kind: RelationshipKind;
  reason_code: RelationshipKind;
  support_digest: string;
  evidence_identity: string;
}

export interface ReaderRelationships {
  source: ReaderTarget;
  status: "available" | "no_supported_connection" | "unavailable";
  items: ReaderRelationship[];
  truncated: boolean;
}

export function readerTargetKey(target: ReaderTarget): string {
  return canonicalJson(target);
}

/** Inputs must already be owner-authorized. No newest-edition or ordinal fallback. */
export function exactReaderUnit(target: ReaderTarget, units: readonly AuthorizedReaderUnit[]): AuthorizedReaderUnit | undefined {
  const key = readerTargetKey(target);
  return units.find((unit) => unit.eligible && readerTargetKey(unit.target) === key);
}

function localDate(instant: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
  } catch {
    return null;
  }
}

function validTiming(target: Extract<ReaderTarget, { kind: "timing" }>): boolean {
  return Number.isInteger(target.pass_index) && target.pass_index >= 1
    && Date.parse(target.starts_at) <= Date.parse(target.exact_at)
    && Date.parse(target.exact_at) < Date.parse(target.ends_at)
    && localDate(target.exact_at, target.time_zone) === target.local_date;
}

function support(from: AuthorizedReaderUnit, to: AuthorizedReaderUnit): { kind: RelationshipKind; identity: unknown } | null {
  const route = `${from.target.kind}:${to.target.kind}`;
  if (!["daily:pattern", "daily:timing", "pattern:timing", "timing:daily"].includes(route)) return null;
  if (from.target.kind === "timing" && !validTiming(from.target)) return null;
  if (to.target.kind === "timing" && !validTiming(to.target)) return null;
  const supported = (requiresTime: boolean, unit: AuthorizedReaderUnit) => !requiresTime || unit.birth_time === "exact";
  for (const feature of from.features) {
    if (!supported(feature.requires_birth_time, from)) continue;
    if (to.features.some((candidate) => supported(candidate.requires_birth_time, to) && canonicalJson(candidate) === canonicalJson(feature))) {
      return { kind: "shared_calculated_feature", identity: feature };
    }
  }
  if (to.target.kind === "timing") {
    for (const participant of from.participants) {
      if (participant.role !== "natal_interpretation" || !supported(participant.requires_birth_time, from)) continue;
      const match = to.participants.find((candidate) => candidate.role === "transit_target"
        && candidate.chart === participant.chart && candidate.body === participant.body
        && candidate.frame === participant.frame && candidate.policy === participant.policy
        && supported(candidate.requires_birth_time, to));
      if (match) return { kind: "shared_natal_participant", identity: { natal: participant, transit: match } };
    }
  }
  const { occurrence } = from;
  const { day } = to;
  if (from.target.kind === "timing" && to.target.kind === "daily" && occurrence && day
    && occurrence.chart === day.chart && occurrence.exact_at === from.target.exact_at
    && day.local_date === from.target.local_date && day.time_zone === from.target.time_zone
    && localDate(occurrence.exact_at, day.time_zone) === day.local_date
    && Date.parse(day.starts_at) <= Date.parse(occurrence.exact_at)
    && Date.parse(occurrence.exact_at) < Date.parse(day.ends_at)) {
    return { kind: "dated_occurrence", identity: { occurrence, day, cycle: from.target } };
  }
  return null;
}

/** No prose/label matching, network, persistence, recalculation, or permission changes. */
export async function resolveReaderRelationships(source: ReaderTarget, authorizedUnits: readonly AuthorizedReaderUnit[]): Promise<ReaderRelationships> {
  const result: ReaderRelationships = { source, status: "unavailable", items: [], truncated: false };
  if (!exactReaderUnit(source, authorizedUnits)) return result;
  const units = authorizedUnits.filter((unit) => unit.eligible);
  const visited = new Set<string>([readerTargetKey(source)]);
  let frontier: ReaderTarget[] = [source];
  const kindOrder: RelationshipKind[] = ["shared_calculated_feature", "shared_natal_participant", "dated_occurrence"];
  for (let hop = 0; hop < 3 && frontier.length > 0; hop += 1) {
    const next: ReaderTarget[] = [];
    for (const target of frontier) {
      const from = exactReaderUnit(target, units)!;
      const candidates: ReaderRelationship[] = [];
      for (const to of units) {
        if (readerTargetKey(to.target) === readerTargetKey(target)) continue;
        const evidence = support(from, to);
        if (!evidence) continue;
        const evidenceIdentity = canonicalJson(evidence.identity);
        const digest = `sha256:${await sha256Hex(evidenceIdentity)}`;
        const identity = { schema_version: "reader-relationship/v1", from: target, to: to.target, kind: evidence.kind, support_digest: digest };
        candidates.push({ id: `reader-relationship:${await sha256Hex(canonicalJson(identity))}`, from: target, to: to.target, kind: evidence.kind, reason_code: evidence.kind, support_digest: digest, evidence_identity: evidenceIdentity });
      }
      candidates.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || readerTargetKey(a.to).localeCompare(readerTargetKey(b.to), "en"));
      if (candidates.length > 4) result.truncated = true;
      for (const edge of candidates.slice(0, 4)) {
        if (result.items.length >= 12) { result.truncated = true; continue; }
        result.items.push(edge);
        const key = readerTargetKey(edge.to);
        if (!visited.has(key)) { visited.add(key); next.push(edge.to); }
      }
    }
    frontier = next;
  }
  result.status = result.items.length ? "available" : "no_supported_connection";
  return result;
}
