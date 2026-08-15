import type {
  PatternFactPacket,
  PatternOntologyRecord,
  PatternPlannerOutput,
  PatternSelectionManifest,
  PatternWriterOutput,
} from "@patternlike/shared";

export interface ValidationFailure {
  code: string;
  message: string;
}

export interface OntologyCompileResult {
  ok: boolean;
  failures: ValidationFailure[];
}

export interface PatternSelectionResult {
  packet: PatternFactPacket;
  manifest: PatternSelectionManifest;
  /** Alias -> natal feature_id. Never sent to a provider. */
  aliasMap: Record<string, string>;
}

export interface PlanValidationResult {
  ok: boolean;
  failures: ValidationFailure[];
}

export interface CandidateValidationResult {
  ok: boolean;
  failures: ValidationFailure[];
}

export interface SelectionInput {
  locale: string;
  effectiveAccuracy: PatternFactPacket["effective_accuracy"];
  featureSetHash: string;
  features: readonly import("@patternlike/shared").NatalFeature[];
  ontology: readonly PatternOntologyRecord[];
}

export type { PatternPlannerOutput, PatternWriterOutput };
