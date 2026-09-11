# Release attestation and durable Daily receipts

The Worker reports the source SHA supplied at release time and Cloudflare's
serving version id through unauthenticated `/v1/meta`. Each half is reported
independently; missing or malformed values become `null`. This route remains
available when `configGuard` refuses guarded HTTP, queue, and scheduled paths.
A correctly shaped SHA is a release declaration, not independent verification
that its named commit produced the bundle. Reconcile it with Workers Builds,
version/traffic observations, and the frozen local gate.

## Required deployment configuration

Both default and production Wrangler blocks declare `CF_VERSION_METADATA` and
reserve `0000000000000000000000000000000000000000` as the development SHA.
Outside development, missing, placeholder, or malformed SHAs fail closed.
Malformed present SHAs also fail in development. Daily model publication
requires both valid halves before calculation, R2, or provider work.

Workers Builds remains the automatic production release path. Before merging
this guard, update **both existing trigger commands**, retaining their current
build steps and production environment selection:

```bash
# Append to the existing main deploy command and the nonproduction versions upload command:
--var "RELEASE_GIT_SHA:${WORKERS_CI_COMMIT_SHA:?Missing Workers Builds commit SHA}"
```

`WORKERS_CI_COMMIT_SHA` is the actual Workers Builds CI commit. The shell check
refuses missing/empty values before Wrangler runs. Read back both configured
commands and preserve a dated record under an excluded evidence path. This
source/runbook change does not apply that setting or demonstrate adoption.
Wrangler's default and production config smoke test proves tracked declarations
only; observing an actual deployed SHA requires a later live check.

The existing bare `npm run deploy:api` and workspace deploy command do **not**
supply SHA and are insufficient under this guard. An authorized manual release
must use the exact reviewed, clean, gated checkout, retain the existing asset
build, and explicitly inject that checkout's commit:

```bash
# From the reviewed repository root; source and dependencies must match the gate.
test -z "$(git status --porcelain)" || exit 1
release_sha="$(git rev-parse --verify HEAD)"
test "$release_sha" = "$(git rev-parse --verify origin/main)" || exit 1
npm run check:validators -w @patternlike/api
npm run build -w @patternlike/web
npx wrangler deploy --config apps/api/wrangler.toml --env production \
  --var "RELEASE_GIT_SHA:${release_sha:?Missing reviewed commit SHA}"
```

`check:validators` is listed explicitly because the npm `predeploy` hook does not
cover this command, and does not cover the Workers Builds trigger either. Since
`apps/api/src/generated/*.js` became build output, a merge carrying stale
generated validators would deploy a Worker validating against superseded
contracts, and nothing at runtime would notice. Append the same check to both
configured Workers Builds trigger commands alongside the `RELEASE_GIT_SHA`
injection above. `npm run ci:local` already runs it through `prebuild`/`pretest`,
so a gated merge is covered; this line covers the manual path.

Rebuilding must preserve the gated source identity and asset inputs. The SHA
is an operator-supplied value; this command cannot itself authenticate that a
historical gate or remote observation was truthful. No manual release wrapper
or package deployment override is introduced by this port.

## Migration before compatible runtime

`0029_daily_publication_receipts.sql` follows current migration 0028. It is
forward-only and additive, adds one table and two named indexes, and rewrites
no prior rows. It is **not applied by source changes**. Both deterministic and
model-backed publication batches read this table, so apply it before the
compatible Worker. Preserve Save-aware deletion on any rollback.

Finish static docs and the prospective `MIGRATIONS.json` entry before the full
source gate. Then follow [repository release evidence](repository-release-evidence.md):
freeze included bytes; run `npm run ci:local` through the gate recorder; retain
its actual summary; obtain the authorized production backup/bookmark; rehearse
the gated migration over that backup; apply 0029; verify prior rows, columns,
indexes, foreign keys, integrity, and an empty `assertion_probe`; release the
compatible Worker; and observe metadata and traffic.

Record post-gate operational facts under `docs/reviews/`, `docs/superpowers/`,
or `output/`, and bind them through `release-reconciliation.mjs`. Do not append
an applied note to `MIGRATIONS.json` or edit static deployment docs after the
gate unless the gate is rerun. Offline reconciliation retains declared external
observations separately; it does not perform them or promote them to live proof.

## Receipt and privacy semantics

A success-only private publisher exchange carries the durable job id, stage,
attempt, executed model/prompt/effort, request/response plaintext hashes, token
counts, and the control plane's completion timestamp. Supported legacy `high`
and current `xhigh` commands retain their observed effort. The runner completion
contract and reader-facing `ProviderMetadata` are unchanged; internal provider
job coordinates never enter reader evidence or public responses.

`completeReading` validates reading/job/command/stage coordinates and writes
receipt, encrypted reading, evidence, audit, predecessor transition, and
succeeded/published job in one D1 batch. Closing assertions verify the exact
receipt coordinate and final job result. Constrained-model reservations require
one receipt; deterministic V1 explicitly supplies `null` and requires zero.
Missing schema, bad constraints, conflicts, and stale claims cannot commit a
partial publication. Duplicate delivery preserves the first receipt.

Receipts retain only the technical column allowlist: no user id, crypto
subject, prose, chart facts, local date, locale, consent, or provider request
handle, and no foreign keys. Provider cleanup removes both encrypted artifacts
and its control row; receipt hashes remain. Account erasure also removes the
reading, generic job, and Save state while retaining the receipt. The internal
`proveDailyPublication` helper requires an active published reading and its
succeeded/published job with matching command generation. It returns null after
erasure, invalidation, or supersession; a successor has its own receipt.

These records describe a validated provider/job exchange and release identity.
Hermetic tests do not certify a live provider call, deployed binding, upstream
account settings, installed runner, or reader lifecycle. Those need separately
authorized observations and their own evidence records.
