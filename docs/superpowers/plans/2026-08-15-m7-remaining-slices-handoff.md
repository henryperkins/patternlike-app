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
4. `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.6.md` — the
   normative product contract for Your Pattern, which **outranks both design
   documents** where they disagree. v0.5 remains the daily-reading contract.
   `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md` records
   the freeze-versus-design decisions.

## Where M7 actually stands

Verified by inspection of the tree on 2026-08-15. **Six of the ten §31
workstreams are complete**, and a seventh is complete except on one item:
contracts and shared types (31.1), migration, deletion, export and crypto
registration (31.2), consent and claim reservation (31.3), ontology ingestion
and runtime reader (31.4), deterministic selection and planning (31.5), and web
experience (31.7) are done. Correction, cleanup, recall and reconciliation
(31.8) is substantially built but **remains open** on the disaster-recovery
replay ledger — see below, and do not read it as finished.

Concretely: `contracts/m7` validates with 23 schemas, `0007` is applied to
production, `packages/pattern-engine` is complete, all three public stages plus
consent/ready/failed/withdrawn render in `PatternExperience.tsx`, ontology recall
works, and `/admin/*` is present in `run_worker_first`.

Two corrections to that summary, because both would mislead a scoping pass.
**Deletion coverage is not blanket.** It holds for *user-owned* tables —
`pattern_documents`, claims, jobs, artifacts, consents. The control-plane tables
sit outside it by design: `pattern_ontology_*` and both usage ledgers
(`pattern_provider_daily_usage`, `pattern_ontology_provider_daily_usage`) are not
user-owned, and `pattern_admin_access_events` is *nullified* rather than deleted.
That is the intended classification, not a gap — but do not restate it as "every
M7 table is covered."

**31.8 is complete except on one item.** Correction, cleanup, recall and
reconciliation are built. The §29.11 disaster-recovery replay ledger that
acceptance criterion 23 depends on is **not** in the tree. Slice D covers the
drill; treat 31.8 as open on that item so it is not skipped.

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
Automated generation remains separate." Local tests already seed one through
`syntheticOntologyRelease`, which confirms the gap is *content* rather than
missing ingestion code.

**This question is settled, and it is settled against the hand-authored
production route. Do not re-open it; scope to the answer.** Slice A is an
**internal-only signed synthetic ontology release**, valid at
`PATTERN_AI_ROLLOUT=internal` and below. Slice B remains the gate for every
external reader. The evidence, in the order that decides it:

- §23.1 makes the ontology the model's *only* authority for astrological
  meaning, and every runtime statement must resolve through source-supported
  meanings to **immutable curated source fragments**. §23.2 puts those fragments
  behind an out-of-scope curation process that resolves license and usage
  metadata, and refuses "a corpus release lacking explicit machine-readable
  authorization." Hand-authoring cannot manufacture that chain; it can only
  assert it.
- §23.9 signs only a candidate "that passes compilation, semantic evaluation,
  and fixed-chart regression," and the ingestion route verifies evaluation
  report hashes and a regression report hash. The §23.7 independent evaluator
  and the §23.8 fixed-chart corpus **are Slice B** and do not exist.
- The contract makes the dishonesty concrete rather than theoretical.
  `pattern-ontology-release.schema.json` requires an `evaluation` object, and
  `pattern-ontology-evaluation.schema.json` requires `compiler_passed`,
  `evaluator_passed`, and `regression_passed`. `compileOntologyRelease` refuses
  any release whose `evaluation.verdict` is not `pass` and whose
  `unevaluated_fixture_count` is not `0`
  (`packages/pattern-engine/src/ontology.ts:220-225`). A hand-authored release
  offered to production must therefore ship a signed, immutable bundle
  attesting that an evaluator and a regression corpus which do not exist
  returned clean — the fixture already does exactly this
  (`packages/pattern-engine/src/fixtures.ts:91-97`), which is correct for a
  fixture and disqualifying for a reader-serving release.
- Acceptance criterion 19 is written against "the machine-generated ontology
  pipeline" proving source dependency, deterministic compilation, independent
  evaluation, regression, signing, and activation. No hand-authored release can
  evidence it, so a production Slice A would leave criterion 19 permanently
  unmet while readers were being served.

**Scope Slice A to this, then.** The smallest hand-authored record set that can
be compiled, signed, activated, and drive a Pattern end to end for a designated
internal account. Authoring is editorial work with a review gate, not a code
task; the scoping questions are the minimum viable record set, who authors it,
how it is reviewed, and how it is signed and ingested.

