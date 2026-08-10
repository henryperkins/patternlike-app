import {
  DAILY_SKY_POLICY_ID,
  DAILY_SKY_POLICY_VERSION,
  LOCAL_DAY_RESOLUTION_POLICY_VERSION,
  M5_SCHEMA_VERSION,
  classifyV5CalculationFailure,
  type ChartSnapshot,
  type DailySkyRequest,
  type DailySkyResponse,
  type DailySkyResponseFailure,
  type DailySkyResponseSuccess,
  type DailySkyWindow,
  type NormalizedUncertainty,
  type SuppressedFeatureClass,
} from "@patternlike/shared";
import type { Env } from "../env.js";
import { toAssemblyUncertainty } from "./generation-command.js";

const DAILY_SKY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Three outcomes, not two, on exactly the same reasoning as `invokeCycles`.
 *
 * `refused` means the engine ran and said no; `unavailable` means the request
 * never reached a working engine. Only one of those is worth another delivery,
 * and `classifyV5CalculationFailure` is what turns the distinction into a
 * generation failure code rather than leaving it to each call site.
 */
export type DailySkyInvocation =
  | { ok: true; response: DailySkyResponseSuccess }
  | { ok: false; kind: "refused"; failure: DailySkyResponseFailure }
  | { ok: false; kind: "unavailable"; detail: string };

export interface DailySkyInputs {
  requestId: string;
  window: DailySkyWindow;
  /**
   * The active chart. Passed whole so the projection below is the only thing
   * that decides what leaves the trusted plane — a caller handed a
   * pre-projected object could quietly widen it.
   */
  chart: ChartSnapshot;
  /**
   * The ephemeris data vintage the caller expects, taken from the cycle scan
   * that ran moments earlier in the same freeze.
   *
   * Stating it rather than accepting whatever comes back is what makes a
   * mid-freeze deployment visible: two calculation calls answered by two
   * different data vintages would otherwise produce one command that claims a
   * single vintage it never had.
   */
  ephemerisDataVersion: string;
  calculationPolicyId: string;
  calculationPolicyVersion: string;
}

export class DailySkyRequestError extends Error {
  readonly code = "daily_sky_request_invalid";
  constructor(message: string) {
    super(message);
    this.name = "DailySkyRequestError";
  }
}

/**
 * Project the chart into the request, field by field.
 *
 * `ChartSnapshot` is never spread. It carries `user_id`, `fingerprint`, and a
 * whole `birth` object with the instant, timezone, and coordinates; a spread
 * would hand all of that to a service that has no decryption path and no reason
 * to see any of it. Every field below was chosen; nothing arrives by accident.
 *
 * Suppression is applied by not sending the input at all, which is the same rule
 * the chart engine follows for angles: a fact that is never computed cannot be
 * filtered back in later. M5 extends that to the natal Moon, which the frozen M3
 * cycle contract instead filters service-side. The stricter rule lives here
 * because this is a new boundary and tightening it costs nothing, while M3's is
 * frozen.
 */
export function buildDailySkyRequest(inputs: DailySkyInputs): DailySkyRequest {
  const { chart, window } = inputs;
  const uncertainty: NormalizedUncertainty = toAssemblyUncertainty(chart.uncertainty);
  const suppressed = new Set<SuppressedFeatureClass>(
    uncertainty.suppressed_features.map((f) => f.feature_class),
  );
  const anglesSuppressed = suppressed.has("angles") || suppressed.has("angle_transits");
  const moonSuppressed = suppressed.has("moon_time_sensitive");

  const natal_positions = chart.positions
    .filter((position) => {
      if (position.body === "ascendant" || position.body === "midheaven") {
        return !anglesSuppressed;
      }
      if (position.body === "moon") return !moonSuppressed;
      return true;
    })
    .map((position) => ({ body: position.body, longitude_deg: position.longitude_deg }));

  if (natal_positions.length === 0) {
    throw new DailySkyRequestError("no natal longitude survived suppression");
  }

  // Houses need a real birth time. `chart.houses` is already null for an
  // unknown-time chart, and the suppression list is checked as well so a future
  // engine that populated cusps anyway could not smuggle them past this.
  const cusps =
    !suppressed.has("houses") && chart.houses
      ? { house_system: chart.houses.system_used, cusps_deg: [...chart.houses.cusps_deg] }
      : null;

  return {
    schema_version: M5_SCHEMA_VERSION,
    request_id: inputs.requestId,
    day_start_at: window.dayStartAt,
    day_end_at: window.dayEndAt,
    anchor_at: window.anchorAt,
    anchor_resolution: window.anchorResolution,
    natal_positions,
    natal_house_cusps: cusps,
    effective_accuracy: uncertainty.accuracy,
    uncertainty,
    // Restated at the top level because the engine reads this list directly.
    // Derived from the same projection rather than from a second source, so the
    // two copies of one decision cannot disagree.
    suppressed_features: [...suppressed].sort(),
    zodiac: "tropical",
    node: "true",
    ephemeris_data_version: inputs.ephemerisDataVersion,
    tzdb_version: window.tzdbVersion,
    local_day_resolution_policy_version: LOCAL_DAY_RESOLUTION_POLICY_VERSION,
    daily_sky_policy_id: DAILY_SKY_POLICY_ID,
    daily_sky_policy_version: DAILY_SKY_POLICY_VERSION,
    calculation_policy_id: inputs.calculationPolicyId,
    calculation_policy_version: inputs.calculationPolicyVersion,
    contract_id: chart.contract_id,
    contract_version: chart.contract_version,
  };
}

