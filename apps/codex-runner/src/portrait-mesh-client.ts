import { createHash } from "node:crypto";
import { canonicalJson, isCodexPortraitMeshClaim, isCodexPortraitMeshCompletion, isCodexPortraitMeshFailure, parsePortraitMeshProgram, PORTRAIT_MESH_COMPILER_VERSION, PORTRAIT_MESH_MAX_TRANSPORT_BYTES,
  type CodexPortraitMeshClaim, type CodexPortraitMeshCompletion, type CodexPortraitMeshFailure } from "@patternlike/shared";
import { CodexProviderClientError, type CodexProviderClientOptions } from "./client.js";
import { decodePortraitBase64 } from "./portrait-client.js";

const JOB = /^ppmesh_[a-f0-9]{32}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export function parsePortraitMeshClaim(value: unknown): CodexPortraitMeshClaim | null {
  if (!isCodexPortraitMeshClaim(value) || value.compiler_version !== PORTRAIT_MESH_COMPILER_VERSION
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value.model)) return null;
  return value;
}
export function validPortraitMeshCompletion(value: unknown): value is CodexPortraitMeshCompletion {
  if (!isCodexPortraitMeshCompletion(value) || value.compiler_version !== PORTRAIT_MESH_COMPILER_VERSION
    || !ID.test(value.provider_request_id) || !ID.test(value.audit_request_id) || value.provider_request_id === value.audit_request_id) return false;
  const program = parsePortraitMeshProgram(value.program);
  const glb = decodePortraitBase64(value.glb_base64, 750000);
  return !!program && sha(canonicalJson(program)) === value.program_sha256 && !!glb && glb.length >= 20
    && glb.toString("ascii", 0, 4) === "glTF" && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length && sha(glb) === value.glb_sha256;
}

export class CodexPortraitMeshClient {
  constructor(private readonly options: CodexProviderClientOptions) {}

  private async post(path: string, body: unknown, maximumBytes: number): Promise<{ status: number; value: unknown }> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > PORTRAIT_MESH_MAX_TRANSPORT_BYTES) throw new CodexProviderClientError("Mesh request is too large");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 30_000); timer.unref();
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.apiOrigin.replace(/\/$/, "")}${path}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.runnerToken}`, "content-type": "application/json", accept: "application/json", "cache-control": "no-store" }, body: serialized,
      });
      if (Number(response.headers.get("content-length")) > maximumBytes) { await response.body?.cancel(); throw new CodexProviderClientError("Mesh response is too large", response.status); }
      const chunks: Uint8Array[] = []; let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            length += next.value.length;
            if (length > maximumBytes) { await reader.cancel(); throw new CodexProviderClientError("Mesh response is too large", response.status); }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
      }
      if (response.status === 204 && length === 0) return { status: 204, value: null };
      if (response.status !== 200) throw new CodexProviderClientError("Mesh request failed", response.status);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new CodexProviderClientError("Invalid mesh content type", response.status);
      return { status: response.status, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) };
    } catch (error) {
      if (error instanceof CodexProviderClientError) throw error;
      throw new CodexProviderClientError("Mesh transport failed");
    } finally { clearTimeout(timer); }
  }

  async claim(): Promise<{ status: "empty" } | { status: "claimed"; claim: CodexPortraitMeshClaim }> {
    const response = await this.post("/codex-provider/v1/portrait-meshes/claim", {}, PORTRAIT_MESH_MAX_TRANSPORT_BYTES);
    if (response.status === 204) return { status: "empty" };
    const claim = parsePortraitMeshClaim(response.value);
    if (!claim) throw new CodexProviderClientError("Invalid mesh claim");
    return { status: "claimed", claim };
  }
  async complete(jobId: string, completion: CodexPortraitMeshCompletion): Promise<void> {
    if (!JOB.test(jobId) || !validPortraitMeshCompletion(completion)) throw new CodexProviderClientError("Invalid mesh completion");
    await this.terminal(jobId, "complete", completion);
  }
  async fail(jobId: string, failure: CodexPortraitMeshFailure): Promise<void> {
    if (!JOB.test(jobId) || !isCodexPortraitMeshFailure(failure)) throw new CodexProviderClientError("Invalid mesh failure");
    await this.terminal(jobId, "fail", failure);
  }
  private async terminal(jobId: string, operation: "complete" | "fail", body: CodexPortraitMeshCompletion | CodexPortraitMeshFailure): Promise<void> {
    const response = await this.post(`/codex-provider/v1/portrait-meshes/${jobId}/${operation}`, body, 1024);
    const value = response.value as Record<string, unknown> | null;
    if (response.status !== 200 || !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2
      || value.schema_version !== "codex-portrait-mesh-terminal/v1" || value.status !== "accepted") throw new CodexProviderClientError("Invalid mesh acknowledgement");
  }
}
