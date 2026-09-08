# Slice 2: source-bound release preflight

Date: 2026-09-08

Status: specification for review; no implementation or release performed.

Parent: [12+1 delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md). Inspected source: `6e706741f03253f2807d33380afb529161f3481f` and the current local files. Repository policy in [AGENTS.md](../../../AGENTS.md) remains authoritative.

## Outcome

The supported release workflow refuses a missing, incomplete, failed, or mismatched local gate before an implementation merge. It binds the tested source and build artifacts to a concrete candidate, checks the current PR/base context, and requires the actual gate summary in that PR. The command performs checks and writes evidence; it does not merge, push, migrate, install a runner, or deploy.

Use the existing [release-evidence implementation](../../../scripts/pattern-release/release-evidence.mjs) and [offline reconciliation](../../../scripts/pattern-release/release-reconciliation.mjs). Keep `local-release-evidence.v1` and its historical receipts readable. A new preflight result references the existing receipt's exact bytes instead of replacing or promoting it.

## Current foundations and gaps

- Existing capture records tracked/nonignored source hashes and executable flags, a base commit, actual `ci:local` exit/summary, configuration pins, migration-file hashes, and API/web/runner build inventories.
- Verification requires all fourteen current lanes and compares current source/artifact/configuration identities. Source comparison deliberately compares file manifests, not base-commit equality.
- The excluded source prefixes are `docs/reviews/`, `docs/superpowers/`, and `output/`. The receipt is a local process record, not a signed attestation or complete production receipt.
- The current tool does not prove that the intended Git candidate contains the captured dirty bytes, that `main` still has the checked base, or that the PR contains the actual summary.
- Merging can trigger Workers Builds. An applicable migration or incompatible runner transition must therefore be handled before the merge that starts the Worker deployment, or the new producer must remain disabled.

## Selected workflow and integration rule

Use a candidate branch that already contains the observed `origin/main`. Support a normal merge commit whose resulting tree is the candidate tree when the base is unchanged. Reject a divergent candidate with `base_not_in_candidate`; integrate the base into that branch, resolve conflicts, and verify the resulting source before trying again. This avoids pretending that branch-head tests cover an untested conflict resolution. Squash/rebase release modes are outside the initial supported wrapper.

The preflight independently computes an included-source manifest from the candidate's Git tree: recursively read blob bytes, hash with SHA-256, and map mode `100755` to executable true and `100644` to false. Apply exactly the existing excluded prefixes. Refuse symlinks, submodules, and unsupported entries. Compare the entire path/hash/mode map against the gate manifest and the current checkout's included files. Never equate Git's blob hash with the receipt's SHA-256 or infer dirty-byte inclusion from `base_commit`.

The gate may precede the final commit: a dirty gate can map to a later commit if all included source bytes/modes match. Excluded evidence documentation can then be committed without manufacturing a new executable-source claim. Record both the full candidate tree ID and the included-source digest so the exclusion boundary remains visible.

Proposed root command interfaces:

```text
npm run release:gate -- docs/reviews/artifacts/<release-id>
npm run release:preflight -- docs/reviews/artifacts/<release-id>/preflight-input.json
```

`release:gate` captures the real existing gate and writes new, create-only `local-release-evidence.json` and `ci-local-summary.txt` files. Extract the exact final summary from the observed command stream, including toolchain and all lane lines; do not reconstruct historical output from a passing boolean. Write a `release-summary.v1` sidecar binding the receipt bytes and summary bytes by SHA-256. Retain the same `ci:local` execution and gate parser. A failed/interrupted run retains its failed evidence and cannot produce a successful preflight.

`release:preflight` runs the existing receipt verifier, verifies the sidecar and source-to-candidate mapping, and performs read-only repository/PR observations through a bounded adapter. A legacy receipt without its original summary evidence remains useful history but does not pass this new workflow; do not synthesize a missing summary after the fact.

## Input, output, and remote observations

The new closed input format is `release-preflight-input.v1`:

| Field | Required value |
| --- | --- |
| `receipt_path`, `summary_path`, `summary_receipt_path` | Repository-relative regular files under one existing evidence directory |
| `candidate_commit`, `expected_base_commit` | Explicit full 40-character lowercase Git commit IDs, never moving ref names |
| `repository`, `pull_request` | Explicit repository identity and positive PR number |
| `base_branch`, `integration_method` | `main`, `merge_commit` |
| `release_review_path` | A separate dated review record bound to candidate and receipt |
| `output_path` | New file under a documented evidence prefix |

The release review is an explicit maintainer record, not a permission inferred by the tool. It contains the candidate/receipt hashes, the responsible reviewer identifier, review time, compatibility classification, newly introduced migration paths, and references to applicable pre-merge operational evidence. It contains no account identifiers, secrets, private chart facts, or raw provider output. Reviewer attribution is declared rather than cryptographically authenticated.

