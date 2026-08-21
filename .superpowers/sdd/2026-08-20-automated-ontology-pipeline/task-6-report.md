# Task 6 implementation report

## Status and scope

Task 6 is implemented through the successful evaluating prefix. The queue now
drives the existing Task 5 claim/CAS/outbox/artifact protocol through
`reserved -> corpus_reading -> generating -> compiling -> evaluating ->
regressing`. The implementation does not execute regression, sign, ingest,
activate, write the immutable `0011` evidence receipt, or mark a run
`succeeded`.

Base commit: `26e969469cf74ff80de26aaee908307db5312161`.

Planned commit subject: `api: generate compile and evaluate ontology candidates`.
The report is part of that commit, so its resulting SHA is reported to the
controller after the commit rather than self-referenced here.

## Files and public interfaces

- `apps/api/src/services/ontology-pipeline-execute.ts`
  - Adds `executeOntologyPipelineDelivery(env, message, options?)`.
  - Adds the closed `OntologyPipelineExecuteOutcome` disposition union.
  - Composes Task 3 corpus reading, Task 4 packet/publisher interfaces, and the
    Task 5 public claim, retry, cursor transition, named-stage transition,
    terminal failure, usage reservation, outbox, and encrypted artifact
    services.
  - Uses D1 only for read-only run/artifact inventory queries needed to rebuild
    ordered evidence. All writes remain behind Task 5 public primitives.
- `apps/api/src/services/ontology-evaluation.ts`
  - Adds verdict assessment, deterministic compiler-source closure summaries,
    and canonical evaluation report creation.
- `apps/api/src/queue.ts`
  - Replaces Task 5's enabled retry-only seam with the Task 6 executor.
  - Acknowledges committed progress, terminal results, and duplicates; retries
    provider reschedules using their closed delay and uncertain failures after
    the lease boundary.
- `apps/api/src/services/ontology-pipeline-execute.test.ts`
  - Adds hermetic, provider-free end-to-end delivery fixtures.
- `apps/api/src/services/ontology-evaluation.test.ts`
  - Adds nine-dimension, verdict-only, closure, ordering, and canonical-report
    tests.
- `apps/api/src/queue.test.ts`
  - Proves enabled routing commits and acknowledges the first deterministic
    stage while preserving rollout-off and malformed-message behavior.

No Task 5 public interface, migration, frozen contract, Wrangler binding, or
environment type was changed.

## Exact stage and cursor transitions

Every transition is guarded by the full live Task 5 claim tuple: run, stage,
stage generation, stage cursor, stage attempt, and opaque claim token. Named
stage/cursor progress resets the attempt to zero and emits a new opaque outbox
nudge only after the D1 CAS commits.

| Delivery owns | Validated work | Provider maximum | Artifacts at owned coordinate | Committed successor |
| --- | --- | ---: | --- | --- |
| `reserved`, `g=0,c=0,a=0` | Exact frozen command/current configuration equality | 0 | none | `corpus_reading`, `g=1,c=0,a=0` |
| `corpus_reading`, `g=1,c=0,a=0` | Registered corpus identity, bytes, hash, license, public capability, object key | 0 | none | `generating`, `g=2,c=0,a=0` |
| `generating`, `g=2+c,c,a` non-final | Exact chunk/response adoption or one generator pass | 1 | `generator_request`, `generator_response`, `candidate_chunk` | same stage, `g+1,c+1,a=0` |
| `generating`, `g=2+c,c,a` final | Exact contiguous chunks from generation 2, only last `complete=true`, unique ids, registered fragments, locale, and every frozen coverage target | 1 | same generation classes | `compiling`, `g+1,c=0,a=0`, carrying candidate plaintext hash |
| `compiling`, `g,c=0,a=0` | Rebuild byte-identical candidate; call unchanged `compileOntologyRelease`; retain every record/finding | 0 | `candidate_release`, `compilation_report` | `evaluating`, `g+1,c=0,a=0`, carrying compilation report hash |
| `evaluating`, `g=start+c,c,a` non-final | Exact candidate rule, permitted evidence, compiler closure, one nine-dimension verdict | 1 | `evaluator_request`, `evaluator_response`, `evaluator_verdict` | same stage, `g+1,c+1,a=0` |
| final `evaluating` rule | Candidate length/order proves finality; all ordered verdict artifacts re-read and re-assessed | 1 | same classes plus `evaluation_report` | `regressing`, `g+1,c=0,a=0`, carrying evaluation report hash |

