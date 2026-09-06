# Reading assurance — September 6, 2026

> Later September 6 follow-up: [additional review claims and new evidence](./2026-09-06-review-claims-followup.md). The record below preserves this earlier pass; its ordinary-text isolation, operational pause, and provider-observation gaps are updated in the follow-up.

Scope: the approved local corrections in
`codex/claim-publication-assurance`, based on `50f452a`. The earlier read-only
verification used `eccddccfc48b50231228730534a84bde4b7fa32e`. This work does not
merge, push, deploy, apply migrations, invoke a model, change an account setting,
or exercise a production user account.

## Findings and implementation evidence

The earlier Daily reproduction confirmed that the validator accepted incorrect
Sun/sign, transit/natal participant, aspect relationship, degree, and event-time
claims when all named words appeared somewhere in the selected fact vocabulary.
Citation membership was checked separately. Input projection also discarded
some subject/target and event roles. The implementation design therefore binds
actual factual prose to role-preserving cited records and versions the policy,
instead of relying on a separate model-authored claim ledger.

The Pattern review found that the authored `synthetic_internal` admission route
does not run the machine release's regression-corpus gates. Existing writer
shape/word checks, semantic verification, and publication proof remain relevant
protections. The approved correction adds common per-document deterministic
safety for both origins over the bound candidate artifacts. A passing document
and a passing release regression corpus remain distinct evidence.

| Work | Evidence status |
| --- | --- |
| Daily relational claim support and policy/prompt update | Implemented: a complete bounded factual sentence must match one cited authoritative record; provider output with swapped placements or reversed roles is rejected before publication. |
| Shared Pattern publication safety, proof binding, and retry/replacement behavior | Implemented for both origins over the bound packet, plan, writer, current verifier attempt, verified corpus, and public projection; unsafe replacement retains the previous readable document. |
| Corpus provenance | Implemented repository-side: all 60 fragments retain model-generated first-party origin, whole-file and per-fragment hashes, explicit unknown historical generation fields, and incomplete human certification. |
| Local release evidence | Implemented repository-side: actual aggregate child exit and 14-lane summary, source snapshots before/after, build hashes, configuration pins, and migration source identity. Deployment and applied migration observations remain unverified. |
| Provider privacy | Source processing boundaries documented; actual account category/data-use/retention controls and installed-host/lifecycle observations remain unverified. |

The [provenance sidecar](../../pattern-corpus/provenance.json),
[integrity guide](../../pattern-corpus/README.md), and
[validator](../../pattern-corpus/provenance.mjs) preserve the corpus's actual
state. The existing `licensed_excerpt` decision is a publication-rights
classification. It is not evidence of human authorship or review, recovered
generation history, external interpretation sources, or public readiness.
`source_supported` can demonstrate consistency with a fixed generated fragment;
it does not independently establish the truth of psychological interpretation.
Calculated coordinates and reflective interpretation have different evidence.

## Policy freeze and compatibility

| Configuration | Previous | This source |
| --- | --- | --- |
| Daily prompt | `1.0.2` | `1.0.3` |
| Daily selection / validation | `1.0.0` / `1.0.0` | `1.1.0` / `1.1.0` |
| Daily synthetic evaluation corpus | `1.0.3` | `1.1.0` |
| Pattern writer prompt | `1.0.2` | `1.0.3` |
| Shared Pattern publication safety | absent | `1.0.0` |

Public/provider schema IDs and JSON shapes remain unchanged. Internal Daily
support retains original calculation records; the existing provider fields now
label event roles and include normalized UTC timestamps. An exact event, sampled
position, start, and end remain distinct. `NormalizedCycle.orb_deg` is the
configured envelope limit, while natal-aspect orb is measured separation. Day
membership uses numeric instants and a half-open interval, including equivalent
RFC3339 offsets and fractional-second formatting.

The Daily validator consumes an entire bounded factual sentence with explicit
participants and supported modifiers. Reflection uses separate sentences. It
rejects combined or unparsed factual syntax, indirect event references, borrowed
values, missing citations, remote natal qualifiers, and unsupported uncertainty
disclosures. This can refuse fluent but unsupported forms; a fresh provider
sample must measure acceptance and reading quality before release. These checks
do not establish universal English entailment or psychological truth.

Previously stored readings keep their historical provenance. Existing frozen
Daily commands carrying superseded prompt or policy versions fail
`policy_unsupported` before another provider job. Pattern commands also bind the
updated creation-source fingerprint; an old command cannot acquire new safety
semantics while retaining its old recorded source. No migration is required.

The evaluation corpus retains all 17 historical candidate payloads, all five
historical qualitative payloads/flags, and all six profiles. Six former accepts
now have explicit rejection expectations; six new acceptance controls, eight
adversarial cases, and one qualitative-only control accompany them. This is
synthetic revalidation, not generation from the current live provider.

Pattern source dependencies now require the matching registered corpus object
and fragment index at publication even for the authored route. Missing or
unverifiable corpus evidence fails closed. Production availability of those
objects was not inspected in this work and must be checked before release.
The same seven safety categories run for both origins; that does not turn an
authored release into a certified machine-pipeline release.

