import { env, SELF } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import {
  canonicalJson,
  type PatternOntologyRelease,
} from "@patternlike/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_A,
  USER_A,
  confirmPreferences,
  disablePatternAi,
  enablePatternAi,
  resetDb,
  seedActiveOntology,
  seedChart,
  seedUser,
} from "../../test/helpers.js";
import {
  generateSigningKey,
  releaseKeysVar,
  toBase64Url,
  type ReleaseSigningKey,
} from "../../test/content-release-fixtures.js";
import {
  buildTestCorpusManifest,
  buildTestEvaluationArtifact,
  buildTestEvaluationReport,
  putTestCorpusManifest,
  putTestEvaluationArtifact,
  testOntologyPipelineArtifactKeyring,
} from "../../test/ontology-pipeline-fixtures.js";
import {
  commitOntologyPipelineEvidence,
  type CommitOntologyPipelineEvidenceInput,
} from "../services/pattern-ontology-evidence.js";
import {
  computeOntologyBundleHash,
  ontologySigningPayload,
  type SignedOntologyRelease,
} from "../services/pattern-ontology-verify.js";

interface MachineRelease extends PatternOntologyRelease {
  provenance: { origin: "machine_pipeline" };
}

interface PreparedMachineRelease {
  release: MachineRelease;
  signed: SignedOntologyRelease;
  runId: string;
  artifactObjectKey: string;
  corpusObjectKey: string;
}

async function signRelease(
  release: PatternOntologyRelease,
  key: ReleaseSigningKey,
): Promise<SignedOntologyRelease> {
  const signature = await crypto.subtle.sign(
    key.alg === "ES256"
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: key.privateKey.algorithm.name },
    key.privateKey,
    new TextEncoder().encode(ontologySigningPayload(release)),
  );
  return {
    ...release,
    signature: {
      alg: key.alg,
      key_id: key.keyId,
      signature: toBase64Url(new Uint8Array(signature)),
      signed_payload_hash: release.bundle_hash,
    },
  };
}

async function prepareMachineRelease(
  version: string,
  key: ReleaseSigningKey,
  options: {
    activationScope?: "internal" | "public";
    corpusLicenseClass?: "licensed_excerpt" | "internal_synthetic";
    corpusPublicCapable?: boolean;
    commitEvidence?: boolean;
    evidenceMismatch?:
      | "corpus_release_hash"
      | "bundle_hash"
      | "evaluation_report_hash"
      | "signing_key_id";
  } = {},
): Promise<PreparedMachineRelease> {
  const release = syntheticOntologyRelease(version) as MachineRelease;
  release.provenance = { origin: "machine_pipeline" };
  release.status = "candidate";
  const corpusReleaseId = `corpus-${version}`;
  const corpusLicenseClass =
    options.corpusLicenseClass ?? "licensed_excerpt";
  const corpus = await buildTestCorpusManifest(
    corpusReleaseId,
    release.locale,
    corpusLicenseClass,
  );
  const corpusObjectKey = await putTestCorpusManifest(
    env.ARTIFACTS!,
    corpus,
  );
  release.corpus_release_hash = corpus.corpus_hash;
  const evaluationReport = buildTestEvaluationReport(version);
  const runId = `ontrun_${version}`;
  const artifact = await buildTestEvaluationArtifact(
    runId,
    version,
    evaluationReport,
  );
  release.evaluation.evaluation_report_hash = artifact.plaintextHash;
  // Critical override proof: this intentionally disagrees with reality and has
  // no artifact. It remains signed contract data and is never an admission gate.
  release.evaluation.regression_passed = false;
  release.evaluation.regression_report_hash = `sha256:${"9".repeat(64)}`;
  if (options.evidenceMismatch === "corpus_release_hash") {
    release.corpus_release_hash = `sha256:${"8".repeat(64)}`;
  }
  if (options.evidenceMismatch === "evaluation_report_hash") {
    release.evaluation.evaluation_report_hash =
      `sha256:${"8".repeat(64)}`;
  }
  release.bundle_hash = await computeOntologyBundleHash(release);

  const artifactObjectKey = await putTestEvaluationArtifact(
    env.ARTIFACTS!,
    runId,
    artifact.bytes,
  );
  if (options.commitEvidence !== false) {
    const input: CommitOntologyPipelineEvidenceInput = {
      runId,
      ontologyVersion: version,
      corpusReleaseId,
      corpusReleaseHash: corpus.corpus_hash,
      corpusLicenseClass,
      corpusPublicCapable:
        options.corpusPublicCapable ??
        corpusLicenseClass === "licensed_excerpt",
      activationScope: options.activationScope ?? "public",
      bundleHash: options.evidenceMismatch === "bundle_hash"
        ? `sha256:${"8".repeat(64)}`
        : release.bundle_hash,
      evaluationReportHash: artifact.plaintextHash,
      evaluationArtifactObjectKey: artifactObjectKey,
      evaluationArtifactEnvelopeHash: artifact.envelopeHash,
      evaluationArtifactCiphertextHash: artifact.ciphertextHash,
      signingKeyId: options.evidenceMismatch === "signing_key_id"
        ? "different-signing-key"
        : key.keyId,
      compilerPassed: true,
      evaluatorPassed: true,
      unevaluatedFixtureCount: 0,
    };
    await commitOntologyPipelineEvidence(env, input);
  }
  return {
    release,
    signed: await signRelease(release, key),
    runId,
    artifactObjectKey,
    corpusObjectKey,
  };
}

