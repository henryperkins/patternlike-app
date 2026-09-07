# Dependency refresh merge review — 2026-09-07

This replaces the stale Dependabot PR #7 delta on the current source tree. API Hono advances to 4.13.7; direct API/web/signer Wrangler advances to 4.129.0; API and signer Workers Vitest pool advance to 0.22.0. The compatible workers-types dependency resolves to 5.20260907.1. API/web range conventions and signer exact pins are preserved.

Wrangler's workers-types peer requirement required the companion type update. The ontology signer's older exact toolchain pins otherwise retained Undici 7.28.0; aligning that toolchain removes the old chain. Cloudflare/Miniflare now resolve Undici 7.29.0. The pool retains its own declared Wrangler 4.124.0 dependency. No runtime, contract, license, or test configuration changed in this dependency batch.

The [implementation report](artifacts/2026-09-07-dependency-refresh/implementation-review.md) records primary release sources and exact focused checks. Clean npm ci preserved the lock hash; dependency graph validation, API typecheck, 18 real pool/Hono/signer RPC tests, six Wrangler config tests, signer typecheck, 19 signer tests and signer production-config dry-run build passed. The unchanged fast-uri and nanoid transitive audit findings remain outside this update.

The source-frozen full local gate and independent review will be attached before merging. GitHub Actions remains billing-locked. Local dependency compatibility does not prove a deployed Worker or installed runner revision.
