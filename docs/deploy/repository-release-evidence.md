# Repository release evidence

`scripts/pattern-release/release-evidence.mjs` records local source and build
identity around the actual aggregate gate. It does not deploy, access production
databases, query accounts, invoke a model, or exercise the live application.
Its aggregate child exercises local test databases and migrations.

Evidence status has a narrow meaning:

| Status | Meaning |
| --- | --- |
| `observed` | This tool measured the local files or child process represented by the field. Repository configuration is not executed provider provenance. |
| `recorded` | A dated prior report or operator declaration is retained with its source and scope; it was not freshly observed by this tool. |
| `unverified` | The evidence is absent. No default value or partial observation closes the gap. |

Use the Node major in `.nvmrc` and a real per-worktree `.venv`. Freeze the source
after implementation, source-fingerprint generation, and focused verification.
Then run from the repository root, choosing a new evidence filename:

```bash
node scripts/pattern-release/release-evidence.mjs gate \
  docs/reviews/artifacts/2026-09-06-reading-assurance/local-gate.json
node scripts/pattern-release/release-evidence.mjs verify \
  docs/reviews/artifacts/2026-09-06-reading-assurance/local-gate.json
```

`gate` executes exactly `npm run ci:local`, streams its output, and records its
actual exit code. It requires the final success text and all 14 distinct lanes
in the expected order, including the ephemeris and three extra lanes. An
incomplete summary, failed lane, nonzero exit, changed source, missing build
artifact set, or missing identity source fails the evidence result. It never
passes by counting arbitrary `pass` strings in test output. Capture the streamed
log in an operator scratch directory if needed; the JSON keeps only its SHA-256,
the known lane results, and the toolchain versions, never raw test output.
Paste the actual summary into a PR before any later authorized merge.

The source snapshot includes tracked and nonignored new files, their SHA-256
hashes and executable flags, and the base Git commit. A dirty worktree is
explicitly recorded; its source identity is the file manifest, not a claim that
the base commit includes the edits. Missing, added, and changed paths are all
checked after the gate and by `verify`. Symlinks are refused. The fixed excluded
prefixes are `docs/reviews/`, `docs/superpowers/`, and `output/`; ignored build,
dependency, local secret, and environment files are outside source scope.
Documentation evidence may be completed after the gate within these excluded
paths. Changes to included files require a new gate. A standalone preflight
snapshot can be written with `snapshot <new-output.json>`.

Build manifests cover every file under `apps/api/dist`, `apps/web/dist`, and
`apps/codex-runner/dist`. They record local build bytes, not bytes observed on
Cloudflare or an installed host. Configuration records extract only literal
exported model, reasoning, provider, prompt and policy version identifiers from
the Daily and Pattern publisher/policy modules, including publication safety.
The full source manifest also binds prompt source, lockfiles, generated Pattern
source identity, runner isolation policy, and toolchain declarations. Migration
SQL and `MIGRATIONS.json` are hashed, while applied migration state remains
`unverified`.

Every receipt leaves deployed release SHA, Worker version, traffic allocation,
and installed runner artifact hash explicitly null and `unverified`. `verify`
refuses promoting even a partial Worker observation to an observed deployment.
It recomputes the current source, artifact, and configuration hashes. The JSON
is a local process record, not a signed attestation: its hashes detect file
drift, but do not authenticate an author or independently prove a historical
process run if the record itself was fabricated. Retain the original gate log
outside the repository when independent inspection is needed.

The runtime [release-attestation and Daily receipt port](release-attestation.md)
was reconciled from the preserved release-truth worktree onto current source.
It uses Workers Builds SHA injection rather than the historical manual wrapper.
Migration 0029 and static runbook requirements are part of the source snapshot;
actual trigger changes, schema application, serving metadata, and traffic are
separate operational observations. The local tool does not perform them.

## Offline reconciliation after the gate

`scripts/pattern-release/release-reconciliation.mjs` prepares and checks a
separate record. It never edits or promotes a local gate receipt. Its strongest
result is `consistent_recorded_chain`: the supplied records agree with the
validated local gate and each other. `deployment_status` always remains
`unverified`, and `independent_live_observation` always remains `false`. This
command has no production, provider, account, or migration execution path.

After the final source gate, while the same source and build bytes remain
available, prepare a new input document:

