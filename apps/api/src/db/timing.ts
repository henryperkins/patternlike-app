import {
  LAUNCH_ASPECTS,
  LAUNCH_BODIES,
  type CyclePass,
  type NormalizedCycle,
} from "@patternlike/shared";
import type { Env } from "../env.js";

export interface TimingScanReceipt {
  localDate: string;
  createdAt: string;
}

export interface TimingSnapshot {
  cycles: NormalizedCycle[];
  unreadableCycleIds: string[];
  receipt: TimingScanReceipt | null;
}

export class StoredTimingReceiptInvalidError extends Error {
  readonly code = "stored_timing_receipt_invalid";

  constructor() {
    super("Stored Timing scan receipt is not readable");
    this.name = "StoredTimingReceiptInvalidError";
  }
}

interface CycleInstanceRow {
  id: string;
  end_at: string;
  cycle_json: string;
}

interface ReceiptRow {
  local_date: string;
  created_at: string;
}

const CYCLE_ID_PATTERN = /^cyc_[a-f0-9]{32}$/;
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CYCLE_KEYS = new Set([
  "id",
  "technique",
  "body",
  "target",
  "aspect",
  "start_at",
  "exact_at",
  "end_at",
  "pass_count",
  "passes",
  "orb_deg",
  "importance_score",
]);
const REQUIRED_CYCLE_KEYS = [
  "id",
  "technique",
  "body",
  "target",
  "aspect",
  "start_at",
  "exact_at",
  "end_at",
  "pass_count",
  "passes",
  "orb_deg",
] as const;
const PASS_KEYS = new Set([
  "pass_index",
  "direction",
  "exact_at",
  "speed_deg_per_day",
]);
const BODIES = new Set<string>(LAUNCH_BODIES);
const ASPECTS = new Set<string>(LAUNCH_ASPECTS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRealDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  return isRealDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    !isRealDateParts(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePass(value: unknown, expectedIndex: number): CyclePass | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, PASS_KEYS)) return null;
  if (
    value.pass_index !== expectedIndex ||
    (value.direction !== "direct" && value.direction !== "retrograde") ||
    typeof value.exact_at !== "string" ||
    parseInstant(value.exact_at) === null ||
    !isFiniteNumber(value.speed_deg_per_day)
  ) {
    return null;
  }
  return {
    pass_index: value.pass_index,
    direction: value.direction,
    exact_at: value.exact_at,
    speed_deg_per_day: value.speed_deg_per_day,
  };
}

function parseStoredCycle(row: CycleInstanceRow): NormalizedCycle | null {
  let value: unknown;
  try {
    value = JSON.parse(row.cycle_json);
  } catch {
    return null;
  }
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, CYCLE_KEYS) ||
    !REQUIRED_CYCLE_KEYS.every((key) => Object.hasOwn(value, key)) ||
    typeof value.id !== "string" ||
    !CYCLE_ID_PATTERN.test(value.id) ||
    value.id !== row.id ||
    value.technique !== "transit" ||
    typeof value.body !== "string" ||
    !BODIES.has(value.body) ||
    typeof value.target !== "string" ||
    value.target.length === 0 ||
    typeof value.aspect !== "string" ||
    !ASPECTS.has(value.aspect) ||
    typeof value.start_at !== "string" ||
    typeof value.exact_at !== "string" ||
    typeof value.end_at !== "string" ||
    value.end_at !== row.end_at ||
    !Number.isInteger(value.pass_count) ||
    (value.pass_count as number) < 1 ||
    !Array.isArray(value.passes) ||
    !isFiniteNumber(value.orb_deg) ||
    value.orb_deg < 0 ||
    value.orb_deg > 12 ||
    (Object.hasOwn(value, "importance_score") &&
      value.importance_score !== null &&
      !isFiniteNumber(value.importance_score))
  ) {
    return null;
  }

  const start = parseInstant(value.start_at);
  const exact = parseInstant(value.exact_at);
  const end = parseInstant(value.end_at);
  if (start === null || exact === null || end === null || start > exact || exact > end) {
    return null;
  }

  const passes: CyclePass[] = [];
  let previousPass = Number.NEGATIVE_INFINITY;
  for (const [index, passValue] of value.passes.entries()) {
    const pass = parsePass(passValue, index + 1);
    if (!pass) return null;
    const passInstant = parseInstant(pass.exact_at);
    if (
      passInstant === null ||
      passInstant <= previousPass ||
      passInstant < start ||
      passInstant > end
    ) {
      return null;
    }
    previousPass = passInstant;
    passes.push(pass);
  }
  if (
    value.pass_count !== passes.length ||
    passes.length === 0 ||
    value.exact_at !== passes[0]!.exact_at
  ) {
    return null;
  }

  const cycle: NormalizedCycle = {
    id: value.id,
    technique: "transit",
    body: value.body as NormalizedCycle["body"],
    target: value.target,
    aspect: value.aspect as NormalizedCycle["aspect"],
    start_at: value.start_at,
    exact_at: value.exact_at,
    end_at: value.end_at,
    pass_count: value.pass_count as number,
    passes,
    orb_deg: value.orb_deg,
  };
  if (Object.hasOwn(value, "importance_score")) {
    cycle.importance_score = value.importance_score as number | null;
  }
  return cycle;
}

export async function loadTimingSnapshot(
  env: Env,
  userId: string,
  asOf: string,
): Promise<TimingSnapshot> {
  const cycleResult = await env.DB.prepare(
    `SELECT id, end_at, cycle_json
     FROM cycle_instances
     WHERE user_id = ? AND status = 'active' AND end_at >= ?`,
  )
    .bind(userId, asOf)
    .all<CycleInstanceRow>();

  const receipt = await env.DB.prepare(
    `SELECT local_date, created_at
     FROM daily_readings
     WHERE user_id = ?
     ORDER BY local_date DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<ReceiptRow>();

  const cycles: NormalizedCycle[] = [];
  const unreadableCycleIds: string[] = [];
  for (const row of cycleResult.results) {
    const cycle = parseStoredCycle(row);
    if (cycle) cycles.push(cycle);
    else unreadableCycleIds.push(row.id);
  }

  if (!receipt) return { cycles, unreadableCycleIds, receipt: null };
  if (!isCalendarDate(receipt.local_date) || parseInstant(receipt.created_at) === null) {
    throw new StoredTimingReceiptInvalidError();
  }
  return {
    cycles,
    unreadableCycleIds,
    receipt: {
      localDate: receipt.local_date,
      createdAt: receipt.created_at,
    },
  };
}