async function postRelease(release: SignedOntologyRelease): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await SELF.fetch(
    "http://api.test/internal/pattern-ontology-releases",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(release),
    },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function activePointer(): Promise<{
  active_version: string | null;
  bundle_hash: string | null;
}> {
  return (await env.DB.prepare(
    `SELECT p.active_version, r.bundle_hash
     FROM pattern_ontology_pointer p
     LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version
     WHERE p.id = 1`,
  ).first<{ active_version: string | null; bundle_hash: string | null }>())!;
}

describe("machine ontology ingestion", () => {
  let key: ReleaseSigningKey;

  beforeEach(async () => {
    await resetDb();
    disablePatternAi();
    env.PATTERN_ONTOLOGY_KEYS = "";
    await seedActiveOntology("ontology-prior-active");
    key = await generateSigningKey("ontology-pipeline-key");
    env.PATTERN_ONTOLOGY_KEYS = releaseKeysVar([key]);
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING =
      testOntologyPipelineArtifactKeyring();
  });

  afterEach(async () => {
    disablePatternAi();
    env.PATTERN_ONTOLOGY_KEYS = "";
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS fail_machine_ontology_evaluation_receipt",
    ).run();
  });

  it("activates a signed, evaluated machine release for a non-internal account and records evaluation atomically", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-valid",
      key,
    );

    const response = await postRelease(prepared.signed);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await activePointer()).toEqual({
      active_version: prepared.release.ontology_version,
      bundle_hash: prepared.release.bundle_hash,
    });
    const storedObject = await env.ARTIFACTS!.get(
      `pattern-ontology/${prepared.release.ontology_version}.json`,
    );
    expect(storedObject).not.toBeNull();
    expect(await storedObject!.text()).toBe(canonicalJson(prepared.signed));
    const storedRow = await env.DB.prepare(
      `SELECT status FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first<{ status: string }>();
    expect(storedRow?.status).toBe("active");
    const evaluationRuns = await env.DB.prepare(
      `SELECT ontology_version, verdict, summary_json
       FROM pattern_ontology_evaluation_runs`,
    ).all<{
      ontology_version: string;
      verdict: string;
      summary_json: string;
    }>();
    expect(evaluationRuns.results).toHaveLength(1);
    expect(evaluationRuns.results[0]).toEqual(
      expect.objectContaining({
        ontology_version: prepared.release.ontology_version,
        verdict: "pass",
      }),
    );
    expect(JSON.parse(evaluationRuns.results[0]!.summary_json)).toEqual(
      expect.objectContaining({
        run_id: prepared.runId,
        activation_scope: "public",
        evaluation_report_hash:
          prepared.release.evaluation.evaluation_report_hash,
      }),
    );

    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    enablePatternAi();
    env.PATTERN_INTERNAL_ACCOUNT_IDS = "";
    const reservation = await SELF.fetch(
      "http://api.test/v1/pattern-generations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "idem-machine-public-release",
        },
        body: JSON.stringify({
          schema_version: "0.7.0",
          consent_policy_version: "1.0.0",
          confirm: "GENERATE MY PATTERN",
          reason: "first_open",
        }),
      },
    );
    expect(reservation.status).toBe(202);
  });

  it("refuses a machine release signed with active status", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-active-payload",
      key,
    );
    prepared.release.status = "active";
    prepared.release.bundle_hash = await computeOntologyBundleHash(
      prepared.release,
    );
    const signedActive = await signRelease(prepared.release, key);

    const response = await postRelease(signedActive);

    expect(response.status).toBe(400);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_status_not_candidate",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
    expect(
      await env.ARTIFACTS!.get(
        `pattern-ontology/${prepared.release.ontology_version}.json`,
      ),
    ).toBeNull();
  });

  it("falls back to internal scope when public evidence no longer matches the release row", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-public-row-corruption",
      key,
    );
    expect((await postRelease(prepared.signed)).status).toBe(201);
    await env.DB.prepare(
      `UPDATE pattern_ontology_releases
       SET evaluation_json = '{}'
       WHERE version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .run();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    enablePatternAi();
    env.PATTERN_INTERNAL_ACCOUNT_IDS = "";

    const reservation = await SELF.fetch(
      "http://api.test/v1/pattern-generations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "idem-machine-corrupt-public-receipt",
        },
        body: JSON.stringify({
          schema_version: "0.7.0",
          consent_policy_version: "1.0.0",
          confirm: "GENERATE MY PATTERN",
          reason: "first_open",
        }),
      },
    );

    expect(reservation.status).toBe(409);
    expect(
      ((await reservation.json()) as { error: { code: string } }).error.code,
    ).toBe("ontology_unavailable");
    const state = await SELF.fetch("http://api.test/v1/pattern-state", {
      headers: { "x-user-id": USER_A },
    });
    expect(state.status).toBe(200);
    expect(
      ((await state.json()) as { state: string }).state,
    ).toBe("ontology_unavailable");
  });

  it("falls back to internal scope when the atomic evaluation receipt is missing", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-evaluation-receipt-missing",
      key,
    );
    expect((await postRelease(prepared.signed)).status).toBe(201);
    await env.DB.prepare(
      `DELETE FROM pattern_ontology_evaluation_runs
       WHERE ontology_version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .run();
    await seedUser(IDENTITY_A);
    await confirmPreferences(USER_A);
    await seedChart(IDENTITY_A);
    enablePatternAi();
    env.PATTERN_INTERNAL_ACCOUNT_IDS = "";

    const reservation = await SELF.fetch(
      "http://api.test/v1/pattern-generations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": USER_A,
          "idempotency-key": "idem-machine-missing-evaluation-receipt",
        },
        body: JSON.stringify({
          schema_version: "0.7.0",
          consent_policy_version: "1.0.0",
          confirm: "GENERATE MY PATTERN",
          reason: "first_open",
        }),
      },
    );

    expect(reservation.status).toBe(409);
    expect(
      ((await reservation.json()) as { error: { code: string } }).error.code,
    ).toBe("ontology_unavailable");
    const state = await SELF.fetch("http://api.test/v1/pattern-state", {
      headers: { "x-user-id": USER_A },
    });
    expect(state.status).toBe(200);
    expect(
      ((await state.json()) as { state: string }).state,
    ).toBe("ontology_unavailable");
  });

  it("treats identical replay as idempotent", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-replay",
      key,
    );
    expect((await postRelease(prepared.signed)).status).toBe(201);

    const replay = await postRelease(prepared.signed);

    expect(replay.status).toBe(201);
    const releases = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_ontology_releases
       WHERE version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first<{ n: number }>();
    const evaluations = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_ontology_evaluation_runs
       WHERE ontology_version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first<{ n: number }>();
    expect(releases?.n).toBe(1);
    expect(evaluations?.n).toBe(1);
  });

  it("treats a delayed replay of a superseded release as a no-op", async () => {
    const first = await prepareMachineRelease(
      "ontology-machine-stale-replay-first",
      key,
    );
    const second = await prepareMachineRelease(
      "ontology-machine-stale-replay-second",
      key,
    );
    expect((await postRelease(first.signed)).status).toBe(201);
    expect((await postRelease(second.signed)).status).toBe(201);

    const replay = await postRelease(first.signed);

    expect(replay.status).toBe(201);
    expect(replay.body.status).toBe("superseded");
    expect((await activePointer()).active_version).toBe(
      second.release.ontology_version,
    );
  });

  it("keeps a stale superseded replay inert after the newer release is recalled", async () => {
    const oldRelease = await prepareMachineRelease(
      "ontology-machine-stale-after-recall-old",
      key,
    );
    const newRelease = await prepareMachineRelease(
      "ontology-machine-stale-after-recall-new",
      key,
    );
    expect((await postRelease(oldRelease.signed)).status).toBe(201);
    expect((await postRelease(newRelease.signed)).status).toBe(201);
    const recall = await SELF.fetch(
      `http://api.test/internal/pattern-ontology-releases/${newRelease.release.ontology_version}/recall`,
      { method: "POST" },
    );
    expect(recall.status).toBe(200);
    expect(await activePointer()).toEqual({
      active_version: null,
      bundle_hash: null,
    });

    const replay = await postRelease(oldRelease.signed);

    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.status).toBe("superseded");
    expect(await activePointer()).toEqual({
      active_version: null,
      bundle_hash: null,
    });
    const oldState = await env.DB.prepare(
      `SELECT r.status,
              (
                SELECT COUNT(*)
                FROM pattern_ontology_evaluation_runs e
                WHERE e.ontology_version = r.version
              ) AS evaluation_count
       FROM pattern_ontology_releases r
       WHERE r.version = ?`,
    )
      .bind(oldRelease.release.ontology_version)
      .first<{ status: string; evaluation_count: number }>();
    expect(oldState).toEqual({
      status: "superseded",
      evaluation_count: 1,
    });
  });

  it("converges concurrent identical first ingestions without a 500", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-concurrent-replay",
      key,
    );

    const responses = await Promise.all([
      postRelease(prepared.signed),
      postRelease(prepared.signed),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect((await activePointer()).active_version).toBe(
      prepared.release.ontology_version,
    );
    const releases = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_ontology_releases
       WHERE version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first<{ n: number }>();
    const evaluations = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pattern_ontology_evaluation_runs
       WHERE ontology_version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first<{ n: number }>();
    expect(releases?.n).toBe(1);
    expect(evaluations?.n).toBe(1);
  });

  it("preserves the old pointer when machine evidence is missing", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-no-evidence",
      key,
      { commitEvidence: false },
    );

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_pipeline_evidence_missing",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("returns 503 when the evaluation artifact keyring is missing", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-keyring-missing",
      key,
    );
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING = "";

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(503);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_evaluation_artifact_keyring_missing",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("returns 503 when the evaluation artifact keyring is malformed", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-keyring-invalid",
      key,
    );
    env.ONTOLOGY_PIPELINE_ARTIFACT_KEYRING = "{";

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(503);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_evaluation_artifact_keyring_invalid",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it.each([
    ["corpus_release_hash", "ontology_evidence_corpus_mismatch"],
    ["bundle_hash", "ontology_evidence_bundle_mismatch"],
    ["evaluation_report_hash", "ontology_evidence_evaluation_mismatch"],
    ["signing_key_id", "ontology_evidence_signing_key_mismatch"],
  ] as const)(
    "preserves the old pointer when %s evidence mismatches",
    async (column, code) => {
      const prepared = await prepareMachineRelease(
        `ontology-machine-bad-${column}`,
        key,
        { evidenceMismatch: column },
      );

      const response = await postRelease(prepared.signed);

      expect(response.status).toBe(409);
      expect((response.body.error as { code: string }).code).toBe(code);
      expect((await activePointer()).active_version).toBe(
        "ontology-prior-active",
      );
    },
  );

  it("preserves the old pointer when the committed evaluation artifact is gone", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-artifact-gone",
      key,
    );
    await env.ARTIFACTS!.delete(prepared.artifactObjectKey);

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_evaluation_artifact_missing",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("preserves the old pointer when the committed corpus manifest is replaced", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-corpus-replaced",
      key,
    );
    await env.ARTIFACTS!.put(
      prepared.corpusObjectKey,
      canonicalJson({
        replacement: "not the committed corpus manifest",
      }),
    );

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_corpus_manifest_invalid",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("preserves the old pointer when a synthetic corpus is presented as public", async () => {
    await expect(
      prepareMachineRelease(
        "ontology-machine-synthetic-public",
        key,
        {
          activationScope: "public",
          corpusLicenseClass: "internal_synthetic",
          corpusPublicCapable: false,
        },
      ),
    ).rejects.toMatchObject({ code: "ontology_corpus_not_public" });
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("preserves the old pointer on an invalid signature", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-bad-signature",
      key,
    );
    prepared.signed.signature!.signature =
      `${prepared.signed.signature!.signature[0] === "A" ? "B" : "A"}${prepared.signed.signature!.signature.slice(1)}`;

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(400);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_signature_invalid",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
  });

  it("rejects changed bytes under an activated version without moving its pointer", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-immutable",
      key,
    );
    expect((await postRelease(prepared.signed)).status).toBe(201);
    const originalHash = prepared.release.bundle_hash;
    prepared.release.records[0]!.normalized_proposition += " changed";
    prepared.release.bundle_hash = await computeOntologyBundleHash(
      prepared.release,
    );
    const changed = await signRelease(prepared.release, key);

    const response = await postRelease(changed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_version_immutable",
    );
    expect(await activePointer()).toEqual({
      active_version: prepared.release.ontology_version,
      bundle_hash: originalHash,
    });
  });

  it("never revives a recalled evidenced version", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-recalled",
      key,
    );
    expect((await postRelease(prepared.signed)).status).toBe(201);
    const recall = await SELF.fetch(
      `http://api.test/internal/pattern-ontology-releases/${prepared.release.ontology_version}/recall`,
      { method: "POST" },
    );
    expect(recall.status).toBe(200);
    env.PATTERN_ONTOLOGY_KEYS = "";
    await seedActiveOntology("ontology-after-recall");
    env.PATTERN_ONTOLOGY_KEYS = releaseKeysVar([key]);

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_version_recalled",
    );
    expect((await activePointer()).active_version).toBe(
      "ontology-after-recall",
    );
  });

  it("rolls back pointer movement when the evaluation receipt insert fails", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-atomic",
      key,
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_machine_ontology_evaluation_receipt
       BEFORE INSERT ON pattern_ontology_evaluation_runs
       BEGIN
         SELECT RAISE(ABORT, 'forced evaluation receipt failure');
       END`,
    ).run();

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(500);
    expect((await activePointer()).active_version).toBe(
      "ontology-prior-active",
    );
    const release = await env.DB.prepare(
      `SELECT version FROM pattern_ontology_releases WHERE version = ?`,
    )
      .bind(prepared.release.ontology_version)
      .first();
    expect(release).toBeNull();
  });

  it.each(["synthetic_internal", undefined] as const)(
    "keeps %s ontology releases internal-only without requiring machine evidence",
    async (origin) => {
      const release = syntheticOntologyRelease(
        `ontology-${origin ?? "legacy"}-internal`,
      );
      if (origin) release.provenance = { origin };
      release.bundle_hash = await computeOntologyBundleHash(release);
      const signed = await signRelease(release, key);
      expect((await postRelease(signed)).status).toBe(201);

      await seedUser(IDENTITY_A);
      await confirmPreferences(USER_A);
      await seedChart(IDENTITY_A);
      enablePatternAi();
      env.PATTERN_INTERNAL_ACCOUNT_IDS = "";
      const reservation = await SELF.fetch(
        "http://api.test/v1/pattern-generations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": USER_A,
            "idempotency-key": `idem-${origin ?? "legacy"}-internal-only`,
          },
          body: JSON.stringify({
            schema_version: "0.7.0",
            consent_policy_version: "1.0.0",
            confirm: "GENERATE MY PATTERN",
            reason: "first_open",
          }),
        },
      );

      expect(reservation.status).toBe(409);
      const body = (await reservation.json()) as {
        error: { code: string };
      };
      expect(body.error.code).toBe("ontology_unavailable");
      const state = await SELF.fetch("http://api.test/v1/pattern-state", {
        headers: { "x-user-id": USER_A },
      });
      expect(state.status).toBe(200);
      expect(
        ((await state.json()) as { state: string }).state,
      ).toBe("ontology_unavailable");
    },
  );
});
