import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

const NOW = "2026-08-21T00:00:00.000Z";
const HASH = (pair: string): string => `sha256:${pair.repeat(32)}`;

interface CorpusRow {
  corpus_release_id: string;
  corpus_hash: string;
  locale: string;
  object_key: string;
  fragment_count: number;
  license_class: "licensed_excerpt" | "internal_synthetic";
  public_capable: number;
  created_at: string;
  registered_at: string;
}

interface RunRow {
  run_id: string;
  idempotency_key: string;
  corpus_release_id: string;
  corpus_hash: string;
  candidate_ontology_version: string;
  configuration_json: string;
  configuration_hash: string;
  stage: string;
  stage_generation: number;
  stage_cursor: number;
  stage_attempt: number;
  claim_token: string | null;
  lease_expires_at: string | null;
  available_at: string;
  dispatched_at: string | null;
  failure_class: string | null;
  candidate_hash: string | null;
  compilation_report_hash: string | null;
  evaluation_report_hash: string | null;
  regression_report_hash: string | null;
  bundle_hash: string | null;
  failed_artifact_expires_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
}

const CORPUS: CorpusRow = {
  corpus_release_id: "corpus-schema-test-1",
  corpus_hash: HASH("10"),
  locale: "en-US",
  object_key: "pattern-ontology-corpora/corpus-schema-test-1.json",
  fragment_count: 40,
  license_class: "internal_synthetic",
  public_capable: 0,
  created_at: NOW,
  registered_at: NOW,
};

const RUN: RunRow = {
  run_id: "oprun_schema_test_1",
  idempotency_key: "ontology-pipeline-schema-test-1",
  corpus_release_id: CORPUS.corpus_release_id,
  corpus_hash: CORPUS.corpus_hash,
  candidate_ontology_version: "1.0.0-machine-test",
  configuration_json: JSON.stringify({
    generator_model: "gpt-test-generator",
    evaluator_model: "gpt-test-evaluator",
    regression_threshold_percent: 90,
    failed_artifact_retention_days: 7,
  }),
  configuration_hash: HASH("20"),
  stage: "reserved",
  stage_generation: 0,
  stage_cursor: 0,
  stage_attempt: 0,
  claim_token: null,
  lease_expires_at: null,
  available_at: NOW,
  dispatched_at: null,
  failure_class: null,
  candidate_hash: null,
  compilation_report_hash: null,
  evaluation_report_hash: null,
  regression_report_hash: null,
  bundle_hash: null,
  failed_artifact_expires_at: null,
  created_at: NOW,
  updated_at: NOW,
  finished_at: null,
  succeeded_at: null,
  failed_at: null,
};

