import { isPortraitChapterCount, isRecordedPortraitImageModelProvenance,
  type CodexPortraitClaim, type CodexPortraitClaimV2, type CodexPortraitCompletion, type CodexPortraitFailure } from "@patternlike/shared";
import { CodexProviderClientError, type CodexProviderClientOptions } from "./client.js";

type PortraitLeaseBinding = { schema_version: "codex-portrait-claim/v1" } | Pick<CodexPortraitClaimV2,
  "schema_version" | "lease_token" | "source_sha256" | "chapter_count" | "chapter_index" | "chapter_id" | "document_revision">;

export const PORTRAIT_MAX_CLAIM_BYTES = 272 * 1024;
export const PORTRAIT_MAX_COMPLETION_BYTES = 3 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const LEASE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const JOB = /^ppjob_[a-f0-9]{32}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0");
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const binding = (value: Record<string, unknown>) => isPortraitChapterCount(value.chapter_count)
  && Number.isInteger(value.chapter_index) && Number(value.chapter_index) >= 0 && Number(value.chapter_index) < value.chapter_count
  && value.chapter_id === `chapter-${Number(value.chapter_index) + 1}` && text(value.document_revision, 256)
  && !/[\u0000-\u001f]/.test(value.document_revision);

export function parsePortraitClaim(value: unknown): CodexPortraitClaim | null {
  if (!record(value)) return null;
  const v2 = value.schema_version === "codex-portrait-claim/v2";
  if (!exact(value, ["schema_version", "job_id", "portrait_id", "chapter_index", "lease_token", "model", "reasoning_effort", "image_model", "prompt_version", "timeout_ms", "prompt", "source_sha256",
    ...(v2 ? ["chapter_count", "chapter_id", "document_revision"] : [])])
    || (!v2 && value.schema_version !== "codex-portrait-claim/v1") || (v2 && !binding(value)) || !matches(value.job_id, JOB)
    || !matches(value.portrait_id, /^ppor_[a-f0-9]{32}$/) || !matches(value.lease_token, LEASE)
    || !Number.isInteger(value.chapter_index) || (value.chapter_index as number) < 0 || (!v2 && (value.chapter_index as number) > 3)
    || !matches(value.model, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/) || value.reasoning_effort !== "xhigh"
    || value.image_model !== "gpt-image-2" || value.prompt_version !== "portrait-object-v1"
    || !Number.isSafeInteger(value.timeout_ms) || (value.timeout_ms as number) < 1 || (value.timeout_ms as number) > 900_000
    || !text(value.prompt, 256 * 1024) || Buffer.byteLength(value.prompt) > 256 * 1024 || !matches(value.source_sha256, HASH)) return null;
  return value as unknown as CodexPortraitClaim;
}

export function decodePortraitBase64(value: unknown, maximumBytes: number): Buffer | null {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumBytes / 3) * 4 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length <= maximumBytes && bytes.toString("base64") === value ? bytes : null;
}

export function validPortraitCompletion(value: CodexPortraitCompletion): boolean {
  const object = value as unknown;
  if (!record(object)) return false;
  const v2 = object.schema_version === "codex-portrait-completion/v2";
  if (!exact(object, ["lease_token", "source_sha256", "label", "rationale", "image_base64", "original_sha256", "pixels", "provider_request_id", "image_request_id", "image_model", ...(Object.hasOwn(object, "image_model_provenance") ? ["image_model_provenance"] : []),
    ...(v2 ? ["schema_version", "chapter_count", "chapter_index", "chapter_id", "document_revision"] : [])])
    || (Object.hasOwn(object, "schema_version") && !v2) || (v2 && !binding(object))
    || (Object.hasOwn(object, "image_model_provenance") && !isRecordedPortraitImageModelProvenance(object.image_model_provenance))) return false;
  const image = decodePortraitBase64(value.image_base64, 2 * 1024 * 1024);
  const pixels = record(value.pixels) && exact(value.pixels, ["width", "height", "rgba_base64"])
    ? decodePortraitBase64(value.pixels.rgba_base64, 128 * 128 * 4) : null;
  return LEASE.test(value.lease_token) && HASH.test(value.source_sha256) && HASH.test(value.original_sha256)
    && text(value.label, 80) && text(value.rationale, 800) && value.image_model === "gpt-image-2"
    && ID.test(value.provider_request_id) && ID.test(value.image_request_id)
    && image !== null && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && pixels !== null && pixels.length === 128 * 128 * 4 && value.pixels.width === 128 && value.pixels.height === 128;
}

export class CodexPortraitClient {
  private readonly claims = new Map<string, PortraitLeaseBinding>();
  constructor(private readonly options: CodexProviderClientOptions) {}

