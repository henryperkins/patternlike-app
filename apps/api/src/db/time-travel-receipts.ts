import {
  CYCLE_POLICY_ID,
  CYCLE_POLICY_VERSION,
  M3_SCHEMA_VERSION,
  TRANSIT_ORB_POLICY_ID,
  TRANSIT_ORB_POLICY_VERSION,
  jcsCanonicalize,
  newId,
  sha256Hex,
  type CycleRequest,
  type CycleResponseSuccess,
  type NormalizedCycle,
} from "@patternlike/shared";
import type { Env } from "../env.js";

export const MAX_SCAN_RESULT_BYTES = 512 * 1024;
export const MAX_SCAN_RECEIPTS_PER_USER = 256;

export interface ScanReceiptKey {
  userId: string;
  chartId: string;
  chartFingerprint: string;
  localDate: string;
  schedulingTimezone: string;
  windowFrom: string;
  windowTo: string;
  tzdbVersion: string;
  localDayResolutionPolicyVersion: string;
  contractId: string;
  contractVersion: string;
  receiptEpoch: number;
}

export interface CachedScanReceipt {
  receiptId: string;
  cycles: NormalizedCycle[];
  createdAt: string;
  containerVersion: string;
  ephemerisDataVersion: string;
  semanticRequestHash: string;
  semanticResultHash: string;
  rawResponseSha256: string;
}

interface ReceiptRow {
  id: string;
  local_date: string;
  scheduling_timezone: string;
  contract_id: string;
  contract_version: string;
  cycle_policy_id: string;
  cycle_policy_version: string;
  orb_policy_id: string;
  orb_policy_version: string;
  container_version: string;
  ephemeris_data_version: string;
  semantic_request_hash: string;
  semantic_result_hash: string;
  raw_response_sha256: string;
  result_json: string;
  created_at: string;
}

function semanticResult(
  row: Pick<ReceiptRow, "contract_id" | "contract_version" | "cycle_policy_id" |
    "cycle_policy_version" | "orb_policy_id" | "orb_policy_version" |
    "container_version" | "ephemeris_data_version">,
  chartFingerprint: string,
  cycles: NormalizedCycle[],
) {
  return {
    ok: true,
    schema_version: M3_SCHEMA_VERSION,
    chart_fingerprint: chartFingerprint,
    cycle_policy_id: row.cycle_policy_id,
    cycle_policy_version: row.cycle_policy_version,
    orb_policy_id: row.orb_policy_id,
    orb_policy_version: row.orb_policy_version,
    contract_id: row.contract_id,
    contract_version: row.contract_version,
    container_digest: row.container_version,
    ephemeris_data_version: row.ephemeris_data_version,
    cycles,
  };
}

function assertNormalizedCycles(cycles: unknown): asserts cycles is NormalizedCycle[] {
  if (!Array.isArray(cycles)) throw new Error("cycle receipt integrity failure: result is not an array");
  const ids = new Set<string>();
  let previous = "";
  for (const value of cycles) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("cycle receipt integrity failure: malformed cycle");
    }
    const cycle = value as Partial<NormalizedCycle>;
    if (
      typeof cycle.id !== "string" || !/^cyc_[0-9a-f]{32}$/.test(cycle.id) || ids.has(cycle.id) ||
      cycle.technique !== "transit" || typeof cycle.body !== "string" ||
      typeof cycle.target !== "string" || typeof cycle.aspect !== "string" ||
      typeof cycle.start_at !== "string" || typeof cycle.exact_at !== "string" ||
      typeof cycle.end_at !== "string" || !Number.isInteger(cycle.pass_count) ||
      typeof cycle.orb_deg !== "number" || !Number.isFinite(cycle.orb_deg) ||
      !Array.isArray(cycle.passes) || cycle.passes.length !== cycle.pass_count ||
      cycle.passes.length < 1 || cycle.passes[0]?.exact_at !== cycle.exact_at ||
      !(Date.parse(cycle.start_at) <= Date.parse(cycle.exact_at) && Date.parse(cycle.exact_at) <= Date.parse(cycle.end_at)) ||
      cycle.passes.some((pass, index) =>
        pass.pass_index !== index + 1 || !["direct", "retrograde"].includes(pass.direction) ||
        typeof pass.exact_at !== "string" || !Number.isFinite(pass.speed_deg_per_day))
    ) {
      throw new Error("cycle receipt integrity failure: malformed cycle");
    }
    const order = `${cycle.exact_at}\u0000${cycle.id}`;
    if (order < previous) throw new Error("cycle receipt integrity failure: cycles are not stably ordered");
    previous = order;
    ids.add(cycle.id);
  }
}