async function execute(
  sql: string,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(values);
  await env.DB.prepare(
    `${sql} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).bind(...Object.values(values)).run();
}

async function insertCorpus(overrides: Partial<CorpusRow> = {}): Promise<void> {
  await execute(
    "INSERT INTO pattern_source_corpus_releases",
    { ...CORPUS, ...overrides },
  );
}

async function insertRun(overrides: Partial<RunRow> = {}): Promise<void> {
  await execute(
    "INSERT INTO pattern_ontology_pipeline_runs",
    { ...RUN, ...overrides },
  );
}

async function expectRejected(work: () => Promise<unknown>): Promise<void> {
  await expect(work()).rejects.toThrow();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pattern_ontology_pipeline_artifacts"),
    env.DB.prepare("DELETE FROM pattern_ontology_pipeline_runs"),
    env.DB.prepare("DELETE FROM pattern_source_corpus_releases"),
  ]);
});

describe("ontology pipeline migration", () => {
  it("creates non-user-owned minimizing control-plane tables", async () => {
    for (const table of [
      "pattern_source_corpus_releases",
      "pattern_ontology_pipeline_runs",
      "pattern_ontology_pipeline_artifacts",
    ]) {
      const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
        name: string;
      }>();
      expect(columns.results.length).toBeGreaterThan(0);
      const names = columns.results.map((column) => column.name);
      expect(names).not.toContain("user_id");
      expect(names).not.toContain("plaintext_key");
      expect(names).not.toContain("corpus_text");
      expect(names).not.toContain("provider_request");
      expect(names).not.toContain("provider_response");
      expect(names).not.toContain("evaluator_rationale");
      expect(names).not.toContain("report_body");

      const foreignKeys = await env.DB.prepare(
        `PRAGMA foreign_key_list(${table})`,
      ).all<{ table: string }>();
      expect(foreignKeys.results.map((foreignKey) => foreignKey.table))
        .not.toContain("users");
    }
  });

  it("keeps registered corpus identity and capability immutable", async () => {
    await insertCorpus();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_source_corpus_releases SET corpus_hash = ?
       WHERE corpus_release_id = ?`,
    ).bind(HASH("11"), CORPUS.corpus_release_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_source_corpus_releases SET object_key = ?
       WHERE corpus_release_id = ?`,
    ).bind("pattern-ontology-corpora/changed.json", CORPUS.corpus_release_id).run());
    await expectRejected(() => insertCorpus({
      corpus_release_id: "corpus-mixed-capability",
      corpus_hash: HASH("12"),
      object_key: "pattern-ontology-corpora/corpus-mixed-capability.json",
      license_class: "internal_synthetic",
      public_capable: 1,
    }));
    await expectRejected(() => insertCorpus({
      corpus_release_id: "corpus-empty",
      corpus_hash: HASH("13"),
      object_key: "pattern-ontology-corpora/corpus-empty.json",
      fragment_count: 0,
    }));
  });

  it("pins one immutable command to the exact corpus identity", async () => {
    await insertCorpus();
    await insertRun();

    await expectRejected(() => insertRun({
      run_id: "oprun_schema_test_2",
      corpus_hash: HASH("99"),
      idempotency_key: "ontology-pipeline-schema-test-2",
      candidate_ontology_version: "1.0.1-machine-test",
    }));
    await expectRejected(() => insertRun({
      run_id: "oprun_schema_test_3",
      candidate_ontology_version: "1.0.2-machine-test",
    }));
    await expectRejected(() => insertRun({
      run_id: "oprun_schema_test_4",
      idempotency_key: "ontology-pipeline-schema-test-4",
    }));

    for (const [column, changed] of [
      ["idempotency_key", "changed-idempotency"],
      ["corpus_release_id", "changed-corpus"],
      ["corpus_hash", HASH("98")],
      ["candidate_ontology_version", "changed-version"],
      ["configuration_json", "{}"],
      ["configuration_hash", HASH("97")],
    ] as const) {
      await expectRejected(() => env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_runs SET ${column} = ? WHERE run_id = ?`,
      ).bind(changed, RUN.run_id).run());
    }
  });

  it("admits only the full forward stage sequence and coherent claims", async () => {
    await insertCorpus();
    await insertRun();

    const stages = [
      "corpus_reading",
      "generating",
      "compiling",
      "evaluating",
      "regressing",
      "signing",
      "ingesting",
    ];
    for (const [index, stage] of stages.entries()) {
      const evidence = {
        ...(stage === "compiling" ? { candidate_hash: HASH("30") } : {}),
        ...(stage === "evaluating" ? {
          candidate_hash: HASH("30"),
          compilation_report_hash: HASH("31"),
        } : {}),
        ...(stage === "regressing" ? {
          candidate_hash: HASH("30"),
          compilation_report_hash: HASH("31"),
          evaluation_report_hash: HASH("32"),
        } : {}),
        ...(stage === "signing" ? {
          candidate_hash: HASH("30"),
          compilation_report_hash: HASH("31"),
          evaluation_report_hash: HASH("32"),
          regression_report_hash: HASH("33"),
        } : {}),
        ...(stage === "ingesting" ? {
          candidate_hash: HASH("30"),
          compilation_report_hash: HASH("31"),
          evaluation_report_hash: HASH("32"),
          regression_report_hash: HASH("33"),
          bundle_hash: HASH("34"),
        } : {}),
      };
      const assignments = [
        "stage = ?",
        "stage_generation = ?",
        "stage_cursor = 0",
        "stage_attempt = 0",
        "dispatched_at = NULL",
        ...Object.keys(evidence).map((column) => `${column} = ?`),
      ];
      await env.DB.prepare(
        `UPDATE pattern_ontology_pipeline_runs SET ${assignments.join(", ")}
         WHERE run_id = ?`,
      ).bind(stage, index + 1, ...Object.values(evidence), RUN.run_id).run();
    }

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'generating', stage_generation = stage_generation + 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'unknown', stage_generation = stage_generation + 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());

    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET claim_token = 'claim-1', lease_expires_at = ?, dispatched_at = ?
       WHERE run_id = ?`,
    ).bind("2026-08-21T00:05:00.000Z", NOW, RUN.run_id).run();
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET lease_expires_at = NULL
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("requires stage evidence before downstream work", async () => {
    await insertCorpus();
    await expectRejected(() => insertRun({
      stage: "compiling",
      stage_generation: 3,
      dispatched_at: NOW,
    }));
    await expectRejected(() => insertRun({
      stage: "regressing",
      stage_generation: 5,
      candidate_hash: HASH("30"),
      compilation_report_hash: HASH("31"),
      dispatched_at: NOW,
    }));
    await expectRejected(() => insertRun({
      stage: "ingesting",
      stage_generation: 8,
      candidate_hash: HASH("30"),
      compilation_report_hash: HASH("31"),
      evaluation_report_hash: HASH("32"),
      regression_report_hash: HASH("33"),
      dispatched_at: NOW,
    }));
  });

  it("never rewrites acquired evidence or moves same-stage counters backward", async () => {
    await insertCorpus();
    await insertRun({
      stage: "compiling",
      stage_generation: 3,
      stage_cursor: 2,
      stage_attempt: 2,
      candidate_hash: HASH("30"),
      dispatched_at: NOW,
    });

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET candidate_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("39"), RUN.run_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_cursor = 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_attempt = 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("distinguishes same-generation retries from successor deliveries", async () => {
    await insertCorpus();
    await insertRun({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
      stage_attempt: 0,
      dispatched_at: NOW,
    });

    // A retry owns the same cursor and generation, but advances its attempt.
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage_attempt = 1, dispatched_at = NULL
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run();

    // A completed chunk schedules the next cursor under a successor generation.
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage_generation = 3, stage_cursor = 1, stage_attempt = 0,
           claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run();

    const row = await env.DB.prepare(
      `SELECT stage, stage_generation, stage_cursor, stage_attempt, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(RUN.run_id).first();
    expect(row).toEqual({
      stage: "generating",
      stage_generation: 3,
      stage_cursor: 1,
      stage_attempt: 0,
      dispatched_at: null,
    });
  });

  it("clears claim ownership when advancing to a new named stage", async () => {
    await insertCorpus();
    await insertRun({
      stage: "corpus_reading",
      stage_generation: 1,
      claim_token: "claim-corpus-reader",
      lease_expires_at: "2026-08-21T00:05:00.000Z",
      dispatched_at: NOW,
    });

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'generating', stage_generation = 2
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());

    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'generating', stage_generation = 2,
           stage_cursor = 0, stage_attempt = 0,
           claim_token = NULL, lease_expires_at = NULL, dispatched_at = NULL
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run();
  });

  it("closes terminal state and fixes failed retention at exactly seven days", async () => {
    await insertCorpus();
    const failedAt = "2026-08-21T02:00:00.000Z";
    await insertRun({
      stage: "failed",
      failure_class: "evaluation_rejected",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-28T02:00:00.000Z",
      finished_at: failedAt,
      failed_at: failedAt,
    });

    await expectRejected(() => insertRun({
      run_id: "oprun_bad_failure_expiry",
      idempotency_key: "bad-failure-expiry",
      candidate_ontology_version: "1.0.1-machine-test",
      stage: "failed",
      failure_class: "evaluation_rejected",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-29T02:00:00.000Z",
      finished_at: failedAt,
      failed_at: failedAt,
    }));
    await expectRejected(() => insertRun({
      run_id: "oprun_bad_failure_class",
      idempotency_key: "bad-failure-class",
      candidate_ontology_version: "1.0.2-machine-test",
      stage: "failed",
      failure_class: "provider said secret prose",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-28T02:00:00.000Z",
      finished_at: failedAt,
      failed_at: failedAt,
    }));
    await expectRejected(() => insertRun({
      run_id: "oprun_mismatched_failure_time",
      idempotency_key: "mismatched-failure-time",
      candidate_ontology_version: "1.0.25-machine-test",
      stage: "failed",
      failure_class: "evaluation_rejected",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-28T02:00:00.000Z",
      finished_at: "2026-08-21T02:00:01.000Z",
      failed_at: failedAt,
    }));
    await expectRejected(() => insertRun({
      run_id: "oprun_terminal_claim",
      idempotency_key: "terminal-claim",
      candidate_ontology_version: "1.0.3-machine-test",
      stage: "failed",
      claim_token: "claim-terminal",
      lease_expires_at: "2026-08-21T02:05:00.000Z",
      failure_class: "evaluation_rejected",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-28T02:00:00.000Z",
      finished_at: failedAt,
      failed_at: failedAt,
    }));

    await insertRun({
      run_id: "oprun_success",
      idempotency_key: "successful-run",
      candidate_ontology_version: "1.0.4-machine-test",
      stage: "succeeded",
      stage_generation: 9,
      dispatched_at: NOW,
      candidate_hash: HASH("30"),
      compilation_report_hash: HASH("31"),
      evaluation_report_hash: HASH("32"),
      regression_report_hash: HASH("33"),
      bundle_hash: HASH("34"),
      finished_at: failedAt,
      succeeded_at: failedAt,
    });
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET updated_at = ? WHERE run_id = ?`,
    ).bind("2026-08-21T03:00:00.000Z", "oprun_success").run());
  });

  it("uses attempt-scoped create-only artifact identities", async () => {
    await insertCorpus();
    await insertRun({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 1,
      stage_attempt: 1,
      dispatched_at: NOW,
    });
    const artifact = {
      id: "opart_schema_test_1",
      run_id: RUN.run_id,
      stage: "generating",
      stage_generation: 2,
      stage_attempt: 1,
      artifact_class: "generator_response",
      object_key: "pattern-ontology/runs/oprun_schema_test_1/2/1/response.json.enc",
      plaintext_sha256: HASH("40"),
      envelope_sha256: HASH("41"),
      ciphertext_sha256: HASH("42"),
      envelope_key_id: "ontology-artifact-key-1",
      envelope_nonce: "bWlncmF0aW9uLXRlc3Q",
      byte_length: 512,
      created_at: NOW,
      expires_at: "2026-08-28T00:00:00.000Z",
      deleted_at: null,
    };
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);

    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        id: "opart_schema_test_2",
        object_key: "pattern-ontology/runs/oprun_schema_test_1/reused.json.enc",
      },
    ));
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET stage_attempt = 2
       WHERE id = ?`,
    ).bind(artifact.id).run());
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET deleted_at = ? WHERE id = ?`,
    ).bind("2026-08-28T00:00:01.000Z", artifact.id).run();
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET deleted_at = NULL WHERE id = ?`,
    ).bind(artifact.id).run());
  });

  it("accepts artifacts only from the run's current stage owner", async () => {
    await insertCorpus();
    await insertRun({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 1,
      stage_attempt: 1,
      dispatched_at: NOW,
    });
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        id: "opart_stale_owner",
        run_id: RUN.run_id,
        stage: "generating",
        stage_generation: 2,
        stage_attempt: 0,
        artifact_class: "generator_response",
        object_key: "pattern-ontology/runs/oprun_schema_test_1/stale-owner.json.enc",
        plaintext_sha256: HASH("43"),
        envelope_sha256: HASH("44"),
        ciphertext_sha256: HASH("45"),
        envelope_key_id: "ontology-artifact-key-1",
        envelope_nonce: "c3RhbGUtb3duZXItbm9uY2U",
        byte_length: 512,
        created_at: NOW,
        expires_at: "2026-08-28T00:00:00.000Z",
        deleted_at: null,
      },
    ));
  });

  it("rejects artifact classes owned by another stage", async () => {
    await insertCorpus();
    await insertRun({
      stage: "generating",
      stage_generation: 2,
      dispatched_at: NOW,
    });
    const artifact = {
      id: "opart_bad_stage",
      run_id: RUN.run_id,
      stage: "generating",
      stage_generation: 2,
      stage_attempt: 0,
      artifact_class: "evaluation_report",
      object_key: "pattern-ontology/runs/oprun_schema_test_1/bad-stage.json.enc",
      plaintext_sha256: HASH("50"),
      envelope_sha256: HASH("51"),
      ciphertext_sha256: HASH("52"),
      envelope_key_id: "ontology-artifact-key-1",
      envelope_nonce: "bWlncmF0aW9uLXRlc3Q",
      byte_length: 1,
      created_at: NOW,
      expires_at: "2026-08-28T00:00:00.000Z",
      deleted_at: null,
    };
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifact,
    ));
  });

  it("rejects artifact expiry before creation", async () => {
    await insertCorpus();
    await insertRun({
      stage: "generating",
      stage_generation: 2,
      dispatched_at: NOW,
    });
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        id: "opart_bad_expiry",
        run_id: RUN.run_id,
        stage: "generating",
        stage_generation: 2,
        stage_attempt: 0,
        artifact_class: "generator_response",
        object_key: "pattern-ontology/runs/oprun_schema_test_1/bad-expiry.json.enc",
        plaintext_sha256: HASH("53"),
        envelope_sha256: HASH("54"),
        ciphertext_sha256: HASH("55"),
        envelope_key_id: "ontology-artifact-key-1",
        envelope_nonce: "ZXhwaXJ5LXRlc3Qtbm9uY2U",
        byte_length: 1,
        created_at: NOW,
        expires_at: "2026-08-20T00:00:00.000Z",
        deleted_at: null,
      },
    ));
  });

  it("serves all maintenance lanes from their required partial indexes", async () => {
    const probes = [
      {
        query: `EXPLAIN QUERY PLAN
          SELECT run_id FROM pattern_ontology_pipeline_runs
          WHERE stage NOT IN ('succeeded', 'failed')
            AND dispatched_at IS NULL AND claim_token IS NULL
            AND available_at <= ?
          ORDER BY available_at, run_id LIMIT 100`,
        expected: "idx_pattern_ontology_runs_undispatched",
      },
      {
        query: `EXPLAIN QUERY PLAN
          SELECT run_id FROM pattern_ontology_pipeline_runs
          WHERE stage NOT IN ('succeeded', 'failed')
            AND claim_token IS NOT NULL AND lease_expires_at <= ?
          ORDER BY lease_expires_at, run_id LIMIT 100`,
        expected: "idx_pattern_ontology_runs_expired_lease",
      },
      {
        query: `EXPLAIN QUERY PLAN
          SELECT id FROM pattern_ontology_pipeline_artifacts
          WHERE deleted_at IS NULL AND expires_at <= ?
          ORDER BY expires_at, id LIMIT 100`,
        expected: "idx_pattern_ontology_artifacts_expiry",
      },
    ];
    for (const probe of probes) {
      const plan = await env.DB.prepare(probe.query).bind(NOW).all<{
        detail: string;
      }>();
      expect(plan.results.map((step) => step.detail).join("\n"))
        .toContain(probe.expected);
    }
  });

  it("finishes with clean integrity and assertion probes", async () => {
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results)
      .toEqual([]);
    expect(await env.DB.prepare("PRAGMA quick_check").first())
      .toEqual({ quick_check: "ok" });
    expect((await env.DB.prepare("SELECT * FROM assertion_probe").all()).results)
      .toEqual([]);
  });
});
