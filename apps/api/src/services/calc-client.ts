import type { CalcRequest, CalcResponse } from "@patternlike/shared";
import type { Env } from "../env.js";

/**
 * Call calculation runtime (Cloudflare Container / local calc-stub / Fly Machines).
 * Binding shape is HTTP for portability; swap URL without changing API contracts.
 */
export async function invokeCalc(
  env: Env,
  req: CalcRequest,
): Promise<CalcResponse> {
  const base = env.CALC_SERVICE_URL?.replace(/\/$/, "") || "";
  if (!base) {
    return {
      ok: false,
      chart: null,
      error_class: "calc_unavailable",
      error_message: "CALC_SERVICE_URL not configured",
    };
  }

  try {
    const res = await fetch(`${base}/v1/calculate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as CalcResponse;
    return json;
  } catch (err) {
    return {
      ok: false,
      chart: null,
      error_class: "calc_transport_error",
      error_message: err instanceof Error ? err.message : "calc fetch failed",
    };
  }
}