function lookupStatement(env: Env, key: ScanReceiptKey) {
  return env.DB.prepare(
    `SELECT id, local_date, scheduling_timezone, contract_id, contract_version,
            cycle_policy_id, cycle_policy_version, orb_policy_id,
            orb_policy_version, container_version, ephemeris_data_version,
            semantic_request_hash, semantic_result_hash, raw_response_sha256,
            result_json, created_at
     FROM cycle_scan_receipts
     WHERE user_id = ? AND chart_fingerprint = ? AND window_from = ? AND window_to = ?
       AND contract_id = ? AND contract_version = ?
       AND cycle_policy_id = ? AND cycle_policy_version = ?
       AND orb_policy_id = ? AND orb_policy_version = ?
       AND tzdb_version = ? AND local_day_resolution_policy_version = ?
       AND receipt_epoch = ?`,
  ).bind(
    key.userId,
    key.chartFingerprint,
    key.windowFrom,
    key.windowTo,
    key.contractId,
    key.contractVersion,
    CYCLE_POLICY_ID,
    CYCLE_POLICY_VERSION,
    TRANSIT_ORB_POLICY_ID,
    TRANSIT_ORB_POLICY_VERSION,
    key.tzdbVersion,
    key.localDayResolutionPolicyVersion,
    key.receiptEpoch,
  );
}

export async function loadScanReceipt(
  env: Env,
  key: ScanReceiptKey,
): Promise<CachedScanReceipt | null> {
  const row = await lookupStatement(env, key).first<ReceiptRow>();
  if (!row) return null;
  if (row.local_date !== key.localDate || row.scheduling_timezone !== key.schedulingTimezone) {
    throw new Error("cycle receipt integrity failure: audit date or zone changed");
  }
  if (new TextEncoder().encode(row.result_json).byteLength > MAX_SCAN_RESULT_BYTES) {
    throw new Error("cycle receipt integrity failure: normalized result exceeds 512 KiB");
  }
  let cycles: unknown;
  try {
    cycles = JSON.parse(row.result_json);
  } catch {
    throw new Error("cycle receipt integrity failure: result is not JSON");
  }
  const computed = await sha256Hex(jcsCanonicalize(semanticResult(row, key.chartFingerprint, cycles as NormalizedCycle[])));
  if (computed !== row.semantic_result_hash) {
    throw new Error("cycle receipt integrity failure: semantic result hash mismatch");
  }
  assertNormalizedCycles(cycles);
  return {
    receiptId: row.id,
    cycles,
    createdAt: row.created_at,
    containerVersion: row.container_version,
    ephemerisDataVersion: row.ephemeris_data_version,
    semanticRequestHash: row.semantic_request_hash,
    semanticResultHash: row.semantic_result_hash,
    rawResponseSha256: row.raw_response_sha256,
  };
}

