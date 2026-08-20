# Automated Ontology Pipeline Implementation Plan

**Date:** 2026-08-20

**Status:** Approved and ready to execute after the adapter runtime dependency
identified below.

**Design:**
[`2026-08-15-ontology-pipeline-design.md`](../specs/2026-08-15-ontology-pipeline-design.md)

## Outcome

Turn one immutable source-corpus release into a compiled, independently
evaluated, fixed-chart-regressed, separately signed, activated ontology release
without human record approval. This is the only path that may set
`provenance.origin: "machine_pipeline"` and the only ontology path that may serve
accounts outside `PATTERN_INTERNAL_ACCOUNT_IDS`.

No person edits, selects, approves, or publishes an individual generated record
or Pattern. Operational rollout approval may authorize a version after all
machine gates pass; it cannot waive or repair a failed gate.

## Hard dependencies

- Adapter plan Tasks 6–9 must be complete before Task 7 can exercise the real
  planner/writer/verifier stage machine.
- Adapter migrations `0009` and `0010` own those numbers. This plan starts at
  `0011`.
- The additive M7 provenance and report-hash contract amendments are already in
  the tree. If Slice A Task 1 has not landed, this plan's Task 1 lands the shared
  type parity itself.
- An `internal_synthetic` corpus is sufficient for implementation tests. A
  public activation additionally requires a registered corpus composed of
  authorized `licensed_excerpt` fragments. Absence is an operational stop, not
  an invitation to mark synthetic material public.

## Task 1: Pin shared types and pipeline configuration

**Files:**

- Modify if not already aligned: `packages/shared/src/m7-types.ts`
- Modify if not already aligned: `packages/shared/src/m7-types.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/middleware/config-guard.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/wrangler.toml`

- [ ] Ensure `PatternOntologyRelease.provenance` and both optional evaluation
  report hashes have the same closed shape as the M7 schemas.
- [ ] Add `ONTOLOGY_PIPELINE_ROLLOUT=off|internal`, default `off` in every
  Wrangler block. Any other value is a fail-closed configuration error.
- [ ] Add distinct generator/evaluator pins: model, reasoning, prompt version,
  timeout, max output tokens, and input byte cap. Equal prompt versions are
  refused. Equal model pins are allowed only with a configuration flag that
  forces the 100% regression threshold into the frozen run command.
- [ ] Add `ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT` and fix
  `ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS` at `7` outside development.
- [ ] Add secret declarations for the pipeline artifact-encryption keyring. It
  is separate from user DEKs and signing keys; key material never appears in
  Wrangler variables or a run row.
- [ ] Reuse the explicit `OPENAI_CREDENTIAL_SOURCE` and optional AI Gateway
  route. `gateway_stored` sends no provider `Authorization`, exactly as the two
  existing OpenAI adapters do.
- [ ] Add `ONTOLOGY_SIGNER` as a service binding type, but do not add a signing
  secret to the API Worker `Env`.
- [ ] Write every malformed/missing/equality refusal before implementation.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/config.test.ts
      npm run test -w @patternlike/shared
      npm run typecheck

- [ ] Commit: `api: pin the ontology pipeline configuration`

## Task 2: Add the durable control-plane schema

**Files:**

