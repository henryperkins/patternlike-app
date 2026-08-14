export type BirthTimeAccuracy = "exact" | "approximate" | "unknown";

export type CyclePhase =
  | "emerging"
  | "building"
  | "peak"
  | "reconsidering"
  | "integrating";

export type WorkflowName =
  | "NormalizeBirthAndCalculateChart"
  | "GenerateDailyReading"
  | "PublishContentRelease"
  | "ExportAccount"
  | "DeleteAccount"
  | "RefreshConnector";

export type CelestialBody =
  | "sun"
  | "moon"
  | "mercury"
  | "venus"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto"
  | "true_node"
  | "ascendant"
  | "midheaven";

export type AspectType =
  | "conjunction"
  | "sextile"
  | "square"
  | "trine"
  | "opposition";

/**
 * Evidence lane governing what a signal may influence and what it must never do.
 *
 * Frozen M0 vocabulary. `packages/reading-engine` still declares a structurally
 * identical copy; the two are assignable, and the engine's copy is retired in
 * favour of this one when it takes a dependency on this package.
 */
export type EvidenceLane = "celestial_facts" | "user_and_context" | "operational";

/**
 * User-facing life domains used for ranking and prompts. Not a clinical
 * taxonomy. Frozen M0 vocabulary; see the note on {@link EvidenceLane}.
 */
export type LifeDomain =
  | "self"
  | "relationships"
  | "work"
  | "creativity"
  | "home"
  | "body_energy"
  | "money_resources"
  | "learning"
  | "community"
  | "caregiving"
  | "spirituality_meaning"
  | "unspecified";

/**
 * Frozen M0 order. `unspecified` is a ranking remainder, not a topic a reader
 * can mute — exclusions are an explicit negative preference over named domains.
 */
export const LIFE_DOMAINS: readonly LifeDomain[] = [
  "self",
  "relationships",
  "work",
  "creativity",
  "home",
  "body_energy",
  "money_resources",
  "learning",
  "community",
  "caregiving",
  "spirituality_meaning",
  "unspecified",
] as const;

export type ExcludableLifeDomain = Exclude<LifeDomain, "unspecified">;

export const EXCLUDABLE_LIFE_DOMAINS: readonly ExcludableLifeDomain[] =
  LIFE_DOMAINS.filter(
    (domain): domain is ExcludableLifeDomain => domain !== "unspecified",
  );
