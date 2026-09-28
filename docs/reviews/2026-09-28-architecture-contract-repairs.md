# Architecture contract repairs, 2026-09-28

Status: implemented and independently reviewed; all 16 local gate lanes passed
and the final receipt verified with zero problems. Worktree branch: `fix/architecture-contract-handoffs`.
Original implementation base: `b5e5fc50673c94641cc6b930812c0398025c1207`.
The verification below records the original implementation; publication follow-up is recorded at the end.

## Scope and behavior

The first pass implements R01, R02, R03, R06, and the immediate R07 correction
from the supplied proposed-corrections document.

- One private/no-store policy precedes private API checks and survives errors.
  Health/meta exceptions and all authentication zones remain where they were.
  Service-worker asset caching respects private/no-store response directives.
- A typed Daily uncertainty plan names every supported stored reason. Exact
  birth time stays exact; missing/invented/duplicate disclosures fail. Request
  and command schema 0.5.1 plus new prompt/selection/validation pins bind this
  change. Older commands explicitly fail `policy_unsupported`; this does not
  reset exhausted generations or reinterpret historical published evidence.
- Portrait capabilities and actual automation grants are separate observations.
  Withdrawal works with generation disabled when grant/cancellation storage and
  ownership/write-safety checks allow it. Missing storage reports unknown.
  Protocol consent, cancellation, accepted retries, and completed assets retain
  their existing rules. Incompatible image work is screened before claiming;
  runtime compatibility and protocol checks still cover changes after preflight.
- Actual gate output uses one shared ASCII formatter/parser with sixteen required
  ordered lanes. Process exit, mandatory OpenAPI validation, and current source-map
  checks participate in passing evidence.
- Offline ontology compilation emits evaluator/regression false and verdict
  reject. Structural compilation is separate from release admission. No quality,
  human review, signing, or activation evidence is manufactured.

The local source-map [current pointer](../architecture/source-map/current.json)
selects a new immutable publication. Earlier map artifacts remain accessible
through Git history; five archive hashes were verified. The user's original
attachment remains unchanged.

## Review and focused verification

Independent review checked cache/authority ordering, transactional withdrawal,
unknown permission handling, no consent downgrade, uncertainty identity and
closed reason validation, compile-only admission, and gate summary strictness.
It identified two issues addressed in this pass: the full-packet generator's
obsolete policy overwrite and image compatibility being checked only after claim.

The repaired generator is executed in an isolated test checkout and validated
with the real engine. It preserves all 35 historical candidate objects; the
corpus now contains 38 controls. Regeneration is byte-idempotent and preserves
current version metadata and comment history.

Focused regression suites passed before the integrated gate: private API
boundaries 214; service worker 6; ontology builder 8; Pattern engine 7; Daily
engine 177; shared 107; Daily API integration 247; portrait API 80; portrait web
81; runner 193; full-packet generator 2. These counts describe overlapping focused runs,
not a single total. API portrait tests emitted a Cloudflare shutdown
`EnvironmentTeardownError` with zero assertion failures and process exit 0.

## Initial full local gate

The complete third run exited 0 at `2026-09-28T06:38:48.428Z`. Its
[passing receipt](artifacts/2026-09-28-architecture-contract-repairs/local-gate-03.json)
verified against the original implementation checkout with `passed: true`, no problems, and
deployment status `unverified`. This is one complete passing run, not a combined
result from earlier attempts. The [actual paste-ready summary](artifacts/2026-09-28-architecture-contract-repairs/local-gate-summary.txt)
was extracted from its retained log, `/tmp/patternlike-ci-local-final-03.log`.
The child-output SHA-256 in the receipt matches that log:
`cd8eea4e63976c4b889f454a075732c2f21e567d0d6322d3146b7af318d63afe`.

Source remained unchanged through the gate: 1,629 files, identity
`bc5442e7961cf0aeddc082018ca7b824c849393db0daedb8538ab0136190d5ff`. Built API, web, and runner artifacts also
match the verified receipt. Runtime was Node 22.23.2, npm 10.9.8, and Python
3.14.4; the gate records that ci.yml pins Python 3.12. No
`EnvironmentTeardownError` appeared in the final full run.

| Verification lane | Passing tests |
| --- | ---: |
| Shared | 107 |
| Daily engine | 177 |
| Calculation | 144 |
| Ontology signer | 19 |
| API primary suite | 2,803 across 155 files |
| API compatibility | 1 |
| API script suites | 40 |
| Web | 913 across 64 files |
| Pattern engine | 7 |
| Runner | 193 |
| Content and release tooling | 83 |
| Source-map tooling | 74 |

Contracts/OpenAPI, dependency/ephemeris checks, typechecking, all builds, and
the current-map check also passed. The map capture has 8 branches, 49 topics,
172 claims, 947 evidence selectors, and 253 referenced files, with identity
`e7941bceae09b4a825beb7b789bb8320ce30a310d25bb11ddbe538dcba38d5c2`.

