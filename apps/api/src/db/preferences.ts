import { newId } from "@patternlike/shared";
import type { Env } from "../env.js";
import {
  decryptPayload,
  encryptPayload,
  loadUserIdentity,
  type UserIdentity,
} from "./users.js";

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
  /** The same idempotency key was used for a different mutation. */
  | { ok: false; reason: "idempotency_conflict" }
  /** Another writer won the same revision. The caller may retry. */
  | { ok: false; reason: "preference_conflict" };

type PreferenceJobType = "preference_timezone" | "preference_locale";

interface StoredPreferenceMutation {
  input: {
    value: string;
    source: PreferenceWriteSource;
  };
  value: UserPreferences;
}

interface PreferenceJobRow {
  id: string;
  payload_enc: ArrayBuffer;
  payload_key_version: number;
  payload_nonce: string;
}

const PREFERENCE_SOURCES: ReadonlySet<string> = new Set([
  "default_unconfirmed",
  "device_derived",
  "user_confirmed",
]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isPreferences(value: unknown): value is UserPreferences {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<UserPreferences>;
  return (
    typeof row.timezone === "string" &&
    typeof row.timezoneSource === "string" &&
    PREFERENCE_SOURCES.has(row.timezoneSource) &&
    Number.isInteger(row.timezoneRevision) &&
    (row.timezoneRevision ?? -1) >= 0 &&
    (row.timezoneUpdatedAt === null || typeof row.timezoneUpdatedAt === "string") &&
    typeof row.locale === "string" &&
    typeof row.localeSource === "string" &&
    PREFERENCE_SOURCES.has(row.localeSource) &&
    (row.localeUpdatedAt === null || typeof row.localeUpdatedAt === "string")
  );
}

function isStoredMutation(value: unknown): value is StoredPreferenceMutation {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredPreferenceMutation>;
  return (
    !!stored.input &&
    typeof stored.input.value === "string" &&
    (stored.input.source === "device_derived" ||
      stored.input.source === "user_confirmed") &&
    isPreferences(stored.value)
  );
}

async function loadStoredMutation(
  env: Env,
  identity: UserIdentity,
  jobType: PreferenceJobType,
  idempotencyKey: string,
): Promise<StoredPreferenceMutation | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM jobs
     WHERE job_type = ? AND user_id = ? AND idempotency_key = ?
       AND status = 'succeeded'`,
  )
    .bind(jobType, identity.userId, idempotencyKey)
    .first<PreferenceJobRow>();
  if (!row) return null;
  if (!row.payload_enc || !row.payload_key_version || !row.payload_nonce) {
    throw new Error("Preference idempotency record is incomplete");
  }

  const stored = await decryptPayload<unknown>(
    env,
    identity,
    {
      ciphertext: bytesToBase64(new Uint8Array(row.payload_enc)),
      key_version: row.payload_key_version,
      nonce: row.payload_nonce,
    },
    {
      subject: identity.cryptoSubject,
      field: "jobs.payload_enc",
      recordId: row.id,
    },
  );
  if (!isStoredMutation(stored)) {
    throw new Error("Preference idempotency record is invalid");
  }
  return stored;
}

async function replayStoredMutation(
  env: Env,
  identity: UserIdentity,
  jobType: PreferenceJobType,
  idempotencyKey: string,
  value: string,
  source: PreferenceWriteSource,
): Promise<PreferenceWrite<UserPreferences> | null> {
  const stored = await loadStoredMutation(env, identity, jobType, idempotencyKey);
  if (!stored) return null;
  if (stored.input.value !== value || stored.input.source !== source) {
    return { ok: false, reason: "idempotency_conflict" };
  }
  return { ok: true, value: stored.value };
}

/**
 * Persist the exact successful result under the endpoint's idempotency key.
 *
 * Preference values are ordinary clear columns on `users`, but a replay record
 * contains historical state. It therefore uses the existing per-user encrypted
 * job envelope rather than adding that history to clear `jobs.payload_json`.
 * Keeping this INSERT in the same D1 batch as the preference CAS makes both the
 * mutation and its replay proof commit, or neither one does.
 */
async function buildMutationInsert(
  env: Env,
  identity: UserIdentity,
  jobType: PreferenceJobType,
  idempotencyKey: string,
  input: StoredPreferenceMutation["input"],
  value: UserPreferences,
  now: string,
): Promise<D1PreparedStatement> {
  const jobId = newId("job");
  const sealed = await encryptPayload(env, identity, { input, value }, {
    subject: identity.cryptoSubject,
    field: "jobs.payload_enc",
    recordId: jobId,
  });
  const encrypted = Uint8Array.from(atob(sealed.ciphertext), (char) =>
    char.charCodeAt(0),
  );
  return env.DB.prepare(
    `INSERT INTO jobs
       (id, job_type, user_id, idempotency_key, status,
        payload_enc, payload_key_version, payload_nonce,
        result_class, attempts, finished_at, created_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, 'preference_saved', 1, ?, ?)`,
  ).bind(
    jobId,
    jobType,
    identity.userId,
    idempotencyKey,
    encrypted,
    sealed.keyVersion,
    sealed.nonce,
    now,
    now,
  );
}

async function identityForMutation(
  env: Env,
  userId: string,
  idempotencyKey: string | undefined,
): Promise<UserIdentity | null> {
  return idempotencyKey ? loadUserIdentity(env, userId) : null;
}

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
  idempotencyKey?: string,
): Promise<PreferenceWrite<UserPreferences>> {
  const identity = await identityForMutation(env, userId, idempotencyKey);
  if (idempotencyKey) {
    if (!identity) return { ok: false, reason: "preference_conflict" };
    const replay = await replayStoredMutation(
      env,
      identity,
      "preference_timezone",
      idempotencyKey,
      timezone,
      source,
    );
    if (replay) return replay;
  }

  const current = await loadPreferences(env, userId);
  if (!current) return { ok: false, reason: "preference_conflict" };
  if (locked(current.timezoneSource, source)) {
    return { ok: false, reason: "preference_locked" };
  }

  // An unchanged value is not a change. DEV-01's foreground sync calls this on
  // every app resume, and the data-source registry requires a 35-day *change*
  // log — a log of non-changes is not one, and a revision that ticks on every
  // resume would make timezone_revision meaningless as a version.
  const now = new Date().toISOString();
  const unchanged = current.timezone === timezone && current.timezoneSource === source;
  const revision = unchanged
    ? current.timezoneRevision
    : current.timezoneRevision + 1;
  const value: UserPreferences = unchanged
    ? current
    : {
        ...current,
        timezone,
        timezoneSource: source,
        timezoneRevision: revision,
        timezoneUpdatedAt: now,
      };
  const statements: D1PreparedStatement[] = [];
  if (unchanged) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'timezone changed during idempotent no-op'
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND timezone = ? AND timezone_source = ?
             AND timezone_revision = ?
         )`,
      ).bind(
        userId,
        current.timezone,
        current.timezoneSource,
        current.timezoneRevision,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE users
         SET timezone = ?, timezone_source = ?, timezone_revision = ?,
             timezone_updated_at = ?, updated_at = ?
         WHERE id = ? AND timezone_revision = ?`,
      ).bind(timezone, source, revision, now, now, userId, current.timezoneRevision),
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
    );
  }
  if (identity && idempotencyKey) {
    statements.push(
      await buildMutationInsert(
        env,
        identity,
        "preference_timezone",
        idempotencyKey,
        { value: timezone, source },
        value,
        now,
      ),
    );
  }

  try {
    if (statements.length > 0) await env.DB.batch(statements);
  } catch (error) {
    if (identity && idempotencyKey) {
      const replay = await replayStoredMutation(
        env,
        identity,
        "preference_timezone",
        idempotencyKey,
        timezone,
        source,
      );
      if (replay) return replay;
    }
    const latest = await loadPreferences(env, userId);
    if (latest && locked(latest.timezoneSource, source)) {
      return { ok: false, reason: "preference_locked" };
    }
    if (latest && latest.timezoneRevision !== current.timezoneRevision) {
      return { ok: false, reason: "preference_conflict" };
    }
    throw error;
  }
  return { ok: true, value };
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
  idempotencyKey?: string,
): Promise<PreferenceWrite<UserPreferences>> {
  const identity = await identityForMutation(env, userId, idempotencyKey);
  if (idempotencyKey) {
    if (!identity) return { ok: false, reason: "preference_conflict" };
    const replay = await replayStoredMutation(
      env,
      identity,
      "preference_locale",
      idempotencyKey,
      locale,
      source,
    );
    if (replay) return replay;
  }

  const current = await loadPreferences(env, userId);
  if (!current) return { ok: false, reason: "preference_conflict" };
  if (locked(current.localeSource, source)) {
    return { ok: false, reason: "preference_locked" };
  }
  const now = new Date().toISOString();
  const unchanged = current.locale === locale && current.localeSource === source;
  const value: UserPreferences = unchanged
    ? current
    : { ...current, locale, localeSource: source, localeUpdatedAt: now };
  const statements: D1PreparedStatement[] = [];
  if (unchanged) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'locale changed during idempotent no-op'
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND locale = ? AND locale_source = ?
             AND locale_updated_at IS ?
         )`,
      ).bind(
        userId,
        current.locale,
        current.localeSource,
        current.localeUpdatedAt,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE users
         SET locale = ?, locale_source = ?, locale_updated_at = ?, updated_at = ?
         WHERE id = ? AND (
           (locale = ? AND locale_source = ? AND locale_updated_at IS ?)
           OR (? = 'user_confirmed' AND locale_source = 'device_derived')
         )`,
      ).bind(
        locale,
        source,
        now,
        now,
        userId,
        current.locale,
        current.localeSource,
        current.localeUpdatedAt,
        source,
      ),
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'locale compare-and-swap failed'
         WHERE NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND locale = ? AND locale_source = ?
             AND locale_updated_at = ?
         )`,
      ).bind(userId, locale, source, now),
    );
  }
  if (identity && idempotencyKey) {
    statements.push(
      await buildMutationInsert(
        env,
        identity,
        "preference_locale",
        idempotencyKey,
        { value: locale, source },
        value,
        now,
      ),
    );
  }

  try {
    if (statements.length > 0) await env.DB.batch(statements);
  } catch (error) {
    if (identity && idempotencyKey) {
      const replay = await replayStoredMutation(
        env,
        identity,
        "preference_locale",
        idempotencyKey,
        locale,
        source,
      );
      if (replay) return replay;
    }
    const latest = await loadPreferences(env, userId);
    if (latest && locked(latest.localeSource, source)) {
      return { ok: false, reason: "preference_locked" };
    }
    if (
      latest &&
      (latest.locale !== current.locale ||
        latest.localeSource !== current.localeSource ||
        latest.localeUpdatedAt !== current.localeUpdatedAt)
    ) {
      return { ok: false, reason: "preference_conflict" };
    }
    throw error;
  }

  return { ok: true, value };
}
