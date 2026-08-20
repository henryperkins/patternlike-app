# Automated Ontology Pipeline Design (M7 Slice B, §31.10)

**Date:** 2026-08-15

**Status:** Approved for implementation on 2026-08-20. All design questions are
resolved below; the implementation plan is
[`2026-08-20-automated-ontology-pipeline.md`](../plans/2026-08-20-automated-ontology-pipeline.md).

**2026-08-16 amendment.** Product-spec v0.6 and
[`2026-08-16-m7-spec-artifact-amendments.md`](2026-08-16-m7-spec-artifact-amendments.md)
ratify `provenance.origin: "machine_pipeline"`, the optional evaluation
report hashes, compiler policy for class-specific record fields, and
`contracts/m7/fixtures/corpus/` as the §23.8 home. Cite those documents, not
the pre-amendment 2026-08-14 lists.

**Scope:** Build the six-component pipeline that turns an immutable source-corpus
release into a signed, evaluated, regression-tested ontology release and
activates it — without human record approval. This is the only route to
`PATTERN_AI_ROLLOUT=first_open` or `enabled`, and the only thing that can
evidence acceptance criterion 19.

**Human-free invariant.** No person approves, edits, selects, or publishes an
individual ontology record or Pattern in this path. The immutable source corpus
and configuration pins are inputs; generation, compilation, independent
evaluation, fixed-chart regression, signing, ingestion, activation, and every
reader Pattern are machine-run. Operational deployment approval may authorize a
version or rollout state, but it cannot waive a failed record or alter generated
content.

## Decision summary

Slice A produces an ontology a designated internal account can read. Slice B
produces the one every other reader must wait for. It is not an optimization of
Slice A's manual route — it is a second full LLM integration with its own
provider tuple, its own rollout switch, its own budget ledger, and its own
adversarial gate, and it should be sized against the adapter design rather than
against Slice A.

The approved choices are:

- the pipeline runs as a **staged, durable job inside the Worker**, mirroring
  `pattern_generation_jobs` — CAS claim, lease, `stage_generation`, encrypted R2
  artifacts, one provider call per delivery — because §23.8's regression must
  exercise the *real* selector, planner, writer and validators, which after slice
  1 exist only behind the Worker's `PatternPublisher`;
- the **signing identity is a second Worker** reached by service binding, because
  §23.9 requires the signing key to be unavailable to the generator and
  evaluator, and a single Worker shares one `env` with every module in it;
- the **existing deterministic compiler is reused unchanged** —
  `compileOntologyRelease` already implements §23.6's gate, so component three is
  a driver, not a rewrite;
- the evaluator judges **one rule per call** per §23.7, and a single failing rule
  fails the whole release;
- releases produced here declare `provenance.origin: "machine_pipeline"`, which
  is the property Slice A's reservation gate tests, and is the only way an
  external reader is ever served;
- two additive optional hash fields close a gap between §23.9 and the frozen
  evaluation contract; and
- rollout does not move as a consequence of merging. `first_open` remains a
  separate, later, evidence-gated decision.

## Goal

A source-corpus release can produce, validate, sign, ingest and activate an
ontology version without human record approval, and the run leaves behind enough
evidence to satisfy acceptance criterion 19's six proofs.

Success means, one clause per proof:

1. **source dependency** — every `source_supported` record cites fragment ids
   that resolve to fragments present in the named corpus release, and the corpus
   release hash is verified rather than asserted;
2. **deterministic compilation** — the candidate passes `compileOntologyRelease`
   unchanged, and the same corpus plus the same pins produces a compilation
   verdict that does not depend on when it ran;
3. **independent evaluation** — every rule was judged by a separately configured
   evaluator that could not edit it, and the evaluator's configuration is
   recorded in the release evidence;
4. **regression** — the candidate was exercised end to end through the real
   selector, planner, writer and validators against the §23.8 fixed-chart corpus,
   and every activation gate in §23.8 passed;
