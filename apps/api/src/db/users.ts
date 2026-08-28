import type { Env } from "../env.js";
import {
  b64,
  generateUserDek,
  wrapDek,
  unwrapDek,
  encryptJson,
  decryptJson,
  asCryptoSubject,
  KEK_DERIVATION_VERSION,
  type CryptoSubject,
  type EncryptedPayload,
  type EncryptionContext,
} from "../crypto.js";
import {
  resolveActiveRootKey,
  resolveRootKeyById,
} from "../services/root-kek-keyring.js";

/**
 * A user's two identifiers. `userId` addresses rows; `cryptoSubject` addresses
 * ciphertext. They are deliberately not interchangeable — see
 * docs/superpowers/archive/specs/2026-08-01-stream0-decisions-design.md §0.2.
 */
export interface UserIdentity {
  userId: string;
  cryptoSubject: CryptoSubject;
}

export type AccountStatus =
  | "active"
  | "frozen"
  | "pending_deletion"
  | "deleted";

export interface AuthenticatedUserIdentity extends UserIdentity {
  status: AccountStatus;
}

/** Read both identifiers for a user, or null if the user does not exist. */
export async function loadUserIdentity(
  env: Env,
  userId: string,
): Promise<AuthenticatedUserIdentity | null> {
  const row = await env.DB.prepare(
    "SELECT id, crypto_subject, status FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ id: string; crypto_subject: string; status: AccountStatus }>();
  if (!row) return null;
  return {
    userId: row.id,
    cryptoSubject: asCryptoSubject(row.crypto_subject),
    status: row.status,
  };
}

/**
 * The user id is carried as a field rather than interpolated into the message.
 * `onError` logs `err.message`, and the spec requires opaque user ids in error
 * telemetry — this error fires on the first request from a deleted account, so
 * interpolating would write that user's id into the log line every time.
 */
export class UserKeyDestroyedError extends Error {
  readonly code = "user_key_destroyed";
  constructor(readonly userId: string) {
    super("Encryption key has been destroyed for this account");
    this.name = "UserKeyDestroyedError";
  }
}

export class UnsupportedKekVersionError extends Error {
  readonly code = "kek_version_unsupported";
  constructor(found: number) {
    super(
      `user_keys.kek_version ${found} predates KEK derivation v${KEK_DERIVATION_VERSION}; ` +
        "recreate the local database with: npm run db:local -w @patternlike/api",
    );
    this.name = "UnsupportedKekVersionError";
  }
}

export class NoUserKeyError extends Error {
  readonly code = "user_key_missing";
  constructor(readonly userId: string) {
    super("No encryption key exists for this account");
    this.name = "NoUserKeyError";
  }
}

/** nonce(12) || ciphertext, as stored in user_keys.wrapped_dek. */
export function packWrapped(nonce_b64: string, wrapped_b64: string): Uint8Array {
  const nonce = Uint8Array.from(atob(nonce_b64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(wrapped_b64), (c) => c.charCodeAt(0));
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return packed;
}

interface LiveKeyRow {
  key_version: number;
  kek_version: number;
  wrapped_dek: ArrayBuffer;
  root_kek_id: string;
}

async function userKeysHaveRootKekId(env: Env): Promise<boolean> {
  const { results } = await env.DB.prepare("PRAGMA table_info(user_keys)")
    .all<{ name: string }>();
  return results.some((column) => column.name === "root_kek_id");
}

async function readLiveKey(env: Env, userId: string): Promise<LiveKeyRow | null> {
  const rootKekProjection = await userKeysHaveRootKekId(env)
    ? "root_kek_id"
    : "'legacy' AS root_kek_id";
  return env.DB.prepare(
    `SELECT key_version, kek_version, wrapped_dek, ${rootKekProjection} FROM user_keys
     WHERE user_id = ? AND destroyed_at IS NULL
     ORDER BY key_version DESC LIMIT 1`,
  )
    .bind(userId)
    .first<LiveKeyRow>();
}

/**
 * Load a user's live DEK. Never mints.
 *
 * Minting moved to identity-link time (db/identities.ts), so a user row that
 * exists without a key row is a real fault, not a first-use case. The previous
 * behaviour — mint on miss — meant that a user id change which failed to cascade
 * into user_keys silently produced a fresh DEK and orphaned every prior
 * ciphertext with a 200 response and no error anywhere.
 */
export async function loadUserKey(
  env: Env,
  id: UserIdentity,
): Promise<{ dek: Uint8Array; keyVersion: number }> {
  const active = await readLiveKey(env, id.userId);

  if (!active) {
    const destroyed = await env.DB.prepare(
      "SELECT 1 AS present FROM user_keys WHERE user_id = ? LIMIT 1",
    )
      .bind(id.userId)
      .first<{ present: number }>();
    throw destroyed
      ? new UserKeyDestroyedError(id.userId)
      : new NoUserKeyError(id.userId);
  }

  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  const root = await resolveRootKeyById(env, active.root_kek_id);
  const dek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    root,
    id.cryptoSubject,
    active.key_version,
  );
  return { dek, keyVersion: active.key_version };
}

/**
 * Build the user_keys INSERT for a brand-new user, so it can be batched with the
 * users and identities inserts. Returning a statement rather than running it is
 * what makes account creation atomic.
 */
export async function buildUserKeyInsert(
  env: Env,
  id: UserIdentity,
): Promise<D1PreparedStatement> {
  const storesRootKekId = await userKeysHaveRootKekId(env);
  const root = storesRootKekId
    ? await resolveActiveRootKey(env)
    : { keyId: "legacy", key: await resolveRootKeyById(env, "legacy") };
  const dek = await generateUserDek();
  const { wrapped_b64, nonce_b64 } = await wrapDek(
    dek,
    root.key,
    id.cryptoSubject,
    1,
  );
  if (!storesRootKekId) {
    return env.DB.prepare(
      `INSERT INTO user_keys (
         user_id, key_version, kek_version, wrapped_dek, created_at
       ) VALUES (?, 1, ?, ?, ?)`,
    ).bind(
      id.userId,
      KEK_DERIVATION_VERSION,
      packWrapped(nonce_b64, wrapped_b64),
      new Date().toISOString(),
    );
  }
  return env.DB.prepare(
    `INSERT INTO user_keys (
       user_id, key_version, kek_version, wrapped_dek, root_kek_id, created_at
     ) VALUES (?, 1, ?, ?, ?, ?)`,
  ).bind(
    id.userId,
    KEK_DERIVATION_VERSION,
    packWrapped(nonce_b64, wrapped_b64),
    root.keyId,
    new Date().toISOString(),
  );
}

export async function encryptPayload(
  env: Env,
  id: UserIdentity,
  value: unknown,
  ctx: EncryptionContext,
): Promise<EncryptedPayload & { keyVersion: number }> {
  const { dek, keyVersion } = await loadUserKey(env, id);
  const enc = await encryptJson(value, dek, keyVersion, ctx);
  return { ...enc, keyVersion: enc.key_version };
}

export async function decryptPayload<T = unknown>(
  env: Env,
  id: UserIdentity,
  payload: Pick<EncryptedPayload, "key_version" | "nonce" | "ciphertext">,
  ctx: EncryptionContext,
): Promise<T> {
  const { dek } = await loadUserKey(env, id);
  return decryptJson<T>(payload, dek, ctx);
}

/**
 * Re-wrap a user's DEK under another configured root-key identity.
 *
 * The DEK itself is unchanged, so no stored ciphertext is touched — this is the
 * cheap half of key rotation. The current and target secrets are resolved from
 * the versioned keyring and never cross this function boundary.
 */
export async function rewrapUserKey(
  env: Env,
  id: UserIdentity,
  targetRootKekId: string,
): Promise<{ keyVersion: number; rootKekId: string; changed: boolean }> {
  const active = await readLiveKey(env, id.userId);
  if (!active) throw new NoUserKeyError(id.userId);
  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  if (active.root_kek_id === targetRootKekId) {
    return {
      keyVersion: active.key_version,
      rootKekId: active.root_kek_id,
      changed: false,
    };
  }

  const oldRoot = await resolveRootKeyById(env, active.root_kek_id);
  const dek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    oldRoot,
    id.cryptoSubject,
    active.key_version,
  );

  const newRoot = await resolveRootKeyById(env, targetRootKekId);
  const { wrapped_b64, nonce_b64 } = await wrapDek(
    dek,
    newRoot,
    id.cryptoSubject,
    active.key_version,
  );

  const result = await env.DB.prepare(
    `UPDATE user_keys
     SET wrapped_dek = ?, root_kek_id = ?, rotated_at = ?
     WHERE user_id = ? AND key_version = ? AND destroyed_at IS NULL
       AND root_kek_id = ? AND wrapped_dek = ?`,
  )
    .bind(
      packWrapped(nonce_b64, wrapped_b64),
      targetRootKekId,
      new Date().toISOString(),
      id.userId,
      active.key_version,
      active.root_kek_id,
      active.wrapped_dek,
    )
    .run();

  return {
    keyVersion: active.key_version,
    rootKekId: result.meta.changes === 1
      ? targetRootKekId
      : active.root_kek_id,
    changed: result.meta.changes === 1,
  };
}

