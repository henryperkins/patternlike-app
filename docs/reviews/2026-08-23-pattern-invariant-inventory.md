# Pattern Invariant Inventory

Date: 2026-08-23

Baseline: a9a45b7516689cecadbd53677a229356069c6e38

Scope: M7 per-user Pattern generation and lifecycle

Status: documentation-only characterization for pull request 1

## Purpose

This inventory gives every current M7 guarantee one destination in the
five-root invariant kernel. It distinguishes product invariants from policies,
mechanisms, provider compatibility, and deployment gates without deleting any
guarantee.

Compound source prose is split into atomic rows. Each root section therefore
maps individual guarantees, not necessarily entire source bullets or
paragraphs.

## Sources reviewed

Current cross-file guidance:

- CLAUDE.md, AI Pattern generation (M7);
- docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md;
- docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md;
- docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md;
- docs/superpowers/specs/2026-08-16-m7-evidence-gates-design.md;
- docs/superpowers/specs/2026-08-16-pattern-replay-ledger-design.md;
- docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md;
- docs/superpowers/plans/2026-08-15-m7-remaining-slices-ledger.md; and
- docs/deploy/openai-pattern-rollout.md.

Executable authorities:

- contracts/m7 and contracts/validate_schemas.py;
- packages/pattern-engine;
- apps/api/src/services/pattern-command.ts;
- apps/api/src/services/pattern-packet.ts;
- apps/api/src/services/pattern-prompt.ts;
- apps/api/src/services/pattern-publisher.ts;
- apps/api/src/services/pattern-execute.ts;
- apps/api/src/services/pattern-enqueue.ts;
- apps/api/src/services/pattern-lifecycle.ts;
- apps/api/src/services/pattern-sweep.ts;
- apps/api/src/services/pattern-replay-ledger.ts;
- apps/api/src/db/pattern-claims.ts;
- apps/api/src/db/pattern-ontology.ts;
- db/d1/0007_ai_generated_pattern.sql through
  db/d1/0012_ontology_pipeline.sql; and
- the adjacent Pattern unit and integration suites.

Where historical design prose disagrees with the frozen M7 contracts or later
approved amendments, the freeze and amendments win. This inventory records
shipped behavior rather than restoring superseded prose.

## Source-to-root map

| Source location | Destination |
|---|---|
| CLAUDE.md M7 stage-chain and rollout-off preamble | Roots 1, 3, and 4 after splitting the stage guarantees; rollout state is a deployment gate serving root 1 |
| CLAUDE.md M7 provider-boundary and strict-schema bullets | Root 1; schema support is a compatibility gate serving root 1 |
| CLAUDE.md M7 call-ceiling, counter, and artifact-first bullets | Root 3; numeric ceilings and delays remain policy |
| CLAUDE.md M7 executed-provenance bullet | Root 2; public projection belongs to root 4 |
| CLAUDE.md M7 synthetic-publisher bullet | Root 1 as a secure-configuration gate |
| AI Pattern design sections 4.2, 6.3, 10.2–10.3, 12–14, 23, and 29.1–29.4 | Root 1 |
| AI Pattern design sections 10.1, 16.1, 23.11, and 25.1 | Root 2; the final mutable portion of 16.1 belongs to root 4 |
| AI Pattern design sections 6.2, 15, 18.3, 25.3–25.4, and 29.5–29.7 | Root 3 |
| AI Pattern design sections 12.3, 13.4, 14.5, 16, 18.1, and 29.8 | Root 4 |
| AI Pattern design sections 4.3, 17.3, 18.4–18.6, 21, 29.10–29.11, and 30 | Root 5 |
| OpenAI Pattern adapter provider-boundary, pass, verifier-independence, and human-free sections | Root 1 |
| OpenAI Pattern adapter provenance and frozen-configuration sections | Root 2 |
| OpenAI Pattern adapter failure, retry, idempotency, artifact, and call-ceiling sections | Root 3 |
| OpenAI Pattern adapter publication and public-provenance sections | Root 4 |
| M7 amendments and frozen contracts | The atomic rule they amend; the freeze is not a sixth root |
| Replay-ledger design and replay runbook | Root 5 |
| M7 evidence-gate design and rollout runbook | Deployment gates serving roots 1, 3, 4, and 5 |
| Remaining-slices and adapter implementation plans | Mechanism and verification references under the relevant root |

## Reference keys

### Current enforcement