5. **signing** — the bundle was signed by an identity the generator and evaluator
   cannot reach; and
6. **activation** — ingestion verified corpus identity, bundle hash, evaluation
   and regression report hashes, key allowlist, signature, version immutability
   and recall state before the pointer moved.

Explicit non-goals. This slice does not curate a source corpus, acquire texts,
determine copyright, infer a license, or decide whether a source is trustworthy —
§23.2 puts all of that behind an out-of-scope process and requires a corpus
release lacking explicit machine-readable authorization to be refused. It does
not change `packages/pattern-engine`'s compilation or matching behavior. It does
not change `contracts/m7`'s `schema_version`, any `$id`, any enum, or any
required field. It does not advance rollout.

## Current state

Verified by inspection on 2026-08-15.

**Nothing of the pipeline exists.** No source-corpus reader: `corpus_release_id`,
`SourceCorpus` and related identifiers appear in no runtime TypeScript at all.
No generator, no evaluator, no regression runner, no signing client.

**Two tables exist and are dead.** `pattern_ontology_evaluation_runs`
(`0007:405-411`) and `pattern_ontology_provider_daily_usage` (`0007:427-432`) are
created by the applied migration and are referenced by **no code whatsoever** —
there is not even a helper module for the usage ledger, unlike
`pattern_provider_daily_usage`, which has `apps/api/src/db/pattern-provider-usage.ts`.
Slice B is what makes both live.

**The contracts are frozen and ready.** `pattern-source-corpus-release`,
`pattern-source-fragment`, `pattern-ontology-record`, `pattern-ontology-evaluation`
and `pattern-ontology-release` all exist with valid fixtures, including
`pattern-source-corpus-release.synthetic.json` and
`pattern-source-fragment.synthetic.json`.

**The corpus contract already sanctions synthetic material.**
`pattern-source-fragment.schema.json` types `license_class` as an enum of exactly
`licensed_excerpt` and `internal_synthetic`, and
`pattern-source-corpus-release.schema.json` requires `license_resolved` to be the
constant `true`. So a corpus of internally written propositions is a
*contract-sanctioned* input, not a workaround — provided the pipeline treats
`internal_synthetic` as what it is and does not let it reach an external reader
under a `licensed_excerpt` claim. This matters for Slice A too, and is carried
into the reconciliation section below.

**The compiler is already §23.6.** `compileOntologyRelease`
(`packages/pattern-engine/src/ontology.ts:205`) enforces schema and id grammar,
locale, release status, duplicate ids, canonical aspect ordering, source
termination, two-input and transformation-class requirements for derived
synthesis, an acyclic synthesis graph, and unknown input references — and refuses
a release as a whole rather than dropping a record.

**Ingestion verifies less than §23.9 says it does.** §23.9 requires the internal
route to verify "evaluation report hashes" and a "regression report hash". The
route (`apps/api/src/routes/internal-pattern.ts:22-86`) verifies keys, compiles,
verifies the signature and bundle hash, and checks recall and immutability — and
checks no report hashes, because `pattern-ontology-evaluation.schema.json`
carries none. Its properties are exactly `schema_version`, `ontology_version`,
`verdict`, `compiler_passed`, `evaluator_passed`, `regression_passed`, and
`unevaluated_fixture_count`. This is a conformance gap of the same class as the
adapter design's Q6, and it is closed below rather than carried as an open
question.

**Ingestion is activation.** `storeOntologyRelease` writes `status='active'`,
supersedes every other active release and moves the pointer in one guarded batch.
There is no candidate-then-promote state, which constrains the pipeline's last
step: the pipeline must be *certain* before it posts, because posting publishes.

## Chosen architecture

### Where the pipeline runs

A staged, durable job in the Worker, structured exactly like Pattern generation:
a `jobs` row as the durable outbox, a domain row carrying stage and
`stage_generation`, CAS claim with a lease, one provider call per queue delivery,
encrypted expiring R2 artifacts for every request and response, and a sweeper for
lost nudges.