/**
 * Call `POST /v1/daily-sky` on the calculation runtime.
 *
 * Mirrors `invokeCycles` and `invokeCalc`: the binding is plain HTTP so the
 * runtime can move without touching contracts.
 */
export async function invokeDailySky(
  env: Env,
  req: DailySkyRequest,
): Promise<DailySkyInvocation> {
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
    res = await fetch(`${base}/v1/daily-sky`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(DAILY_SKY_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "unavailable",
      detail: err instanceof Error ? err.message : "daily-sky fetch failed",
    };
  }

  // A non-200 never reached the engine, or the engine crashed before answering.
  // Either way the body is a transport envelope, not a dailySkyResponse.
  if (!res.ok) {
    return {
      ok: false,
      kind: "unavailable",
      detail: `calc /v1/daily-sky responded ${res.status}`,
    };
  }

  let json: DailySkyResponse;
  try {
    json = (await res.json()) as DailySkyResponse;
  } catch {
    return { ok: false, kind: "unavailable", detail: "calc /v1/daily-sky returned invalid JSON" };
  }

  if (!json || typeof json !== "object" || typeof json.ok !== "boolean") {
    return {
      ok: false,
      kind: "unavailable",
      detail: "calc /v1/daily-sky returned an unknown shape",
    };
  }
  if (!json.ok) return { ok: false, kind: "refused", failure: json };

  // The response echoes the day, the anchor, and every policy identifier the
  // request named. A mismatch means a build answered a question it was not
  // asked; freezing a command that misnames its own day would be worse than
  // failing here.
  if (
    json.schema_version !== req.schema_version ||
    json.request_id !== req.request_id ||
    json.day_start_at !== req.day_start_at ||
    json.day_end_at !== req.day_end_at ||
    json.anchor_at !== req.anchor_at ||
    json.anchor_resolution !== req.anchor_resolution ||
    json.effective_accuracy !== req.effective_accuracy ||
    json.tzdb_version !== req.tzdb_version ||
    json.ephemeris_data_version !== req.ephemeris_data_version ||
    json.daily_sky_policy_id !== req.daily_sky_policy_id ||
    json.daily_sky_policy_version !== req.daily_sky_policy_version ||
    json.calculation_policy_id !== req.calculation_policy_id ||
    json.calculation_policy_version !== req.calculation_policy_version ||
    json.contract_id !== req.contract_id ||
    json.contract_version !== req.contract_version
  ) {
    return {
      ok: false,
      kind: "unavailable",
      detail: "calc /v1/daily-sky echoed a different request, day, policy, or contract",
    };
  }

  const echoed = [...json.suppressed_features].sort().join(",");
  const asked = [...req.suppressed_features].sort().join(",");
  if (echoed !== asked) {
    return {
      ok: false,
      kind: "unavailable",
      detail: "calc /v1/daily-sky echoed a different suppression set",
    };
  }

  return { ok: true, response: json };
}

/** Which generation failure a refusal from this endpoint becomes. */
export function dailySkyFailureCode(failure: DailySkyResponseFailure) {
  return classifyV5CalculationFailure("daily_sky", failure.error_class);
}
