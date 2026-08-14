import type { Env } from "../env.js";

export const TIME_TRAVEL_LAUNCH_DAILY_SCAN_LIMIT = 32 as const;

export type TimeTravelConfiguration =
  | { ok: true; receiptEpoch: number; dailyScanLimit: typeof TIME_TRAVEL_LAUNCH_DAILY_SCAN_LIMIT }
  | { ok: false; message: string };

export function resolveTimeTravelConfiguration(
  env: Pick<Env, "TIME_TRAVEL_RECEIPT_EPOCH" | "TIME_TRAVEL_DAILY_SCAN_LIMIT"> | Partial<Env>,
): TimeTravelConfiguration {
  const epoch = Number(env.TIME_TRAVEL_RECEIPT_EPOCH);
  if (!env.TIME_TRAVEL_RECEIPT_EPOCH || !Number.isSafeInteger(epoch) || epoch <= 0) {
    return { ok: false, message: "TIME_TRAVEL_RECEIPT_EPOCH must be a positive integer" };
  }
  if (env.TIME_TRAVEL_DAILY_SCAN_LIMIT !== String(TIME_TRAVEL_LAUNCH_DAILY_SCAN_LIMIT)) {
    return { ok: false, message: "TIME_TRAVEL_DAILY_SCAN_LIMIT must equal the launch pin of 32" };
  }
  return { ok: true, receiptEpoch: epoch, dailyScanLimit: TIME_TRAVEL_LAUNCH_DAILY_SCAN_LIMIT };
}