The decisive reason is §23.8. Regression must exercise "the real deterministic
selector, planner, writer, and validators." After slice 1 those exist only in the
Worker, behind `PatternPublisher` and `pattern-execute.ts`'s stage machine. An
external Node runner would have to re-host or re-implement them, and a regression
suite that proves a *reimplementation* is clean proves nothing about what serves
readers. Everything else follows: the budget ledger, the artifact envelope, the
config guard and the safe-log union are all already Worker-shaped.

Stages, one provider call per delivery:

```text
reserved
  -> corpus_reading        (no provider call; reads and verifies the corpus)
  -> generating            (N deliveries; candidate records)
  -> compiling             (no provider call; compileOntologyRelease)
  -> evaluating            (one delivery per rule, §23.7)
  -> regressing            (one delivery per fixture chart, §23.8)
  -> signing               (service binding to the signing Worker)
  -> ingesting             (POST /internal/pattern-ontology-releases)
  -> succeeded | failed
```

A rule that fails evaluation fails the release (§23.7). A fixture chart that
fails an activation gate fails the release (§23.8). Neither is retried into a
pass, and neither is skipped to make a release compile — the same posture the
compiler already takes.

### The six components

1. **Source-corpus contract reader.** Reads a corpus release, validates it
   against the frozen schema, recomputes `corpus_hash` over the canonical payload
   and refuses a mismatch, refuses `license_resolved !== true`, and indexes
   fragments by id. It resolves nothing from the network and infers no license.
   Its output is the only source material any later stage may cite.
2. **Generator prompt and provider adapter.** Follows §23.5: the generator
   receives one immutable corpus release, the ontology schema and policy
   versions, the closed M4 feature vocabulary, existing active records when
   producing a successor, coverage targets, and the regression and
   prohibited-claim policy. It produces a *complete* candidate release, never an
   incremental stream that can partially activate. Same hard request posture as
   runtime generation — top-level instructions, one escaped JSON input, strict
   schema, no tools, no browsing, no file search, no remote MCP, no code
   execution, `store: false`, bounded tokens.
3. **Deterministic compiler driver.** Calls the existing
   `compileOntologyRelease` and records its verdict and failure codes as the
   compilation report. No new compiler.
4. **Independent evaluator.** Per §23.7, one call per candidate rule, receiving
   that rule, all cited source-supported meanings, the permitted source
   fragments, and the deterministic compiler summary. It returns a structured
   verdict across the nine dimensions §23.7 enumerates. **It cannot edit a rule**,
   and the adapter must structurally prevent it: the verdict schema carries no
   field capable of expressing a replacement record.
5. **Fixed-chart regression runner.** Drives the real generation path over the
   §23.8 corpus and asserts §23.8's activation gates: zero suppressed-feature
   leaks, zero uncited astrological claims, zero source-dependency failures, zero
   prohibited claim classes, complete mandatory-feature accounting, structural
   acceptance above the pinned threshold for every chart class, no regression in
   deterministic refusal behavior, and bounded token and cost estimates below the
   approved ceilings.
6. **Machine signing and internal ingestion client.** Canonicalizes the bundle,
   obtains a signature from the signing identity, and posts to
   `POST /internal/pattern-ontology-releases` under `SERVICE_AUTH_TOKEN`.

### Signing isolation, and the constraint that forces a second Worker

§23.9 requires that "the signing key is not available to the generator or
evaluator." In a single Cloudflare Worker every module shares one `env`, so a
`PATTERN_ONTOLOGY_SIGNING_KEY` binding placed beside the generator is available
to the generator by construction. Module-level discipline — "the generator module
simply never imports it" — is a convention, not an isolation boundary, and it is
exactly the kind of claim this repository refuses elsewhere.

