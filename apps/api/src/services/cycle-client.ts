import {
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  M3_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  type CycleRequest,
  type CycleResponse,
  type CycleResponseFailure,
  type CycleResponseSuccess,
} from "@patternlike/shared";
import type { Env } from "../env.js";

/**
 * Three outcomes, not two, and the distinction is load-bearing.
 *
 * `refused` means the engine ran and said no — an unsupported body, an
 * ephemeris-range date, an unprovable encounter. `unavailable` means the request
 * never reached a working engine: a transport error, a credential failure, a
 * 5xx. Only the second is a `calc_unavailable` command-replacement reason, and
 * only that reason lets the scheduler re-freeze the day unattended. Collapsing
 * the two would either brick a user-day over a transient outage or silently
 * re-run a scan that will refuse again for the same good reason.
 *
 * The calculation service already draws the line this way: it reports credential
 * failures in the transport envelope with a 4xx/5xx status and every engine-level
 * refusal as a 200 carrying `ok: false`.
 */
export type CycleInvocation =
  | { ok: true; response: CycleResponseSuccess }
  | { ok: false; kind: "refused"; failure: CycleResponseFailure }
  | { ok: false; kind: "unavailable"; detail: string };

const CALC_REQUEST_TIMEOUT_MS = 10_000;

export interface CycleScanInputs {
  requestId: string;
  chartFingerprint: string;
  /** The EFFECTIVE accuracy the chart engine recomputed, never the caller's label. */
  natalAccuracy: CycleRequest["natal_accuracy"];
  suppressedFeatures?: CycleRequest["suppressed_features"];
  natalPositions: CycleRequest["natal_positions"];
  /** Selection interval — the scanner still proves boundaries outside it. */
  window: { from: string; to: string };
  contractId: string;
  contractVersion: string;
}

/**
 * Build the scan request.
 *
 * Natal longitudes and nothing else: no user id, birth instant, timezone, or
 * coordinate crosses this boundary, so the calculation service never acquires a
 * decryption path and "birth stays encrypted at rest" survives the surface.
 *
 * The policy identifiers come from `@patternlike/shared`, which is also where the
 * calculation service reads them, because it refuses any request naming a policy
 * it does not implement.
 */
export function buildCycleRequest(inputs: CycleScanInputs): CycleRequest {
  const request: CycleRequest = {
    schema_version: M3_SCHEMA_VERSION,
    request_id: inputs.requestId,
    chart_fingerprint: inputs.chartFingerprint,
    natal_positions: inputs.natalPositions,
    natal_accuracy: inputs.natalAccuracy,
    window: inputs.window,
    techniques: ["transits"],
    cycle_policy_id: CYCLE_POLICY_ID,
    cycle_policy_version: CYCLE_POLICY_VERSION,
    orb_policy_id: TRANSIT_ORB_POLICY_ID,
    orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
    contract_id: inputs.contractId,
    contract_version: inputs.contractVersion,
  };
  if (inputs.suppressedFeatures?.length) {
    request.suppressed_features = inputs.suppressedFeatures;
  }
  return request;
}

/**
 * Call `POST /v1/cycles` on the calculation runtime.
 *
 * Mirrors `invokeCalc`: the binding is plain HTTP so the runtime can move
 * without touching contracts.
 */
export async function invokeCycles(
  env: Env,
  req: CycleRequest,
): Promise<CycleInvocation> {
  const base = env.CALC_SERVICE_URL?.replace(/\/$/, "") || "";
  if (!base) {
    return { ok: false, kind: "unavailable", detail: "CALC_SERVICE_URL not configured" };
  }

  let res: Response;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (env.CALC_SERVICE_AUTH_TOKEN) {
      headers.authorization = `Bearer ${env.CALC_SERVICE_AUTH_TOKEN}`;
    }
    res = await fetch(`${base}/v1/cycles`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(CALC_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "unavailable",
      detail: err instanceof Error ? err.message : "cycle fetch failed",
    };
  }

  // A non-200 never reached the engine, or the engine crashed before answering.
  // Either way the body is a transport envelope, not a cycleResponse, and the
  // status is the only thing that distinguishes "refused" from "never arrived".
  if (!res.ok) {
    return {
      ok: false,
      kind: "unavailable",
      detail: `calc /v1/cycles responded ${res.status}`,
    };
  }

  let json: CycleResponse;
  try {
    json = (await res.json()) as CycleResponse;
  } catch {
    return { ok: false, kind: "unavailable", detail: "calc /v1/cycles returned invalid JSON" };
  }

  if (!json || typeof json !== "object" || typeof json.ok !== "boolean") {
    return { ok: false, kind: "unavailable", detail: "calc /v1/cycles returned an unknown shape" };
  }
  if (!json.ok) return { ok: false, kind: "refused", failure: json };

  // The response echoes the request's policy identifiers, and a mismatch means
  // a build answered for a policy it was not asked about. Fail closed rather
  // than freeze a command that misnames the scan it pinned.
  if (
    json.cycle_policy_id !== req.cycle_policy_id ||
    json.cycle_policy_version !== req.cycle_policy_version ||
    json.orb_policy_id !== req.orb_policy_id ||
    json.orb_policy_version !== req.orb_policy_version ||
    json.chart_fingerprint !== req.chart_fingerprint
  ) {
    return {
      ok: false,
      kind: "unavailable",
      detail: "calc /v1/cycles echoed a different policy or chart than it was asked for",
    };
  }

  return { ok: true, response: json };
}