/**
 * Every column holding DEK-encrypted data, with the identifier that forms the
 * AAD's recordId. Rotation walks this list.
 *
 * Adding a new encrypted column WITHOUT adding it here would leave its data
 * under a destroyed key. `assertNoUnrotatedCiphertext` below is the tripwire.
 */
export const ENCRYPTED_COLUMNS = [
  {
    table: "birth_profiles",
    idColumn: "version",
    encColumn: "payload_enc",
    keyVersionColumn: "payload_key_version",
    nonceColumn: "payload_nonce",
  },
  {
    table: "chart_snapshots",
    idColumn: "id",
    encColumn: "birth_enc",
    keyVersionColumn: "birth_key_version",
    nonceColumn: "birth_nonce",
  },
  // M3. All three are per-user by construction: jobs.payload_enc carries a CHECK
  // requiring user_id, and reading_sources carries user_id specifically so this
  // walk can reach it through a composite foreign key that also rejects
  // cross-user evidence.
  {
    table: "jobs",
    idColumn: "id",
    encColumn: "payload_enc",
    keyVersionColumn: "payload_key_version",
    nonceColumn: "payload_nonce",
  },
  {
    table: "daily_readings",
    idColumn: "id",
    encColumn: "reading_enc",
    keyVersionColumn: "reading_key_version",
    nonceColumn: "reading_nonce",
  },
  {
    table: "reading_sources",
    idColumn: "id",
    encColumn: "evidence_enc",
    keyVersionColumn: "evidence_key_version",
    nonceColumn: "evidence_nonce",
  },
  // M5. Registered BEFORE the context compiler becomes its first writer: a
  // column written while it is still listed as unwritten is left under a
  // destroyed key at the next rotation, and nothing reports that until a reader
  // asks for a value that no longer decrypts. Rows with
  // `value_encoding = 'structured'` carry a NULL here and the rotation walk
  // skips them.
  {
    table: "context_signals",
    idColumn: "id",
    encColumn: "value_enc",
    keyVersionColumn: "value_key_version",
    nonceColumn: "value_nonce",
  },
  // USR-12. Optional notes on a feedback row. Moved off UNWRITTEN_ENCRYPTED_COLUMNS
  // before the writer landed: a note sealed while this sat in the unwritten
  // list would be left under a destroyed key at the next rotation.
  {
    table: "reading_feedback",
    idColumn: "id",
    encColumn: "notes_enc",
    keyVersionColumn: "notes_key_version",
    nonceColumn: "notes_nonce",
  },
  {
    table: "pattern_documents",
    idColumn: "id",
    encColumn: "wrapped_document_key_enc",
    keyVersionColumn: "wrapped_document_key_version",
    nonceColumn: "wrapped_document_key_nonce",
  },
  {
    table: "pattern_generation_artifact_keys",
    idColumn: "generation_id",
    encColumn: "wrapped_key_enc",
    keyVersionColumn: "wrapped_key_version",
    nonceColumn: "wrapped_key_nonce",
  },
  {
    table: "place_resolutions",
    idColumn: "id",
    encColumn: "payload_enc",
    keyVersionColumn: "payload_key_version",
    nonceColumn: "payload_nonce",
  },
] as const;