export async function persistScanReceipt(
  env: Env,
  key: ScanReceiptKey,
  request: CycleRequest,
  response: CycleResponseSuccess,
  rawResponse: string,
  now = new Date(),
): Promise<CachedScanReceipt> {
  const resultJson = jcsCanonicalize(response.cycles);
  if (new TextEncoder().encode(resultJson).byteLength > MAX_SCAN_RESULT_BYTES) {
    throw new Error("normalized cycle result exceeds the 512 KiB application cap");
  }
  assertNormalizedCycles(response.cycles);
  const { request_id: _requestId, ...requestProjection } = request;
  const { request_id: _responseRequestId, ...responseProjection } = response;
  const semanticRequestHash = await sha256Hex(jcsCanonicalize(requestProjection));
  const semanticResultHash = await sha256Hex(jcsCanonicalize(responseProjection));
  const rawResponseSha256 = await sha256Hex(rawResponse);
  const receiptId = newId("csr");
  const createdAt = now.toISOString();
  const result: CachedScanReceipt = {
    receiptId,
    cycles: response.cycles,
    createdAt,
    containerVersion: response.container_digest,
    ephemerisDataVersion: response.ephemeris_data_version,
    semanticRequestHash,
    semanticResultHash,
    rawResponseSha256,
  };

  const vintage = await env.DB.prepare(
    `SELECT container_version, ephemeris_data_version
     FROM cycle_scan_receipts
     WHERE user_id = ? AND receipt_epoch = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(key.userId, key.receiptEpoch).first<{
    container_version: string;
    ephemeris_data_version: string;
  }>();
  if (vintage && (
    vintage.container_version !== response.container_digest ||
    vintage.ephemeris_data_version !== response.ephemeris_data_version
  )) {
    throw new Error("cycle receipt epoch spans different calculation vintages");
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO cycle_scan_receipts (
           id, user_id, chart_id, chart_fingerprint, local_date,
           scheduling_timezone, window_from, window_to, tzdb_version,
           local_day_resolution_policy_version, contract_id, contract_version,
           cycle_policy_id, cycle_policy_version, orb_policy_id,
           orb_policy_version, receipt_epoch, container_version,
           ephemeris_data_version, semantic_request_hash, semantic_result_hash,
           raw_response_sha256, result_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        receiptId, key.userId, key.chartId, key.chartFingerprint, key.localDate,
        key.schedulingTimezone, key.windowFrom, key.windowTo, key.tzdbVersion,
        key.localDayResolutionPolicyVersion, key.contractId, key.contractVersion,
        CYCLE_POLICY_ID, CYCLE_POLICY_VERSION, TRANSIT_ORB_POLICY_ID,
        TRANSIT_ORB_POLICY_VERSION, key.receiptEpoch, response.container_digest,
        response.ephemeris_data_version, semanticRequestHash, semanticResultHash,
        rawResponseSha256, resultJson, createdAt,
      ),
      env.DB.prepare(
        `DELETE FROM cycle_scan_receipts
         WHERE user_id = ? AND receipt_epoch <> ?`,
      ).bind(key.userId, key.receiptEpoch),
      env.DB.prepare(
        `DELETE FROM cycle_scan_receipts
         WHERE rowid IN (
           SELECT rowid FROM cycle_scan_receipts WHERE user_id = ?
           ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
         )`,
      ).bind(key.userId, MAX_SCAN_RECEIPTS_PER_USER),
    ]);
    return result;
  } catch {
    const winner = await loadScanReceipt(env, key);
    if (winner?.semanticResultHash === semanticResultHash) return winner;
    if (winner) throw new Error("concurrent cycle scan receipts did not converge");
    throw new Error("cycle scan receipt could not be committed atomically");
  }
}

export type BudgetReservation =
  | { ok: true; reserved: number }
  | { ok: false; resetsAt: string; retryAfterSeconds: number };

export async function reserveScanBudget(
  env: Env,
  userId: string,
  missCount: number,
  limit: number,
  now = new Date(),
): Promise<BudgetReservation> {
  if (!Number.isInteger(missCount) || missCount < 0 || missCount > 2) {
    throw new Error("Time Travel miss reservation must be an integer from 0 through 2");
  }
  if (missCount === 0) return { ok: true, reserved: 0 };
  const utcDate = now.toISOString().slice(0, 10);
  const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = new Date(startToday - 34 * 86_400_000).toISOString().slice(0, 10);
  const resetsAt = new Date(startToday + 86_400_000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO time_travel_daily_usage (
         user_id, utc_date, reserved_scan_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, utc_date) DO UPDATE SET
         reserved_scan_count = reserved_scan_count + excluded.reserved_scan_count,
         updated_at = excluded.updated_at
       WHERE reserved_scan_count + excluded.reserved_scan_count <= ?
       RETURNING reserved_scan_count`,
    ).bind(userId, utcDate, missCount, now.toISOString(), now.toISOString(), limit),
    env.DB.prepare(
      `DELETE FROM time_travel_daily_usage WHERE user_id = ? AND utc_date < ?`,
    ).bind(userId, cutoff),
  ]);
  const row = results[0]!.results?.[0] as { reserved_scan_count?: number } | undefined;
  if (!row || typeof row.reserved_scan_count !== "number") {
    return {
      ok: false,
      resetsAt,
      retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(resetsAt) - now.getTime()) / 1000)),
    };
  }
  return { ok: true, reserved: row.reserved_scan_count };
}
