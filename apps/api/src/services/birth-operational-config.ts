import type { Env } from "../env.js";
import { isDevEnvironment } from "../crypto.js";

export const DEFAULT_CALC_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_BIRTH_CALC_DAILY_LIMIT = 5;

const MIN_CALC_FETCH_TIMEOUT_MS = 1_000;
const MAX_CALC_FETCH_TIMEOUT_MS = 30_000;
const MIN_BIRTH_CALC_DAILY_LIMIT = 1;
const MAX_BIRTH_CALC_DAILY_LIMIT = 50;

export type BirthOperationalConfigResult =
  | {
      ok: true;
      value: {
        fetchTimeoutMs: number;
        dailyLimit: number;
      };
    }
  | { ok: false; code: "birth_operational_config_invalid" };

type BirthOperationalEnv = Partial<
  Pick<
    Env,
    "ENVIRONMENT" | "CALC_FETCH_TIMEOUT_MS" | "BIRTH_CALC_DAILY_LIMIT"
  >
>;

function boundedUnsignedInteger(
  raw: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

export function resolveBirthOperationalConfig(
  env: BirthOperationalEnv,
): BirthOperationalConfigResult {
  const development = isDevEnvironment(env.ENVIRONMENT);
  const fetchTimeoutMs = env.CALC_FETCH_TIMEOUT_MS === undefined && development
    ? DEFAULT_CALC_FETCH_TIMEOUT_MS
    : boundedUnsignedInteger(
        env.CALC_FETCH_TIMEOUT_MS,
        MIN_CALC_FETCH_TIMEOUT_MS,
        MAX_CALC_FETCH_TIMEOUT_MS,
      );
  const dailyLimit = env.BIRTH_CALC_DAILY_LIMIT === undefined && development
    ? DEFAULT_BIRTH_CALC_DAILY_LIMIT
    : boundedUnsignedInteger(
        env.BIRTH_CALC_DAILY_LIMIT,
        MIN_BIRTH_CALC_DAILY_LIMIT,
        MAX_BIRTH_CALC_DAILY_LIMIT,
      );

  if (fetchTimeoutMs === null || dailyLimit === null) {
    return { ok: false, code: "birth_operational_config_invalid" };
  }
  return {
    ok: true,
    value: {
      fetchTimeoutMs,
      dailyLimit,
    },
  };
}
