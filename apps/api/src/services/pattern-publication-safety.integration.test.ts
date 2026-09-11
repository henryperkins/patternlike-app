import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { storeOntologyRelease } from "../db/pattern-ontology.js";
import { decryptPayload, encryptPayload } from "../db/users.js";
import { b64 } from "../crypto.js";
import { PATTERN_CREATION_SOURCE_HASH } from "../generated/pattern-creation-source.js";
import type { GeneratePatternCommandV2 } from "./pattern-command.js";
import { computeOntologyBundleHash } from "./pattern-ontology-verify.js";
import {
  DETERMINISTIC_PATTERN_PUBLISHER,
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedPatternOntologyCorpus,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  clearPatternReplayObjects,
  generatePatternReplayTestKeys,
  installPatternReplayTestKeys,
} from "../../test/pattern-replay-fixtures.js";
import { executePatternJob, type PatternExecuteOverrides } from "./pattern-execute.js";
import { loadPatternJob } from "./pattern-stage-protocol.js";

async function json(path: string, init: RequestInit = {}) {
  const response = await SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      "x-user-id": USER_A,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function reserve(key: string, reason = "first_open") {
  const response = await json("/v1/pattern-generations", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      schema_version: "0.9.0",
      consent_policy_version: "1.1.0",
      confirm: reason === "source_update" ? "REGENERATE MY PATTERN" : "GENERATE MY PATTERN",
      reason,
    }),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return (response.body.generation as { generation_id: string }).generation_id;
}

const unsafePublisher: PatternExecuteOverrides = {
  publisher: (context) => {
    const publisher = DETERMINISTIC_PATTERN_PUBLISHER.publisher!(context);
    return {
      ...publisher,
      write: async (...args) => {
        const outcome = await publisher.write(...args);
        if (outcome.ok) {
          outcome.value.chapters[0]!.summary =
            "Do not hesitate: your chart guarantees success. " + outcome.value.chapters[0]!.summary;
        }
        return outcome;
      },
    };
  },
};

async function drain(generationId: string, overrides = DETERMINISTIC_PATTERN_PUBLISHER) {
  for (let step = 0; step < 10; step++) {
    const job = await loadPatternJob(env, generationId);
    if (!job) throw new Error("Pattern job missing");
    if (["succeeded", "failed", "cancelled"].includes(job.stage)) return job;
    await executePatternJob(env, {
      kind: "pattern_generation",
      generation_id: generationId,
      job_id: job.job_id,
      stage_generation: job.stage_generation,
    }, new Date(), overrides);
  }
  throw new Error("Pattern job did not terminate within its attempt budget");
}