| Key | Authority |
|---|---|
| E-AUTH | packages/pattern-engine selection, plan validation, and candidate validation |
| E-PACKET | apps/api/src/services/pattern-packet.ts |
| E-PROMPT | apps/api/src/services/pattern-prompt.ts and OpenAI adapter request construction |
| E-COMMAND | apps/api/src/services/pattern-command.ts and pattern-enqueue.ts |
| E-EXEC | apps/api/src/services/pattern-execute.ts |
| E-PUBLISHER | apps/api/src/services/pattern-publisher.ts and pattern-publisher-factory.ts |
| E-CLAIM | apps/api/src/db/pattern-claims.ts plus direct live callers |
| E-LIFECYCLE | apps/api/src/services/pattern-lifecycle.ts and pattern-sweep.ts |
| E-REPLAY | apps/api/src/services/pattern-replay-ledger.ts |
| E-ONTOLOGY | ontology verification, ingestion, signing, pointer, and evidence code |
| E-ROLLOUT | apps/api/src/services/pattern-rollout.ts, secure configuration, and wrangler.toml |
| C-M7 | contracts/m7 schemas and fixtures |
| C-PY | contracts/validate_schemas.py M7 policy checks |
| D-0007 | db/d1/0007_ai_generated_pattern.sql |
| D-0008 | db/d1/0008_pattern_erasure_replay.sql |
| D-0009 | db/d1/0009_pattern_correction_artifact.sql |
| D-0010 | db/d1/0010_pattern_stage_class_usage.sql |
| D-0011 | db/d1/0011_ontology_pipeline_evidence.sql |
| D-0012 | db/d1/0012_ontology_pipeline.sql |

### Test evidence

| Key | Suite |
|---|---|
| T-AUTH | packages/pattern-engine/src/engine.test.ts |
| T-PACKET | apps/api/src/services/pattern-packet.test.ts |
| T-PROMPT | apps/api/src/services/pattern-prompt.test.ts and pattern-publisher.test.ts |
| T-COMMAND | apps/api/src/services/pattern-command.test.ts |
| T-PROTOCOL | apps/api/src/services/pattern-execute-protocol.test.ts |
| T-OPENAI | apps/api/src/services/pattern-execute-openai.test.ts |
| T-INTEGRATION | apps/api/src/routes/pattern-ai.integration.test.ts |
| T-LIFECYCLE | apps/api/src/services/pattern-lifecycle.test.ts |
| T-REPLAY | apps/api/src/services/pattern-replay-ledger.test.ts and internal replay integration tests |
| T-ROLLOUT | apps/api/src/services/pattern-rollout.test.ts and secure-configuration tests |
| T-CONTRACT | python3 contracts/validate_schemas.py |
| T-MIGRATION | apps/api/test/apply-migrations.ts through the API test setup |

Status values:

- enforced: a direct executable guard and direct test exist;
- distributed: executable enforcement exists in more than one live caller;
- partial: only part of the source guarantee is checked directly;
- prose or operations: the statement is architectural or a rollout procedure,
  not a standalone runtime predicate.

## Root 1 inventory: Closed authority boundary

| ID | Atomic guarantee | Category | Current enforcement | Primary test; secondary tests | Status |
|---|---|---|---|---|---|
| A01 | Chart facts come from calculation and normalized M4 natal features, not a model | Root invariant | E-AUTH, E-EXEC | T-AUTH; T-INTEGRATION | enforced |
| A02 | Only selected, supported, unsuppressed features may influence generation | Derived rule | E-AUTH | T-AUTH; T-PROTOCOL | enforced |
| A03 | Astrological meaning must resolve through an authorized ontology release | Derived rule | E-AUTH, E-ONTOLOGY, E-EXEC | T-AUTH; T-INTEGRATION | enforced |
| A04 | Planner, writer, and verifier documents are rebuilt field by field | Mechanism | E-PACKET | T-PACKET | enforced |
| A05 | Serialized provider documents are walked after construction | Mechanism | E-PACKET | T-PACKET; T-PROTOCOL | enforced |
| A06 | User, chart, consent, birth, context, prior-content, and alias-map fields do not cross the provider boundary | Derived privacy rule | E-PACKET, C-PY | T-PACKET; T-CONTRACT | distributed |
| A07 | Calculated longitude is allowed only in the approved feature-fact location | Derived privacy rule | E-PACKET, C-PY | T-PACKET; T-CONTRACT | enforced |
| A08 | Source-fragment IDs and excerpts are removed from per-user provider inputs | Derived privacy rule | E-PACKET | T-PACKET; T-PROTOCOL | enforced |
| A09 | Provider requests have no tools, browsing, file search, code execution, MCP, background mode, or conversation state | Derived authority rule | E-PROMPT | T-PROMPT; T-OPENAI | enforced |
| A10 | Provider schemas derive from frozen M7 schemas rather than copied shapes | Mechanism | E-PROMPT, C-M7 | T-PROMPT; T-CONTRACT | enforced |
| A11 | Unsupported strict-schema keywords fail the provider compatibility gate | Provider compatibility gate | E-PROMPT | T-PROMPT | enforced |
| A12 | The planner may organize evidence but cannot publish prose | Derived role rule | E-AUTH, E-EXEC | T-AUTH; T-PROTOCOL | enforced |
| A13 | The writer must stay inside the validated plan and evidence ledger | Derived role rule | E-AUTH, E-EXEC | T-AUTH; T-PROTOCOL | enforced |
| A14 | The verifier returns pass or reject and cannot edit or publish | Derived role rule | E-PROMPT, E-EXEC | T-PROMPT; T-PROTOCOL | enforced |
| A15 | Writer and verifier configurations are not identical | Derived separation rule | E-PUBLISHER | T-PROMPT; T-OPENAI | enforced |
| A16 | Trusted application code alone commits publication | Derived authority rule | E-EXEC | T-PROTOCOL; T-INTEGRATION | enforced |
| A17 | No person reviews, edits, approves, selects, or publishes an individual Pattern | Product/operational rule | No content-review endpoint; machine stage chain; rollout runbook | T-PROTOCOL; rollout evidence | prose or operations |
| A18 | Synthetic publishing is refused outside development | Secure configuration gate | E-PUBLISHER, E-ROLLOUT | T-ROLLOUT; T-PROTOCOL | enforced |
| A19 | Pattern prompts, facts, plans, drafts, verdict rationale, and prose are excluded from ordinary logs | Derived privacy rule | closed safe-log vocabulary and executor logging | safe-log tests; T-OPENAI | enforced |
| A20 | Writer correction documents contain closed finding metadata and never rejected prose or free-text rationale | Derived privacy and authority rule | E-PACKET, E-EXEC | T-PACKET; T-PROTOCOL; T-OPENAI | enforced |
| A21 | Every eligible feature is assigned one closed coverage outcome before publication | Derived authority rule | E-AUTH | T-AUTH; T-PROTOCOL | enforced |
| A22 | Administrative artifact inspection is authorized, retention-aware, and audited; it cannot edit, approve, or publish content | Product/operational rule | admin route authorization, artifact repository, access-event audit | T-INTEGRATION; rollout evidence | distributed |

