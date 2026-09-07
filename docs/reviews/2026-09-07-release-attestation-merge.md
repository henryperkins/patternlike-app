# Release attestation and Daily receipts merge review — 2026-09-07

The Worker now reports the injected release commit and Cloudflare serving version independently through `/v1/meta`. Guarded production work requires a valid release SHA. Model-backed Daily publication binds a content-free receipt to the exact reading, generic job, durable provider job, command/stage generation and attempt within the same atomic D1 batch. Deterministic publication requires no receipt. The additive migration is `0029_daily_publication_receipts.sql`.

This selectively ports the original `feat/release-truth-attestation` work while preserving current high/xhigh execution, source and privacy boundaries, retry/replacement behavior, and Save-aware erasure. The original worktree and authored patch remain preserved. The obsolete manual release wrapper is not introduced; the [current runbook](../deploy/release-attestation.md) describes required SHA injection for Workers Builds and reviewed manual releases.

The [implementation record](artifacts/2026-09-07-release-attestation/implementation-review.md) reports the source freeze and completed focused evidence: 400 tests on Node 22, API/scripts typecheck, seven Wrangler checks, pre-0003 compatibility, source-fingerprint check, and fresh/populated migration integrity/preservation checks. These establish bounded local implementation behavior, not production adoption.

The [independent spec and quality review](artifacts/2026-09-07-release-attestation/independent-review.md) and final cumulative integration review passed with no Critical or Important source findings. The user's later test-scope restriction governs the verification below. Operational observations are kept in excluded review artifacts, preserving the reviewed migration and deployment source bytes.

Root preserved the original focused logs and source snapshots privately under `/home/henry/.local/state/patternlike/merge-sequence-20260907/task-4-preparation-output/` before the aggregate freeze. Original report paths describe where the implementer produced them.

## Verification scope updated by the user

The initial full gate at `42d41ebeeb0bb0588b7574aa425715ee2670b604` completed nonpassing: thirteen lanes passed, including 2,525 API tests plus the compatibility case, while the web lane hit the already diagnosed five-second whole-case timeout for two sequential portrait scene loads. The [actual nonpassing summary](artifacts/2026-09-07-release-attestation/ci-local-summary-nonpassing.txt) and [receipt](artifacts/2026-09-07-release-attestation/local-release-evidence.json) are retained without modification. This is not a passing full merge gate.

The user subsequently restricted tests to the 3D Pattern animation work. No new unrelated test suite or replacement `ci:local` will run. The earlier focused release-runtime checks and independent source review remain evidence for their exact source; final integration will separately verify unchanged release files and the revised portrait. No full-gate success, migration rehearsal on a production backup, or provider/lifecycle canary is claimed under that narrower scope.

## Completed deployment prerequisites

All 35 reviewed release files remain byte-identical after integration onto dependency main `c3190768bf0e169925fd4a14d1f7f8adf901d57a`; the pre-evidence candidate is `c393a9cfbeac5d75ae9bcf5e361688ced38c5bf0`. No release-runtime or migration test suite was rerun.

Both actual Workers Builds commands were updated and read back with guarded `RELEASE_GIT_SHA` injection from `WORKERS_CI_COMMIT_SHA`. The serving dependency-release version subsequently reports that exact main SHA in its binding at 100% traffic. This observes actual SHA injection before introducing the production guard; it does not claim this receipt runtime is already deployed.

Migration `0029_daily_publication_receipts.sql` was applied to production on **2026-09-07 at 10:15:26 UTC**, after a private mode-0600 full export and Time Travel bookmark capture. Only 0029 was pending. The actual table and two explicit indexes match the reviewed SQL after ignoring comments/whitespace; the table has 19 columns and no foreign keys. Post-apply `quick_check` is `ok`, foreign-key issues and assertion rows are zero, and the table was empty. A public health readback returned HTTP 200. No customer/provider canary or new production-backup rehearsal was run.

[Migration and backup identity](artifacts/2026-09-07-release-attestation/production-migration-0029.json) · [Apply output](artifacts/2026-09-07-release-attestation/production-migration-apply.txt) · [Serving SHA before the guard](artifacts/2026-09-07-release-attestation/pre-guard-serving-release-observation.json). The SQL export and raw bookmarks remain private outside the repository. The migration inventory stays prospective source history; these dated operational receipts record its actual application separately.
