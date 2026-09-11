import { Hono, type Context } from "hono";
import {
  isCodexPortraitMeshCompletion,
  isCodexPortraitMeshFailure,
  PORTRAIT_MESH_MAX_TRANSPORT_BYTES,
  PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION,
  PORTRAIT_AUTOMATION_V2_CONSENT_POLICY_VERSION,
  type PortraitAutomationRequest,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { PortraitError } from "../services/pattern-portrait.js";
import {
  readPortraitAutomation,
  setPortraitAutomation,
  readPortraitExplorer,
  portraitModel,
  portraitExplorerDownload,
  claimPortraitMesh,
  completePortraitMesh,
  failPortraitMesh,
} from "../services/pattern-portrait-mesh.js";
import { PORTRAIT_PROTOCOL_HEADER, portraitProtocol } from "../services/portrait-protocol.js";
type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;
export const portraitMeshRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();
export const codexPortraitMeshRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();
async function json(request: Request, max: number): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > max)
    throw new PortraitError(413, "payload_too_large");
  if (!request.body) throw new PortraitError(400, "invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.length;
    if (length > max) {
      await reader.cancel();
      throw new PortraitError(413, "payload_too_large");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new PortraitError(400, "invalid_request");
  }
}
async function respond(c: Ctx, work: () => Promise<Response>) {
  c.header("cache-control", "private, no-store");
  c.header("x-content-type-options", "nosniff");
  c.header("Vary", PORTRAIT_PROTOCOL_HEADER);
  try {
    portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER));
    return await work();
  } catch (error) {
    if (error instanceof PortraitError)
      return c.json(
        {
          error: {
            code: error.code,
            message: "Portrait request could not be completed",
            request_id: c.get("requestId"),
          },
        },
        error.status,
      );
    throw error;
  }
}
portraitMeshRoutes.get("/v1/pattern-portrait/automation", (c) =>
  respond(c, async () =>
    c.json(await readPortraitAutomation(c.env, c.get("userId"), portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)))),
  ),
);
portraitMeshRoutes.put("/v1/pattern-portrait/automation", (c) =>
  respond(c, async () => {
    const value = (await json(c.req.raw, 2048)) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 4 ||
      typeof value.chart_id !== "string" ||
      value.chart_id.length < 1 ||
      value.chart_id.length > 100 ||
      typeof value.enabled !== "boolean" ||
      ![PORTRAIT_AUTOMATION_CONSENT_POLICY_VERSION, PORTRAIT_AUTOMATION_V2_CONSENT_POLICY_VERSION].includes(value.consent_policy_version as "1.1.0" | "2.0.0") ||
      (value.consent_policy_version === PORTRAIT_AUTOMATION_V2_CONSENT_POLICY_VERSION && portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)) !== "v2") ||
      value.confirm !==
        (value.enabled
          ? "ENABLE AUTOMATIC PORTRAITS"
          : "DISABLE AUTOMATIC PORTRAITS")
    )
      throw new PortraitError(400, "invalid_request");
    return c.json(
      await setPortraitAutomation(
        c.env,
        c.get("userId"),
        value as unknown as PortraitAutomationRequest,
        portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)),
      ),
    );
  }),
);
portraitMeshRoutes.get("/v1/pattern-portrait/explorer", (c) =>
  respond(c, async () =>
    c.json(await readPortraitExplorer(c.env, c.get("userId"), portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)))),
  ),
);
portraitMeshRoutes.get("/v1/pattern-portrait/models/:referenceId", (c) =>
  respond(c, async () => {
    const id = c.req.param("referenceId");
    if (!/^ppmodel_[a-f0-9]{32}$/.test(id))
      throw new PortraitError(404, "portrait_model_not_found");
    const bytes = await portraitModel(c.env, c.get("userId"), id, portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)));
    c.header("content-type", "model/gltf-binary");
    return c.body(bytes.slice().buffer);
  }),
);
portraitMeshRoutes.get("/v1/pattern-portrait/explorer/download", (c) =>
  respond(c, async () => {
    const bundle = await portraitExplorerDownload(
      c.env,
      c.get("userId"),
      new URL(c.req.url).searchParams,
      portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)),
    );
    c.header(
      "content-disposition",
      'attachment; filename="pattern-portrait-complete.json"',
    );
    return c.json(bundle);
  }),
);
codexPortraitMeshRoutes.post("/v1/portrait-meshes/claim", (c) =>
  respond(c, async () => {
    const value = await json(c.req.raw, 32);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new PortraitError(400, "invalid_request");
    const claim = await claimPortraitMesh(c.env, new Date(), portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)));
    return claim ? c.json(claim) : c.body(null, 204);
  }),
);
codexPortraitMeshRoutes.post("/v1/portrait-meshes/:jobId/complete", (c) =>
  respond(c, async () => {
    const id = c.req.param("jobId");
    const value = await json(c.req.raw, PORTRAIT_MESH_MAX_TRANSPORT_BYTES);
    if (
      !/^ppmesh_[a-f0-9]{32}$/.test(id) ||
      !isCodexPortraitMeshCompletion(value) ||
      ("schema_version" in value && portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)) !== "v2")
    )
      throw new PortraitError(400, "invalid_request");
    await completePortraitMesh(c.env, id, value);
    return c.json({
      schema_version: "schema_version" in value ? "codex-portrait-mesh-terminal/v2" : "codex-portrait-mesh-terminal/v1",
      status: "accepted",
    });
  }),
);
codexPortraitMeshRoutes.post("/v1/portrait-meshes/:jobId/fail", (c) =>
  respond(c, async () => {
    const id = c.req.param("jobId");
    const value = await json(c.req.raw, 1024);
    if (!/^ppmesh_[a-f0-9]{32}$/.test(id) || !isCodexPortraitMeshFailure(value) || ("schema_version" in value && portraitProtocol(c.req.header(PORTRAIT_PROTOCOL_HEADER)) !== "v2"))
      throw new PortraitError(400, "invalid_request");
    await failPortraitMesh(c.env, id, value);
    return c.json({
      schema_version: "schema_version" in value ? "codex-portrait-mesh-terminal/v2" : "codex-portrait-mesh-terminal/v1",
      status: "accepted",
    });
  }),
);
