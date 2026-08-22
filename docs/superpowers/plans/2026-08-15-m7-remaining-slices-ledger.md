# M7 Remaining Slices — Artifact and Status Ledger

**Date:** 2026-08-15

**Last reconciled with repository HEAD:** 2026-08-20

**Purpose:** One record of what M7 work remains, which slices have approved
design and plan artifacts, and which do not. This is a ledger, not a design and
not a plan. It is the index the other documents hang off.

Companion documents:

- `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md` — the M7
  design. Authoritative. §31 is its work decomposition, §32 its acceptance
  criteria.
- `docs/superpowers/archive/plans/2026-08-15-m7-remaining-slices-handoff.md` — the
  scoping brief for slices A–D. It records settled decisions and constraints,
  and it is **not** itself a design or a plan for any slice.
- `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.6.md` —
  normative product contract for Your Pattern; outranks both design documents.
- `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md` —
  settled freeze-versus-design decisions. Cite it where the 2026-08-14 text
  used to disagree with `contracts/m7`.

## Where M7 stands

Six of the ten §31 workstreams are complete: contracts and shared types (31.1),
migration/deletion/export/crypto registration (31.2), consent and claim
reservation (31.3), ontology ingestion and runtime reader (31.4), deterministic
selection and planning (31.5), and web experience (31.7). The first half of the
31.6 adapter plan — Tasks 1 through 5a — is also complete. The live executor
rewire, attempt/idempotency protocol, migrations `0009` and `0010`, integration
gate, and rollout evidence remain Tasks 6 through 10.

Correction, cleanup, recall and reconciliation (31.8) has the `0008` schema and
frozen replay contract, but no runtime writer, restore replayer, or completed
restore drill. A migration file is not a working replay system.

`PATTERN_AI_ROLLOUT` is `off` in both committed Wrangler blocks. This ledger no
longer treats a historical production observation as current: the deployed
Worker version, migration list, secrets, content releases, and active ontology
pointer must be re-queried and recorded at rollout Gates 2–5.

## Slice ledger

| # | Slice | §31 | Design | Plan | State |
| --- | --- | --- | --- | --- | --- |
| 1 | OpenAI Pattern adapter — the model calls | 31.6 | ✅ `specs/2026-08-15-openai-pattern-adapter-design.md` | ✅ `plans/2026-08-15-openai-pattern-adapter.md` | Tasks 1–6 complete; Tasks 7–10 open |
| A | Activated internal-only ontology | 31.4 (content) | ✅ approved `specs/2026-08-15-internal-ontology-activation-design.md` | ✅ `plans/2026-08-20-internal-ontology-activation.md` | Ready to implement; optional internal canary only |
| B | Automated ontology pipeline | 31.10 | ✅ approved `specs/2026-08-15-ontology-pipeline-design.md` | ✅ `plans/2026-08-20-automated-ontology-pipeline.md` | Ready to implement after slice 1; required for external readers |
| C | Administrator authorization boundary | 31.9, §24 | ✅ `specs/2026-08-16-admin-authorization-design.md` | ❌ none | Design drafted; blocked on Access vs OIDC |
| D | Evidence gates + §29.11 replay ledger | 31.8 (residual) | ✅ `specs/2026-08-16-m7-evidence-gates-design.md` + `specs/2026-08-16-pattern-replay-ledger-design.md` | consolidated in `docs/deploy/openai-pattern-rollout.md`; runtime plan still absent | `0008` and contracts exist; runtime/replay drill remain open |

`docs/deploy/openai-pattern-rollout.md` is now the operational source of truth.
It separates the shortest internal path from the public path, carries the
ordered gates and stop conditions, and links each engineering gate to its plan.
Its evidence cells are intentionally empty until the corresponding action is
actually executed.

## Slice 1 — OpenAI Pattern adapter

Tasks 1–5a are implemented. The tree contains the shared Responses boundary,
three minimizing packet builders, prompt policies and derived strict schemas,
the closed correction document, the OpenAI Pattern publisher, the publisher
interface/factories, and the explicit `worker | gateway_stored` credential
model. Commits and completed checkboxes are recorded in the adapter plan. The
focused adapter/credential lane passed 222 tests across seven files on
2026-08-20.

