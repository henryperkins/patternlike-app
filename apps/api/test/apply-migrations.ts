import { applyD1Migrations, env } from "cloudflare:test";

const migrationNames = env.TEST_MIGRATIONS.map((migration) => migration.name);
const expectedTail = [
  "0009_pattern_correction_artifact.sql",
  "0010_pattern_stage_class_usage.sql",
  "0011_ontology_pipeline_evidence.sql",
  "0012_ontology_pipeline.sql",
  "0013_codex_provider_jobs.sql",
  "0014_codex_provider_response_uploads.sql",
  "0015_ontology_pipeline_regression_evidence.sql",
];
if (
  JSON.stringify(migrationNames.slice(-expectedTail.length)) !==
  JSON.stringify(expectedTail)
) {
  throw new Error(
    `ontology migration tail is missing or out of order: ${JSON.stringify(migrationNames.slice(-expectedTail.length))}`,
  );
}

const correctionMigrationIndex = migrationNames.indexOf(expectedTail[0]);
const usageMigrationIndex = migrationNames.indexOf(expectedTail[1]);
const evidenceMigrationIndex = migrationNames.indexOf(expectedTail[2]);
const pipelineMigrationIndex = migrationNames.indexOf(expectedTail[3]);
const codexProviderMigrationIndex = migrationNames.indexOf(expectedTail[4]);
const codexResponseUploadMigrationIndex = migrationNames.indexOf(expectedTail[5]);
const regressionEvidenceMigrationIndex = migrationNames.indexOf(expectedTail[6]);

// Main-test storage starts empty and receives the exact ordered migration set.
// This is the fresh-database lane; individual tests then exercise the schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The isolated upgrade binding stops before 0009, carries live rows through the
// adapter rebuild/additive migrations and 0011, and only then applies 0012.
// This proves forward compatibility separately from the clean-apply lane.
const upgradeDb = env.MIGRATION_UPGRADE_DB;
await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(0, correctionMigrationIndex),
);

const migrationUserId = "usr_99999999999999999999999999999999";
const artifactBefore = {
  id: "part_99999999999999999999999999999999",
  generation_id: "pgen_99999999999999999999999999999999",
  user_id: migrationUserId,
  artifact_class: "writer_response",
  object_key: "migration-tests/pattern-artifact.json.enc",
  ciphertext_sha256: `sha256:${"ab".repeat(32)}`,
  plaintext_sha256: `sha256:${"cd".repeat(32)}`,
  byte_length: 321,
  created_at: "2026-08-20T00:00:00.000Z",
  expires_at: "2026-09-19T00:00:00.000Z",
  deleted_at: null,
};
await upgradeDb.prepare(
  `INSERT INTO users (
     id, crypto_subject, status, locale, timezone, entitlement_tier, created_at, updated_at
   ) VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)`,
)
  .bind(
    migrationUserId,
    "cs_99999999999999999999999999999999",
    artifactBefore.created_at,
    artifactBefore.created_at,
  )
  .run();
