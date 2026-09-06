import type { PatternPortraitDownload, PatternPortraitResponse } from "./portrait-types.js";
import type { PatternResponseV7 } from "./m7-types.js";
import type { PortraitMeshProgram } from "./portrait-mesh-program.js";

export const PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION = "1.1.0" as const;
export const PORTRAIT_MESH_AUTHORING = "codex-parametric/v1" as const;
export const PORTRAIT_MESH_PROMPT_VERSION = "portrait-mesh/v1" as const;
export const PORTRAIT_MESH_MAX_TRANSPORT_BYTES = 3 * 1024 * 1024;
export interface PortraitAutomationPreference {
  schema_version: "portrait-automation/v1";
  available: boolean;
  chart_id: string | null;
  enabled: boolean;
  consent_policy_version: typeof PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION;
}
export interface PortraitAutomationRequest {
  chart_id: string;
  enabled: boolean;
  consent_policy_version: typeof PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION;
  confirm: "ENABLE AUTOMATIC PORTRAITS" | "DISABLE AUTOMATIC PORTRAITS";
}
export interface PortraitMeshModel {
  chapter_id: string;
  reference_id: string;
  sha256: string;
  source_image_sha256: string;
  source_text_sha256: string;
  source_text: string;
  program_sha256: string;
  compiler_version: string;
  authoring: typeof PORTRAIT_MESH_AUTHORING;
  document_revision: string;
}
export interface PatternPortraitExplorerResponse {
  schema_version: "pattern-portrait-explorer/v1";
  status: "unavailable" | "not_started" | "generating" | "failed" | "ready";
  portrait: PatternPortraitResponse;
  completed_models: number;
  retryable: boolean;
  models: PortraitMeshModel[];
}
export interface PortraitMeshAudit {
  schema_version: "portrait-mesh-audit/v1";
  accepted: true;
  recognizable: true;
  substantial: true;
  source_correspondence: true;
  no_severe_intersections: true;
  view_count: 4;
  notes: string;
}
export interface CodexPortraitMeshClaim {
  schema_version: "codex-portrait-mesh-claim/v1";
  job_id: string;
  portrait_id: string;
  chapter_index: number;
  chapter_id: string;
  lease_token: string;
  model: string;
  reasoning_effort: "xhigh";
  prompt_version: typeof PORTRAIT_MESH_PROMPT_VERSION;
  timeout_ms: number;
  source_text: string;
  source_text_sha256: string;
  source_image_sha256: string;
  document_revision: string;
  image_base64: string;
  compiler_version: string;
}
export interface CodexPortraitMeshCompletion {
  lease_token: string;
  program: PortraitMeshProgram;
  program_sha256: string;
  glb_base64: string;
  glb_sha256: string;
  compiler_version: string;
  audit: PortraitMeshAudit;
  provider_request_id: string;
  audit_request_id: string;
}
export interface CodexPortraitMeshFailure {
  lease_token: string;
  code:
    | "generation_failed"
    | "generation_refused"
    | "program_invalid"
    | "model_invalid"
    | "visual_check_failed"
    | "authentication_failed";
}
export interface PatternPortraitExplorerDownload {
  schema_version: "pattern-portrait-explorer-download/v1";
  reading: PatternResponseV7;
  explorer: PatternPortraitExplorerResponse;
  images: PatternPortraitDownload["images"];
  models: Array<{
    reference_id: string;
    content_type: "model/gltf-binary";
    sha256: string;
    data_base64: string;
    program: PortraitMeshProgram;
    audit: PortraitMeshAudit;
    provider_request_id: string;
    audit_request_id: string;
  }>;
}
const hash = /^[a-f0-9]{64}$/;
const lease = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const hashed = (v: unknown) => typeof v === "string" && hash.test(v);
const base64 = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= Math.ceil(max / 3) * 4 &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
export function isPortraitMeshAudit(v: unknown): v is PortraitMeshAudit {
  return (
    record(v) &&
    exact(v, [
      "schema_version",
      "accepted",
      "recognizable",
      "substantial",
      "source_correspondence",
      "no_severe_intersections",
      "view_count",
      "notes",
    ]) &&
    v.schema_version === "portrait-mesh-audit/v1" &&
    [
      v.accepted,
      v.recognizable,
      v.substantial,
      v.source_correspondence,
      v.no_severe_intersections,
    ].every((x) => x === true) &&
    v.view_count === 4 &&
    text(v.notes, 2000)
  );
}
export function isCodexPortraitMeshClaim(
  v: unknown,
): v is CodexPortraitMeshClaim {
  return (
    record(v) &&
    exact(v, [
      "schema_version",
      "job_id",
      "portrait_id",
      "chapter_index",
      "chapter_id",
      "lease_token",
      "model",
      "reasoning_effort",
      "prompt_version",
      "timeout_ms",
      "source_text",
      "source_text_sha256",
      "source_image_sha256",
      "document_revision",
      "image_base64",
      "compiler_version",
    ]) &&
    v.schema_version === "codex-portrait-mesh-claim/v1" &&
    text(v.job_id, 39) &&
    /^ppmesh_[a-f0-9]{32}$/.test(v.job_id) &&
    text(v.portrait_id, 100) &&
    Number.isInteger(v.chapter_index) &&
    Number(v.chapter_index) >= 0 &&
    Number(v.chapter_index) < 4 &&
    v.chapter_id === `chapter-${Number(v.chapter_index) + 1}` &&
    text(v.lease_token, 36) &&
    lease.test(v.lease_token) &&
    text(v.model, 100) &&
    v.reasoning_effort === "xhigh" &&
    v.prompt_version === PORTRAIT_MESH_PROMPT_VERSION &&
    Number.isInteger(v.timeout_ms) &&
    Number(v.timeout_ms) > 0 &&
    Number(v.timeout_ms) <= 900000 &&
    text(v.source_text, 65536) &&
    hashed(v.source_text_sha256) &&
    hashed(v.source_image_sha256) &&
    text(v.document_revision, 256) &&
    base64(v.image_base64, 2 * 1024 * 1024) &&
    text(v.compiler_version, 100) &&
    new TextEncoder().encode(JSON.stringify(v)).length <=
      PORTRAIT_MESH_MAX_TRANSPORT_BYTES
  );
}
/** Program geometry is validated separately by the trusted shared compiler schema. */
export function isCodexPortraitMeshCompletion(
  v: unknown,
): v is CodexPortraitMeshCompletion {
  return (
    record(v) &&
    exact(v, [
      "lease_token",
      "program",
      "program_sha256",
      "glb_base64",
      "glb_sha256",
      "compiler_version",
      "audit",
      "provider_request_id",
      "audit_request_id",
    ]) &&
    text(v.lease_token, 36) &&
    lease.test(v.lease_token) &&
    record(v.program) &&
    new TextEncoder().encode(JSON.stringify(v.program)).length <= 65536 &&
    hashed(v.program_sha256) &&
    base64(v.glb_base64, 750000) &&
    hashed(v.glb_sha256) &&
    text(v.compiler_version, 100) &&
    isPortraitMeshAudit(v.audit) &&
    text(v.provider_request_id, 256) &&
    text(v.audit_request_id, 256)
  );
}
export function isCodexPortraitMeshFailure(
  v: unknown,
): v is CodexPortraitMeshFailure {
  return (
    record(v) &&
    exact(v, ["lease_token", "code"]) &&
    text(v.lease_token, 36) &&
    lease.test(v.lease_token) &&
    [
      "generation_failed",
      "generation_refused",
      "program_invalid",
      "model_invalid",
      "visual_check_failed",
      "authentication_failed",
    ].includes(String(v.code))
  );
}
