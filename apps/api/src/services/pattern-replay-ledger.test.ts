import {
  M7_SCHEMA_VERSION,
  contentHash,
  jcsCanonicalize,
  sha256Hex,
} from "@patternlike/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env.js";
import {
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