Generation completion is never trusted from a loose flag alone. A
`complete=true` chunk closes generation only if the exact persisted generation
range starts at generation 2, is gap-free and single-valued, all earlier chunks
are incomplete, the final chunk alone is complete, and the reconstructed
records satisfy frozen identity, source, locale, and coverage policy.

Evaluation finality is derived from the compiler-approved candidate record
order and `stage_cursor`; no delivery count or provider finality field is used.
Missing, duplicate, out-of-order, wrong-identity, unreadable, compiler-rejected,
or policy-invalid evidence terminally fails the whole run with a closed class.

## Artifact-first adoption and provider accounting

Task 6 creates no encryption, accounting, retry, or transition implementation.
It uses the Task 5 artifact service for all nine classes in its prefix:

- generating: `generator_request`, `generator_response`, `candidate_chunk`;
- compiling: `candidate_release`, `compilation_report`;
- evaluating: `evaluator_request`, `evaluator_response`,
  `evaluator_verdict`, `evaluation_report`.

The provider delivery order is fixed:

1. Claim the exact generation through Task 5.
2. Validate the immutable command/current configuration and registered inputs.
3. Probe the exact attempt-scoped canonical chunk/verdict artifact.
4. If absent, probe and authenticate the exact attempt-scoped raw response.
5. If either exists, parse it and derive/store any missing canonical artifact;
   no reservation or provider call occurs.
6. Only with neither response nor canonical output present, construct and store
   the request artifact.
7. Invoke the Task 4 publisher once. Its existing sole fetch calls the injected
   shared daily usage reservation immediately before network fetch.
8. Store the exact raw response before deriving/storing the canonical
   chunk/verdict.

An R2-first torn write is adopted only after Task 5 decrypts and authenticates
the complete artifact identity. A crash after the raw provider response thus
reconstructs the missing chunk or verdict without another call or charge. A
true provider retry uses Task 5 `retryOntologyPipelineStage`, increments
`stage_attempt`, changes artifact id/object key, retains the consumed charge,
and may make at most one new call. Cursor/stage advances reset the attempt.

Budget exhaustion is terminal and consumes no call beyond already reserved
calls. Retryable provider transport/output failures use the existing attempt
counter and delayed CAS. Stale or duplicate deliveries acquire no work and make
no provider call.

D1 stores only immutable command configuration, closed run state, attempt and
cursor coordinates, object pointers, and hashes. Corpus, candidate, provider
response, rule, verdict, and report bodies exist only in authenticated encrypted
artifacts.

## Candidate and compiler behavior

The complete candidate is reconstructed deterministically from exact ordered
canonical chunks and frozen command/corpus fields. It receives a candidate-only
bundle hash and remains encrypted, unsigned, and unavailable to ingestion.
The frozen release/compiler contract requires a pre-gate evaluation scaffold;
that scaffold cannot authorize activation because the run has no regression,
signature, ingestion receipt, immutable evidence row, or successful terminal
transition.

The compiling delivery calls the existing `compileOntologyRelease` unchanged.
It neither normalizes, filters, reorders, retries around, nor drops records. The
canonical compilation report binds the full candidate plaintext hash, compiler
policy version, Boolean result, ontology version, and every ordered closed
finding code. The report is stored before a failed compiler verdict terminally
fails the run, preserving evidence of the complete rejected candidate.

Later evaluation deliveries re-read the one candidate artifact and one compiler
report artifact and require their hashes to equal the guarded run hashes.
Candidate parsing reconstructs a typed release only after exact canonical bytes,
strict record schema, exact pre-gate evaluation/provenance shape, and the
unchanged compiler all accept it; the reconstructed canonical bytes must remain
identical.

## Independent evaluation and canonical report

Each evaluator packet contains exactly one ordered candidate rule, the
deterministic transitive closure of its cited source-supported meanings, the
registered permitted corpus fragments those meanings cite, and the compiler
summary. Task 4's strict schema has no edit, patch, replacement, rationale, note,
or advice field.

`assessOntologyRuleVerdict` requires the exact rule id and Task 4's strict
verdict schema. That schema requires all nine frozen dimensions and enforces
`verdict=pass` if and only if every dimension passes. Any valid rejection is
stored and immediately terminal with `evaluation_rejected`; it never enters the
provider retry path and cannot be retried into acceptance.

