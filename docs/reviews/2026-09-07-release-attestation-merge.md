# Release attestation and Daily receipts merge review — 2026-09-07

The Worker now reports the injected release commit and Cloudflare serving version independently through `/v1/meta`. Guarded production work requires a valid release SHA. Model-backed Daily publication binds a content-free receipt to the exact reading, generic job, durable provider job, command/stage generation and attempt within the same atomic D1 batch. Deterministic publication requires no receipt. The additive migration is `0029_daily_publication_receipts.sql`.

This selectively ports the original `feat/release-truth-attestation` work while preserving current high/xhigh execution, source and privacy boundaries, retry/replacement behavior, and Save-aware erasure. The original worktree and authored patch remain preserved. The obsolete manual release wrapper is not introduced; the [current runbook](../deploy/release-attestation.md) describes required SHA injection for Workers Builds and reviewed manual releases.

The [implementation record](artifacts/2026-09-07-release-attestation/implementation-review.md) reports the source freeze and completed focused evidence: 400 tests on Node 22, API/scripts typecheck, seven Wrangler checks, pre-0003 compatibility, source-fingerprint check, and fresh/populated migration integrity/preservation checks. These establish bounded local implementation behavior, not production adoption.

The [independent spec and quality review](artifacts/2026-09-07-release-attestation/independent-review.md) passed with no Critical or Important source findings. The final integrated full gate and actual operational prerequisites remain to be recorded. Before the compatible main merge, both Workers Builds commands must inject the actual CI SHA and migration 0029 must be backed up, rehearsed, applied and checked. Live observations will be retained below without changing source-hashed migration or deployment files after the gate.

Root preserved the original focused logs and source snapshots privately under `/home/henry/.local/state/patternlike/merge-sequence-20260907/task-4-preparation-output/` before the aggregate freeze. Original report paths describe where the implementer produced them.

## Verification scope updated by the user

The initial full gate at `42d41ebeeb0bb0588b7574aa425715ee2670b604` completed nonpassing: thirteen lanes passed, including 2,525 API tests plus the compatibility case, while the web lane hit the already diagnosed five-second whole-case timeout for two sequential portrait scene loads. The [actual nonpassing summary](artifacts/2026-09-07-release-attestation/ci-local-summary-nonpassing.txt) and [receipt](artifacts/2026-09-07-release-attestation/local-release-evidence.json) are retained without modification. This is not a passing full merge gate.

The user subsequently restricted tests to the 3D Pattern animation work. No new unrelated test suite or replacement `ci:local` will run. The earlier focused release-runtime checks and independent source review remain evidence for their exact source; final integration will separately verify unchanged release files and the revised portrait. No full-gate success, migration rehearsal on a production backup, or provider/lifecycle canary is claimed under that narrower scope.
