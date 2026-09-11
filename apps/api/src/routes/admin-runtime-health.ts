import { Hono } from "hono";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import { recordRuntimeHealthAccess, sampleRuntimeHealth } from "../services/runtime-health.js";

export const adminRuntimeHealthRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
adminRuntimeHealthRoutes.get("/runtime-health", async c => {
  const now = new Date();
  const purposes = new URL(c.req.url).searchParams.getAll("purpose");
  const valid = purposes.length===1 && purposes[0]==="incident_response";
  const failure = (code: string) => ({error:{code,message:"Runtime health observation is unavailable",request_id:c.get("requestId")}});
  try {
    if (!valid) {
      await recordRuntimeHealthAccess(c.env,c.get("adminSubject"),"denied",now);
      return c.json(failure("invalid_admin_purpose"),400);
    }
    const response = await sampleRuntimeHealth(c.env,now);
    const partial = response.work_classes.some(value=>value.observation==="unavailable") || response.publication.observation==="unavailable";
    await recordRuntimeHealthAccess(c.env,c.get("adminSubject"),partial ? "unavailable":"granted",now);
    return c.json(response);
  } catch {
    return c.json(failure("runtime_health_unavailable"),503);
  }
});