The canonical evaluation report includes and binds:

- Task 9 compatibility fields: schema/ontology versions,
  `compiler_passed=true`, `evaluator_passed=true`, and
  `unevaluated_fixture_count=0`;
- registered corpus release id/hash, locale, license class, public capability,
  and object key;
- the complete candidate artifact plaintext hash;
- frozen configuration hash;
- compiler pass result, compiler policy version, and compilation report hash;
- every rule id and verdict plaintext hash in exact candidate order;
- generator and evaluator model, reasoning, prompt version, timeout, and output
  token ceilings;
- input byte ceiling and explicit generator/evaluator configuration equality;
- frozen regression fixture count, maximum calls per fixture, and minimum pass
  threshold.

The report is JCS-canonical and encrypted through Task 5. Attempt zero retains
Task 9's legacy `ontology-evaluation-artifact/v1` envelope and fixed
`evaluation-report.enc` object key. A true retry uses Task 5's generic complete
attempt-scoped envelope/key. Tests cover both paths, and Task 9's existing
compatibility lane is green.

After storing the report, only its plaintext hash is published through the
guarded `evaluating -> regressing` transition. Task 6 performs no work in any
downstream stage and never sets `succeeded_at`.

## Queue and closed-error behavior

Rollout-off routing is unchanged and still durably pauses before a claim, R2,
keyring, decryption, or provider-budget access. Malformed bodies and ontology
bodies on another queue acknowledge closed. Enabled exact bodies delegate to
the executor. `advanced`, `duplicate`, and `terminal` acknowledge;
`rescheduled` and uncertain `retry` dispositions use closed integer delays.
Unexpected queue errors log only the existing closed `execution_error` class
and delay beyond the lease. No corpus text, candidate rule, rationale, provider
body/message, or private identifier enters logs or errors.

## TDD evidence

### BASE RED

Before production files existed, the focused command was run against BASE:

```text
npm exec -w @patternlike/api -- vitest run \
  src/services/ontology-evaluation.test.ts \
  src/services/ontology-pipeline-execute.test.ts
```

Result: exit 1. Both suites failed independently because
`./ontology-evaluation.js` and `./ontology-pipeline-execute.js` did not exist.
The test groups already covered nine-dimension closure and verdict-only output;
canonical report binding; deterministic zero-provider prefix; completion versus
coverage; ordered chunks/gaps; raw-response crash adoption; true retry and
attempt identity; budget exhaustion; unchanged compiler rejection; one-rule
semantic rejection; exact seven-day expiry; attempt-zero report; Task 9 retry
report; and stop-before-downstream behavior.

The queue integration was separately driven RED before its production edit:

```text
npm exec -w @patternlike/api -- vitest run src/queue.test.ts \
  -t "routes enabled work through"
```

Result: exit 1; the old Task 5 seam retried the enabled message instead of
committing/acknowledging `reserved -> corpus_reading`.

### Focused GREEN

Final focused result:

```text
npm exec -w @patternlike/api -- vitest run \
  src/services/ontology-evaluation.test.ts \
  src/services/ontology-pipeline-execute.test.ts
```

Result: 2 files passed, 17 tests passed. The final suite includes both generator
and evaluator response-only crash recovery, proving missing canonical
chunk/verdict derivation without a second reservation or call.

Final executor plus queue result: 3 files passed, 22 tests passed.

## Verification evidence

Authoritative settled-tree gates:

- Affected Task 3/4/5/9 plus queue/scheduled compatibility command: 15 files,
  289 tests passed.
- `npm run typecheck -w @patternlike/api`: passed both API TypeScript projects.
- `npm run test:wrangler-config -w @patternlike/api`: 2/2 passed.
- `npm run test:contracts`: all frozen schema, OpenAPI, M0-M7 contract, and 12
  migration smoke checks passed.
- `npm test -w @patternlike/api`: primary 89 files / 1,578 tests passed in
  311.57s; M3 compatibility 1/1 passed; Wrangler config 2/2 passed.
- `npm run build -w @patternlike/api`: production Wrangler dry-run passed;
  production ontology rollout remained `off`; no deployment occurred.
- `git diff --check`: passed.
- `git diff --exit-code 26e969469cf74ff80de26aaee908307db5312161 -- db/d1 contracts`:
  passed with no output.

