import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { deferOntologyPipelineForProvider } from "./ontology-pipeline.js";

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

let testSequence = 0;
let CORPUS: CorpusRow;
let RUN: RunRow;

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

const FORWARD_STAGES = [
  "corpus_reading",
  "generating",
  "compiling",
  "evaluating",
  "regressing",
  "signing",
  "ingesting",
] as const;

type ForwardStage = (typeof FORWARD_STAGES)[number];

async function advanceRunTo(
  target: ForwardStage,
  runId = RUN.run_id,
): Promise<void> {
  const targetIndex = FORWARD_STAGES.indexOf(target);
  const current = await env.DB.prepare(
    "SELECT stage FROM pattern_ontology_pipeline_runs WHERE run_id = ?",
  ).bind(runId).first<{ stage: string }>();
  if (!current) throw new Error("ontology pipeline test run missing");
  const currentIndex = current.stage === "reserved"
    ? -1
    : FORWARD_STAGES.indexOf(current.stage as ForwardStage);
  if (
    (current.stage !== "reserved" && currentIndex === -1)
    || currentIndex >= targetIndex
  ) {
    throw new Error(`cannot advance ${current.stage} to ${target}`);
  }
  for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
    const stage = FORWARD_STAGES[index];
    const evidence = {
      ...(stage === "compiling" ? { candidate_hash: HASH("30") } : {}),
      ...(stage === "evaluating" ? {
        compilation_report_hash: HASH("31"),
      } : {}),
      ...(stage === "regressing" ? {
        evaluation_report_hash: HASH("32"),
      } : {}),
      ...(stage === "signing" ? {
        regression_report_hash: HASH("33"),
      } : {}),
      ...(stage === "ingesting" ? { bundle_hash: HASH("34") } : {}),
    };
    const assignments = [
      "stage = ?",
      "stage_generation = ?",
      "stage_cursor = 0",
      "stage_attempt = 0",
      "claim_token = NULL",
      "lease_expires_at = NULL",
      "dispatched_at = NULL",
      ...Object.keys(evidence).map((column) => `${column} = ?`),
    ];
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET ${assignments.join(", ")}
       WHERE run_id = ?`,
    ).bind(stage, index + 1, ...Object.values(evidence), runId).run();
  }
}

async function claimCurrentRun(
  token = "claim-owner",
  leaseExpiresAt = "2026-08-21T00:05:00.000Z",
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pattern_ontology_pipeline_runs
     SET claim_token = ?, lease_expires_at = ?,
         dispatched_at = COALESCE(dispatched_at, ?)
     WHERE run_id = ?`,
  ).bind(token, leaseExpiresAt, NOW, RUN.run_id).run();
}

function artifactForCurrentRun(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `opart_retention_${testSequence}`,
    run_id: RUN.run_id,
    stage: "generating",
    stage_generation: 2,
    stage_attempt: 0,
    artifact_class: "generator_response",
    object_key: `pattern-ontology/runs/${RUN.run_id}/retention.enc`,
    plaintext_sha256: HASH("70"),
    envelope_sha256: HASH("71"),
    ciphertext_sha256: HASH("72"),
    envelope_key_id: "ontology-artifact-key-retention",
    envelope_nonce: `retention-nonce-${testSequence}`,
    byte_length: 512,
    created_at: NOW,
    expires_at: null,
    deleted_at: null,
    ...overrides,
  };
}

async function expectRejected(work: () => Promise<unknown>): Promise<void> {
  await expect(work()).rejects.toThrow();
}

