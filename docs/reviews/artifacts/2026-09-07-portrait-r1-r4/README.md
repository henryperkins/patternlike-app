# Portrait review and R1–R4 evidence

Preserved on 2026-09-08 while committing the reviewed portrait work and cleaning its original scratch directories. The source critiques and September 7 browser results describe earlier revisions; they are historical evidence, not a refreshed UX audit or proof of production adoption. The [current remaining priorities](../../2026-09-07-portrait-remaining-priorities.md) distinguish implemented R1–R4 work from open R5, R6 and P3 work.

| Evidence | Scope |
| --- | --- |
| [Original critiques](critique/) | Three historical assessments; use the [corrected follow-up](../../2026-09-07-portrait-review-followup.md) for withdrawn or superseded claims. Original scores are not current release decisions. |
| [Original consolidated-review results](review-merged/results.json) and [account results](review-merged/account-results.json) | Pre-remediation browser observations on the `6e70674` baseline. |
| [Corrected account follow-up](review-resume/confirmation.json) | Fictional intercepted account responses, real validators, and compiled test shapes. |
| [R1/R2 record](r1-r2/README.md) | Historical navigation/layout implementation and bounded browser checks. |
| [R3 record](r3/README.md) | Historical spatial-comparison implementation and source-specific verification. |
| [R4 record](r4/verification.json) | September 7 framing/session work, 704 web tests, and 128 preview + 27 account + 12 graphics checks. Its full-suite timeout is historical. |
| [September 8 local gate](verification/review-gate.json) and [actual summary](verification/ci-local-summary.txt) | All 14 lanes passed on the uncommitted R1–R4 source integrated with `e4ba2f9`; 2,525 API tests, the compatibility lane, and 721 web tests passed. |

The September 8 gate is preserved with its [input snapshot](verification/source-before.json), [unchanged output snapshot](verification/source-after.json), and [readable complete log](verification/ci-local.txt). It emitted API Worker `EnvironmentTeardownError` warnings, but the API lane and the aggregate command exited successfully. Node was v22.23.2, npm 10.9.8, and Python 3.14.4; the workflow pins Python 3.12. The [packaging checks](verification/packaging-checks.json) record the subsequent documentation/artifact-only adjustments and verification that runtime, tests and build inputs still match that passing gate. This packaging step does not claim another aggregate run.

The R4 receipt retains original temporary paths as provenance. Their repository destinations are in [provenance.json](provenance.json), including the [frozen preview results](r4/frozen/results.json), [account results](r4/account-results.json), [graphics results](r4/actual-results.json), and [source hashes](r4/source-sha256-final.txt). The original full-suite timeout log is [retained separately](r4/full-test-final.txt), so it cannot be confused with the later passing gate.

Historical harnesses retain their original local paths and temporary-fixture dependencies. They are source captures, not portable test entry points. The private recovery archive also retains the complete R4 scratch directory and baseline files; no such files were discarded to make this archive appear reproducible. Browser evidence remains limited to local Chromium with fictional data and software WebGL. No new browser, physical-device, screen-reader, live generation, or production verification was performed during packaging.

The [provenance manifest](provenance.json) binds each original path and SHA-256 to its durable file. Images, GLBs, source JSON, and harnesses retain their bytes. Readable Markdown/log copies normalize display whitespace and artifact links; logs also remove terminal escape sequences. Every changed display copy has an exact original in `originals/`, compressed with deterministic gzip. Patch files are also stored as gzip so their significant diff whitespace remains intact. Decompress an original and compare its SHA-256 with `original_sha256` in the manifest to verify preservation.

The [cleanup record](verification/cleanup-record.json) lists the approved scratch-file dispositions. Twenty duplicate screenshots already had identical committed counterparts, and five Cursor files contained only failed authentication/security-challenge retrievals. The 48 other unique files concern earlier releases and were preserved in the private recovery archive outside the checkout, together with all originals and associated ignored logs. The recovery archive is separate from the application release and contains no repository environment or credential files.
