# M7 Evidence Gates (Slice D)

**Date:** 2026-08-16

**Status:** Draft for approval. No plan may be derived until this is
approved. Criterion 23 cannot be scheduled until `0008` is applied and
the replay runtime in
[`2026-08-16-pattern-replay-ledger-design.md`](2026-08-16-pattern-replay-ledger-design.md)
exists.

**Scope:** The three acceptance criteria that are runs, not commits:
criterion 20 (hard evaluation and privacy gates), criterion 22
(production migration, deploy, ontology activation, rollout, and
real-account certification), and criterion 23 (disaster-recovery
restore drill).

Style: `docs/deploy/openai-daily-reading-rollout.md` — a runbook with
recorded evidence and an empty ledger table, not a feature design.

## Decision summary

- Slice D does not invent the replay ledger. It runs the drill against
  the `0008` runtime. A drill against absent support proves nothing.
- Criterion 20 is a signed checklist over the evaluation and privacy
  gates already named in the M7 design §28.8 (the retired product-spec v0.6
  §15 restated the same bar). Zero exceptions.
- Criterion 22 is five separately reported operations. Ontology
  activation for external readers is Slice B, not Slice A. Rollout
  does not move as a consequence of merging any remaining-slice PR.
- `docs/deploy/openai-pattern-rollout.md` remains a Slice 1 Task 10
  deliverable. This slice consumes it; it does not rewrite it.
- `PATTERN_AI_ROLLOUT` stays `off` in both wrangler blocks until the
  criterion 22 report says otherwise, and that report is an operator
  action.

## Criterion 23 — restore drill

Prerequisites: `0008` applied to production;
`PATTERN_REPLAY_LEDGER_SIGNING_KEY` set on the live writer;
`PATTERN_REPLAY_LEDGER_KEYS` set on writer and restore environments; replica
bucket populated by live claim transitions (or by a staging clone that has
performed a real deletion).

Procedure, recorded with bookmarks and hashes:

1. On a clone, create an accepted Pattern, then delete it. Confirm
   state is `deleted` and a replica object exists for that
   `pattern_deleted` event.
2. Restore the clone to a bookmark taken **before** the deletion.
   Confirm, before replay, that the claim is `available` or the
   document is readable — this is the failing state the drill exists
   to close.
3. Run `POST /internal/pattern-erasure-replay/apply` against the
   replica. Do not start consumer traffic first.
4. Confirm `GET /v1/pattern` is not readable, `GET /v1/pattern-state`
   is `deleted`, and `POST /v1/pattern-generations` is
   `409 pattern_already_consumed`.
5. Repeat for `chart_correction_erased` and for `account_deleted`.
6. Record the restore bookmark, the replica object hashes, and the
   three response envelopes. A missing replica object is a failed
   drill, not a skipped step.

## Criterion 20 — hard gates

A single report, zero exceptions, covering:

- fact-packet forbidden keys;
- consumer response leak scan;
- evaluation `verdict: "pass"` only with `unevaluated_fixture_count === 0`;
- no birth instant, birthplace, coordinates, or account identifiers in
  provider requests, logs, or safe-log arms;
- consent kind is `pattern_generation`, not `ai_synthesis`;
- export `patterns` section contains no prompts, drafts, or admin
  artifacts;
- synthetic verifier stand-in is **not** cited as criterion 7 evidence.

An internal-only Slice A Pattern may appear in the report as an
internal result. It does not satisfy the external-reader rows.

## Criterion 22 — five reports

Each is a separate document or section, not one paragraph:

1. **Production migration.** `0008` (and any later approved forward-only
   file) applied, with pre-apply bookmark and post-apply
   `PRAGMA foreign_key_check` / `quick_check` as 0007’s ledger entry
   already models.
2. **Deploy.** Worker version, web assets, `run_worker_first` still
   listing every Hono path. No `PATTERN_AI_ROLLOUT` change.
3. **Ontology activation.** A `machine_pipeline` release, not a
   synthetic internal one, for any external-reader certification.
   Slice A activation is reported under internal-only evidence and
   does not count here.
4. **Rollout.** The Slice 1 runbook’s ordered gates, including spend
   approval. Off → internal → first_open is an operator sequence.
5. **Real-account certification.** One designated account, with
   Pattern consent, receives a complete document whose ontology
   provenance is `machine_pipeline`.

## Out of scope

- Authoring ontology content (A) or building the pipeline (B).
- Choosing Access versus OIDC (C).
- Implementing the adapter (Slice 1).
- Moving `PATTERN_AI_ROLLOUT` in wrangler as part of a merge.