beforeEach(() => {
  testSequence += 1;
  const suffix = testSequence.toString(16).padStart(2, "0");
  CORPUS = {
    corpus_release_id: `corpus-schema-test-${suffix}`,
    corpus_hash: HASH(suffix),
    locale: "en-US",
    object_key: `pattern-ontology-corpora/corpus-schema-test-${suffix}.json`,
    fragment_count: 40,
    license_class: "internal_synthetic",
    public_capable: 0,
    created_at: NOW,
    registered_at: NOW,
  };
  RUN = {
    run_id: `oprun_schema_test_${suffix}`,
    idempotency_key: `ontology-pipeline-schema-test-${suffix}`,
    corpus_release_id: CORPUS.corpus_release_id,
    corpus_hash: CORPUS.corpus_hash,
    candidate_ontology_version: `1.0.0-machine-test-${suffix}`,
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

  it("physically preserves corpus identities so they cannot be reused", async () => {
    await insertCorpus();

    await expectRejected(() => env.DB.prepare(
      "DELETE FROM pattern_source_corpus_releases WHERE corpus_release_id = ?",
    ).bind(CORPUS.corpus_release_id).run());
    await expectRejected(() => execute(
      "INSERT OR REPLACE INTO pattern_source_corpus_releases",
      {
        ...CORPUS,
        corpus_hash: HASH("aa"),
        object_key: `${CORPUS.object_key}.replace`,
      },
    ));
    await expectRejected(() => insertCorpus({
      corpus_hash: HASH("aa"),
      object_key: `${CORPUS.object_key}.replacement`,
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

  it("physically preserves run identities so commands cannot be reused", async () => {
    await insertCorpus();
    await insertRun();

    await expectRejected(() => env.DB.prepare(
      "DELETE FROM pattern_ontology_pipeline_runs WHERE run_id = ?",
    ).bind(RUN.run_id).run());
    await expectRejected(() => execute(
      "INSERT OR REPLACE INTO pattern_ontology_pipeline_runs",
      {
        ...RUN,
        idempotency_key: `${RUN.idempotency_key}-replace`,
        candidate_ontology_version: `${RUN.candidate_ontology_version}-replace`,
        configuration_json: JSON.stringify({ replacement: true }),
        configuration_hash: HASH("ab"),
      },
    ));
    await expectRejected(() => insertRun({
      idempotency_key: `${RUN.idempotency_key}-replacement`,
      candidate_ontology_version: `${RUN.candidate_ontology_version}-replacement`,
      configuration_json: JSON.stringify({ replacement: true }),
      configuration_hash: HASH("ab"),
    }));
  });

  it("requires every new run to start in coherent reserved state", async () => {
    await insertCorpus();

    await expectRejected(() => insertRun({
      stage: "generating",
      stage_generation: 2,
      dispatched_at: NOW,
    }));
    await expectRejected(() => insertRun({
      stage: "failed",
      stage_generation: 1,
      failure_class: "execution_error",
      dispatched_at: NOW,
      failed_artifact_expires_at: "2026-08-28T02:00:00.000Z",
      finished_at: "2026-08-21T02:00:00.000Z",
      failed_at: "2026-08-21T02:00:00.000Z",
    }));
    await expectRejected(() => insertRun({
      stage: "succeeded",
      stage_generation: 9,
      dispatched_at: NOW,
      candidate_hash: HASH("30"),
      compilation_report_hash: HASH("31"),
      evaluation_report_hash: HASH("32"),
      regression_report_hash: HASH("33"),
      bundle_hash: HASH("34"),
      finished_at: "2026-08-21T02:00:00.000Z",
      succeeded_at: "2026-08-21T02:00:00.000Z",
    }));
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

    await claimCurrentRun("claim-1");
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET lease_expires_at = NULL
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("rejects replacing a live stage claim", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await claimCurrentRun();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET claim_token = 'claim-thief', lease_expires_at = ?
       WHERE run_id = ?`,
    ).bind("2026-08-21T00:10:00.000Z", RUN.run_id).run());
  });

  it("rejects extending a live stage lease", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await claimCurrentRun();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET lease_expires_at = ?
       WHERE run_id = ?`,
    ).bind("2026-08-21T00:10:00.000Z", RUN.run_id).run());
  });

  it("rejects advancing an attempt while its claim remains live", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await claimCurrentRun();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_attempt = stage_attempt + 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("requires stage evidence before downstream work", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'compiling', stage_generation = 3
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'compiling', stage_generation = 3, candidate_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("30"), RUN.run_id).run();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'evaluating', stage_generation = 4
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'evaluating', stage_generation = 4,
           compilation_report_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("31"), RUN.run_id).run();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'regressing', stage_generation = 5
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'regressing', stage_generation = 5,
           evaluation_report_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("32"), RUN.run_id).run();
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'signing', stage_generation = 6,
           regression_report_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("33"), RUN.run_id).run();

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'ingesting', stage_generation = 7
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("never rewrites acquired evidence or moves same-stage counters backward", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage_generation = 3, stage_cursor = 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run();

    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET candidate_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("30"), RUN.run_id).run();
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET candidate_hash = ?
       WHERE run_id = ?`,
    ).bind(HASH("39"), RUN.run_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_cursor = 0
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_attempt = -1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
  });

  it("distinguishes same-generation retries from successor deliveries", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET stage_attempt = 1
       WHERE run_id = ?`,
    ).bind(RUN.run_id).run());
    await claimCurrentRun("claim-retry");

    // An owned retry releases the delivery and advances its durable attempt.
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage_attempt = 1, claim_token = NULL, lease_expires_at = NULL,
           dispatched_at = NULL
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

  it("releases a provider wait without changing its exact coordinate", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await claimCurrentRun(
      "claim-provider-wait",
      "2030-08-21T00:05:00.000Z",
    );

    expect(await deferOntologyPipelineForProvider(
      env,
      {
        status: "claimed",
        runId: RUN.run_id,
        stage: "generating",
        stageGeneration: 2,
        stageCursor: 0,
        stageAttempt: 0,
        claimToken: "claim-provider-wait",
        leaseExpiresAt: "2030-08-21T00:05:00.000Z",
      },
      new Date(NOW),
    )).toBe(true);

    expect(await env.DB.prepare(
      `SELECT stage, stage_generation, stage_cursor, stage_attempt,
              claim_token, lease_expires_at, dispatched_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(RUN.run_id).first()).toEqual({
      stage: "generating",
      stage_generation: 2,
      stage_cursor: 0,
      stage_attempt: 0,
      claim_token: null,
      lease_expires_at: null,
      dispatched_at: NOW,
    });
  });

  it("clears claim ownership when advancing to a new named stage", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("corpus_reading");
    await claimCurrentRun("claim-corpus-reader");

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
    await insertRun();
    const failedAt = "2026-08-21T02:00:00.000Z";
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 1,
           failure_class = 'evaluation_rejected', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      NOW,
      "2026-08-29T02:00:00.000Z",
      failedAt,
      failedAt,
      RUN.run_id,
    ).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 1,
           failure_class = 'provider said secret prose', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      NOW,
      "2026-08-28T02:00:00.000Z",
      failedAt,
      failedAt,
      RUN.run_id,
    ).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 1,
           failure_class = 'evaluation_rejected', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      NOW,
      "2026-08-28T02:00:00.000Z",
      "2026-08-21T02:00:01.000Z",
      failedAt,
      RUN.run_id,
    ).run());
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 1,
           claim_token = 'claim-terminal', lease_expires_at = ?,
           failure_class = 'evaluation_rejected', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      "2026-08-21T02:05:00.000Z",
      NOW,
      "2026-08-28T02:00:00.000Z",
      failedAt,
      failedAt,
      RUN.run_id,
    ).run());

    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 1,
           failure_class = 'evaluation_rejected', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      NOW,
      "2026-08-28T02:00:00.000Z",
      failedAt,
      failedAt,
      RUN.run_id,
    ).run();

    await insertRun({
      run_id: "oprun_success",
      idempotency_key: "successful-run",
      candidate_ontology_version: "1.0.4-machine-test",
    });
    await advanceRunTo("ingesting", "oprun_success");
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'succeeded', stage_generation = 8, dispatched_at = ?,
           finished_at = ?, succeeded_at = ?
       WHERE run_id = ?`,
    ).bind(NOW, failedAt, failedAt, "oprun_success").run();
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs SET updated_at = ? WHERE run_id = ?`,
    ).bind("2026-08-21T03:00:00.000Z", "oprun_success").run());
  });

  it("uses attempt-scoped create-only artifact identities", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    const artifact = {
      id: "opart_schema_test_1",
      run_id: RUN.run_id,
      stage: "generating",
      stage_generation: 2,
      stage_attempt: 0,
      artifact_class: "generator_response",
      object_key: "pattern-ontology/runs/oprun_schema_test_1/2/1/response.json.enc",
      plaintext_sha256: HASH("40"),
      envelope_sha256: HASH("41"),
      ciphertext_sha256: HASH("42"),
      envelope_key_id: "ontology-artifact-key-1",
      envelope_nonce: "bWlncmF0aW9uLXRlc3Q",
      byte_length: 512,
      created_at: NOW,
      expires_at: null,
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
    ).bind(NOW, artifact.id).run();
    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET deleted_at = NULL WHERE id = ?`,
    ).bind(artifact.id).run());
  });

  it("physically preserves artifact tombstones and every create-only identity", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    const artifact = {
      id: `opart_delete_guard_${testSequence}`,
      run_id: RUN.run_id,
      stage: "generating",
      stage_generation: 2,
      stage_attempt: 0,
      artifact_class: "generator_response",
      object_key: `pattern-ontology/runs/${RUN.run_id}/delete-guard.enc`,
      plaintext_sha256: HASH("60"),
      envelope_sha256: HASH("61"),
      ciphertext_sha256: HASH("62"),
      envelope_key_id: "ontology-artifact-key-delete-guard",
      envelope_nonce: `delete-guard-nonce-${testSequence}`,
      byte_length: 512,
      created_at: NOW,
      expires_at: null,
      deleted_at: null,
    };
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET deleted_at = ?
       WHERE id = ?`,
    ).bind(NOW, artifact.id).run();

    await expectRejected(() => env.DB.prepare(
      "DELETE FROM pattern_ontology_pipeline_artifacts WHERE id = ?",
    ).bind(artifact.id).run());
    await expectRejected(() => execute(
      "INSERT OR REPLACE INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        artifact_class: "candidate_chunk",
        object_key: `${artifact.object_key}.replace`,
        envelope_nonce: `${artifact.envelope_nonce}-replace`,
        deleted_at: null,
      },
    ));
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        artifact_class: "candidate_chunk",
        object_key: `${artifact.object_key}.id-reuse`,
        envelope_nonce: `${artifact.envelope_nonce}-id`,
        deleted_at: null,
      },
    ));
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        id: `${artifact.id}_coordinate`,
        object_key: `${artifact.object_key}.coordinate-reuse`,
        envelope_nonce: `${artifact.envelope_nonce}-coordinate`,
        deleted_at: null,
      },
    ));
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        id: `${artifact.id}_object_key`,
        artifact_class: "candidate_chunk",
        envelope_nonce: `${artifact.envelope_nonce}-object`,
        deleted_at: null,
      },
    ));
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        ...artifact,
        id: `${artifact.id}_nonce`,
        artifact_class: "generator_request",
        object_key: `${artifact.object_key}.nonce-reuse`,
        deleted_at: null,
      },
    ));
  });

  it("accepts artifacts only from the run's current stage owner", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      {
        id: "opart_stale_owner",
        run_id: RUN.run_id,
        stage: "generating",
        stage_generation: 2,
        stage_attempt: 1,
        artifact_class: "generator_response",
        object_key: "pattern-ontology/runs/oprun_schema_test_1/stale-owner.json.enc",
        plaintext_sha256: HASH("43"),
        envelope_sha256: HASH("44"),
        ciphertext_sha256: HASH("45"),
        envelope_key_id: "ontology-artifact-key-1",
        envelope_nonce: "c3RhbGUtb3duZXItbm9uY2U",
        byte_length: 512,
        created_at: NOW,
        expires_at: null,
        deleted_at: null,
      },
    ));
  });

  it("rejects artifact classes owned by another stage", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
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
      expires_at: null,
      deleted_at: null,
    };
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifact,
    ));
  });

  it("rejects caller-assigned artifact expiry before terminal failure", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifactForCurrentRun({
        expires_at: "2026-08-28T00:00:00.000Z",
      }),
    ));
  });

  it("rejects future artifact creation times before they can block failure", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifactForCurrentRun({
        created_at: "2999-01-01T00:00:00.000Z",
      }),
    ));

    const failedAt = "2026-08-21T02:00:00.000Z";
    const expiresAt = "2026-08-28T02:00:00.000Z";
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 3,
           failure_class = 'execution_error', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(NOW, expiresAt, failedAt, failedAt, RUN.run_id).run();

    expect(await env.DB.prepare(
      `SELECT stage, failed_at, failed_artifact_expires_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(RUN.run_id).first()).toEqual({
      stage: "failed",
      failed_at: failedAt,
      failed_artifact_expires_at: expiresAt,
    });
  });

  it("rejects artifacts created before their owning run", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");

    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifactForCurrentRun({
        created_at: "2026-08-20T23:59:59.000Z",
      }),
    ));
  });

  it("rejects artifacts that enter already tombstoned", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");

    await expectRejected(() => execute(
      "INSERT INTO pattern_ontology_pipeline_artifacts",
      artifactForCurrentRun({
        deleted_at: NOW,
      }),
    ));
  });

  it("rejects future artifact tombstone timestamps", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    const artifact = artifactForCurrentRun();
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);

    await expectRejected(() => env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_artifacts SET deleted_at = ?
       WHERE id = ?`,
    ).bind("2999-01-01T00:00:00.000Z", artifact.id).run());
  });

  it("rejects terminal timestamps that precede an owned artifact", async () => {
    const runCreatedAt = "2026-08-01T00:00:00.000Z";
    await insertCorpus({
      created_at: runCreatedAt,
      registered_at: runCreatedAt,
    });
    await insertRun({
      available_at: runCreatedAt,
      created_at: runCreatedAt,
      updated_at: runCreatedAt,
    });
    await advanceRunTo("generating");
    const artifact = artifactForCurrentRun();
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);

    const backdatedFailure = env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 3,
           failure_class = 'execution_error', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(
      runCreatedAt,
      "2026-08-17T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      RUN.run_id,
    ).run();
    await expect(backdatedFailure).rejects.toThrow(
      "ontology pipeline terminal timestamp precedes owned artifact",
    );

    const failedAt = "2026-08-21T02:00:00.000Z";
    const expiresAt = "2026-08-28T02:00:00.000Z";
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 3,
           failure_class = 'execution_error', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(NOW, expiresAt, failedAt, failedAt, RUN.run_id).run();

    expect(await env.DB.prepare(
      `SELECT stage, failed_at, failed_artifact_expires_at
       FROM pattern_ontology_pipeline_runs WHERE run_id = ?`,
    ).bind(RUN.run_id).first()).toEqual({
      stage: "failed",
      failed_at: failedAt,
      failed_artifact_expires_at: expiresAt,
    });
  });

  it("assigns the exact failed-run deadline to every live artifact", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    const artifact = artifactForCurrentRun();
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);

    const failedAt = "2026-08-21T02:00:00.000Z";
    const expiresAt = "2026-08-28T02:00:00.000Z";
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'failed', stage_generation = 3,
           failure_class = 'execution_error', dispatched_at = ?,
           failed_artifact_expires_at = ?, finished_at = ?, failed_at = ?
       WHERE run_id = ?`,
    ).bind(NOW, expiresAt, failedAt, failedAt, RUN.run_id).run();

    expect(await env.DB.prepare(
      `SELECT expires_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(artifact.id).first()).toEqual({ expires_at: expiresAt });
  });

  it("keeps successful evidence artifacts without a cleanup deadline", async () => {
    await insertCorpus();
    await insertRun();
    await advanceRunTo("generating");
    const artifact = artifactForCurrentRun();
    await execute("INSERT INTO pattern_ontology_pipeline_artifacts", artifact);
    await advanceRunTo("ingesting");

    const succeededAt = "2026-08-21T02:00:00.000Z";
    await env.DB.prepare(
      `UPDATE pattern_ontology_pipeline_runs
       SET stage = 'succeeded', stage_generation = 8, dispatched_at = ?,
           finished_at = ?, succeeded_at = ?
       WHERE run_id = ?`,
    ).bind(NOW, succeededAt, succeededAt, RUN.run_id).run();

    expect(await env.DB.prepare(
      `SELECT expires_at FROM pattern_ontology_pipeline_artifacts WHERE id = ?`,
    ).bind(artifact.id).first()).toEqual({ expires_at: null });
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
          WHERE expires_at IS NOT NULL AND deleted_at IS NULL
            AND expires_at <= ?
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
