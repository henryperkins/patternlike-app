# Dependency refresh merge review — 2026-09-07

This replaces the stale Dependabot PR #7 delta on the current source tree. API Hono advances to 4.13.7; direct API/web/signer Wrangler advances to 4.129.0; API and signer Workers Vitest pool advance to 0.22.0. The compatible workers-types dependency resolves to 5.20260907.1. API/web range conventions and signer exact pins are preserved.

Wrangler's workers-types peer requirement required the companion type update. The ontology signer's older exact toolchain pins otherwise retained Undici 7.28.0; aligning that toolchain removes the old chain. Cloudflare/Miniflare now resolve Undici 7.29.0. The pool retains its own declared Wrangler 4.124.0 dependency. The root Node engine floor now matches the toolchain requirement (>=22), and install-script approvals name both resolved workerd versions. No runtime, contract, license, or test configuration changed in this dependency batch.

The [implementation report](artifacts/2026-09-07-dependency-refresh/implementation-review.md) records primary release sources and exact focused checks. Clean npm ci preserved the lock hash; dependency graph validation, API typecheck, 18 real pool/Hono/signer RPC tests, six Wrangler config tests, signer typecheck, 19 signer tests and signer production-config dry-run build passed. The unchanged fast-uri and nanoid transitive audit findings remain outside this update.

The [independent spec and quality review](artifacts/2026-09-07-dependency-refresh/independent-review.md) passed after the install-policy correction. The initial full local gate and the later verification-scope change are recorded below. GitHub Actions remains billing-locked. Local dependency compatibility does not prove a deployed Worker or installed runner revision.

## Install-policy review correction

Independent review found that the exact install-script map still approved only the removed workerd version. With Node 22.23.2 and npm 11.19.1, `npm ci --strict-allow-scripts` reproduced `ESTRICTALLOWSCRIPTS` for precisely workerd 1.20260815.1 and 1.20260903.1. After updating those two exact approvals, the same clean install passed and `npm install-scripts ls` reported no unreviewed scripts. Both installed native workerd binaries ran and reported their expected release dates. The lockfile changed only for the deliberately corrected root Node engine metadata, not during the install.

This is evidence for enforced script approval. Ordinary npm 11 defaults are not asserted to skip every unapproved script; the [npm 11 approval documentation](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/) distinguishes advisory behavior. No blanket script approval or global npm configuration change was used.

## Initial full gate and final source integration

The initial candidate at `24e66d74d2f91372bcbec1ba928c44c81717818b` passed all fourteen local gate lanes with unchanged included source and a verified receipt. The [initial summary](artifacts/2026-09-07-dependency-refresh/ci-local-summary-initial.txt) and [receipt](artifacts/2026-09-07-dependency-refresh/local-release-evidence.json) remain valid evidence for that candidate. The preceding UI batch subsequently corrected a test's total budget for two bounded scene loads. A replacement full gate started after integration, then was interrupted when the user limited tests to the 3D Pattern animation work. The [interruption record](artifacts/2026-09-07-dependency-refresh/task-3-interrupted-gate.json) preserves its nonpassing status. No replacement full gate will run under that instruction, and the earlier receipt will not be substituted for final-candidate coverage. Final integration will compare the reviewed dependency bytes and verify only the affected portrait tests and build. Broader final-candidate regression coverage is intentionally absent.

## Final portrait integration under the user test restriction

At source commit `3f216879e142146e9bf933348b119068c8b402ea`, the final portrait collision/header correction (`8b93868`) is integrated. All five independently reviewed dependency files remain byte-identical. The two affected portrait files passed **29/29 tests**, and `npm run build:portrait -w @patternlike/web` passed. The included source was unchanged across verification (SHA-256 `5a8ab5de7b25af99890cc705cf803edef721b50a1397c31cd6714df88b8dbee2`); the final observation records all 26 portrait build artifacts.

The earlier nine-file portrait result (119/119) and initial build remain prior-candidate evidence. The original full gate passed on its recorded earlier source; the later replacement gate was interrupted by the user's test-scope instruction. **No full gate or unrelated dependency test suite was run on this final candidate.** Only the two portrait test files affected by the final geometry change were rerun; this does not claim a new nine-file or full-repository pass.
