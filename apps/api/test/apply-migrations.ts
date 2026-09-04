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
  "0016_birth_calc_usage.sql",
  "0017_codex_reading_provider.sql",
  "0018_account_processing_consent.sql",
  "0019_pattern_claim_transition_guards.sql",
  "0020_pattern_admin_sessions.sql",
  "0021_crypto_operations.sql",
  "0022_place_resolutions.sql",
  "0023_pattern_source_regeneration.sql",
  "0024_geoapify_place_resolutions.sql",
];
if (
  JSON.stringify(migrationNames.slice(-expectedTail.length)) !==
  JSON.stringify(expectedTail)
) {
  throw new Error(
    `migration tail is missing or out of order: ${JSON.stringify(migrationNames.slice(-expectedTail.length))}`,
  );
}

const correctionMigrationIndex = migrationNames.indexOf(expectedTail[0]);
const usageMigrationIndex = migrationNames.indexOf(expectedTail[1]);
const evidenceMigrationIndex = migrationNames.indexOf(expectedTail[2]);
const pipelineMigrationIndex = migrationNames.indexOf(expectedTail[3]);
const codexProviderMigrationIndex = migrationNames.indexOf(expectedTail[4]);
const codexResponseUploadMigrationIndex = migrationNames.indexOf(expectedTail[5]);
const regressionEvidenceMigrationIndex = migrationNames.indexOf(expectedTail[6]);
const birthCalcUsageMigrationIndex = migrationNames.indexOf(expectedTail[7]);
const codexReadingProviderMigrationIndex = migrationNames.indexOf(expectedTail[8]);
const accountProcessingConsentMigrationIndex = migrationNames.indexOf(expectedTail[9]);
const patternClaimTransitionMigrationIndex = migrationNames.indexOf(expectedTail[10]);
const adminSessionMigrationIndex = migrationNames.indexOf(expectedTail[11]);
const cryptoOperationsMigrationIndex = migrationNames.indexOf(expectedTail[12]);
const placeResolutionsMigrationIndex = migrationNames.indexOf(expectedTail[13]);
const patternSourceRegenerationMigrationIndex = migrationNames.indexOf(expectedTail[14]);
const geoapifyMigrationIndex = migrationNames.indexOf(expectedTail[15]);