Primary owner after consolidation: apps/api/src/services/pattern-packet.ts.

Primary suite after consolidation: T-PACKET.

## Root 2 inventory: Frozen generation snapshot

| ID | Atomic guarantee | Category | Current enforcement | Primary test; secondary tests | Status |
|---|---|---|---|---|---|
| S01 | Reservation writes one DEK-encrypted GeneratePatternCommandV1 | Root invariant mechanism | E-COMMAND | T-INTEGRATION; T-PROTOCOL | enforced |
| S02 | Queue messages carry only opaque job, generation, kind, and stage-generation fields | Derived privacy rule | queue parser and E-COMMAND | queue tests; T-INTEGRATION | enforced |
| S03 | Generation, job, claim, user, and chart identities are frozen in the command | Frozen configuration | E-COMMAND | T-INTEGRATION | enforced |
| S04 | Chart fingerprint, profile version, and calculation-contract identity are frozen | Frozen configuration | E-COMMAND | T-INTEGRATION | partial: command stores all; execution directly compares chart ID and fingerprint |
| S05 | Feature-set identity, hash, and feature-policy version are frozen | Frozen configuration | E-COMMAND, E-EXEC | T-PROTOCOL; T-INTEGRATION | partial: execution compares feature-set hash |
| S06 | Selection-policy identity and version are frozen | Frozen configuration | E-COMMAND, E-PUBLISHER | T-PROTOCOL | partial: stored and projected, not independently compared at each stage |
| S07 | Confirmed locale and locale revision are frozen and rechecked | Derived rule | E-COMMAND, E-EXEC | T-PROTOCOL; T-INTEGRATION | enforced |
| S08 | Exact Pattern-consent grant and policy version are frozen | Frozen configuration | E-COMMAND | T-INTEGRATION | partial: execution checks consent ID; policy version is stored |
| S09 | Ontology version, bundle hash, and corpus-release hash are frozen | Frozen configuration | E-COMMAND, E-EXEC, E-ONTOLOGY | T-PROTOCOL; T-INTEGRATION | partial: execution checks version and bundle hash |
| S10 | Ordinary ontology pointer movement does not replace the frozen release | Derived rule | E-EXEC, E-ONTOLOGY | T-PROTOCOL; T-INTEGRATION | enforced |
| S11 | Ontology recall prevents further advancement | Current mutable gate | E-EXEC, E-LIFECYCLE, E-ONTOLOGY | T-LIFECYCLE; T-INTEGRATION | enforced |
| S12 | Publisher, models, reasoning, prompts, output caps, input cap, and policy pins are frozen | Frozen configuration | E-COMMAND, E-PUBLISHER | T-PROTOCOL; T-OPENAI | enforced |
| S13 | Live configuration cannot silently replace the author pinned at reservation | Derived rule | E-EXEC, E-PUBLISHER | T-PROTOCOL | enforced |
| S14 | Executed provider, pass, model, and prompt metadata must match the frozen pin | Derived rule | E-EXEC | T-OPENAI; T-PROTOCOL | enforced on a fresh provider result |
| S15 | Planner, writer, and verifier attempt maxima are frozen and decoded as the approved values | Versioned policy snapshot | E-COMMAND | T-COMMAND; T-PROTOCOL | enforced |
| S16 | Artifact retention days are frozen | Retention-policy snapshot | E-COMMAND | T-INTEGRATION | partial: stored in command; execution currently uses resolved compatible configuration |
| S17 | A snapshot mismatch fails closed rather than substituting current state | Root consequence | E-EXEC | T-PROTOCOL; T-INTEGRATION | distributed; mismatch-specific cancellation/failure classifications intentionally remain |
| S18 | The command decoder validates the complete snapshot shape | Derived admission rule | E-COMMAND | T-COMMAND | prose gap: current decoder directly validates only command version and attempt maxima |

Primary owner: apps/api/src/services/pattern-command.ts.

