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


def apply_migrations(con: sqlite3.Connection, upto: int | None = None) -> None:
    """Apply each migration as ONE transaction, as D1's batch() does.

    That is what makes the abort assertions meaningful: a failure must roll the
    whole migration back rather than leave a half-converted schema.
    """
    con.execute("PRAGMA foreign_keys = ON")
    for path in migration_files():
        number = int(path.name.split("_")[0])
        if upto is not None and number > upto:
            continue
        statements = split_statements(path.read_text(encoding="utf-8"))
        try:
            con.execute("BEGIN")
            for statement in statements:
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
) -> None:
    enc = (b"\x00", 1, "nonce") if status == "published" else (None, None, None)
    con.execute(
        "INSERT INTO daily_readings (id, user_id, local_date, release_version, reading_key, "
        "chart_fingerprint, contract_id, assembly_mode, status, revision, revision_reason, "
        "supersedes_reading_id, command_generation, active_generation_job_id, "
        "reading_enc, reading_key_version, reading_nonce, created_at, updated_at) "
        "VALUES (?, ?, ?, 'release-12', ?, 'sha256:f', 'c', 'deterministic', ?, ?, ?, ?, 1, ?, "
        "?, ?, ?, ?, ?)",
        (
            rid, uid, date, f"user:{uid}:{date}:release-12:r{revision}",
            status, revision, reason, supersedes, job, *enc, NOW, NOW,
        ),
    )


def expect_integrity_error(fn, what: str) -> None:
    try:
        fn()
    except sqlite3.IntegrityError:
        print(f"D1 OK  {what}")
        return
    raise SystemExit(f"FAILED: {what} was allowed")


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
    }
    missing = expected - tables
    if missing:
        raise SystemExit(f"Missing tables after 0002: {sorted(missing)}")
    print(f"D1 OK  fresh apply of {len(migration_files())} migration(s), {len(tables)} tables")

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
    ):
        if name not in indexes:
            raise SystemExit(f"Missing index {name}")
    print("D1 OK  partial and composite-parent indexes exist")

    columns = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    for name in ("timezone_source", "timezone_revision", "locale_source"):
        if name not in columns:
            raise SystemExit(f"users.{name} missing")
    print("D1 OK  users carries timezone/locale provenance")

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
    print("D1 OK  foreign_key_check clean, quick_check ok")


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


def main() -> int:
    check_fresh_schema()
    check_upgrade_over_populated_0001()
    check_refuses_to_destroy_rows()
    check_revision_invariants()
    check_cross_user_links()
    check_encrypted_command_requires_owner()
    check_assertion_primitive()
    print("\nMigration smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
