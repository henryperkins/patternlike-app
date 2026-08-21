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