Primary suite: T-COMMAND. T-PROTOCOL remains the principal end-to-end
snapshot-characterization suite.

## Root 3 inventory: One authoritative result per attempt coordinate

| ID | Atomic guarantee | Category | Current enforcement | Primary test; secondary tests | Status |
|---|---|---|---|---|---|
| T01 | Stage maps deterministically to planner, writer, verifier, publication, or terminal handling | Root protocol rule | E-EXEC, E-COMMAND | T-PROTOCOL | distributed inside executor |
| T02 | Current attempt coordinate is generation, artifact class, stage generation, and attempt | Root protocol rule | E-EXEC | T-PROTOCOL | enforced |
| T03 | Provider request and response artifact IDs include attempt | Derived idempotency rule | E-EXEC, D-0009 | T-PROTOCOL; T-MIGRATION | enforced |
| T04 | Response-artifact lookup occurs before budget reservation and fetch | Derived idempotency rule | E-EXEC | T-PROTOCOL | enforced |
| T05 | A request artifact alone does not suppress a provider call | Derived idempotency rule | E-EXEC | T-PROTOCOL | enforced |
| T06 | Create-only storage adopts only matching object, inventory, envelope, and hashes | Derived integrity rule | E-EXEC | T-PROTOCOL | enforced |
| T07 | A conflicting artifact is fatal and is never overwritten | Derived integrity rule | E-EXEC | T-PROTOCOL | enforced |
| T08 | An adopted response consumes no second call or budget unit | Derived idempotency rule | E-EXEC, provider ledger | T-PROTOCOL | enforced |
| T09 | A successful pass does not increment its own next-attempt counter | Counter rule | E-EXEC | T-PROTOCOL | enforced |
| T10 | A genuine same-pass retry increments that pass in the guarded transition | Counter rule | E-EXEC | T-PROTOCOL | enforced |
| T11 | Verifier rejection increments the next writer attempt, not verifier attempts | Counter rule | E-EXEC | T-PROTOCOL | enforced |
| T12 | Entry into semantic verification for a new candidate resets verifier attempts | Counter rule | E-EXEC | T-PROTOCOL | enforced |
| T13 | Stage generation advances on current cross-stage success, return-to-writer, terminal failure, and publication success transitions | Stage-generation rule | E-EXEC, E-LIFECYCLE | T-PROTOCOL; T-INTEGRATION | distributed |
| T14 | Same-pass and publication retries keep the current stage generation | Stage-generation rule | E-EXEC | T-PROTOCOL | enforced |
| T15 | Current cancellation paths keep their existing stage-generation behavior | Characterized behavior | E-EXEC, E-LIFECYCLE | T-INTEGRATION; T-LIFECYCLE | distributed |
| T16 | Claim-token and stage-generation probes guard final transition batches | Concurrency mechanism | E-EXEC | T-PROTOCOL; T-INTEGRATION | enforced |
| T17 | Stale or duplicate delivery performs no provider work and cannot advance state | Derived idempotency rule | E-EXEC | T-PROTOCOL; queue tests | enforced |
| T18 | The D1 job row is the durable outbox and queue sends are nudges | Durable mechanism | E-EXEC, E-LIFECYCLE | T-PROTOCOL; T-INTEGRATION | enforced |
| T19 | Sweeps recover undispatched work and expired leases within their current bounds | Durable mechanism | E-LIFECYCLE | sweep tests; T-INTEGRATION | enforced |
| T20 | A provider response lost before response-artifact commit may be retried | Explicit guarantee boundary | E-EXEC | T-PROTOCOL | enforced by design; not claimed as exactly-once execution |
| T21 | At most two planner calls occur per job | Versioned budget policy | E-COMMAND, E-EXEC | T-COMMAND; T-PROTOCOL | enforced |
| T22 | At most three writer calls occur per job against one frozen plan | Versioned budget policy | E-COMMAND, E-EXEC | T-COMMAND; T-PROTOCOL | enforced |
| T23 | At most two verifier calls occur per candidate | Versioned budget policy | E-COMMAND, E-EXEC | T-COMMAND; T-PROTOCOL | enforced |
| T24 | Worst-case provider calls are exactly bounded by 2 + 3 + 3 × 2 = 11 | Derived budget calculation | E-EXEC, D-0010, rollout approval | T-PROTOCOL | enforced |
| T25 | One budget unit is reserved atomically immediately before each real provider fetch, after local admission and artifact checks | Budget-accounting mechanism | E-PUBLISHER, provider ledger | T-PROTOCOL; T-OPENAI; provider-usage tests | enforced |
| T26 | Failed, timed-out, and rejected provider responses consume that unit with no refund; paths making no provider call consume none | Budget policy consequence | E-PUBLISHER, provider ledger | T-PROTOCOL; T-OPENAI; provider-usage tests | enforced |

Primary owner after consolidation:
apps/api/src/services/pattern-stage-protocol.ts.

Primary suite after consolidation:
apps/api/src/services/pattern-stage-protocol.test.ts.

### Current transition and counter matrix

Counters are zero-based next-attempt indexes. Success does not turn them into
completed-call counts.