```bash
node scripts/pattern-release/release-reconciliation.mjs prepare \
  docs/reviews/artifacts/2026-09-06-reading-assurance/local-gate.json \
  docs/reviews/artifacts/2026-09-06-reading-assurance/reconciliation-input.json
```

`prepare` calls the existing gate verifier; it does not rerun the gate. It binds
the exact receipt bytes, source snapshot, build manifests, repository pins,
requested execution tuples, migration SQL hashes, and migration-manifest hash.
The resulting `expected` object describes local requirements. Every external
record reference and every observation field stays blank. For a blank structure
before a gate exists, use `template <new-output.json>`.

The input, its referenced files, and output must be under `docs/reviews/`,
`docs/superpowers/`, or `output/` in the current checkout. References are relative
to the repository root. The command refuses symlinks, nonregular input files,
files over 8 MiB, and existing output filenames; new outputs use mode `0600`.
Source paths cannot receive evidence. Malformed inputs produce fixed error codes
without echoing their contents or filesystem paths. These exclusions permit
evidence work after the gate; editing included source still requires a new gate.

For each observation, copy its entry from `record_templates` into a separate
JSON file, fill only fields supported by a real dated source, and retain that
source for review. Leave the input's `record_templates` unchanged. Set
`records.<kind>.path` and `records.<kind>.sha256` to that file's repository-relative
path and exact SHA-256. Hash the saved bytes after writing the record; changing
whitespace changes its file hash. Missing evidence stays `{ "path": null,
"sha256": null }`. The command does not convert an absent observation to a
successful default.

Each source record has this wrapper:

```json
{
  "schema_version": "offline-release-record.v1",
  "kind": "worker",
  "source_kind": "operator_record",
  "recorded_at": null,
  "data": {}
}
```

`recorded_at` is the UTC source-observation time in
`YYYY-MM-DDTHH:mm:ss.sssZ` form. Future times are rejected. Runtime records must
date from the gate completion or later. `source_kind` is one of
`operator_record`, `platform_export`, or `runner_inventory`; this is a declared
origin, never authentication of that origin. `data` uses the exact fields in
the corresponding generated template. Do not insert accounts, emails, chart or
job identifiers, birth data, prose, image bytes, access tokens, or credentials.
Use a newly generated exercise UUID with no account identity encoded in it.
Keep any mapping and sensitive original sources outside repository evidence.

The release records must cover the following complete set:

| Record | Required evidence and exact comparison |
| --- | --- |
| `source_mapping` | A full released Git commit and independently recorded released-source snapshot matching the gate's entire file manifest. A dirty gate's base commit is not the release commit; a later commit needs the same source bytes and executable flags. Merely copying the expected digest does not establish this mapping. |
| `worker` | Released commit, source snapshot, a Worker version UUID, a complete allocation containing that one version at exactly 100%, and the full uploaded API/web artifact map matching the gate. Partial or mixed allocation remains a gap. If the platform representation differs, retain the gap until a reviewed mapping exists. |
| `runner` | Released commit and source snapshot, complete installed runner artifact map and its digest, exact Node version, source lockfile hash, and a dated installed dependency inventory with its own digest. The artifact map must match every gate runner file; missing, added, or changed files fail. The dependency inventory's internal hash is checked, but installed package bytes are not independently derived from the lockfile. |
| `execution` | The same Worker version and runner digest, the entire repository pin set, and all seven execution tuples: Daily; Pattern planner, writer, and verifier; portrait image; mesh author; mesh review. Use effective invocation/accepted output evidence, not a configuration listing. The portrait tuple records the requested image label; `image_provider_observed_model` must stay null and its observation status must be `not_exposed`. |
| `migrations` | A complete `applied_files` map containing exactly the gate's SQL file paths and byte hashes, its digest, the separate `MIGRATIONS.json` hash, `integrity_check: "ok"`, and zero foreign-key violations. SQL existence in the checkout and a manifest entry are not evidence of application. Missing or extra migrations remain explicit incompatibility gaps. |

File inventory values are `{ "sha256": "<64 lowercase hex>", "bytes": 0 }`,
with the actual byte count. The SQL map values are SHA-256 strings. Aggregate
hashes use `sha256Hex(canonicalJson(value))` from
`scripts/pattern-release/candidates.mjs`: object keys are sorted recursively,
array order is preserved, and no whitespace is inserted. Inventory paths map
installed/uploaded files back to their exact gate artifact paths; do not put
host directory names into those paths. The dependency inventory can use paths
relative to the runner's installation directory. Its contents and paths are
hashed but are not copied into the reconciliation output.