**The one piece of engineering Slice A must add is the containment, and it is
not free.** "Internal-only" has no representation today: `pattern_ontology_releases`
has no provenance column, and `pattern-ontology-release.schema.json` is
`additionalProperties: false` over a fixed required set, so nothing distinguishes
a synthetic release from a Slice B one once it is in the table. Rollout mode alone
is not the containment either — the release outlives the mode, and
`consumerAdmissionEntry` admits `chart_correction` at `internal` without
consulting the staff allowlist (`pattern-rollout.ts:86`). Scope:

- a release-level provenance marker — a forward-only column on
  `pattern_ontology_releases` is cheapest and stays out of the contract; an
  optional property on the release schema is permissible as a manifest
  `amendments` entry if the marker must travel with the signed bytes, and that
  choice should be made deliberately rather than by whichever is edited first;
- honest evaluation booleans on the synthetic release —
  `evaluator_passed: false`, `regression_passed: false` — which the compiler
  already tolerates, so the bundle stops attesting to runs that never happened;
- a refusal at reservation, where §23.11 freezes the active ontology into the
  command, when the frozen release is internal-only and the account is not on
  `PATTERN_INTERNAL_ACCOUNT_IDS`; and
- the rejection test that proves it: an internal-only release active while
  rollout is `first_open` must refuse to reserve for an external account rather
  than generate against it.

Read §23 (Interpretation ontology) in full before scoping this.

### Slice B — The automated ontology pipeline (§31.10)

Not built. Six components: source-corpus contract reader, generator prompt and
provider adapter, deterministic ontology compiler driver, independent evaluator,
fixed-chart regression runner, and machine signing plus internal ingestion
client. Acceptance criterion 19 requires all six to be evidenced.

**Slice A's answer makes this the production gate.** No external reader's Pattern
may be generated against an ontology that has not been through this pipeline, so
Slice B is not an optimization of Slice A's manual route — it is the only route
to `first_open` or `enabled`. Size the slices with that ordering in mind: Slice A
unblocks internal end-to-end work quickly, and none of the time it saves comes
off Slice B.

Everything around it is ready: the contracts are frozen
(`pattern-source-corpus-release`, `pattern-source-fragment`,
`pattern-ontology-evaluation`, `pattern-ontology-record`,
`pattern-ontology-release`), and `0007` already created
`pattern_ontology_provider_daily_usage` for its budget.

Size this honestly. It is a **second LLM integration** with its own provider
tuple, its own rollout switch and its own budget ledger — comparable in scope to
the adapter plan, which excluded it deliberately. Use the adapter plan's
corrected AI Gateway section as a reviewed baseline, not as a block to copy
unchanged. If this pipeline also uses provider-native BYOK, a request provider
key would take precedence and bypass the stored key, so stored mode sends no
provider `Authorization` and pins `cf-aig-byok-alias`. A Worker AI binding is
not a BYOK substitute for third-party models. Reuse the forbidden-header and
no-log posture, the closed allowlist of documented Cloudflare error codes, and
the rule that every other routed failure is `unknown` rather than guessed to be
gateway or provider.

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

**Adding the identity flow is not enough — the token must go.** If OIDC or
Access lands while the in-route token is still accepted, the endpoint retains a
shared-secret path and criterion 18 is still unmet, with the added hazard that
the surviving path is the one nobody is watching. Scope the removal explicitly:
delete the `PATTERN_ADMIN_TOKEN` comparison, fail closed when the identity flow
is unavailable rather than falling back, revoke the deployed secret, and add
rejection coverage proving the old token cannot authorize a request.

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
  cannot resurrect Pattern content or reset a consumed claim. **The §29.11
  replay ledger this depends on does not exist in the tree**, and a drill cannot
  be scheduled against absent runtime support — it would prove nothing. Treat
  the ledger as a blocking dependency of this criterion with its own acceptance
  criteria and a forward-only migration, and scope it before the drill rather
  than discovering the gap during one. §31.8 anticipates exactly this:
  "privacy-erasure replay support for disaster recovery when the repository does
  not already provide it".
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
  therefore *not* send provider `Authorization`: current Cloudflare credential
  precedence gives a request key priority and would silently bypass BYOK.
  `AI_GATEWAY_TOKEN` becomes mandatory rather than optional, and the key alias
  is pinned explicitly. Adapter plan Task 5a covers this and touches the
  already-shipped reading adapter.
- **A Worker AI binding is not an alternative under the selected BYOK
  architecture.** Third-party binding calls use Unified Billing and do not
  support BYOK. Changing to one is a provider, billing, request-envelope and
  privacy redesign rather than a fetch optimization.
- **Gateway/provider failure attribution is deliberately incomplete.** Direct
  responses are `provider`; only the closed documented Cloudflare code
  allowlist is `gateway`; every other routed non-2xx is `unknown`. Status or a
  generic numeric body code is not proof.