| Outcome | Current stage effect | Stage generation | Planner | Writer | Verifier | Hash effect | Generic job | Next provider authorization |
|---|---|---:|---:|---:|---:|---|---|---|
| Planner success | reserved, planning, or plan_validating → writing | +1 | same | same | same | commit plan hash | queued | writer |
| Planner retry | same planner-stage value | same | +1 | same | same | none | queued with optional backoff | planner at new attempt |
| Writer success | writing or candidate_validating → semantic_verifying | +1 | same | same | reset to 0 | commit candidate hash | queued | verifier |
| Writer retry | same writer-stage value | same | same | +1 | same | none | queued with optional backoff | writer at new attempt |
| Verifier transport/output retry | semantic_verifying | same | same | same | +1 | none | queued with backoff | verifier at new attempt |
| Verifier rejection with writer capacity | semantic_verifying or publishing → writing | +1 | same | +1 | same | clear candidate hash; commit correction artifact before batch | queued | writer |
| Publication retry | semantic_verifying or publishing → publishing | same | same | same | same | retain candidate and verdict artifacts | queued with 60-second backoff | publication recovery |
| Terminal failure | any nonterminal stage → failed | +1 | same | same | same | retain current hashes | failed | none |
| Executor cancellation | any nonterminal stage → cancelled | same | same | same | same | retain current hashes | cancelled | none |
| Publication success | semantic_verifying or publishing → succeeded | +1 | same | same | same | commit candidate and verdict hashes | succeeded | none |
| Stale or duplicate delivery | no transition | same | same | same | same | none | unchanged | none |

The current executor also accepts historical plan_validating and
candidate_validating stage values even though no live path presently enters
them. They remain in the frozen domain-stage vocabulary.

## Root 4 inventory: Proof-carrying publication

| ID | Atomic guarantee | Category | Current enforcement | Primary test; secondary tests | Status |
|---|---|---|---|---|---|
| P01 | Planner output validates deterministically before plan freeze | Root proof premise | E-AUTH, E-EXEC | T-AUTH; T-PROTOCOL | enforced |
| P02 | The stored plan hash names committed response bytes | Derived integrity rule | E-EXEC | T-PROTOCOL | enforced |
| P03 | Writer validation binds the candidate to the frozen plan and authorized evidence | Root proof premise | E-AUTH, E-EXEC | T-AUTH; T-PROTOCOL | enforced |
| P04 | Every reader-prose unit carries private evidence before projection | Derived evidence rule | E-AUTH, C-M7 | T-AUTH; T-CONTRACT | enforced |
| P05 | Candidate hash is recomputed from the exact decrypted writer artifact | Derived integrity rule | E-EXEC | T-PROTOCOL | enforced |
| P06 | The verifier reviews the candidate whose hash is stored on the job | Derived integrity rule | E-EXEC | T-PROTOCOL | enforced |
| P07 | Semantic verdict structure is validated and verdict must be pass | Root proof premise | E-EXEC, C-M7 | T-PROTOCOL; T-CONTRACT | enforced |
| P08 | A verifier pass alone cannot publish | Derived authority rule | E-EXEC | T-PROTOCOL | enforced |
| P09 | Current chart, locale, consent, ontology, account, claim, and lease gates are rechecked before publication | Current mutable authorization | E-EXEC | T-PROTOCOL; T-INTEGRATION | partial: eligibility occurs at delivery start; publication batch directly probes claim and ownership |
| P10 | Publication receives only the facts needed to authorize commit | Simplification target | E-EXEC | T-PROTOCOL | gap: current publishPattern receives command, claimed job, writer, plan, hashes, and pin separately |
| P11 | Caller-provided hashes cannot substitute for stored artifact bytes | Derived proof rule | E-EXEC | T-PROTOCOL | enforced in orchestration; not represented by a standalone proof owner |
| P12 | Accepted document insertion and claim consumption commit together | Root atomicity rule | E-EXEC, D-0007 | T-PROTOCOL; T-INTEGRATION | enforced |
| P13 | Job success, domain success, compact provenance, replay receipt, and publication audit share the publication batch | Derived atomicity rule | E-EXEC, E-REPLAY | T-PROTOCOL; T-REPLAY | enforced |
| P14 | A failed publication batch leaves no reader document and no consumed claim | Derived atomicity rule | E-EXEC | T-PROTOCOL | enforced |
| P15 | Rejected, partial, and retained forensic artifacts are never reader-visible | Derived privacy rule | E-EXEC, reader state projection | T-INTEGRATION; T-LIFECYCLE | enforced |
| P16 | Public provider and model-family provenance derive from the frozen writer pin | Reader evidence projection | E-EXEC | T-PROTOCOL | enforced |
| P17 | Synthetic output keeps the frozen constrained_model wire value and honest internal provenance | Contract compatibility rule | E-EXEC, C-M7 | T-PROTOCOL; T-CONTRACT | enforced |
| P18 | Account export includes only the active accepted reader projection and excludes private evidence, rejected content, and operational artifacts | Reader evidence projection | account-export service, E-CLAIM, E-ONTOLOGY | T-INTEGRATION; T-CONTRACT | enforced |

Primary owner after consolidation:
apps/api/src/services/pattern-publication-proof.ts.

