import type { CalcRequest, CalcResponse } from "@patternlike/shared";
import type { Env } from "../env.js";

export interface CalcInvocation {
  response: CalcResponse;
  latencyMs: number;
  timedOut: boolean;
}

export const MAX_CALC_RESPONSE_BYTES = 1024 * 1024;

function completeInvocation(
  startedAt: number,
  response: CalcResponse,
  timedOut: boolean,
): CalcInvocation {
  return {
    response,
    latencyMs: Math.max(0, performance.now() - startedAt),
    timedOut,
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The response is already refused; cancellation is best-effort.
  }
}

async function readBoundedCalcResponse(response: Response): Promise<CalcResponse> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength > MAX_CALC_RESPONSE_BYTES
    ) {
      await cancelResponseBody(response);
      throw new Error("calc response exceeded byte limit");
    }
  }

  if (!response.body) throw new Error("calc response body missing");

  const reader = response.body.getReader();
  const bytes = new Uint8Array(MAX_CALC_RESPONSE_BYTES);
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      if (next.value.byteLength > MAX_CALC_RESPONSE_BYTES - byteLength) {
        try {
          await reader.cancel();
        } catch {
          // The response is already refused; cancellation is best-effort.
        }
        throw new Error("calc response exceeded byte limit");
      }
      bytes.set(next.value, byteLength);
      byteLength += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const text = new TextDecoder().decode(bytes.subarray(0, byteLength));
  return JSON.parse(text) as CalcResponse;
}

/**
 * Call calculation runtime (Cloudflare Container / local calc-stub / Fly Machines).
 * Binding shape is HTTP for portability; swap URL without changing API contracts.
 */
export async function invokeCalc(
  env: Env,
  req: CalcRequest,
  timeoutMs: number,
): Promise<CalcInvocation> {
  const startedAt = performance.now();
  const base = env.CALC_SERVICE_URL?.replace(/\/$/, "") || "";
  if (!base) {
    return completeInvocation(
      startedAt,
      {
        ok: false,
        chart: null,
        error_class: "calc_unavailable",
        error_message: "CALC_SERVICE_URL not configured",
      },
      false,
    );
  }

  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (env.CALC_SERVICE_AUTH_TOKEN) {
      headers.authorization = `Bearer ${env.CALC_SERVICE_AUTH_TOKEN}`;
    }
    const res = await fetch(`${base}/v1/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal,
    });
    const response = await readBoundedCalcResponse(res);
    return completeInvocation(startedAt, response, false);
  } catch (err) {
    return completeInvocation(
      startedAt,
      {
        ok: false,
        chart: null,
        error_class: "calc_transport_error",
        error_message: err instanceof Error ? err.message : "calc fetch failed",
      },
      signal.aborted,
    );
  }
}