- Create: `db/d1/0011_ontology_pipeline.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Create: `apps/api/src/db/ontology-pipeline.test.ts`

- [ ] Write migration tests first against both an empty database and a populated
  post-`0010` snapshot.
- [ ] Add `pattern_source_corpus_releases` with immutable corpus id/hash,
  locale, object key, fragment count, license-class summary, and timestamps.
- [ ] Add `pattern_ontology_pipeline_runs` with a unique idempotency key,
  corpus identity, candidate ontology version, frozen configuration JSON/hash,
  stage, stage generation, stage cursor, claim token/lease, dispatch outbox,
  closed failure class, evidence hashes, seven-day failure expiry, and terminal
  timestamps. No user id or user FK belongs on this control-plane row.
- [ ] Add `pattern_ontology_pipeline_artifacts` with attempt-scoped identity,
  artifact class, object key, plaintext/ciphertext hashes, envelope key id and
  nonce, stage ownership, creation/expiry/deletion timestamps, and create-only
  uniqueness.
- [ ] Add indexed undispatched, expired-lease, and expired-artifact lanes. Add
  assertion-probe guards for any rebuild; never edit applied `0007`–`0010`.
- [ ] Keep corpus text, generated records, evaluator rationales, and report
  bodies out of D1. Rows carry only pointers, pins, closed state, counts, and
  hashes.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/db/ontology-pipeline.test.ts
      npm run test:contracts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `db: add the durable ontology pipeline state`

## Task 3: Register and verify immutable source corpora

**Files:**

- Create: `apps/api/src/db/ontology-corpus.ts`
- Create: `apps/api/src/services/ontology-corpus.ts`
- Create: `apps/api/src/services/ontology-corpus.test.ts`
- Create: `apps/api/src/routes/internal-ontology-pipeline.ts`
- Create: `apps/api/src/routes/internal-ontology-pipeline.integration.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] Add a service-authenticated corpus registration route. It validates the
  bundled M7 schemas, canonicalizes the release, recomputes the corpus hash,
  requires `license_resolved: true`, requires every fragment's corpus id and
  locale to match, and refuses mixed or unknown license classes.
- [ ] Store canonical bytes create-only under
  `pattern-ontology-corpora/<corpus_release_id>.json`; identical replay is
  idempotent and changed bytes under one id are immutable-conflict.
- [ ] Implement the runtime reader from the stored object only. It resolves no
  URL, infers no license, and makes no network request.
- [ ] Preserve `internal_synthetic` versus `licensed_excerpt` in the returned
  index and run command. A public release requires every cited fragment to be
  from a registered public-capable corpus.
- [ ] Test hash mismatch, unresolved license, wrong corpus id, wrong locale,
  missing cited fragment, instruction-shaped excerpt, exact replay, and changed
  replay.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/ontology-corpus.test.ts src/routes/internal-ontology-pipeline.integration.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: register immutable ontology source corpora`

## Task 4: Build minimizing generator and evaluator provider boundaries

**Files:**

- Create: `apps/api/src/services/ontology-packet.ts`
- Create: `apps/api/src/services/ontology-packet.test.ts`
- Create: `apps/api/src/services/ontology-prompt.ts`
- Create: `apps/api/src/services/ontology-prompt.test.ts`
- Create: `apps/api/src/services/ontology-publisher.ts`
- Create: `apps/api/src/services/openai-ontology-publisher.ts`
- Create: `apps/api/src/services/openai-ontology-publisher.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`

- [ ] Define separate generator and evaluator request types and strict schemas.
  The evaluator verdict contains the nine §23.7 dimensions and no field capable
  of carrying a replacement record.
- [ ] Construct every packet by explicit key allowlist, serialize
  deterministically, scan for unexpected keys/forbidden identifiers, and enforce
  the input byte cap. Do not spread source, release, or run objects.
- [ ] The generator receives only the immutable corpus, closed feature
  vocabulary, coverage targets, frozen policy/schema versions, and active
  machine records for a true machine successor. It receives no user data.
- [ ] The evaluator receives exactly one rule, its cited meanings, its permitted
  fragments, and the compiler summary. It receives no other candidate rule and
  cannot edit the rule it judges.
- [ ] Match the existing Pattern request posture: one fetch, one abort deadline,
  `store:false`, strict JSON schema, no tools/browsing/file search/code/MCP,
  no background or conversation state, no adapter retry, exact gateway headers,
  and safe failure classes containing no provider prose.
- [ ] Charge the ontology usage ledger through a reserve callback immediately
  before fetch. One delivery performs at most one provider call.
- [ ] Extend the hermetic mock for chunk generation, per-rule verdicts,
  refusals, malformed output, timeout, and injected prompt text.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/ontology-packet.test.ts src/services/ontology-prompt.test.ts src/services/openai-ontology-publisher.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: add the ontology generator and evaluator boundaries`

## Task 5: Add reservation, queue routing, encrypted artifacts, and budget

**Files:**

