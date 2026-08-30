import {
  M7_SCHEMA_VERSION,
  M9_SCHEMA_VERSION,
  contentHash,
  jcsCanonicalize,
  sha256Hex,
} from "@patternlike/shared";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env.js";
import { storeOntologyRelease } from "../db/pattern-ontology.js";
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";
import {
  IDENTITY_A,
  USER_A,
  resetDb,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  applyPatternReplayEvent,
  applyPatternReplayReplica,
  parsePatternReplayKeyring,
  parsePatternReplaySigningKey,
  patternReplayEventId,
  patternReplayObjectKey,
  verifyPatternReplayEvent,
  writePatternReplayIntent,
  type PatternErasureReplayEvent,
  type PatternReplayIntentInput,
} from "./pattern-replay-ledger.js";

interface TestSigningKey {
  keyId: string;
  privateKey: CryptoKey;
  privateKeyPkcs8: string;
  publicKey: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function testSigningKey(
  keyId = "replay-2026-08",
): Promise<TestSigningKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    keyId,
    privateKey: pair.privateKey,
    privateKeyPkcs8: toBase64Url(new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer,
    )),
    publicKey: toBase64Url(new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer,
    )),
  };
}

function writerSecret(key: TestSigningKey): string {
  return JSON.stringify({
    version: 1,
    key_id: key.keyId,
    private_key_pkcs8: key.privateKeyPkcs8,
  });
}

function publicKeyring(...keys: TestSigningKey[]): string {
  return JSON.stringify(Object.fromEntries(keys.map((key) => [
    key.keyId,
    { alg: "Ed25519", public_key: key.publicKey },
  ])));
}

function replayEnv(
  signingKey: string | undefined,
  keys: string | undefined,
  bucket: R2Bucket = env.PATTERN_REPLAY_LEDGER!,
): Env {
  const overrides: Record<PropertyKey, unknown> = {
    PATTERN_REPLAY_LEDGER: bucket,
    PATTERN_REPLAY_LEDGER_KEYS: keys,
    PATTERN_REPLAY_LEDGER_SIGNING_KEY: signingKey,
  };
  return new Proxy(env, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property, overrides);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as Env;
}

function intent(
  overrides: Partial<PatternReplayIntentInput> = {},
): PatternReplayIntentInput {
  return {
    eventClass: "claim_consumed",
    semanticOperationKey: "pgen_11111111111111111111111111111111",
    targetUserId: "usr_11111111111111111111111111111111",
    chartFingerprintHash: `sha256:${"2".repeat(64)}`,
    claimId: "pgc_33333333333333333333333333333333",
    generationId: "pgen_11111111111111111111111111111111",
    patternId: "pat_44444444444444444444444444444444",
    ontologyVersion: "pattern-ontology-en-us-0.1.0",
    priorClaimStatus: "reserved",
    nextClaimStatus: "accepted",
    ...overrides,
  };
}