await upgradeDb.prepare(
  `INSERT INTO pattern_generation_artifacts (
     id, generation_id, user_id, artifact_class, object_key,
     ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
  .bind(...Object.values(artifactBefore))
  .run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(correctionMigrationIndex, usageMigrationIndex),
);

const artifactAfter = await upgradeDb.prepare(
  `SELECT id, generation_id, user_id, artifact_class, object_key,
          ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
   FROM pattern_generation_artifacts WHERE id = ?`,
)
  .bind(artifactBefore.id)
  .first<typeof artifactBefore>();
if (JSON.stringify(artifactAfter) !== JSON.stringify(artifactBefore)) {
  throw new Error("0009 did not preserve the populated artifact row byte-for-byte");
}

await upgradeDb.prepare(
  `INSERT INTO pattern_generation_artifacts (
     id, generation_id, user_id, artifact_class, object_key,
     ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
   ) VALUES (?, ?, ?, 'correction_document', ?, ?, ?, 0, ?, ?, NULL)`,
)
  .bind(
    "part_88888888888888888888888888888888",
    artifactBefore.generation_id,
    migrationUserId,
    "migration-tests/correction-document.json.enc",
    `sha256:${"ef".repeat(32)}`,
    `sha256:${"01".repeat(32)}`,
    artifactBefore.created_at,
    artifactBefore.expires_at,
  )
  .run();

let unknownClassRejected = false;
try {
  await upgradeDb.prepare(
    `INSERT INTO pattern_generation_artifacts (
       id, generation_id, user_id, artifact_class, object_key,
       ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
     ) VALUES (?, ?, ?, 'correction_patch', ?, ?, ?, 0, ?, ?, NULL)`,
  )
    .bind(
      "part_77777777777777777777777777777777",
      artifactBefore.generation_id,
      migrationUserId,
      "migration-tests/correction-patch.json.enc",
      `sha256:${"23".repeat(32)}`,
      `sha256:${"45".repeat(32)}`,
      artifactBefore.created_at,
      artifactBefore.expires_at,
    )
    .run();
} catch {
  unknownClassRejected = true;
}
if (!unknownClassRejected) {
  throw new Error("0009 admitted an unknown correction artifact class");
}

const foreignKeyCheck = await upgradeDb.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyCheck.results.length !== 0) {
  throw new Error("0009 left foreign-key violations after the CHECK rebuild");
}

// Both provider ledgers already exist in 0007. Seed their old two-counterless
// row shapes so 0010 proves DEFAULT 0 is an upgrade property.
await upgradeDb.prepare(
  `INSERT INTO pattern_provider_daily_usage (utc_date, used_calls, created_at, updated_at)
   VALUES ('2026-08-18', 7, ?, ?)`,
)
  .bind(artifactBefore.created_at, artifactBefore.created_at)
  .run();
await upgradeDb.prepare(
  `INSERT INTO pattern_ontology_provider_daily_usage (
     utc_date, used_calls, created_at, updated_at
   ) VALUES ('2026-08-18', 9, ?, ?)`,
)
  .bind(artifactBefore.created_at, artifactBefore.created_at)
  .run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(usageMigrationIndex, evidenceMigrationIndex),
);

const patternUsage = await upgradeDb.prepare(
  `SELECT used_calls, planner_calls, writer_calls, verifier_calls
   FROM pattern_provider_daily_usage WHERE utc_date = '2026-08-18'`,
).first();
if (
  JSON.stringify(patternUsage) !==
  JSON.stringify({
    used_calls: 7,
    planner_calls: 0,
    writer_calls: 0,
    verifier_calls: 0,
  })
) {
  throw new Error("0010 did not preserve Pattern total and zero stage-class counters");
}

const ontologyUsage = await upgradeDb.prepare(
  `SELECT used_calls, generator_calls, evaluator_calls, regression_calls
   FROM pattern_ontology_provider_daily_usage WHERE utc_date = '2026-08-18'`,
).first();
if (
  JSON.stringify(ontologyUsage) !==
  JSON.stringify({
    used_calls: 9,
    generator_calls: 0,
    evaluator_calls: 0,
    regression_calls: 0,
  })
) {
  throw new Error("0010 did not preserve ontology total and zero stage-class counters");
}

for (const [table, column] of [
  ["pattern_provider_daily_usage", "planner_calls"],
  ["pattern_provider_daily_usage", "writer_calls"],
  ["pattern_provider_daily_usage", "verifier_calls"],
  ["pattern_ontology_provider_daily_usage", "generator_calls"],
  ["pattern_ontology_provider_daily_usage", "evaluator_calls"],
  ["pattern_ontology_provider_daily_usage", "regression_calls"],
] as const) {
  let negativeRejected = false;
  try {
    await upgradeDb.prepare(
      `UPDATE ${table} SET ${column} = -1 WHERE utc_date = '2026-08-18'`,
    ).run();
  } catch {
    negativeRejected = true;
  }
  if (!negativeRejected) {
    throw new Error(`0010 admitted a negative ${table}.${column}`);
  }
}

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(evidenceMigrationIndex, pipelineMigrationIndex),
);

const evidenceBefore = {
  run_id: "oprun_populated_post_0011",
  ontology_version: "ontology-populated-post-0011",
  corpus_release_id: "corpus-populated-post-0011",
  corpus_release_hash: `sha256:${"10".repeat(32)}`,
  corpus_license_class: "internal_synthetic",
  corpus_public_capable: 0,
  activation_scope: "internal",
  bundle_hash: `sha256:${"11".repeat(32)}`,
  evaluation_report_hash: `sha256:${"12".repeat(32)}`,
  evaluation_artifact_object_key: "migration-tests/evaluation-report.json.enc",
  evaluation_artifact_envelope_hash: `sha256:${"13".repeat(32)}`,
  evaluation_artifact_ciphertext_hash: `sha256:${"14".repeat(32)}`,
  evaluation_artifact_status: "committed",
  signing_key_id: "migration-test-signing-key",
  run_status: "succeeded",
  evidence_status: "committed",
  compiler_passed: 1,
  evaluator_passed: 1,
  unevaluated_fixture_count: 0,
  created_at: "2026-08-20T01:00:00.000Z",
  committed_at: "2026-08-20T01:05:00.000Z",
};
await upgradeDb.prepare(
  `INSERT INTO pattern_ontology_pipeline_evidence (
     run_id, ontology_version, corpus_release_id, corpus_release_hash,
     corpus_license_class, corpus_public_capable, activation_scope, bundle_hash,
     evaluation_report_hash, evaluation_artifact_object_key,
     evaluation_artifact_envelope_hash, evaluation_artifact_ciphertext_hash,
     evaluation_artifact_status, signing_key_id, run_status, evidence_status,
     compiler_passed, evaluator_passed, unevaluated_fixture_count,
     created_at, committed_at
   ) VALUES (${Object.keys(evidenceBefore).map(() => "?").join(", ")})`,
)
  .bind(...Object.values(evidenceBefore))
  .run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(pipelineMigrationIndex, codexProviderMigrationIndex),
);

const evidenceAfter = await upgradeDb.prepare(
  `SELECT ${Object.keys(evidenceBefore).join(", ")}
   FROM pattern_ontology_pipeline_evidence WHERE run_id = ?`,
)
  .bind(evidenceBefore.run_id)
  .first();
if (JSON.stringify(evidenceAfter) !== JSON.stringify(evidenceBefore)) {
  throw new Error("0012 did not preserve the populated 0011 evidence row byte-for-byte");
}

for (const table of [
  "pattern_source_corpus_releases",
  "pattern_ontology_pipeline_runs",
  "pattern_ontology_pipeline_artifacts",
]) {
  const found = await upgradeDb.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).bind(table).first();
  if (!found) throw new Error(`0012 did not create ${table} on populated upgrade`);
}

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    codexProviderMigrationIndex,
    codexResponseUploadMigrationIndex,
  ),
);

const codexProviderTable = await upgradeDb.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_provider_jobs'",
).first();
if (!codexProviderTable) {
  throw new Error("0013 did not create codex_provider_jobs on populated upgrade");
}

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    codexResponseUploadMigrationIndex,
    regressionEvidenceMigrationIndex,
  ),
);

const codexResponseUploadTable = await upgradeDb.prepare(
  `SELECT name FROM sqlite_master
   WHERE type = 'table' AND name = 'codex_provider_response_uploads'`,
).first();
if (!codexResponseUploadTable) {
  throw new Error(
    "0014 did not create codex_provider_response_uploads on populated upgrade",
  );
}

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(regressionEvidenceMigrationIndex),
);

const upgradedEvidence = await upgradeDb.prepare(
  `SELECT ${Object.keys(evidenceBefore).join(", ")},
          regression_report_hash, regression_artifact_object_key,
          regression_artifact_envelope_hash,
          regression_artifact_ciphertext_hash,
          regression_artifact_stage_generation,
          regression_artifact_stage_attempt
   FROM pattern_ontology_pipeline_evidence WHERE run_id = ?`,
).bind(evidenceBefore.run_id).first();
if (
  JSON.stringify(upgradedEvidence) !== JSON.stringify({
    ...evidenceBefore,
    regression_report_hash: null,
    regression_artifact_object_key: null,
    regression_artifact_envelope_hash: null,
    regression_artifact_ciphertext_hash: null,
    regression_artifact_stage_generation: null,
    regression_artifact_stage_attempt: null,
  })
) {
  throw new Error("0015 did not preserve populated 0011 evidence with null regression pins");
}

let committedEvidenceDeleteRejected = false;
try {
  await upgradeDb.prepare(
    `DELETE FROM pattern_ontology_pipeline_evidence WHERE run_id = ?`,
  ).bind(evidenceBefore.run_id).run();
} catch {
  committedEvidenceDeleteRejected = true;
}
if (!committedEvidenceDeleteRejected) {
  throw new Error("0015 allowed deletion of committed ontology evidence");
}

let partialRegressionTupleRejected = false;
try {
  await upgradeDb.prepare(
    `INSERT INTO pattern_ontology_pipeline_evidence (
       run_id, ontology_version, corpus_release_id, corpus_release_hash,
       corpus_license_class, corpus_public_capable, activation_scope,
       bundle_hash, evaluation_report_hash, evaluation_artifact_object_key,
       evaluation_artifact_envelope_hash, evaluation_artifact_ciphertext_hash,
       evaluation_artifact_status, signing_key_id, run_status, evidence_status,
       compiler_passed, evaluator_passed, unevaluated_fixture_count,
       created_at, committed_at, regression_report_hash
     ) VALUES (?, ?, ?, ?, 'internal_synthetic', 0, 'internal', ?, ?, ?, ?, ?,
       'committed', ?, 'succeeded', 'committed', 1, 1, 0, ?, ?, ?)`,
  ).bind(
    "oprun_partial_regression_tuple",
    "ontology-partial-regression-tuple",
    "corpus-partial-regression-tuple",
    `sha256:${"20".repeat(32)}`,
    `sha256:${"21".repeat(32)}`,
    `sha256:${"22".repeat(32)}`,
    "migration-tests/partial-evaluation.enc",
    `sha256:${"23".repeat(32)}`,
    `sha256:${"24".repeat(32)}`,
    "migration-test-signing-key",
    evidenceBefore.created_at,
    evidenceBefore.committed_at,
    `sha256:${"25".repeat(32)}`,
  ).run();
} catch {
  partialRegressionTupleRejected = true;
}
if (!partialRegressionTupleRejected) {
  throw new Error("0015 admitted a partial regression evidence tuple");
}

let legacyEvidenceMutationRejected = false;
try {
  await upgradeDb.prepare(
    `UPDATE pattern_ontology_pipeline_evidence
     SET regression_report_hash = ? WHERE run_id = ?`,
  ).bind(`sha256:${"26".repeat(32)}`, evidenceBefore.run_id).run();
} catch {
  legacyEvidenceMutationRejected = true;
}
if (!legacyEvidenceMutationRejected) {
  throw new Error("0015 made a committed legacy evidence row mutable");
}

const evidenceAfterCodexMigration = await upgradeDb.prepare(
  `SELECT ${Object.keys(evidenceBefore).join(", ")}
   FROM pattern_ontology_pipeline_evidence WHERE run_id = ?`,
)
  .bind(evidenceBefore.run_id)
  .first();
if (JSON.stringify(evidenceAfterCodexMigration) !== JSON.stringify(evidenceBefore)) {
  throw new Error("0015 did not preserve the original populated ontology evidence fields");
}

const finalForeignKeyCheck = await upgradeDb.prepare("PRAGMA foreign_key_check").all();
if (finalForeignKeyCheck.results.length !== 0) {
  throw new Error("0015 left foreign-key violations on the populated upgrade");
}
const assertionRows = await upgradeDb.prepare("SELECT * FROM assertion_probe").all();
if (assertionRows.results.length !== 0) {
  throw new Error("0015 left an assertion probe armed");
}