Freeze the final candidate commit before writing its review/preflight records. These records may remain in the excluded evidence directory outside that candidate commit and be retained with the PR evidence; requiring a candidate to contain a record of its own commit hash would create a circular identity requirement. If the candidate changes, create a new bound review/preflight record.

The read-only adapter returns the remote base SHA, PR base branch/repository, PR head SHA, PR body, and observation time. Reject a wrong repository/base, changed PR head, missing observation, or base different from `expected_base_commit`. Require that base to be an ancestor of the candidate. Re-read base/head after all checks; a change during the preflight fails it. Do not trust an old local `origin/main` tracking ref as a fresh remote observation.

The PR body must contain the exact captured summary in a fenced block and a receipt marker carrying the receipt SHA-256. Match summary content, lane order, and toolchain against the bound summary sidecar. A marker alone, arbitrary `pass` strings, or a summary from a neighboring commit fails. Posting that text is a separate authorized action; this checker only reads it.

The create-only result format is `release-preflight.v1`, with:

- `status: "ready_for_authorized_merge" | "blocked"` and closed problem codes;
- candidate commit/full tree ID, included-source digest, captured gate base, receipt/summary hashes, toolchain, and build-manifest digest;
- observed remote base/head and observation time, plus a hash of the relevant PR evidence block;
- review record and applicable operational-record hashes;
- `deployment_status: "unverified"`, `runner_adoption_status: "unverified"`, and `provider_execution_status: "unverified"` unless those remain in separately named, dated records. Never promote the local receipt.

Exit 0 means this exact candidate/context satisfied the checks at the recorded time. Exit 1 means a completed check found a blocking evidence/compatibility issue. Exit 2 means invalid invocation, unsafe path, unavailable prerequisite, or I/O failure. Emit bounded codes and repository-relative paths; redact raw remote errors and PR prose from terminal diagnostics. Refuse existing outputs and symlink/path escapes using the established evidence-path protections.

A preflight result is not a reusable merge token. Repeat it immediately before the authorized merge; if the PR head or base has changed, stop and re-evaluate. The supported merge invocation must check the expected PR head, and the maintainer must also recheck the base. There is no claim of an atomic check-and-merge transaction or branch protection. Raw Git/GitHub operations can bypass this workflow, and the absence of server-side protection remains explicit.

## Compatibility and operational boundary

Compare the candidate to the observed base for migration SQL/manifest changes and execution/contract configuration changes. A modified/deleted historical migration is a blocking compatibility review, not an ordinary pending migration. New migration paths require an explicit disposition in the release review. File presence in the repository cannot establish that a migration was applied.

If a migration must precede this Worker, the preflight requires a separately authorized, dated readback bound to the candidate's actual SQL hashes and database target. The readback records the actual pending/applied set and required integrity/compatibility evidence; it does not reuse migration numbers from historical notes. A rollout that can safely keep a new producer disabled must record and verify that default, its later enablement boundary, and the compatible reader/runner behavior.

The same rule applies to a producer emitting a new runner protocol: evidence of a compatible installed runner, or a tested disabled producer, is a pre-merge prerequisite. API build identity alone does not prove runner adoption. Other operational evidence remains a separate release record. The preflight itself has no D1 mutation/provider execution path.

## Files and verification

Create `scripts/pattern-release/release-preflight.mjs` and its adjacent `.test.mjs`, a bounded read-only observation adapter, and a documented input/review template. Extend the existing gate tool only for the exact summary sidecar and reusable validation seams. Update [repository-release-evidence.md](../../deploy/repository-release-evidence.md) and root npm scripts. Keep the existing fourteen-lane summary contract and run new tests in `test:content`.

Use synthetic Git repositories, a fake remote/PR adapter, and fake gate children for regression tests. Required cases: full success; absent/failed/truncated gate; source changes during gate; dirty base commit missing captured bytes; different content under the same HEAD; same content committed later; changed executable bit; unsupported Git entry; changed/missing/extra build artifact; missing/mismatched PR summary; wrong repository/base/head; diverged candidate; base moving during preflight; stale summary sidecar; unsafe/existing destination; missing review; migration/runner compatibility gaps; and preserved unverified production fields.

Run focused tests and `npm run test:content`, then the real source-bound `ci:local` on the final implementation candidate. The tool's own bootstrap PR uses the existing gate and exact summary, with its prospective preflight exercised locally. The first actual use and any operational readback are separate from unit-test evidence.

## Acceptance and release boundary

Local acceptance requires a demonstrated refusal for every missing/mismatched evidence case, correct candidate-tree mapping, a complete real gate/summary pair, and an honest bypass/race boundary. Adoption requires the maintainer to use the reviewed workflow on an authorized PR. This specification adds no permission to merge and contains no deployment certification.