- **The cache invariant is `must not be HIT`.** `HIT` is terminal; `MISS` is
  expected on a successful routed preflight; absence on a gateway-generated
  error does not replace that error with a cache misconfiguration.
- **The live reading credential cutover is a versioned operation.** Task 5a
  first deploys `OPENAI_CREDENTIAL_SOURCE=worker` byte-identically. A later
  Worker version must make gateway IDs, stored-key alias and
  `AI_GATEWAY_TOKEN` present while making `OPENAI_API_KEY` absent, without
  serving either invalid intermediate combination.
- **Q1** writer attempts move to 3 with the command type widened to `2 | 3`.
  The two maxima keep **different scopes**: the writer's 3 is per job and spans
  corrections (§13.5); the verifier's 2 is per candidate (§14.5). Worst-case
  spend is `2 planner + 3 writer + (3 candidates × 2 verifier)` = **11** provider
  calls per Pattern, which amends the M7 design's 14. A per-job verifier total
  yielding **7** appeared in a draft and is wrong: it caps the job at two
  candidates, so the writer's third attempt can never be verified. Do not quote
  7 or 14 into any budget approval.
- **Q2** the verifier receives the full frozen plan per §14.1, and
  `resolvePatternPublisherConfiguration` must refuse equal writer/verifier prompt
  versions per §14.2.
- **Q3** no `schema_version` bump for `assembly_mode`; the guard at
  `pattern-publisher.ts:152` makes the exposure structurally zero.
- **Q4** the verifier finding vocabulary stays in code until a live corpus
  stabilises it.
- **Q5** `MAX_STAGE_CLAIMS` rises 8 → 16, but only after the budget move, and
  with the derivation written into the constant's comment: 11 provider
  deliveries plus the publish delivery is a floor of 12 before any lease-expiry
  or artifact-adopting churn.
- **Q6** `pattern_provider_daily_usage` does not satisfy §25.3's per-stage-class
  recording. `0008` is the replay ledger and `0009` is reserved for the
  correction-artifact CHECK rebuild, so the outcome is a `0010` migration or a
  recorded amendment to §25.3 — **not** a third silent option.

Outstanding sign-offs carried in the adapter plan: Q1 blocks its Task 8, Q6
blocks its Task 8a, and Task 5a needs a go-ahead because it modifies live-path
code.

## Constraints that bind everything you scope

- `contracts/m0` through `contracts/m6` stay byte-identical. `contracts/m7`
  keeps its `schema_version`, every `$id`, every existing enum member, and
  every existing required field; additive properties, definitions, and enum
  members such as `correction_document` are recorded in the manifest's
  `amendments` array.
- `packages/pattern-engine` keeps its purity contract. Nothing new lands in
  `packages/shared`, which the AGPL calc service imports.
- No new encrypted column without adding it to `ENCRYPTED_COLUMNS` in
  `apps/api/src/db/users.ts`, or DEK rotation destroys its data.
- `0007` is applied to production, so further schema work is forward-only.
- Prompt, packet, plan, draft and prose logging is forbidden. Safe-log arms carry
  event name, pass, model, prompt version, latency, token counts, failure class
  and hashes.
- For a provider-native BYOK route, `cf-aig-collect-log: false`,
  `cf-aig-max-attempts: 1`, and `cf-aig-skip-cache: true` are exact request
  invariants. Guardrails and DLP are off, no Dynamic Route is attached, and a
  spend-limit rule blocks rather than falls back. `cf-aig-collect-log: false`
  suppresses the whole gateway entry; it does not establish the upstream
  provider's retention posture.
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
external references. For this OpenAI provider-native path, use the generic
Cloudflare credential-precedence and BYOK pages; do not generalize an
integration-specific coding-agent statement that a provider environment
variable is ignored. Re-open the current AI Gateway docs on the implementation
date: the binding, REST, retry, logging and Dynamic Route surfaces changed
materially during 2026, and the adapter plan records which claims are contracts
and which require a live preflight.

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
`npm exec -w @patternlike/api -- vitest run <file>` from the repository root, or
`npx vitest run <file>` from `apps/api`, for a single vitest file.

## Deliverable

A design document per slice under `docs/superpowers/specs/`, and — once a design
is approved — its plan under `docs/superpowers/plans/`. Slice A first: it is the
binding constraint, it is the smallest, and it is what makes an end-to-end
Pattern possible at all — for a designated internal account, which is as far as
it goes. Surface the Slice C Access question early, since the answer changes that
slice's size substantially.

Commit with focused, imperative subjects and an area prefix per `AGENTS.md`.
