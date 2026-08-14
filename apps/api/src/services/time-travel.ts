import {
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  M4_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  canonicalJson,
  newId,
  type BirthTimeAccuracy,
  type DailySkyWindow,
  type NatalPositionInput,
  type NormalizedCycle,
  type ProjectedTimeTravelCycle,
  type TimeTravelDateState,
  type TimeTravelResponse,
} from "@patternlike/shared";
import { compareScored, computePhase, scoreFact } from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import {
  loadScanReceipt,
  persistScanReceipt,
  reserveScanBudget,
  type CachedScanReceipt,
  type ScanReceiptKey,
} from "../db/time-travel-receipts.js";
import { loadTimeTravelLifeEvents } from "../db/life-events.js";
import type { UserIdentity } from "../db/users.js";
import { buildCycleRequest, invokeCycles } from "./cycle-client.js";
import { localDateIn, resolveDailySkyWindow } from "./local-day.js";
import { resolveTimeTravelConfiguration } from "./time-travel-config.js";

interface ChartRow {
  id: string;
  fingerprint: string;
  contract_id: string;
  contract_version: string;
  birth_accuracy: BirthTimeAccuracy;
  snapshot_json: string;
  uncertainty_json: string;
}

interface Descriptor {
  localDate: string;
  referenceAt: string;
  window: DailySkyWindow;
  key: ScanReceiptKey;
}

interface ScanState {
  receipt: CachedScanReceipt;
  provenance: "cache" | "on_demand";
}

export class TimeTravelError extends Error {
  constructor(
    readonly code: "chart_not_found" | "timezone_confirmation_required" |
      "invalid_date" | "skipped_local_date" | "date_not_supported" |
      "time_travel_scan_budget_exhausted" | "calc_unavailable" |
      "time_travel_integrity_failure" | "time_travel_configuration_error",
    readonly status: 400 | 404 | 409 | 422 | 429 | 500 | 503,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new TimeTravelError("time_travel_integrity_failure", 500, `${label} is unreadable`);
  }
}

function chartInputs(chart: ChartRow): { positions: NatalPositionInput[]; suppressed: string[] } {
  const snapshot = parseRecord(chart.snapshot_json, "chart snapshot");
  const uncertainty = parseRecord(chart.uncertainty_json, "chart uncertainty");
  if (!Array.isArray(snapshot.positions)) {
    throw new TimeTravelError("time_travel_integrity_failure", 500, "chart positions are unreadable");
  }
  const positions = snapshot.positions.flatMap((value): NatalPositionInput[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    return typeof item.body === "string" && typeof item.longitude_deg === "number" && Number.isFinite(item.longitude_deg)
      ? [{ body: item.body as NatalPositionInput["body"], longitude_deg: item.longitude_deg }]
      : [];
  });
  if (positions.length === 0) {
    throw new TimeTravelError("time_travel_integrity_failure", 500, "chart has no normalized positions");
  }
  const rawSuppressed = uncertainty.suppressed_features;
  const suppressed = Array.isArray(rawSuppressed)
    ? rawSuppressed.flatMap((value) => {
        if (typeof value === "string") return [value];
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const featureClass = (value as Record<string, unknown>).feature_class;
        return typeof featureClass === "string" ? [featureClass] : [];
      })
    : [];
  return { positions, suppressed: [...new Set(suppressed)].sort() };
}

function descriptor(
  chart: ChartRow,
  timezone: string,
  localDate: string,
  referenceAt: string,
  window: DailySkyWindow,
  receiptEpoch: number,
): Descriptor {
  return {
    localDate,
    referenceAt,
    window,
    key: {
      userId: "",
      chartId: chart.id,
      chartFingerprint: chart.fingerprint,
      localDate,
      schedulingTimezone: timezone,
      windowFrom: window.dayStartAt,
      windowTo: window.dayEndAt,
      tzdbVersion: window.tzdbVersion,
      localDayResolutionPolicyVersion: window.localDayResolutionPolicyVersion,
      contractId: chart.contract_id,
      contractVersion: chart.contract_version,
      receiptEpoch,
    },
  };
}

function descriptorIdentity(value: Descriptor): string {
  const { localDate: _localDate, schedulingTimezone: _zone, chartId: _chartId, userId: _userId, ...lookup } = value.key;
  return canonicalJson(lookup);
}