async function clearReplayObjects(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.PATTERN_REPLAY_LEDGER!.list({
      prefix: "pattern-erasure-replay/",
      cursor,
    });
    if (page.objects.length > 0) {
      await env.PATTERN_REPLAY_LEDGER!.delete(
        page.objects.map((object) => object.key),
      );
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

beforeEach(clearReplayObjects);

async function signedEvent(
  key: TestSigningKey,
): Promise<PatternErasureReplayEvent> {
  const semanticOperationKey = "pgen_11111111111111111111111111111111";
  const eventId = `prel_${(await sha256Hex(jcsCanonicalize([
    "pattern-erasure-replay-event-v1",
    "claim_consumed",
    semanticOperationKey,
  ]))).slice(0, 32)}`;
  const unsigned = {
    schema_version: M7_SCHEMA_VERSION,
    event_id: eventId,
    event_class: "claim_consumed" as const,
    occurred_at: "2026-08-22T14:00:00.000Z",
    target_user_id: "usr_11111111111111111111111111111111",
    chart_fingerprint_hash: `sha256:${"2".repeat(64)}`,
    claim_id: "pgc_33333333333333333333333333333333",
    generation_id: semanticOperationKey,
    pattern_id: "pat_44444444444444444444444444444444",
    ontology_version: "pattern-ontology-en-us-0.1.0",
    prior_claim_status: "reserved" as const,
    next_claim_status: "accepted" as const,
    signing_key_id: key.keyId,
  };
  const payload = jcsCanonicalize(unsigned);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    new TextEncoder().encode(payload),
  );
  return {
    ...unsigned,
    content_hash: await contentHash(payload),
    signature: toBase64Url(new Uint8Array(signature)),
  };
}

describe("Pattern replay key configuration", () => {
  it("parses exact Ed25519 writer and public-key shapes", async () => {
    const key = await testSigningKey();

    expect(parsePatternReplaySigningKey(writerSecret(key))).toMatchObject({
      keyId: key.keyId,
      privateKeyPkcs8: expect.any(Uint8Array),
    });
    expect(parsePatternReplayKeyring(publicKeyring(key))?.get(key.keyId))
      .toEqual(expect.any(Uint8Array));
  });

  it.each([
    undefined,
    "",
    "{",
    "[]",
    JSON.stringify({ version: 2, key_id: "replay-2026-08", private_key_pkcs8: "AAAA" }),
    JSON.stringify({ version: 1, key_id: "bad key", private_key_pkcs8: "AAAA" }),
    JSON.stringify({ version: 1, key_id: "replay-2026-08", private_key_pkcs8: "AA==" }),
    JSON.stringify({
      version: 1,
      key_id: "replay-2026-08",
      private_key_pkcs8: "AAAA",
      alg: "Ed25519",
    }),
  ])("rejects a malformed or open writer secret", (raw) => {
    expect(parsePatternReplaySigningKey(raw)).toBeNull();
  });

  it.each([
    undefined,
    "",
    "{",
    "[]",
    JSON.stringify({ key: { alg: "ES256", public_key: "AAAA" } }),
    JSON.stringify({ key: { alg: "Ed25519", public_key: "AAAA" } }),
    JSON.stringify({ key: { alg: "Ed25519", public_key: "AA==" } }),
    JSON.stringify({
      key: { alg: "Ed25519", public_key: "A".repeat(43), extra: true },
    }),
  ])("rejects a malformed or open public keyring", (raw) => {
    expect(parsePatternReplayKeyring(raw)).toBeNull();
  });
});

describe("Pattern replay event verification", () => {
  it("accepts an exact schema-valid JCS hash and signature", async () => {
    const key = await testSigningKey();
    const event = await signedEvent(key);

    await expect(verifyPatternReplayEvent(event, publicKeyring(key)))
      .resolves.toEqual(event);
  });

  it("rejects an unknown signing key", async () => {
    const key = await testSigningKey();
    const other = await testSigningKey("replay-other");

    await expect(
      verifyPatternReplayEvent(await signedEvent(key), publicKeyring(other)),
    ).rejects.toMatchObject({ code: "replay_event_key_unknown" });
  });

  it("rejects changed content hashes and semantic fields", async () => {
    const key = await testSigningKey();
    const event = await signedEvent(key);

    await expect(verifyPatternReplayEvent({
      ...event,
      content_hash: `sha256:${"f".repeat(64)}`,
    }, publicKeyring(key))).rejects.toMatchObject({
      code: "replay_event_hash_mismatch",
    });
    await expect(verifyPatternReplayEvent({
      ...event,
      pattern_id: "pat_55555555555555555555555555555555",
    }, publicKeyring(key))).rejects.toMatchObject({
      code: "replay_event_hash_mismatch",
    });
  });

  it("rejects a valid recomputed hash when the signature covers older semantics", async () => {
    const key = await testSigningKey();
    const event = await signedEvent(key);
    const changed = {
      ...event,
      pattern_id: "pat_55555555555555555555555555555555",
    };
    const { content_hash: _contentHash, signature: _signature, ...unsigned } = changed;
    changed.content_hash = await contentHash(jcsCanonicalize(unsigned));

    await expect(verifyPatternReplayEvent(changed, publicKeyring(key)))
      .rejects.toMatchObject({ code: "replay_event_signature_invalid" });
  });

  it("rejects malformed signatures and schema-extra fields", async () => {
    const key = await testSigningKey();
    const event = await signedEvent(key);

    await expect(verifyPatternReplayEvent({
      ...event,
      signature: "not+base64url",
    }, publicKeyring(key))).rejects.toMatchObject({
      code: "replay_event_signature_invalid",
    });
    await expect(verifyPatternReplayEvent({
      ...event,
      prompt: "must never enter the replay ledger",
    }, publicKeyring(key))).rejects.toMatchObject({
      code: "replay_event_schema_invalid",
    });
  });
});

describe("Pattern replay create-only replica", () => {
  it("stores one signed canonical event at its deterministic object key", async () => {
    const key = await testSigningKey();
    const input = intent();
    const prepared = await writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      input,
      new Date("2026-08-22T14:20:00.000Z"),
    );
    const expectedId = await patternReplayEventId(
      input.eventClass,
      input.semanticOperationKey,
    );

    expect(prepared.event).toMatchObject({
      event_id: expectedId,
      occurred_at: "2026-08-22T14:20:00.000Z",
      signing_key_id: key.keyId,
    });
    expect(prepared.objectKey).toBe(patternReplayObjectKey(expectedId));
    expect(prepared.replicaPutAt).toMatch(/^2026-/);
    const stored = await env.PATTERN_REPLAY_LEDGER!.get(prepared.objectKey);
    expect(await stored!.text()).toBe(jcsCanonicalize(prepared.event));
    await expect(
      verifyPatternReplayEvent(prepared.event, publicKeyring(key)),
    ).resolves.toEqual(prepared.event);
  });

  it("adopts exact original bytes, timestamp, and key after writer rotation", async () => {
    const firstKey = await testSigningKey("replay-first");
    const nextKey = await testSigningKey("replay-next");
    const input = intent();
    const first = await writePatternReplayIntent(
      replayEnv(writerSecret(firstKey), publicKeyring(firstKey, nextKey)),
      input,
      new Date("2026-08-22T14:21:00.000Z"),
    );
    const replay = await writePatternReplayIntent(
      replayEnv(writerSecret(nextKey), publicKeyring(firstKey, nextKey)),
      input,
      new Date("2026-08-22T15:21:00.000Z"),
    );

    expect(replay).toEqual(first);
    expect(replay.event.signing_key_id).toBe(firstKey.keyId);
    expect(replay.event.occurred_at).toBe("2026-08-22T14:21:00.000Z");
  });

  it("adopts a valid conditional-create race winner", async () => {
    const key = await testSigningKey();
    const input = intent();
    const base = replayEnv(writerSecret(key), publicKeyring(key));
    const winner = await writePatternReplayIntent(
      base,
      input,
      new Date("2026-08-22T14:22:00.000Z"),
    );
    const winnerBytes = jcsCanonicalize(winner.event);
    await env.PATTERN_REPLAY_LEDGER!.delete(winner.objectKey);
    let firstRead = true;
    const racingBucket = new Proxy(env.PATTERN_REPLAY_LEDGER!, {
      get(target, property, receiver) {
        if (property === "get") {
          return async (...args: Parameters<R2Bucket["get"]>) => {
            if (firstRead) {
              firstRead = false;
              return null;
            }
            return target.get(...args);
          };
        }
        if (property === "put") {
          return async (..._args: Parameters<R2Bucket["put"]>) => {
            await target.put(winner.objectKey, winnerBytes);
            return null;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;

    const adopted = await writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key), racingBucket),
      input,
      new Date("2026-08-22T15:22:00.000Z"),
    );

    expect(adopted.event).toEqual(winner.event);
    const storedWinner = await env.PATTERN_REPLAY_LEDGER!.get(winner.objectKey);
    expect(adopted.replicaPutAt).toBe(storedWinner!.uploaded.toISOString());
  });

  it("fails closed on valid but mismatched bytes under the occupied key", async () => {
    const key = await testSigningKey();
    const configured = replayEnv(writerSecret(key), publicKeyring(key));
    const other = await writePatternReplayIntent(
      configured,
      intent({
        eventClass: "pattern_deleted",
        semanticOperationKey: "delete-operation-other",
        priorClaimStatus: "accepted",
        nextClaimStatus: "deleted",
      }),
    );
    const otherObject = await env.PATTERN_REPLAY_LEDGER!.get(other.objectKey);
    const otherBytes = await otherObject!.text();
    await env.PATTERN_REPLAY_LEDGER!.delete(other.objectKey);
    const expectedId = await patternReplayEventId(
      "claim_consumed",
      intent().semanticOperationKey,
    );
    await env.PATTERN_REPLAY_LEDGER!.put(
      patternReplayObjectKey(expectedId),
      otherBytes,
    );

    await expect(writePatternReplayIntent(configured, intent()))
      .rejects.toMatchObject({ code: "replay_replica_integrity" });
  });

  it("refuses missing or non-allowlisted writer configuration before R2", async () => {
    const key = await testSigningKey();
    const impostor = await testSigningKey(key.keyId);

    await expect(writePatternReplayIntent(
      replayEnv(undefined, publicKeyring(key)),
      intent(),
    )).rejects.toMatchObject({ code: "replay_signing_configuration_invalid" });
    await expect(writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(impostor)),
      intent(),
    )).rejects.toMatchObject({ code: "replay_signing_configuration_invalid" });
    expect((await env.PATTERN_REPLAY_LEDGER!.list({
      prefix: "pattern-erasure-replay/",
    })).objects).toEqual([]);
  });

  it("leaves no adopted intent when R2 write and read both fail", async () => {
    const key = await testSigningKey();
    const failingBucket = new Proxy(env.PATTERN_REPLAY_LEDGER!, {
      get(target, property, receiver) {
        if (property === "get") return async () => null;
        if (property === "put") {
          return async () => {
            throw new Error("injected R2 outage");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;

    await expect(writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key), failingBucket),
      intent(),
    )).rejects.toMatchObject({ code: "replay_replica_unavailable" });
  });
});

describe("Pattern replay D1 receipts", () => {
  beforeEach(resetDb);

  it("inserts every signed field and adopts an exact D1 replay", async () => {
    const key = await testSigningKey();
    const prepared = await writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      intent(),
      new Date("2026-08-22T14:40:00.000Z"),
    );

    await env.DB.batch(prepared.receiptStatements(env));
    await env.DB.batch(prepared.receiptStatements(env));

    const row = await env.DB.prepare(
      "SELECT * FROM pattern_erasure_replay_events WHERE event_id = ?",
    ).bind(prepared.event.event_id).first<Record<string, unknown>>();
    expect(row).toEqual({
      event_id: prepared.event.event_id,
      event_class: prepared.event.event_class,
      occurred_at: prepared.event.occurred_at,
      target_user_id: prepared.event.target_user_id,
      chart_fingerprint_hash: prepared.event.chart_fingerprint_hash,
      claim_id: prepared.event.claim_id,
      generation_id: prepared.event.generation_id,
      pattern_id: prepared.event.pattern_id,
      replacement_generation_id: null,
      replacement_pattern_id: null,
      ontology_version: prepared.event.ontology_version,
      prior_claim_status: prepared.event.prior_claim_status,
      next_claim_status: prepared.event.next_claim_status,
      pattern_source_hash: null,
      content_hash: prepared.event.content_hash,
      signing_key_id: prepared.event.signing_key_id,
      signature: prepared.event.signature,
      replica_put_at: prepared.replicaPutAt,
      created_at: prepared.replicaPutAt,
    });
  });

  it("signs and receipts both sides of one source replacement", async () => {
    const key = await testSigningKey();
    const prepared = await writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      {
        ...intent(),
        eventClass: "pattern_regenerated",
        semanticOperationKey: "pgen_99999999999999999999999999999999",
        priorClaimStatus: "accepted",
        nextClaimStatus: "accepted",
        replacementGenerationId: "pgen_99999999999999999999999999999999",
        replacementPatternId: "pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        patternSourceHash: `sha256:${"b".repeat(64)}`,
      } as unknown as PatternReplayIntentInput,
      new Date("2026-08-22T14:40:30.000Z"),
    );

    expect(prepared.event).toMatchObject({
      schema_version: M9_SCHEMA_VERSION,
      event_class: "pattern_regenerated",
      replacement_generation_id: "pgen_99999999999999999999999999999999",
      replacement_pattern_id: "pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pattern_source_hash: `sha256:${"b".repeat(64)}`,
    });
    await expect(
      verifyPatternReplayEvent(prepared.event, publicKeyring(key)),
    ).resolves.toEqual(prepared.event);
    await env.DB.batch(prepared.receiptStatements(env));
    expect(await env.DB.prepare(
      `SELECT replacement_generation_id, replacement_pattern_id, pattern_source_hash
       FROM pattern_erasure_replay_events WHERE event_id = ?`,
    ).bind(prepared.event.event_id).first()).toEqual({
      replacement_generation_id: "pgen_99999999999999999999999999999999",
      replacement_pattern_id: "pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pattern_source_hash: `sha256:${"b".repeat(64)}`,
    });
  });

  it("arms assertion_probe and rolls back a lifecycle batch on receipt mismatch", async () => {
    const key = await testSigningKey();
    const prepared = await writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      intent(),
      new Date("2026-08-22T14:41:00.000Z"),
    );
    await env.DB.batch(prepared.receiptStatements(env));
    await env.DB.prepare(
      `UPDATE pattern_erasure_replay_events
       SET target_user_id = ? WHERE event_id = ?`,
    ).bind(
      "usr_99999999999999999999999999999999",
      prepared.event.event_id,
    ).run();

    await expect(env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pattern_provider_daily_usage
           (utc_date, used_calls, created_at, updated_at,
            planner_calls, writer_calls, verifier_calls)
         VALUES ('2026-08-22', 0, ?, ?, 0, 0, 0)`,
      ).bind(prepared.replicaPutAt, prepared.replicaPutAt),
      ...prepared.receiptStatements(env),
    ])).rejects.toThrow();
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_provider_daily_usage",
    ).first<{ count: number }>()).toEqual({ count: 0 });
  });
});

describe("Pattern replay claim application", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  async function claimEvent(
    key: TestSigningKey,
    priorClaimStatus: "available" | "reserved" = "reserved",
  ) {
    return writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      intent({ targetUserId: USER_A, priorClaimStatus }),
      new Date("2026-08-22T14:42:00.000Z"),
    );
  }

  async function insertClaim(
    status: "available" | "reserved" | "accepted" | "deleted",
  ): Promise<void> {
    const input = intent({ targetUserId: USER_A });
    const consumedAt = status === "accepted" || status === "deleted"
      ? "2026-08-22T14:00:00.000Z"
      : null;
    const activeGenerationId = status === "reserved" ? input.generationId : null;
    await env.DB.prepare(
      `INSERT INTO pattern_generation_claims (
         id, user_id, chart_fingerprint_hash, last_chart_id, status,
         active_generation_id, consumed_at, accepted_at, deleted_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.claimId,
      USER_A,
      input.chartFingerprintHash,
      status,
      activeGenerationId,
      consumedAt,
      status === "accepted" ? consumedAt : null,
      status === "deleted" ? consumedAt : null,
      "2026-08-22T13:00:00.000Z",
      "2026-08-22T14:00:00.000Z",
    ).run();
  }

  it.each(["available", "reserved"] as const)(
    "moves a restored %s claim only forward and adopts an exact replay",
    async (status) => {
      const key = await testSigningKey();
      await insertClaim(status);
      const prepared = await claimEvent(key, status);
      const configured = replayEnv(writerSecret(key), publicKeyring(key));

      await expect(applyPatternReplayEvent(
        configured,
        prepared.event,
        new Date(prepared.replicaPutAt),
      )).resolves.toBe("applied");
      await expect(applyPatternReplayEvent(
        configured,
        prepared.event,
        new Date(prepared.replicaPutAt),
      )).resolves.toBe("replay");

      expect(await env.DB.prepare(
        `SELECT status, active_generation_id, consumed_at, accepted_at
         FROM pattern_generation_claims WHERE id = ?`,
      ).bind(prepared.event.claim_id).first()).toEqual({
        status: "accepted",
        active_generation_id: null,
        consumed_at: prepared.event.occurred_at,
        accepted_at: prepared.event.occurred_at,
      });
    },
  );

  it("leaves an already-terminal claim terminal", async () => {
    const key = await testSigningKey();
    await insertClaim("deleted");
    const prepared = await claimEvent(key);

    await applyPatternReplayEvent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      prepared.event,
      new Date(prepared.replicaPutAt),
    );

    expect(await env.DB.prepare(
      "SELECT status, deleted_at FROM pattern_generation_claims WHERE id = ?",
    ).bind(prepared.event.claim_id).first()).toEqual({
      status: "deleted",
      deleted_at: "2026-08-22T14:00:00.000Z",
    });
  });

  it("inserts a pinned terminal tombstone for an absent claim when the user exists", async () => {
    const key = await testSigningKey();
    const prepared = await claimEvent(key, "available");

    await applyPatternReplayEvent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      prepared.event,
      new Date(prepared.replicaPutAt),
    );

    expect(await env.DB.prepare(
      `SELECT user_id, chart_fingerprint_hash, status, consumed_at,
              active_generation_id
       FROM pattern_generation_claims WHERE id = ?`,
    ).bind(prepared.event.claim_id).first()).toEqual({
      user_id: USER_A,
      chart_fingerprint_hash: prepared.event.chart_fingerprint_hash,
      status: "accepted",
      consumed_at: prepared.event.occurred_at,
      active_generation_id: null,
    });
  });
});

