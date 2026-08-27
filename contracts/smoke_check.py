#!/usr/bin/env python3
"""Apply the ordered D1 migration directory and prove the M3 invariants.

`contracts/m0/smoke_check.py` stays exactly as it is — it validates 0001 alone,
which remains true — and contracts/m0 is byte-frozen by the M3 freeze note.
This is the repo-level loader, and it applies migrations in the same order
`wrangler d1 migrations apply` does, so "it works locally" and "it works in
CI" test the same thing production will run.

Usage:
  python contracts/smoke_check.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "db" / "d1"

USER_A = "usr_0123456789abcdef0123456789abcdef"
SUBJ_A = "cs_0123456789abcdef0123456789abcdef"
USER_B = "usr_ffffffffffffffffffffffffffffffff"
SUBJ_B = "cs_ffffffffffffffffffffffffffffffff"
NOW = "2026-08-09T00:00:00Z"


def migration_files() -> list[Path]:
    """Same ordering rule wrangler and @cloudflare/vitest-pool-workers use."""
    files = [p for p in MIGRATIONS.glob("*.sql")]
    files.sort(key=lambda p: int(p.name.split("_")[0]))
    return files


def split_statements(sql: str) -> list[str]:
    """SQL-aware split. sqlite3.complete_statement understands string literals."""
    statements: list[str] = []
    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            stripped = buffer.strip()
            if stripped:
                statements.append(stripped)
            buffer = ""
    if buffer.strip():
        statements.append(buffer.strip())
    return statements


def apply_migrations(
    con: sqlite3.Connection, upto: int | None = None, start: int = 1
) -> None:
    """Apply each migration as ONE transaction, as D1's batch() does.

    That is what makes the abort assertions meaningful: a failure must roll the
    whole migration back rather than leave a half-converted schema.

    `start` exists because the migrations are not individually idempotent past
    0001: 0002 and 0003 both ALTER TABLE ... ADD COLUMN, which fails outright on
    a second application. A test that has already reached 0002 therefore asks
    for 0003 alone rather than replaying the directory.
    """
    con.execute("PRAGMA foreign_keys = ON")
    for path in migration_files():
        number = int(path.name.split("_")[0])
        if upto is not None and number > upto:
            continue
        if number < start:
            continue
        statements = split_statements(path.read_text(encoding="utf-8"))
        try:
            con.execute("BEGIN")
            for statement in statements:
                # No statement is special-cased out of the transaction. A
                # migration that needs foreign keys switched off cannot run on
                # D1 at all, so the loader must not offer an escape the live
                # database does not have.
                con.execute(statement)
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise


def fresh(upto: int | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    apply_migrations(con, upto)
    return con


def seed_user(con: sqlite3.Connection, uid: str, subject: str) -> None:
    con.execute(
        "INSERT INTO users (id, crypto_subject, status, locale, timezone, "
        "entitlement_tier, created_at, updated_at) "
        "VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', ?, ?)",
        (uid, subject, NOW, NOW),
    )


def seed_release(con: sqlite3.Connection, version: str = "release-12") -> None:
    con.execute(
        "INSERT INTO content_releases (version, bundle_hash, status, approver_id, "
        "last_author_id, changelog, created_at) "
        "VALUES (?, ?, 'active', 'wp-editor-2', 'wp-editor-1', 'c', ?)",
        (version, "sha256:" + version, NOW),
    )


def seed_job(con: sqlite3.Connection, jid: str, uid: str | None, key: str) -> None:
    con.execute(
        "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
        "VALUES (?, 'GenerateDailyReading', ?, ?, 'queued', 0, ?)",
        (jid, uid, key, NOW),
    )


def insert_reading(
    con: sqlite3.Connection,
    rid: str,
    uid: str,
    date: str,
    status: str,
    revision: int = 1,
    reason: str = "initial",
    supersedes: str | None = None,
    job: str | None = None,
    mode: str = "deterministic",
    release: str | None = "release-12",
    reading_key: str | None = None,
    invalidated_at: str | None = None,
) -> None:
    # An invalidated row was published before it was invalidated, so it keeps
    # its ciphertext: 0003 requires the encrypted history to survive.
    sealed = status in ("published", "invalidated")
    enc = (b"\x00", 1, "nonce") if sealed else (None, None, None)
    if reading_key is None:
        reading_key = (
            f"reading-v5:{uid}:{date}:r{revision}"
            if mode == "constrained_model"
            else f"user:{uid}:{date}:{release}:r{revision}"
        )
    con.execute(
        "INSERT INTO daily_readings (id, user_id, local_date, release_version, reading_key, "
        "chart_fingerprint, contract_id, assembly_mode, status, revision, revision_reason, "
        "supersedes_reading_id, command_generation, active_generation_job_id, invalidated_at, "
        "reading_enc, reading_key_version, reading_nonce, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'sha256:f', 'c', ?, ?, ?, ?, ?, 1, ?, ?, "
        "?, ?, ?, ?, ?)",
        (
            rid, uid, date, release, reading_key, mode,
            status, revision, reason, supersedes, job, invalidated_at, *enc, NOW, NOW,
        ),
    )


def insert_m3_reading(con: sqlite3.Connection, rid: str, uid: str, date: str) -> None:
    """A published row in the 0002 shape, before 0003 adds `invalidated_at`.

    Separate from `insert_reading` on purpose: the pre-0003 column list is what
    a production row would actually look like when the migration refuses to
    drop it, so writing it through the post-0003 helper would test nothing.
    """
    con.execute(
        "INSERT INTO daily_readings (id, user_id, local_date, release_version, reading_key, "
        "chart_fingerprint, contract_id, assembly_mode, status, revision, revision_reason, "
        "command_generation, reading_enc, reading_key_version, reading_nonce, "
        "created_at, updated_at) "
        "VALUES (?, ?, ?, 'release-12', ?, 'sha256:f', 'c', 'deterministic', 'published', "
        "1, 'initial', 1, X'00', 1, 'n', ?, ?)",
        (rid, uid, date, f"user:{uid}:{date}:release-12:r1", NOW, NOW),
    )


def insert_context_signal(
    con: sqlite3.Connection,
    sid: str,
    uid: str,
    window: str,
    consent_id: str | None,
) -> None:
    """An encrypted USR-06 check-in row, the shape that actually names a consent."""
    con.execute(
        "INSERT INTO context_signals (id, user_id, source_id, source_window, "
        "evidence_lane, allowed_uses_json, confidence, sensitivity, permission_state, "
        "consent_id, freshness_status, observed_at, ingested_at, value_encoding, "
        "value_enc, value_key_version, value_nonce, normalized_hash, created_at, updated_at) "
        "VALUES (?, ?, 'USR-06', ?, 'user_and_context', '[\"daily_reading\"]', 'high', "
        "'personal', 'active', ?, 'fresh', ?, ?, 'encrypted', X'00', 1, 'n', 'sha256:h', ?, ?)",
        (sid, uid, window, consent_id, NOW, NOW, NOW, NOW),
    )


def expect_integrity_error(fn, what: str) -> None:
    try:
        fn()
    except sqlite3.IntegrityError:
        print(f"D1 OK  {what}")
        return
    raise SystemExit(f"FAILED: {what} was allowed")


def assert_birth_calc_schema(con: sqlite3.Connection, lane: str) -> None:
    expected_columns = {
        "birth_calc_daily_usage": [
            ("user_id", "TEXT", 1, None, 1),
            ("utc_date", "TEXT", 1, None, 2),
            ("reserved_calc_count", "INTEGER", 1, None, 0),
            ("last_reservation_hash", "TEXT", 1, None, 0),
            ("created_at", "TEXT", 1, None, 0),
            ("updated_at", "TEXT", 1, None, 0),
        ],
        "birth_calc_reservations": [
            ("user_id", "TEXT", 1, None, 1),
            ("reservation_hash", "TEXT", 1, None, 2),
            ("utc_date", "TEXT", 1, None, 0),
            ("claim_token_hash", "TEXT", 1, None, 0),
            ("status", "TEXT", 1, None, 0),
            ("created_at", "TEXT", 1, None, 0),
            ("charged_at", "TEXT", 0, None, 0),
        ],
        "birth_profile_version_counters": [
            ("user_id", "TEXT", 1, None, 1),
            ("last_allocated_version", "INTEGER", 1, None, 0),
            ("updated_at", "TEXT", 1, None, 0),
        ],
    }
    for table, expected in expected_columns.items():
        actual = [
            (row[1], row[2], row[3], row[4], row[5])
            for row in con.execute(f"PRAGMA table_info({table})")
        ]
        if actual != expected:
            raise SystemExit(
                f"0016 {lane} has wrong {table} columns/PK: {actual}"
            )
        foreign_keys = con.execute(f"PRAGMA foreign_key_list({table})").fetchall()
        expected_fk = [
            (0, 0, "users", "user_id", "id", "NO ACTION", "NO ACTION", "NONE")
        ]
        if foreign_keys != expected_fk:
            raise SystemExit(
                f"0016 {lane} has wrong {table} users foreign key: {foreign_keys}"
            )

    index_columns = con.execute(
        "PRAGMA index_info(idx_birth_calc_reservations_user_date)"
    ).fetchall()
    if index_columns != [(0, 0, "user_id"), (1, 2, "utc_date")]:
        raise SystemExit(
            f"0016 {lane} has wrong reservation date index: {index_columns}"
        )

    required_checks = {
        "birth_calc_daily_usage": [
            "CHECK (reserved_calc_count BETWEEN 0 AND 50)",
            "CHECK (last_reservation_hash GLOB 'sha256:[0-9a-f]*' "
            "AND length(last_reservation_hash) = 71)",
        ],
        "birth_calc_reservations": [
            "CHECK (reservation_hash GLOB 'sha256:[0-9a-f]*' "
            "AND length(reservation_hash) = 71)",
            "CHECK (claim_token_hash GLOB 'sha256:[0-9a-f]*' "
            "AND length(claim_token_hash) = 71)",
            "CHECK (status IN ('pending', 'charged', 'denied'))",
            "(status = 'pending' AND charged_at IS NULL)",
            "(status = 'charged' AND charged_at IS NOT NULL)",
            "(status = 'denied' AND charged_at IS NULL)",
        ],
        "birth_profile_version_counters": [
            "CHECK (last_allocated_version >= 0)",
        ],
    }
    for table, snippets in required_checks.items():
        row = con.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        normalized = " ".join((row[0] if row else "").split())
        for snippet in snippets:
            if snippet not in normalized:
                raise SystemExit(
                    f"0016 {lane} is missing {table} constraint {snippet}"
                )


# ---------------------------------------------------------------------------


def check_fresh_schema() -> None:
    con = fresh()
    tables = {
        r[0]
        for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    expected = {
        "assertion_probe", "timezone_changes", "cycle_passes",
        "daily_readings", "reading_sources", "jobs",
        "reading_provider_daily_usage",
        "natal_feature_sets", "cycle_scan_receipts",
        "time_travel_daily_usage",
        "pattern_erasure_replay_events",
        "birth_calc_daily_usage", "birth_calc_reservations",
        "birth_profile_version_counters",
    }
    missing = expected - tables
    if missing:
        raise SystemExit(f"Missing tables after latest migration: {sorted(missing)}")
    print(f"D1 OK  fresh apply of {len(migration_files())} migration(s), {len(tables)} tables")
    assert_birth_calc_schema(con, "clean apply")
    print("D1 OK  0016 clean apply has exact columns, PK/FK, CHECKs, and index")

    indexes = {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
    }
    for name in (
        "uq_daily_readings_live",
        "uq_daily_readings_pending",
        "uq_daily_readings_successor",
        "uq_jobs_id_user",
        "uq_cycle_instances_id_user",
        "uq_jobs_scope_key",
        # 0003. Every bounded scheduler and repair query reads one of these; a
        # missing partial index turns a capped sweep into a table scan.
        "idx_users_next_due_at",
        "idx_users_unseeded_due",
        "idx_daily_readings_failed_generation",
        "idx_daily_readings_invalidated_repair",
        "idx_jobs_failed_result_class",
        # 0004. Privacy outbox/lease recovery, artifact expiry, deletion
        # receipts, and raw check-in retention must all remain bounded.
        "idx_jobs_privacy_undispatched",
        "idx_jobs_privacy_running_lease",
        "idx_export_requests_expiry",
        "uq_deletion_requests_receipt_hash",
        "idx_context_signals_retention",
        "uq_context_signals_usr06_current",
        "uq_context_signals_usr06_revision",
        "idx_context_signals_norm_evidence",
        # 0005. M4 feature-set convergence, receipt lookup/pruning, spend
        # bounds, and one-current USR-09 revision are database invariants.
        "uq_natal_feature_sets_policy",
        "idx_natal_features_feature_set",
        "uq_cycle_scan_receipts_lookup",
        "idx_cycle_scan_receipts_user_prune",
        "uq_time_travel_daily_usage_user_date",
        "uq_context_signals_usr09_current",
        "uq_context_signals_usr09_revision",
        "idx_pattern_erasure_replay_occurred",
        # 0016. Owner-scoped reservation pruning must not scan every user's
        # invocation ledger.
        "idx_birth_calc_reservations_user_date",
    ):
        if name not in indexes:
            raise SystemExit(f"Missing index {name}")
    print("D1 OK  partial and composite-parent indexes exist")

    columns = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    for name in ("timezone_source", "timezone_revision", "locale_source"):
        if name not in columns:
            raise SystemExit(f"users.{name} missing")
    if "next_due_at" not in columns:
        raise SystemExit("users.next_due_at missing")
    print("D1 OK  users carries timezone/locale provenance and a scheduling cursor")

    reading_columns = {r[1]: r for r in con.execute("PRAGMA table_info(daily_readings)")}
    if "invalidated_at" not in reading_columns:
        raise SystemExit("daily_readings.invalidated_at missing")
    # notnull is column 3 of PRAGMA table_info. A v5 reading has no editorial
    # release behind it, so NOT NULL would make the row unrepresentable.
    if reading_columns["release_version"][3] != 0:
        raise SystemExit("daily_readings.release_version is still NOT NULL")
    print("D1 OK  daily_readings carries invalidation and a nullable release")

    key_columns = {r[1]: r for r in con.execute("PRAGMA table_info(user_keys)")}
    if "erased_at" not in key_columns:
        raise SystemExit("user_keys.erased_at missing")
    if key_columns["wrapped_dek"][3] != 0:
        raise SystemExit("user_keys.wrapped_dek is still unconditionally NOT NULL")

    for table, required in {
        "export_requests": {
            "job_id", "wrapped_export_key", "export_key_nonce",
            "export_kek_version", "artifact_nonce", "object_size_bytes",
            "status_updated_at", "error_class", "artifact_deleted_at",
        },
        "deletion_requests": {
            "job_id", "receipt_hash", "receipt_expires_at", "checkpoint",
            "status_updated_at", "error_class", "artifact_manifest_json",
            "artifact_cleanup_until",
        },
        "context_signals": {
            "source_revision", "is_current", "retention_expires_at",
        },
    }.items():
        columns = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        missing_columns = required - columns
        if missing_columns:
            raise SystemExit(f"{table} missing columns {sorted(missing_columns)}")
    print("D1 OK  privacy workflow and check-in columns exist")

    # The M0 uniqueness key must be GONE: scoped by release_version, it allowed
    # two published readings for one user-day whenever a release activated
    # mid-day.
    ddl = con.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'daily_readings'"
    ).fetchone()[0]
    if "local_date, release_version" in ddl.replace("\n", " "):
        raise SystemExit("daily_readings still carries the M0 release-scoped uniqueness key")
    print("D1 OK  the release-scoped uniqueness key is gone")

    if con.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("foreign_key_check reported violations on a fresh database")
    if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("quick_check failed on a fresh database")
    if con.execute("SELECT * FROM assertion_probe").fetchall():
        raise SystemExit("assertion_probe was armed on a fresh database")
    print("D1 OK  foreign_key_check clean, quick_check ok")


def check_0004_over_populated_m5() -> None:
    """0004 preserves recovery keys and deterministically orders old USR-06 rows."""
    con = fresh(upto=3)
    seed_user(con, USER_A, SUBJ_A)
    con.executemany(
        "INSERT INTO user_keys "
        "(user_id, key_version, kek_version, wrapped_dek, created_at, destroyed_at) "
        "VALUES (?, ?, 3, ?, ?, ?)",
        (
            (USER_A, 1, b"retired", NOW, NOW),
            (USER_A, 2, b"live", NOW, None),
        ),
    )
    con.execute(
        "INSERT INTO consents "
        "(id, user_id, kind, status, source_id, permission_tier, allowed_uses_json, "
        "scopes_json, policy_version, version, created_at, updated_at) "
        "VALUES ('cns_usr06', ?, 'product_source', 'granted', 'USR-06', 1, "
        "'[\"theme_ranking\"]', '[]', '1.0.0', 1, ?, ?)",
        (USER_A, NOW, NOW),
    )
    for index, conflict in ((1, "none"), (2, "superseded"), (3, "none")):
        con.execute(
            "INSERT INTO context_signals "
            "(id, user_id, source_id, source_window, evidence_lane, allowed_uses_json, "
            "confidence, sensitivity, permission_state, conflict_status, consent_id, "
            "freshness_status, observed_at, ingested_at, value_encoding, value_json, "
            "labels_json, normalized_hash, created_at, updated_at) "
            "VALUES (?, ?, 'USR-06', '2026-08-11', 'user_and_context', "
            "'[\"theme_ranking\"]', 'user_confirmed', 'sensitive', 'active', ?, "
            "'cns_usr06', 'fresh', ?, ?, 'structured', '{}', '[]', ?, ?, ?)",
            (
                f"sig_usr06_{index}",
                USER_A,
                conflict,
                f"2026-08-11T0{index}:00:00Z",
                f"2026-08-11T0{index}:00:00Z",
                f"sha256:{index:064x}",
                NOW,
                NOW,
            ),
        )
    con.execute(
        "INSERT INTO context_signals "
        "(id, user_id, source_id, source_window, evidence_lane, allowed_uses_json, "
        "confidence, sensitivity, permission_state, freshness_status, observed_at, "
        "ingested_at, value_encoding, value_json, labels_json, normalized_hash, "
        "created_at, updated_at) "
        "VALUES ('sig_other', ?, 'USR-01', 'forever', 'user_and_context', "
        "'[\"theme_ranking\"]', 'user_confirmed', 'sensitive', 'active', 'fresh', "
        "?, ?, 'structured', '{}', '[]', ?, ?, ?)",
        (USER_A, NOW, NOW, f"sha256:{9:064x}", NOW, NOW),
    )
    con.commit()

    apply_migrations(con, start=4)

    keys = con.execute(
        "SELECT key_version, wrapped_dek, destroyed_at, erased_at "
        "FROM user_keys WHERE user_id = ? ORDER BY key_version",
        (USER_A,),
    ).fetchall()
    if len(keys) != 2 or any(row[1] is None or row[3] is not None for row in keys):
        raise SystemExit("0004 lost wrapped bytes or marked a pre-existing key erased")
    print("D1 OK  0004 preserves live and rotation-retired wrapped DEKs")

    revisions = con.execute(
        "SELECT source_revision, is_current FROM context_signals "
        "WHERE source_id = 'USR-06' ORDER BY observed_at, id"
    ).fetchall()
    if revisions != [(1, 0), (2, 0), (3, 1)]:
        raise SystemExit(f"USR-06 backfill was not deterministic: {revisions}")
    other_current = con.execute(
        "SELECT is_current FROM context_signals WHERE id = 'sig_other'"
    ).fetchone()[0]
    if other_current != 1:
        raise SystemExit("0004 changed current semantics for another source family")
    print("D1 OK  existing USR-06 rows gain ordered revisions and one current row")

    con.execute(
        "INSERT INTO user_keys "
        "(user_id, key_version, kek_version, wrapped_dek, created_at, destroyed_at, erased_at) "
        "VALUES (?, 3, 3, NULL, ?, ?, ?)",
        (USER_A, NOW, NOW, NOW),
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO user_keys "
            "(user_id, key_version, kek_version, wrapped_dek, created_at, destroyed_at) "
            "VALUES (?, 4, 3, NULL, ?, ?)",
            (USER_A, NOW, NOW),
        ),
        "rotation retirement cannot discard wrapped recovery bytes",
    )
    print("D1 OK  only deletion-erased keys may lose wrapped bytes")


def check_upgrade_over_populated_0001() -> None:
    con = fresh(upto=1)
    seed_user(con, USER_A, SUBJ_A)
    seed_job(con, "job_keep", USER_A, "daily:2026-07-30:initial:g1")
    seed_job(con, "job_system", None, "system-sweep-1")
    con.commit()

    apply_migrations(con)  # re-applies 0001 (no-op) then 0002

    kept = {r[0] for r in con.execute("SELECT id FROM jobs")}
    if kept != {"job_keep", "job_system"}:
        raise SystemExit(f"jobs lost rows across the rebuild: {kept}")
    print("D1 OK  0002 over a populated 0001 preserves job rows")

    columns = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
    for name in ("payload_enc", "dispatched_at", "claim_token", "lease_expires_at"):
        if name not in columns:
            raise SystemExit(f"jobs.{name} missing after upgrade")
    print("D1 OK  jobs gained encrypted command, outbox, and lease columns")

    source = con.execute(
        "SELECT timezone_source FROM users WHERE id = ?", (USER_A,)
    ).fetchone()[0]
    if source != "default_unconfirmed":
        raise SystemExit(f"existing user backfilled to {source!r}, not default_unconfirmed")
    print("D1 OK  an existing user's server-default zone backfills as unconfirmed")


def check_refuses_to_destroy_rows() -> None:
    con = fresh(upto=1)
    seed_user(con, USER_A, SUBJ_A)
    seed_release(con)
    con.execute(
        "INSERT INTO daily_readings (id, user_id, local_date, release_version, reading_key, "
        "chart_fingerprint, contract_id, assembly_mode, status, reading_enc, "
        "reading_key_version, reading_nonce, validation_json, created_at) "
        "VALUES ('rdg_x', ?, '2026-07-30', 'release-12', 'user:x:2026-07-30:release-12', "
        "'sha256:f', 'c', 'deterministic', 'published', X'00', 1, 'n', '{}', ?)",
        (USER_A, NOW),
    )
    con.commit()

    try:
        apply_migrations(con)
    except sqlite3.IntegrityError:
        pass
    else:
        raise SystemExit("0002 destroyed an unconvertible daily_readings row")

    # And the refusal must be atomic: the schema is untouched, not half-migrated.
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "cycle_passes" in tables:
        raise SystemExit("0002 left a partially applied schema after aborting")
    still = con.execute("SELECT COUNT(*) FROM daily_readings").fetchone()[0]
    if still != 1:
        raise SystemExit("the unconvertible row did not survive the aborted migration")
    print("D1 OK  0002 refuses to destroy unconvertible rows, and aborts atomically")


def check_revision_invariants() -> None:
    con = fresh()
    seed_user(con, USER_A, SUBJ_A)
    seed_release(con)

    insert_reading(con, "rdg_1", USER_A, "2026-07-30", "published")
    print("D1 OK  an initial published reading is accepted")

    expect_integrity_error(
        lambda: insert_reading(con, "rdg_2", USER_A, "2026-07-30", "published", revision=2,
                               reason="safety_correction", supersedes="rdg_1"),
        "at most one PUBLISHED reading per user per local day",
    )

    insert_reading(con, "rdg_2", USER_A, "2026-07-30", "pending", revision=2,
                   reason="safety_correction", supersedes="rdg_1")
    print("D1 OK  a pending successor may coexist with the live reading")

    expect_integrity_error(
        lambda: insert_reading(con, "rdg_3", USER_A, "2026-07-30", "pending", revision=3,
                               reason="defect_repair", supersedes="rdg_1"),
        "at most one PENDING reading per user per local day",
    )

    con.execute("UPDATE daily_readings SET status = 'failed' WHERE id = 'rdg_2'")
    expect_integrity_error(
        lambda: insert_reading(con, "rdg_3", USER_A, "2026-07-30", "pending", revision=3,
                               reason="defect_repair", supersedes="rdg_1"),
        "competing reissue chains cannot claim the same predecessor",
    )

    expect_integrity_error(
        lambda: insert_reading(con, "rdg_4", USER_A, "2026-07-31", "pending", revision=1,
                               reason="safety_correction", supersedes="rdg_1"),
        "revision 1 cannot have a predecessor",
    )
    expect_integrity_error(
        lambda: insert_reading(con, "rdg_5", USER_A, "2026-07-31", "pending", revision=2,
                               reason="initial", supersedes=None),
        "an initial reading cannot be revision 2",
    )

    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO daily_readings (id, user_id, local_date, release_version, reading_key, "
            "chart_fingerprint, contract_id, assembly_mode, status, created_at, updated_at) "
            "VALUES ('rdg_6', ?, '2026-08-01', 'release-12', 'k6', 'sha256:f', 'c', "
            "'deterministic', 'published', ?, ?)",
            (USER_A, NOW, NOW),
        ),
        "a published reading without ciphertext is rejected",
    )


def check_cross_user_links() -> None:
    con = fresh()
    seed_user(con, USER_A, SUBJ_A)
    seed_user(con, USER_B, SUBJ_B)
    seed_release(con)
    seed_job(con, "job_a", USER_A, "k-a")
    seed_job(con, "job_b", USER_B, "k-b")

    insert_reading(con, "rdg_a", USER_A, "2026-07-30", "pending", job="job_a")
    print("D1 OK  a reading may point at its own user's command")

    expect_integrity_error(
        lambda: insert_reading(con, "rdg_b", USER_A, "2026-07-31", "pending", job="job_b"),
        "a reading cannot point at another user's command",
    )

    # cycle_instances.chart_id references chart_snapshots, so seed the chain.
    con.execute(
        "INSERT INTO birth_profiles (user_id, version, accuracy, status, payload_enc, "
        "payload_key_version, payload_nonce, created_at, updated_at) "
        "VALUES (?, 1, 'exact', 'active', X'00', 1, 'n', ?, ?)",
        (USER_A, NOW, NOW),
    )
    con.execute(
        "INSERT INTO chart_snapshots (id, user_id, profile_version, fingerprint, contract_id, "
        "contract_version, container_digest, calculated_at, snapshot_json, birth_accuracy, "
        "birth_enc, birth_key_version, birth_nonce, uncertainty_json, created_at) "
        "VALUES ('cht_a', ?, 1, 'fp-a', 'c', '0.2.0', 'd', ?, '{}', 'exact', X'00', 1, 'n', '{}', ?)",
        (USER_A, NOW, NOW),
    )
    con.execute(
        "INSERT INTO cycle_instances (id, chart_id, user_id, technique, pass_count, cycle_json, "
        "created_at, updated_at) VALUES ('cyc_a', 'cht_a', ?, 'transit', 3, '{}', ?, ?)",
        (USER_A, NOW, NOW),
    )
    con.execute(
        "INSERT INTO cycle_passes (id, cycle_id, user_id, pass_index, direction, exact_at, "
        "speed_deg_per_day, created_at) VALUES ('cyp_1', 'cyc_a', ?, 1, 'direct', ?, 0.03, ?)",
        (USER_A, NOW, NOW),
    )
    print("D1 OK  a pass may be attached to its own user's cycle")

    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO cycle_passes (id, cycle_id, user_id, pass_index, direction, exact_at, "
            "speed_deg_per_day, created_at) VALUES ('cyp_2', 'cyc_a', ?, 2, 'retrograde', ?, -0.02, ?)",
            (USER_B, NOW, NOW),
        ),
        "a pass cannot be attached to another user's cycle",
    )

    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO reading_sources (id, reading_id, user_id, paragraph_id, paragraph_order, "
            "evidence_enc, evidence_key_version, evidence_nonce, created_at) "
            "VALUES ('rs_1', 'rdg_a', ?, 'p1', 1, X'00', 1, 'n', ?)",
            (USER_B, NOW),
        ),
        "evidence cannot be attached to another user's reading",
    )


def check_encrypted_command_requires_owner() -> None:
    con = fresh()
    seed_user(con, USER_A, SUBJ_A)
    con.execute(
        "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, payload_enc, "
        "payload_key_version, payload_nonce, attempts, created_at) "
        "VALUES ('job_enc', 'GenerateDailyReading', ?, 'k1', 'queued', X'00', 1, 'n', 0, ?)",
        (USER_A, NOW),
    )
    print("D1 OK  an encrypted command is accepted for an owning user")

    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, payload_enc, "
            "payload_key_version, payload_nonce, attempts, created_at) "
            "VALUES ('job_orphan', 'GenerateDailyReading', NULL, 'k2', 'queued', X'00', 1, 'n', 0, ?)",
            (NOW,),
        ),
        "an encrypted command without an owning user is rejected (rotation could never reach it)",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, payload_enc, "
            "attempts, created_at) "
            "VALUES ('job_half', 'GenerateDailyReading', ?, 'k3', 'queued', X'00', 0, ?)",
            (USER_A, NOW),
        ),
        "ciphertext without its key version and nonce is rejected",
    )


def check_assertion_primitive() -> None:
    con = fresh()
    # The runtime publication guard uses the same primitive as the migration:
    # an INSERT whose WHERE clause is false is a no-op, and one whose WHERE
    # clause is true aborts the enclosing transaction.
    con.execute(
        "INSERT INTO assertion_probe (id, reason) SELECT 1, 'never' WHERE 1 = 0"
    )
    if con.execute("SELECT COUNT(*) FROM assertion_probe").fetchone()[0] != 0:
        raise SystemExit("a false-guard assertion inserted a row")
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO assertion_probe (id, reason) SELECT 1, 'fired' WHERE 1 = 1"
        ),
        "a true-guard assertion aborts",
    )


def check_0003_over_empty_m3() -> None:
    """0003 upgrades a real M3 database whose reading tables happen to be empty.

    That is the measured production state the rollout gate proves before the
    migration is allowed to run: `daily_readings.release_version` is
    `NOT NULL REFERENCES content_releases(version)` and production has no
    content release, so it can hold no rows.
    """
    con = fresh(upto=2)
    seed_user(con, USER_A, SUBJ_A)
    seed_release(con)
    seed_job(con, "job_keep", USER_A, "daily:2026-07-30:initial:g1")
    con.commit()

    apply_migrations(con, start=3)

    kept = {r[0] for r in con.execute("SELECT id FROM jobs")}
    if kept != {"job_keep"}:
        raise SystemExit(f"0003 lost job rows: {kept}")
    releases = con.execute("SELECT COUNT(*) FROM content_releases").fetchone()[0]
    if releases != 1:
        raise SystemExit("0003 discarded the legacy content release catalogue")
    cursor = con.execute("SELECT next_due_at FROM users WHERE id = ?", (USER_A,)).fetchone()[0]
    if cursor is not None:
        raise SystemExit("an existing user backfilled to a scheduling cursor rather than null")
    print("D1 OK  0003 over an empty M3 preserves jobs, releases, and seeds a null cursor")

    if con.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("foreign_key_check reported violations after 0003")
    if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("quick_check failed after 0003")
    print("D1 OK  0003 leaves foreign keys and integrity clean")


def check_0003_refuses_dependent_rows() -> None:
    """A dependent reading row stops 0003 BEFORE either table is dropped.

    Those rows are AAD-bound ciphertext. Only an application layer holding the
    per-user DEK can re-shape them, so the migration refuses rather than
    discarding a reader's history.
    """
    for table, insert in (
        (
            "daily_readings",
            lambda con: insert_m3_reading(con, "rdg_x", USER_A, "2026-07-30"),
        ),
        (
            "reading_sources",
            lambda con: (
                insert_m3_reading(con, "rdg_y", USER_A, "2026-07-30"),
                con.execute(
                    "INSERT INTO reading_sources (id, reading_id, user_id, paragraph_id, "
                    "paragraph_order, evidence_enc, evidence_key_version, evidence_nonce, "
                    "created_at) VALUES ('rs_x', 'rdg_y', ?, 'p1', 1, X'00', 1, 'n', ?)",
                    (USER_A, NOW),
                ),
            ),
        ),
        (
            "reading_feedback",
            lambda con: (
                insert_m3_reading(con, "rdg_z", USER_A, "2026-07-30"),
                con.execute(
                    "INSERT INTO reading_feedback (id, reading_id, user_id, resonance, "
                    "created_at) VALUES ('fb_x', 'rdg_z', ?, 'helpful', ?)",
                    (USER_A, NOW),
                ),
            ),
        ),
    ):
        con = fresh(upto=2)
        seed_user(con, USER_A, SUBJ_A)
        seed_release(con)
        insert(con)
        con.commit()

        try:
            apply_migrations(con, start=3)
        except sqlite3.IntegrityError:
            pass
        else:
            raise SystemExit(f"0003 destroyed an unconvertible {table} row")

        columns = {r[1] for r in con.execute("PRAGMA table_info(daily_readings)")}
        if "invalidated_at" in columns:
            raise SystemExit("0003 left a partially applied schema after aborting")
        if con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != 1:
            raise SystemExit(f"the unconvertible {table} row did not survive the abort")
        print(f"D1 OK  0003 aborts before DROP when {table} holds a row")


def check_v5_reading_rows() -> None:
    con = fresh()
    seed_user(con, USER_A, SUBJ_A)
    seed_release(con)

    insert_reading(
        con, "rdg_v5", USER_A, "2026-07-30", "published",
        mode="constrained_model", release=None,
    )
    print("D1 OK  a constrained_model reading with no editorial release is accepted")

    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad1", USER_A, "2026-07-31", "pending",
            mode="constrained_model", release="release-12",
        ),
        "a constrained_model reading cannot carry an editorial release",
    )
    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad2", USER_A, "2026-08-01", "pending",
            mode="deterministic", release=None,
        ),
        "a deterministic reading still requires its editorial release",
    )
    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad3", USER_A, "2026-08-02", "pending",
            mode="constrained_model", release=None,
            reading_key=f"user:{USER_A}:2026-08-02:release-12:r1",
        ),
        "a v5 reading cannot borrow the legacy reading_key grammar",
    )
    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad4", USER_A, "2026-08-03", "pending",
            reading_key=f"reading-v5:{USER_A}:2026-08-03:r1",
        ),
        "a legacy reading cannot borrow the v5 reading_key namespace",
    )

    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad5", USER_A, "2026-08-04", "invalidated",
            mode="constrained_model", release=None,
        ),
        "an invalidated reading must record when it was invalidated",
    )
    expect_integrity_error(
        lambda: insert_reading(
            con, "rdg_bad6", USER_A, "2026-08-05", "published",
            mode="constrained_model", release=None, invalidated_at=NOW,
        ),
        "a live reading cannot carry an invalidation timestamp",
    )

    # The whole point of the state: it stops being live immediately, and its
    # successor may be reserved for the same user-day without violating the
    # one-live-reading index.
    con.execute(
        "UPDATE daily_readings SET status = 'invalidated', invalidated_at = ? WHERE id = 'rdg_v5'",
        (NOW,),
    )
    insert_reading(
        con, "rdg_v5b", USER_A, "2026-07-30", "pending", revision=2,
        reason="chart_recalculated", supersedes="rdg_v5",
        mode="constrained_model", release=None,
    )
    live = con.execute(
        "SELECT COUNT(*) FROM daily_readings WHERE user_id = ? AND local_date = '2026-07-30' "
        "AND status = 'published'",
        (USER_A,),
    ).fetchone()[0]
    if live != 0:
        raise SystemExit("an invalidated reading is still selected as live")
    still_sealed = con.execute(
        "SELECT reading_enc IS NOT NULL FROM daily_readings WHERE id = 'rdg_v5'"
    ).fetchone()[0]
    if not still_sealed:
        raise SystemExit("invalidation discarded the encrypted artifact")
    print("D1 OK  invalidation hides a reading from Today and preserves its ciphertext")


def check_provider_budget_table() -> None:
    con = fresh()
    con.execute(
        "INSERT INTO reading_provider_daily_usage (utc_date, used_calls, created_at, updated_at) "
        "VALUES ('2026-08-10', 0, ?, ?)",
        (NOW, NOW),
    )
    con.execute(
        "UPDATE reading_provider_daily_usage SET used_calls = used_calls + 1 "
        "WHERE utc_date = '2026-08-10'"
    )
    used = con.execute(
        "SELECT used_calls FROM reading_provider_daily_usage WHERE utc_date = '2026-08-10'"
    ).fetchone()[0]
    if used != 1:
        raise SystemExit("the provider call counter did not increment")

    columns = {r[1] for r in con.execute("PRAGMA table_info(reading_provider_daily_usage)")}
    if "user_id" in columns:
        raise SystemExit("the provider budget must not be keyed by user")
    expect_integrity_error(
        lambda: con.execute(
            "UPDATE reading_provider_daily_usage SET used_calls = -1 WHERE utc_date = '2026-08-10'"
        ),
        "a negative provider call count is rejected",
    )
    print("D1 OK  the UTC-day provider budget counts up from zero and never below it")


def check_0007_over_consent_references() -> None:
    """0007 rebuilds consents while child rows still name a consent.

    This is the state production is in, and the one an empty database cannot
    reach: `context_source_permissions.consent_id` and
    `context_signals.consent_id` are written non-null by the USR-06 check-in and
    product-source paths. FK enforcement is live inside the migration batch, so
    the rebuild has to carry those references across DROP TABLE consents rather
    than switch foreign keys off.
    """
    con = fresh(upto=6)
    seed_user(con, USER_A, SUBJ_A)
    con.execute(
        "INSERT INTO consents (id, user_id, kind, status, source_id, policy_version, "
        "granted_at, created_at, updated_at) "
        "VALUES ('cns_checkin', ?, 'product_source', 'granted', 'USR-06', 'v1', ?, ?, ?)",
        (USER_A, NOW, NOW, NOW),
    )
    con.execute(
        "INSERT INTO consents (id, user_id, kind, status, policy_version, "
        "granted_at, created_at, updated_at) "
        "VALUES ('cns_synth', ?, 'ai_synthesis', 'granted', 'v1', ?, ?, ?)",
        (USER_A, NOW, NOW, NOW),
    )
    con.execute(
        "INSERT INTO context_source_permissions (user_id, source_id, enabled, "
        "permission_state, permission_tier, consent_id, updated_at) "
        "VALUES (?, 'USR-06', 1, 'active', 1, 'cns_checkin', ?)",
        (USER_A, NOW),
    )
    con.execute(
        "INSERT INTO context_source_permissions (user_id, source_id, enabled, "
        "permission_state, permission_tier, consent_id, updated_at) "
        "VALUES (?, 'never_linked', 0, 'never_granted', 0, NULL, ?)",
        (USER_A, NOW),
    )
    insert_context_signal(con, "sig_linked", USER_A, "2026-08-01", "cns_synth")
    insert_context_signal(con, "sig_unlinked", USER_A, "2026-08-02", None)
    con.commit()

    apply_migrations(con, start=7)

    restored = con.execute(
        "SELECT source_id, consent_id FROM context_source_permissions "
        "WHERE user_id = ? ORDER BY source_id",
        (USER_A,),
    ).fetchall()
    if restored != [("USR-06", "cns_checkin"), ("never_linked", None)]:
        raise SystemExit(f"0007 lost context_source_permissions consent links: {restored}")
    signals = con.execute(
        "SELECT id, consent_id FROM context_signals WHERE user_id = ? ORDER BY id",
        (USER_A,),
    ).fetchall()
    if signals != [("sig_linked", "cns_synth"), ("sig_unlinked", None)]:
        raise SystemExit(f"0007 lost context_signals consent links: {signals}")
    kinds = con.execute("SELECT COUNT(*) FROM consents").fetchone()[0]
    if kinds != 2:
        raise SystemExit(f"0007 did not carry every consent row across the rebuild: {kinds}")
    if con.execute(
        "SELECT name FROM sqlite_master WHERE name = 'consents_ref_stash_m7'"
    ).fetchone():
        raise SystemExit("0007 left its reference stash table behind")
    if con.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("foreign_key_check reported violations after 0007")
    if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("quick_check failed after 0007")
    print("D1 OK  0007 rebuilds consents with live child references intact")


def check_0007_pattern_tables() -> None:
    con = sqlite3.connect(":memory:")
    apply_migrations(con)
    kinds = [
        row[0]
        for row in con.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'consents'"
        )
    ]
    assert kinds and "pattern_generation" in kinds[0], kinds
    for table in (
        "pattern_generation_claims",
        "pattern_generation_jobs",
        "pattern_documents",
        "pattern_generation_artifact_keys",
        "pattern_generation_artifacts",
        "pattern_admin_access_events",
        "pattern_ontology_releases",
        "pattern_ontology_pointer",
        "pattern_provider_daily_usage",
    ):
        row = con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        assert row, f"missing {table}"
    pointer = con.execute("SELECT id, active_version FROM pattern_ontology_pointer").fetchone()
    assert pointer == (1, None), pointer
    con.execute("PRAGMA foreign_key_check")
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    print("D1 OK  0007 admits pattern_generation and creates Pattern tables")


def check_0008_replay_ledger() -> None:
    con = sqlite3.connect(":memory:")
    apply_migrations(con)
    row = con.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ("pattern_erasure_replay_events",),
    ).fetchone()
    assert row, "missing pattern_erasure_replay_events"
    columns = {
        info[1]
        for info in con.execute("PRAGMA table_info(pattern_erasure_replay_events)")
    }
    assert "user_id" not in columns, columns
    assert "target_user_id" in columns, columns
    assert "signing_key_id" in columns, columns
    con.execute(
        "INSERT INTO pattern_erasure_replay_events ("
        "event_id, event_class, occurred_at, target_user_id, chart_fingerprint_hash, "
        "claim_id, generation_id, pattern_id, ontology_version, prior_claim_status, "
        "next_claim_status, content_hash, signing_key_id, signature, replica_put_at, created_at"
        ") VALUES ("
        "'prel_ffffffffffffffffffffffffffffffff', 'pattern_deleted', ?, "
        "'usr_0123456789abcdef0123456789abcdef', "
        "'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', "
        "'pgc_dddddddddddddddddddddddddddddddd', "
        "'pgen_cccccccccccccccccccccccccccccccc', "
        "'pat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', "
        "'1.0.0', 'accepted', 'deleted', "
        "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
        "'test-key', 'sig', ?, ?)",
        (NOW, NOW, NOW),
    )
    try:
        con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, next_claim_status, "
            "content_hash, signing_key_id, signature, replica_put_at, created_at"
            ") VALUES ("
            "'prel_11111111111111111111111111111111', 'pattern_deleted', ?, "
            "'available', "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?, ?)",
            (NOW, NOW, NOW),
        )
        raise SystemExit("0008 accepted next_claim_status=available")
    except sqlite3.IntegrityError:
        pass

    def insert_null_replay_status(marker: str, event_class: str) -> None:
        con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, target_user_id, chart_fingerprint_hash, "
            "claim_id, next_claim_status, content_hash, signing_key_id, signature, "
            "replica_put_at, created_at"
            ") VALUES (?, ?, ?, "
            "'usr_0123456789abcdef0123456789abcdef', "
            "'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', "
            "'pgc_dddddddddddddddddddddddddddddddd', NULL, "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?, ?)",
            (f"prel_{marker * 32}", event_class, NOW, NOW, NOW),
        )

    for marker, event_class in (
        ("4", "claim_consumed"),
        ("5", "pattern_deleted"),
        ("6", "chart_correction_erased"),
        ("7", "pattern_withdrawn"),
        ("8", "account_deleted"),
    ):
        expect_integrity_error(
            lambda marker=marker, event_class=event_class: insert_null_replay_status(
                marker, event_class
            ),
            f"0008 requires next_claim_status for {event_class}",
        )

    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, next_claim_status, "
            "content_hash, signing_key_id, signature, replica_put_at, created_at"
            ") VALUES ("
            "'prel_22222222222222222222222222222222', 'pattern_deleted', ?, "
            "'deleted', "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?, ?)",
            (NOW, NOW, NOW),
        ),
        "0008 requires target, fingerprint, and claim outside recall/account deletion",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, target_user_id, chart_fingerprint_hash, "
            "claim_id, next_claim_status, content_hash, signing_key_id, signature, "
            "replica_put_at, created_at"
            ") VALUES ("
            "'prel_33333333333333333333333333333333', 'pattern_deleted', ?, "
            "'usr_0123456789abcdef0123456789abcdef', "
            "'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', "
            "'pgc_dddddddddddddddddddddddddddddddd', 'withdrawn', "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?, ?)",
            (NOW, NOW, NOW),
        ),
        "0008 binds lifecycle event classes to their terminal status",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, target_user_id, chart_fingerprint_hash, "
            "claim_id, next_claim_status, content_hash, signing_key_id, signature, created_at"
            ") VALUES ("
            "'prel_99999999999999999999999999999999', 'pattern_deleted', ?, "
            "'usr_0123456789abcdef0123456789abcdef', "
            "'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', "
            "'pgc_dddddddddddddddddddddddddddddddd', 'deleted', "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?)",
            (NOW, NOW),
        ),
        "0008 requires proof that the R2 write-ahead succeeded",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO pattern_erasure_replay_events ("
            "event_id, event_class, occurred_at, next_claim_status, "
            "content_hash, signing_key_id, signature, replica_put_at, created_at"
            ") VALUES ("
            "'prel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ontology_recalled', ?, NULL, "
            "'sha256:0000000000000000000000000000000000000000000000000000000000000000', "
            "'test-key', 'sig', ?, ?)",
            (NOW, NOW, NOW),
        ),
        "0008 requires ontology_version on a recall tombstone",
    )
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    print("D1 OK  0008 creates a constrained erasure replay ledger")


def check_0016_over_populated_0015() -> None:
    con = fresh(upto=15)
    seed_user(con, USER_A, SUBJ_A)
    seed_user(con, USER_B, SUBJ_B)
    profiles_before = [
        (USER_A, 7, "unknown", "invalid", NOW, NOW),
        (USER_B, 41, "unknown", "invalid", NOW, NOW),
    ]
    con.executemany(
        "INSERT INTO birth_profiles "
        "(user_id, version, accuracy, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        profiles_before,
    )
    con.commit()

    apply_migrations(con, start=16)

    assert_birth_calc_schema(con, "populated apply")
    profiles_after = con.execute(
        "SELECT user_id, version, accuracy, status, created_at, updated_at "
        "FROM birth_profiles ORDER BY user_id"
    ).fetchall()
    if profiles_after != profiles_before:
        raise SystemExit(
            f"0016 changed populated birth profiles: {profiles_after}"
        )
    for table in (
        "birth_calc_daily_usage",
        "birth_calc_reservations",
        "birth_profile_version_counters",
    ):
        if con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != 0:
            raise SystemExit(f"0016 invented rows in {table}")

    digest = "sha256:" + ("a" * 64)
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO birth_calc_daily_usage "
            "(user_id, utc_date, reserved_calc_count, last_reservation_hash, "
            "created_at, updated_at) VALUES (?, '2026-08-27', 51, ?, ?, ?)",
            (USER_A, digest, NOW, NOW),
        ),
        "0016 caps a user's daily birth calculation reservations at 50",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO birth_calc_reservations "
            "(user_id, reservation_hash, utc_date, claim_token_hash, status, "
            "created_at, charged_at) "
            "VALUES (?, ?, '2026-08-27', ?, 'charged', ?, NULL)",
            (USER_A, digest, digest, NOW),
        ),
        "0016 charged reservations require charged_at",
    )
    expect_integrity_error(
        lambda: con.execute(
            "INSERT INTO birth_profile_version_counters "
            "(user_id, last_allocated_version, updated_at) VALUES (?, -1, ?)",
            (USER_A, NOW),
        ),
        "0016 rejects a negative profile version counter",
    )

    if con.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("0016 populated apply left foreign-key violations")
    if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("0016 populated apply failed quick_check")
    if con.execute("SELECT * FROM assertion_probe").fetchall():
        raise SystemExit("0016 populated apply left assertion_probe armed")
    print(
        "D1 OK  0016 populated apply preserves profiles, enforces constraints, "
        "and leaves integrity clean"
    )


def main() -> int:
    check_fresh_schema()
    check_0004_over_populated_m5()
    check_upgrade_over_populated_0001()
    check_refuses_to_destroy_rows()
    check_0003_over_empty_m3()
    check_0003_refuses_dependent_rows()
    check_v5_reading_rows()
    check_provider_budget_table()
    check_0007_pattern_tables()
    check_0007_over_consent_references()
    check_0008_replay_ledger()
    check_0016_over_populated_0015()
    check_revision_invariants()
    check_cross_user_links()
    check_encrypted_command_requires_owner()
    check_assertion_primitive()
    print("\nMigration smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