describe("universal Pattern publication safety", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPatternReplayObjects(env.PATTERN_REPLAY_LEDGER!);
    installPatternReplayTestKeys(env, await generatePatternReplayTestKeys());
    enablePatternAi();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
  });

  afterEach(() => disablePatternAi());

  it("cancels a command frozen under the prior publication-safety source before running a provider", async () => {
    await seedActiveOntology("ont-safety-frozen-source");
    const generationId = await reserve("idem-safety-frozen-source");
    const reserved = (await loadPatternJob(env, generationId))!;
    // main 69a4f78 used safety 1.0.0. Model a legitimate old command whose
    // encrypted pin and job agree, not corruption of only one stored hash.
    const priorSourceHash = "sha256:dd93fde6dbc7f7de8c7598c3eafc70912533e41efe66b4a964f08206f2985e34";
    expect(priorSourceHash).not.toBe(PATTERN_CREATION_SOURCE_HASH);
    const payload = await env.DB.prepare(
      "SELECT payload_enc, payload_key_version, payload_nonce FROM jobs WHERE id = ?",
    ).bind(reserved.job_id).first<{
      payload_enc: ArrayBuffer; payload_key_version: number; payload_nonce: string;
    }>();
    const context = { subject: IDENTITY_A.cryptoSubject, field: "jobs.payload_enc", recordId: reserved.job_id };
    const command = await decryptPayload<GeneratePatternCommandV2>(env, IDENTITY_A, {
      ciphertext: b64(payload!.payload_enc),
      key_version: payload!.payload_key_version,
      nonce: payload!.payload_nonce,
    }, context);
    const sealed = await encryptPayload(env, IDENTITY_A, {
      ...command, pattern_source_hash: priorSourceHash,
    }, context);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET payload_enc = ?, payload_key_version = ?, payload_nonce = ? WHERE id = ?",
      ).bind(Uint8Array.from(atob(sealed.ciphertext), (character) => character.charCodeAt(0)),
        sealed.keyVersion, sealed.nonce, reserved.job_id),
      env.DB.prepare("UPDATE pattern_generation_jobs SET pattern_source_hash = ? WHERE generation_id = ?")
        .bind(priorSourceHash, generationId),
    ]);
    const job = await drain(generationId, {
      publisher: () => { throw new Error("an old source must not start a provider"); },
    });
    expect(job.stage).toBe("cancelled");
    expect(job.planner_attempts).toBe(0);
    expect(job.writer_attempts).toBe(0);
    expect(await env.DB.prepare(
      "SELECT cancellation_reason FROM pattern_generation_jobs WHERE generation_id = ?",
    ).bind(generationId).first()).toEqual({ cancellation_reason: "cancel_source_changed" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pattern_documents").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare(
      "SELECT status FROM pattern_generation_claims WHERE user_id = ?",
    ).bind(USER_A).first()).toEqual({ status: "available" });
  });

  it.each(["internal", "public"] as const)(
    "rejects unsafe summary prose despite a passing semantic verifier for %s ontology",
    async (activationScope) => {
      if (activationScope === "internal") {
        const release = await seedPatternOntologyCorpus(syntheticOntologyRelease("ont-safety"));
        release.provenance = { origin: "synthetic_internal" };
        release.bundle_hash = await computeOntologyBundleHash(release);
        await storeOntologyRelease(env, release, "pattern-ontology/ont-safety.json");
      } else {
        await seedActiveOntology("ont-safety");
      }
      const generationId = await reserve(`idem-safety-${activationScope}`);
      const job = await drain(generationId, unsafePublisher);
      expect(job.stage).toBe("failed");
      expect(job.writer_attempts).toBe(2);
      expect(await env.DB.prepare(
        "SELECT failure_class FROM pattern_generation_jobs WHERE generation_id = ?",
      ).bind(generationId).first()).toEqual({ failure_class: "publication_safety_failed" });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pattern_documents").first())
        .toEqual({ n: 0 });
      expect(await env.DB.prepare(
        "SELECT status FROM pattern_generation_claims WHERE user_id = ?",
      ).bind(USER_A).first()).toEqual({ status: "available" });
    },
  );

  it("retains the prior readable Pattern after an unsafe replacement exhausts its writer budget", async () => {
    await seedActiveOntology("ont-safety-prior");
    const originalJob = await drain(await reserve("idem-safety-prior"));
    expect(originalJob.stage).toBe("succeeded");
    const stored = await env.DB.prepare(
      "SELECT compact_provenance_json FROM pattern_documents WHERE user_id = ?",
    ).bind(USER_A).first<{ compact_provenance_json: string }>();
    expect(JSON.parse(stored!.compact_provenance_json)).toMatchObject({
      publication_safety: {
        policy_version: "1.0.1",
        candidate_hash: originalJob.candidate_hash,
        result_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    const original = await json("/v1/pattern");
    expect(original.status).toBe(200);
    await env.DB.prepare(
      "UPDATE pattern_documents SET pattern_source_hash = ? WHERE user_id = ?",
    ).bind(`sha256:${"0".repeat(64)}`, USER_A).run();
    const generationId = await reserve("idem-safety-replacement", "source_update");
    const job = await drain(generationId, unsafePublisher);
    expect(job.stage).toBe("failed");
    expect(await json("/v1/pattern")).toEqual(original);
    expect(await env.DB.prepare(
      "SELECT status, pending_regeneration_id FROM pattern_generation_claims WHERE user_id = ?",
    ).bind(USER_A).first()).toEqual({ status: "accepted", pending_regeneration_id: null });
  });

  it("refuses publication when the registered corpus bytes are missing", async () => {
    await seedActiveOntology("ont-safety-corpus-missing");
    const generationId = await reserve("idem-safety-corpus-missing");
    await env.ARTIFACTS!.delete("pattern-ontology-corpora/corpus-ont-safety-corpus-missing.json");
    const job = await drain(generationId);
    expect(job.stage).toBe("failed");
    expect(job.writer_attempts).toBe(0);
    expect(await env.DB.prepare(
      "SELECT failure_class FROM pattern_generation_jobs WHERE generation_id = ?",
    ).bind(generationId).first()).toEqual({ failure_class: "publication_safety_failed" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pattern_documents").first())
      .toEqual({ n: 0 });
  });

  it("lets the writer correct an invented derived reference within the existing attempt budget", async () => {
    await seedActiveOntology("ont-safety-correctable-reference");
    let writes = 0;
    const overrides: PatternExecuteOverrides = {
      publisher: (context) => {
        const publisher = DETERMINISTIC_PATTERN_PUBLISHER.publisher!(context);
        return {
          ...publisher,
          write: async (...args) => {
            const outcome = await publisher.write(...args);
            if (outcome.ok && writes++ === 0) {
              outcome.value.chapters[0]!.sections[0]!.derived_synthesis_ids = [`ont_${"f".repeat(32)}`];
            }
            return outcome;
          },
        };
      },
    };
    const generationId = await reserve("idem-safety-correctable-reference");
    const job = await drain(generationId, overrides);
    expect(job.stage).toBe("succeeded");
    expect(job.writer_attempts).toBe(1);
    expect(writes).toBe(2);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pattern_documents").first())
      .toEqual({ n: 1 });
  });
});