```text
==== SUMMARY ====
commit  b5e5fc5 on fix/architecture-contract-handoffs
note    local 3.14.4, ci.yml pinned 3.12
PATTERNLIKE_CI_SUMMARY_V1_BEGIN
node v22.23.2 npm 10.9.8 python 3.14.4
pass	contracts: npm run test:contracts
pass	monorepo: npm ci (install or dry-run)
pass	monorepo: ephemeris download
pass	monorepo: npm run typecheck
pass	monorepo: test @patternlike/shared
pass	monorepo: test @patternlike/reading-engine
pass	monorepo: test @patternlike/calc-stub
pass	monorepo: test @patternlike/ontology-signer
pass	monorepo: test @patternlike/api
pass	monorepo: test @patternlike/web
pass	monorepo: npm run build
pass	extra: test @patternlike/pattern-engine
pass	extra: test @patternlike/codex-runner
pass	extra: npm run test:content
pass	extra: npm run test:source-map
pass	extra: npm run map:check:current
PATTERNLIKE_CI_SUMMARY_V1_PASSED
PATTERNLIKE_CI_SUMMARY_V1_END
```

### Retained failed attempts

The [first receipt](artifacts/2026-09-28-architecture-contract-repairs/local-gate.json)
correctly rejected a stale generated fingerprint after the runner edit, blocking
API pretest and build. Regeneration produced
`sha256:0a244c77be0511b06724f4be89e8c572c2f8887c611a9406ea7965f88003a905`.
Its log remains `/tmp/patternlike-ci-local-final.log`.

The [second receipt](artifacts/2026-09-28-architecture-contract-repairs/local-gate-02.json)
correctly rejected one configuration fixture still naming the old prompt pin.
The other 2,802 API assertions and 15 gate lanes passed. Updating that fixture
to 1.1.0 passed all 142 focused configuration tests, then the compatibility and
script suites. Logs remain `/tmp/patternlike-ci-local-final-02.log`,
`/tmp/patternlike-config-final.log`, and `/tmp/patternlike-api-tail-lanes.log`.
Neither failed run supplies the final passing claim above.

## Limits and remaining work

Local tests use fixtures and do not establish a deployed release, live migrations,
installed runner compatibility, real provider output quality, or device-browser
coverage. The initial implementation pass included no commit, push, merge, deployment,
production mutation, provider evaluation, ontology signing, or activation.

Stored `birth_instant/technique_specific` does not preserve which historical-zone
or ambiguous-time diagnostic caused the qualification. The new disclosure stays
at the actual stored precision.

Generation-aware operator repair (R04), category-specific feedback applicability
(R05), additive navigation (R08), and the wider ontology coverage/evaluation/review/
activation workflow remain later work. Calculation replay and weighted single-job
scheduling are retained.

The primary checkout later showed separate uncommitted navigation edits in
App/AppShell/Timing/TimeTravel and their tests. Those bytes were left intact and
are outside this worktree receipt. Integrating with them requires a fresh gate.

## PR publication follow-up

The user subsequently authorized committing, pushing, and opening a PR. Before
publication, the original passing receipt and source-map snapshot were verified
again with zero problems. Main had advanced to
`0f83713a31dbb62070342f0adb3111117c7b3e53`, containing the separate navigation
changes noted above. The PR branch was rebased onto that committed base, and a new source-map
snapshot was captured at `aa6d7922263a31e60ddba5ef3d2ac8e9250594ec`. PR #70 was
opened with the combined-tree gate explicitly pending; the completed result
follows.

PR screenshot evidence uses the actual `PortraitAutomationControl` and styles
in a temporary local Vite harness with mocked API responses. The Browser plugin
was unavailable; installed Playwright 1.62.1 was used. Chromium at 1100×820
showed an enabled grant with generation disabled and successfully sent one
withdrawal with consent policy 2.0.0. At 390×844, unknown permission displayed
no checkbox; “Check again” issued a second GET and no mutation. Both pages had
meaningful content, no framework overlay, no horizontal overflow, and no browser
console or page errors. These are component-fixture checks, not authenticated
end-to-end or deployed-service evidence.

- [Withdrawal with generation disabled](artifacts/2026-09-28-architecture-contract-repairs/portrait-withdrawal-desktop.png)
- [Unknown grant on mobile](artifacts/2026-09-28-architecture-contract-repairs/portrait-unknown-mobile.png)
- [Browser fixture results](artifacts/2026-09-28-architecture-contract-repairs/results.json)

### Combined-tree gate for PR #70

The uninterrupted gate on `3c86d9520f7e6fa3468ccba084a0c593a777f361` exited 0
at `2026-09-28T07:35:42.307Z` with all 16 required lanes passing. The
[PR gate receipt](artifacts/2026-09-28-architecture-contract-repairs/local-gate-pr.json)
verified with `passed: true`, no problems, and deployment status `unverified`.
The [actual summary](artifacts/2026-09-28-architecture-contract-repairs/local-gate-pr-summary.txt)
was extracted from `/tmp/patternlike-ci-local-pr.log`; the retained child output
matches SHA-256 `88f36f82f710fb4144a2f43f982aeb81cdcff7ea87b8992cc23ae8564b12cfaa`.

Source remained unchanged throughout the run: 1,633 files,
identity `108e1a9b85bc5128ab2d26c2552999ca91f81299e5526036d627847402e7b05f`.
The API suite passed 2,803 primary assertions plus compatibility/script checks.
The current source-map identity is
`42fa2a485b5339bab0c8bd5c996e28bda785fbee643d03890e1ba320cda52a6f`; all
consumed inputs were clean at capture. The evidence commit changes only
`docs/reviews/`, which is explicitly outside the gate's source identity scope.

[PR #70](https://github.com/henryperkins/patternlike-app/pull/70) targets main.
The branch and worktree are retained for review. No merge or deployment was
performed as part of this publication follow-up.
