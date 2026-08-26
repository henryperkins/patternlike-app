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

interface PendingAttempt {
  timezone: string;
  locale: string;
  timezoneKey: string;
  localeKey: string;
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
  private pending: PendingAttempt | null = null;
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

  private attemptFor(timezone: string, locale: string): PendingAttempt {
    const pending = this.pending;
    if (
      pending !== null &&
      pending.timezone === timezone &&
      pending.locale === locale
    ) {
      return pending;
    }
    const attempt: PendingAttempt = {
      timezone,
      locale,
      timezoneKey: newIdempotencyKey("web-device-timezone"),
      localeKey: newIdempotencyKey("web-device-locale"),
    };
    this.pending = attempt;
    return attempt;
  }

  private retire(attempt: PendingAttempt): void {
    if (this.pending === attempt) this.pending = null;
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

    const attempt = this.attemptFor(timezone, locale);
    const outcomes = await Promise.allSettled([
      writeWithConflictRetry(() =>
        setSchedulingTimezone(
          attempt.timezone,
          "device_derived",
          attempt.timezoneKey,
        )
      ),
      writeWithConflictRetry(() =>
        setContentLocale(attempt.locale, "device_derived", attempt.localeKey)
      ),
    ]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : []
    );

    if (failures.some(isUnauthorized)) {
      this.retire(attempt);
      return { status: "unauthorized" };
    }
    if (failures.every(isLocked)) {
      this.retire(attempt);
      return { status: "settled" };
    }
    return { status: "unavailable" };
  }
}
