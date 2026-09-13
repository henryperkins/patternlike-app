# Migration 0034 production apply (2026-09-13)

`db/d1/0034_daily_reading_quality_observations.sql` adds one column,
`daily_publication_receipts.qualitative_findings_json` (`TEXT NOT NULL DEFAULT '[]'`,
JSON-array CHECK). The Worker in commit `149661f` writes that column on every
constrained-model Daily publication, so the migration had to be applied before
that commit was pushed to `main` (Workers Builds deploys on push).

## Pre-apply

- Remote ledger before: 33 rows; `wrangler d1 migrations list patternlike-ops --env production --remote` reported `0034` as the only pending file.
- Restore bookmark (from `wrangler d1 time-travel info`): `00000364-00000747-000050e5-9541992b9f097938785837519bcc1232`.
- Private SQL export outside the repository, taken at that bookmark: `~/patternlike-ops-exports/patternlike-ops-pre0034.sql`, 11,474,434 bytes, sha256 `54105856a0f74ce172deec66fe676a3dd203527d6528dfed133c04618a5d4c2a`.
- Rehearsal over that export in local SQLite 3.46.1 (Python `sqlite3`, FK enforcement re-enabled after load, one transaction): 70 tables and 11,941 rows preserved with no row-count difference; the one statement added exactly the one column; the four existing receipts read `[]`; a JSON-object value is rejected by the CHECK and a token array accepted (both rolled back); `foreign_key_check` empty; `quick_check` and `integrity_check` ok.

## Apply

`wrangler d1 migrations apply patternlike-ops --env production --remote` (wrangler 4.129.0, run from `apps/api`) at 2026-09-13 22:29:39–40 UTC: 2 commands in 9.47 ms, `0034_daily_reading_quality_observations.sql ✅`.

## Post-apply (read-only, production, ENAM)

- `d1_migrations`: 34 rows; newest `0034_daily_reading_quality_observations.sql` at `2026-09-13 22:29:40`, preceded by `0033` at `2026-09-11 19:59:19`. `migrations list --remote`: nothing pending.
- `pragma_table_info('daily_publication_receipts')`: `qualitative_findings_json TEXT`, notnull 1, default `'[]'`.
- `daily_publication_receipts`: 4 rows, one distinct value, `[]`.
- `PRAGMA foreign_key_check`: empty. `PRAGMA quick_check`: ok. `assertion_probe`: 0 rows.

Local rehearsal evidence does not establish deployed runtime behaviour; the
first constrained-model publication after the deploy is what proves the Worker
writes the column.