Primary suite after consolidation:
apps/api/src/services/pattern-publication-proof.test.ts.

## Root 5 inventory: Monotonic claim and erasure lifecycle

| ID | Atomic guarantee | Category | Current enforcement | Primary test; secondary tests | Status |
|---|---|---|---|---|---|
| C01 | One row exists per user and chart-fingerprint hash | Root no-reroll identity | D-0007 unique constraint, E-CLAIM | T-INTEGRATION | enforced |
| C02 | A new eligible fingerprint may be inserted directly as reserved | Derived reservation rule | E-COMMAND, D-0007 | T-INTEGRATION | enforced |
| C03 | An available unconsumed claim may become reserved for one active generation | Derived reservation rule | E-COMMAND, D-0007 | T-INTEGRATION | enforced |
| C04 | Failed or cancelled work releases only its matching unconsumed reservation | Derived release rule | E-EXEC, E-LIFECYCLE | T-PROTOCOL; T-INTEGRATION | distributed |
| C05 | Acceptance changes reserved to accepted and sets consumed_at and accepted_at | Root consumption rule | E-EXEC, D-0007 | T-PROTOCOL; T-INTEGRATION | enforced |
| C06 | Accepted may advance to deleted | Derived lifecycle rule | E-LIFECYCLE | T-LIFECYCLE; T-REPLAY | enforced by caller |
| C07 | Accepted may advance to superseded on chart correction | Derived lifecycle rule | E-LIFECYCLE | T-LIFECYCLE; T-REPLAY | enforced by caller |
| C08 | Accepted may advance to withdrawn on critical ontology recall | Derived lifecycle rule | E-LIFECYCLE | T-LIFECYCLE; T-REPLAY | enforced by caller |
| C09 | Deleted, superseded, and withdrawn do not reopen | Root monotonicity rule | E-CLAIM callers, D-0007 row checks | T-LIFECYCLE; T-REPLAY | partial: no D1 old-state/new-state guard |
| C10 | Consumed_at is never cleared or changed by live lifecycle code | Root tombstone rule | E-EXEC, E-LIFECYCLE, E-REPLAY | T-LIFECYCLE; T-REPLAY | distributed; no D1 transition trigger |
| C11 | Only reserved may carry active_generation_id | Derived coherence rule | D-0007 | T-INTEGRATION; T-MIGRATION | enforced |
| C12 | Available and reserved are unconsumed; accepted and terminal lifecycle states are consumed | Derived coherence rule | D-0007 | T-INTEGRATION; T-MIGRATION | enforced |
| C13 | Explicit deletion removes the document and erases every user Pattern artifact key | Root erasure rule | E-LIFECYCLE | T-LIFECYCLE; T-REPLAY | enforced |
| C14 | Chart correction erases stale content and preserves the old fingerprint tombstone | Root erasure rule | E-LIFECYCLE | T-LIFECYCLE; T-INTEGRATION | enforced |
| C15 | Ontology recall withdraws affected accepted content and preserves consumption | Root erasure rule | E-LIFECYCLE, E-ONTOLOGY | T-LIFECYCLE; T-INTEGRATION | enforced |
| C16 | Account deletion removes content, jobs, keys, inventory, and claim tombstones | Account-erasure rule | deletion manifest, E-REPLAY | deletion tests; T-REPLAY | enforced |
| C17 | A signed R2-first replay intent precedes live claim consumption or erasure receipt | Disaster-recovery mechanism | E-REPLAY, D-0008 | T-REPLAY; T-PROTOCOL | enforced |
| C18 | Restore replay never assigns a consumed effect back to available or reserved | Root replay consequence | E-REPLAY | T-REPLAY | enforced |
| C19 | Replay converges idempotently and does not resurrect document content or artifact keys | Root replay consequence | E-REPLAY | T-REPLAY | enforced |
| C20 | Live claim mutations have one guarded repository | Simplification target | E-COMMAND, E-EXEC, E-LIFECYCLE, E-REPLAY | T-INTEGRATION; T-LIFECYCLE; T-REPLAY | gap: mutations are currently distributed |
| C21 | Consent revocation during generation cancels advancement and releases the unconsumed claim; after acceptance it leaves the Pattern readable | Derived lifecycle rule | E-EXEC, E-LIFECYCLE | T-PROTOCOL; T-INTEGRATION | enforced |
| C22 | An accepted Pattern is immutable for its fingerprint; model, prompt, policy, locale, feedback, context, consent, and repeated-request changes do not reroll it | Derived no-reroll rule | E-CLAIM, reader and enqueue projections | T-INTEGRATION; T-LIFECYCLE | enforced |
| C23 | Ordinary ontology supersession affects later reservations but neither rewrites accepted content nor reopens its claim | Derived lifecycle rule | E-EXEC, E-ONTOLOGY, E-CLAIM | T-PROTOCOL; T-INTEGRATION | enforced |
| C24 | Lifecycle erasure destroys wrapped keys before asynchronous physical cleanup can finish | Root erasure mechanism | E-LIFECYCLE, artifact inventory | T-LIFECYCLE; T-INTEGRATION; T-REPLAY | enforced |
| C25 | Returning to a previously consumed fingerprint remains ineligible even when its document was deleted, superseded, or withdrawn | Derived no-reroll rule | E-CLAIM, enqueue and reader projections | T-INTEGRATION; T-LIFECYCLE | enforced |

