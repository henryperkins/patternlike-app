import type { ZodiacSignName } from "./daily-sky-types.js";

export const PORTRAIT_SCHEMA_VERSION = "pattern-portrait/v1" as const;
export const PORTRAIT_CONSENT_POLICY_VERSION = "1.0.0" as const;
export const PORTRAIT_ENGINE_VERSION = "constellation-v1" as const;

export interface PortraitGraph {
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
}

export interface PatternPortraitResponse {
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
  graph: PortraitGraph | null;
}

export interface PatternPortraitGenerationRequest {
  pattern_id: string;
  generated_at: string;
  chart_id: string;
  confirm: "CREATE MY PORTRAIT";
  consent_policy_version: typeof PORTRAIT_CONSENT_POLICY_VERSION;
}

export interface PatternPortraitDownload {
  schema_version: "pattern-portrait-download/v1";
  portrait: PatternPortraitResponse;
  images: Array<{
    reference_id: string;
    content_type: "image/png";
    sha256: string;
    data_base64: string;
  }>;
}

/** Opaque machine claim; only this chapter's full text enters its prompt. */
export interface CodexPortraitClaim {
  schema_version: "codex-portrait-claim/v1";
  job_id: string;
  portrait_id: string;
  chapter_index: number;
  lease_token: string;
  model: string;
  reasoning_effort: "xhigh";
  image_model: "gpt-image-2";
  prompt_version: string;
  timeout_ms: number;
  prompt: string;
  source_sha256: string;
}

/** PNG and samples are decoded from the one native generated image by the runner. */
export interface CodexPortraitCompletion {
  lease_token: string;
  source_sha256: string;
  label: string;
  rationale: string;
  image_base64: string;
  original_sha256: string;
  pixels: { width: number; height: number; rgba_base64: string };
  provider_request_id: string;
  image_request_id: string;
  image_model: "gpt-image-2";
}

export interface CodexPortraitFailure {
  lease_token: string;
  code: "generation_failed" | "generation_refused" | "image_invalid" | "authentication_failed";
}
