import { Hono } from "hono";
import {
  M3_SCHEMA_VERSION,
  type NormalizedCycle,
} from "@patternlike/shared";
import {
  computePhase,
  type CyclePhase,
} from "@patternlike/reading-engine";
import type { Env } from "../env.js";
import { safeLog } from "../services/safe-log.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  loadTimingSnapshot,
  type TimingSnapshot,
} from "../db/timing.js";
import { loadPreferences } from "../db/preferences.js";
import { localDateIn } from "../services/local-day.js";

export type TimingPhaseFilter = CyclePhase | "upcoming";
export type TimingDurationFilter = "short" | "medium" | "long";

export interface TimingFilters {
  phase: TimingPhaseFilter | null;
  duration: TimingDurationFilter | null;
}

interface TimingPassResponse {
  pass_index: number;
  direction: "direct" | "retrograde";
  exact_at: string;
}

interface TimingCycleResponse {
  cycle_id: string;
  technique: "transit";
  body: NormalizedCycle["body"];
  target: string;
  aspect: NormalizedCycle["aspect"];
  status: "active" | "upcoming";
  phase: CyclePhase | null;
  start_at: string;
  exact_at: string;
  end_at: string;
  duration_days: number;
  orb_deg: number;
  passes: TimingPassResponse[];
}

export interface TimingResponse {
  schema_version: typeof M3_SCHEMA_VERSION;
  as_of: string;
  calculation_status: {
    mode: "persisted_daily_reading_scan";
    state: "current" | "stale" | "not_scanned";
    last_refresh_at: string | null;
    last_refresh_local_date: string | null;
  };
  applied_filters: TimingFilters;
  unreadable_cycle_count: number;
  cycles: TimingCycleResponse[];
}

const PHASE_FILTERS = new Set<TimingPhaseFilter>([
  "emerging",
  "building",
  "peak",
  "reconsidering",
  "integrating",
  "upcoming",
]);
const DURATION_FILTERS = new Set<TimingDurationFilter>([
  "short",
  "medium",
  "long",
]);
const ALLOWED_FILTERS = new Set(["phase", "duration"]);
const DAY_MS = 86_400_000;

function parseTimingFilters(
  queries: Record<string, string[]>,
): TimingFilters | null {
  if (Object.keys(queries).some((key) => !ALLOWED_FILTERS.has(key))) return null;

  const phaseValues = queries.phase;
  const durationValues = queries.duration;
  if (phaseValues && phaseValues.length !== 1) return null;
  if (durationValues && durationValues.length !== 1) return null;

  const phase = phaseValues?.[0] ?? null;
  const duration = durationValues?.[0] ?? null;
  if (phase !== null && !PHASE_FILTERS.has(phase as TimingPhaseFilter)) return null;
  if (duration !== null && !DURATION_FILTERS.has(duration as TimingDurationFilter)) {
    return null;
  }
  return {
    phase: phase as TimingPhaseFilter | null,
    duration: duration as TimingDurationFilter | null,
  };
}

function matchesDuration(
  durationDays: number,
  filter: TimingDurationFilter | null,
): boolean {
  if (filter === null) return true;
  if (filter === "short") return durationDays < 90;
  if (filter === "medium") return durationDays >= 90 && durationDays < 365;
  return durationDays >= 365;
}

function matchesPhase(
  cycle: TimingCycleResponse,
  filter: TimingPhaseFilter | null,
): boolean {
  if (filter === null) return true;
  if (filter === "upcoming") return cycle.status === "upcoming";
  return cycle.phase === filter;
}

interface SortableCycle {
  cycle: TimingCycleResponse;
  bucket: 0 | 1;
  sortAt: number;
}