One earlier full API run before the final assertion-removal/type-hardening pass
also passed (89 files / 1,578 tests, M3 1/1, Wrangler 2/2), but it is superseded
and is not used as settled evidence above.

## Workers and compatibility audit

- Queue message wire shape remains the Task 5 opaque `{run_id,
  stage_generation}` body.
- No Queue, DLQ, cron, binding, environment field, secret, or rollout value was
  added or changed.
- The production build is a dry-run only and shows the existing dedicated
  ontology queue/R2/D1/signer bindings.
- Task 3 corpus readers, Task 4 packet/prompt/publisher, Task 5 CAS/outbox/usage/
  artifact/retention, Task 9 signing/evidence readers, route integration,
  scheduler integration, M3 compatibility, and the full API suite all pass.
- No live provider was called. Tests inject a hermetic publisher whose sole
  simulated provider call invokes the real shared reservation callback.

## Immutable audit

The BASE-to-worktree diff contains no files under `db/d1/` or `contracts/`.
There are no frozen schema `$id`, enum, fixture, OpenAPI, manifest, or migration
changes. No remote migration or external resource operation was run.

## Concerns and boundary notes

No blocking concern remains.

- The frozen compiler predates the staged pipeline and requires a passing
  evaluation scaffold in a structurally complete candidate. Task 6 keeps those
  bytes encrypted with `status=candidate`; they cannot authorize ingestion or
  activation, and the independently derived report plus Task 7's remaining
  gates are authoritative.
- Task 6 deliberately stops with the run in `regressing`. Its downstream switch
  performs no report, hash, terminal, signing, ingestion, or evidence mutation;
  Task 7 must attach regression and final success to the exact live claim and
  accepted hashes before any rollout is enabled.
- The implementation made no policy/schema workaround: exact command validation
  includes the frozen feature, compiler, regression, prohibited-claim,
  selection, and validation policies.

## Commit

Exact subject prepared: `api: generate compile and evaluate ontology candidates`.

---

# Fix round 1 — close ontology execution safety gaps

## Scope and interfaces

This round starts from review HEAD
`78ffce029a7e5ceefca36304e915cd2a243236aa` and changes no frozen contract,
OpenAPI file, fixture, D1 migration, Queue binding, cron, environment variable,
secret, or rollout value.

Production interfaces changed:

- `db/ontology-pipeline.ts` adds the read-only exact-generation Task 7
  pre-claim classifier and hardens every shared owned-write CAS (`fail`,
  `retry`, cursor advance, named-stage advance, and Task 7's `succeed`).
- `ontology-pipeline-command.ts` freezes `OntologyPipelineCommandV2` with
  generation-chunk, candidate-record, evaluator-call, and candidate-byte
  ceilings.
- `ontology-packet.ts` carries a provider-visible, deterministic continuation
  manifest in the existing generator packet. The packet seam accepts only the
  exact V2 ceilings and bounded ordered progress.
- `ontology-prompt.ts` retains the stricter type-specific provider schema while
  deriving missing ID, locale, house, priority, non-empty-string, and output
  count bounds from the frozen schema authorities.
- `ontology-candidate-validation.ts` is the whole-release runtime gate. Ajv
  loads the exact frozen M0/M7 common, record, evaluation, and release schemas;
  additive deterministic policy checks cover locale, fragment resolution,
  coverage, source-supported obligations, synthesis source termination, and
  expression-guidance non-assertion.
- `ontology-pipeline-execute.ts` reuses the Task 5 claim/CAS/outbox/artifact and
  shared daily-usage primitives. It parks downstream stages before claim,
  treats request-without-response as ambiguous, enforces V2 continuation and
  ceilings, validates the whole candidate, and includes the V2 limits in the
  canonical evaluation report.
- `ontology-evaluation.ts` binds the four frozen V2 limits into canonical
  report bytes. The attempt-zero Task 9 envelope and attempt-scoped retry
  envelope paths are both preserved.

No second queue, claim, retry, transition, provider-accounting, encryption, or
artifact implementation was introduced. Test-only changes add regressions and
make scheduled-retention chronology compatible with a D1-clock-authoritative
live lease.

## Exact stage and cursor behavior

| Owned delivery | Provider calls | Committed successor |
| --- | ---: | --- |
| `reserved(g,0,0)` | 0 | `corpus_reading(g+1,0,0)` |
| `corpus_reading(g,0,0)` | 0 | `generating(g+1,0,0)` after exact registered-corpus verification |
| `generating(g,c,a)`, valid incomplete chunk | at most 1 | `generating(g+1,c+1,0)` |
| `generating(g,c,a)`, valid complete chunk | at most 1 | `compiling(g+1,0,0)` with the full candidate plaintext hash |
| `compiling(g,0,a)` | 0 | `evaluating(g+1,0,0)` with the compilation-report plaintext hash |
| `evaluating(g,c,a)`, non-final rule | at most 1 | `evaluating(g+1,c+1,0)` |
| `evaluating(g,c,a)`, deterministic final rule | at most 1 | `regressing(g+1,0,0)` with the evaluation-report plaintext hash |
| retryable provider result or ambiguous request | no same-attempt second call | same `(stage,g,c)`, `attempt=a+1`, available after the shared 60-second backoff |
| closed deterministic/semantic failure | no semantic retry | `failed(g+1,...)`, with every live artifact assigned exactly `failed_at + 7 days` |
| exact `regressing`, `signing`, or `ingesting` message | 0 | no claim, receipt, lease, attempt, hash, stage, or terminal mutation |
| stale or duplicate message | 0 | duplicate, no mutation |

Successful Task 6 execution still stops at `regressing`. It does not regress,
sign, ingest, activate, write the immutable 0011 evidence receipt, or mark a run
succeeded.

## Artifact-first adoption and provider accounting

The retained artifact classes are the Task 5 classes and identity scheme:

- generation: `generator_request`, `generator_response`, `candidate_chunk`;
- compilation: `candidate_release`, `compilation_report`;
- evaluation: `evaluator_request`, `evaluator_response`,
  `evaluator_verdict`, `evaluation_report`.

For a generation chunk or evaluation rule, execution probes the exact
attempt-scoped canonical artifact first, then the exact response artifact, and
then the exact request artifact. A response found in R2 before its D1 inventory
row is adopted and authenticated through the Task 5 service before any spend;
the missing canonical chunk/verdict is derived without another call. A request
with no response is an ambiguous-call receipt: that attempt performs no fetch
or reservation on redelivery. The existing guarded retry CAS moves to a fresh
attempt identity, and only that new attempt may reserve immediately before Task
4's sole provider fetch. At attempt 15, ambiguity closes as
`attempts_exhausted` without a second fetch.

The hermetic tests prove both generator and evaluator ambiguity, R2-first
response adoption, true retry identity, one call per delivery, and exact shared
usage-ledger charges. Provider request/response bodies, candidate records, and
evaluator content remain encrypted R2 artifacts; D1 retains only closed state,
coordinates, pointers, counts, and hashes.

## V2 continuation identity and hard limits

Every request after chunk zero carries exactly:

- `chunk_index`, equal to the count of validated accepted chunks;
- frozen maxima `16`, `64`, `64`, and `262144`;
- every accepted chunk plaintext hash in generation order;
- every accepted record ID in candidate order; and
- remaining coverage targets in frozen target order.

The manifest contains no run ID, stage generation, object key, claim token, or
other private identifier. It is authenticated inside the encrypted request
artifact. Successive chunk requests differ because accepted hashes, record IDs,
remaining coverage, and index change; an exact replay at one coordinate remains
byte-identical. Gaps, duplicate IDs, corrupt hashes, alternate maxima, reordered
or invented remaining targets, and one-over limits close before another cursor
or provider call as applicable.

The inclusive runtime ceilings are:

```text
maximum generation chunks   16
maximum candidate records   64
maximum evaluator calls     64
maximum candidate bytes     262144
```

Both `complete:true` and `complete:false` prospective candidates are measured
as the exact deterministic canonical candidate release. `262144` bytes is
accepted; `262145` closes before compilation or cursor advance. The successful
planned-call ceiling remains below the existing daily limit:

```text
16 generation + 64 evaluation + (30 fixtures * 11 regression) = 410 <= 500
```

## Frozen candidate validation and unchanged compiler

The frozen M7 release schema is the structural authority; there is no copied
release schema. The provider output schema remains an earlier, stricter
type-specific boundary, but the exact assembled plaintext is then validated as
one release against the frozen schema graph. Deterministic policy validation
additionally proves:

- exact registered corpus locale and resolution of every cited fragment;
- exact frozen feature-class coverage;
- non-empty source-supported fragment termination, tensions,
  counter-expressions, and prohibited claims, with empty input meanings and a
  null transformation;
- derived syntheses have at least two inputs, a transformation, no cycle, no
  missing input, and terminate exclusively in source-supported meanings; and
- expression guidance adds no body, sign, house, aspect, life-event,
  diagnosis, prediction, or psychological assertion. Non-claim-bearing
  guidance is not incorrectly required to have synthesis inputs.

Only after those checks does the deterministic compiling delivery invoke the
existing `compileOntologyRelease` unchanged over the complete ordered release.
No record is repaired, normalized, filtered, dropped, or partially accepted.
House 13, priority 1001, malformed release shape, unresolved identity,
incomplete coverage, invalid graph/policy, and compiler findings close the
whole run.

## Canonical evaluation report

The canonical encrypted report binds:

- the registered corpus release ID/hash, locale, license/public-capability
  identity, and object pointer;
- the full candidate plaintext hash;
- compiler pass result, frozen compiler policy, and compilation-report
  plaintext hash;
- every rule ID and verdict plaintext hash in exact candidate order;
- generator and evaluator model, reasoning, prompt, timeout, and output-token
  pins;
- input ceiling, all four V2 ceilings, configuration hash, and explicit
  configuration equality; and
- the frozen 30-fixture, 11-call, 100% regression threshold.

All nine evaluator dimensions remain mandatory and verdict-only. A dimension
failure or reject verdict terminally fails the release and cannot retry into an
acceptance. Attempt-zero reports retain Task 9's
`ontology-evaluation-artifact/v1` well-known object; a final-rule true retry
uses the authenticated attempt-scoped generic pipeline envelope, and the Task 9
reader accepts both exact paths.

## Live-lease CAS and pre-claim handoff

Every shared owned-write predicate now includes the exact stored timestamp and
D1-clock authority:

```sql
AND lease_expires_at = ?
AND julianday('now') < julianday(lease_expires_at)
```

The bound value is `claim.leaseExpiresAt`; no caller clock, sweep, token alone,
or replaceable lease can authorize a write. Tests cover `fail`, `retry`, cursor
advance, named-stage advance, and Task 7 `succeed` after expiry, plus an exact
lease mismatch. They also cover expiry after final provider/canonical artifact
persistence but before transition: the run cannot advance, fail, or retry under
the dead owner.

An exact-generation read-only classifier parks `regressing`, `signing`, and
`ingesting` before claim. Seventeen repeated delivery/recovery cycles leave the
stage, hashes, claim receipt count, lease, and attempt unchanged. A stale
generation falls through to the atomic claim CAS and closes duplicate; a D1
classification error fails closed with a delayed retry and no receipt. Rollout
`off` remains earlier still, pausing durably before claim. The exact
`OntologyPipelineCommandError('ontology_pipeline_predecessor_unavailable')`
maps immediately to closed `configuration_invalid` rather than lease churn.

## TDD evidence

### Review-head RED

The consolidated review regression suite was first run against unmodified
`78ffce0`: 47 tests passed and 28 failed. Distinct failures demonstrated all
review findings before their production edits:

- downstream Task 7 deliveries acquired claims/receipts and could exhaust the
  16-receipt ceiling;
- request persisted + provider success + response-persistence crash could call
  both generator and evaluator twice under one attempt;
- the V1 command had no hard limits or authenticated continuation, successive
  requests were not differentiated by accepted state, and one-over/unbounded
  incomplete output could advance;
- frozen-schema values such as house 13 and priority 1001, plus whole-release
  policy violations, could pass the old partial guard;
- all five shared CAS writes accepted an exact token after its stored lease had
  expired; and
- unavailable frozen predecessors produced uncertain lease retry rather than a
  closed failure.

### Finding GREEN

- I1: the pre-claim Task 7 parking/stale-race/D1-error tests pass, including
  more than 16 cycles with no claim receipt or lease.
- I2: generator and evaluator pre-response-persistence crashes pass; same
  attempt call count is one, true retry changes artifact identity, usage equals
  actual calls, response-first R2 adoption is free, and ambiguity at the
  attempt ceiling makes no second call.
- I3: V2 command replay conflict, exact maxima, continuation authentication,
  request differentiation/replay, chunk 16, record 64/65, evaluator ceiling,
  and candidate byte 262144/262145 boundaries pass. A separately added
  `complete:false` 262145-byte regression was RED (`advanced`) and GREEN after
  prospective canonical-byte validation (`terminal`, cursor zero).
- I4: frozen-schema authority, house/priority bounds, fragment/locale/coverage,
  source obligations, derived graph termination, expression-guidance policy,
  and unchanged compiler rejection pass. The normative guidance regression was
  RED because valid empty-input guidance was rejected; it is GREEN after
  restricting source termination to derived syntheses.
- I5: expired and mismatched leases reject all five shared writes; final
  artifact persistence cannot enable a late transition or terminal mutation.
- Minor: the real frozen-predecessor disappearance path is terminal
  `configuration_invalid` at attempt zero with no provider invocation.
- The public packet seam's alternate-maxima test was separately RED (it
  serialized 17/65/65/262145) and GREEN after exact V2 validation.