**The design takes the second Worker.** A minimal signing service, deployed
separately, holding the signing key as its own secret, exposed to the pipeline
Worker through a service binding with a single method: given a canonical payload
and a key id, return a signature. It never sees a prompt, never calls a provider,
and never writes D1 or R2. The pipeline Worker holds no signing key at all.

This is the most expensive decision in the design and is approved. CI-held
signing is no longer an implementation alternative. The pipeline Worker never
receives the signing key, and the signing Worker has no provider, corpus, D1, or
R2 bindings.

### Evaluator independence is a checked relationship

§23.7 says the generator and evaluator do not share a prompt and should use
different model configurations when operationally available, and that
configuration equality "must be explicit in the release evidence and may require
stricter regression thresholds."

This is the same defect class the adapter design found in its §14.2 writer/verifier
pair, where separation was an accident of two constants that nothing enforced.
`resolveOntologyPipelineConfiguration` therefore refuses a configuration in which
the generator and evaluator prompt versions are equal, and when the *model* pins
are equal it does not refuse but stamps `configuration_equal: true` into the
release evidence and raises the regression threshold to the stricter pinned
value. Equality becomes visible and costly rather than silent.

### Alternatives not selected

1. **An external Node runner under `scripts/`.** Cheaper to write and easy to run
   locally, and rejected because §23.8's regression must exercise the real
   planner and writer. A runner outside the Worker either re-implements them or
   calls the product API per fixture chart, and the first proves the wrong thing
   while the second needs consented user rows for synthetic charts.
2. **One provider call per release for generation.** Rejected because §23.5
   requires a complete candidate and a 40–50 record release with syntheses will
   not fit one bounded response. Generation is staged across deliveries with the
   partial candidate held in encrypted artifacts, and it is assembled and
   compiled only when complete — no partial activation.
3. **Evaluating the release in one call.** Rejected because §23.7 scopes the
   evaluator to a rule, its cited meanings, and its permitted fragments. A
   whole-release call would let a weak rule hide behind strong neighbours and
   would exceed the input bound on any realistic release.
4. **Reusing `pattern_provider_daily_usage` for pipeline spend.** Rejected
   because `0007` already created a separate `pattern_ontology_provider_daily_usage`
   for exactly this, and merging them would let an ontology build exhaust the
   ceiling that serves readers.
5. **Letting the evaluator propose corrected records.** Rejected outright: §23.7
   says the evaluator cannot edit a rule. An evaluator that can rewrite what it
   judges is a second generator with no independent check.

## Contracts

Two additive amendments, both optional properties on existing objects, both
recorded in the manifest's `amendments` array in the shape of the existing entry.

**On `pattern-ontology-evaluation.schema.json`**, optional
`evaluation_report_hash` and `regression_report_hash`, each a
`common.schema.json#/$defs/contentHash`. This closes the §23.9 gap named above:
the ingest route is required to verify report hashes and today has none to
verify. The pipeline computes each report, stores it as an R2 artifact, and
carries its hash in the evaluation object, which is inside the signed payload.

**On `pattern-ontology-release.schema.json`**, the `provenance` object introduced
by the Slice A design, which this pipeline populates with
`origin: "machine_pipeline"`. If Slice A lands first this is already present and
Slice B adds nothing; if Slice B lands first it carries the amendment.

Ingestion then verifies, before the pointer moves: corpus release identity and
hash, canonical bundle hash, both report hashes, signing-key allowlist,
signature, version immutability, and recall state — which is §23.9's list.

Each amendment needs a fixture under `fixtures/valid/` and a rejection case under
`fixtures/invalid/`. `contracts/m0` through `contracts/m6` stay byte-identical,
and `contracts/m7`'s `schema_version`, `$id`s, enums and required fields are
unchanged.

## Configuration, budget and observability

**A separate rollout switch.** `ONTOLOGY_PIPELINE_ROLLOUT` (`off` | `internal`),
defaulting to `off`, refused when malformed, and read by `checkSecureConfig`
exactly as `PATTERN_AI_ROLLOUT` is. A pipeline run is an operator action, never a
consequence of user traffic.

