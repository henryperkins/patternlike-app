import { Hono, type Context } from "hono";
import { isUsablePortraitImage, PORTRAIT_CONSENT_POLICY_VERSION, type CodexPortraitCompletion, type CodexPortraitFailure, type PatternPortraitGenerationRequest } from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { loadUserIdentity } from "../db/users.js";
import { PortraitError, claimPortrait, completePortrait, failPortrait, portraitDownload, portraitImage, readPortrait, startPortrait } from "../services/pattern-portrait.js";

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;
export const patternPortraitRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
export const codexPortraitRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const MAX_COMPLETION_BYTES = 3 * 1024 * 1024;
const hashPattern = /^[0-9a-f]{64}$/;
const leasePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string,unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value,key)); }
function text(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value); }
async function boundedJson(request: Request, maximum: number): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maximum) throw new PortraitError(413,"payload_too_large");
  if (!request.body) throw new PortraitError(400,"invalid_request");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const next = await reader.read();if (next.done) break;length += next.value.byteLength;if (length > maximum) { await reader.cancel();throw new PortraitError(413,"payload_too_large"); }chunks.push(next.value); }
  const bytes = new Uint8Array(length);let offset=0;for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes)); } catch { throw new PortraitError(400,"invalid_request"); }
}
function decode64(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new PortraitError(400,"invalid_image");
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (bytes.length > maximum) throw new PortraitError(413,"payload_too_large");
  return bytes;
}
/** PNG structure is checked here; native evidence and actual decoding belong to the runner. */
function png(bytes: Uint8Array): boolean {
  if (bytes.length < 57 || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let offset=8;let first=true;let data=false;
  while (offset+12 <= bytes.length) {
    const length = view.getUint32(offset);if (length > bytes.length-offset-12) return false;
    const kind = String.fromCharCode(...bytes.slice(offset+4,offset+8));
    if (first) { if (kind !== "IHDR" || length !== 13 || view.getUint32(offset+8)<1 || view.getUint32(offset+8)>512 || view.getUint32(offset+12)<1 || view.getUint32(offset+12)>512) return false;first=false; }
    else if (kind === "IHDR" || kind === "acTL") return false;
    if (kind === "IDAT" && length>0) data=true;
    offset += length+12;
    if (kind === "IEND") return length===0 && data && offset===bytes.length;
  }
  return false;
}
function completion(value: unknown): CodexPortraitCompletion {
  if (!record(value) || !exact(value,["lease_token","source_sha256","label","rationale","image_base64","original_sha256","pixels","provider_request_id","image_request_id","image_model"]) || !text(value.lease_token,36) || !leasePattern.test(value.lease_token) || !text(value.source_sha256,71) || !hashPattern.test(value.source_sha256) || !text(value.original_sha256,71) || !hashPattern.test(value.original_sha256) || !text(value.label,80) || !text(value.rationale,800) || !text(value.provider_request_id,256) || !text(value.image_request_id,256) || value.image_model !== "gpt-image-2" || !record(value.pixels) || !exact(value.pixels,["width","height","rgba_base64"]) || value.pixels.width !== 128 || value.pixels.height !== 128) throw new PortraitError(400,"invalid_request");
  const pixels = decode64(value.pixels.rgba_base64,128*128*4);
  if (!png(decode64(value.image_base64,2*1024*1024)) || pixels.length !== 128*128*4 || !isUsablePortraitImage({width:128,height:128,data:new Uint8ClampedArray(pixels)})) throw new PortraitError(400,"invalid_image");
  return value as unknown as CodexPortraitCompletion;
}
async function respond(c: Ctx, work: () => Promise<Response>) {
  c.header("cache-control","private, no-store"); c.header("x-content-type-options","nosniff");
  try { return await work(); } catch (error) {
    if (error instanceof PortraitError) return c.json({ error:{ code:error.code,message:"Portrait request could not be completed",request_id:c.get("requestId") } },error.status);
    throw error;
  }
}
patternPortraitRoutes.get("/v1/pattern-portrait", (c) => respond(c,async () => c.json(await readPortrait(c.env,c.get("userId")))));
patternPortraitRoutes.post("/v1/pattern-portrait-generations", (c) => respond(c,async () => {
  const value = await boundedJson(c.req.raw,4096);
  if (!record(value) || !exact(value,["pattern_id","generated_at","chart_id","confirm","consent_policy_version"]) || !text(value.pattern_id,100) || !text(value.chart_id,100) || !text(value.generated_at,32) || value.confirm !== "CREATE MY PORTRAIT" || value.consent_policy_version !== PORTRAIT_CONSENT_POLICY_VERSION || !text(c.req.header("idempotency-key"),128) || c.req.header("idempotency-key")!.length < 8) throw new PortraitError(400,"invalid_request");
  const identity = await loadUserIdentity(c.env,c.get("userId"));
  if (!identity) throw new PortraitError(409,"portrait_revision_conflict");
  const result = await startPortrait(c.env,identity,value as unknown as PatternPortraitGenerationRequest);
  return c.json(result,result.status === "ready" ? 200 : 202);
}));
patternPortraitRoutes.get("/v1/pattern-portrait/images/:referenceId",(c) => respond(c,async () => {
  if (!/^ppimg_[a-f0-9]{32}$/.test(c.req.param("referenceId"))) throw new PortraitError(404,"portrait_image_not_found");
  const bytes = await portraitImage(c.env,c.get("userId"),c.req.param("referenceId"));
  c.header("content-type","image/png"); return c.body(bytes.slice().buffer);
}));
patternPortraitRoutes.get("/v1/pattern-portrait/download",(c) => respond(c,async () => {
  const bundle = await portraitDownload(c.env,c.get("userId"),new URL(c.req.url).searchParams);
  c.header("content-disposition",'attachment; filename="pattern-portrait.json"');return c.json(bundle);
}));
codexPortraitRoutes.post("/v1/portraits/claim",(c) => respond(c,async () => {
  const body = await boundedJson(c.req.raw,32);if (!record(body) || Object.keys(body).length !== 0) throw new PortraitError(400,"invalid_request");
  const claim = await claimPortrait(c.env);return claim ? c.json(claim) : c.body(null,204);
}));
codexPortraitRoutes.post("/v1/portraits/:jobId/complete",(c) => respond(c,async () => {
  if (!/^ppjob_[a-f0-9]{32}$/.test(c.req.param("jobId"))) throw new PortraitError(400,"invalid_request");
  await completePortrait(c.env,c.req.param("jobId"),completion(await boundedJson(c.req.raw,MAX_COMPLETION_BYTES)));
  return c.json({schema_version:"codex-portrait-terminal/v1",status:"accepted"});
}));
codexPortraitRoutes.post("/v1/portraits/:jobId/fail",(c) => respond(c,async () => {
  const value = await boundedJson(c.req.raw,1024);
  if (!/^ppjob_[a-f0-9]{32}$/.test(c.req.param("jobId")) || !record(value) || !exact(value,["lease_token","code"]) || !text(value.lease_token,36) || !leasePattern.test(value.lease_token) || !["generation_failed","generation_refused","image_invalid","authentication_failed"].includes(String(value.code))) throw new PortraitError(400,"invalid_request");
  await failPortrait(c.env,c.req.param("jobId"),value as unknown as CodexPortraitFailure);
  return c.json({schema_version:"codex-portrait-terminal/v1",status:"accepted"});
}));