Task 6 landed on 2026-08-20. `pattern-execute.ts` now constructs a publisher
from the factory instead of fail-closing on a non-synthetic pin, so an `openai`
pin reaches the adapter and makes a real provider call. With it came
attempt-scoped artifact identity (`patternArtifactId`, `getArtifactAt`), the
artifact-first probe, a `putArtifact` that compares the full reserved identity
and throws instead of returning silently, hashes taken from the committed bytes,
`retryStage`, and budget consumed inside the publisher immediately before the
fetch rather than at stage entry. Two configuration refusals the design requires
moved into `resolvePatternPublisherConfiguration` — the gateway route and the
credential mode are now carried on `PatternPublisherConfig` — which also makes
`OPENAI_CREDENTIAL_SOURCE=gateway_stored` reachable for Pattern for the first
time.

Unbuilt: Task 7's executed-pin provenance; Task 8's attempt/claim constants and
`0009`; Task 8a's per-stage usage counters and `0010`; Task 8b's attempt ceilings
and writer↔verifier return; Task 9's queue-level failure/idempotency suite; and
Task 10's full candidate gate and recorded rollout evidence. `MAX_STAGE_CLAIMS`
is still `8`, the deterministic rejections are still terminal rather than
`retryStage` returns, and nothing increments the per-pass counters except
`retryStage`, so the pinned attempt budgets remain unenforced end to end.

Partial: provenance. `projectPublicPattern` already reads `provider` and
`model_family` from the document; Task 7 owns the remaining execute-side
literals.

**Decision status (2026-08-19).** Q1–Q6 and the human-free generation invariant
are approved. Task 5a's live reading-path credential change is separately
approved. No adapter design or implementation-plan sign-off remains open;
deployment and rollout controls remain independent.

**Resolved documentation conflicts.** The approved M7 amendment and the
2026-08-19 decision fix worst-case provider spend at **11**, not 7 or 14, and
derive `MAX_STAGE_CLAIMS = 16` from 12 healthy claims plus four bounded recovery
claims. Q1 and Q6 are closed in the adapter design rather than carried as open
questions. Individual Pattern generation is fully machine-run; design-time
sign-off and operational inspection are not runtime approval gates.

**Remaining plan ownership.** Tasks 6–10 own every adapter-runtime requirement,
including `projection.ts` behavior through executed-pin provenance, the
configuration refusals, migration smoke coverage, and the manifest amendment.
The 2026-08-19 credential decision supersedes any pre-amendment sentence that
assumes every request carries provider `Authorization`.

## Slice A — Activated internal-only ontology

**The binding constraint.** There is no ontology. Ingestion, compilation,
signature verification, activation, recall and the runtime reader are all built;
the only ontology material in the repository is contract fixtures, which are
schema examples rather than content. Without an activated release, generation
cancels with `cancel_ontology` before reaching a provider — so the adapter can be
finished and no Pattern will be produced.

**Settled, and not to be re-opened:** Slice A is an **internal-only signed
synthetic ontology release**, valid at `PATTERN_AI_ROLLOUT=internal` and below.
Slice B remains the gate for every external reader. The evidence is in the
handoff: §23.1/§23.2 put curated source fragments behind an out-of-scope curation
process that hand-authoring can only assert; §23.7's independent evaluator and
§23.8's fixed-chart corpus are Slice B and do not exist; and
`compileOntologyRelease` refuses any release whose `evaluation.verdict` is not
`pass` with `unevaluated_fixture_count` of `0`, so a hand-authored production
release would have to attest that runs which never happened returned clean.
Acceptance criterion 19 cannot be evidenced by any hand-authored release.

The additive contract marker already exists: ontology releases can carry signed
`provenance.origin`, and evaluation reports can carry the two report hashes.
What remains is to add the shared TypeScript field, enforce provenance at
reservation, add the closed log event and tests, build the authored synthetic
corpus/release toolchain, sign, ingest, and certify it. Rollout mode alone is not
containment — the release outlives the mode, and `consumerAdmissionEntry` admits
`chart_correction` without consulting the staff allowlist.

Slice A is not a per-Pattern human approval path. Human authoring/review happens
once, outside runtime, when preparing an internal-only ontology release. Every
individual Pattern remains fully machine-run. Slice A may be skipped entirely
if the team implements Slice B first.

