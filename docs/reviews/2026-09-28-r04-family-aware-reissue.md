# R04 family-aware Daily edition reissue

Date: September 28, 2026. Branch: `feat/r04-family-aware-reissue`, based on `dc1558b82d215638de9a0c904c8afb610d176833` (the documentation reconciliation on `00299d26b0b27dd5e14887f94287a872a629efb4`). Scope: backlog item R04 only; R05, R07, and R08 are untouched. Nothing was pushed, merged, or deployed.

## Result

`POST /internal/readings/edition-reissue` is an additive successor to the legacy operator reissue ([contract](../../contracts/daily-edition-reissue-v1/README.md), [service](../../apps/api/src/services/edition-reissue.ts), [route](../../apps/api/src/routes/internal-generation.ts)). The request is `daily-edition-reissue/v1`, validated by a generated strict Worker validator. It names one published edition by `reading_id`, `revision`, `local_date`, and `generation_family`.

- **Family from retained evidence.** The family is the row's `assembly_mode`. The decrypted envelope (v3 or v5), its identity, and its evidence header must agree before any calculation. A misstated family is `family_mismatch`; a disagreement or unreadable envelope is `target_evidence_invalid`. The successor is frozen by that family's own builder: a V2 command recorded as `manual_reissue`, or a V1 command.
- **Reason matrix.** Deterministic editions keep the legacy vocabulary. Constrained-model editions accept only `safety_correction` and `defect_repair`, so `consent_revoked` never starts a model call and a chart correction stays with invalidation and fact repair. Both the contract schema and the Worker enforce this.
- **Date scope.** A deterministic edition must be for the current local day, resolved as the V1 builder resolves it. A constrained-model edition may be for the current or next local day under the pinned tz database. The successor is frozen for exactly the target's date, rechecked after the build.
- **Authorization and consent.** The route requires the service token, an active account, and its current account-processing grant. A constrained-model edition also needs the rollout's internal entry (read from the clear column before any key or calculation), a configured publisher, and a live `ai_synthesis` grant. `reserveReissue` gained optional caller guards. The reservation batch uses them to re-assert the exact published edition (status, revision, date, family, key version, and nonce), the account-processing grant, and the frozen `ai_synthesis` grant. A refused batch is re-diagnosed to a specific code.
- **Idempotency.** The edition is the identity, because `uq_daily_readings_successor` admits one successor per predecessor. An identical request answers `200 replayed`, compared against the successor's generation-1 command so a later replacement does not change it. A different reason or family, or a fact-repair successor, is `409 reissue_conflict`. Replays never freeze, replace, or re-reserve.
- **Publication and ceilings.** The target stays published until the successor's own publication supersedes it in the existing guarded batch. Per-job attempts, the per-reading generation budget, and the provider daily ceiling are unchanged. A failed successor is recovered only through bounded replacement.

The legacy `/internal/readings/reissue` is unchanged and still freezes a deterministic command whatever the edition's family; a characterization test pins that until an intentional migration. `enqueue.ts`, `reading-invalidation.ts`, both command builders, both executors, `wrangler.toml`, every migration, and the frozen M3, M5, and Daily-uncertainty contracts are byte-unchanged. In `db/generation.ts` the change is additive: optional `reserveReissue` guards and a key helper that produces identical idempotency keys. No migration is required.

## Verification

**Focused.** The new suite has 52 integration tests covering:

- family selection and evidence tampering
- the reason matrix
- frozen and unauthorized accounts
- consent revoked beforehand and mid-flight (injected at the Worker's last calculation call)
- the kill switch
- stale and mismatched targets, another account's edition, and date windows
- prior-reading exclusion of the corrected edition
- replay, conflict, and fact-repair adoption
- concurrent identical and conflicting requests, synchronized so both pass every read-time check
- V1 and V2 publication, failure, replacement, and invalidation after reservation
- the legacy route
- route shapes validated against the contract, body refusals, the service token, and D1 error redaction

Seven source mutations were each caught by specific tests: removed batch guards, the race re-check, the reason matrix, the evidence check, the date window, the replay reservation-reason check, and caller-supplied family. The generated validator accepts every valid request fixture and rejects every invalid one in a realm that forbids code generation. The contract package has 6 valid and 14 invalid fixtures, each rejected for its intended reason. Before commit, nine neighbouring suites passed 322 tests.

**Source map.** The clean capture is [`2026-09-28-r04-edition-reissue`](../architecture/source-map/snapshots/2026-09-28-r04-edition-reissue/source-snapshot.json), taken at `f85f1b242944383397438360338cb718bad7ef4a` with all consumed inputs clean. It contains 8 branches, 49 topics, 176 claims, and 984 evidence selectors across 258 referenced files, with content SHA-256 `4fc25f760b8a129531aae2a6a8e8cee5b81bec6b0f0d4bc5ddbca5aac318b9dd`. `current.json` selects it; earlier snapshots are unchanged. An earlier capture of the same definition taken before the commit had the same content hash but recorded uncommitted inputs. It was set aside outside the repository and its ID is not reused.

**Local gate.** One uninterrupted run at `e9be4ae5b15ad046433c3a27957a40d218b01dc7` started at `2026-09-28T18:18:49.519Z`, and the receipt was captured at `2026-09-28T18:31:58.909Z`. Process exit **0**, and **all sixteen lanes passed**. It ran on Node `v22.23.2`, npm `10.9.8`, and the checkout-local Python `3.14.4`; the producer notes that `ci.yml` pins 3.12. Installation was the standard lockfile dry-run lane, not `--clean`.

| Lane | Passing tests |
| --- | ---: |
| Shared | 107 |
| Reading engine | 177 |
| Calculation service | 144 |
| Ontology signer | 19 |
| API primary (156 files) | 2,858 |
| API compatibility | 1 |
| API script checks | 41 |
| Web (64 files) | 948 |
| Pattern engine | 7 |
| Codex runner | 193 |
| Content and release tooling | 84 |
| Source-map tooling | 74 |

Contracts (including the new package), typecheck, ephemeris, build, and the current-map check passed in the same run. The API primary total is the previous 2,806 plus the 52 new tests. That lane's log also carried a Vitest worker `EnvironmentTeardownError` for a pending module-resolution RPC, the same pool-teardown message an earlier integration review recorded. The run reported no errors, and the new suite run alone emits none.

- [Actual emitted summary](artifacts/2026-09-28-r04-family-aware-reissue/local-gate-summary.txt).
- [Snapshot-bound receipt](artifacts/2026-09-28-r04-family-aware-reissue/local-gate.json): 1,675 inventoried source files, unchanged through the gate, source digest `5c266c9511ee702f85d82cb84cb71e21d8bb9cf90ddbb545d4ee6801b896edee`, and 28 build artifact files. It records `worktree_has_changes: true` only because the recorder reserves its own receipt path under the excluded `docs/reviews/` prefix before snapshotting.
- [Receipt verification](artifacts/2026-09-28-r04-family-aware-reissue/local-gate-verification.json) passed with zero problems. Deployment remains unverified.

```sh
node scripts/pattern-release/release-evidence.mjs gate docs/reviews/artifacts/2026-09-28-r04-family-aware-reissue/local-gate.json
node scripts/pattern-release/release-evidence.mjs verify docs/reviews/artifacts/2026-09-28-r04-family-aware-reissue/local-gate.json
```

The documentation-reconciliation receipt was re-verified at the start of this work and again after its commit, with zero problems both times.

## Remaining decisions and limits

- **Legacy route.** `POST /internal/readings/reissue` still freezes a deterministic command for any family. With an active content release, it would supersede a constrained-model edition with deterministic prose. Migrating it to the new operation, restricting it to deterministic editions, or retiring it is an owner decision.
- **Deterministic reissues depend on a content release.** A dated 2026-08-27 observation found no active release in production. If that still holds, a deterministic reissue will answer `release_not_active`. Confirm the live state before relying on it.
- **Operational scope.** A constrained-model reissue runs only when the deployed rollout admits the internal entry, the publisher is configured, the reader holds a current grant, and an installed runner completes the provider job. None of that is established here. Local tests do not establish production state, applied migrations (none are needed), installed-runner compatibility, or completed ontology review.
- **Documentation.** The `CLAUDE.md` package-status enumeration was already non-exhaustive: it omits `daily-uncertainty-v1` and `portrait-state-v1`. It does not list this package either.
- **Merging.** GitHub Actions is billing-blocked, so this summary is the merge evidence. A merge to `main` triggers a Cloudflare production deployment within about a minute.