### Discarded harness runs

These are recorded separately and are not claimed as settled evidence:

- The first combined Task 6 run reported 18 passes and 11 five-second timeouts
  after a DB delay proxy leaked through Cloudflare's inherited binding
  `[[Set]]`. The first timed-out case passed alone in 196 ms. Defining test env
  overrides as own properties removed the contamination; no production timeout
  or lease predicate changed.
- The first adjacent compatibility run was 176/177: scheduled retention used a
  seven-day-old fake claim, which the new D1-clock predicate correctly refused.
  The fixture now keeps historical retention event timestamps while obtaining
  a genuinely live setup lease. Its settled lane is 9/9.
- An early attempt-ceiling fixture advanced its fake clock into the future and
  hit the migration's artifact `created_at <= D1 now` guard at attempt 3. The
  final test advances to attempt 15 through the public Task 5 claim/retry
  primitives without synthetic provider artifacts, then proves one charged
  ambiguous call and no second fetch.

## Settled verification evidence

- Required exact lane:
  `npm exec -w @patternlike/api -- vitest run
  src/services/ontology-evaluation.test.ts
  src/services/ontology-pipeline-execute.test.ts` — 2 files, 31 tests passed.
- Task 6 plus frozen candidate validator — 3 files, 37 tests passed.
- Task 4/5 and queue/scheduled compatibility — 9 files, 175 tests passed.
- Task 3 corpus and Task 9 evidence/integration/signing readers — 4 files,
  103 tests passed.