function projectCycles(cycles: readonly NormalizedCycle[], referenceAt: string): ProjectedTimeTravelCycle[] {
  const scored = cycles.map((cycle) => {
    const phase = computePhase(cycle, referenceAt);
    return {
      cycle,
      phase,
      scored: scoreFact({
        id: cycle.id,
        fact_class: "cycle_instance",
        technique: cycle.technique,
        body: cycle.body,
        target: cycle.target,
        aspect: cycle.aspect,
        phase,
        orb_deg: cycle.orb_deg,
        first_exact_at: cycle.exact_at,
        pass_count: cycle.pass_count,
      }, {
        domainPreference: null,
        matchingCycleObject: null,
        seenRecently: false,
      }),
    };
  });
  scored.sort((a, b) => compareScored(a.scored, b.scored));
  return scored.map(({ cycle, phase }, index) => ({
    cycle,
    phase,
    rank: index + 1,
    dominant: index < 3,
  }));
}

export function compareTimeTravelStates(
  selected: readonly ProjectedTimeTravelCycle[],
  present: readonly ProjectedTimeTravelCycle[],
): TimeTravelResponse["comparison"] {
  const selectedById = new Map(selected.map((item) => [item.cycle.id, item]));
  const presentById = new Map(present.map((item) => [item.cycle.id, item]));
  const continuing = [...selectedById.keys()].filter((id) => presentById.has(id)).sort();
  return {
    continuing,
    selected_only: [...selectedById.keys()].filter((id) => !presentById.has(id)).sort(),
    present_only: [...presentById.keys()].filter((id) => !selectedById.has(id)).sort(),
    phase_changed: continuing.filter((id) => selectedById.get(id)!.phase !== presentById.get(id)!.phase),
  };
}