export function projectTimingResponse(input: {
  asOf: string;
  currentLocalDate: string;
  snapshot: TimingSnapshot;
  filters: TimingFilters;
}): TimingResponse {
  const asOfInstant = Date.parse(input.asOf);
  const projected: SortableCycle[] = input.snapshot.cycles.map((cycle) => {
    const startAt = Date.parse(cycle.start_at);
    const endAt = Date.parse(cycle.end_at);
    const passInstants = cycle.passes.map((pass) => Date.parse(pass.exact_at));
    const status =
      startAt <= asOfInstant && asOfInstant <= endAt
        ? "active"
        : startAt > asOfInstant
          ? "upcoming"
          : null;
    if (status === null) {
      throw new Error("Stored Timing cycle was outside the eligible read window");
    }
    const phase = status === "active" ? computePhase(cycle, input.asOf) : null;
    if (status === "active" && phase === null) {
      throw new Error("Stored Timing cycle had no phase inside its active envelope");
    }
    const durationDays = (endAt - startAt) / DAY_MS;
    const responseCycle: TimingCycleResponse = {
      cycle_id: cycle.id,
      technique: cycle.technique,
      body: cycle.body,
      target: cycle.target,
      aspect: cycle.aspect,
      status,
      phase,
      start_at: cycle.start_at,
      exact_at: cycle.exact_at,
      end_at: cycle.end_at,
      duration_days: durationDays,
      orb_deg: cycle.orb_deg,
      passes: cycle.passes.map((pass) => ({
        pass_index: pass.pass_index,
        direction: pass.direction,
        exact_at: pass.exact_at,
      })),
    };
    const nextPass = passInstants.find((instant) => instant >= asOfInstant);
    return {
      cycle: responseCycle,
      bucket: status === "active" ? 0 : 1,
      sortAt: status === "active" ? (nextPass ?? endAt) : startAt,
    };
  });

  projected.sort(
    (left, right) =>
      left.bucket - right.bucket ||
      left.sortAt - right.sortAt ||
      left.cycle.cycle_id.localeCompare(right.cycle.cycle_id),
  );

  const receipt = input.snapshot.receipt;
  const calculationStatus: TimingResponse["calculation_status"] = receipt
    ? {
        mode: "persisted_daily_reading_scan",
        state: receipt.localDate < input.currentLocalDate ? "stale" : "current",
        last_refresh_at: receipt.createdAt,
        last_refresh_local_date: receipt.localDate,
      }
    : {
        mode: "persisted_daily_reading_scan",
        state: "not_scanned",
        last_refresh_at: null,
        last_refresh_local_date: null,
      };

  return {
    schema_version: M3_SCHEMA_VERSION,
    as_of: input.asOf,
    calculation_status: calculationStatus,
    applied_filters: input.filters,
    unreadable_cycle_count: input.snapshot.unreadableCycleIds.length,
    cycles: projected
      .map(({ cycle }) => cycle)
      .filter(
        (cycle) =>
          matchesPhase(cycle, input.filters.phase) &&
          matchesDuration(cycle.duration_days, input.filters.duration),
      ),
  };
}

export const timingRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

timingRoutes.get("/v1/timing", async (c) => {
  const requestId = c.get("requestId");
  const now = new Date();
  const asOf = now.toISOString();
  const filters = parseTimingFilters(c.req.queries());
  if (!filters) {
    return c.json(
      {
        error: {
          code: "invalid_filter",
          message: "Timing filters are invalid",
          request_id: requestId,
        },
      },
      400,
    );
  }

  const userId = c.get("userId");
  const preferences = await loadPreferences(c.env, userId);
  if (!preferences) {
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required",
          request_id: requestId,
        },
      },
      401,
    );
  }

  let currentLocalDate: string;
  try {
    currentLocalDate = localDateIn(preferences.timezone, now);
  } catch (error) {
    safeLog({ event: "timing_local_day_unresolvable" });
    return c.json(
      {
        error: {
          code: "internal_error",
          message: "Unexpected server error",
          request_id: requestId,
        },
      },
      500,
    );
  }

  const snapshot = await loadTimingSnapshot(c.env, userId, asOf);
  if (snapshot.unreadableCycleIds.length > 0) {
    safeLog({
      event: "timing_cycles_unreadable",
      unreadable_count: snapshot.unreadableCycleIds.length,
    });
  }
  return c.json(
    projectTimingResponse({ asOf, currentLocalDate, snapshot, filters }),
    200,
  );
});
