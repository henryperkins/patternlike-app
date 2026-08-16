# M7 Remaining Slices — Artifact and Status Ledger

**Date:** 2026-08-15

**Purpose:** One record of what M7 work remains, which slices have approved
design and plan artifacts, and which do not. This is a ledger, not a design and
not a plan. It is the index the other documents hang off.

Companion documents:

- `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md` — the M7
  design. Authoritative. §31 is its work decomposition, §32 its acceptance
  criteria.
- `docs/superpowers/plans/2026-08-15-m7-remaining-slices-handoff.md` — the
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
selection and planning (31.5), and web experience (31.7). Correction, cleanup,
recall and reconciliation (31.8) is built **except** the §29.11 disaster-recovery
replay ledger, which is not in the tree.

`PATTERN_AI_ROLLOUT` is `off` in both wrangler blocks. Production has no content
release and no ontology release.

## Slice ledger

| # | Slice | §31 | Design | Plan | State |
| --- | --- | --- | --- | --- | --- |
| 1 | OpenAI Pattern adapter — the model calls | 31.6 | ✅ `specs/2026-08-15-openai-pattern-adapter-design.md` | ✅ `plans/2026-08-15-openai-pattern-adapter.md` | Specified, **0% implemented**, 3 sign-offs open |
| A | Activated internal-only ontology | 31.4 (content) | ✅ `specs/2026-08-15-internal-ontology-activation-design.md` | ❌ none | Design drafted, awaiting approval |
| B | Automated ontology pipeline | 31.10 | ✅ `specs/2026-08-15-ontology-pipeline-design.md` | ❌ none | Design drafted, awaiting approval; **depends on slice 1** |
| C | Administrator authorization boundary | 31.9, §24 | ✅ `specs/2026-08-16-admin-authorization-design.md` | ❌ none | Design drafted; blocked on Access vs OIDC |
| D | Evidence gates + §29.11 replay ledger | 31.8 (residual) | ✅ `specs/2026-08-16-m7-evidence-gates-design.md` + `specs/2026-08-16-pattern-replay-ledger-design.md` | ❌ none | Ledger specified (`0008`); drill not runnable until that runtime exists |

Also missing: `docs/deploy/openai-pattern-rollout.md`. `docs/deploy/` holds only
`api-production.md` and `openai-daily-reading-rollout.md`. The Pattern rollout
runbook is a deliverable of slice 1 (its Task 10) and carries the ten ordered
rollout gates, the spend approval, and the AI Gateway dashboard checklist.

## Slice 1 — OpenAI Pattern adapter

The only slice with both artifacts. Every deliverable in its design is unbuilt;
everything the design describes as *already existing* is real and verified.

Unbuilt: `openai-responses-adapter.ts`, `pattern-prompt.ts`,
`openai-pattern-publisher.ts`, `pattern-packet.ts`; the `PatternPublisher`
interface and both factories; the four `pattern-execute.ts` edit points (the
fail-closed guard is still at `:637` and the three stand-ins are still called at
`:648`, `:685`, `:717`); the retry primitives `retryStage` and `returnToWriter`;
attempt-ceiling enforcement; the budget move to immediately-before-fetch (three
consumes remain at stage entry, `:643`, `:670`, `:701`); the whole idempotency
protocol (`putArtifact`'s digest is still three-component at `:255` and `head()`
still returns silently at `:269-272`); five configuration refusals; two safe-log
arms; `MAX_STAGE_CLAIMS` still `8`; and every new test.

Partial: provenance. `projectPublicPattern` already reads `provider` and
`model_family` from the document (`packages/pattern-engine/src/projection.ts:46-47`);
only the execute-side literals at `pattern-execute.ts:772-774` remain.

**Open sign-offs.** Q1 (writer attempt ceiling) blocks its Task 8, Q6 (per-stage-class
usage ledger) blocks its Task 8a, and Task 5a needs a go-ahead because it modifies
live reading-path code.

**Known defects in its design, to fix before implementation.** The design's
worst-case provider spend is stated as 14 in the rollout gate and as 11 in an
inline amendment; the M7 design's own attempt/retry vocabulary (§12.4 and §13.5
say "attempts", §14.5 says "retries … at most twice") supports **14**, and
`MAX_STAGE_CLAIMS = 16` is only defensible on the 11. Open questions 1 and 6 are
answered by §13.5 and §25.3 respectively and should be closed rather than carried.
The design predates the BYOK decision: it still says "No new environment variable
is required" and pins `Authorization` on every request, both of which the plan's
Task 5a contradicts. Four design requirements have no plan owner —
`projection.ts`, configuration refusals 3–5, `test/helpers.ts`, and the
`SCHEMA_MANIFEST.json` amendments entry.

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

**The engineering it requires** is containment, which does not exist today:
`pattern_ontology_releases` has no provenance column, and
`pattern-ontology-release.schema.json` is `additionalProperties: false`, so
nothing distinguishes a synthetic release from a Slice B one once stored. Rollout
mode is not the containment either — the release outlives the mode, and
`consumerAdmissionEntry` admits `chart_correction` at `internal` without
consulting the staff allowlist (`pattern-rollout.ts:86`).

## Slice B — Automated ontology pipeline (§31.10)

Not built. Six components, all six required by acceptance criterion 19:
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

The unimplemented-spec-artifacts review inserted spec work in front of
A–D. That work has landed: product-spec v0.6, in-place 2026-08-14
amendments, additive `contracts/m7` documents, and `0008` as the replay
ledger. Slice A and B designs remain drafts; they now cite the amendment
rather than the pre-amendment lists. `0008` is taken; the adapter’s
per-stage-class usage ledger is `0009` or later.

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
  §29.11 replay ledger this depends on **does not exist**; a drill against absent
  runtime support would prove nothing. Treat the ledger as a blocking dependency
  with its own acceptance criteria and a forward-only migration, and scope it
  before the drill.
- **Criterion 20** — all hard evaluation and privacy gates pass with zero
  exceptions.
- **Criterion 22** — production migration, deploy, ontology activation, rollout
  and real-account certification, each separately reported.

Scope as a runbook with recorded evidence and an empty ledger table, in the style
of `docs/deploy/openai-daily-reading-rollout.md`.

## Ordering

    Slice A ──> Slice 1 can produce an end-to-end Pattern (internal accounts only)
    Slice C ──> independent; ask the Access question now, it changes the size
    Slice B ──> the only route to first_open or enabled
    Slice D ──> after B, since criterion 22 certifies a real rollout

Slice A first: it is the smallest, it is the binding constraint, and it is what
makes an end-to-end Pattern possible at all. None of the time it saves comes off
Slice B.

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