## Historical source comparison

The recorded frozen manifest from the portrait-automation gate lists 1,183
paths and declares a manifest SHA-256 of
`8c9d5e3aababcf8ffcabbc3876a9ae480b2765105a7ce7e0ee85aa9fe266ac70`.

| Comparison retained from the read-only verification | Result | Scope |
| --- | --- | --- |
| [`ce524431ee18f955a7105bfb2ba573000eb5b625`](./artifacts/2026-09-06-reading-assurance/frozen-source-worker-commit-comparison.json) | 1,183/1,183 listed paths matched, none missing | Recorded source-byte relationship to the prior test snapshot. No current Worker or runner observation. |
| [`eccddccfc48b50231228730534a84bde4b7fa32e`](./artifacts/2026-09-06-reading-assurance/frozen-source-comparison.json) | 1,179/1,183 matched, four changed, none missing | The changes are `CLAUDE.md`, `portrait-mesh-invocation.ts`, its test, and `MIGRATIONS.json`. |

The prior manifest excludes `output/`, `docs/reviews/`, and `docs/superpowers/`.
Later-added paths are outside those historical comparisons. The first row
does not establish that the currently running Worker contains that commit,
that its assets match, or that the installed runner has the tested artifact.

The unrelated `/home/henry/patternlike-release-truth` worktree on
`feat/release-truth-attestation` was inspected read-only before implementation.
It contains uncommitted runtime/source attestation and durable Daily receipt
work. No files were changed there and no commits or migration were imported.
The new [repository evidence tool](../deploy/repository-release-evidence.md)
covers the local aggregate run without asserting those runtime changes shipped.

## Verification record

Task 3 regressions first reproduced missing provenance enforcement, then passed
with the validator in place. Focused provenance tests reject content/metadata
drift, missing or duplicate fragment records, relabelled origin, unsupported
generation fields and invented human certification. Release evidence tests run
a real child `npm run ci:local` in a synthetic temporary Git repository; they
reject incomplete or duplicated lane summaries, nonzero exit, source drift,
artifact replacement, and promotion of partial deployment evidence. These
synthetic tool tests do not claim the application aggregate gate has passed.

The focused final Daily reading-engine suite passed 152/152, the durable Daily
executor passed 58/58, and the frozen evaluation suite passed 48/48. API and
reading-engine typechecks passed. Final Pattern safety/proof/regression/executor
and route suites passed 204/204 across eight files. Independent probes passed
38/38 for Daily and 43/43 for Pattern, including all 30 authored regression
fixtures. These focused counts are separate runs and are not summed into a
unique aggregate total.

Review follow-ups covered complete factual sentence parsing, measured versus
configured orb, exact/sampled event roles, indirect factual clauses, qualified
birth-time disclosure, RFC3339 normalization, and half-open local-day edges.
Pattern follow-ups covered alternative Moon-placement phrasing, Unicode format
characters, compact unledgered placements, body aliases, and writer-reference
correction without relaxing source-authority failures.

The frozen Pattern creation fingerprint is
`sha256:4783da4aee372fe62b0943b72cb4dc1ba5e101d8041ea69eb0e7503c167dfeeb`
over 26 listed sources. The first aggregate attempt passed 13/14 lanes and exited 1. The API lane
reported 2,442 passing tests and one existing birth-profile retry concurrency
assertion failure: both responses were 502. Its immediate calculator failure
allowed the first request to close before the second request read the failed
job; that is a subsequent retry under the existing route contract. The test now
uses the existing hermetic calculator peer barrier, holds the winning
calculation open until the competing request returns 202, and retains all
single-attempt, charge, profile and invocation assertions. The complete birth
integration suite passed 73/73 after this test-only correction; API typecheck
and the generated source check also passed. Production birth behavior was not
changed. Independent source review confirmed that duplicate calculator calls
would release each other and fail the required 202 assertion. The fixture
establishes overlap during calculation; it does not force both callers to read
the failed row before either claims it, which was also outside the original
fixture guarantee. The [initial receipt](artifacts/2026-09-06-reading-assurance/local-gate.json)
and [failed summary](artifacts/2026-09-06-reading-assurance/ci-local-initial-summary.txt)
are retained as failed evidence.

The second aggregate attempt also passed 13/14 lanes and exited 1. Its
birth concurrency test passed, while the existing unpublished-reservation test
in `readings.integration.test.ts` observed HTTP 200 instead of 404. Source
inspection found that its supposedly withheld delivery actually called the
live Miniflare queue producer, which could publish concurrently with the
assertion. The route itself only reads published rows. The suite now uses the
existing `SILENT_READING_QUEUE` for fixture enqueues and retains explicit real
queue-handler delivery and captured-send assertions. The pending test checks
both pending status and null ciphertext before and after GET, then confirms
HTTP 200 only after explicit publication. All 69 reading-route tests passed;
independent source review found no blocking concern. The
[second receipt](artifacts/2026-09-06-reading-assurance/local-gate-02.json) and
[second failed summary](artifacts/2026-09-06-reading-assurance/ci-local-second-summary.txt)
retain the failed result. Neither fixture correction changes production code.