- Create: `apps/api/src/db/ontology-provider-usage.ts`
- Create: `apps/api/src/db/ontology-provider-usage.test.ts`
- Create: `apps/api/src/db/ontology-pipeline.ts`
- Create: `apps/api/src/services/ontology-pipeline-command.ts`
- Create: `apps/api/src/services/ontology-pipeline-artifacts.ts`
- Create: `apps/api/src/services/ontology-pipeline-artifacts.test.ts`
- Create: `apps/api/src/services/ontology-pipeline-enqueue.ts`
- Create: `apps/api/src/services/ontology-pipeline-enqueue.test.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/queue.ts`
- Modify: `apps/api/src/queue.test.ts`
- Modify: `apps/api/wrangler.toml`

- [ ] Add the opaque `ontology_pipeline` queue message carrying only run id and
  stage generation. Declare separate dev/production queues and DLQs with bounded
  concurrency; ontology work must not contend with reader generation.
- [ ] Reserve one immutable command from a registered corpus and exact provider,
  policy, schema, threshold, retention, and budget pins. Store no corpus text in
  the queue or D1 command.
- [ ] Implement CAS claim, five-minute lease, durable outbox, same-generation
  retry, successor-generation advance, expired-lease sweep, and undispatched
  sweep using the Pattern protocol rather than inventing weaker semantics.
- [ ] Encrypt every provider request/response, candidate chunk, evaluator result,
  and report in R2 with the pipeline artifact keyring. Use attempt-scoped
  create-only identities and compare full stored identity before adoption.
- [ ] Add stage-class accounting for `generator`, `evaluator`, and `regression`
  against the shared ontology daily total. A failed/timed-out call consumes one
  unit; an adopted response artifact consumes none.
- [ ] Ensure `ONTOLOGY_PIPELINE_ROLLOUT=off` pauses queued work before artifact
  decryption or budget consumption.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/db/ontology-provider-usage.test.ts src/services/ontology-pipeline-artifacts.test.ts src/services/ontology-pipeline-enqueue.test.ts src/queue.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: add the durable ontology pipeline boundary`

## Task 6: Implement generation, compilation, and independent evaluation

**Files:**

- Create: `apps/api/src/services/ontology-pipeline-execute.ts`
- Create: `apps/api/src/services/ontology-pipeline-execute.test.ts`
- Create: `apps/api/src/services/ontology-evaluation.ts`
- Create: `apps/api/src/services/ontology-evaluation.test.ts`
- Modify: `apps/api/src/queue.ts`

- [ ] Implement the design's closed stage sequence:
  `corpus_reading -> generating -> compiling -> evaluating`. Each generation
  chunk and each rule evaluation is a separate delivery and at most one provider
  call.
- [ ] Assemble a complete candidate before compilation. Partial chunks are
  encrypted artifacts and can never be ingested or activated.
- [ ] Call `compileOntologyRelease` unchanged. Any compiler failure terminates
  the whole run with closed codes; do not drop a bad record and continue.
- [ ] Evaluate exactly one rule per call. One failed dimension on one rule fails
  the release. The evaluator cannot return edits, and no retry may turn a
  semantic rejection into acceptance.
- [ ] Produce a canonical evaluation report, store it encrypted, and carry its
  plaintext hash forward. Record generator/evaluator configuration equality and
  the corresponding regression threshold in the report.
- [ ] Test crash-after-provider adoption, true retry, chunk ordering, duplicate
  delivery, compiler rejection, one-rule rejection, budget exhaustion, and
  seven-day failed-artifact expiry.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/ontology-evaluation.test.ts src/services/ontology-pipeline-execute.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: generate compile and evaluate ontology candidates`

## Task 7: Author and run the 30-chart activation corpus

**Files:**

- Modify: `contracts/m7/fixtures/corpus/manifest.json`
- Create: `contracts/m7/fixtures/corpus/en-US/exact-01.json` through
  `contracts/m7/fixtures/corpus/en-US/exact-10.json`
- Create: `contracts/m7/fixtures/corpus/en-US/approximate-01.json` through
  `contracts/m7/fixtures/corpus/en-US/approximate-10.json`
