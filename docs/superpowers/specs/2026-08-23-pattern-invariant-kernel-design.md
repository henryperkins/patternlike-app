# Pattern Invariant Kernel Design

Status: approved on 2026-08-23

Repository baseline: henryperkins/patternlike-app at a9a45b7516689cecadbd53677a229356069c6e38

Scope: M7 per-user Pattern generation and lifecycle

## Goal

Replace the current collection of overlapping M7 rules with five root
invariants. Preserve the existing planner, writer, verifier, artifact,
publication, claim, privacy, validation, replay, and rollout behavior.

This is a consolidation refactor. It does not introduce a new Pattern
architecture and it does not use the refactor to repair unrelated gaps.

## Problem

The current M7 documentation places product guarantees, versioned policy,
durable-execution mechanisms, provider compatibility requirements, and rollout
gates beside one another as peer invariants. The relationships between them
must therefore be reconstructed by every engineer.

The runtime has the same distribution:

- apps/api/src/services/pattern-execute.ts owns orchestration and most of the
  durable stage state machine;
- claim mutations are written directly by enqueue, execution, lifecycle,
  sweep, and replay paths;
- the provider deny policy is duplicated between TypeScript and Python; and
- publication receives a wide set of inputs and independently decides which
  fields are authoritative.

The simplification keeps the current architecture and gives each root
invariant one primary code owner and one primary test suite. Supporting
modules and secondary tests remain in place.

## Taxonomy

An atomic M7 rule is classified as exactly one of:

- root invariant: a product or safety property that must remain true across
  policy and implementation changes;
- derived rule: an executable consequence of one root invariant;
- versioned policy: a reviewed value that may change without changing a root
  invariant;
- mechanism: one implementation used to preserve a root invariant; or
- deployment gate: an operational precondition for admitting work.

Source prose containing more than one guarantee is split into atomic inventory
rows before classification. This prevents a compound paragraph from appearing
to belong to two roots.

## Root invariant 1: Closed authority boundary

A Pattern may be influenced only by verified calculated facts and records from
an authorized ontology. Providers receive only an explicit minimized
projection. Models and operational actors cannot bypass deterministic
admission, validation, or publication gates.

This root owns the following derived rules:

- models do not calculate or modify chart facts;
- unsupported or suppressed features are not interpreted;
- raw birth details, account identifiers, personal context, source fragments,
  and prior content do not cross the provider boundary;
- provider documents are built field by field and checked again after
  serialization;
- planner, writer, and verifier receive no tools, browsing, file search, code
  execution, MCP, or provider-side conversation state;
- the verifier returns a verdict and cannot edit or publish;
- application code performs deterministic validation and publication; and
- no human content step can waive a failed per-Pattern gate.

Primary code owner after this work:
apps/api/src/services/pattern-packet.ts.

Normative collaborators:

- packages/pattern-engine for selection and deterministic validation;
- ontology compilation, evidence verification, signing, and activation for
  authorization of meaning; and
- final publication code for the application-only commit boundary.

Primary test suite:
apps/api/src/services/pattern-packet.test.ts.

## Root invariant 2: Frozen generation snapshot

Reservation creates one immutable generation snapshot. Later stages use the
chart, feature set, locale revision, consent grant, ontology release, provider
pin, attempt ceilings, and policy identities frozen for that generation.
Current mutable eligibility is checked without silently substituting newer
inputs.

The existing failure and cancellation classifications remain unchanged by this
refactor. A mismatch continues to fail closed through its current path.

This root owns the following derived rules:

- the command is encrypted under the user's DEK and never copied into a queue
  message or log;
- chart, feature-set, locale, consent, ontology, policy, and provider
  identities are pinned at reservation;
- ordinary ontology pointer changes do not replace a running job's ontology;
- live provider configuration supplies transport and credentials but does not
  replace the author pin stored at reservation;
- executed provider metadata must agree with the frozen pass pin; and
- publication and public provenance refer to the frozen, executed author
  configuration.

Primary code owner:
apps/api/src/services/pattern-command.ts.

Primary test suite:
apps/api/src/services/pattern-command.test.ts.

The current command, job row, eligibility checks, and protocol tests remain
supporting enforcement. This design does not add another snapshot abstraction.

## Root invariant 3: One authoritative result per attempt coordinate

Each generation, pass, stage-generation, and attempt coordinate may have only
one authoritative committed response. Redelivery adopts that response before
another provider call. A genuine retry moves to a new attempt coordinate
through one guarded transition.

This is not exactly-once provider execution. If a provider call completes but
its response is lost before the create-only response artifact commits, the
same request may be called again. The guarantee begins at the authoritative
committed response.

This root owns the following derived rules:

- request and response identities include attempt;
- the response artifact is probed before budget reservation or fetch;
- request-artifact presence alone never suppresses a call;
- a conflicting artifact is fatal and is never overwritten;
- an adopted response incurs no second provider call or budget charge;
- success does not increment the pass whose result it commits;
- a same-pass retry increments that pass;
- verifier rejection increments the next writer attempt;
- entry to a new candidate resets verifier attempts;
- stage generation advances only on the existing cross-stage and terminal
  transitions; and
- duplicate and stale queue deliveries cannot advance the job.

Primary code owner after pull request 2:
apps/api/src/services/pattern-stage-protocol.ts.

Primary test suite after pull request 2:
apps/api/src/services/pattern-stage-protocol.test.ts.

The protocol uses one discriminated transition type. It represents the current
advance, retry, return-to-writer, failure, cancellation, and publication-retry
effects without adding a second state machine. The protocol decides counter and
stage-generation effects; orchestration chooses the outcome.

The current 11-call maximum remains a versioned budget policy:

    2 planner calls
    + 3 writer calls
    + 3 candidates × 2 verifier calls
    = 11 provider calls per Pattern

## Root invariant 4: Proof-carrying publication

Publication requires a narrow proof binding the frozen generation snapshot,
validated plan, exact candidate bytes, passing semantic verdict, executed
writer pin, and current mutable authorization. The accepted document and claim
consumption commit together or neither commits.

This root owns the following derived rules:

- planner output validates before its plan is frozen;
- every writer result matches the frozen plan;
- every prose unit carries private evidence before consumer projection;
- the candidate hash identifies the exact bytes reviewed by the verifier;
- the semantic verdict hash identifies a passing verdict for that candidate;
- a verifier pass alone cannot publish;
- partial and rejected drafts are never reader-visible;
- final mutable authorization is checked before commit; and
- document insertion, claim acceptance, job success, compact provenance, replay
  receipt, and publication audit converge atomically.

Primary code owner after pull request 3:
apps/api/src/services/pattern-publication-proof.ts.

Primary test suite after pull request 3:
apps/api/src/services/pattern-publication-proof.test.ts.

The publication proof is the narrow interface approved for this refactor:

    interface PatternPublicationProof {
      generationId: string;
      jobId: string;
      claimId: string;
      chartFingerprintHash: string;
      featureSetHash: string;
      locale: string;
      localeRevision: number;
      consentId: string;
      ontologyVersion: string;
      ontologyBundleHash: string;
      planHash: string;
      candidateHash: string;
      semanticVerdictHash: string;
      semanticVerdict: "pass";
      executedWriterPin: PatternPublisherPin;
    }

The proof builder reads the corresponding stored artifacts and recomputes their
hashes. It does not accept unverified caller hash strings. Publication continues
to encrypt and commit the accepted document through the existing application
path.

## Root invariant 5: Monotonic claim and erasure lifecycle

Before acceptance, a claim may be reserved and released. After acceptance, it
is permanently consumed. Deletion, chart correction, or ontology withdrawal
may erase content and advance the lifecycle reason, but no consumed fingerprint
may return to available or reserved.

This root owns the following derived rules:

- one accepted Pattern consumes one user and chart-fingerprint claim;
- failed or cancelled work may release only an unconsumed reservation;
- acceptance sets consumed_at and never clears it;
- accepted content may move to deleted, superseded, or withdrawn;
- deleted, superseded, and withdrawn claims never reopen or change terminal
  reason;
- only a reserved claim carries an active generation;
- wrapped-key erasure ends readability even if physical object cleanup is
  delayed; and
- the signed replay ledger reapplies consumption and erasure after restoration
  without resurrecting content or eligibility.

Primary code owner after pull request 3:
apps/api/src/db/pattern-claim-transitions.ts.

Primary test suite after pull request 3:
apps/api/src/db/pattern-claim-transitions.test.ts.

The live repository exposes only these operations:

- reserve;
- release unconsumed;
- accept;
- delete accepted;
- supersede accepted; and
- withdraw accepted.

It returns guarded D1 statements so claim transitions remain inside the
caller's existing atomic batch. The signed replay restorer is the explicit
exception to live-repository ownership and remains separately documented and
tested. It does not bypass monotonicity: it may insert an absent terminal
tombstone, while an existing claim must converge through trigger-legal forward
steps in replay-event order.

Migration 0013 adds a BEFORE UPDATE transition guard for:

    available  → reserved
    reserved   → available
    reserved   → accepted
    accepted   → deleted
    accepted   → superseded
    accepted   → withdrawn
    state      → same state

The migration also preserves the approved consumed-at, terminal-timestamp, and
active-generation rules. It is forward-only and is not applied to production
as part of merging its code.

## Rules that are not roots

The following remain enforced but are documented under their real category:

| Rule | Category | Root served |
|---|---|---|
| Two planner, three writer, two verifier calls per candidate | Versioned budget policy | 3 |
| 11-call worst-case generation | Derived budget calculation | 3 |
| 30, 120, and 600-second retry delays | Retry policy | 3 |
| Word, chapter, signature, and byte limits | Output policy | 1 |
| Strict-schema keyword support | Provider compatibility gate | 1 |
| Prompt versions and model pins | Frozen configuration | 2 |
| PATTERN_AI_ROLLOUT modes | Deployment admission | 1 |
| Worker or gateway credential mode | Deployment configuration | 1 |
| Leases, sweeps, and queue nudges | Durable execution mechanism | 3 |
| Public model-family provenance | Reader evidence projection | 4 |
| Synthetic publisher development restriction | Secure configuration gate | 1 |
| Artifact and failed-metadata retention periods | Retention policy | 5 |

Changing a policy requires a versioned decision. Refactoring a mechanism must
preserve the root it serves. Neither is promoted to a sixth invariant.

## Implementation sequence

### Pull request 1: Define and freeze

- add this design;
- add docs/reviews/2026-08-23-pattern-invariant-inventory.md;
- record every current guarantee, classification, root, authority, and test;
- add characterization coverage only when current behavior lacks a direct
  existing test; and
- make no runtime, contract, migration, pin, rollout, or retention change.

### Pull request 2: Extract the durable stage protocol

- create apps/api/src/services/pattern-stage-protocol.ts;
- create apps/api/src/services/pattern-stage-protocol.test.ts;
- move stage mapping, attempt coordinates, artifact classes, transition
  legality, counter arithmetic, hash effects, and public-stage mapping out of
  pattern-execute.ts;
- keep pattern-execute.ts as the orchestrator; and
- retain the current integration and exact 11-call suites.

### Pull request 3: Publication proof and claim transitions

- create apps/api/src/services/pattern-publication-proof.ts and its tests;
- create apps/api/src/db/pattern-claim-transitions.ts and its tests;
- replace direct live claim updates in enqueue, execution, lifecycle, and sweep;
- adapt replay only where required by the transition guard;
- add db/d1/0013_pattern_claim_transition_guards.sql;
- update the migration manifest and populated upgrade fixture; and
- do not apply the migration to production.

### Pull request 4: Provider boundary and documentation

- create contracts/policies/pattern-provider-boundary-v1.json;
- make TypeScript and Python consume the same forbidden-key and opaque-prefix
  policy bytes;
- keep explicit TypeScript allowlist construction and the post-serialization
  walk;
- explicitly forbid chart_fingerprint_hash by whole key;
- preserve the approved calculated-longitude exception;
- update CLAUDE.md and current architecture and rollout documentation; and
- link or amend historical specifications rather than silently rewriting them.

## Verification

Targeted verification:

    npm exec -w @patternlike/api -- vitest run \
      src/services/pattern-stage-protocol.test.ts \
      src/services/pattern-execute-protocol.test.ts \
      src/services/pattern-publication-proof.test.ts \
      src/db/pattern-claim-transitions.test.ts \
      src/services/pattern-lifecycle.test.ts \
      src/services/pattern-replay-ledger.test.ts \
      src/routes/pattern-ai.integration.test.ts

Full verification:

    npm run typecheck
    npm test
    npm run build
    python3 contracts/validate_schemas.py

Verification must also prove:

- both committed Wrangler environments keep Pattern rollout off;
- tests make no live provider call;
- no active ontology or production claim is required;
- migrations 0001 through 0012 remain byte-identical;
- migration 0013 applies to empty and populated post-0012 fixtures;
- M7 responses remain contract-identical;
- the exact 11-call ceiling is unchanged;
- duplicate delivery adopts a committed response without another charge;
- publication tampering cannot consume a claim;
- terminal claim states cannot reopen; and
- replay restoration converges without resurrecting erased content.

## Explicit non-goals

This work does not:

- remove or merge planner, writer, or verifier stages;
- change model, prompt, policy, or provider-call pins;
- change M7 response schemas or request shapes;
- expose the private claim or evidence ledgers;
- weaken provider input minimization;
- replace encrypted R2 artifacts with clear D1 JSON;
- remove or redesign the replay ledger;
- change no-reroll, deletion, correction, or withdrawal behavior;
- activate an ontology;
- advance PATTERN_AI_ROLLOUT;
- apply a production migration;
- repair the blocked Gate 7B rollout; or
- add abstractions unrelated to consolidating the five roots.

## Definition of done

The refactor is complete when:

1. Engineers need to remember five root invariants rather than a peer list of
   mechanisms and policy values.
2. Every atomic derived rule maps to exactly one root.
3. Each root names one primary code owner and supporting enforcement explicitly.
4. Each root names one primary test suite.
5. Claim monotonicity is guarded in D1 as well as application code.
6. Stage and attempt semantics are represented by one typed protocol.
7. Publication consumes the approved narrow proof derived from stored bytes.
8. Provider deny policy has one machine-readable source.
9. Existing safety checks, lifecycle behavior, contracts, and rollout gates are
   not weakened.
10. The full repository gate passes from one commit.