The [third receipt](artifacts/2026-09-06-reading-assurance/local-gate-03.json)
is an intentionally interrupted run, not passing evidence. The final wording
review corrected the distinction between encrypted provider-response storage
and Daily publication, and clarified that the local gate exercises test
databases. The deployment guide is included in the measured source, so its
wording correction required a new freeze and aggregate run.

The final aggregate run passed all 14 lanes and exited 0, from
`2026-09-06T11:39:06.164Z` to `2026-09-06T11:56:54.517Z`. The
[final receipt](artifacts/2026-09-06-reading-assurance/local-gate-04.json) and
[fresh verification result](artifacts/2026-09-06-reading-assurance/local-gate-04-verification.json)
bind the unchanged source, observed builds, configuration pins and migration
source hashes. Verification returned `passed: true`, no problems, and
`deployment_status: unverified`.

| Final aggregate test lane | Recorded result |
| --- | --- |
| Shared | 82/82 |
| Daily reading engine | 152/152 |
| Calculation service | 144/144 |
| Ontology signer | 19/19 |
| API | 2,443/2,443 across 139 files, plus 1 compatibility and 31 operator-script tests |
| Web | 582/582 across 46 files |
| Pattern engine | 7/7 |
| Codex runner | 118/118 |
| Content and release tooling | 35/35 |

The toolchain was Node `v22.23.2`, npm `10.9.8`, and Python `3.14.4`.
`ci.yml` pins Python `3.12`; the aggregate summary explicitly records that
local difference. The API log also contains a workerd/Vitest teardown message,
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending`.
The API and aggregate exits were zero with every test passing. The origin of
that runtime warning remains unresolved.

The source manifest contains 1,208 files on an explicitly
uncommitted worktree based on `50f452a66fb1cc6c7f88f95b297b3bc7b0b1e01b`:
`23a2529dcef919cb8ff7474aefb8f3325aeefabeac77ac0627827576670878e3`. It was unchanged during the gate.
The 24 observed files under Worker, web and runner build directories have
aggregate manifest hash `80b97baeb218e0e5481d0bf1cc09fa54de14720457f1202c11f94a4e358e4541`.
These are local build observations; no deployed artifact is inferred.

The [paste-ready summary](artifacts/2026-09-06-reading-assurance/ci-local-summary.txt)
contains the actual aggregate output:

```text
════════════════════ SUMMARY ════════════════════
commit  50f452a on codex/claim-publication-assurance
node    v22.23.2   npm 10.9.8   python 3.14.4
note    local 3.14.4, ci.yml pinned 3.12

  pass   contracts: npm run test:contracts
  pass   monorepo: npm ci --dry-run (lockfile agrees with package.json)
  pass   monorepo: ephemeris download
  pass   monorepo: npm run typecheck
  pass   monorepo: test @patternlike/shared
  pass   monorepo: test @patternlike/reading-engine
  pass   monorepo: test @patternlike/calc-stub
  pass   monorepo: test @patternlike/ontology-signer
  pass   monorepo: test @patternlike/api
  pass   monorepo: test @patternlike/web
  pass   monorepo: npm run build
  pass   extra: test @patternlike/pattern-engine
  pass   extra: test @patternlike/codex-runner
  pass   extra: npm run test:content

ALL STEPS PASSED — safe to merge on local evidence.
```

To verify the recorded local source and builds again, run:

```bash
node scripts/pattern-release/release-evidence.mjs verify \
  docs/reviews/artifacts/2026-09-06-reading-assurance/local-gate-04.json
```

Completing excluded review evidence after the run does not change the tested
source manifest. Editing included source requires another gate. Changes remain
uncommitted on the isolated branch; no merge, push or deployment was performed.

## Outstanding external evidence

The [provider privacy evidence record](../deploy/codex-provider-privacy-evidence.md)
describes separate text, image, mesh, preview, temporary-file and upstream
processing boundaries. Ordinary text execution inherits the Codex home and
checks login exit status; portrait/mesh execution adds explicit ChatGPT and
configuration checks. Neither path establishes current account data-use or
retention settings. There were no account lookups or provider calls in this work.

The corpus's historical provider/model/account/date record, applicable account
terms, counsel review, and attributable human certification for every fragment
remain outstanding. A future account observation or new corpus edition cannot
retroactively fill the missing historical record.

A separately authorized production release and test-account lifecycle exercise
must establish exact Worker/assets/runner identity, traffic allocation, applied
migrations, executed model/prompt/policy pins, terminal publication, saved-asset
reuse, consent withdrawal during unfinished work, deletion, and late-upload
cleanup. Preserve content-free dates, hashes, statuses and bounded coordinates;
do not place private prompts, prose, images, credentials, or account details in
the repository. The operational stop-new-Pattern-work switch and issuer
continuity remain separate work.
