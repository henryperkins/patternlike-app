import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import { storeOntologyRelease } from "../db/pattern-ontology.js";
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
        policy_version: "1.0.0",
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
