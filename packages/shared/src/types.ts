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
