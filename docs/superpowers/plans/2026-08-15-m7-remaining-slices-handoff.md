# M7 AI-generated Pattern — Remaining Slices Scoping Handoff

Paste everything below the rule into a fresh session. It is written to be read
by the agent picking the work up, not about them.

---

## Your task

**Scope, do not implement.** Produce design and plan documents for the four
remaining slices of M7 AI-generated Pattern. Writing code is out of scope except
where a short read-only probe is needed to answer a scoping question.

This repository's convention is `docs/superpowers/specs/` (design, approved
first) then `docs/superpowers/plans/` (task-by-task implementation plan derived
from it). Follow it. `docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md`
is the most recent worked example of the plan format — Files / Interfaces /
checkbox Steps / dependency map / sign-off gates.

Read these before anything else:

1. `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md` — the M7
   design. **Authoritative.** §31 is its own work decomposition and §32 its
   acceptance criteria; both are the frame for everything below.
2. `docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md` — the already
   written plan for the provider adapter. **Do not re-plan it.** Read it for the
   locked decisions and constraints it records, which bind your slices too.
3. `CLAUDE.md` and `AGENTS.md`. The `CLAUDE.md` invariants are real and several
   are load-bearing here — especially envelope encryption, `ENCRYPTED_COLUMNS`,
   the D1 migration policy, `run_worker_first`, and the fail-closed config guard.
4. `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` — the
   normative product contract, which **outranks both design documents** where
   they disagree.

## Where M7 actually stands

Verified by inspection of the tree on 2026-08-15. Seven of the ten §31
workstreams are complete: contracts and shared types (31.1), migration,
deletion, export and crypto registration (31.2), consent and claim reservation
(31.3), ontology ingestion and runtime reader (31.4), deterministic selection
and planning (31.5), web experience (31.7), and correction, cleanup, recall and
reconciliation (31.8).

Concretely: `contracts/m7` validates with 23 schemas, `0007` is applied to
production, `packages/pattern-engine` is complete, all three public stages plus
consent/ready/failed/withdrawn render in `PatternExperience.tsx`, every M7 table
appears in the deletion manifest and export, ontology recall works, and
`/admin/*` is present in `run_worker_first`.

**31.6 is planned but unbuilt** — the stage machine exists and fail-closes any
non-synthetic publisher pin at `pattern-execute.ts:637`; only the model calls are
missing, and that is the adapter plan above. Not your slice.

`PATTERN_AI_ROLLOUT` is `off` in both wrangler blocks. Nothing you scope may
change that.

## The four slices to scope

### Slice A — An activated ontology (the binding constraint)

There is no ontology. Ingestion, `compileOntologyRelease`, signature
verification, activation, recall and runtime reading are **all built**; the only
ontology material in the repository is contract fixtures under
`contracts/m7/fixtures/`, which are schema examples, not content.

Without an activated release, generation cancels with `cancel_ontology` before
reaching a provider. The adapter can be finished and no Pattern will be
produced. This slice therefore sits ahead of everything else on the critical
path.

§31.4's deliverable explicitly permits the manual route — "manually supplied
synthetic ontology fixtures can be ingested and frozen by runtime jobs.
Automated generation remains separate." Scope the smallest hand-authored
ontology that can be ingested, signed, activated and actually drive a Pattern
end to end. Treat the authoring itself as editorial work with a review gate, not
as a code task; the scoping question is what the minimum viable record set is,
who authors it, how it is reviewed, and how it is signed and ingested.

Read §23 (Interpretation ontology) in full before scoping this.

### Slice B — The automated ontology pipeline (§31.10)

Not built. Six components: source-corpus contract reader, generator prompt and
provider adapter, deterministic ontology compiler driver, independent evaluator,
fixed-chart regression runner, and machine signing plus internal ingestion
client. Acceptance criterion 19 requires all six to be evidenced.

Everything around it is ready: the contracts are frozen
(`pattern-source-corpus-release`, `pattern-source-fragment`,
`pattern-ontology-evaluation`, `pattern-ontology-record`,
`pattern-ontology-release`), and `0007` already created
`pattern_ontology_provider_daily_usage` for its budget.

Size this honestly. It is a **second LLM integration** with its own provider
tuple, its own rollout switch and its own budget ledger — comparable in scope to
the adapter plan, which excluded it deliberately. The adapter plan's AI Gateway
section applies to it unchanged, including the forbidden headers, the
gateway-versus-provider failure classification, and the stored-key credential
mode.

### Slice C — The administrator authorization boundary (§31.9, §24)

Partially built. `routes/admin-pattern.ts` implements read-only inspection of
generations and artifacts, records a `purpose_class`, and writes an audit row.
What is missing is the boundary itself: §24.1 requires a dedicated
`pattern_generation_auditor` role, and §24.2 requires administrator OIDC,
short-lived server-side administrator sessions, explicit role and audience
checks, `HttpOnly`/`Secure`/`SameSite=Strict` cookies, no bearer token returned
to browser JavaScript, and no cross-origin access from the consumer application.

What exists instead is a single shared static `PATTERN_ADMIN_TOKEN` compared
in-route. Acceptance criterion 18 requires inspection to be "role-separated"; a
shared token is not role separation.