describe("Pattern replay erasure application", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  async function seedAcceptedPattern(): Promise<void> {
    const input = intent({ targetUserId: USER_A });
    const at = "2026-08-22T14:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pattern_generation_claims (
           id, user_id, chart_fingerprint_hash, status, active_generation_id,
           consumed_at, accepted_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'accepted', NULL, ?, ?, ?, ?)`,
      ).bind(input.claimId, USER_A, input.chartFingerprintHash, at, at, at, at),
      env.DB.prepare(
        `INSERT INTO jobs (
           id, job_type, user_id, idempotency_key, status, created_at
         ) VALUES ('job_replay_pattern', 'generate_pattern', ?,
                   'replay-pattern-fixture', 'succeeded', ?)`,
      ).bind(USER_A, at),
      env.DB.prepare(
        `INSERT INTO pattern_generation_jobs (
           generation_id, job_id, user_id, claim_id, chart_id,
           chart_fingerprint_hash, feature_set_id, feature_set_hash,
           feature_policy_version, selection_policy_version, locale,
           locale_revision, consent_id, consent_policy_version,
           ontology_version, ontology_bundle_hash, corpus_release_hash,
           pattern_source_hash, reservation_reason, stage, stage_generation, created_at, updated_at,
           finished_at
         ) VALUES (?, 'job_replay_pattern', ?, ?, 'cht_replay_pattern', ?,
                   'nfs_replay_pattern', ?, '1.0.0', '1.0.0', 'en-US', 1,
                   'cns_replay_pattern', '1.0.0', ?, ?, ?, ?, 'first_open',
                   'succeeded', 1, ?, ?, ?)`,
      ).bind(
        input.generationId,
        USER_A,
        input.claimId,
        input.chartFingerprintHash,
        `sha256:${"5".repeat(64)}`,
        input.ontologyVersion,
        `sha256:${"6".repeat(64)}`,
        `sha256:${"7".repeat(64)}`,
        `sha256:${"9".repeat(64)}`,
        at,
        at,
        at,
      ),
      env.DB.prepare(
        `INSERT INTO pattern_generation_artifact_keys (
           generation_id, user_id, wrapped_key_enc, wrapped_key_version,
           wrapped_key_nonce, created_at, erased_at
         ) VALUES (?, ?, ?, 1, 'nonce', ?, NULL)`,
      ).bind(input.generationId, USER_A, new Uint8Array([1, 2, 3]), at),
      env.DB.prepare(
        `INSERT INTO pattern_documents (
           id, user_id, claim_id, generation_id, chart_fingerprint_hash,
           ontology_version, ontology_bundle_hash, locale, effective_accuracy,
           document_enc, document_nonce, wrapped_document_key_enc,
           wrapped_document_key_version, wrapped_document_key_nonce,
           content_hash, compact_provenance_json, pattern_source_hash,
           generated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'en-US', 'exact', ?, 'document-nonce',
                   ?, 1, 'wrapped-nonce', ?, '{}', ?, ?, ?)`,
      ).bind(
        input.patternId,
        USER_A,
        input.claimId,
        input.generationId,
        input.chartFingerprintHash,
        input.ontologyVersion,
        `sha256:${"6".repeat(64)}`,
        new Uint8Array([4, 5, 6]),
        new Uint8Array([7, 8, 9]),
        `sha256:${"8".repeat(64)}`,
        `sha256:${"9".repeat(64)}`,
        at,
        at,
      ),
    ]);
  }

  it.each([
    ["pattern_deleted", "deleted"],
    ["chart_correction_erased", "superseded"],
    ["pattern_withdrawn", "withdrawn"],
  ] as const)(
    "%s erases the restored document and key and pins the claim %s",
    async (eventClass, nextClaimStatus) => {
      await seedAcceptedPattern();
      const key = await testSigningKey();
      const prepared = await writePatternReplayIntent(
        replayEnv(writerSecret(key), publicKeyring(key)),
        intent({
          eventClass,
          semanticOperationKey: `replay-erasure:${eventClass}`,
          targetUserId: USER_A,
          priorClaimStatus: "accepted",
          nextClaimStatus,
        }),
        new Date("2026-08-22T14:43:00.000Z"),
      );

      await applyPatternReplayEvent(
        replayEnv(writerSecret(key), publicKeyring(key)),
        prepared.event,
        new Date(prepared.replicaPutAt),
      );

      expect(await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM pattern_documents",
      ).first()).toEqual({ count: 0 });
      expect(await env.DB.prepare(
        `SELECT wrapped_key_enc, wrapped_key_version, wrapped_key_nonce, erased_at
         FROM pattern_generation_artifact_keys WHERE generation_id = ?`,
      ).bind(prepared.event.generation_id).first()).toEqual({
        wrapped_key_enc: null,
        wrapped_key_version: null,
        wrapped_key_nonce: null,
        erased_at: prepared.event.occurred_at,
      });
      expect(await env.DB.prepare(
        "SELECT status, active_generation_id FROM pattern_generation_claims WHERE id = ?",
      ).bind(prepared.event.claim_id).first()).toEqual({
        status: nextClaimStatus,
        active_generation_id: null,
      });
    },
  );
});

describe("Pattern replay ontology recall application", () => {
  beforeEach(resetDb);

  async function recallEvent(key: TestSigningKey, version: string) {
    return writePatternReplayIntent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      intent({
        eventClass: "ontology_recalled",
        semanticOperationKey: version,
        targetUserId: null,
        chartFingerprintHash: null,
        claimId: null,
        generationId: null,
        patternId: null,
        ontologyVersion: version,
        priorClaimStatus: null,
        nextClaimStatus: null,
      }),
      new Date("2026-08-22T14:44:00.000Z"),
    );
  }

  it("recalls an existing release and clears its active pointer", async () => {
    const version = "ontology-replay-existing";
    const at = "2026-08-22T14:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pattern_ontology_releases (
           version, bundle_hash, corpus_release_hash, locale, status,
           object_key, evaluation_json, created_at, recalled_at
         ) VALUES (?, ?, ?, 'en-US', 'active', ?, '{}', ?, NULL)`,
      ).bind(
        version,
        `sha256:${"a".repeat(64)}`,
        `sha256:${"b".repeat(64)}`,
        `pattern-ontology/${version}.json`,
        at,
      ),
      env.DB.prepare(
        "UPDATE pattern_ontology_pointer SET active_version = ?, updated_at = ? WHERE id = 1",
      ).bind(version, at),
    ]);
    const key = await testSigningKey();
    const prepared = await recallEvent(key, version);

    await applyPatternReplayEvent(
      replayEnv(writerSecret(key), publicKeyring(key)),
      prepared.event,
      new Date(prepared.replicaPutAt),
    );

    expect(await env.DB.prepare(
      "SELECT status, recalled_at FROM pattern_ontology_releases WHERE version = ?",
    ).bind(version).first()).toEqual({
      status: "recalled",
      recalled_at: prepared.event.occurred_at,
    });
    expect(await env.DB.prepare(
      "SELECT active_version FROM pattern_ontology_pointer WHERE id = 1",
    ).first()).toEqual({ active_version: null });
  });

  it("retains an absent-release tombstone and refuses later ingestion", async () => {
    const version = "ontology-replay-pre-release";
    const key = await testSigningKey();
    const prepared = await recallEvent(key, version);
    const configured = replayEnv(writerSecret(key), publicKeyring(key));
    await applyPatternReplayEvent(
      configured,
      prepared.event,
      new Date(prepared.replicaPutAt),
    );

    expect(await env.DB.prepare(
      `SELECT event_class, ontology_version
       FROM pattern_erasure_replay_events WHERE event_id = ?`,
    ).bind(prepared.event.event_id).first()).toEqual({
      event_class: "ontology_recalled",
      ontology_version: version,
    });
    const release = syntheticOntologyRelease(version);
    const bundleHash = await computeOntologyBundleHash(release);
    await expect(storeOntologyRelease(
      configured,
      { ...release, bundle_hash: bundleHash },
      `pattern-ontology/${version}.json`,
    )).rejects.toThrow("ontology_version_recalled");
  });
});

