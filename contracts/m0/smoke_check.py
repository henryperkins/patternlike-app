#!/usr/bin/env python3
"""Smoke-check D1 SQL apply + optional OpenAPI validation."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def check_sql() -> None:
    sql_path = ROOT / "db" / "d1" / "0001_m0_core.sql"
    sql = sql_path.read_text(encoding="utf-8")
    con = sqlite3.connect(":memory:")
    con.executescript(sql)
    tables = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    ]
    print(f"D1 OK  {len(tables)} tables")
    for t in tables:
        print(f"  - {t}")
    expected = {
        "users",
        "user_keys",
        "identities",
        "sessions",
        "consents",
        "context_source_permissions",
        "birth_profiles",
        "chart_snapshots",
        "natal_features",
        "cycle_instances",
        "context_signals",
        "content_releases",
        "content_release_pointer",
        "daily_readings",
        "reading_sources",
        "reading_feedback",
        "connector_accounts",
        "device_tokens",
        "jobs",
        "audit_events",
        "export_requests",
        "deletion_requests",
    }
    missing = expected - set(tables)
    if missing:
        raise SystemExit(f"Missing tables: {sorted(missing)}")

    # Identity shape constraints (spec 0.2: opaque, non-derived, colon-free)
    def insert_user(uid, subject):
        con.execute(
            "INSERT INTO users (id, crypto_subject, status, locale, timezone, "
            "entitlement_tier, created_at, updated_at) "
            "VALUES (?, ?, 'active', 'en-US', 'UTC', 'free', "
            "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            (uid, subject),
        )

    insert_user("usr_0123456789abcdef0123456789abcdef", "cs_0123456789abcdef0123456789abcdef")
    print("D1 OK  users accepts a well-formed usr_/cs_ pair")

    for bad_id, why in [
        ("auth0|abcdef12", "an IdP subject is not an opaque usr_ id"),
        ("usr:0123456789abcdef", "':' collides with reading_key's delimiter"),
        ("0123456789abcdef", "missing the usr_ prefix"),
    ]:
        try:
            insert_user(bad_id, f"cs_{bad_id}")
            raise SystemExit(f"users.id CHECK accepted {bad_id!r}: {why}")
        except sqlite3.IntegrityError:
            pass
    print("D1 OK  users.id CHECK rejects derived, colon-bearing, and unprefixed ids")

    try:
        insert_user("usr_ffffffffffffffffffffffffffffffff", "not_a_crypto_subject")
        raise SystemExit("users.crypto_subject CHECK accepted a non-cs_ value")
    except sqlite3.IntegrityError:
        print("D1 OK  users.crypto_subject CHECK requires the cs_ prefix")

    # One crypto subject per user, forever
    try:
        insert_user("usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "cs_0123456789abcdef0123456789abcdef")
        raise SystemExit("crypto_subject is not UNIQUE across users")
    except sqlite3.IntegrityError:
        print("D1 OK  crypto_subject is unique across users")

    # Sessions store a hash, never a token, and one hash maps to one session
    con.execute(
        "INSERT INTO sessions (id, user_id, token_sha256, created_at, expires_at) "
        "VALUES ('ses_a', 'usr_0123456789abcdef0123456789abcdef', 'hash-a', "
        "'2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO sessions (id, user_id, token_sha256, created_at, expires_at) "
            "VALUES ('ses_b', 'usr_0123456789abcdef0123456789abcdef', 'hash-a', "
            "'2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
        )
        raise SystemExit("sessions.token_sha256 is not UNIQUE")
    except sqlite3.IntegrityError:
        print("D1 OK  sessions.token_sha256 is unique")

    # Encryption / pairing CHECKs (should fail closed)
    insert_user(
        "usr_t0000000000000000000000000000", "cs_t0000000000000000000000000000000"
    )
    try:
        con.execute(
            "INSERT INTO birth_profiles (user_id, version, accuracy, status, created_at, updated_at) "
            "VALUES ('usr_t0000000000000000000000000000', 1, 'exact', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        raise SystemExit("CHECK failed: active birth_profiles without ciphertext should be rejected")
    except sqlite3.IntegrityError:
        print("D1 OK  birth_profiles encryption CHECK rejects cleartext active row")

    try:
        con.execute(
            "INSERT INTO content_releases "
            "(version, bundle_hash, status, approver_id, last_author_id, changelog, created_at) "
            "VALUES ('r1', 'h1', 'submitted', 'same', 'same', 'c', '2026-01-01T00:00:00Z')"
        )
        raise SystemExit("CHECK failed: same approver/author should be rejected")
    except sqlite3.IntegrityError:
        print("D1 OK  content_releases dual-control CHECK rejects same approver/author")

    # Idempotency keys must be per-user, not a global namespace (review: critical)
    insert_user(
        "usr_b0000000000000000000000000000", "cs_b0000000000000000000000000000000"
    )
    con.execute(
        "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
        "VALUES ('job_a', 'NormalizeBirthAndCalculateChart', 'usr_t0000000000000000000000000000', 'shared-key-001', 'succeeded', 1, "
        "'2026-01-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
            "VALUES ('job_b', 'NormalizeBirthAndCalculateChart', 'usr_b0000000000000000000000000000', 'shared-key-001', 'queued', 1, "
            "'2026-01-01T00:00:00Z')"
        )
        print("D1 OK  jobs idempotency_key is scoped per user")
    except sqlite3.IntegrityError as exc:
        raise SystemExit(
            f"jobs idempotency_key is a global namespace across users: {exc}"
        )

    try:
        con.execute(
            "INSERT INTO jobs (id, job_type, user_id, idempotency_key, status, attempts, created_at) "
            "VALUES ('job_c', 'NormalizeBirthAndCalculateChart', 'usr_t0000000000000000000000000000', 'shared-key-001', 'queued', 1, "
            "'2026-01-01T00:00:00Z')"
        )
        raise SystemExit("jobs must still reject a duplicate key for the SAME user")
    except sqlite3.IntegrityError:
        print("D1 OK  jobs still rejects a duplicate key for the same user")

    for table, extra_cols, extra_vals in (
        ("export_requests", "", ""),
        ("deletion_requests", "", ""),
    ):
        con.execute(
            f"INSERT INTO {table} (id, user_id, status, idempotency_key, created_at{extra_cols}) "
            f"VALUES ('{table}_a', 'usr_t0000000000000000000000000000', 'queued', 'shared-key-002', "
            f"'2026-01-01T00:00:00Z'{extra_vals})"
        )
        try:
            con.execute(
                f"INSERT INTO {table} (id, user_id, status, idempotency_key, created_at{extra_cols}) "
                f"VALUES ('{table}_b', 'usr_b0000000000000000000000000000', 'queued', 'shared-key-002', "
                f"'2026-01-01T00:00:00Z'{extra_vals})"
            )
            print(f"D1 OK  {table} idempotency_key is scoped per user")
        except sqlite3.IntegrityError as exc:
            raise SystemExit(f"{table} idempotency_key is global across users: {exc}")

    # A destroyed key must not block re-keying (review: permanent 500)
    con.execute(
        "INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at, destroyed_at) "
        "VALUES ('usr_t0000000000000000000000000000', 1, 2, X'00', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')"
    )
    try:
        con.execute(
            "INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at) "
            "VALUES ('usr_t0000000000000000000000000000', 2, 2, X'01', '2026-02-01T00:00:00Z')"
        )
        print("D1 OK  user_keys supports rotation after destruction")
    except sqlite3.IntegrityError as exc:
        raise SystemExit(f"user_keys cannot rotate after destruction: {exc}")

    try:
        con.execute(
            "INSERT INTO user_keys (user_id, key_version, kek_version, wrapped_dek, created_at) "
            "VALUES ('usr_t0000000000000000000000000000', 3, 2, X'02', '2026-03-01T00:00:00Z')"
        )
        raise SystemExit("user_keys must allow at most one live key per user")
    except sqlite3.IntegrityError:
        print("D1 OK  user_keys allows at most one live key per user")


def check_openapi() -> None:
    try:
        import yaml
        from openapi_spec_validator import validate
    except ImportError:
        print("OpenAPI SKIP (install openapi-spec-validator pyyaml to enable)")
        return
    path = ROOT / "contracts" / "m0" / "openapi" / "openapi.yaml"
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    validate(spec)
    print(f"OpenAPI OK  v{spec['info']['version']}  paths={len(spec['paths'])}")


def main() -> int:
    check_sql()
    check_openapi()
    print("Smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
