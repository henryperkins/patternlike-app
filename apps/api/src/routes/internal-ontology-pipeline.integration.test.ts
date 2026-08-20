import { env, SELF } from "cloudflare:test";
import { syntheticOntologyRelease } from "@patternlike/pattern-engine";
import {
  canonicalJson,
  contentHash,
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
import { commitOntologyPipelineEvidence } from "../services/pattern-ontology-evidence.js";
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
  } = {},
): Promise<PreparedMachineRelease> {
  const release = syntheticOntologyRelease(version) as MachineRelease;
  release.provenance = { origin: "machine_pipeline" };
  const evaluationReport = canonicalJson({
    schema_version: "0.7.0",
    ontology_version: version,
    compiler_passed: true,
    evaluator_passed: true,
    unevaluated_fixture_count: 0,
  });
  release.evaluation.evaluation_report_hash = await contentHash(evaluationReport);
  // Critical override proof: this intentionally disagrees with reality and has
  // no artifact. It remains signed contract data and is never an admission gate.
  release.evaluation.regression_passed = false;
  release.evaluation.regression_report_hash = `sha256:${"9".repeat(64)}`;
  release.bundle_hash = await computeOntologyBundleHash(release);

  const runId = `ontrun_${version}`;
  const artifactObjectKey =
    `pattern-ontology/pipeline/${runId}/evaluation-report.enc`;
  const opaqueArtifact = `opaque encrypted evaluation report for ${version}`;
  await env.ARTIFACTS!.put(artifactObjectKey, opaqueArtifact, {
    onlyIf: new Headers({ "if-none-match": "*" }),
  });
  if (options.commitEvidence !== false) {
    await commitOntologyPipelineEvidence(env, {
      runId,
      ontologyVersion: version,
      corpusReleaseId: `corpus-${version}`,
      corpusReleaseHash: release.corpus_release_hash,
      corpusLicenseClass: options.corpusLicenseClass ?? "licensed_excerpt",
      corpusPublicCapable: options.corpusPublicCapable ?? true,
      activationScope: options.activationScope ?? "public",
      bundleHash: release.bundle_hash,
      evaluationReportHash: release.evaluation.evaluation_report_hash,
      evaluationArtifactObjectKey: artifactObjectKey,
      evaluationArtifactCiphertextHash: await contentHash(opaqueArtifact),
      signingKeyId: key.keyId,
      compilerPassed: true,
      evaluatorPassed: true,
      unevaluatedFixtureCount: 0,
    });
  }
  return {
    release,
    signed: await signRelease(release, key),
    runId,
    artifactObjectKey,
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
      );
      const replacement =
        column === "signing_key_id"
          ? "different-signing-key"
          : `sha256:${"8".repeat(64)}`;
      await env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_evidence SET ${column} = ? WHERE run_id = ?`,
      )
        .bind(replacement, prepared.runId)
        .run();

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

  it("preserves the old pointer when a synthetic corpus is presented as public", async () => {
    const prepared = await prepareMachineRelease(
      "ontology-machine-synthetic-public",
      key,
      {
        activationScope: "internal",
        corpusLicenseClass: "internal_synthetic",
        corpusPublicCapable: false,
      },
    );
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_evidence
       SET activation_scope = 'public'
       WHERE run_id = ?`,
    )
      .bind(prepared.runId)
      .run();

    const response = await postRelease(prepared.signed);

    expect(response.status).toBe(409);
    expect((response.body.error as { code: string }).code).toBe(
      "ontology_corpus_not_public",
    );
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
      `A${prepared.signed.signature!.signature.slice(1)}`;

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
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_evidence
       SET bundle_hash = ? WHERE run_id = ?`,
    )
      .bind(prepared.release.bundle_hash, prepared.runId)
      .run();
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
    },
  );
});