## Slice B — Automated ontology pipeline (§31.10)

Not built. Its design is approved and its open questions are resolved. Six
components, all six required by acceptance criterion 19:
source-corpus contract reader, generator prompt and provider adapter,
deterministic ontology compiler driver, independent evaluator, fixed-chart
regression runner, and machine signing plus internal ingestion client.

**This is the production gate.** No external reader's Pattern may be generated
against an ontology that has not been through this pipeline, so Slice B is the
only route to `first_open` or `enabled` — not an optimization of Slice A. Size it
as a second LLM integration with its own provider tuple, rollout switch and
budget ledger; `0007` already created `pattern_ontology_provider_daily_usage`
for it, and its five contracts are frozen.

## Spec-artifact amendments (2026-08-16)

The unimplemented-spec-artifacts review inserted spec work in front of A–D.
That work has landed: product-spec v0.6, in-place 2026-08-14 amendments,
additive `contracts/m7` documents, and `0008` as the replay-ledger schema.
Slice A and B designs are now approved and have implementation plans. `0009`
remains reserved for the correction-artifact CHECK rebuild, and `0010` for
per-stage-class usage; later Slice B schema must use the next available number.

## Slice C — Administrator authorization boundary (§31.9, §24)

Partially built. `routes/admin-pattern.ts` implements read-only inspection,
records a `purpose_class`, and writes an audit row. Missing is the boundary:
§24.1's dedicated `pattern_generation_auditor` role and §24.2's administrator
OIDC, short-lived server-side sessions, explicit role and audience checks,
`HttpOnly`/`Secure`/`SameSite=Strict` cookies, no bearer token in browser
JavaScript, and no cross-origin access from the consumer app. What exists is a
single shared static `PATTERN_ADMIN_TOKEN` compared in-route, which is not the
role separation acceptance criterion 18 requires.

Adding the identity flow is not sufficient — the token must be removed, the
deployed secret revoked, and rejection coverage added, or a shared-secret path
survives as the one nobody watches.

**Blocking question to ask the operator before scoping:** §24.1 sanctions either
a separate administrator identity provider **or a Cloudflare Access policy**.
Access was declined *for the AI Gateway*; that is a different application and
does not decide this one. If Access is off the table account-wide, this slice
must go the administrator-OIDC route and is materially larger. Ask early.

Routing is fine as-is: §24.2 permits "a separate protected hostname **or path**",
`/admin/*` is already in `run_worker_first`, and the gap is authentication only.

## Slice D — Evidence gates that are runs, not commits

- **Criterion 23** — a disaster-recovery restore drill proving pre-deletion
  snapshots cannot resurrect Pattern content or reset a consumed claim. The
  `0008` table and frozen event contract exist; the R2-first runtime writer,
  restore replayer, and drill evidence do not. A drill against schema alone
  proves nothing.
- **Criterion 20** — all hard evaluation and privacy gates pass with zero
  exceptions.
- **Criterion 22** — production migration, deploy, ontology activation, rollout
  and real-account certification, each separately reported.

Scope as a runbook with recorded evidence and an empty ledger table, in the style
of `docs/deploy/openai-daily-reading-rollout.md`.

## Ordering

    Slice 1 Tasks 6–9 ─┬─> Slice A ──> first end-to-end Pattern (internal only)
                       └─> Slice B ──> first_open or enabled
    Slice C ──> independent; ask the Access question now, it changes the size
    Slice D ──> after B, since criterion 22 certifies a real rollout

Slice A and the remaining adapter work may proceed in parallel, but both must be
complete before the internal canary. Slice B is the only path to public rollout.

## Constraints binding every slice

- `contracts/m0`–`m6` stay byte-identical. `contracts/m7` keeps its
  `schema_version`, every `$id`, every enum and every required field; additive
  changes are recorded in the manifest's `amendments` array.
- `packages/pattern-engine` keeps its purity contract. Nothing new lands in
  `packages/shared`, which the AGPL calc service imports.
- No new encrypted column without adding it to `ENCRYPTED_COLUMNS` in
  `apps/api/src/db/users.ts`, or DEK rotation destroys its data.
- `0007` is applied to production, so further schema work is forward-only.
- Prompt, packet, plan, draft and prose logging is forbidden.
- Scoping and planning advance no rollout and configure no secret.