- Create: `contracts/m7/fixtures/corpus/en-US/unknown-01.json` through
  `contracts/m7/fixtures/corpus/en-US/unknown-10.json`
- Create: `apps/api/src/services/ontology-regression.ts`
- Create: `apps/api/src/services/ontology-regression.test.ts`
- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/ontology-pipeline-execute.ts`

- [ ] Author the 30 deterministic chart→feature fixture chains. The manifest
  assigns every §23.8 axis to at least one exact file and refuses missing or
  duplicate coverage.
- [ ] Extract only the smallest production helper necessary for regression to
  invoke the same selector, planner, writer, semantic verifier, deterministic
  validators, and projection code used by reader jobs. Do not create a second
  implementation under test.
- [ ] Advance one provider pass per queue delivery through each fixture. A
  fixture completes only after the full Pattern protocol accepts or reaches its
  declared deterministic refusal.
- [ ] Enforce zero suppressed-feature leaks, uncited astrological claims,
  source-dependency failures, prohibited claim classes, and mandatory-feature
  omissions. These are hard failures, never score deductions.
- [ ] Require at least 9/10 structurally accepted fixtures independently for
  exact, approximate, and unknown birth time. Require 10/10 in all three when
  generator and evaluator model pins are equal.
- [ ] Store the canonical regression report encrypted and carry its plaintext
  hash forward. Fail if bounded calls/tokens exceed the frozen approved ceiling.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/ontology-regression.test.ts src/services/ontology-pipeline-execute.test.ts
      npm run test:contracts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: add the M7 ontology activation corpus`

## Task 8: Add the isolated signing Worker

**Files:**

- Create: `apps/ontology-signer/package.json`
- Create: `apps/ontology-signer/tsconfig.json`
- Create: `apps/ontology-signer/wrangler.toml`
- Create: `apps/ontology-signer/src/index.ts`
- Create: `apps/ontology-signer/src/index.test.ts`
- Modify: `apps/api/wrangler.toml`
- Create: `apps/api/src/services/ontology-signing-client.ts`
- Create: `apps/api/src/services/ontology-signing-client.test.ts`
- Modify: `apps/api/src/services/ontology-pipeline-execute.ts`

- [ ] Build a no-route signing Worker with one service-binding-only operation:
  accept canonical candidate bytes plus allowed key id, verify the declared
  hash, and return the signature. It has no provider, corpus, D1, or R2 binding.
- [ ] Bind `PATTERN_ONTOLOGY_SIGNING_KEY` only in the signing Worker. Add a
  compile-time/runtime test that the API Worker `Env` has no signing-key field.
- [ ] Refuse noncanonical bytes, unknown key ids, oversized payloads, and any
  request containing prompt/provider fields. Never return or log key material.
- [ ] The API client calls the binding only after compiler, evaluator, and
  regression reports all pass and their hashes are frozen in the release.
- [ ] Run:

      npm run test -w @patternlike/ontology-signer
      npm exec -w @patternlike/api -- vitest run src/services/ontology-signing-client.test.ts
      npm run typecheck

- [ ] Commit: `infra: isolate ontology release signing`

## Task 9: Verify pipeline evidence at ingestion and activate atomically

**Files:**

- Create: `apps/api/src/services/pattern-ontology-evidence.ts`
- Create: `apps/api/src/services/pattern-ontology-evidence.test.ts`
- Modify: `apps/api/src/routes/internal-pattern.ts`
- Modify: `apps/api/src/db/pattern-ontology.ts`
- Modify: `apps/api/src/services/ontology-pipeline-execute.ts`
- Modify: `apps/api/src/routes/internal-ontology-pipeline.integration.test.ts`

- [ ] For `machine_pipeline`, require a succeeded run matching ontology version,
  corpus identity/hash, bundle hash, evaluation report hash, regression report
  hash, and signing key id. Verify those hashes against committed artifacts
  before pointer movement.
- [ ] Require public-capable corpus evidence for any release intended beyond
  internal rollout. `internal_synthetic` may prove engineering end to end but
  cannot satisfy the public activation evidence row.
