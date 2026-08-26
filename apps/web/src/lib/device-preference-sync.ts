import {
  ApiError,
  newIdempotencyKey,
  setContentLocale,
  setSchedulingTimezone,
} from "./api-client.js";
import { systemLocale, systemTimezone } from "./device.js";

export type DevicePreferenceSyncResult =
  | { status: "settled" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

type PreferenceKind = "timezone" | "locale";

interface AttemptKey {
  identity: string;
  key: string;
}

function isLocked(error: unknown): boolean {
  return error instanceof ApiError && error.code === "preference_locked";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

async function writeWithConflictRetry(
  write: () => Promise<unknown>,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "preference_conflict")) {
      throw error;
    }
    await write();
  }
}

export class DevicePreferenceSynchronizer {
  private readonly idempotencyKeys = new Map<string, string>();
  private inFlight: Promise<DevicePreferenceSyncResult> | null = null;

  sync(signal?: AbortSignal): Promise<DevicePreferenceSyncResult> {
    if (this.inFlight) return this.inFlight;

    const operation = this.performSync(signal);
    this.inFlight = operation;
    void operation.then(
      () => {
        if (this.inFlight === operation) this.inFlight = null;
      },
      () => {
        if (this.inFlight === operation) this.inFlight = null;
      },
    );
    return operation;
  }

  private keyFor(kind: PreferenceKind, value: string): AttemptKey {
    const identity = `${kind}:${value}`;
    const existing = this.idempotencyKeys.get(identity);
    if (existing) return { identity, key: existing };

    const key = newIdempotencyKey(`web-device-${kind}`);
    this.idempotencyKeys.set(identity, key);
    return { identity, key };
  }

  private retire(attempt: AttemptKey): void {
    if (this.idempotencyKeys.get(attempt.identity) === attempt.key) {
      this.idempotencyKeys.delete(attempt.identity);
    }
  }

  private async performSync(
    signal?: AbortSignal,
  ): Promise<DevicePreferenceSyncResult> {
    if (signal?.aborted) return { status: "unavailable" };

    let timezone: string;
    let locale: string;
    try {
      timezone = systemTimezone();
      locale = Intl.getCanonicalLocales(systemLocale())[0] ?? "en-US";
    } catch {
      return { status: "unavailable" };
    }

    const timezoneAttempt = this.keyFor("timezone", timezone);
    const localeAttempt = this.keyFor("locale", locale);
    const outcomes = await Promise.allSettled([
      writeWithConflictRetry(() =>
        setSchedulingTimezone(timezone, "device_derived", timezoneAttempt.key)
      ),
      writeWithConflictRetry(() =>
        setContentLocale(locale, "device_derived", localeAttempt.key)
      ),
    ]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : []
    );

    if (failures.some(isUnauthorized)) {
      this.idempotencyKeys.clear();
      return { status: "unauthorized" };
    }
    if (failures.every(isLocked)) {
      this.retire(timezoneAttempt);
      this.retire(localeAttempt);
      return { status: "settled" };
    }
    return { status: "unavailable" };
  }
}