  private async post(path: string, body: unknown, maximumBytes: number): Promise<{ status: number; value: unknown }> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > PORTRAIT_MAX_COMPLETION_BYTES) throw new CodexProviderClientError("Portrait request is too large");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 30_000);
    timer.unref();
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.apiOrigin.replace(/\/$/, "")}${path}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.runnerToken}`, "content-type": "application/json", accept: "application/json", "cache-control": "no-store", "x-patternlike-portrait-protocol": "v2" },
        body: serialized,
      });
      const declared = Number(response.headers.get("content-length"));
      if (declared > maximumBytes) { await response.body?.cancel(); throw new CodexProviderClientError("Portrait response is too large", response.status); }
      const chunks: Uint8Array[] = []; let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            length += next.value.length;
            if (length > maximumBytes) { await reader.cancel(); throw new CodexProviderClientError("Portrait response is too large", response.status); }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
      }
      if (response.status === 204 && length === 0) return { status: 204, value: null };
      if (response.status !== 200) throw new CodexProviderClientError("Portrait request failed", response.status);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new CodexProviderClientError("Invalid portrait content type", response.status);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      return { status: response.status, value: JSON.parse(decoded) };
    } catch (error) {
      if (error instanceof CodexProviderClientError) throw error;
      throw new CodexProviderClientError("Portrait transport failed");
    } finally { clearTimeout(timer); }
  }

  async claim(): Promise<{ status: "empty" } | { status: "claimed"; claim: CodexPortraitClaim }> {
    const response = await this.post("/codex-provider/v1/portraits/claim", {}, PORTRAIT_MAX_CLAIM_BYTES);
    if (response.status === 204) return { status: "empty" };
    const claim = parsePortraitClaim(response.value);
    if (!claim) throw new CodexProviderClientError("Invalid portrait claim");
    this.claims.set(claim.job_id, claim.schema_version === "codex-portrait-claim/v2" ? {
      schema_version: claim.schema_version, lease_token: claim.lease_token, source_sha256: claim.source_sha256,
      chapter_count: claim.chapter_count, chapter_index: claim.chapter_index, chapter_id: claim.chapter_id,
      document_revision: claim.document_revision,
    } : { schema_version: claim.schema_version });
    return { status: "claimed", claim };
  }

  async complete(jobId: string, completion: CodexPortraitCompletion): Promise<void> {
    const claim = this.claims.get(jobId);
    const adaptive = "schema_version" in completion && completion.schema_version === "codex-portrait-completion/v2";
    if (!JOB.test(jobId) || !validPortraitCompletion(completion) || (adaptive && claim?.schema_version !== "codex-portrait-claim/v2")
      || (claim?.schema_version === "codex-portrait-claim/v2"
      && (!adaptive || !this.matchesClaim(completion, claim)))
      || (claim?.schema_version === "codex-portrait-claim/v1" && Object.hasOwn(completion, "schema_version"))) throw new CodexProviderClientError("Invalid portrait completion");
    await this.terminal(jobId, "complete", completion);
  }

  async fail(jobId: string, failure: CodexPortraitFailure): Promise<void> {
    const claim = this.claims.get(jobId);
    let body: CodexPortraitFailure = failure;
    if (claim?.schema_version === "codex-portrait-claim/v2" && record(failure) && exact(failure, ["lease_token", "code"])) body = {
      schema_version: "codex-portrait-failure/v2", chapter_count: claim.chapter_count, chapter_index: claim.chapter_index,
      chapter_id: claim.chapter_id, document_revision: claim.document_revision, source_sha256: claim.source_sha256,
      lease_token: failure.lease_token, code: failure.code,
    };
    if (!JOB.test(jobId) || !this.validFailure(body) || (("schema_version" in body) && claim?.schema_version !== "codex-portrait-claim/v2")
      || (claim?.schema_version === "codex-portrait-claim/v2"
      && (!("schema_version" in body) || body.schema_version !== "codex-portrait-failure/v2" || !this.matchesClaim(body, claim)))
      || (claim?.schema_version === "codex-portrait-claim/v1" && Object.hasOwn(body, "schema_version"))) throw new CodexProviderClientError("Invalid portrait failure");
    await this.terminal(jobId, "fail", body);
  }

  private matchesClaim(value: { lease_token: string; source_sha256: string; chapter_count: number; chapter_index: number; chapter_id: string; document_revision: string }, claim: Extract<PortraitLeaseBinding, { schema_version: "codex-portrait-claim/v2" }>): boolean {
    return value.lease_token === claim.lease_token && value.chapter_count === claim.chapter_count && value.chapter_index === claim.chapter_index
      && value.chapter_id === claim.chapter_id && value.document_revision === claim.document_revision && value.source_sha256 === claim.source_sha256;
  }

  private validFailure(value: CodexPortraitFailure): boolean {
    const object = value as unknown;
    if (!record(object)) return false;
    const v2 = object.schema_version === "codex-portrait-failure/v2";
    return exact(object, ["lease_token", "code", ...(v2 ? ["schema_version", "chapter_count", "chapter_index", "chapter_id", "document_revision", "source_sha256"] : [])])
      && (!Object.hasOwn(object, "schema_version") || v2) && (!v2 || (binding(object) && matches(object.source_sha256, HASH)))
      && matches(object.lease_token, LEASE) && ["generation_failed", "generation_refused", "image_invalid", "authentication_failed"].includes(String(object.code));
  }

  private async terminal(jobId: string, operation: "complete" | "fail", body: CodexPortraitCompletion | CodexPortraitFailure) {
    const response = await this.post(`/codex-provider/v1/portraits/${jobId}/${operation}`, body, 1024);
    const terminalSchema = "schema_version" in body ? "codex-portrait-terminal/v2" : "codex-portrait-terminal/v1";
    if (response.status !== 200 || !record(response.value) || !exact(response.value, ["schema_version", "status"])
      || response.value.schema_version !== terminalSchema || response.value.status !== "accepted") throw new CodexProviderClientError("Invalid portrait acknowledgement");
    this.claims.delete(jobId);
  }
}