**Its own provider tuple**, pinned by exact equality against compiled constants
the way the Pattern pins already are: generator and evaluator model, reasoning,
prompt version, timeout and output-token ceiling; input byte cap; corpus and
policy versions. Generator and evaluator prompt versions must differ.

**Its own ledger.** `pattern_ontology_provider_daily_usage` gains the helper it
never had, consuming one unit immediately before each provider call, with no
refund on failure — the §25.3 semantics, applied to the pipeline's own table.
Note the table has a single undifferentiated `used_calls` column, the same shape
the adapter design's Q6 found non-conformant for `pattern_provider_daily_usage`;
whichever migration adds per-stage-class counters there should add them here in
the same change rather than leaving the two ledgers asymmetric.

**Scale, stated before it is approved.** A full run is dominated by regression.
Order-of-magnitude: generation across several deliveries, one evaluator call per
rule at 40–50 rules, and one full Pattern generation per fixture chart across
§23.8's chart classes and locales at slice 1's per-Pattern cost. That is a
**hundreds-of-calls** operation per release candidate, not a handful, and a failed
release near the end of regression has already spent nearly all of it. The
runbook must carry the arithmetic — fixture chart count × per-Pattern worst case
× token bounds × current rates — and an approved ceiling, before the first run.

**Logging.** The same closed-union discipline. New safe-log arms carry event
name, stage, rule index or fixture id, model, prompt version, latency, token
counts and failure class. Never logged: corpus excerpts, fragment text,
normalized propositions, candidate records, evaluator rationales, generated
prose, or any provider message. Source excerpts are licensed third-party text and
are the most tempting thing in the pipeline to log.

## Verification strategy

