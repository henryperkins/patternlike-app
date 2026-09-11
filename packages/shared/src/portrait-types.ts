import type { ZodiacSignName } from "./daily-sky-types.js";

export const PORTRAIT_SCHEMA_VERSION = "pattern-portrait/v1" as const;
export const PORTRAIT_CONSENT_POLICY_VERSION = "1.0.0" as const;
export const PORTRAIT_ENGINE_VERSION = "constellation-v1" as const;

/** The CLI version is locally verified; native image identity is not exposed. */
export interface RecordedPortraitImageModelProvenance {
  schema_version: "portrait-image-model-provenance/v1";
  requested_image_model: "gpt-image-2";
  observed_image_model: null;
  observation_status: "not_exposed";
  codex_cli_version: "0.153.3";
}

/** A read projection of historical metadata, never a new provider attestation. */
export interface LegacyPortraitImageModelProvenance {
  schema_version: "portrait-image-model-provenance/v1";
  requested_image_model: string | null;
  observed_image_model: null;
  observation_status: "legacy_unrecorded";
  codex_cli_version: null;
}

export type PortraitImageModelProvenance = RecordedPortraitImageModelProvenance | LegacyPortraitImageModelProvenance;

export interface PortraitGraphV1 {
  engine_version: typeof PORTRAIT_ENGINE_VERSION;
  positions: number[];
  source_indices: number[];
  star_strengths: number[];
  connections: Array<[number, number]>;
  color: [number, number, number];
  contributions: Array<{
    index: number;
    aspect: number;
    coverage: number;
    opening_area: number;
    skew: number;
    stars: number;
    interior_lines: number;
  }>;
}

export interface PatternPortraitChapter {
  chapter_id: string;
  reference_id: string;
  label: string;
  rationale: string;
  reference_sha256: string;
  source_text: string;
  /** Optional only for compatibility with older API responses. */
  image_model_provenance?: PortraitImageModelProvenance;
}

export interface PatternPortraitResponseV1 {
  schema_version: typeof PORTRAIT_SCHEMA_VERSION;
  status: "unavailable" | "not_started" | "generating" | "failed" | "ready";
  portrait_id: string | null;
  pattern_id: string | null;
  generated_at: string | null;
  chart_id: string | null;
  document_revision: string | null;
  sun_sign: ZodiacSignName | null;
  completed_chapters: number;
  retryable: boolean;
  chapters: PatternPortraitChapter[];
  graph: PortraitGraphV1 | null;
}

export interface PatternPortraitGenerationRequestV1 {
  pattern_id: string;
  generated_at: string;
  chart_id: string;
  confirm: "CREATE MY PORTRAIT";
  consent_policy_version: typeof PORTRAIT_CONSENT_POLICY_VERSION;
}

export interface PatternPortraitDownloadV1 {
  schema_version: "pattern-portrait-download/v1";
  portrait: PatternPortraitResponseV1;
  images: Array<{
    reference_id: string;
    content_type: "image/png";
    sha256: string;
    data_base64: string;
    image_model_provenance?: PortraitImageModelProvenance;
  }>;
}

/** Opaque machine claim; only this chapter's full text enters its prompt. */
export interface CodexPortraitClaimV1 {
  schema_version: "codex-portrait-claim/v1";
  job_id: string;
  portrait_id: string;
  chapter_index: number;
  lease_token: string;
  model: string;
  reasoning_effort: "xhigh";
  /** Requested/configured image model; the native tool does not attest it. */
  image_model: "gpt-image-2";
  prompt_version: string;
  timeout_ms: number;
  prompt: string;
  source_sha256: string;
}

/** PNG and samples are decoded from the one native generated image by the runner. */
export interface CodexPortraitCompletionV1 {
  lease_token: string;
  source_sha256: string;
  label: string;
  rationale: string;
  image_base64: string;
  original_sha256: string;
  pixels: { width: number; height: number; rgba_base64: string };
  provider_request_id: string;
  image_request_id: string;
  /** Legacy wire alias for the requested model, never observed identity. */
  image_model: "gpt-image-2";
  /** Absent on legacy completions; the Worker must not backfill observation. */
  image_model_provenance?: RecordedPortraitImageModelProvenance;
}

export interface CodexPortraitFailureV1 {
  lease_token: string;
  code: "generation_failed" | "generation_refused" | "image_invalid" | "authentication_failed";
}

export const PORTRAIT_V2_SCHEMA_VERSION = "pattern-portrait/v2" as const;
export const PORTRAIT_V2_CONSENT_POLICY_VERSION = "2.0.0" as const;
export const PORTRAIT_V2_ENGINE_VERSION = "constellation-v2" as const;
export type PortraitChapterCount = 3 | 4 | 5 | 6;
export function isPortraitChapterCount(value: unknown): value is PortraitChapterCount {
  return value === 3 || value === 4 || value === 5 || value === 6;
}
export interface PortraitChapterBindingV2 {
  chapter_count: PortraitChapterCount;
  chapter_index: number;
  chapter_id: string;
  document_revision: string;
}
export interface PortraitGraphV2 extends Omit<PortraitGraphV1, "engine_version"> {
  engine_version: typeof PORTRAIT_V2_ENGINE_VERSION;
  chapter_count: PortraitChapterCount;
}
export interface PatternPortraitResponseV2 extends Omit<PatternPortraitResponseV1, "schema_version" | "graph"> {
  schema_version: typeof PORTRAIT_V2_SCHEMA_VERSION;
  chapter_count: PortraitChapterCount | null;
  graph: PortraitGraphV2 | null;
}
export interface PatternPortraitGenerationRequestV2 extends Omit<PatternPortraitGenerationRequestV1, "consent_policy_version"> {
  chapter_count: PortraitChapterCount;
  consent_policy_version: typeof PORTRAIT_V2_CONSENT_POLICY_VERSION;
}
export interface PatternPortraitDownloadV2 extends Omit<PatternPortraitDownloadV1, "schema_version" | "portrait"> {
  schema_version: "pattern-portrait-download/v2";
  portrait: PatternPortraitResponseV2;
}
export interface CodexPortraitClaimV2 extends Omit<CodexPortraitClaimV1, "schema_version">, PortraitChapterBindingV2 {
  schema_version: "codex-portrait-claim/v2";
}
export interface CodexPortraitCompletionV2 extends CodexPortraitCompletionV1, PortraitChapterBindingV2 {
  schema_version: "codex-portrait-completion/v2";
}
export interface CodexPortraitFailureV2 extends CodexPortraitFailureV1, PortraitChapterBindingV2 {
  schema_version: "codex-portrait-failure/v2";
  source_sha256: string;
}
export type PortraitGraph = PortraitGraphV1 | PortraitGraphV2;
export type PatternPortraitResponse = PatternPortraitResponseV1 | PatternPortraitResponseV2;
export type PatternPortraitGenerationRequest = PatternPortraitGenerationRequestV1 | PatternPortraitGenerationRequestV2;
export type PatternPortraitDownload = PatternPortraitDownloadV1 | PatternPortraitDownloadV2;
export type CodexPortraitClaim = CodexPortraitClaimV1 | CodexPortraitClaimV2;
export type CodexPortraitCompletion = CodexPortraitCompletionV1 | CodexPortraitCompletionV2;
export type CodexPortraitFailure = CodexPortraitFailureV1 | CodexPortraitFailureV2;
