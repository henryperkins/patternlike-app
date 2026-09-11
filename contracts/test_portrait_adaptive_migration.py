#!/usr/bin/env python3
"""Populated 0033 regression, using SQLite with foreign keys ON throughout.

Run: python contracts/test_portrait_adaptive_migration.py
Uses the real ordered migrations through 0032 and real encrypted-source columns.
No provider, remote D1, or external Python dependencies are involved.
"""

from __future__ import annotations

import sqlite3
import unittest

from smoke_check import MIGRATIONS, fresh, seed_user, split_statements

NOW = "2026-09-11T12:00:00.000Z"
LATER = "2026-09-11T12:05:00.000Z"
HASH = "sha256:" + "ab" * 32
SQL = (MIGRATIONS / "0033_adaptive_portrait_artwork.sql").read_text(encoding="utf-8")
TABLES = (
    "pattern_portraits", "portrait_automation_grants", "pattern_portrait_jobs",
    "portrait_mesh_jobs", "pattern_portrait_assets", "portrait_mesh_assets",
    "portrait_start_outbox",
)


def insert(con: sqlite3.Connection, table: str, **values: object) -> None:
    con.execute(
        f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
        tuple(values.values()),
    )


def apply(con: sqlite3.Connection, *, fail_after: int | None = None, fail_commit: bool = False) -> None:
    con.commit()
    con.execute("BEGIN")
    try:
        for index, statement in enumerate(split_statements(SQL)):
            con.execute(statement)
            if index == fail_after:
                # Simulate a rejected migration statement after arbitrary DDL.
                con.execute("INSERT INTO assertion_probe(id, reason) VALUES (1, 'injected failure')")
        if fail_commit:
            # The deferred FK failure must reject COMMIT and restore original DDL.
            con.execute("UPDATE portrait_start_outbox SET grant_id='absent-grant'")
        con.commit()
    except Exception:
        con.rollback()
        raise