interface SchemaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const birthCalcColumns: Record<string, SchemaColumn[]> = {
  birth_calc_daily_usage: [
    { name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { name: "utc_date", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
    {
      name: "reserved_calc_count",
      type: "INTEGER",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      name: "last_reservation_hash",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    { name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ],
  birth_calc_reservations: [
    { name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { name: "reservation_hash", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
    { name: "utc_date", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "claim_token_hash", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "status", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "charged_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ],
  birth_profile_version_counters: [
    { name: "user_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    {
      name: "last_allocated_version",
      type: "INTEGER",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    { name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ],
};

async function assertBirthCalcSchema(db: D1Database, lane: string): Promise<void> {
  for (const [table, expected] of Object.entries(birthCalcColumns)) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`)
      .all<SchemaColumn>();
    const actual = results.map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `0016 ${lane} has wrong ${table} columns: ${JSON.stringify(actual)}`,
      );
    }

    const foreignKeys = await db.prepare(`PRAGMA foreign_key_list(${table})`)
      .all<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>();
    const expectedForeignKeys = [{
      id: 0,
      seq: 0,
      table: "users",
      from: "user_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
      match: "NONE",
    }];
    if (
      JSON.stringify(foreignKeys.results) !==
      JSON.stringify(expectedForeignKeys)
    ) {
      throw new Error(
        `0016 ${lane} has wrong ${table} users foreign key`,
      );
    }
  }

  const index = await db.prepare(
    "PRAGMA index_info(idx_birth_calc_reservations_user_date)",
  ).all<{ seqno: number; cid: number; name: string }>();
  if (
    JSON.stringify(index.results) !==
    JSON.stringify([
      { seqno: 0, cid: 0, name: "user_id" },
      { seqno: 1, cid: 2, name: "utc_date" },
    ])
  ) {
    throw new Error(`0016 ${lane} has wrong reservation date index`);
  }

  const requiredChecks: Record<string, string[]> = {
    birth_calc_daily_usage: [
      "CHECK (reserved_calc_count BETWEEN 0 AND 50)",
      "CHECK (last_reservation_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(last_reservation_hash) = 71)",
    ],
    birth_calc_reservations: [
      "CHECK (reservation_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(reservation_hash) = 71)",
      "CHECK (claim_token_hash GLOB 'sha256:[0-9a-f]*' " +
      "AND length(claim_token_hash) = 71)",
      "CHECK (status IN ('pending', 'charged', 'denied'))",
      "(status = 'charged' AND charged_at IS NOT NULL)",
      "(status = 'denied' AND charged_at IS NULL)",
    ],
    birth_profile_version_counters: [
      "CHECK (last_allocated_version >= 0)",
    ],
  };
  for (const [table, snippets] of Object.entries(requiredChecks)) {
    const source = await db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).bind(table).first<{ sql: string }>();
    const normalized = source?.sql.replace(/\s+/g, " ") ?? "";
    for (const snippet of snippets) {
      if (!normalized.includes(snippet)) {
        throw new Error(`0016 ${lane} is missing ${table} constraint ${snippet}`);
      }
    }
  }
}

async function assertAccountProcessingConsentSchema(
  db: D1Database,
  lane: string,
): Promise<void> {
  const columns = await db.prepare("PRAGMA table_info(birth_profiles)")
    .all<SchemaColumn>();
  const consentColumn = columns.results.find((column) =>
    column.name === "consent_id"
  );
  if (
    consentColumn?.type !== "TEXT" ||
    consentColumn.notnull !== 0 ||
    consentColumn.dflt_value !== null ||
    consentColumn.pk !== 0
  ) {
    throw new Error(
      `0018 ${lane} has wrong birth_profiles.consent_id: ${JSON.stringify(consentColumn)}`,
    );
  }

  const foreignKeys = await db.prepare("PRAGMA foreign_key_list(birth_profiles)")
    .all<{
      table: string;
      from: string;
      to: string;
    }>();
  if (
    !foreignKeys.results.some((foreignKey) =>
      foreignKey.table === "consents" &&
      foreignKey.from === "consent_id" &&
      foreignKey.to === "id"
    )
  ) {
    throw new Error(`0018 ${lane} has no birth_profiles consent foreign key`);
  }
}

async function assertDatabaseHealthy(db: D1Database, lane: string): Promise<void> {
  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.results.length !== 0) {
    throw new Error(`${lane} left foreign-key violations`);
  }
  const quickCheck = await db.prepare("PRAGMA quick_check")
    .first<{ quick_check: string }>();
  if (quickCheck?.quick_check !== "ok") {
    throw new Error(`${lane} failed quick_check`);
  }
  const assertionRows = await db.prepare("SELECT * FROM assertion_probe").all();
  if (assertionRows.results.length !== 0) {
    throw new Error(`${lane} left an assertion probe armed`);
  }
}

// Main-test storage starts empty and receives the exact ordered migration set.
// This is the fresh-database lane; individual tests then exercise the schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await assertBirthCalcSchema(env.DB, "clean apply");
await assertAccountProcessingConsentSchema(env.DB, "clean apply");
await assertDatabaseHealthy(env.DB, "0018 clean apply");

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
  env.TEST_MIGRATIONS.slice(
    regressionEvidenceMigrationIndex,
    birthCalcUsageMigrationIndex,
  ),
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

const birthProfileBefore = {
  user_id: migrationUserId,
  version: 27,
  accuracy: "unknown",
  status: "invalid",
  created_at: artifactBefore.created_at,
  updated_at: artifactBefore.created_at,
};
await upgradeDb.prepare(
  `INSERT INTO birth_profiles (
     user_id, version, accuracy, status, created_at, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?)`,
).bind(...Object.values(birthProfileBefore)).run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    birthCalcUsageMigrationIndex,
    codexReadingProviderMigrationIndex,
  ),
);
await assertBirthCalcSchema(upgradeDb, "populated apply");

const birthProfileAfter = await upgradeDb.prepare(
  `SELECT user_id, version, accuracy, status, created_at, updated_at
   FROM birth_profiles WHERE user_id = ? AND version = ?`,
).bind(migrationUserId, birthProfileBefore.version).first();
if (JSON.stringify(birthProfileAfter) !== JSON.stringify(birthProfileBefore)) {
  throw new Error("0016 did not preserve a populated birth profile byte-for-byte");
}
for (const table of Object.keys(birthCalcColumns)) {
  const row = await upgradeDb.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>();
  if (row?.count !== 0) {
    throw new Error(`0016 populated apply invented rows in ${table}`);
  }
}
await assertDatabaseHealthy(upgradeDb, "0016 populated apply");

// ---------------------------------------------------------------------------
// 0017: the Codex provider `reading`/`publisher` coordinate.
// ---------------------------------------------------------------------------
// 0017 rebuilds `codex_provider_jobs` and its response-upload child while
// foreign keys are live. The only way to prove a rebuild preserved live work is
// to seed live work first, so this lane fills every lifecycle, both existing
// pipelines, every nullable terminal field, and two child rows before the
// migration runs, snapshots them with stable ordering, and hands the snapshot
// to src/db/codex-provider-schema.test.ts for deep comparison.

const codexProviderColumns = [
  "id", "pipeline", "owner_id", "user_id", "pass", "stage_generation",
  "stage_attempt", "request_hash", "request_object_key",
  "request_envelope_hash", "request_ciphertext_hash", "request_key_id",
  "request_nonce", "request_byte_length", "response_hash",
  "response_object_key", "response_envelope_hash", "response_ciphertext_hash",
  "response_key_id", "response_nonce", "response_byte_length", "model",
  "reasoning_effort", "prompt_version", "timeout_ms", "daily_call_limit",
  "status", "lease_token_hash", "lease_expires_at", "provider_request_id",
  "input_tokens", "output_tokens", "failure_code", "safe_detail_code",
  "available_at", "created_at", "updated_at", "completed_at",
] as const;

const hex64 = (seed: string): string => seed.repeat(64).slice(0, 64);
const leaseHash = (seed: string): string => `sha256:${hex64(seed)}`;

interface ProviderJobFixture {
  id: string;
  pipeline: "pattern" | "ontology";
  owner_id: string;
  user_id: string | null;
  pass: string;
  stage_generation: number;
  stage_attempt: number;
  status: "pending" | "leased" | "completed" | "failed" | "cancelled";
}

function codexProviderRow(fixture: ProviderJobFixture) {
  const discriminator = fixture.id.slice("cpjob_".length);
  const terminal = "2026-08-26T12:34:56.000Z";
  const completed = fixture.status === "completed";
  const failed = fixture.status === "failed";
  const leased = fixture.status === "leased";
  return {
    id: fixture.id,
    pipeline: fixture.pipeline,
    owner_id: fixture.owner_id,
    user_id: fixture.user_id,
    pass: fixture.pass,
    stage_generation: fixture.stage_generation,
    stage_attempt: fixture.stage_attempt,
    request_hash: leaseHash(discriminator.slice(0, 2)),
    request_object_key: `codex-provider-jobs/${fixture.id}/request.json.enc`,
    request_envelope_hash: leaseHash(discriminator.slice(2, 4)),
    request_ciphertext_hash: leaseHash(discriminator.slice(4, 6)),
    request_key_id: `codex-key-${discriminator.slice(0, 8)}`,
    request_nonce: `nonce-request-${discriminator.slice(0, 12)}`,
    request_byte_length: 1024,
    response_hash: completed ? leaseHash(discriminator.slice(6, 8)) : null,
    response_object_key: completed
      ? `codex-provider-jobs/${fixture.id}/responses/${hex64("f")}.json.enc`
      : null,
    response_envelope_hash: completed ? leaseHash(discriminator.slice(8, 10)) : null,
    response_ciphertext_hash: completed ? leaseHash(discriminator.slice(10, 12)) : null,
    response_key_id: completed ? `codex-key-${discriminator.slice(8, 16)}` : null,
    response_nonce: completed ? `nonce-response-${discriminator.slice(0, 12)}` : null,
    response_byte_length: completed ? 2048 : null,
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    prompt_version: "1.0.5",
    timeout_ms: 900000,
    daily_call_limit: 250,
    status: fixture.status,
    lease_token_hash: leased || completed || failed
      ? leaseHash(discriminator.slice(12, 14))
      : null,
    lease_expires_at: leased || completed || failed
      ? "2026-08-26T13:00:00.000Z"
      : null,
    provider_request_id: completed ? `thread_${discriminator.slice(0, 16)}` : null,
    input_tokens: completed ? 4127 : null,
    output_tokens: completed ? 612 : null,
    failure_code: failed ? "publisher_unavailable" : null,
    safe_detail_code: failed ? "request_timeout" : null,
    available_at: "2026-08-26T12:00:00.000Z",
    created_at: "2026-08-26T12:00:00.000Z",
    updated_at: "2026-08-26T12:30:00.000Z",
    completed_at: completed || failed || fixture.status === "cancelled"
      ? terminal
      : null,
  };
}

const providerFixtures: ProviderJobFixture[] = [
  {
    id: `cpjob_${"1".repeat(32)}`,
    pipeline: "pattern",
    owner_id: "pgen_populated_0017_planner",
    user_id: migrationUserId,
    pass: "planner",
    stage_generation: 1,
    stage_attempt: 0,
    status: "pending",
  },
  {
    id: `cpjob_${"2".repeat(32)}`,
    pipeline: "pattern",
    owner_id: "pgen_populated_0017_writer",
    user_id: migrationUserId,
    pass: "writer",
    stage_generation: 1,
    stage_attempt: 1,
    status: "leased",
  },
  {
    id: `cpjob_${"3".repeat(32)}`,
    pipeline: "pattern",
    owner_id: "pgen_populated_0017_verifier",
    user_id: migrationUserId,
    pass: "verifier",
    stage_generation: 2,
    stage_attempt: 0,
    status: "completed",
  },
  {
    id: `cpjob_${"4".repeat(32)}`,
    pipeline: "ontology",
    owner_id: "oprun_populated_0017_generator",
    user_id: null,
    pass: "generator",
    stage_generation: 0,
    stage_attempt: 2,
    status: "failed",
  },
  {
    id: `cpjob_${"5".repeat(32)}`,
    pipeline: "ontology",
    owner_id: "oprun_populated_0017_evaluator",
    user_id: null,
    pass: "evaluator",
    stage_generation: 3,
    stage_attempt: 0,
    status: "cancelled",
  },
];

for (const fixture of providerFixtures) {
  const row = codexProviderRow(fixture);
  await upgradeDb.prepare(
    `INSERT INTO codex_provider_jobs (${codexProviderColumns.join(", ")})
     VALUES (${codexProviderColumns.map(() => "?").join(", ")})`,
  )
    .bind(...codexProviderColumns.map((column) => row[column]))
    .run();
}

// One committed upload beside a completed job, and one orphaned upload from a
// lease that lost terminal CAS. The second is exactly the row maintenance and
// account deletion exist to find, so a rebuild that silently dropped it would
// leave an encrypted object with no inventory pointing at it.
const uploadFixtures = [
  {
    job_id: `cpjob_${"3".repeat(32)}`,
    lease_token_hash: leaseHash("aa"),
    object_key:
      `codex-provider-jobs/cpjob_${"3".repeat(32)}/responses/${hex64("f")}.json.enc`,
    created_at: "2026-08-26T12:35:00.000Z",
  },
  {
    job_id: `cpjob_${"2".repeat(32)}`,
    lease_token_hash: leaseHash("bb"),
    object_key:
      `codex-provider-jobs/cpjob_${"2".repeat(32)}/responses/${hex64("e")}.json.enc`,
    created_at: "2026-08-26T12:36:00.000Z",
  },
];
for (const upload of uploadFixtures) {
  await upgradeDb.prepare(
    `INSERT INTO codex_provider_response_uploads (
       job_id, lease_token_hash, object_key, created_at
     ) VALUES (?, ?, ?, ?)`,
  )
    .bind(
      upload.job_id,
      upload.lease_token_hash,
      upload.object_key,
      upload.created_at,
    )
    .run();
}

const providerJobsBefore = await upgradeDb.prepare(
  `SELECT ${codexProviderColumns.join(", ")}
   FROM codex_provider_jobs ORDER BY id`,
).all();
const providerUploadsBefore = await upgradeDb.prepare(
  `SELECT job_id, lease_token_hash, object_key, created_at
   FROM codex_provider_response_uploads ORDER BY job_id, lease_token_hash`,
).all();
if (providerJobsBefore.results.length !== providerFixtures.length) {
  throw new Error("0017 populated lane did not seed every provider fixture");
}
if (providerUploadsBefore.results.length !== uploadFixtures.length) {
  throw new Error("0017 populated lane did not seed every response upload");
}

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    codexReadingProviderMigrationIndex,
    accountProcessingConsentMigrationIndex,
  ),
);

const providerJobsAfter = await upgradeDb.prepare(
  `SELECT ${codexProviderColumns.join(", ")}
   FROM codex_provider_jobs ORDER BY id`,
).all();
if (
  JSON.stringify(providerJobsAfter.results) !==
  JSON.stringify(providerJobsBefore.results)
) {
  throw new Error("0017 did not preserve every populated provider job byte-for-byte");
}

const providerUploadsAfter = await upgradeDb.prepare(
  `SELECT job_id, lease_token_hash, object_key, created_at
   FROM codex_provider_response_uploads ORDER BY job_id, lease_token_hash`,
).all();
if (
  JSON.stringify(providerUploadsAfter.results) !==
  JSON.stringify(providerUploadsBefore.results)
) {
  throw new Error("0017 did not preserve every populated response upload byte-for-byte");
}

// Handed to src/db/codex-provider-schema.test.ts, which cannot observe the
// pre-migration state itself.
await upgradeDb.prepare(
  `CREATE TABLE IF NOT EXISTS migration_upgrade_snapshot (
     name TEXT PRIMARY KEY NOT NULL,
     payload TEXT NOT NULL
   )`,
).run();
await upgradeDb.prepare(
  `INSERT OR REPLACE INTO migration_upgrade_snapshot (name, payload)
   VALUES (?, ?)`,
).bind(
  "codex_provider_jobs",
  JSON.stringify(providerJobsBefore.results),
).run();
await upgradeDb.prepare(
  `INSERT OR REPLACE INTO migration_upgrade_snapshot (name, payload)
   VALUES (?, ?)`,
).bind(
  "codex_provider_response_uploads",
  JSON.stringify(providerUploadsBefore.results),
).run();

const stagingLeftBehind = await upgradeDb.prepare(
  `SELECT name FROM sqlite_master
   WHERE type = 'table' AND name LIKE 'codex_provider_%staging%'`,
).all();
if (stagingLeftBehind.results.length !== 0) {
  throw new Error("0017 left its staging table behind");
}

let illegalReadingPassRejected = false;
try {
  const row = codexProviderRow({
    id: `cpjob_${"6".repeat(32)}`,
    pipeline: "pattern",
    owner_id: "populated_0017_illegal",
    user_id: migrationUserId,
    pass: "planner",
    stage_generation: 9,
    stage_attempt: 0,
    status: "pending",
  });
  await upgradeDb.prepare(
    `INSERT INTO codex_provider_jobs (${codexProviderColumns.join(", ")})
     VALUES (${codexProviderColumns.map(() => "?").join(", ")})`,
  )
    .bind(
      ...codexProviderColumns.map((column) =>
        column === "pipeline"
          ? "reading"
          : column === "pass"
            ? "planner"
            : row[column]
      ),
    )
    .run();
} catch {
  illegalReadingPassRejected = true;
}
if (!illegalReadingPassRejected) {
  throw new Error("0017 populated apply admitted reading/planner");
}

await assertDatabaseHealthy(upgradeDb, "0017 populated apply");

// ---------------------------------------------------------------------------
// 0018: nullable account-processing authorization provenance.
// ---------------------------------------------------------------------------

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    accountProcessingConsentMigrationIndex,
    patternClaimTransitionMigrationIndex,
  ),
);
await assertAccountProcessingConsentSchema(upgradeDb, "populated apply");

const legacyBirthProfileAfterConsentMigration = await upgradeDb.prepare(
  `SELECT user_id, version, accuracy, status, created_at, updated_at, consent_id
   FROM birth_profiles WHERE user_id = ? AND version = ?`,
).bind(migrationUserId, birthProfileBefore.version).first();
if (
  JSON.stringify(legacyBirthProfileAfterConsentMigration) !==
  JSON.stringify({ ...birthProfileBefore, consent_id: null })
) {
  throw new Error("0018 changed a legacy profile or fabricated consent provenance");
}

const accountProcessingConsentId = "cns_account_processing_migration";
await upgradeDb.prepare(
  `INSERT INTO consents (
     id, user_id, kind, status, source_id, permission_tier, allowed_uses_json,
     scopes_json, policy_version, ui_surface, granted_at, version, created_at,
     updated_at
   ) VALUES (?, ?, 'account_processing', 'granted', 'AST-01', 0,
     '["chart_fact","cycle_detection","uncertainty_model"]', '[]',
     'account-processing-v1-2026-08-28', 'onboarding', ?, 1, ?, ?)`,
).bind(
  accountProcessingConsentId,
  migrationUserId,
  artifactBefore.created_at,
  artifactBefore.created_at,
  artifactBefore.created_at,
).run();
await upgradeDb.prepare(
  `INSERT INTO birth_profiles (
     user_id, version, accuracy, status, consent_id, created_at, updated_at
   ) VALUES (?, 28, 'unknown', 'invalid', ?, ?, ?)`,
).bind(
  migrationUserId,
  accountProcessingConsentId,
  artifactBefore.created_at,
  artifactBefore.created_at,
).run();

let missingConsentRejected = false;
try {
  await upgradeDb.prepare(
    `INSERT INTO birth_profiles (
       user_id, version, accuracy, status, consent_id, created_at, updated_at
     ) VALUES (?, 29, 'unknown', 'invalid', 'cns_missing', ?, ?)`,
  ).bind(
    migrationUserId,
    artifactBefore.created_at,
    artifactBefore.created_at,
  ).run();
} catch {
  missingConsentRejected = true;
}
if (!missingConsentRejected) {
  throw new Error("0018 admitted a profile linked to a missing consent");
}
await assertDatabaseHealthy(upgradeDb, "0018 populated apply");

// ---------------------------------------------------------------------------
// 0019: monotonic Pattern claim transition guard.
// ---------------------------------------------------------------------------

const populatedClaimBefore = {
  id: "pgc_populated_0019",
  user_id: migrationUserId,
  chart_fingerprint_hash: `sha256:${"19".repeat(32)}`,
  last_chart_id: null,
  status: "available",
  active_generation_id: null,
  consumed_at: null,
  accepted_at: null,
  deleted_at: null,
  superseded_at: null,
  withdrawn_at: null,
  created_at: artifactBefore.created_at,
  updated_at: artifactBefore.created_at,
};
await upgradeDb.prepare(
  `INSERT INTO pattern_generation_claims (
     id, user_id, chart_fingerprint_hash, last_chart_id, status,
     active_generation_id, consumed_at, accepted_at, deleted_at,
     superseded_at, withdrawn_at, created_at, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).bind(...Object.values(populatedClaimBefore)).run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    patternClaimTransitionMigrationIndex,
    adminSessionMigrationIndex,
  ),
);

const populatedClaimAfter = await upgradeDb.prepare(
  `SELECT ${Object.keys(populatedClaimBefore).join(", ")}
   FROM pattern_generation_claims WHERE id = ?`,
).bind(populatedClaimBefore.id).first();
if (JSON.stringify(populatedClaimAfter) !== JSON.stringify(populatedClaimBefore)) {
  throw new Error("0019 changed a populated Pattern claim");
}

let illegalClaimShortcutRejected = false;
try {
  await upgradeDb.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'accepted', consumed_at = ?, accepted_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    artifactBefore.created_at,
    artifactBefore.created_at,
    artifactBefore.created_at,
    populatedClaimBefore.id,
  ).run();
} catch {
  illegalClaimShortcutRejected = true;
}
if (!illegalClaimShortcutRejected) {
  throw new Error("0019 admitted available -> accepted");
}

await upgradeDb.prepare(
  `UPDATE pattern_generation_claims
   SET status = 'reserved', active_generation_id = 'pgen_populated_0019',
       updated_at = ? WHERE id = ?`,
).bind(artifactBefore.created_at, populatedClaimBefore.id).run();
await upgradeDb.prepare(
  `UPDATE pattern_generation_claims
   SET status = 'accepted', active_generation_id = NULL,
       consumed_at = ?, accepted_at = ?, updated_at = ? WHERE id = ?`,
).bind(
  artifactBefore.created_at,
  artifactBefore.created_at,
  artifactBefore.created_at,
  populatedClaimBefore.id,
).run();
await upgradeDb.prepare(
  `UPDATE pattern_generation_claims
   SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?`,
).bind(
  artifactBefore.created_at,
  artifactBefore.created_at,
  populatedClaimBefore.id,
).run();

let terminalClaimReopenRejected = false;
try {
  await upgradeDb.prepare(
    `UPDATE pattern_generation_claims
     SET status = 'available', consumed_at = NULL, deleted_at = NULL,
         updated_at = ? WHERE id = ?`,
  ).bind(artifactBefore.created_at, populatedClaimBefore.id).run();
} catch {
  terminalClaimReopenRejected = true;
}
if (!terminalClaimReopenRejected) {
  throw new Error("0019 reopened a terminal Pattern claim");
}
await assertDatabaseHealthy(upgradeDb, "0019 populated apply");

// ---------------------------------------------------------------------------
// 0020: Cloudflare Access administrator sessions.
// ---------------------------------------------------------------------------

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    adminSessionMigrationIndex,
    cryptoOperationsMigrationIndex,
  ),
);
const adminSessionColumns = await upgradeDb.prepare(
  "PRAGMA table_info(pattern_admin_sessions)",
).all<{ name: string }>();
if (
  JSON.stringify(adminSessionColumns.results.map(({ name }) => name)) !==
  JSON.stringify([
    "id",
    "token_hash",
    "admin_subject",
    "role",
    "audience",
    "access_expires_at",
    "expires_at",
    "created_at",
    "revoked_at",
  ])
) {
  throw new Error("0020 created the wrong Pattern administrator session columns");
}
await assertDatabaseHealthy(upgradeDb, "0020 populated apply");

// ---------------------------------------------------------------------------
// 0021: versioned root keys and durable crypto operations.
// ---------------------------------------------------------------------------

const wrappedDekBefore = Uint8Array.from([1, 2, 3, 4, 5, 250]);
await upgradeDb.prepare(
  `INSERT INTO user_keys (
     user_id, key_version, kek_version, wrapped_dek, created_at
   ) VALUES (?, 1, 3, ?, ?)`,
).bind(migrationUserId, wrappedDekBefore, artifactBefore.created_at).run();

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    cryptoOperationsMigrationIndex,
    placeResolutionsMigrationIndex,
  ),
);

const upgradedKey = await upgradeDb.prepare(
  `SELECT wrapped_dek, root_kek_id FROM user_keys
   WHERE user_id = ? AND key_version = 1`,
).bind(migrationUserId).first<{
  wrapped_dek: ArrayBuffer | readonly number[];
  root_kek_id: string;
}>();
const upgradedWrapped = upgradedKey?.wrapped_dek instanceof ArrayBuffer
  ? new Uint8Array(upgradedKey.wrapped_dek)
  : Uint8Array.from(upgradedKey?.wrapped_dek ?? []);
if (
  upgradedKey?.root_kek_id !== "legacy" ||
  JSON.stringify([...upgradedWrapped]) !== JSON.stringify([...wrappedDekBefore])
) {
  throw new Error("0021 changed wrapped DEK bytes or failed the legacy key-id backfill");
}
for (const table of [
  "crypto_operations",
  "crypto_kek_rewrap_campaigns",
  "crypto_kek_rewrap_items",
]) {
  const found = await upgradeDb.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).bind(table).first();
  if (!found) throw new Error(`0021 did not create ${table}`);
}
await assertDatabaseHealthy(upgradeDb, "0021 populated apply");

// ---------------------------------------------------------------------------
// 0022: encrypted selected-place cache.
// ---------------------------------------------------------------------------

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(
    placeResolutionsMigrationIndex,
    patternSourceRegenerationMigrationIndex,
  ),
);
const placeColumns = await upgradeDb.prepare(
  "PRAGMA table_info(place_resolutions)",
).all<{ name: string }>();
if (
  JSON.stringify(placeColumns.results.map(({ name }) => name)) !==
  JSON.stringify([
    "id",
    "user_id",
    "provider",
    "policy_version",
    "payload_enc",
    "payload_key_version",
    "payload_nonce",
    "created_at",
    "expires_at",
    "consumed_at",
  ])
) {
  throw new Error("0022 created the wrong selected-place columns");
}
await assertDatabaseHealthy(upgradeDb, "0022 populated apply");

// ---------------------------------------------------------------------------
// 0023: source-pinned Pattern replacement lane.
// ---------------------------------------------------------------------------

await applyD1Migrations(
  upgradeDb,
  env.TEST_MIGRATIONS.slice(patternSourceRegenerationMigrationIndex, geoapifyMigrationIndex),
);
const patternClaimColumns = await upgradeDb.prepare(
  "PRAGMA table_info(pattern_generation_claims)",
).all<{ name: string }>();
if (!patternClaimColumns.results.some(({ name }) => name === "pending_regeneration_id")) {
  throw new Error("0023 did not add the single pending Pattern replacement owner");
}
for (const table of ["pattern_generation_jobs", "pattern_documents"]) {
  const columns = await upgradeDb.prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>();
  if (!columns.results.some(({ name }) => name === "pattern_source_hash")) {
    throw new Error(`0023 did not pin Pattern creation source on ${table}`);
  }
}
await assertDatabaseHealthy(upgradeDb, "0023 populated apply");

// 0024 widens the provider constraint without changing historical ciphertext,
// identifiers (part of encryption AAD), expiry, or consumption state.
const legacyPlaceId = "plc_00000000000000000000000000000001";
await upgradeDb.prepare(
  `INSERT INTO place_resolutions
   (id, user_id, provider, policy_version, payload_enc, payload_key_version,
    payload_nonce, created_at, expires_at, consumed_at)
   VALUES (?, ?, 'google_places_geocoding_v4', '1.0.0', X'0001FFAA', 1,
           'legacy-nonce', '2026-09-04T00:00:00Z', '2026-09-05T00:00:00Z', '2026-09-04T01:00:00Z')`,
).bind(legacyPlaceId, migrationUserId).run();
const beforeGeoapify = await upgradeDb.prepare("SELECT *, hex(payload_enc) AS payload_hex FROM place_resolutions WHERE id = ?")
  .bind(legacyPlaceId).first();
await applyD1Migrations(upgradeDb, env.TEST_MIGRATIONS.slice(geoapifyMigrationIndex));
const afterGeoapify = await upgradeDb.prepare("SELECT *, hex(payload_enc) AS payload_hex FROM place_resolutions WHERE id = ?")
  .bind(legacyPlaceId).first();
if (JSON.stringify(beforeGeoapify) !== JSON.stringify(afterGeoapify)) {
  throw new Error("0024 changed a historical selected-place record");
}
await upgradeDb.prepare(
  `INSERT INTO place_resolutions
   SELECT 'plc_00000000000000000000000000000002', user_id, 'geoapify',
          policy_version, payload_enc, payload_key_version, payload_nonce,
          created_at, expires_at, NULL FROM place_resolutions WHERE id = ?`,
).bind(legacyPlaceId).run();
const placeIndexes = await upgradeDb.prepare("PRAGMA index_list(place_resolutions)").all<{ name: string }>();
for (const name of ["idx_place_resolutions_expiry", "idx_place_resolutions_user_expiry"]) {
  if (!placeIndexes.results.some((index) => index.name === name)) throw new Error(`0024 lost ${name}`);
}
await assertDatabaseHealthy(upgradeDb, "0024 populated apply");