- [ ] Preserve the Slice A path: `synthetic_internal` may omit report hashes but
  remains reservation-contained. An unmarked release is treated the same.
- [ ] Keep ingestion and activation one guarded operation. Identical replay is
  idempotent, changed bytes under a version fail immutable, and recalled versions
  never reactivate.
- [ ] Insert `pattern_ontology_evaluation_runs` only after evidence verification
  and activation succeeds.
- [ ] Test valid pipeline activation, each mismatched hash independently,
  missing corpus, synthetic corpus presented as public, invalid signature,
  duplicate replay, and pointer preservation on every refusal.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/pattern-ontology-evidence.test.ts src/routes/internal-ontology-pipeline.integration.test.ts
      npm run typecheck -w @patternlike/api

- [ ] Commit: `api: activate only evidenced ontology pipeline releases`

## Task 10: Prove the fully automated end-to-end path

**Files:**

- Create: `apps/api/src/services/ontology-pipeline.integration.test.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.ts`
- Modify: `apps/api/src/services/pattern-lifecycle.test.ts`

- [ ] Drive an `internal_synthetic` corpus through registration, durable queue
  generation, compilation, per-rule evaluation, all 30 regression fixtures,
  service-bound signing, ingestion, and activation with no human record action.
- [ ] After activation, reserve and publish a Pattern for a non-allowlisted test
  account. This proves the provenance gate recognizes the machine route.
- [ ] Prove one provider success followed by D1 failure adopts its artifact on
  redelivery without a second call or budget charge at every provider stage.
- [ ] Prove a failed evaluator, regression fixture, budget ceiling, signature,
  or evidence hash leaves the prior pointer active and never emits a signed
  candidate as active.
- [ ] If a Slice A release is active, activation recalls it, clears it as a
  predecessor, and runs the existing withdrawal process for documents based on
  it. The machine release begins a fresh lineage.
- [ ] Count the worst-case regression provider calls as
  `30 fixtures × 11 = 330`, then add the frozen generator-chunk and evaluator-rule
  maxima. Assert the run command cannot exceed the approved total.
- [ ] Run:

      npm exec -w @patternlike/api -- vitest run src/services/ontology-pipeline.integration.test.ts
      npm test

- [ ] Commit: `api: prove the human-free ontology pipeline end to end`

## Task 11: Full gate and public-rollout handoff

**Files:**

- Modify: `docs/deploy/openai-pattern-rollout.md`
- Modify: `docs/superpowers/plans/2026-08-15-m7-remaining-slices-ledger.md`
- Modify: `CLAUDE.md`

- [ ] Run:

      npm run typecheck
      npm test
      npm run build
      python contracts/validate_schemas.py

- [ ] Record the durable-job, artifact-first, one-call-per-delivery, evaluator
  non-editability, separate-signing-key, 30-fixture threshold, seven-day failed
  retention, and human-free invariants in `CLAUDE.md`.
- [ ] Compute spend from current rates using the frozen maxima. The regression
  floor is 330 worst-case calls; the approved ceiling also includes generator
  chunks and one evaluator call per candidate rule. Do not advance from `off`
  without written ceiling evidence.
- [ ] Run a complete production-shaped candidate against the registered corpus.
  A synthetic corpus may certify engineering and internal behavior only. Public
  rollout stops until the corpus is entirely authorized `licensed_excerpt` and
  the evidence is recorded.
- [ ] Follow `docs/deploy/openai-pattern-rollout.md` from the public-path branch.
  Record version ids, hashes, counts, and dashboard state without content or
  secret values.
- [ ] Commit: `docs: record the automated ontology rollout evidence`

## Dependency map

    Task 1 -> Task 2 -> Task 3 -> Task 5 -> Task 6 -> Task 7 -> Task 9 -> Task 10 -> Task 11
                  Task 4 -----^                  Task 8 -----^

Tasks 3 and 4 can run in parallel after configuration. Task 8 can run in
parallel with Tasks 5–7. Task 7 cannot complete until adapter Tasks 6–9 expose
the real provider-backed Pattern stage machine. No task here changes rollout or
configures a production secret merely by merging.