## Authorized portrait lifecycle evidence

The generated template is a preparation aid, not authority to invoke a provider,
change consent, delete an account, or stage a late upload. Account exercise
records require separately established authorization covering those actions.
The `authorization` record sets `authorized: true`, `scope: "portrait_lifecycle"`,
and the anonymous `exercise_id` only when that authorization exists. It predates
the lifecycle observations. Each lifecycle record references the exact hash of
that authorization file, the same exercise UUID, released commit, Worker version,
and installed runner digest. Those bindings prevent combining unrelated records
into one apparently complete exercise.

Collect the following observations in order during a separately authorized
exercise. Record timestamps when the observations occurred; the tool checks
their order and preserves failed or missing outcomes as gaps.

1. **Completion:** observe terminal `ready` state, four accepted saved images,
   four accepted saved models, reader visibility, and preservation of the whole
   source reading. Record `saved_assets` with `reading_sha256`, `graph_sha256`,
   and four ordered `chapters`. Each chapter has `index` 0 through 3,
   `chapter_sha256`, `image_sha256`, and `model_sha256`. Hash the actual accepted
   plaintext bytes in the authorized private environment; retain no bytes here.
   A provider turn ending successfully does not establish any of these outcomes.
2. **Saved reuse:** reopen the saved account experience, compare the exact same
   `saved_assets` structure, and observe zero new provider requests. Record an
   actual request delta; an absent runner log is insufficient. Verify both
   reader visibility and saved bytes through the authenticated owner flow.
3. **Withdrawal:** include unfinished work in the exercise, withdraw the relevant
   grant, and observe it stop. Confirm accepted assets remain available with the
   same `saved_assets_sha256`, new requests are blocked, and a stale completion
   does not publish. The completed and unfinished cases may be separate eligible
   Patterns in the authorized exercise; preserve their private association in
   the underlying source record.
4. **Deletion:** exercise the authorized account deletion path and record
   `deletion_scope: "account"`. Observe denied
   asset access, invalidated jobs, zero remaining encrypted artifacts, and
   retained cleanup inventory/tombstone. Bind the accepted predeletion assets
   with the same `saved_assets_sha256`. An HTTP success response alone does not
   establish erasure or cleanup.
5. **Late upload:** using the separately authorized controlled race case, observe
   a late upload attempt after deletion, its failure to publish, a completed
   cleanup rerun, absence of the late object, continued denied access, and
   retained cleanup inventory. Record `late_object_sha256` only. A unit test or
   an unattempted upload cannot fill these fields.

Do not repeat these actions merely to satisfy the offline checker. If they have
not been authorized and observed, leave the references blank. Lifecycle
booleans are source-backed operator records; the offline command cannot attest
that an account action happened, that an operator had authority, or that an
object is currently absent.

After the records exist, write a new reconciliation result:

```bash
node scripts/pattern-release/release-reconciliation.mjs reconcile \
  docs/reviews/artifacts/2026-09-06-reading-assurance/local-gate.json \
  docs/reviews/artifacts/2026-09-06-reading-assurance/reconciliation-input.json \
  docs/reviews/artifacts/2026-09-06-reading-assurance/reconciliation-result.json
```

Exit 0 means `consistent_recorded_chain`, never deployment verification. A
well-formed but partial or contradictory set writes `incomplete_recorded_chain`
and exits 1 with enumerated gaps. Invalid outer JSON, a stale local gate, or an
unsafe destination fails without creating a result. The output contains only
fixed statuses, hashes, declared source kinds, dates, and gap codes. It retains
each source record's exact file hash and date without reproducing private
content or identifiers. An input-file hash binds rejected records as well.
Hashes detect changed records, but do not authenticate authors, prove a
historical execution, inspect current Cloudflare allocation, verify installed
runtime dependencies, or independently establish live lifecycle outcomes.

The focused `release-reconciliation.test.mjs` fixtures construct a synthetic
repository and execute its small fake gate child to exercise the receipt
boundary. Its complete sample is explicitly synthetic test data; it is not a
repository release record or account observation. The real 14-lane gate remains
the responsibility of the final frozen source run.