**Corpus reader.** A corpus whose recomputed hash differs is refused; a corpus
with `license_resolved` absent or false is refused — and the schema's `const:
true` means the only reachable failure is absence, which the reader must still
handle; a record citing a fragment id absent from the corpus fails the release;
`internal_synthetic` and `licensed_excerpt` fragments are distinguished and the
distinction survives into the release evidence.

**Generator.** Request shape asserted exactly as the adapter's: one instructions
string, one JSON input document, `strict: true`, `store: false`, and no tools,
browsing, file search, code execution, MCP, background, `previous_response_id`,
temperature, seed or metadata field. Corpus excerpt text that reads as an
instruction stays an inert JSON string value.

**Compiler driver.** A candidate with a cycle, an unknown input meaning, a
non-canonical aspect pair, or a `source_supported` record with no fragments is
refused as a whole, and the failure codes reach the compilation report.

**Evaluator.** One call per rule; a rule verdict cannot carry a replacement
record — asserted structurally against the verdict schema, not by convention; one
failing rule fails the release; the evaluator receives no other candidate rule's
prose and no user data of any kind.

**Regression.** Every §23.8 chart class is represented, including unknown
birth-time profiles where houses, angles and time-sensitive Moon claims must be
suppressed, adversarial fragments containing instruction-like text, and
maximum-depth synthesis. Each §23.8 activation gate has its own failing test —
in particular a deliberately leaked suppressed feature must fail the run rather
than lower a score.

**Signing and ingestion.** The pipeline Worker has no signing key binding,
asserted by a test over its `Env` type; a bundle with a valid signature but a
mismatched report hash is refused at ingest; a bundle whose corpus release hash
does not match the corpus it was built from is refused; re-posting identical
bytes is idempotent and re-posting different bytes under one version is
`ontology_version_immutable`.

**End to end.** A synthetic corpus release drives one complete run to an active
release carrying `provenance.origin: "machine_pipeline"`, and that release then
reserves successfully for an account *not* on `PATTERN_INTERNAL_ACCOUNT_IDS` —
which is the single test that proves Slice B did what Slice A deliberately
could not.

## Reconciliation with the other two designs

**With the Slice A design.** Slice B populates the provenance marker Slice A
introduced, and the end-to-end test above is the mirror of Slice A's containment
test. One correction flows backwards: Slice A's design says a hand-authored
release "cites source fragments that do not exist," and the corpus contract's
`license_class: "internal_synthetic"` means Slice A can instead author a real
synthetic *corpus release* whose fragment ids its ontology records resolve
against. That is strictly more honest and costs Slice A one authored document. It
does not change Slice A's internal-only status — an internal synthetic corpus is
still not §23.2's curated corpus — but it should be folded into that design.

**With the adapter design.** Slice B **depends on slice 1** and cannot start
before it: §23.8's regression exercises the real planner and writer, which do not
exist until the adapter lands. The adapter design's rollout gate 10 advances to
`first_open` on success and spend metrics; under the Slice A gate that is
unreachable without a `machine_pipeline` release, so gate 10 needs Slice B named
as a precondition. The adapter plan's reviewed AI Gateway section is the baseline
for this slice's provider posture — forbidden headers, no-log posture, the closed
allowlist of documented Cloudflare error codes, and `unknown` for every other
routed failure — and if the pipeline also uses provider-native BYOK, a request
provider key would take precedence and bypass the stored key, so stored mode
sends no provider `Authorization` and pins `cf-aig-byok-alias`.

## Resolved questions

1. **Signing isolation:** use the second Worker and a service binding. CI-held
   signing is not an approved fallback.
2. **First corpus:** implementation and hermetic end-to-end certification use a
   contract-valid `internal_synthetic` corpus. Public activation additionally
   requires an immutable corpus release whose fragments are authorized as
   `licensed_excerpt` with machine-readable license and usage metadata. Corpus
   acquisition remains outside engineering, but the required artifact shape and
   stop condition are fixed; absence stops before signing and ingestion. No
   human record approval is introduced.
3. **Fixture corpus and threshold:** the first supported locale is `en-US`, with
   30 activation fixtures: 10 exact-, 10 approximate-, and 10 unknown-birth-time
   charts. The manifest must cover every §23.8 axis across that set. Structural
   acceptance is at least 90% independently in each birth-time class, while all
   hard gates remain zero-tolerance. If generator and evaluator model pins are
   equal, structural acceptance rises to 100% in every class. Adding a locale
   requires another complete 30-fixture lane for that locale.
4. **Failed-run retention:** encrypted request, response, candidate, and report
   artifacts from a failed run expire after seven days. Closed failure metadata
   and aggregate usage remain; corpus excerpts and generated records are never
   logged. Successful signed release evidence follows the release-retention and
   recall rules rather than the failed-run TTL.
5. **Successors:** the first `machine_pipeline` release is a fresh lineage and
   receives no Slice A records as predecessor input. Its activation recalls the
   Slice A release and triggers withdrawal for documents based on it. Later
   machine releases are successors to the active machine release and may receive
   those active records exactly as §23.5 specifies.

## Out of scope

- curating, acquiring, licensing or assessing source material, and any network
  retrieval of source text;
- changing `compileOntologyRelease`, `ontologyRecordMatchesFeature`, or any other
  `packages/pattern-engine` behavior;
- changing `contracts/m7`'s `schema_version`, any `$id`, any enum, or any
  required field;
- advancing `PATTERN_AI_ROLLOUT` in any environment, and configuring any secret,
  as a consequence of merging;
- the OpenAI Pattern adapter (slice 1), the internal-only release (Slice A), the
  administrator boundary (Slice C), and the disaster-recovery replay ledger
  (Slice D);
- giving any pipeline pass tools, browsing, file search, code execution, remote
  MCP servers, background mode, or provider-side conversation state;
- an evaluator that can edit, patch or conditionally approve a rule; and
- serving any reader from a release that has not completed every gate in this
  document.