**Open question you must surface rather than assume.** §24.1 names two sanctioned
ways to assign the role: a separate administrator identity provider **or a
Cloudflare Access policy**. The operator has declined Cloudflare Access *for the
AI Gateway*. That is a different application and does not automatically decide
the admin surface, but if Access is off the table account-wide then this slice
must go the administrator-OIDC route, which is materially more work. Get an
explicit answer before scoping the implementation.

Note `/admin` is mounted on the same Worker and is already in
`run_worker_first`; §24.2 permits "a separate protected hostname **or path**", so
the path is acceptable and the gap is authentication, not routing.

### Slice D — Evidence gates that are runs, not commits

- Criterion 23: a disaster-recovery restore drill proving pre-deletion snapshots
  cannot resurrect Pattern content or reset a consumed claim. §31.8 mentions
  "privacy-erasure replay support for disaster recovery when the repository does
  not already provide it" — establish whether any support exists before scoping.
- Criterion 20: all hard evaluation and privacy gates pass with zero exceptions.
- Criterion 22: production migration, deploy, ontology activation, rollout and
  real-account certification, each separately reported.

Scope these as a runbook with recorded evidence and an empty ledger table, in
the style of `docs/deploy/openai-daily-reading-rollout.md`.

## Decisions already made — do not re-litigate

From the adapter plan and from the operator, all recorded with their evidence:

- **No custom domain and no Cloudflare Access on the AI Gateway.** The Worker
  calls the default `gateway.ai.cloudflare.com` endpoint. This makes the shipped
  `responsesUrlFor` and both id validators correct as they stand.
- **The OpenAI provider key is stored in AI Gateway (BYOK).** The Worker must
  therefore *not* send `Authorization`, `AI_GATEWAY_TOKEN` becomes mandatory
  rather than optional, and the key alias is pinned explicitly. Adapter plan
  Task 5a covers this and touches the already-shipped reading adapter.
- **Q1** writer attempts move to 3 with the command type widened to `2 | 3`.
- **Q2** the verifier receives the full frozen plan per §14.1, and
  `resolvePatternPublisherConfiguration` must refuse equal writer/verifier prompt
  versions per §14.2.
- **Q3** no `schema_version` bump for `assembly_mode`; the guard at
  `pattern-publisher.ts:152` makes the exposure structurally zero.
- **Q4** the verifier finding vocabulary stays in code until a live corpus
  stabilises it.
- **Q5** `MAX_STAGE_CLAIMS` rises 8 → 16, but only after the budget move.
- **Q6** `pattern_provider_daily_usage` does not satisfy §25.3's per-stage-class
  recording. Outcome is a `0008` migration or a recorded amendment to §25.3 —
  **not** a third silent option.

Outstanding sign-offs carried in the adapter plan: Q1 blocks its Task 8, Q6
blocks its Task 8a, and Task 5a needs a go-ahead because it modifies live-path
code.

## Constraints that bind everything you scope

- `contracts/m0` through `contracts/m6` stay byte-identical. `contracts/m7` keeps
  its `schema_version`, every `$id`, every enum and every required field;
  additive changes are recorded in the manifest's `amendments` array.
- `packages/pattern-engine` keeps its purity contract. Nothing new lands in
  `packages/shared`, which the AGPL calc service imports.
- No new encrypted column without adding it to `ENCRYPTED_COLUMNS` in
  `apps/api/src/db/users.ts`, or DEK rotation destroys its data.
- `0007` is applied to production, so further schema work is forward-only.
- Prompt, packet, plan, draft and prose logging is forbidden. Safe-log arms carry
  event name, pass, model, prompt version, latency, token counts, failure class
  and hashes.
- Scoping advances no rollout and configures no secret.

## Method note, learned the expensive way in the previous session

The adapter design cites the M7 design by section, and its summaries are not
always the whole of what those sections say. Three separate answers were wrong
until the cited section was actually opened: §14.1 had already settled a question
recorded as open and §14.2 carried an unenforced hard requirement; §13.5
described a correction-document protocol, not a bare retry; §25.3 turned a
supposed open choice into a conformance gap.

**Open the cited section before relying on a characterisation of it**, and prefer
the normative spec bundle over both design documents. The same caution applies to
external references — the Cloudflare AI Gateway documentation contradicts itself
about a URL path, which is recorded in the adapter plan.

## Verification available to you

```bash
npm install
npm run typecheck                    # strict, all six workspaces
npm test                             # shared + calc-stub + api + web + contracts
npm run build                        # includes the production Worker dry run
python3 contracts/validate_schemas.py # needs jsonschema referencing pyyaml openapi-spec-validator
```

Note that `npm test -w @patternlike/api -- <file>` appends the file to the end of
an `&&` chain and hands vitest files to the `tsx --test` runner. Use
`npx vitest run <file>` from `apps/api` for a single vitest file.

## Deliverable

A design document per slice under `docs/superpowers/specs/`, and — once a design
is approved — its plan under `docs/superpowers/plans/`. Slice A first: it is the
binding constraint, it is the smallest, and it is what makes an end-to-end
Pattern possible at all. Surface the Slice C Access question early, since the
answer changes that slice's size substantially.

Commit with focused, imperative subjects and an area prefix per `AGENTS.md`.