def snapshot(con: sqlite3.Connection) -> dict[str, tuple[list[str], list[tuple]]]:
    return {
        table: (
            [row[1] for row in con.execute(f'PRAGMA table_info("{table}")')],
            con.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall(),
        )
        for (table,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        if not table.startswith("sqlite_")
    }


def seed(con: sqlite3.Connection, number: int, status: str = "pending") -> str:
    """One exact source, grant, outbox, leased/terminal image and mesh per owner."""
    key = str(number)
    user = "usr_" + f"{number:032x}"
    seed_user(con, user, "cs_" + f"{number:032x}")
    for kind in ("account_processing", "pattern_generation"):
        insert(con, "consents", id=kind + key, user_id=user, kind=kind,
               status="granted", policy_version="1.0.0", created_at=NOW, updated_at=NOW)
    insert(con, "birth_profiles", user_id=user, version=1, accuracy="exact", status="active",
           payload_enc=b"\x00\xfeencrypted birth" + key.encode(), payload_key_version=1,
           payload_nonce="birth-nonce", created_at=NOW, updated_at=NOW)
    insert(con, "chart_snapshots", id="chart" + key, user_id=user, profile_version=1,
           fingerprint=HASH, contract_id="chart/v1", contract_version="1.0.0",
           container_digest=HASH, calculated_at=NOW, snapshot_json="{}", birth_accuracy="exact",
           birth_enc=b"\x00\xffbirth" + key.encode(), birth_key_version=1, birth_nonce="nonce",
           uncertainty_json="{}", created_at=NOW)
    insert(con, "jobs", id="job" + key, user_id=user, job_type="generate_pattern",
           idempotency_key="idem" + key, status="succeeded", payload_enc=b"\xfecommand",
           payload_key_version=1, payload_nonce="nonce", attempts=1, finished_at=NOW, created_at=NOW)
    insert(con, "pattern_generation_claims", id="claim" + key, user_id=user,
           chart_fingerprint_hash=HASH, last_chart_id="chart" + key, status="accepted",
           consumed_at=NOW, accepted_at=NOW, created_at=NOW, updated_at=NOW)
    insert(con, "pattern_generation_jobs", generation_id="generation" + key, job_id="job" + key,
           user_id=user, claim_id="claim" + key, chart_id="chart" + key,
           chart_fingerprint_hash=HASH, feature_set_id="facts", feature_set_hash=HASH,
           feature_policy_version="1.0.0", selection_policy_version="1.0.0", locale="en-US",
           locale_revision=1, consent_id="pattern_generation" + key, consent_policy_version="1.1.0",
           ontology_version="ontology", ontology_bundle_hash=HASH, corpus_release_hash=HASH,
           pattern_source_hash=HASH, reservation_reason="first_open", stage="succeeded",
           created_at=NOW, updated_at=NOW)
    # Grant exists when the real publication trigger runs; the outbox FK is populated.
    insert(con, "portrait_automation_grants", id="grant" + key, user_id=user,
           chart_id="chart" + key, chart_fingerprint_hash=HASH, policy_version="1.1.0",
           enabled=1, created_at=NOW, updated_at=NOW)
    insert(con, "pattern_documents", id="pattern" + key, user_id=user, claim_id="claim" + key,
           generation_id="generation" + key, chart_fingerprint_hash=HASH,
           ontology_version="ontology", ontology_bundle_hash=HASH, locale="en-US", effective_accuracy="exact",
           document_enc=b"\x00\xffencrypted document" + key.encode(), document_nonce="document-nonce",
           wrapped_document_key_enc=b"\x80\xffwrapped key", wrapped_document_key_version=1,
           wrapped_document_key_nonce="key-nonce", content_hash=HASH, compact_provenance_json="{}",
           pattern_source_hash=HASH, generated_at=NOW, created_at=NOW)
    parent_status = {"complete": "ready", "failed": "failed", "cancelled": "cancelled"}.get(status, "generating")
    insert(con, "pattern_portraits", id=key, user_id=user, pattern_id="pattern" + key,
           generation_id="generation" + key, chart_id="chart" + key, chart_fingerprint_hash=HASH,
           document_revision="revision" + key, document_hash=HASH, generated_at=NOW,
           ontology_version="ontology", processing_consent_id="account_processing" + key,
           pattern_consent_id="pattern_generation" + key, consent_policy_version="1.0.0",
           status=parent_status, graph_asset_id="graph" + key if status == "complete" else None,
           checked_at=LATER, created_at=NOW, updated_at=LATER)
    common = dict(portrait_id=key, user_id=user, chapter_index=0, status=status,
                  attempts=2 if status != "pending" else 0,
                  lease_hash="lease" + key if status == "running" else None,
                  lease_expires_at=LATER if status == "running" else None,
                  retry_at=LATER, failure_code="provider_failed" if status == "failed" else None,
                  completion_hash="completion" + key if status == "complete" else None,
                  completed_at=NOW if status == "complete" else None, created_at=NOW, updated_at=LATER)
    insert(con, "pattern_portrait_jobs", **common, id="imagejob" + key, source_sha256=HASH,
           image_asset_id="image" + key if status == "complete" else None,
           sample_asset_id="sample" + key if status == "complete" else None)
    insert(con, "portrait_mesh_jobs", **common, id="meshjob" + key, grant_id="grant" + key,
           image_asset_id="image" + key, processing_consent_id="account_processing" + key,
           pattern_consent_id="pattern_generation" + key, source_text_sha256=HASH,
           source_image_sha256=HASH, document_revision="revision" + key, compiler_version="compiler-v1",
           model_asset_id="model" + key if status == "complete" else None,
           provenance_asset_id="provenance" + key if status == "complete" else None)
    # Complete assets, cancelled inventory and orphaned prior-attempt inventory.
    for table, roles, prefix, job in (
        ("pattern_portrait_assets", ("image", "sample", "graph"), "pattern-portraits", "imagejob"),
        ("portrait_mesh_assets", ("model", "provenance"), "portrait-meshes", "meshjob"),
    ):
        for role in roles:
            insert(con, table, id=role + key, portrait_id=key, user_id=user,
                   job_id=None if role == "graph" else job + key, role=role,
                   object_key=f"{prefix}/{key}/{role}/encrypted", plaintext_sha256=HASH,
                   byte_length=1024, created_at=NOW,
                   cleanup_at=NOW if status == "cancelled" else None,
                   deleted_at=LATER if status == "cancelled" and role == "sample" else None)
    con.commit()
    return key


def clone_parent(con: sqlite3.Connection, key: str, count: object, protocol: str = "v2", policy: str = "2.0.0") -> None:
    columns = [r[1] for r in con.execute("PRAGMA table_info(pattern_portraits)")]
    values = dict(zip(columns, con.execute("SELECT * FROM pattern_portraits WHERE id='1'").fetchone()))
    values.update(id=key, pattern_id="new-pattern" + key, chapter_count=count,
                  protocol_version=protocol, consent_policy_version=policy)
    insert(con, "pattern_portraits", **values)


def clone_job(con: sqlite3.Connection, table: str, key: str, parent: str, index: object) -> None:
    columns = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
    values = dict(zip(columns, con.execute(f"SELECT * FROM {table} ORDER BY id LIMIT 1").fetchone()))
    values.update(id=key, portrait_id=parent, chapter_index=index)
    insert(con, table, **values)


class AdaptiveMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.con = fresh(upto=32)
        self.addCleanup(self.con.close)
        for number, status in enumerate(("pending", "running", "complete", "failed", "cancelled"), 1):
            seed(self.con, number, status)

    def assert_integrity(self) -> None:
        self.assertEqual(self.con.execute("PRAGMA foreign_keys").fetchone(), (1,))
        self.assertEqual(self.con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.con.execute("PRAGMA quick_check").fetchall(), [("ok",)])
        self.assertEqual(self.con.execute("SELECT * FROM assertion_probe").fetchall(), [])

    def test_exact_populated_identity_and_schema_closure(self) -> None:
        before = snapshot(self.con)
        objects = self.con.execute("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").fetchall()
        fks = {table: self.con.execute(f"PRAGMA foreign_key_list({table})").fetchall() for table in TABLES}
        apply(self.con)
        for table, (columns, rows) in before.items():
            with self.subTest(table=table):
                self.assertEqual(self.con.execute(f'SELECT {", ".join(columns)} FROM "{table}" ORDER BY rowid').fetchall(), rows)
        for kind, name, sql in objects:
            self.assertEqual(self.con.execute("SELECT sql FROM sqlite_master WHERE type=? AND name=?", (kind, name)).fetchone(), (sql,))
        for table, refs in fks.items():
            self.assertEqual(self.con.execute(f"PRAGMA foreign_key_list({table})").fetchall(), refs)
        self.assertEqual(self.con.execute("SELECT DISTINCT chapter_count,protocol_version FROM pattern_portraits").fetchall(), [(4, "v1")])
        self.assertEqual(self.con.execute("SELECT DISTINCT policy_version FROM portrait_automation_grants").fetchall(), [("1.1.0",)])
        self.assertFalse(self.con.execute("SELECT name FROM sqlite_master WHERE name LIKE '%adaptive_new%'").fetchall())
        self.assert_integrity()

    def test_count_protocol_policy_and_indices(self) -> None:
        apply(self.con)
        for count in (3, 4, 5, 6):
            clone_parent(self.con, "v2-" + str(count), count)
            for table in ("pattern_portrait_jobs", "portrait_mesh_jobs"):
                for index in range(count):
                    clone_job(self.con, table, f"{table}-{count}-{index}", "v2-" + str(count), index)
                for index in (-1, count, 6, 0.5):
                    with self.subTest(table=table, count=count, index=index), self.assertRaises(sqlite3.IntegrityError):
                        clone_job(self.con, table, "bad", "v2-" + str(count), index)
                with self.assertRaises(sqlite3.IntegrityError):
                    self.con.execute(f"UPDATE {table} SET chapter_index=? WHERE id=?", (count, f"{table}-{count}-0"))
                with self.assertRaises(sqlite3.IntegrityError):
                    clone_job(self.con, table, "bad", "1", 4)
                with self.assertRaises(sqlite3.IntegrityError):
                    clone_job(self.con, table, "bad", "absent", 0)
        for count in (None, 0, 2, 7, 3.5, "invalid"):
            with self.subTest(count=count), self.assertRaises(sqlite3.IntegrityError):
                clone_parent(self.con, "bad", count)
        for count, protocol, policy in ((3, "v1", "1.0.0"), (4, "v1", "2.0.0"), (4, "v2", "1.0.0"), (4, "v3", "2.0.0")):
            with self.assertRaises(sqlite3.IntegrityError):
                clone_parent(self.con, "bad", count, protocol, policy)
        for update in ("chapter_count=5", "protocol_version='v2',consent_policy_version='2.0.0'", "chapter_count=NULL"):
            with self.assertRaises(sqlite3.IntegrityError):
                self.con.execute("UPDATE pattern_portraits SET " + update + " WHERE id='1'")
        self.con.execute("UPDATE pattern_portraits SET chapter_count=4,protocol_version='v1' WHERE id='1'")
        for table in ("pattern_portrait_jobs", "portrait_mesh_jobs"):
            with self.assertRaises(sqlite3.IntegrityError):
                self.con.execute(f"UPDATE {table} SET portrait_id='1' WHERE id=?", (f"{table}-6-5",))
        self.con.execute("UPDATE portrait_automation_grants SET enabled=0 WHERE id='grant1'")
        insert(self.con, "portrait_automation_grants", id="explicit-v2", user_id="usr_" + f"{1:032x}",
               chart_id="chart1", chart_fingerprint_hash=HASH, policy_version="2.0.0", enabled=1, created_at=NOW, updated_at=NOW)
        self.assertEqual(self.con.execute("SELECT policy_version FROM portrait_automation_grants WHERE id='grant1'").fetchone(), ("1.1.0",))
        self.assert_integrity()

    def assert_cancelled(self, key: str) -> None:
        for table in ("pattern_portrait_jobs", "portrait_mesh_jobs"):
            self.assertEqual(self.con.execute(f"SELECT status,lease_hash,lease_expires_at FROM {table} WHERE portrait_id=?", (key,)).fetchall(), [("cancelled", None, None)])
        for table in ("pattern_portrait_assets", "portrait_mesh_assets"):
            self.assertEqual(self.con.execute(f"SELECT COUNT(*) FROM {table} WHERE portrait_id=? AND cleanup_at IS NULL", (key,)).fetchone(), (0,))
        self.assert_integrity()

    def test_parent_cancel_and_document_erasure_cleanup(self) -> None:
        apply(self.con)
        self.con.execute("UPDATE pattern_portraits SET status='cancelled' WHERE id='2'")
        self.assert_cancelled("2")
        # Erasure invalidates accepted assets too and keeps inventory for R2 cleanup.
        self.con.execute("DELETE FROM pattern_documents WHERE id='pattern3'")
        self.assert_cancelled("3")
        self.assertEqual(self.con.execute("SELECT status,graph_asset_id FROM pattern_portraits WHERE id='3'").fetchone(), ("cancelled", None))
        self.assertEqual(self.con.execute("SELECT status FROM portrait_start_outbox WHERE pattern_id='pattern3'").fetchone(), ("cancelled",))
        self.assertEqual(self.con.execute("SELECT cleanup_at,deleted_at FROM pattern_portrait_assets WHERE id='sample5'").fetchone(), (NOW, LATER))

    def test_consent_insert_update_and_account_fences(self) -> None:
        apply(self.con)
        insert(self.con, "consents", id="revoked-new", user_id="usr_" + f"{2:032x}",
               kind="pattern_generation", status="revoked", policy_version="1.0.0", created_at=NOW, updated_at=NOW)
        self.assert_cancelled("2")
        self.con.execute("UPDATE consents SET status='revoked' WHERE id='account_processing1'")
        self.assert_cancelled("1")
        for key in ("1", "2"):
            self.assertEqual(self.con.execute("SELECT enabled FROM portrait_automation_grants WHERE id=?", ("grant" + key,)).fetchone(), (0,))
            self.assertEqual(self.con.execute("SELECT status FROM portrait_start_outbox WHERE pattern_id=?", ("pattern" + key,)).fetchone(), ("cancelled",))
        # Consent revocation retains already accepted artwork.
        self.con.execute("UPDATE consents SET status='revoked' WHERE id='pattern_generation3'")
        self.assertEqual(self.con.execute("SELECT status,graph_asset_id FROM pattern_portraits WHERE id='3'").fetchone(), ("ready", "graph3"))
        self.assertEqual(self.con.execute("SELECT status FROM portrait_mesh_jobs WHERE portrait_id='3'").fetchone(), ("complete",))
        for key, status in (("3", "pending_deletion"), ("4", "deleted")):
            self.con.execute("UPDATE users SET status=? WHERE id=?", (status, "usr_" + f"{int(key):032x}"))
            self.assert_cancelled(key)
            self.assertEqual(self.con.execute("SELECT enabled FROM portrait_automation_grants WHERE id=?", ("grant" + key,)).fetchone(), (0,))

    def test_withdrawal_publication_and_runtime_capture(self) -> None:
        apply(self.con)
        self.con.execute("UPDATE portrait_automation_grants SET enabled=0 WHERE id='grant2'")
        self.assertEqual(self.con.execute("SELECT status FROM pattern_portraits WHERE id='2'").fetchone(), ("failed",))
        self.assertEqual(self.con.execute("SELECT status FROM portrait_start_outbox WHERE pattern_id='pattern2'").fetchone(), ("cancelled",))
        for table in ("pattern_portrait_jobs", "portrait_mesh_jobs"):
            self.assertEqual(self.con.execute(f"SELECT status,lease_hash,lease_expires_at FROM {table} WHERE portrait_id='2'").fetchone(), ("cancelled", None, None))
        self.con.execute("UPDATE portrait_automation_grants SET enabled=0 WHERE id='grant3'")
        self.assertEqual(self.con.execute("SELECT status FROM portrait_mesh_jobs WHERE portrait_id='3'").fetchone(), ("complete",))
        seed(self.con, 6)
        self.assertEqual(self.con.execute("SELECT status,grant_id FROM portrait_start_outbox WHERE pattern_id='pattern6'").fetchone(), ("pending", "grant6"))
        self.con.execute("UPDATE pattern_portrait_jobs SET status='complete',completion_hash='accepted',image_asset_id='image1',sample_asset_id='sample1',completed_at=? WHERE id='imagejob1'", (NOW,))
        self.con.execute("UPDATE portrait_mesh_jobs SET status='complete',completion_hash='accepted',model_asset_id='model1',provenance_asset_id='provenance1',completed_at=? WHERE id='meshjob1'", (LATER,))
        self.assertEqual(self.con.execute("SELECT * FROM runtime_health_capture ORDER BY work_class").fetchall(), [("mesh", LATER), ("portrait", NOW)])
        self.assert_integrity()

    def test_atomic_rollback_after_copy_drop_rename_and_trigger_restore(self) -> None:
        before = snapshot(self.con)
        schema = self.con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        statements = split_statements(SQL)
        checkpoints = [i for i, sql in enumerate(statements) if "DROP TABLE " in sql or "RENAME TO " in sql]
        checkpoints += [len(statements) - 2]
        for checkpoint in checkpoints:
            with self.subTest(checkpoint=checkpoint), self.assertRaises(sqlite3.IntegrityError):
                apply(self.con, fail_after=checkpoint)
            self.assertEqual(snapshot(self.con), before)
            self.assertEqual(self.con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall(), schema)
            self.assert_integrity()
        with self.assertRaises(sqlite3.IntegrityError):
            apply(self.con, fail_commit=True)
        self.assertEqual(snapshot(self.con), before)
        self.assertEqual(self.con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall(), schema)
        self.assert_integrity()
        # Retry after an aborted migration succeeds on exactly the retained rows.
        apply(self.con)
        self.assert_integrity()

    def test_new_inbound_dependency_fails_before_rebuild(self) -> None:
        self.con.execute("CREATE TABLE unexpected_portrait_child(id TEXT, portrait_id TEXT REFERENCES pattern_portraits(id) ON DELETE CASCADE)")
        self.con.execute("INSERT INTO unexpected_portrait_child VALUES ('kept','1')")
        self.con.commit()
        before = snapshot(self.con)
        with self.assertRaises(sqlite3.IntegrityError):
            apply(self.con)
        self.assertEqual(snapshot(self.con), before)
        self.assert_integrity()


if __name__ == "__main__":
    unittest.main(verbosity=2)