/**
 * Encrypted columns that are DECLARED in the schema but that nothing writes.
 *
 * Every `*_enc` column in db/d1 must appear in exactly one of these two lists.
 * `encrypted-columns.test.ts` reads the live schema and proves it, so a new
 * column cannot be added without a deliberate decision about rotation — which
 * is the failure this whole mechanism exists to prevent.
 */
export const UNWRITTEN_ENCRYPTED_COLUMNS = [
  { table: "chart_snapshots", encColumn: "snapshot_enc", keyVersionColumn: "snapshot_key_version" },
] as const;

/**
 * Ciphertext stored under a nested content key, not the user DEK.
 *
 * Rotation rewraps the matching wrapped-key column (in ENCRYPTED_COLUMNS) and
 * leaves these bodies untouched. They still have to be named here: the schema
 * tripwire treats every `*_enc BLOB` as a rotation decision.
 */
export const NESTED_CONTENT_CIPHERTEXT_COLUMNS = [
  {
    table: "pattern_documents",
    encColumn: "document_enc",
    wrappedKeyColumn: "wrapped_document_key_enc",
  },
] as const;

export async function assertNoUnrotatedCiphertext(
  env: Env,
  id: UserIdentity,
  newKeyVersion: number,
): Promise<void> {
  // These columns are declared but unwritten. The moment one acquires a writer
  // it must join ENCRYPTED_COLUMNS, or its data is left under a destroyed key
  // at the next rotation. Fail loudly rather than silently orphan it.
  //
  // Generalized from the single hardcoded chart_snapshots.snapshot_enc check:
  // M3 triples the number of encrypted columns, and a tripwire that covers one
  // of them is a tripwire for one specific past mistake rather than for the
  // class of mistake.
  for (const col of UNWRITTEN_ENCRYPTED_COLUMNS) {
    const orphan = await env.DB.prepare(
      `SELECT rowid AS row_id FROM ${col.table}
       WHERE user_id = ? AND ${col.encColumn} IS NOT NULL
         AND (${col.keyVersionColumn} IS NULL OR ${col.keyVersionColumn} <> ?)
       LIMIT 1`,
    )
      .bind(id.userId, newKeyVersion)
      .first<{ row_id: number }>();

    if (orphan) {
      throw new Error(
        `${col.table}.${col.encColumn} holds ciphertext that key rotation does not cover ` +
          `(rowid ${orphan.row_id}). Add it to ENCRYPTED_COLUMNS in apps/api/src/db/users.ts.`,
      );
    }
  }
}