Primary owner after consolidation:
apps/api/src/db/pattern-claim-transitions.ts.

Primary suite after consolidation:
apps/api/src/db/pattern-claim-transitions.test.ts.

### Complete claim-transition characterization

The matrix covers every update between the six persisted claim states.

- `same` is an intended idempotent convergence update;
- `legal` is an intended live state change; and
- `unguarded` is illegal in the intended graph but is currently accepted by
  D-0007 whenever the caller supplies a structurally coherent resulting row.

| Old state ↓ / new state → | available | reserved | accepted | deleted | superseded | withdrawn |
|---|---|---|---|---|---|---|
| available | same | legal | unguarded | unguarded | unguarded | unguarded |
| reserved | legal | same | legal | unguarded | unguarded | unguarded |
| accepted | unguarded | unguarded | same | legal | legal | legal |
| deleted | unguarded | unguarded | unguarded | same | unguarded | unguarded |
| superseded | unguarded | unguarded | unguarded | unguarded | same | unguarded |
| withdrawn | unguarded | unguarded | unguarded | unguarded | unguarded | same |

For inserts, the live path permits only absent → reserved. Replay
reconstruction may insert an absent accepted, deleted, superseded, or withdrawn
tombstone from a verified signed event. No path creates an absent → available
claim.

D-0007 currently checks only resulting-row coherence: available and reserved
must have null consumed_at; consumed states must have non-null consumed_at; and
only reserved may carry active_generation_id. Given matching field values, it
does not distinguish any old state in the matrix from any other.

Field-level monotonicity is likewise characterized separately from status:

| Field | Intended rule | Current D-0007 behavior |
|---|---|---|
| consumed_at | null → non-null only on reserved → accepted; then immutable | Requires null or non-null according to the new status, but permits clearing, replacing, or setting it on another transition |
| accepted_at | Set on acceptance and never cleared | No old/new or status-specific check |
| deleted_at | Set on accepted → deleted and never cleared | No old/new or status-specific check |
| superseded_at | Set on accepted → superseded and never cleared | No old/new or status-specific check |
| withdrawn_at | Set on accepted → withdrawn and never cleared | No old/new or status-specific check |
| active_generation_id | Non-null only while reserved and cleared on exit | Resulting-row coherence is enforced; transition provenance is not |

Current live callers exercise this subset:

| Transition | Current live caller | Current D1 result |
|---|---|---|
| absent → reserved | pattern-enqueue.ts | admitted when row checks and uniqueness pass |
| available → reserved | pattern-enqueue.ts | admitted |
| reserved → available | executor failure/cancel, consent revoke, chart correction, ontology recall, exhausted sweep | admitted |
| reserved → accepted | publication batch | admitted |
| accepted → deleted | explicit deletion | admitted |
| accepted → superseded | chart correction | admitted |
| accepted → withdrawn | ontology recall | admitted |
| state → same state | replay and convergence paths | admitted when the resulting row is coherent |

Migration 0013 will make the intended old-state/new-state graph executable.
The replay restorer remains the documented exception to live-repository
ownership, not to monotonicity. It may insert an absent terminal tombstone; an
existing claim must converge through trigger-legal forward steps in signed
event order.

## Current provider boundary snapshot

### Explicit forbidden whole keys

The TypeScript runtime currently rejects these explicit keys:

    user_id
    chart_id
    chart_fingerprint
    chart_fingerprint_hash
    fingerprint
    birth_date
    birth_time
    birthplace
    consent_id
    check_in
    check_ins
    journal
    life_event
    life_events
    reading
    readings
    daily_reading
    latitude
    aliasMap
    alias_map

The Python M7 contract policy currently carries the same list except:

- chart_fingerprint_hash is missing; and
- aliasMap and alias_map are omitted because the frozen fact-packet schema has
  no alias-map field.

Both implementations currently compare whole keys. The comment in
pattern-packet.ts claiming that Python relies on accidental substring matching
is stale.

Longitude is not a general allowed key. Both implementations exempt it only at
the calculated feature fact path. The runtime accounts for the planner,
writer, and verifier wrapper depth; the contract validator checks the bare
fact-packet path.

The runtime also rejects every key not in its closed ALLOWED_KEYS set. This is
why generation_id, claim_id, pattern_id, and other internal names are rejected
even when they do not appear in the explicit deny set.

### Forbidden opaque identifier rules

apps/api/src/services/private-opaque-identifiers.ts currently supplies 45
runtime rules:

    acc_:substring, asp_:substring, asm_:substring, aud_:substring,
    cht_:substring, clm_:substring, cns_:substring, cs_:substring,
    csr_:substring, ctx_:substring, cyc_:substring, cyp_:substring,
    del_:substring, dsf_:substring, evt_:substring, exp_:substring,
    pgen_:substring, gen_:substring, gin_sha256_:substring, idn_:substring,
    job_:substring, nat_:substring, nfs_:substring, nft_:substring,
    opart_:substring, oprun_:substring, paae_:substring, par_:substring,
    part_:hex32, pat_:substring, pgc_:substring, poer_:substring,
    pre_:hex32, prel_:substring, rdg_:substring, req_:substring,
    rfb_:substring, rsc_:substring, ses_:substring, sgn_:substring,
    sig_:substring, trc_:substring, tts_:substring, tzc_:substring,
    usr_:substring

