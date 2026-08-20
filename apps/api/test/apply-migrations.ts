import { applyD1Migrations, env } from "cloudflare:test";

// The migration setup is also the upgrade-path test. A fresh apply cannot prove
// that a CHECK rebuild preserves live inventory, so stop immediately before
// 0009, seed the exact pre-migration row shape, then apply the forward-only
// remainder under the same live foreign-key enforcement D1 uses.
const correctionMigrationIndex = env.TEST_MIGRATIONS.findIndex((migration) =>
  migration.name.startsWith("0009_"),
);
if (correctionMigrationIndex < 0) {
  throw new Error("0009 correction-artifact migration is missing");
}

await applyD1Migrations(
  env.DB,
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
await env.DB.prepare(
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
await env.DB.prepare(
  `INSERT INTO pattern_generation_artifacts (
     id, generation_id, user_id, artifact_class, object_key,
     ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
  .bind(...Object.values(artifactBefore))
  .run();

await applyD1Migrations(
  env.DB,
  env.TEST_MIGRATIONS.slice(correctionMigrationIndex),
);

const artifactAfter = await env.DB.prepare(
  `SELECT id, generation_id, user_id, artifact_class, object_key,
          ciphertext_sha256, plaintext_sha256, byte_length, created_at, expires_at, deleted_at
   FROM pattern_generation_artifacts WHERE id = ?`,
)
  .bind(artifactBefore.id)
  .first<typeof artifactBefore>();
if (JSON.stringify(artifactAfter) !== JSON.stringify(artifactBefore)) {
  throw new Error("0009 did not preserve the populated artifact row byte-for-byte");
}

await env.DB.prepare(
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
  await env.DB.prepare(
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

const foreignKeyCheck = await env.DB.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyCheck.results.length !== 0) {
  throw new Error("0009 left foreign-key violations after the CHECK rebuild");
}

await env.DB.prepare(
  "DELETE FROM pattern_generation_artifacts WHERE user_id = ?",
)
  .bind(migrationUserId)
  .run();
await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(migrationUserId).run();
