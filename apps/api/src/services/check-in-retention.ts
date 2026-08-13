export const DEFAULT_CHECK_IN_RETENTION_MONTHS = 13;
export const MAX_CHECK_IN_RETENTION_MONTHS = 13;

export type CheckInRetentionResolution =
  | { ok: true; months: number }
  | { ok: false };

/** Resolve the bounded raw-data retention setting without silently extending it. */
export function resolveCheckInRetentionMonths(
  raw: string | undefined,
): CheckInRetentionResolution {
  const configured = raw?.trim();
  if (!configured) {
    return { ok: true, months: DEFAULT_CHECK_IN_RETENTION_MONTHS };
  }
  const months = Number(configured);
  if (
    !Number.isInteger(months) ||
    months < 1 ||
    months > MAX_CHECK_IN_RETENTION_MONTHS
  ) {
    return { ok: false };
  }
  return { ok: true, months };
}