The hex32 modes avoid rejecting public vocabulary such as part_of_fortune and
pre_1970_zone_boundary. Pull request 4 must preserve those match modes when the
policy moves to shared JSON.

The Python M7 fact-packet policy does not currently scan string values for this
closed runtime list. Pull request 4 makes the deny policy shared without
replacing TypeScript's explicit packet construction or closed allowed-key
walk.

## Policies, mechanisms, and gates

These statements remain mandatory but are not additional root invariants.

| Statement | Classification | Root |
|---|---|---:|
| Two planner calls per job | Versioned budget policy | 3 |
| Three writer calls per job | Versioned budget policy | 3 |
| Two verifier calls per candidate | Versioned budget policy | 3 |
| Eleven worst-case calls | Derived budget calculation | 3 |
| 30, 120, and 600-second pass retry delays | Retry policy | 3 |
| 60-second publication retry | Retry policy | 3 |
| Stage lease and maximum stage-claim values | Durable execution policy | 3 |
| Queue nudge and sweep behavior | Durable execution mechanism | 3 |
| Word, chapter, section, signature, title, and byte limits | Output policy | 1 |
| Strict provider-schema keyword support | Provider compatibility gate | 1 |
| Model, reasoning, prompt, schema, and output-token values | Frozen configuration | 2 |
| Artifact and failed-job retention days | Retention policy | 5 |
| PATTERN_AI_ROLLOUT values | Deployment admission | 1 |
| Internal-account allowlist | Deployment admission | 1 |
| Worker-key or gateway-stored credential mode | Deployment configuration | 1 |
| Gateway logging, retry, and cache posture | Deployment/provider configuration | 1 |
| Reader-facing provider and model-family fields | Evidence projection | 4 |
| Synthetic publisher restricted to development | Secure configuration gate | 1 |
| Migration-before-deploy ordering | Deployment gate | 5 |
| Ontology evaluation, regression, signing, and activation evidence | Deployment/authority gate | 1 |

## Known concentration and enforcement gaps

These are the reasons for the four pull requests. They are not silently fixed
in this inventory:

1. pattern-execute.ts contains the stage protocol, attempt arithmetic,
   artifact coordination, publication, and orchestration in one file.
2. Pattern claim updates are expressed directly by enqueue, executor,
   lifecycle, sweep, and replay paths.
3. D-0007 validates only the resulting claim row; it does not constrain old
   status to new status.
4. publishPattern receives wide, separately derived inputs rather than the
   approved narrow proof.
5. TypeScript and Python duplicate the explicit forbidden-key policy and
   already disagree on chart_fingerprint_hash.
6. pattern-command.ts stores a broad snapshot but isPatternCommand directly
   validates only the command version and attempt ceilings.
7. Several final mutable publication checks occur at delivery eligibility
   rather than being represented by one publication-proof owner.
8. Human-free execution and rollout separation are enforced by architecture
   and operations rather than a single boolean predicate.

Only items 1 through 5 are direct consolidation targets in the approved
implementation sequence. Items 6 through 8 stay visible so later work does not
mistake missing centralization for a deleted guarantee.

## Pull request 1 characterization decision

No new test is required in this documentation-only pull request:

- T-PROTOCOL already covers artifact-first adoption, pass counter semantics,
  frozen author provenance, publication retry, terminal behavior, and the exact
  11-call path;
- T-PACKET directly covers field-by-field minimization, the runtime post-walk,
  forbidden keys and opaque IDs, and the calculated-longitude exception;
- T-LIFECYCLE and T-INTEGRATION cover deletion, correction, recall,
  reservation races, release, and no-reroll projections; and
- T-REPLAY directly covers forward-only claim convergence, erasure, account
  deletion, and replica reapplication.

The absent D1 transition graph and narrow publication proof are new enforcement
units planned for pull request 3, not current behaviors that can be
characterized without first introducing those units.

Baseline targeted command:

    npm exec -w @patternlike/api -- vitest run \
      src/services/pattern-command.test.ts \
      src/services/pattern-packet.test.ts \
      src/services/pattern-execute-protocol.test.ts \
      src/services/pattern-lifecycle.test.ts \
      src/services/pattern-replay-ledger.test.ts \
      src/routes/pattern-ai.integration.test.ts

Baseline result on 2026-08-23:

- 6 test files passed;
- 169 tests passed; and
- no live provider call was made.

## Freeze confirmation for this work

Pull request 1 changes documentation only. It does not change:

- any M7 wire contract or fixture;
- migrations 0001 through 0012;
- an encrypted command or artifact shape;
- a model, reasoning, prompt, schema, timeout, token, byte, call, or retention
  pin;
- a retry or counter rule;
- a claim or erasure behavior;
- either committed PATTERN_AI_ROLLOUT value;
- an ontology pointer or activation rule; or
- a production database, secret, queue, provider, or deployment.