- `npm run typecheck -w @patternlike/api` — both TypeScript projects passed.
- `npm run test:wrangler-config -w @patternlike/api` — 2/2 passed.
- `npm run test:contracts` — all frozen contract/OpenAPI lanes passed; all 12
  migrations fresh-applied into 46 tables with foreign-key and quick checks
  clean.
- `npm test -w @patternlike/api` — main Worker suite 90 files / 1,604 tests;
  M3 compatibility 1/1; Wrangler resolution 2/2, all passed.
- `npm run build -w @patternlike/api` — production Wrangler dry-run passed;
  ontology rollout resolved to `off`; no deployment occurred.
- `git diff --check` — passed.
- `git diff --exit-code 78ffce029a7e5ceefca36304e915cd2a243236aa -- db/d1 contracts`
  — passed with no output.

## Workers, compatibility, and immutable audit

The dedicated Queue body remains exactly `{run_id, stage_generation}`.
Rollout-off still pauses before claim; malformed messages acknowledge closed;
enabled uncertain/parked work retries with a closed delay; stale messages remain
duplicates. There is no new fetch path and no live provider was called. The
production dry-run shows the existing queue, D1, R2, and signer bindings and
keeps ontology rollout off.

The BASE-to-worktree diff contains no `db/d1/` or `contracts/` path. No frozen
schema `$id`, enum, required field, fixture, OpenAPI projection, manifest, or
migration changed. No remote migration, deployment, external resource, secret,
push, or merge operation was performed.

## Concerns and commit

No blocking concern remains. The encrypted candidate still carries the frozen
compiler's pre-evaluation structural scaffold noted in the original Task 6
report; it cannot authorize signing, ingestion, activation, or success. Task 7
must commit regression, accepted hashes, immutable evidence, and terminal
success against the exact live run/claim transition.

Exact commit subject prepared: `api: close ontology execution safety gaps`.
The full resulting SHA is returned outside this self-referential report.