export async function buildTimeTravelResponse(
  env: Env,
  identity: UserIdentity,
  timezone: string,
  selectedDate: string,
  now = new Date(),
): Promise<TimeTravelResponse> {
  const userId = identity.userId;
  const config = resolveTimeTravelConfiguration(env);
  if (!config.ok) throw new TimeTravelError("time_travel_configuration_error", 503, config.message);
  const chart = await env.DB.prepare(
    `SELECT id, fingerprint, contract_id, contract_version, birth_accuracy,
            snapshot_json, uncertainty_json
     FROM chart_snapshots WHERE user_id = ? AND status = 'active'
     ORDER BY calculated_at DESC LIMIT 1`,
  ).bind(userId).first<ChartRow>();
  if (!chart) throw new TimeTravelError("chart_not_found", 404, "No active chart for user");
  const inputs = chartInputs(chart);

  let selectedResolution;
  let presentResolution;
  const currentDate = localDateIn(timezone, now);
  try {
    selectedResolution = resolveDailySkyWindow(timezone, selectedDate);
    presentResolution = selectedDate === currentDate
      ? selectedResolution
      : resolveDailySkyWindow(timezone, currentDate);
  } catch {
    throw new TimeTravelError("invalid_date", 400, "date must be a real local YYYY-MM-DD value");
  }
  if (!selectedResolution.ok) {
    throw new TimeTravelError("skipped_local_date", 422, "The scheduling zone skipped this civil date", {
      next_representable_date: selectedResolution.nextRepresentableDate,
    });
  }
  if (!presentResolution.ok) {
    throw new TimeTravelError("time_travel_integrity_failure", 500, "The current local date could not be resolved");
  }

  const nowIso = now.toISOString();
  const selected = descriptor(
    chart,
    timezone,
    selectedDate,
    selectedDate === currentDate ? nowIso : selectedResolution.window.anchorAt,
    selectedResolution.window,
    config.receiptEpoch,
  );
  const present = descriptor(
    chart,
    timezone,
    currentDate,
    nowIso,
    presentResolution.window,
    config.receiptEpoch,
  );
  selected.key.userId = userId;
  present.key.userId = userId;

  const selectedIdentity = descriptorIdentity(selected);
  const presentIdentity = descriptorIdentity(present);
  const unique = new Map<string, Descriptor>([[selectedIdentity, selected], [presentIdentity, present]]);
  const states = new Map<string, ScanState>();
  try {
    await Promise.all([...unique].map(async ([identity, value]) => {
      const cached = await loadScanReceipt(env, value.key);
      if (cached) states.set(identity, { receipt: cached, provenance: "cache" });
    }));
  } catch {
    throw new TimeTravelError("time_travel_integrity_failure", 500, "A cached reconstruction failed integrity checks");
  }
  const misses = [...unique].filter(([identity]) => !states.has(identity));
  const reservation = await reserveScanBudget(env, userId, misses.length, config.dailyScanLimit, now);
  if (!reservation.ok) {
    throw new TimeTravelError(
      "time_travel_scan_budget_exhausted",
      429,
      "The UTC-day reconstruction budget is exhausted",
      { resets_at: reservation.resetsAt },
      reservation.retryAfterSeconds,
    );
  }

  const outcomes = await Promise.all(misses.map(async ([identity, value]) => {
    const request = buildCycleRequest({
      requestId: newId("tts"),
      chartFingerprint: chart.fingerprint,
      natalAccuracy: chart.birth_accuracy,
      suppressedFeatures: inputs.suppressed as never,
      natalPositions: inputs.positions,
      window: { from: value.window.dayStartAt, to: value.window.dayEndAt },
      contractId: chart.contract_id,
      contractVersion: chart.contract_version,
    });
    const invocation = await invokeCycles(env, request);
    if (!invocation.ok) return { kind: "calc_failed", identity, invocation } as const;
    if (!invocation.response.container_digest || !invocation.response.ephemeris_data_version) {
      throw new TimeTravelError("time_travel_integrity_failure", 500, "Calculation provenance is incomplete");
    }
    try {
      const receipt = await persistScanReceipt(
        env,
        value.key,
        request,
        invocation.response,
        invocation.rawResponse,
        now,
      );
      return { kind: "persisted", identity, receipt } as const;
    } catch {
      throw new TimeTravelError("time_travel_integrity_failure", 500, "The reconstruction receipt could not be verified");
    }
  }));
  for (const outcome of outcomes) {
    // Discriminated on `kind`, not on `"invocation" in outcome`: a union of two
    // object literals normalises to optional-undefined members, so the `in`
    // form narrows to a type whose `invocation` is still possibly undefined.
    if (outcome.kind === "calc_failed") {
      if (outcome.invocation.kind === "refused") {
        throw new TimeTravelError("date_not_supported", 422, "The calculation policy does not support this date");
      }
      throw new TimeTravelError("calc_unavailable", 503, "The calculation service is unavailable");
    }
    states.set(outcome.identity, { receipt: outcome.receipt, provenance: "on_demand" });
  }

  const project = (value: Descriptor, identity: string): TimeTravelDateState => {
    const state = states.get(identity);
    if (!state) throw new TimeTravelError("time_travel_integrity_failure", 500, "A reconstruction state is missing");
    return {
      local_date: value.localDate,
      reference_at: value.referenceAt,
      provenance: state.provenance,
      calculated_at: state.receipt.createdAt,
      cycles: projectCycles(state.receipt.cycles, value.referenceAt),
    };
  };
  const selectedState = project(selected, selectedIdentity);
  const presentState = project(present, presentIdentity);
  const lifeEvents = await loadTimeTravelLifeEvents(env, identity, selectedDate);
  return {
    schema_version: M4_SCHEMA_VERSION,
    generated_at: nowIso,
    timezone,
    calculation_policy: {
      contract_id: chart.contract_id,
      contract_version: chart.contract_version,
      cycle_policy_id: CYCLE_POLICY_ID,
      cycle_policy_version: CYCLE_POLICY_VERSION,
      orb_policy_id: TRANSIT_ORB_POLICY_ID,
      orb_policy_version: TRANSIT_ORB_POLICY_VERSION,
      receipt_epoch: config.receiptEpoch,
    },
    selected: selectedState,
    present: presentState,
    comparison: compareTimeTravelStates(selectedState.cycles, presentState.cycles),
    saved_context: lifeEvents.savedContext,
    unreadable_context_count: lifeEvents.unreadableCount,
    life_event_source_state: lifeEvents.sourceState,
  };
}
