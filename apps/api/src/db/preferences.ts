import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";

/**
 * Scheduling timezone and content locale as *owned* values.
 *
 * Identity creation writes `timezone = 'UTC'` and `locale = 'en-US'` as server
 * defaults. M3 makes both load-bearing — the scheduling zone decides which local
 * day is generated, and the locale selects the reviewed fallback and the timing
 * template — so a default nobody chose has to be distinguishable from a decision
 * somebody made. That is the whole reason `*_source` exists, and why generation
 * is withheld while it reads `default_unconfirmed`.
 *
 * `users.timezone` is the present-day scheduling zone. `birth_profiles.timezone`
 * is the historical birthplace zone and must never be substituted for it.
 */
export type PreferenceSource =
  | "default_unconfirmed"
  | "device_derived"
  | "user_confirmed";

/** What a caller may claim. Nothing can write itself back to unconfirmed. */
export type PreferenceWriteSource = "device_derived" | "user_confirmed";

export interface UserPreferences {
  timezone: string;
  timezoneSource: PreferenceSource;
  timezoneRevision: number;
  timezoneUpdatedAt: string | null;
  locale: string;
  localeSource: PreferenceSource;
  localeUpdatedAt: string | null;
}

interface PreferenceRow {
  timezone: string;
  timezone_source: PreferenceSource;
  timezone_revision: number;
  timezone_updated_at: string | null;
  locale: string;
  locale_source: PreferenceSource;
  locale_updated_at: string | null;
}

export type PreferenceWrite<T> =
  | { ok: true; value: T }
  /** A device sync tried to overwrite a user's own decision. */
  | { ok: false; reason: "preference_locked" }
  /** Another writer won the same revision. The caller may retry. */
  | { ok: false; reason: "preference_conflict" };

export async function loadPreferences(
  env: Env,
  userId: string,
): Promise<UserPreferences | null> {
  const row = await env.DB.prepare(
    `SELECT timezone, timezone_source, timezone_revision, timezone_updated_at,
            locale, locale_source, locale_updated_at
     FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<PreferenceRow>();
  if (!row) return null;
  return {
    timezone: row.timezone,
    timezoneSource: row.timezone_source,
    timezoneRevision: row.timezone_revision,
    timezoneUpdatedAt: row.timezone_updated_at,
    locale: row.locale,
    localeSource: row.locale_source,
    localeUpdatedAt: row.locale_updated_at,
  };
}

/**
 * A user override outranks a device-derived one, in one direction only.
 *
 * A device update may refresh a device-derived or still-default value, but it
 * may not overwrite a decision the user made. The reverse is always allowed:
 * a person changing their own setting is never blocked by their phone.
 */
function locked(current: PreferenceSource, incoming: PreferenceWriteSource): boolean {
  return current === "user_confirmed" && incoming === "device_derived";
}

export async function setSchedulingTimezone(
  env: Env,
  userId: string,
  timezone: string,
  source: PreferenceWriteSource,
): Promise<PreferenceWrite<UserPreferences>> {
  const current = await loadPreferences(env, userId);
  if (!current) return { ok: false, reason: "preference_conflict" };
  if (locked(current.timezoneSource, source)) {
    return { ok: false, reason: "preference_locked" };
  }

  // An unchanged value is not a change. DEV-01's foreground sync calls this on
  // every app resume, and the data-source registry requires a 35-day *change*
  // log — a log of non-changes is not one, and a revision that ticks on every
  // resume would make timezone_revision meaningless as a version.
  if (current.timezone === timezone && current.timezoneSource === source) {
    return { ok: true, value: current };
  }

  const now = new Date().toISOString();
  const revision = current.timezoneRevision + 1;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users
         SET timezone = ?, timezone_source = ?, timezone_revision = ?,
             timezone_updated_at = ?, updated_at = ?
         WHERE id = ? AND timezone_revision = ?`,
      ).bind(timezone, source, revision, now, now, userId, current.timezoneRevision),
      // UNIQUE (user_id, revision) is what makes the pair atomic: two writers
      // that both read the same revision cannot both commit, because the loser's
      // insert collides and D1 rolls its whole batch back.
      env.DB.prepare(
        `INSERT INTO timezone_changes
           (id, user_id, previous_zone, next_zone, source, revision, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId("tzc"),
        userId,
        current.timezone,
        timezone,
        source,
        revision,
        now,
      ),
    ]);
  } catch (err) {
    const latest = await loadPreferences(env, userId);
    if (!latest) throw err;
    if (locked(latest.timezoneSource, source)) {
      return { ok: false, reason: "preference_locked" };
    }
    if (latest.timezone === timezone && latest.timezoneSource === source) {
      return { ok: true, value: latest };
    }
    if (latest.timezoneRevision !== current.timezoneRevision) {
      return { ok: false, reason: "preference_conflict" };
    }
    throw err;
  }

  return {
    ok: true,
    value: {
      ...current,
      timezone,
      timezoneSource: source,
      timezoneRevision: revision,
      timezoneUpdatedAt: now,
    },
  };
}

/**
 * Locale has the same defect and the same treatment, minus the change log:
 * DEV-01's 35-day retention requirement is about the scheduling zone, and 0002
 * deliberately added no locale_changes table.
 */
export async function setContentLocale(
  env: Env,
  userId: string,
  locale: string,
  source: PreferenceWriteSource,
): Promise<PreferenceWrite<UserPreferences>> {
  const current = await loadPreferences(env, userId);
  if (!current) return { ok: false, reason: "preference_conflict" };
  if (locked(current.localeSource, source)) {
    return { ok: false, reason: "preference_locked" };
  }
  if (current.locale === locale && current.localeSource === source) {
    return { ok: true, value: current };
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE users
     SET locale = ?, locale_source = ?, locale_updated_at = ?, updated_at = ?
     WHERE id = ? AND locale = ? AND locale_source = ?
       AND (
         locale_updated_at = ?
         OR (locale_updated_at IS NULL AND ? IS NULL)
       )`,
  )
    .bind(
      locale,
      source,
      now,
      now,
      userId,
      current.locale,
      current.localeSource,
      current.localeUpdatedAt,
      current.localeUpdatedAt,
    )
    .run();
  if (!result.meta.changes) {
    const latest = await loadPreferences(env, userId);
    if (!latest) return { ok: false, reason: "preference_conflict" };
    if (locked(latest.localeSource, source)) {
      return { ok: false, reason: "preference_locked" };
    }
    if (latest.locale === locale && latest.localeSource === source) {
      return { ok: true, value: latest };
    }
    return { ok: false, reason: "preference_conflict" };
  }

  return {
    ok: true,
    value: { ...current, locale, localeSource: source, localeUpdatedAt: now },
  };
}
