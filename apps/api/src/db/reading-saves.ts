import {
  M8_SCHEMA_VERSION,
  type ReadingSaveState,
} from "@patternlike/shared";

import type { Env } from "../env.js";

interface SaveRow {
  saved_at: string | null;
}

export async function getReadingSaveState(
  env: Env,
  userId: string,
  readingId: string,
): Promise<ReadingSaveState | null> {
  const row = await env.DB.prepare(
    `SELECT s.saved_at
     FROM daily_readings r
     LEFT JOIN reading_saves s
       ON s.reading_id = r.id AND s.user_id = r.user_id
     WHERE r.id = ? AND r.user_id = ?
       AND r.reading_enc IS NOT NULL
       AND r.status IN ('published', 'superseded', 'invalidated')`,
  ).bind(readingId, userId).first<SaveRow>();
  if (!row) return null;
  return {
    schema_version: M8_SCHEMA_VERSION,
    reading_id: readingId,
    saved: row.saved_at !== null,
    saved_at: row.saved_at,
  };
}

export async function saveReading(
  env: Env,
  userId: string,
  readingId: string,
  now = new Date(),
): Promise<ReadingSaveState | null> {
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO assertion_probe (id, reason)
         SELECT 1, 'reading is not saveable'
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_readings
           WHERE id = ? AND user_id = ?
             AND reading_enc IS NOT NULL
             AND status IN ('published', 'superseded', 'invalidated')
         )`,
      ).bind(readingId, userId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO reading_saves (user_id, reading_id, saved_at)
         VALUES (?, ?, ?)`,
      ).bind(userId, readingId, now.toISOString()),
    ]);
  } catch (error) {
    if (await getReadingSaveState(env, userId, readingId) === null) return null;
    throw error;
  }
  return getReadingSaveState(env, userId, readingId);
}

export async function unsaveReading(
  env: Env,
  userId: string,
  readingId: string,
): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM reading_saves WHERE user_id = ? AND reading_id = ?",
  ).bind(userId, readingId).run();
}