describe("Pattern replay account deletion application", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
    await seedChart(IDENTITY_A);
  });

  it("deletes a pre-request restore and retains only proof tombstones", async () => {
    const exportId = `exp_${"a".repeat(32)}`;
    const objectKey = `exports/${exportId}.json.enc`;
    const createdAt = "2026-08-22T14:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO export_requests (
         id, user_id, status, idempotency_key, created_at, status_updated_at
       ) VALUES (?, ?, 'queued', 'replay-account-export', ?, ?)`,
    ).bind(exportId, USER_A, createdAt, createdAt).run();
    await env.ARTIFACTS!.put(objectKey, "encrypted export fixture");

    const key = await testSigningKey();
    const configured = replayEnv(writerSecret(key), publicKeyring(key));
    const prepared = await writePatternReplayIntent(
      configured,
      intent({
        eventClass: "account_deleted",
        semanticOperationKey: "del_restore_predates_request",
        targetUserId: USER_A,
        chartFingerprintHash: null,
        claimId: null,
        generationId: null,
        patternId: null,
        ontologyVersion: null,
        priorClaimStatus: null,
        nextClaimStatus: "deleted",
      }),
      new Date("2026-08-22T14:45:00.000Z"),
    );

    await expect(applyPatternReplayEvent(
      configured,
      prepared.event,
      new Date(prepared.replicaPutAt),
    )).resolves.toBe("applied");
    await expect(applyPatternReplayEvent(
      configured,
      prepared.event,
      new Date(prepared.replicaPutAt),
    )).resolves.toBe("replay");

    expect(await env.ARTIFACTS!.head(objectKey)).toBeNull();
    expect(await env.DB.prepare(
      `SELECT status, locale, timezone, entitlement_tier, deleted_at
       FROM users WHERE id = ?`,
    ).bind(USER_A).first()).toEqual({
      status: "deleted",
      locale: "und",
      timezone: "UTC",
      entitlement_tier: "none",
      deleted_at: prepared.event.occurred_at,
    });
    expect(await env.DB.prepare(
      `SELECT wrapped_dek, destroyed_at, erased_at
       FROM user_keys WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({
      wrapped_dek: null,
      destroyed_at: prepared.event.occurred_at,
      erased_at: prepared.event.occurred_at,
    });
    expect(await env.DB.prepare(
      `SELECT id, status, checkpoint, dek_destroyed, completed_at
       FROM deletion_requests WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({
      id: prepared.event.event_id,
      status: "completed",
      checkpoint: "completed",
      dek_destroyed: 1,
      completed_at: prepared.event.occurred_at,
    });
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM chart_snapshots WHERE user_id = ?`,
    ).bind(USER_A).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT event_class FROM pattern_erasure_replay_events WHERE event_id = ?`,
    ).bind(prepared.event.event_id).first()).toEqual({
      event_class: "account_deleted",
    });
  });
});

describe("Pattern replay replica sweep", () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(IDENTITY_A);
  });

  it("verifies, applies, and then idempotently replays the complete replica", async () => {
    const key = await testSigningKey();
    const configured = replayEnv(writerSecret(key), publicKeyring(key));
    const prepared = await writePatternReplayIntent(
      configured,
      intent({ targetUserId: USER_A, priorClaimStatus: "available" }),
      new Date("2026-08-22T14:45:00.000Z"),
    );

    await expect(applyPatternReplayReplica(
      configured,
      new Date("2026-08-22T14:46:00.000Z"),
    )).resolves.toEqual({ listed: 1, applied: 1, replayed: 0 });
    await expect(applyPatternReplayReplica(
      configured,
      new Date("2026-08-22T14:47:00.000Z"),
    )).resolves.toEqual({ listed: 1, applied: 0, replayed: 1 });
    expect(await env.DB.prepare(
      "SELECT status FROM pattern_generation_claims WHERE id = ?",
    ).bind(prepared.event.claim_id).first()).toEqual({ status: "accepted" });
  });

  it("verifies every listed object before making any D1 change", async () => {
    const key = await testSigningKey();
    const configured = replayEnv(writerSecret(key), publicKeyring(key));
    const prepared = await writePatternReplayIntent(
      configured,
      intent({ targetUserId: USER_A, priorClaimStatus: "available" }),
      new Date("2026-08-22T14:48:00.000Z"),
    );
    await env.PATTERN_REPLAY_LEDGER!.put(
      `pattern-erasure-replay/prel_${"f".repeat(32)}.json`,
      "{}",
    );

    await expect(applyPatternReplayReplica(configured))
      .rejects.toMatchObject({ code: "replay_replica_integrity" });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_generation_claims WHERE id = ?",
    ).bind(prepared.event.claim_id).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pattern_erasure_replay_events",
    ).first()).toEqual({ count: 0 });
  });
});
