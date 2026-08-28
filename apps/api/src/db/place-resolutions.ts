import { newId, type PlaceResolutionResponse } from "@patternlike/shared";

import { b64 } from "../crypto.js";
import type { Env } from "../env.js";
import {
  GEOCODER_POLICY_VERSION,
  GEOCODER_PROVIDER,
  type StoredPlaceResolution,
} from "../services/geocoder/types.js";
import { buildCryptoWriteFence } from "./crypto-write-fence.js";
import {
  decryptPayload,
  encryptPayload,
  type UserIdentity,
} from "./users.js";

export const PLACE_RESOLUTION_TTL_MS = 24 * 60 * 60 * 1000;

interface PlaceResolutionRow {
  id: string;
  payload_enc: ArrayBuffer | readonly number[];
  payload_key_version: number;
  payload_nonce: string;
}

function bytes(value: ArrayBuffer | readonly number[]): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : Uint8Array.from(value);
}

export async function storePlaceResolution(
  env: Env,
  identity: UserIdentity,
  value: StoredPlaceResolution,
  options: { now?: Date } = {},
): Promise<{ placeId: string; expiresAt: string }> {
  const now = options.now ?? new Date();
  const placeId = newId("plc");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PLACE_RESOLUTION_TTL_MS).toISOString();
  const sealed = await encryptPayload(env, identity, value, {
    subject: identity.cryptoSubject,
    field: "place_resolutions.payload_enc",
    recordId: placeId,
  });

  await env.DB.batch([
    buildCryptoWriteFence(env, {
      userId: identity.userId,
      keyVersion: sealed.keyVersion,
      allowedStatuses: ["active"],
    }),
    env.DB.prepare(
      `INSERT INTO place_resolutions (
         id, user_id, provider, policy_version, payload_enc,
         payload_key_version, payload_nonce, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      placeId,
      identity.userId,
      GEOCODER_PROVIDER,
      GEOCODER_POLICY_VERSION,
      Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
      sealed.keyVersion,
      sealed.nonce,
      createdAt,
      expiresAt,
    ),
  ]);

  return { placeId, expiresAt };
}

export async function loadPlaceResolution(
  env: Env,
  identity: UserIdentity,
  placeId: string,
  now = new Date(),
): Promise<PlaceResolutionResponse | null> {
  const row = await env.DB.prepare(
    `SELECT id, payload_enc, payload_key_version, payload_nonce
     FROM place_resolutions
     WHERE id = ? AND user_id = ? AND provider = ? AND policy_version = ?
       AND expires_at > ?`,
  ).bind(
    placeId,
    identity.userId,
    GEOCODER_PROVIDER,
    GEOCODER_POLICY_VERSION,
    now.toISOString(),
  ).first<PlaceResolutionRow>();
  if (!row) return null;

  const value = await decryptPayload<StoredPlaceResolution>(env, identity, {
    key_version: row.payload_key_version,
    nonce: row.payload_nonce,
    ciphertext: b64(bytes(row.payload_enc)),
  }, {
    subject: identity.cryptoSubject,
    field: "place_resolutions.payload_enc",
    recordId: row.id,
  });
  return {
    schema_version: "0.8.0",
    place_id: row.id,
    ...value,
  };
}

export function buildConsumePlaceResolution(
  env: Env,
  input: {
    userId: string;
    placeId: string;
    consumedAt: string;
    profileVersion?: number;
  },
): D1PreparedStatement {
  const profileGuard = input.profileVersion === undefined
    ? ""
    : ` AND EXISTS (
         SELECT 1 FROM birth_profiles
         WHERE user_id = ? AND version = ? AND status = 'pending'
       )`;
  const bindings: unknown[] = [
    input.consumedAt,
    input.placeId,
    input.userId,
    input.consumedAt,
  ];
  if (input.profileVersion !== undefined) {
    bindings.push(input.userId, input.profileVersion);
  }
  return env.DB.prepare(
    `UPDATE place_resolutions SET consumed_at = COALESCE(consumed_at, ?)
     WHERE id = ? AND user_id = ? AND expires_at > ?${profileGuard}`,
  ).bind(...bindings);
}

export async function pruneExpiredPlaceResolutions(
  env: Env,
  now = new Date(),
  limit = 100,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("place-resolution prune limit must be from 1 through 100");
  }
  const result = await env.DB.prepare(
    `DELETE FROM place_resolutions WHERE id IN (
       SELECT id FROM place_resolutions
       WHERE expires_at <= ? ORDER BY expires_at, id LIMIT ?
     )`,
  ).bind(now.toISOString(), limit).run();
  return result.meta.changes;
}