/**
 * Rotate a user's DEK: generate a new one, re-encrypt everything it protects,
 * and destroy the old key.
 *
 * All reads and re-encryption happen before any write, and the writes go in a
 * single D1 batch, so a failure leaves the old key live and the old ciphertext
 * intact rather than half-rotated and unreadable.
 */
export async function rotateUserDek(
  env: Env,
  id: UserIdentity,
): Promise<{ keyVersion: number; reencrypted: number }> {
  const active = await readLiveKey(env, id.userId);
  if (!active) throw new NoUserKeyError(id.userId);
  if (active.kek_version !== KEK_DERIVATION_VERSION) {
    throw new UnsupportedKekVersionError(active.kek_version);
  }

  const oldRoot = await resolveRootKeyById(env, active.root_kek_id);
  const oldDek = await unwrapDek(
    new Uint8Array(active.wrapped_dek),
    oldRoot,
    id.cryptoSubject,
    active.key_version,
  );
  const newKeyVersion = active.key_version + 1;
  const newDek = await generateUserDek();
  const activeRoot = await resolveActiveRootKey(env);

  const writes: D1PreparedStatement[] = [];
  let reencrypted = 0;

  for (const col of ENCRYPTED_COLUMNS) {
    const found = await env.DB.prepare(
      `SELECT ${col.idColumn} AS record_id, ${col.encColumn} AS enc,
              ${col.keyVersionColumn} AS key_version, ${col.nonceColumn} AS nonce
       FROM ${col.table}
       WHERE user_id = ? AND ${col.encColumn} IS NOT NULL`,
    )
      .bind(id.userId)
      .all<{
        record_id: string | number;
        enc: ArrayBuffer;
        key_version: number;
        nonce: string;
      }>();

    for (const row of found.results) {
      const ctx: EncryptionContext = {
        subject: id.cryptoSubject,
        field: `${col.table}.${col.encColumn}`,
        recordId: String(row.record_id),
      };
      const plain = await decryptJson(
        {
          key_version: row.key_version,
          nonce: row.nonce,
          ciphertext: b64(new Uint8Array(row.enc)),
        },
        oldDek,
        ctx,
      );
      const sealed = await encryptJson(plain, newDek, newKeyVersion, ctx);
      writes.push(
        env.DB.prepare(
          `UPDATE ${col.table}
           SET ${col.encColumn} = ?, ${col.keyVersionColumn} = ?, ${col.nonceColumn} = ?
           WHERE user_id = ? AND ${col.idColumn} = ?`,
        ).bind(
          Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0)),
          newKeyVersion,
          sealed.nonce,
          id.userId,
          row.record_id,
        ),
      );
      reencrypted++;
    }
  }

  const now = new Date().toISOString();
  const { wrapped_b64, nonce_b64 } = await wrapDek(
    newDek,
    activeRoot.key,
    id.cryptoSubject,
    newKeyVersion,
  );

  // Destroy the old key before inserting the new one: uq_user_keys_active
  // permits only one row with destroyed_at IS NULL.
  writes.push(
    env.DB.prepare(
      `UPDATE user_keys SET rotated_at = ?, destroyed_at = ?
       WHERE user_id = ? AND key_version = ?`,
    ).bind(now, now, id.userId, active.key_version),
    env.DB.prepare(
      `INSERT INTO user_keys (
         user_id, key_version, kek_version, wrapped_dek, root_kek_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      id.userId,
      newKeyVersion,
      KEK_DERIVATION_VERSION,
      packWrapped(nonce_b64, wrapped_b64),
      activeRoot.keyId,
      now,
    ),
  );

  await env.DB.batch(writes);
  await assertNoUnrotatedCiphertext(env, id, newKeyVersion);

  return { keyVersion: newKeyVersion, reencrypted };
}
