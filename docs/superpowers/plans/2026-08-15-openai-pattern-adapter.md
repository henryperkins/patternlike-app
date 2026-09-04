# OpenAI Pattern Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the three deterministic stand-ins behind M7 Your Pattern with a real OpenAI provider adapter — planner, writer, and semantic verifier — so an eligible consented reader receives a Pattern organized, written, and independently checked by a model inside the evidence envelope the deterministic selector already produces, instead of the `publisher_unavailable` terminal failure that any non-synthetic pin produces today.

**Architecture:** Preserve the existing eligibility, lease-ownership, and atomic-publication invariants. Add one shared Responses boundary lifted from the reading publisher, one minimizing packet builder, one prompt module whose strict schemas are derived at module load from `contracts/m7`, and one provider adapter behind a `PatternPublisher` interface with two implementations — `openai` and the existing deterministic stand-ins. Rewire `pattern-execute.ts` through the twelve-step artifact-first protocol in Task 6, including attempt-scoped identity, guarded retries, writer return, and immediately-before-fetch accounting; the earlier "exactly four call sites" framing is withdrawn. The deterministic engine proposes nothing and disposes everything: `validatePatternPlan` and `validatePatternCandidate` remain authoritative after model output.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Queues, D1 and R2, Vitest with the Workers pool, Node test through tsx, Python jsonschema validation, OpenAI Responses API, and npm workspaces.

**Authoritative design:** `docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`, as amended by `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md`. If implementation evidence requires a behavioral change, stop and amend/reapprove the design before changing code.

**Approval and implementation record:** Q1–Q6 and the human-free generation
invariant were approved on 2026-08-19. Tasks 1–5a are implemented and were
reverified at current HEAD on 2026-08-20; Tasks 6–10 remain open. No
implementation-plan sign-off gate remains; rollout gates still apply
independently.

---

## Human-free generation invariant

Every individual Pattern is selected, planned, written, validated, verified,
and published or failed by machines. No task may add a human review, editing,
moderation, approval, or release queue; no administrator may change a candidate,
override the verifier, or authorize publication. Reader consent and a
reader-requested retry start work but do not approve content. Operational
rollout and audited incident inspection remain outside the generation path.
State-machine coverage must prove every exhausted branch publishes, retries,
fails, or cancels without a `pending_review`-style state, and administrator
surfaces must have no mutation that can alter candidate content or publication
eligibility.

## Resolved questions

The design listed six points that could not be resolved silently during
implementation. The decisions below were approved on 2026-08-19 and are closed;
none may be reinterpreted while implementing the plan.

### Q1 — Writer attempt ceiling: adopt 3, widen the type

M7 design §13.5 specifies three writer attempts against one frozen plan. The frozen command declares `writer_attempts_max: 2` as a *literal type* (`apps/api/src/services/pattern-command.ts:53`) written by `pattern-enqueue.ts:264`. The field has never been read, which is why the disagreement never surfaced.

The design worries that changing the constant "changes the frozen command shape for jobs already enqueued." That risk is empty in production: `PATTERN_AI_ROLLOUT = "off"` in **both** wrangler blocks (`wrangler.toml:151`, `:268`), and production has no ontology release, so no Pattern command has ever been frozen there. Only dev/test rows can carry a `2`.

**Decision:** the enqueuer writes `3`, and the command type widens to `writer_attempts_max: 2 | 3` so any dev-era row still decodes through `isPatternCommand`. Narrow back to `3` once no `2` rows remain. Note `planner_attempts_max` and `verifier_attempts_max` are also literal `2` and are **not** changed — §13.5 specifies three attempts for the writer only. The current `isPatternCommand` checks only `command_version`; Task 8 must make that decoder validate all three maxima while accepting both `2` and `3` for the writer, rather than relying on the TypeScript union as runtime validation.

**What the attempt count implies, and what this plan originally missed.** §13.5 does not describe a bare retry. A deterministic or semantic rejection triggers another writer attempt carrying a *closed correction document* of finding codes, affected chapter and section keys, the policy rule violated, and the instruction to preserve the frozen plan and evidence assignments — and **rejected prose is never echoed into the correction prompt**. §14.5 closes the loop from the other side: a semantic rejection returns to the writer correction path if attempts remain, retaining the same frozen plan. No correction path exists in the codebase today (the only `correction` matches are the unrelated `chart_correction` lifecycle). Task 3a builds it.

**Counting rule, and where the count lives.** The command's three `*_attempts_max` fields have never been read, so nothing has ever fixed what they count, and §13.5 and §14.5 are worded differently — "at most three attempts" for the writer, "retries the identical candidate at most twice" for the verifier. Read literally those give 3 and 3; read as the field names suggest they give 3 and 2. **Decision: every `*_attempts_max` counts provider calls inclusive of the first**, so §14.5's "at most twice" is one initial call plus one retry.

**Two scopes, not one, and the difference is load-bearing.** An earlier draft of this plan made every maximum a per-pass total *for the job* and derived a 7-call worst case from it. That model does not survive the correction loop it is meant to describe. §13.5 gives the writer three attempts **per job**, spanning corrections against one frozen plan. §14.5 gives the verifier two attempts **per candidate** — "the identical candidate" is the scope, and a semantic rejection ends that candidate rather than retrying it. Flattening the verifier to a per-job total of 2 caps the job at two candidates, so the writer's third attempt can never be verified:

    writer call 1 -> candidate A -> verifier call 1 -> reject
    writer call 2 -> candidate B -> verifier call 2 -> reject
    writer call 3 -> candidate C -> verifier total already 2 -> terminal

The third writer attempt is unreachable, and §13.5's ceiling is decorative in exactly the way `writer_attempts_max` was before this question was asked — one field over. Record both scopes in `pattern-command.ts` beside the fields, because the field names do not carry them.

The storage already exists and is **wired to nothing**. `pattern_generation_jobs.planner_attempts`, `.writer_attempts` and `.verifier_attempts` are declared in `0007:236-238`, and `pattern-execute.ts:72-74` selects all three into the claimed job row — but nothing ever writes them. The only increment in the file (`:150`) is the generic stage-claim `attempts`, which is a different quantity: a claim can expire or fail before any provider call, so `MAX_STAGE_CLAIMS` is not a substitute.

Read-but-never-written is worse than absent, because the columns' presence implies they work. No migration is required; Task 8b increments and enforces what `0007` already provides. Until it lands, all three maxima are unenforceable, so it precedes any claim that an attempt ceiling holds.

**Worst-case spend, derived from the loop rather than from the field list.** At most three candidates reach the verifier — one per writer call — and each may take up to two verifier calls:

    2 planner + 3 writer + (3 candidates × 2 verifier) = 11 provider calls per Pattern

The design's **14** is the same structure read differently: it takes §14.5's "at most twice" as two retries *after* the first, giving three verifier calls per candidate. The disagreement is one reading of one phrase, not an unreachable model. The earlier claim that per-candidate scope has "no durable home" because `pattern_generation_jobs` holds one `verifier_attempts` column (`0007:238`) conflated storage with policy: a column holds a *total*, and per-candidate is a property of the *bound*. **Amend the design's 14 to 11**, state the reading that produced it, and do not carry 7 anywhere — it understates the ceiling by a third and it comes from a model in which the correction loop cannot complete.

**What the per-candidate bound costs to enforce.** `verifier_attempts` is reset to zero by the transition that enters `semantic_verifying`, so it counts calls against the *current* candidate and `verifier_attempts_max: 2` is literally §14.5. No migration and no change to two of the three command literals: `planner_attempts_max` and `verifier_attempts_max` stay `2`, and only `writer_attempts_max` moves to `3`. The reset is safe for Task 6's artifact-first probe because the artifact coordinate carries `stage_generation`, which differs between candidates, so two candidates both writing at attempt `0` do not collide. The job-total verifier bound is then implied — `writer_attempts_max × verifier_attempts_max` = 6 — and needs no second constant.

The alternative is a `verifier_attempts_at_candidate` column recording the counter's value at candidate entry, which keeps a per-job verifier total in the row and is the more legible option if `0010` is being written anyway (Task 8a). Do **not** take the third option of deriving the per-candidate count by counting `verifier_request` rows in `pattern_generation_artifacts` at the current `stage_generation`. It needs no migration, which is why it will be proposed, but it couples an attempt ceiling to an inventory the §18.5 retention sweep deletes, so a long-lived job could reset its own ceiling.

### Q2 — Verifier visibility of the plan: use the full frozen plan

Section 14.1 enumerates the seven items the verifier receives, including the
frozen plan, and the adapter design's own "Verifier independence" section
accepts the framing bias. The rejected alternative was a narrower projection
containing chapter keys, aliases, and authorized rules without `working_title`
or `purpose`.

**Decision:** supply the full frozen plan, per §14.1. Do not treat this as a choice to re-litigate during implementation. Make the residual bias measurable rather than argued: Task 9 injects candidates deliberately drifted from their plan assignment, and a verifier pass-rate that does not move under injected drift is the signal to revisit the projection.

**The enforceable requirement this question was hiding.** §14.2 is a hard constraint that my task breakdown originally missed: the verifier configuration must not be identical to the writer's, and at minimum the tuple `(provider, model, prompt_version)` must differ. Today writer and verifier share both model (`gpt-5.6-sol`) and reasoning (`high`); only the prompt version differs — `"1.0.0"` against `"1.0.0-verifier"` (`pattern-publisher.ts:25,31`) — and **nothing enforces that they stay different**. The separation is an accident of two constants, not a checked relationship. `resolvePatternPublisherConfiguration` must refuse a configuration where the two prompt versions are equal. Task 5 carries this.

Also from §14.1: the verifier's inputs include derived-synthesis dependency graphs and the uncertainty policy, which Task 2's builder must supply. §14.5 completes the loop — a verifier transport failure retries the identical candidate at most twice, and a semantic rejection never re-runs the verifier against unchanged prose.

### Q3 — `assembly_mode` for the synthetic publisher: no schema bump

`assembly_mode` is `{"type": "string", "const": "constrained_model"}` in both `contracts/m7/pattern-document-internal.schema.json:43` and `pattern-response.schema.json:69`. Adding `deterministic_stand_in` turns a `const` into an `enum`, which is a `schema_version` bump rippling through every `0.7.0` const in the package.

The design frames this as "the M7-to-M8 window is the only cheap time to decide." That framing assumes the defect can reach a reader. It cannot: `resolvePatternPublisherConfiguration` already refuses `PATTERN_PUBLISHER=synthetic` outside development (`pattern-publisher.ts:152-154`), and `checkSecureConfig` calls it on every product request — `/health` bypasses `configGuard`, which serves no Pattern — and inside `queue()`. A synthetic-authored document is structurally impossible in any environment serving real readers.

**Decision:** do not bump `schema_version`. Task 5 adds a regression test pinning the refusal at `pattern-publisher.ts:152` as the enforcement boundary, and the limitation is recorded in the plan and in a code comment at the synthetic factory. Revisit only if the synthetic publisher is ever proposed for a non-development environment — which would be the actual defect.

### Q4 — Verifier finding vocabulary: closed list in code, not in the contract

`contracts/m7` types `finding.code` as a free-form `{"type": "string", "minLength": 1, "maxLength": 64}` with no enum. The design compiles a closed list in `pattern-prompt.ts` and rejects codes outside it.

**Decision:** keep the list in `pattern-prompt.ts` for this implementation. The vocabulary is prompt-coupled and no live verifier output exists yet; freezing today's guesses into `contracts/m7` as a new `$def` would harden a list written before a single real finding was observed. The manifest permits that `$def` additively at any later date, so nothing is lost by waiting. Promote it after the evaluation corpus has run against a live verifier and the list has stopped changing.

### Q5 — `MAX_STAGE_CLAIMS`: raise it, and derive the number

`pattern-sweep.ts:19` sets `MAX_STAGE_CLAIMS = 8`. The pinned attempt budgets are unreachable beneath it.

**Decision: raise it to 16 and record the derivation.** Every provider call
occupies its own delivery. The approved 11-call worst case plus the publishing
delivery needs **12 claims before any churn at all**; four additional claims
provide bounded lease-expiry and artifact-adoption recovery. The current
`MAX_STAGE_CLAIMS = 8` blocks the approved retry budgets.

Task 8 sets the constant only after Task 6 establishes lease-expiry recovery,
artifact adoption that spends nothing, and `retryStage` returns that re-arm the
same `stage_generation`. Write the 12-plus-4 derivation into the constant's
comment.

**Claim churn is a different quantity from provider calls**, and it is the one
the constant actually bounds. The four recovery claims cover the Task 6 cases
where lease recovery or adoption consumes a claim but no call. Raising the
ceiling is safe with respect to *spend* once Task 6 moves the charge to step 7
and `PATTERN_DAILY_PROVIDER_CALL_LIMIT` bounds it independently; the fixed 16
still bounds a wedging chart. Land Task 6 first and rewrite the constant's stale
comment about two attempts for every pass and budget charged on stage entry.

### Q6 — Cross-pass budget attribution: this is a conformance gap, not an open question

**This reverses an earlier reading of mine.** Checked against the M7 design rather than the adapter doc's summary, §25.3 is not silent: *"the ledger records used calls **by stage class** in bounded integer columns or separate rows without user identity."* The shipped `pattern_provider_daily_usage` (`db/d1/0007_ai_generated_pattern.sql:420`) is keyed on `utc_date` alone with a single undifferentiated `used_calls` column. The table does not satisfy §25.3, and pointing at the `pass` field in the safe-log arms does not fix that — §25.3 assigns the recording to the *ledger*, and a log is not a ledger.

Two parts of §25.3 must not be conflated. The **ceiling** is shared: "planner, writer, and verifier share the approved Pattern ceiling unless the operator explicitly configures separate sub-ceilings." The **recording** is per stage class. One shared ceiling with per-stage-class counters satisfies both.

**Decision:** add migration `0010` giving `pattern_provider_daily_usage` bounded per-stage-class counters alongside the existing `used_calls` total, which stays the quantity the shared ceiling is enforced against. `0008` is the erasure-replay ledger and Task 8 reserves `0009` for the `correction_document` CHECK rebuild. Do it now: the table is empty in every environment, so this is the cheapest it will ever be, and the alternative — deferring past `internal` — means migrating a table that is actively being written by live generation. If instead the intent is that one column is sufficient, that is an **amendment to §25.3 of the M7 design** and must be recorded there, not decided inside this plan. Task 8a carries the migration.

§25.3 also settles a second thing in this plan's favour: *"the reservation is atomic and consumed immediately before each provider call."* Task 6's budget move is therefore **conformance to the design, not an optimization** — the current charge-at-stage-entry is the deviation.

---

## AI Gateway integration

Checked against `https://developers.cloudflare.com/ai-gateway/llms-full.txt` (fetched 2026-08-15). The gateway is optional and ships inert — `AI_GATEWAY_ACCOUNT_ID`/`AI_GATEWAY_ID` are `""` in both wrangler blocks — but when it is switched on it sits in the provider path for every Pattern pass, so its behavior is part of this plan's contract.

Source anchors for the claims below are the current Cloudflare pages for
`features/unified-billing/#credential-precedence`,
`configuration/bring-your-own-keys`, `configuration/authentication`,
`usage/worker-binding-methods`, `observability/logging`, `features/caching`,
`configuration/request-handling`, `features/dynamic-routing`,
`features/spend-limits`, `features/guardrails/usage-considerations`, and
`features/dlp`. Re-open those pages on the implementation date; do not replace
the generic provider-native credential rules with a coding-agent integration
example.

### Verified against the source

Most of what the adapter already pins is confirmed, with one important
credential-precedence correction carried into Task 5a:

- **The URL.** "Replace `https://api.openai.com/v1` … with `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai`", and the Responses endpoint is documented as `…/openai/responses`. `responsesUrlFor` is right, and the design's warning that `…/openai/v1/responses` is a 404 — read by this adapter as `publisher_model_unavailable`, a terminal failure blaming the model for a mistyped URL — is a real trap, not a hypothetical one.
- **`cf-aig-max-attempts`** is documented "Retry attempts (**max 5**)". The adapter's comment that a gateway retry turns one queue delivery into up to five provider calls the ledger counts as one is exactly the documented ceiling.
- **`cf-aig-collect-log`** turns the entire log entry on or off. **`cf-aig-collect-log-payload`** affects payload storage only — token counts, model, provider, status code, cost, and duration are still logged — and **defaults to `true`**. The rollout doc's description of the two is accurate, and the default is why sending `collect-log: false` explicitly matters rather than relying on a dashboard state.
- **`cf-aig-authorization`** authenticates the request *to the gateway*. The
  documented behavior table is explicit that with Authenticated Gateway off, a
  request without it succeeds; this deployment uses stored keys, whose
  prerequisite is an authenticated gateway, so the token is mandatory here and
  needs **`Run`** permission.
- **Provider credential precedence is request key, then BYOK, then Unified
  Billing.** On a provider-native request carrying `Authorization`, AI Gateway
  forwards that provider key and does **not** consult the stored key. The
  shipped reading adapter therefore bypasses BYOK; it does not send a decorative
  key that AI Gateway ignores. Task 5a must remove `Authorization` in
  `gateway_stored` mode before the stored alias can be used. The generic
  precedence page governs this OpenAI provider-native path; a coding-agent page
  saying an Anthropic variable is ignored is integration-specific and must not
  be generalized.
- **Request headers beat gateway settings.** The documented configuration hierarchy is "request-level headers take precedence over gateway-level settings," which is the assumption the entire header-pinning strategy rests on.
- **`collect-log: false` dominates `collect-log-payload`.** "If `cf-aig-collect-log` is set to `false`, the entire log entry (including metadata) is skipped regardless of the `cf-aig-collect-log-payload` value." The adapter's choice of the broader header is correct, and the rollout doc's description of the two as a swap is accurate.
- **Logs are on by default and persist.** "Logs… are enabled by default for each gateway," they record "the user prompt, model response… token usage, cost, duration, and the user agent," and "these logs persist, giving you the flexibility to store them for your preferred duration." There is no time-based expiry to rely on. At the storage limit a gateway either stops saving new logs or, if the operator enabled Automatic Log Deletion, deletes the oldest logs to make room; neither is a privacy retention policy.

### Zero Data Retention does not apply to this deployment

Worth stating plainly because the dashboard exposes a **Zero Data Retention** toggle that sounds like exactly what a privacy-first app wants, and it does not cover Pattern traffic:

> "This setting only applies to Unified Billing requests that use Cloudflare-managed credentials. **It does not apply to BYOK or other AI Gateway requests.**"

The intended deployment is BYOK: after Task 5a, the provider-native request
carries no provider `Authorization` header and AI Gateway supplies the stored
OpenAI key. Until then the shipped adapter is pass-through, not BYOK, because
the request key takes precedence. ZDR is unavailable on the intended BYOK path,
and `cf-aig-zdr` is a Unified Billing header. The source is also explicit that
"ZDR does not control AI Gateway logging": they are two separate controls.

`cf-aig-collect-log: false` is the per-request mechanism that disables the
**entire** gateway log entry. It is not literally the only way to keep payloads
out — gateway logging can be disabled and `cf-aig-collect-log-payload: false`
retains metadata while dropping bodies — but the platform contract requires no
gateway entry at all, so the broader header is the correct invariant. None of
these controls governs OpenAI's upstream retention; the rollout needs separate
evidence for the provider account's data-retention posture. Do not record
Cloudflare ZDR as a mitigation for BYOK traffic.

### Gateway features that must stay off, and why

Two gateway features are marketed as safety features and would be tempting for a privacy-conscious operator to enable. Both are wrong here, and neither is visible from the Worker's code — they are dashboard state, so the runbook must assert them.

**Guardrails must be off.** Guardrails can evaluate prompts, responses, or both.
Its `S1`–`S13` checks use **Llama Guard 3 8B on Workers AI**; `P1` prompt
injection is evaluated separately by **Prompt Guard 2 86M**. For this product
that means the Pattern packet and/or the reader's generated prose are sent
through additional Cloudflare models that the design's disclosure surface does
not name — a consent question, not merely an operational one. Three further
specifics make it actively unsafe here:

- The hazard categories include **S6 Specialized Advice** and **S11 Suicide & Self-Harm**. This app writes psychological-timing prose about a reader's own patterns. A category set to `block` would kill legitimate Patterns, and category `P1 Prompt Injection` could reject authorized ontology text that this design already defends against in `pattern-prompt.ts`.
- The failure mode is closed in the wrong direction: "if at least one hazard category is set to `block`, but AI Gateway is unable to receive a response from Workers AI, **the request will be blocked**." A Workers AI incident becomes a Pattern outage.
- It adds roughly 500 ms per request, and long content is "automatically segment[ed]… into smaller chunks, processing each through separate Guardrail requests" — so a packet near `PATTERN_INPUT_MAX_BYTES` is fanned out into several additional inferences over private content.

**DLP must be off.** DLP is an inspection service, not another model. Depending
on policy scope it scans request text, response text, or both; for this
non-streaming path that is the reader's context going in and their Pattern
coming out. Task 2's runtime allowlist, not DLP, is the authority for excluding
chart ids, birth values, consent ids, and user ids. Enabling DLP would add an
undisclosed inspector and a blocking failure mode without replacing that
guarantee. A DLP match also adds policy and detection fields to any gateway log
entry.

**Cross-model fallbacks are structurally unavailable on this path, which is the
outcome we want.** Current Dynamic Routes — including model and provider
fallbacks — are invoked through the `/compat/chat/completions` endpoint; this
adapter uses the provider-native Responses endpoint and no Dynamic Route.
Same-provider gateway retries are different: gateway-level retry defaults apply
to provider-native calls too, which is why every request pins
`cf-aig-max-attempts: 1`. The runbook must record both "no Dynamic Route" and a
spend-limit action of **Block**, never fallback. A future endpoint or routing
change reopens the failover question.

### Gateway-originated failures share status codes with provider failures

This is a gap in the current failure taxonomy, which was written for a direct-to-provider world. With a gateway in the path, the same status can mean two different things with two different operator remedies:

| Status | Provider meaning | Gateway meaning | Remedy differs how |
| --- | --- | --- | --- |
| `429` | Provider rate limit — transient, retry later | Gateway **rate limit** or **spend limit** | A spend limit persists until the window resets; retrying is futile until an operator raises the budget |
| `401`/`403` | Provider credential invalid | Authenticated Gateway on with a missing or bad `cf-aig-authorization` | Stored provider key and gateway token are different remedies |

The spend-limit case carries a second consequence. Spend limits are evaluated "before sending a request to the provider," so a gateway 429 means **no provider call occurred** — while `pattern_provider_daily_usage` has already charged a unit immediately before the fetch. That is consistent with §25.3 ("failed, timed-out, and rejected responses still consume a unit"), so the charge stays, but a routed unmarked `429` must stay `unknown` rather than claim a provider outage or a gateway spend-limit remedy.

**Requirement:** preserve the distinction where the platform documents enough
evidence, and say `unknown` everywhere else. Cloudflare documents status
behavior for authenticated-gateway and spend-limit failures, but it does not
publish a universal origin header or body schema for gateway `401`, `403`,
`404`, and `429` responses. The adapter therefore cannot promise to distinguish
a gateway spend limit from an OpenAI rate limit on status alone.

**Route presence is not the discriminator** — provider responses traverse the
route too, so every status arrives through the same channel either way. Use a
closed allowlist of documented Cloudflare error codes, initially `2016` and
`2017` for Guardrails and `2029` and `2030` for DLP, to classify `gateway`.
Do not treat "numeric code" generically as a gateway signature: a provider can
also return one, and undocumented future codes have no reviewed meaning. A
direct, non-gateway response is `provider`; a routed non-2xx without an
allowlisted Cloudflare marker is `unknown`. The safe-log arm carries this
three-value layer, and no response message text is copied into a result or log.
Operationally distinguishing an unknown `401` or `429` belongs in a synthetic
gateway preflight and dashboard check, not an invented runtime guarantee.

### Response headers worth asserting

The reference documents response headers that turn two of this design's stated invariants into checked ones:

- **`cf-aig-cache-status`** indicates whether a request was served from cache; its documented values are `HIT` and `MISS`. The design's justification for `skip-cache: true` is that a cache hit would give two Patterns one `provider_request_id` and one `provider_response_hash` — "stored evidence naming a generation that did not happen." Treat a `HIT` as a terminal configuration failure. The documentation does not promise this header on every gateway-generated authentication, rate-limit, or routing error, so absence is not itself terminal. On a successful routed preflight, record whether the header is `MISS` or absent and pin the observed behavior in rollout evidence; at runtime the invariant is **must not be `HIT`**.
- **`cf-aig-dlp`** is returned when a DLP policy **matches**, not merely when DLP is enabled. Its presence proves an undisclosed DLP policy processed and matched this request or response. Treat it as a terminal misconfiguration; its absence does not prove DLP is off, which is why the dashboard gate remains mandatory.

### Headers this adapter must never send

Each of these is a documented feature that would quietly falsify something the Worker states. The Task 4 tests assert their **absence**, not just the presence of the three we pin. Task 5a extends the outgoing-name allowlist with `cf-aig-byok-alias` only for `gateway_stored` mode; it remains absent in `worker` mode and on direct requests.

| Header | Why it is forbidden here |
| --- | --- |
| `cf-aig-metadata` | Documented as tagging requests "with user IDs or other identifiers", attached to the log entry. The design forbids user identity at the provider boundary outright; this is the most inviting way to violate it. |
| `cf-aig-request-timeout` | Documented as triggering "fallbacks or a retry if a provider takes too long". That would manufacture a second provider call for one delivery, defeating `max-attempts: 1`. The Worker's per-pass `AbortController` is the single deadline authority. |
| `cf-aig-retry-delay`, `cf-aig-backoff` | The retry triple that accompanies `max-attempts`. Harmless while attempts are 1, but their presence invites raising attempts. Omit all three-minus-one. |
| `cf-aig-cache-ttl`, `cf-aig-cache-key` | Caching is refused via `skip-cache: true`; a TTL or custom key is a second, contradicting statement about caching. |
| `cf-aig-collect-log: true` | The header is a bidirectional override: "if logging is disabled at the gateway level, this header will **save** the log for that request." Sending `true` would defeat a correctly configured gateway. Only ever send `false`. |
| `cf-aig-custom-cost` | Rewrites the cost the gateway records, which is the number any spend-limit backstop and any later audit reads. The Worker must not be able to understate its own spend. |

### Operational notes for the runbook

- **`default` is a magic gateway id.** The source documents that using `default` as the gateway ID auto-creates a gateway on the first **authenticated** request. `AI_GATEWAY_ID_PATTERN` accepts it, so an operator can bring a never-reviewed gateway into existence by typo-adjacent configuration. Per-request `collect-log: false` still protects the payloads, but the gateway's own settings would be nobody's decision. Name the gateway explicitly.
- **Gateway spend limits are defense in depth, not the ledger.** Spend limit rules can cap spend per gateway, scoped by model, provider, or custom metadata, and they do apply to BYOK traffic "for models with known pricing." Useful as a backstop under the approved ceiling, but they cannot replace `pattern_provider_daily_usage` — §25.3 assigns the auditable record to the ledger — the custom-metadata scoping is unavailable to us because `cf-aig-metadata` is forbidden above, and they are documented as "eventually consistent," so "a burst of concurrent requests can briefly exceed the limit before enforcement catches up." If one is set, it must be reconciled with the 429 classification requirement above.
- **The gateway token's blast radius is the whole account.** The reference is explicit that `AI Gateway Read`/`Run`/`Edit` "cannot be restricted to a single gateway," and that any token with `Run` "can send requests through every gateway in the account, including any configured with stored provider keys through BYOK, consuming those credentials." `AI_GATEWAY_TOKEN` is therefore an account-scoped credential, not a gateway-scoped one, and must be treated with the same care as `ROOT_KEK` in the secret inventory. Separate Cloudflare accounts are the isolation option that preserves this BYOK architecture; the binding alternative changes the credential and billing model, as below.

### A Worker AI binding is not an alternative for this BYOK path

Cloudflare bindings are pre-authenticated, so they do remove the manual
`cf-aig-authorization` token. But the current Worker binding documentation is
equally explicit that third-party models called through `env.AI.run()` use
Unified Billing and **do not support BYOK**. To use a stored OpenAI key, the
Worker must use a provider-native endpoint.

The binding is therefore not an open implementation choice inside this plan.
Adopting it would mean changing from the operator's stored key to
Cloudflare-managed credentials, re-evaluating ZDR and billing, translating the
provider-native Responses request/response contract, and replacing the
hermetic fetch seam. That is a separately approved provider architecture, not a
Task 5a optimization.

One related forward-compatibility note: the reference says
`gateway.ai.cloudflare.com` provider-native endpoints "continue to work," but
"for new integrations, we recommend using the REST API at
`api.cloudflare.com`." That path changes authentication, model naming, alias
selection, billing, and the response boundary, so it is not a drop-in.
Provider-native fetch is deliberate here because it supports the stored-key
alias and the exact OpenAI Responses envelope the validators consume.

---

## Planned deployment: a stored provider key on the default endpoint

The operator has confirmed the configuration: the **OpenAI provider key is already stored in AI Gateway (BYOK)**, and there will be **no custom domain and no Cloudflare Access**. The Worker calls the default `gateway.ai.cloudflare.com` endpoint.

One thing here contradicts code that has already landed — the stored key — and it is the only gateway-driven change this plan needs. Nothing is blocking today, because the gateway ships disabled, but the adapter cannot be enabled against a stored key as written.

### The shipped adapter conflicts with a stored provider key

BYOK's own instructions are: "Remove provider authorization headers from your requests. Note that you still need to pass `cf-aig-authorization`." The shipped `createOpenAiReadingPublisher` does the opposite — it *requires* `OPENAI_API_KEY`, refuses with `publisher_auth_failed` when absent, and sends `authorization: Bearer ${apiKey}` on every request. The Pattern adapter in Task 4 was specified to mirror it.

Sending it anyway is not harmless. Current credential precedence says a
provider key on the request wins: AI Gateway forwards `OPENAI_API_KEY` and does
**not** consult BYOK. With today's shipped adapter pointed at this gateway, the
stored key is silently bypassed. Rotating the gateway-stored key would appear
successful while runtime traffic continued on the Worker secret. That is the
configuration falsehood Task 5a must prevent.

Two further consequences:

- **`AI_GATEWAY_TOKEN` stops being optional.** BYOK's prerequisites require an authenticated gateway, so `cf-aig-authorization` becomes mandatory whenever the stored key is in use. The comment in `env.ts` describing the token as needed "only while the gateway has Authenticated Gateway on" is still true in the abstract but no longer describes this deployment: here the two are the same condition. Configuration must refuse a stored-key mode with no token rather than discovering it as a 401 on a reader's Pattern.
- **The key alias should be pinned.** With no `cf-aig-byok-alias` header the gateway uses the alias `default`. This codebase pins every other provider-identity value; leaving key selection to an implicit default is inconsistent, and it means adding a second stored key later silently changes nothing until someone notices which one is `default`.

### Credential cutover must not deploy an invalid intermediate state

Production daily readings are already at `READING_V5_ROLLOUT=first_open` and
require `OPENAI_API_KEY`. Task 5a therefore lands first with
`OPENAI_CREDENTIAL_SOURCE=worker` in both Wrangler blocks, the current secret
still present, and both gateway ids still empty. That deployment is
byte-identical for the live reading path.

Switching later to `gateway_stored` changes four things as one release unit:
the two gateway ids become non-empty, `OPENAI_GATEWAY_KEY_ALIAS` becomes
non-empty, `AI_GATEWAY_TOKEN` becomes available to that Worker version, and
`OPENAI_API_KEY` is absent from that same version. Ordinary `wrangler secret
delete` deploys immediately, so deleting the old key first would break `worker`
mode; deploying `gateway_stored` first would be refused because the old key is
still present. The rollout runbook must use a staged Worker version or another
single-deployment mechanism that proves no invalid intermediate configuration
receives traffic. If the available deployment tooling cannot produce that
version atomically, add an explicitly temporary migration state that never
sends `Authorization`, then remove it after the old secret is gone. Do not
improvise the sequence in production.

### Custom domain and Cloudflare Access: decided against

Both were considered and **ruled out by the operator**. The Worker calls the default `gateway.ai.cloudflare.com` endpoint, and no Access policy sits in front of it.

This is the simplifying outcome, and it removes real work rather than deferring it:

- **The shipped URL builder is already correct.** With no custom domain the account and gateway ids stay in the path, so `AI_GATEWAY_ORIGIN`, the 32-hex account validator, the path-segment gateway validator, and `responsesUrlFor` — all landed in `6f3d722` — describe this deployment exactly. No hostname configuration shape is needed.
- **The `/v1/` path ambiguity does not arise.** It came only from the custom-domain and Access pages. For the default endpoint the reference is unambiguous and self-consistent: `…/{gateway_id}/openai/responses`, which is what the adapter builds. No empirical URL check is required before enabling.
- **No Access service token, and no second Worker credential.** `cf-aig-authorization` remains the only gateway credential, and `cf.user_id` never enters gateway metadata because no request authenticates as a user.

One consequence to keep in view rather than act on now. Everything that matters is gateway-scoped — stored provider keys, spend limits, rate limits, logging defaults, Guardrails, DLP, cache — so if coding-agent or other human traffic is ever pointed at *this* gateway later, it shares the stored OpenAI key and the limits with production generation. At that point `pattern_provider_daily_usage` would count Worker calls while the bill covered both, and a shared rate or spend limit could fail real readers' Patterns with a `429`. The fix then is a second gateway for that traffic, not a change to this adapter. Until such traffic exists, the ledger bounds the bill and the limits are the Worker's alone.

---

## Global Constraints

- The approved design is authoritative. Contract changes are out of scope: `contracts/m0` through `contracts/m6` stay byte-identical, and `contracts/m7` keeps its `schema_version`, every `$id`, every enum, and every required field. This plan expects **no** contract edit at all.
- `packages/pattern-engine` keeps its purity contract (`packages/pattern-engine/src/index.ts:1-12`). `selectPatternEvidence`, `validatePatternPlan`, `validatePatternCandidate`, `stripPrivateEvidence`, and `projectPublicPattern` keep their current behavior byte-for-byte. The adapter lives in `apps/api`.
- Nothing new lands in `packages/shared`. The AGPL calc service imports it, and `LICENSING.md` makes that boundary the open legal question — do not widen it.
- Use test-driven development for every runtime task: add the named failing test, run it and record the expected failure, implement the smallest passing change, then rerun the focused lane.
- Preserve `apps/api/vitest.config.ts` `fileParallelism: false`. API test files share one D1 database and `resetDb()` is not safe across parallel files. Any new table touched by these tests must be added to the FK-ordered delete list in `test/helpers.ts` or it will leak rows between suites.
- The model receives no chart identifier, fingerprint, birth value, consent ID, user ID, source-fragment text, previous Pattern, or personal context. Task 2 enforces this at **runtime** — allowlist construction plus post-serialisation rejection — because narrow TypeScript parameter types do not stop a wider value from being passed in a variable. Types are the second line, not the guarantee.
- `selected.aliasMap` never leaves the Worker (`packages/pattern-engine/src/types.ts:23`).
- One queue delivery makes at most one provider call per pass. No retry inside the adapter, no second call inside a stage.
- Every provider request and response exists only as an encrypted, expiring R2 artifact under a closed `artifact_class`. Prompt, packet, plan, draft, and prose logging is forbidden. Safe-log arms carry event name, pass, model, prompt version, latency, token counts, failure class, and hashes.
- No new encrypted column. If one becomes necessary, it must be added to `ENCRYPTED_COLUMNS` in `apps/api/src/db/users.ts` or DEK rotation destroys its data — but the design's intent is that none is needed.
- Merging advances no rollout. `PATTERN_AI_ROLLOUT` stays `off` in both wrangler blocks, and no Worker secret is configured as an implicit consequence of this work.
- These lines in `pattern-execute.ts` are load-bearing and must not change semantics: `claimStage`'s three-statement batch and its `assertion_probe` abort (`:136-179`), the `stageMovedOn` fallback (`:180-191`), `ownershipProbes` (`:350-370`), `advance`'s `stage_generation + 1` guard and `dispatched_at = NULL` (`:372-416`), `nudgeNextStage(..., claimed.job.stage_generation + 1)`, the `try` opening above `selectPatternEvidence` (`:600`), the eligibility and ontology rechecks (`:587-618`), and `publishPattern`'s single guarded batch (`:795-856`).

---

## Phase A: Shared boundary, minimized input, and prompts

### Task 1: Extract the shared Responses boundary

**Status:** Complete in `8558e82`; reverified at current HEAD on 2026-08-20.

**Files:**

- Create: `apps/api/src/services/openai-responses-adapter.ts`
- Create: `apps/api/src/services/openai-responses-adapter.test.ts`
- Modify: `apps/api/src/services/openai-reading-publisher.ts`
- Modify: `apps/api/src/services/reading-publisher.ts`

Lift verbatim from `openai-reading-publisher.ts`: `extractOutputText` (`:75-106`), `retryAfterSeconds` (`:47-55`), the `failure()` helper, and the `PublisherFailureCode` / safe-detail unions. (Line references throughout this plan are a convenience, not an anchor — prefer the identifier when they drift.) Re-export `resolveAiGatewayRoute`, `responsesUrlFor`, and `AiGatewayRoute` so Pattern does not import the reading module.

These functions carry no reading semantics — the only reading-specific line in `extractOutputText` is its return type, which becomes a generic parameter. Copying instead of extracting would let the two drift on the one behavior that is expensive to rediscover: a refusal part accompanied by text, two text parts, reasoning items ahead of the message.

- [x] **Step 1: Write the failing shared-boundary test.** Cover the envelope cases directly: a refusal part alongside an `output_text` part resolves to refusal; two text parts is `publisher_output_invalid`, not a silent first-wins; reasoning items preceding the message are skipped; `incomplete_details.reason` of `max_output_tokens` maps to its own safe detail and not to malformed JSON. Assert `responsesUrlFor(null)` is the direct origin and a route yields `…/openai/responses`, never `…/openai/v1/responses`.
- [x] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts

- [x] **Step 3: Extract, and prove the reading publisher unchanged.** Move the functions, re-point `openai-reading-publisher.ts` at the new module, and change no reading behavior. The existing reading suite is the regression proof — it must pass untouched.
- [x] **Step 4: Run both lanes.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts src/services/openai-reading-publisher.test.ts src/config.test.ts
      npm run typecheck -w @patternlike/api

  Expected: all pass, and the reading publisher's test file has **no diff**.
- [x] **Step 5: Commit.** `api: extract the shared OpenAI Responses boundary`

### Task 2: Add the minimizing Pattern packet builders

**Status:** Complete in `6b52c6c`, hardened in `5191a1f`; reverified at current
HEAD on 2026-08-20.

**Files:**

- Create: `apps/api/src/services/pattern-packet.ts`
- Create: `apps/api/src/services/pattern-packet.test.ts`

Three builders producing the provider-visible input documents for planner, writer, and verifier from the fact packet, the frozen plan, the authorized ontology records, and nothing else. The verifier builder supplies exactly the seven items §14.1 enumerates — validated candidate, frozen plan, exact normalized facts, exact authorized ontology records, derived-synthesis dependency graphs, uncertainty policy, and the strict verdict schema — and nothing beyond them. Per the adapter design's independence section, it must never receive the raw source corpus, the writer's rejected candidates, the writer's correction documents, or the planner's prompt or rejected attempts.

**The guarantee is runtime, not type-level.** An earlier draft of this plan claimed narrow parameter types made emitting an identifier "structurally impossible." That is false, and the correction matters because the whole privacy argument rested on it: TypeScript's excess-property check fires only on fresh object literals, so a *variable* of a wider type — the full `selected` object, say — is assignable to a narrow parameter and carries its extra fields straight into `JSON.stringify`. Several packet fields are also `Record<string, unknown>`, which is open by construction.

So build each document from an **explicit allowlist** of keys, copying named fields into a fresh object rather than spreading or passing through. Then, after serialisation and before the request is built, walk the serialised structure and reject any key outside the allowlist, plus any occurrence of the forbidden identifier names. Narrow input types stay — they catch the easy mistakes at compile time — but they are the second line, not the guarantee. Do not accept the wide `selected` object and pick fields off it.

- [x] **Step 1: Write the failing minimization tests.** Assert each builder's output serializes to a document containing none of the forbidden identifiers, using a deep scan over the serialized JSON against a fixture whose every private value is a recognizable sentinel. Assert `aliasMap` is absent from all three. Assert the byte size is bounded by `PATTERN_INPUT_MAX_BYTES` and that exceeding it is a typed refusal, not a truncation. **Include the two cases that motivate the runtime check, separately.** First: pass the full wide `selected` object where the narrow type is declared — TypeScript permits it — and assert the builder *omits* every non-allowlisted field, so nothing extra is emitted. Second: hand the post-serialisation walk a document that already contains an unexpected key and assert it *rejects*. One test cannot prove both, because a builder that correctly omits leaves the validator nothing to catch.
- [x] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/pattern-packet.test.ts

- [x] **Step 3: Implement the three builders.** Deterministic key order so the same packet yields identical bytes across calls — the artifact hash depends on it.
- [x] **Step 4: Run the lane and typecheck.**
- [x] **Step 5: Commit.** `api: add minimizing Pattern provider packet builders`

### Task 3: Add the Pattern prompt module and derived strict schemas

**Status:** Complete in `0d7b5fa`, with the live strict-mode preflight recorded
in `31d3621`; reverified at current HEAD on 2026-08-20.

**Files:**

- Create: `apps/api/src/services/pattern-prompt.ts`
- Create: `apps/api/src/services/pattern-prompt.test.ts`

Three system policies, three request builders, three output-schema names, the closed verifier finding vocabulary (Q4), and the strict-schema derivation. Exports `PATTERN_PLANNER_PROMPT_VERSION`, `PATTERN_WRITER_PROMPT_VERSION`, `PATTERN_VERIFIER_PROMPT_VERSION` as compiled constants.

Schemas are **derived from a bundled JSON import** of the normative `contracts/m7` documents — `import schema from "../../../../contracts/m7/....json"`, exactly as `reading-prompt.ts:22` already does — with the two keywords OpenAI strict mode does not support stripped at module load. Wrangler bundles those imports; a runtime filesystem read would not work in Workers. Do not check in a second copy: that is a contract that drifts silently.

- [x] **Step 1: Write the failing prompt and derivation tests.** Assert each derived schema is the contract schema minus exactly the unsupported keywords, with every `required` and every `additionalProperties: false` preserved. Assert the request shape: exact model, reasoning effort, `max_output_tokens`, `store: false`, no background, no tools, no browsing/file-search/code/MCP fields, and `text.format` of type `json_schema` with `strict: true`. Assert prompt-injection resistance: ontology rule text and packet values that read as instructions cannot alter system policy, schema, tools, model, or request fields.
- [x] **Step 2: Run and confirm failure.**
- [x] **Step 3: Implement policies, builders, derivation, and the closed finding vocabulary.** Record the Q4 decision in a module comment: the list lives here until a live corpus stabilizes it.
- [x] **Step 4: Run the lane and typecheck.**
- [x] **Step 5: Commit.** `api: add Pattern prompt policies and derived strict schemas`

### Task 3a: Add the writer correction path

**Status:** Complete in `adc22fc`; reverified at current HEAD on 2026-08-20.

**Files:**

- Modify: `apps/api/src/services/pattern-packet.ts`
- Modify: `apps/api/src/services/pattern-packet.test.ts`
- Modify: `apps/api/src/services/pattern-prompt.ts`
- Modify: `apps/api/src/services/pattern-prompt.test.ts`

§13.5's retry is not a bare re-send. A deterministic or semantic rejection produces a **closed correction document** — finding codes, affected chapter and section keys, the policy rule violated, and the instruction to preserve the frozen plan and evidence assignments — and the writer is called again with it. §14.5 supplies the other half: a semantic rejection returns here rather than re-running the verifier on unchanged prose.

The load-bearing constraint is what the correction document must **not** contain: rejected prose is never echoed into the correction prompt. Nor is the verifier's rationale text, which is prose about prose. The document carries codes, keys, and rule identifiers only.

- [x] **Step 1: Write the failing correction-document tests.** Assert the builder emits only codes, chapter/section keys, and rule ids — prove it with a rejected candidate whose every sentence is a recognizable sentinel, and a deep scan showing no sentinel survives into the correction document or the rebuilt writer request. Assert the frozen plan and evidence assignments are carried through unchanged. Assert the writer may rephrase and reorganize sections within a chapter but cannot change chapter membership, chapter count, omitted features, or ontology authorization (§13.5).
- [x] **Step 2: Run and confirm failure.**
- [x] **Step 3: Implement the correction document builder and correction prompt variant.**
- [x] **Step 4: Run the lane and typecheck.**
- [x] **Step 5: Commit.** `api: add the Pattern writer correction document and prompt`

---

## Phase B: The provider boundary

### Task 4: Add the OpenAI Pattern publisher

**Status:** Complete in `69a49fb`, hardened in `d070e2c` and live-preflight
validated in `31d3621`; reverified at current HEAD on 2026-08-20.

**Files:**

- Create: `apps/api/src/services/openai-pattern-publisher.ts`
- Create: `apps/api/src/services/openai-pattern-publisher.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`

The provider boundary for all three passes: headers, one `AbortController`, one fetch, hash-before-parse, the ordered post-200 gauntlet, typed failures. The gateway route is a required constructor parameter, never read from `env` here, exactly as `createOpenAiReadingPublisher` now takes it — a default would let a new call site route around the gateway by saying nothing.

Send the same three `cf-aig-*` headers the reading adapter pins, for the same three reasons: `collect-log: false` because gateway logs store prompt and response verbatim and payload storage defaults to on, `max-attempts: 1` because a gateway retry makes one delivery into up to five calls the usage ledger counts as one, and `skip-cache: true` because a cache hit gives two Patterns one `provider_response_hash`. See the AI Gateway integration section for the verification of each against the Cloudflare source, and for the headers that must never be sent.

- [x] **Step 1: Write the failing adapter tests.** One fetch maximum per pass. Hash computed over the exact response bytes before parsing. The bytes are **not** discarded at the adapter boundary: Task 6 step 10 writes them to the encrypted response artifact and step 4 may later adopt them, so `PassResult` carries the exact bytes alongside the parsed candidate and the hash, and the caller discards them once R2 has committed. They must never reach a failure detail, a returned error, or a log. Failure mapping: timeout/network/429/retryable-5xx to `publisher_unavailable`, 401/403 to `publisher_auth_failed`, model-not-found to `publisher_model_unavailable`, refusal part to `publisher_refused`, malformed or incomplete output to `publisher_output_invalid`. No provider text, header, URL, or exception message reaches a returned detail or a log.

  **Gateway-layer classification.** Route presence and status are not enough:
  provider responses traverse the route, and Cloudflare does not document a
  universal gateway-error body for `401`, `403`, `404`, or `429`. Assert a
  direct non-2xx is `provider`; assert only the closed, documented Cloudflare
  code allowlist (`2016`, `2017`, `2029`, `2030`) is `gateway`; and assert every
  other routed non-2xx — including synthetic auth, spend-limit/rate-limit, and
  bad-path examples — is `unknown`. A numeric code outside the allowlist stays
  `unknown`. No gateway or provider message text reaches a detail or log. The
  public failure remains coarse and the safe detail may preserve the status
  class, but it must not claim an operator remedy the response cannot prove.

  **Invariant assertions on response headers.** Assert `cf-aig-cache-status:
  HIT` fails terminally. Assert `MISS` succeeds and an absent or unrecognised
  value maps only to a closed cache observation (`missing` or `unrecognized`) —
  never the raw header — and does not replace the actual provider/gateway
  outcome; the header is not documented on every gateway-generated error. Assert a
  present `cf-aig-dlp` header is terminal because it proves a DLP policy
  matched, while absence does not prove DLP is disabled. Assert the three
  `cf-aig-*` request headers are present with a route and absent without one,
  **with their exact values** — `cf-aig-collect-log: false`,
  `cf-aig-max-attempts: 1`, `cf-aig-skip-cache: true`. A name-only allowlist
  would pass `collect-log: true`, the worst value to get wrong. Assert the
  **forbidden headers are absent on every request, with and without a route**:
  `cf-aig-metadata`, `cf-aig-request-timeout`, `cf-aig-retry-delay`,
  `cf-aig-backoff`, `cf-aig-cache-ttl`, and `cf-aig-cache-key`. Write this as
  an outgoing-name allowlist so a later header fails by default; Task 5a
  deliberately extends it with `cf-aig-byok-alias` in stored-key mode. Assert
  the gateway URL is `…/openai/responses`, never `…/openai/v1/responses`.
- [x] **Step 2: Run and confirm failure.**
- [x] **Step 3: Implement the three pass methods.**
- [x] **Step 4: Extend the hermetic mock.** `mock-calc-service.ts` already routes `AI_GATEWAY_HOST`; add the Pattern pass scenarios keyed by request id or scenario header. Unknown hosts keep failing closed.
- [x] **Step 5: Run the lane and typecheck.**
- [x] **Step 6: Commit.** `api: add the OpenAI Pattern provider adapter`

### Task 5: Add the PatternPublisher interface and two factories

**Status:** Complete in `86783ab`; reverified at current HEAD on 2026-08-20.

**Files:**

- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/config.test.ts`
- Create: `apps/api/src/services/pattern-publisher.test.ts`

Add the interface, `createOpenAiPatternPublisher`, and `createSyntheticPatternPublisher` wrapping the existing `buildDeterministicPlan` (`packages/pattern-engine/src/synthetic.ts:30`), `buildDeterministicWriterOutput` (`:113`), and the semantic evaluator.

**Break the import cycle first — this task cannot be written as originally drafted.** `evaluateSemanticVerdict` is module-local to `pattern-execute.ts:525` and its signature is `(env: Env, writer: PatternWriterOutput)`. Two problems: `pattern-execute.ts:33` *already* imports `pattern-publisher.js`, so having `pattern-publisher.ts` import the evaluator back would be a genuine circular import; and `PatternPublisher.verify(input, options)` carries no `env`, so the function cannot be wrapped as-is.

Extract the evaluator into its own module — `pattern-semantic.ts` — taking the two flags it actually needs rather than the whole `Env`:

    export function evaluateSemanticVerdict(
      writer: PatternWriterOutput,
      opts: { forceReject: boolean },
    ): PatternSemanticVerdict;

`createSyntheticPatternPublisher` then receives `forceReject` at construction, resolved by the caller from `AUTH_STUB === "1" && PATTERN_SEMANTIC_FORCE_REJECT === "1"` exactly as today. The escape keeps its `AUTH_STUB=1` condition; only where it is read moves. `pattern-execute.ts` drops its local copy in Task 6.

    export interface PatternPublisher {
      plan(input: PlannerInput, options: PassOptions): Promise<PassResult<PatternPlan>>;
      write(input: WriterInput, options: PassOptions): Promise<PassResult<PatternWriterOutput>>;
      verify(input: VerifierInput, options: PassOptions): Promise<PassResult<PatternSemanticVerdict>>;
    }

    export interface PassOptions {
      requestId: string;
      timeoutMs: number;
      pin: PatternPublisherPin;
      /**
       * Charged immediately before the fetch, by the adapter rather than the
       * call site — see Task 6. Resolves ok:false when the day's ceiling is
       * spent, and the adapter must then make no request at all. A synthetic
       * pass is constructed with a reserve that always succeeds and never
       * charges: the ledger counts provider calls, and there is no provider.
       */
      reserve: (stageClass: PatternStageClass) => Promise<{ ok: boolean }>;
    }

- [x] **Step 1: Write the failing interface and configuration tests.** Include the **Q3 regression test**: `checkSecureConfig` refuses `PATTERN_PUBLISHER=synthetic` outside development, so a `constrained_model` document authored by the stand-ins cannot exist in a reader-serving environment. Add the gateway refusals for the Pattern path — a half-configured pair is `publisher_not_configured`, never a fallback to the direct origin. Add the **§14.2 verifier-independence refusal**: `resolvePatternPublisherConfiguration` rejects a configuration where `OPENAI_PATTERN_VERIFIER_PROMPT_VERSION` equals `OPENAI_PATTERN_WRITER_PROMPT_VERSION`. Today the two differ only by the accident of two constants (`pattern-publisher.ts:25,31`); this makes the separation a checked relationship, so one model configuration cannot become sole author and judge without the deployment refusing.
- [x] **Step 2: Run and confirm failure.**
- [x] **Step 3: Implement both factories.** Comment the synthetic factory with the Q3 decision and its enforcement line.
- [x] **Step 4: Run the lane and typecheck.**
- [x] **Step 5: Commit.** `api: add the Pattern publisher interface and two factories`

### Task 5a: Make the provider credential model explicit

**Status:** Complete in `d2975e0`; reverified at current HEAD on 2026-08-20.

**Files:**

- Modify: `apps/api/src/services/reading-publisher.ts`
- Modify: `apps/api/src/services/openai-reading-publisher.ts`
- Modify: `apps/api/src/services/openai-pattern-publisher.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/wrangler.toml`
- Modify: `docs/deploy/openai-daily-reading-rollout.md`

**Approved 2026-08-19; touches the shipped reading adapter.** Today "the Worker holds the provider key" is an unstated assumption compiled into both adapters. On a provider-native request that key has first precedence, so sending it bypasses the operator's stored key. Replace the assumption with a declared credential mode.

The mode is **selected by an explicit variable, never inferred** from whether `OPENAI_API_KEY` happens to be set — inference cannot tell "stored key in use" from "worker key forgotten," and those need opposite outcomes. Add `OPENAI_CREDENTIAL_SOURCE` (`worker` | `gateway_stored`, required whenever a rollout is not `off`) and `OPENAI_GATEWAY_KEY_ALIAS` (required when the source is `gateway_stored`, sent as `cf-aig-byok-alias`).

    export type ProviderCredentialMode =
      | { source: "worker"; apiKey: string }      // Authorization: Bearer <key>
      | { source: "gateway_stored"; alias: string }; // no Authorization header; cf-aig-byok-alias

Resolution rules, all enforced in `resolvePublisherConfiguration` so a wrong combination is a `503` on the next request rather than a runtime surprise:

- `gateway_stored` without a configured gateway route is refused. A stored key only exists behind a gateway.
- `gateway_stored` with `OPENAI_API_KEY` present is refused rather than tolerated. A request key wins over BYOK, so accepting both would silently bypass the stored alias; the refusal message must name the conflicting variables without naming either value.
- `worker` mode keeps today's behavior exactly, so the direct path and the existing reading rollout are unaffected.
- The alias is pinned explicitly and sent as `cf-aig-byok-alias`, never left to the implicit `default`.

- `gateway_stored` with no `AI_GATEWAY_TOKEN` is refused, because BYOK requires an authenticated gateway. Discovering this as an ambiguous `401` mid-generation is too late.

`responsesUrlFor` and the `AI_GATEWAY_ACCOUNT_ID`/`AI_GATEWAY_ID` validators are **unchanged** — with no custom domain, the shipped id-path URL builder is exactly right for this deployment. This task is the credential mode only.

- [x] **Step 1: Write the failing credential tests.** Assert `gateway_stored` sends **no** `authorization` header and does send `cf-aig-byok-alias`; that absence is what permits BYOK to win under documented credential precedence. Extend the outgoing-header allowlist for exactly that one header in stored mode. Assert `worker` mode produces a byte-identical request to today's. Assert each refusal above with its message. Assert `responsesUrlFor` still produces the direct origin and the id-path gateway URL and is otherwise untouched.
- [x] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/config.test.ts src/services/openai-reading-publisher.test.ts src/services/openai-pattern-publisher.test.ts
- [x] **Step 3: Implement the credential mode.** The reading adapter changes shape here; its existing suite must still pass unchanged in `worker` mode. Set `OPENAI_CREDENTIAL_SOURCE="worker"` in both Wrangler blocks for this code deployment, leave the alias empty, and do not alter either rollout or secret.
- [x] **Step 4: Add the cutover invariant to the rollout handoff.** The later switch to `gateway_stored` must stage gateway ids, alias, gateway token, and removal of `OPENAI_API_KEY` in one Worker version, or use an explicitly temporary migration state that never sends provider `Authorization`. Ordinary immediate secret deletion is not a safe sequence.
- [x] **Step 5: Run both adapter lanes, config, and typecheck.**
- [x] **Step 6: Commit.** `api: declare the provider credential mode`

---

## Phase C: Rewiring the stage machine

### Task 6: Implement the design's stage protocol

**Status:** Complete on 2026-08-20. Three files beyond the one this task
originally listed, each recorded under *As built* below.

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/services/openai-pattern-publisher.ts`
- Create: `apps/api/src/services/pattern-execute-protocol.test.ts`

**This task was previously framed as "four edit points, and nothing else changes semantics." That framing was wrong and is withdrawn.** The adapter design's *Idempotency and at-least-once safety* section specifies a twelve-step protocol, three new behaviours, and a function that does not exist yet; the earlier draft compressed all of it into one sentence about an "attempt component" and then raised it as an open question. The design is not silent — the plan had dropped the section. Implement the design's protocol; do not invent a third option.

Read `2026-08-15-openai-pattern-adapter-design.md` § *Idempotency and at-least-once safety* in full before starting. The failure it exists to prevent is concrete: today `advance()` throws on a transient D1 error, nothing commits, the expired-lease lane re-sends the **same** `stage_generation`, the re-run charges budget and calls the provider again, `putArtifact` computes the same three-component id, the create-only put fails, `head()` returns silently (`:269-272`), and `advance` then writes a hash computed over the *second* response — so the next stage fails `plan_missing`. Deterministic stand-ins make the two responses identical and hide it. With a model it is a reader whose Pattern dies on a D1 blip.

**Create `retryStage(env, job, token, pass, availableAt)`.** It does not exist — `pattern-execute.ts` has only `advance` and `failJob`. It runs `ownershipProbes`, returns the job to `queued` on the **same** `stage_generation`, increments `<pass>_attempts` in that same guarded batch, and nudges the same generation. It owns same-stage retry increments. Task 8b adds the other counter-writing transition, `returnToWriter`, for semantic rejection; `advance` never increments the counter of the pass whose result it commits.

**Attempt-scoped artifact identity.** `putArtifact`'s digest input becomes `${generation_id}:${artifact_class}:${stage_generation}:${attempt}` (today `:255` has only the first three). Add `patternArtifactId(generationId, artifactClass, stageGeneration, attempt)` and `getArtifactAt(...)` beside the existing `getArtifact`, which keeps selecting the newest artifact of a class and stays the right tool for reading `validated_plan` across a stage boundary. A redelivery recomputes the same `k` and adopts the stored response; a genuine retry uses `k+1` and is *allowed* to differ — the planner's second attempt may legitimately propose a different plan, and the current three-component id would silently discard it. This changes ids written by current code, which is harmless: rollout is `off` in both blocks, no production generation exists, and artifacts expire at 30 days.

**Hash the committed bytes.** `plan_hash`, `candidate_hash`, and `semantic_verdict_hash` come from the plaintext `putArtifact` actually stored — read back, or returned by `putArtifact` — never from the in-memory response.

**`putArtifact` stops swallowing conflicts.** M7 §18.3 permits reuse only when class, object key, both hashes, envelope metadata, and stage ownership all match; a different artifact under a reserved identity is an integrity conflict that is never overwritten. Today `head()` returns silently regardless of content. It must compare the **full** identity before adopting an existing object — artifact class, object key, `plaintext_sha256`, `ciphertext_sha256`, envelope metadata, and stage ownership — and reuse only when every one matches. Equal plaintext hashes alone prove nothing about the stored object, its ciphertext, its envelope, or its owner. Any mismatch throws, landing in the outer catch as a terminal `execution_error` — the same reasoning that makes `persistCycles` fail closed on a pinned-hash mismatch.

Request artifacts are written **before** the provider call so the exact bytes sent are recoverable when no response arrives. Their presence is **never** the skip condition; only the response artifact's is.

The order at every stage, from the design:

1. claim by CAS; a zero-row claim is a duplicate and acknowledges;
2. decrypt the command; recheck eligibility, ontology, and feature-set identity;
3. read the durable attempt index `k` for this pass; if `k >= max`, fail terminally **without** calling the provider;
4. probe the response artifact at `(class, stage_generation, k)`; on a hit, skip to step 9 with the stored bytes;
5. build the minimized input document; run the ban-list check and the byte cap;
6. write the request artifact (create-only);
7. consume one budget unit;
8. call the provider once, with one `AbortController` covering both the fetch and the body read;
9. run the deterministic validator unchanged;
10. write the response artifact (create-only) and read back its plaintext hash;
11. `advance` with that hash, or `retryStage`, or `failJob`, each with `ownershipProbes` at the head of its batch;
12. nudge, and swallow the send failure — the D1 row is the outbox.

Step 7 is where §25.3's "consumed immediately before each provider call" lands, and note step 4 precedes it: an adopted artifact spends nothing. Because the fetch is inside `openai-pattern-publisher.ts` while `consumePatternProviderCallBudget` needs `env`, date, and limit, `pattern-execute.ts` closes over those and passes the `reserve` callback from Task 5's `PassOptions`; the adapter calls it as its last action before `fetch`. The stage class travels as the callback argument so the ledger records per stage class (Task 8a). Synthetic passes receive a reserve that never charges. §25.3's failure semantics stand: failed, timed-out and rejected calls each consume one unit, and nothing is refunded.

The publisher-selection edit is unchanged from the earlier draft: the fail-closed guard at `:637-640` becomes publisher selection, with a half-configured gateway a terminal `publisher_not_configured`. The three stand-in call sites become `publisherImpl.plan/write/verify`, and `validatePatternPlan` / `validatePatternCandidate` still run immediately after, unchanged.

- [x] **Step 1: Write the failing protocol tests.** An `openai` pin reaches the adapter instead of failing closed. A synthetic pin still produces the deterministic document in development. A delivery failing eligibility or ontology recheck spends no budget. **A provider success whose `advance` then fails, redelivered, adopts the stored artifact: same `k`, no second fetch, no second budget unit, and the hash advanced into D1 names the first response's committed bytes.** A genuine `retryStage` retry writes at `k+1` and may differ. A mismatched `plaintext_sha256` under a reserved identity throws rather than returning silently. `k >= max` fails terminally with no provider call.
- [x] **Step 2: Run and confirm failure.** 8 of 8 failed.
- [x] **Step 3: Implement `retryStage`, attempt-scoped identity, the artifact-first probe, and the conflict check.** Touch nothing on the load-bearing list in Global Constraints.
- [x] **Step 4: Run the Pattern lane and typecheck.** `npm run typecheck` clean across all four workspaces; `npm test -w @patternlike/api` 1195 passed across 72 files; `npm run test:contracts` and the D1 migration smoke checks pass.
- [ ] **Step 5: Commit.** `api: implement the Pattern stage idempotency protocol`

#### As built

Four deviations from the task as written, each recorded rather than assumed.

**The pin reached is the live configuration's, not the frozen command's.** The
executor resolves `resolvePatternPublisherConfiguration(env)` and dispatches on
`config.pin.publisher`, exactly as the fail-closed guard it replaces did. The
frozen `command.publisher` pin is still not read. That means an operator who
flips `PATTERN_PUBLISHER` mid-generation changes the author of a Pattern already
in flight. It is pre-existing behaviour, it is not what this task was asked to
change, and Task 7 — which derives provenance from *the pin that ran* — is where
it should be settled.

**Two configuration refusals moved into `pattern-publisher.ts`.** Design
refusal 1 requires the gateway route to be *carried on `PatternPublisherConfig`*
"so the adapter is handed one explicitly rather than defaulting", and Task 6
cannot construct an OpenAI publisher without a route and a credential. Both are
now resolved at configuration time and carried on the config. The same change
removes `OPENAI_API_KEY` from the `openai` pin's `required` list and replaces it
with `resolveProviderCredentialMode`: requiring the key literally made
`OPENAI_CREDENTIAL_SOURCE=gateway_stored` — the approved 2026-08-19 credential
model — unreachable for Pattern, because BYOK requires the key to be *absent*.
The openai pin now requires `OPENAI_CREDENTIAL_SOURCE` to be set explicitly
rather than inferred, which is why `pattern-publisher.test.ts`'s environment
fixture gains it.

**`provider_4xx` was added to `PatternSafeDetailCode`.** The design's failure
table needs it — "other 4xx" is terminal `publisher_request_invalid`, while a
post-200 shape failure is retryable — but the adapter mapped both to
`schema_mismatch`, so the executor could not tell them apart and would have spent
the whole pass ceiling re-sending a request that can never succeed.

**The verifier writes two artifacts.** `verifier_response` is the coordinate the
artifact-first probe needs, uniform with `planner_response` and `writer_response`;
`semantic_verdict` remains the verdict of record under the class an operator and
the retention sweep look for. Same bytes, two roles.

Deterministic `plan_invalid` and `candidate_invalid` remain terminal, unchanged
from before this task. `retryStage` exists, is exported, and is wired to
retryable *provider* failures; Task 8b routes the deterministic rejections
through it and adds `returnToWriter`.

#### What the review caught, and what it changed

A five-lens adversarial review of the diff raised ten findings. Six were real
and are fixed in this task; the rest are recorded rather than silently dropped.

**Fixed — the verdict is a model document now, and one read of it is not
enough.** `verdict.verdict !== "pass"` was the entire check. It honours a `pass`
carrying a `severity: "error"` finding, which the design calls incoherent rather
than a pass, and it records a malformed body — `{"result":"ok"}`, `verdict`
`undefined` — as `semantic_verification_failed`, the one failure class that
tells an operator the verifier was the reason. `findSemanticVerdictProblem` in
`pattern-semantic.ts` now checks the contract shape, the closed
`PATTERN_FINDING_CODES` vocabulary the design puts out of band, and the
pass/error coherence rule, and a failure is `publisher_output_invalid` — so it
retries within the pass ceiling instead of dying as a semantic rejection.

**Fixed — the candidate is bound before the verifier sees it.** `getArtifact`
selects the *newest* `writer_response`; the job row names the exact one the
writer stage advanced with. The verifier arm now compares the two and fails
`candidate_missing` on disagreement, and publication uses the bound hash rather
than recomputing one over whatever was read back. The design requires exactly
this: "the verdict must be bound to the exact `candidate_hash` the job row
holds."

**Fixed — a malformed model document no longer throws its way to
`execution_error`.** `validatePatternPlan` dereferences `output.chapters.length`
and `validatePatternCandidate` dereferences `output.title.length`. That was safe
while every document came from a deterministic builder. A planner answering
`{"schema_version":"0.7.0"}` would have thrown a `TypeError` into the outer catch
and died terminally with the pass's remaining attempt unspent. Both calls are now
wrapped and a throw is classified as `publisher_output_invalid`.

**Fixed — the retry backoff was measured from the wrong clock.** `now` is bound
at delivery entry, before the claim, the decrypt, the rechecks, the selection and
a provider call that may take the full 120-second timeout. A pass that timed out
at attempt 0 was told to wait thirty seconds from a moment ninety seconds in the
past — no backoff at all, and a 429's `retry_after_seconds` floor silently
ignored with it.

**Fixed — `getArtifactAt` trusted D1's claim about bytes it had already
decrypted.** It returned `row.plaintext_sha256` rather than hashing the plaintext
in its hand, and that value becomes `plan_hash`, `candidate_hash` or
`semantic_verdict_hash` on every adopting redelivery. It now recomputes and
treats a disagreement as an integrity conflict.

**Fixed — a create-only put whose inventory insert lands nowhere.**
`ON CONFLICT(object_key) DO NOTHING` meant a surviving row for an object that no
longer exists would keep its stale hash while `putArtifact` returned the hash of
the bytes it had just written. The fresh-write path now requires the insert to
affect a row; the torn-write repair path deliberately does not, because losing
that race to a concurrent repair is the expected outcome.

**Recorded, not fixed.** Three findings are real but belong elsewhere:

- **`retryStage`'s backoff needs a cron that production does not run.**
  `[env.production.triggers]` is an explicit `crons = []`, so `sweepPatternJobs`
  never fires in production and a backed-off job waits forever. Enabling it is a
  separate gated configuration change shared with the daily-reading scheduler,
  so it is now a decision recorded at Gate 3 of
  `docs/deploy/openai-pattern-rollout.md` rather than a code change here.
- **`publisher_budget_exhausted` surfaces to the reader as `retryable: true`**,
  against its taxonomy row. The reader-facing derivation predates this task and
  is not specific to budget; it belongs with Task 9's failure-taxonomy work.
- **The artifact-first probe keys on the D1 inventory row while the create-only
  reservation is the R2 put.** A delivery whose inventory insert throws after the
  object commits still dies `execution_error`; only the *redelivery* is repaired,
  by `adoptReservedArtifact`. Making the probe authoritative over the reservation
  means an R2 read on every probe miss, which is a Task 9 decision.


### Task 7: Derive provenance from the pin that ran

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/safe-log.ts`

`compact_provenance.provider` and `model_family` are the hardcoded literals `"OpenAI"` and `"gpt"` at `pattern-execute.ts:773-774`. Derive both from the publisher pin that actually ran, so stored provenance names the model that wrote the prose. Add the two new closed safe-log arms with their `pass` field. Note this is *observability*, not accounting: after the Q6 reversal the ledger is the attribution mechanism, and the log field only makes a stage class legible in a trace.

- [ ] **Step 1: Write the failing provenance and logging tests.** Assert a synthetic run and an openai run produce different stored `provider`/`model_family`, and that no arm can carry prompt, packet, plan, draft, or prose.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement derivation and the two arms.**
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: derive Pattern provenance from the executed publisher pin`

### Task 8: Apply the resolved constants

**Files:**

- Modify: `apps/api/src/services/pattern-sweep.ts`
- Modify: `apps/api/src/services/pattern-command.ts`
- Modify: `apps/api/src/services/pattern-enqueue.ts`
- Modify: `contracts/m7/common.schema.json`
- Modify: `contracts/m7/SCHEMA_MANIFEST.json`
- Add: `contracts/m7/fixtures/valid/pattern-admin-artifact.correction-document.json`
- Modify: `contracts/m7/fixtures/invalid/pattern-admin-artifact.bad-class.json`
- Create: `db/d1/0009_pattern_correction_artifact.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`

**Q1 approved 2026-08-19.** Widen `writer_attempts_max` to `2 | 3` and have the enqueuer write `3` (Q1). Leave `planner_attempts_max` and `verifier_attempts_max` at literal `2` — the verifier's `2` is now per candidate rather than per job, which changes what the field means without changing what it holds. Record both scopes beside the fields. Make `isPatternCommand` validate the maxima at runtime: writer `2 | 3`, planner `2`, verifier `2`.

`MAX_STAGE_CLAIMS` rises to the approved 16. Q1's worst case is 11 provider
calls, each in its own delivery, plus the publishing delivery: **12 claims
before any churn**, against a current ceiling of 8. Task 6 supplies four bounded
recovery claims for lease expiry, artifact-adopting redeliveries that spend
nothing, and `retryStage` returns. Put the 12-plus-4 arithmetic in the constant's
doc comment; the current comment incorrectly describes two attempts for every
pass and budget charged on stage entry.

- [ ] **Step 1: Write the failing constant, contract, and migration tests.** A stored dev-era command carrying `writer_attempts_max: 2` still decodes through `isPatternCommand`. A newly frozen command carries `3`. The decoder rejects every other writer maximum and any planner or verifier maximum other than `2`. A job driven through the full 11-call worst case is not failed as `stage_attempts_exhausted` by the sweep, while spend stays bounded by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`. The contract accepts `artifact_class: "correction_document"` and still rejects an unknown correction class. A populated `pattern_generation_artifacts` table survives the CHECK rebuild byte-for-byte.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Apply the constants and additive artifact-class amendment.** Record the enum addition in `SCHEMA_MANIFEST.json`. Migration `0009` rebuilds `pattern_generation_artifacts` with the widened CHECK under live foreign-key enforcement; it does not edit applied `0007`.
- [ ] **Step 4: Run the Pattern lane, contracts, migration smoke, and typecheck.**
- [ ] **Step 5: Commit.** `api: adopt the resolved Pattern attempt and claim ceilings`

### Task 8a: Bring the provider usage ledger into conformance with §25.3

**Files:**

- Create: `db/d1/0010_pattern_stage_class_usage.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/src/db/pattern-provider-usage.ts`
- Modify: `apps/api/test/apply-migrations.ts`

**Q6 approved 2026-08-19.** §25.3 requires the ledger to record used calls by stage class; `pattern_provider_daily_usage` has one undifferentiated `used_calls` column. Add bounded planner, writer, and verifier counters beside it. The same migration adds generator, evaluator, and regression counters to `pattern_ontology_provider_daily_usage`, avoiding an asymmetric second provider ledger before Slice B starts. `used_calls` remains each ledger's total and the value its shared ceiling is enforced against, so the ceiling semantics §25.3 also specifies are unchanged.

Unlike M0's edit-in-place policy, `0007` is applied to production (ledger entry, commit `ff23d00`), `0008` is the erasure-replay ledger, and Task 8 reserves `0009` for the correction-artifact CHECK rebuild, so this is a forward-only `0010`. The table is empty in every environment today, which is why this lands now rather than after `internal`.

- [ ] **Step 1: Write the failing ledger tests.** Each Pattern pass increments its own counter and the shared total. The migration gives ontology rows zeroed generator/evaluator/regression counters, ready for Slice B's helper. The shared ceilings remain enforced against each table's total. Existing rows — none in practice, but prove it — default to zero counters without violating the `CHECK (>= 0)` constraints.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Write the migration and update the reservation helper.** Record the change in `MIGRATIONS.json` with its rationale. `pattern_provider_daily_usage` is already in the FK-ordered delete list in `test/helpers.ts:52`, and `0010` adds columns rather than a table, so no test-helper change is needed.
- [ ] **Step 4: Run the Pattern lane, the contract validator, and typecheck.**

      npm exec -w @patternlike/api -- vitest run
      npm run test:contracts
      npm run typecheck -w @patternlike/api

- [ ] **Step 5: Commit.** `db: record Pattern provider usage by stage class`

### Task 8b: Consume the per-pass attempt counters that already exist

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/pattern-command.ts`

**No migration.** `0007:236-238` already declares `planner_attempts`, `writer_attempts` and `verifier_attempts` on `pattern_generation_jobs`, all `INTEGER NOT NULL DEFAULT 0`, and `pattern-execute.ts:72-74` already selects them into the claimed job row. Nothing writes them, and nothing compares them to the command's maxima — so the ceilings are decorative in exactly the way `writer_attempts_max` was, one layer down. Do not add columns; a second set would diverge from the ones the job row already reads.

**Three transition primitives, not two.** An early draft said "increment inside the same guarded batch that advances the stage," which is backwards — `advance` is the success path, and a crash between provider success and `advance` must leave the counter unchanged so the redelivery recomputes the same `k`. The correction to that draft, "`retryStage` is the sole incrementer," is also wrong, and it is wrong in a way that silently deletes the writer↔verifier loop. `retryStage` is defined as *same stage, same `stage_generation`, increment the pass that just ran*. A semantic rejection has to change the stage (`semantic_verifying` → `writing`) and increment a **different** pass's counter (`writer`, not `verifier`). It is neither an advance nor a same-stage retry, and no amount of wording makes it one.

| Primitive | Stage | `stage_generation` | Counter written | Covers |
| --- | --- | --- | --- | --- |
| `advance(next)` | moves forward | `+1` | none of the pass that just ran; resets `verifier_attempts` when `next` is `semantic_verifying` | a validated pass output |
| `retryStage(pass)` | held | held | `<pass>_attempts + 1` | transport failure, post-200 shape failure, deterministic plan rejection, deterministic candidate rejection |
| `returnToWriter()` | `semantic_verifying` → `writing` | `+1` | `writer_attempts + 1` | semantic rejection with writer attempts remaining (§13.5, §14.5) |

`returnToWriter` carries `ownershipProbes` at the head of its batch like the other two, writes the §14.5 correction document as an artifact before the batch, and re-nudges at the successor `stage_generation`. Note that a **deterministic** candidate rejection is not this primitive: validation runs inline at step 9 of the Task 6 order, still inside the `writing` delivery, so it is an ordinary `retryStage("writer")`. Only the *semantic* rejection crosses a stage boundary. Both consume a writer attempt, which is what §13.5 means by three attempts against one frozen plan.

**The invariant Task 6 actually needs**, which the "sole incrementer" phrasing was a lossy proxy for:

> No transition writes the counter of the pass whose provider result it is committing. Every write to `<pass>_attempts` commits inside the same guarded batch as the `(stage, stage_generation)` transition that authorizes the next call, so a delivery that re-reads the durable row computes the same `k` it computed the first time.

That is what makes the artifact-first probe adopt rather than duplicate, and it survives a third primitive where "only `retryStage` increments" does not. Task 10 step 3 must transcribe **this** sentence into `CLAUDE.md`, not the earlier one, which would be recorded as an invariant that the code does not hold.

**`<pass>_attempts` is a zero-based next-attempt index, not a count of completed attempts.** The columns are `DEFAULT 0` and the ceiling is checked as `k >= max` *before* the call, so a pass that made one successful call and advanced still reads `0`. That is correct for both the inclusive counting rule and the artifact coordinate, but it reads backwards off the column name, and getting it backwards yields `max + 1` calls. Write it beside the fields in `pattern-command.ts` and pin it with a test that counts fetches, not counter values.

**The semantic-rejection branch reads a counter belonging to another pass.** §14.5 returns to the writer "if writer attempts remain," and that decision is taken in the `semantic_verifying` delivery — so that delivery compares `writer_attempts` against `writer_attempts_max`. Returning unconditionally and letting the `writing` delivery hit its own ceiling is not equivalent: the job would fail as a writer attempt exhaustion at public stage `writing`, and `semantic_verification_failed` at `checking_claims` — the one class that tells an operator the verifier was the reason — would never be recorded.

**A consequence to accept rather than discover.** Because `retryStage` re-nudges the *same* `stage_generation`, the queue message for attempt `k` and attempt `k+1` are byte-identical (`PatternGenerationMessage` is `{kind, job_id, generation_id, stage_generation}`, `env.ts:17-22`). At-least-once delivery therefore cannot distinguish a duplicate of attempt `k` from the nudge for `k+1`: the duplicate re-reads the row, sees `k+1`, probes a coordinate that misses, and spends a real provider call. The plan's claim that redelivery is free holds for the **advance** path only. It is bounded by the pass ceiling and by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`, so it is not a correctness hole, but do not describe it as free. The minimal remedy, if it is worth taking: add `attempt` to the message and have `stageMovedOn` compare it to the durable counter the way it already compares `stage_generation` (`pattern-execute.ts:110-114`). That stays within §25.4 — the message already carries `stage_generation`, and an attempt index is the same class of value.

Check the ceiling at the **start** of the pass — step 3 of the Task 6 order — so `k >= max` fails terminally without a provider call.

- [ ] **Step 1: Write the failing counter tests.** A pass that exhausts its maximum fails terminally with the right class and makes no further provider call. **A crash between provider success and `advance`, redelivered, leaves the counter unchanged, reuses the stored artifact, and makes no second fetch** — not "counter and stage moved together." `advance` never increments the counter of the pass it is committing. A deterministic candidate rejection is a same-stage `retryStage("writer")`; a semantic rejection is `returnToWriter`, and both consume a writer attempt while neither consumes a verifier attempt. A semantic rejection with writer attempts remaining returns to `writing` carrying the correction document per §14.5; with none remaining it fails terminally as `semantic_verification_failed` at `checking_claims`, decided in the verifier delivery. **Drive the full loop end to end and count fetches**: three candidates, two verifier calls each, terminal after the third rejection, 11 fetches total and not 7 — the ceiling test is the one that would have caught the flattened model.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement the three primitives, the increments, and the ceiling enforcement.** `returnToWriter` lands here rather than in Task 6, which builds `advance` and `retryStage` only.
- [ ] **Step 4: Run the Pattern lane, contracts, and typecheck.**
- [ ] **Step 5: Commit.** `api: enforce the Pattern per-pass attempt ceilings`

---

## Phase D: Verification and handoff

### Task 9: Integration, idempotency, and failure-taxonomy tests

**Files:**

- Create: `apps/api/src/services/pattern-execute-openai.test.ts`

Drive the worker's `queue()` export with `createMessageBatch` + `getQueueResult`, against the hermetic mock.

- [ ] **Step 1: Write the integration suite.** One reader's one Pattern claim produces at most one accepted document despite duplicate delivery, an expired lease, and a provider success whose D1 advance failed. A timeout, refusal, budget exhaustion, and exhausted attempt budget each produce an honest failed state with a coarse public stage and no prose. Include the **Q2 injected-drift case**: a candidate deliberately drifted from its plan assignment must be caught by the verifier, proving the full-plan input earns its framing-bias cost.
- [ ] **Step 2: Run, implement any gaps, rerun.**
- [ ] **Step 3: Commit.** `api: add Pattern adapter integration and idempotency tests`

### Task 10: Full candidate gate and rollout handoff

**Files:**

- Create: `apps/api/scripts/verify-openai-pattern-model.ts`
- Modify: `apps/api/package.json`
- Modify: `docs/deploy/openai-pattern-rollout.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full gate.**

      npm run typecheck
      npm test
      npm run build
      python contracts/validate_schemas.py

  Expected: all exit 0; `contracts/m0` through `m6` are byte-identical, and
  `contracts/m7` differs only by Task 8's recorded additive
  `correction_document` amendment and fixtures.

  Add a reproducible `publisher:pattern:model:verify` command before closing
  this step. It performs the authorized-account model lookup and the minimal
  strict-schema `pattern` probe already recorded in `pattern-prompt.ts`, prints
  no response prose, and exits nonzero on either failure. The 2026-08-19 probe
  is evidence for the current code decision; rollout requires a fresh run for
  the deployed account and model.
- [ ] **Step 2: Complete the rollout runbook evidence.** The baseline runbook already carries the internal/public branches, ordered gates, evidence requirements, and stop conditions. Reconcile it against the implementation that landed and fill only evidence actually produced. State the worst-case spend from the counting model Q1 fixed — **11** provider calls per Pattern (`2 planner + 3 writer + (3 candidates × 2 verifier)`, each maximum inclusive of the first call, the writer's scoped per job and the verifier's per candidate) × pinned token bounds × current model rates × maximum new Patterns per UTC day, against `PATTERN_DAILY_PROVIDER_CALL_LIMIT`, approved in writing before any non-`off` rollout.

  **Record the derivation, not a constant.** Reproduce the 11 from the two scopes and the writer↔verifier correction cycles Task 8b makes concrete, and write the arithmetic down. Say explicitly which number the approved ceiling was computed against — the spend approval is only as sound as this derivation. Two wrong numbers are in circulation and both must be named so neither is quoted back: the design's **14**, which is this same loop with §14.5's "at most twice" read as two retries after the first, and needs amending to 11 under the inclusive reading; and an intermediate draft's **7**, which flattened the verifier to a per-job total and thereby made the writer's third attempt unreachable. 7 understates the ceiling by a third and must not appear in the runbook.

  Include an AI Gateway subsection covering: that the pair is optional and empty is the shipped state; that the gateway token needs `Run` permission and is **account-scoped**, so it reaches every gateway in the account including any BYOK stored keys; that the existing reviewed gateway's id is deliberately `default` by the operator's 2026-08-19 decision (record its identity before cutover so the magic id cannot auto-create an unreviewed replacement); that a Worker AI binding is **not** a BYOK alternative for third-party models; that request `Authorization` wins over the stored key and therefore must be absent in `gateway_stored` mode; that gateway spend limits may be set as a backstop but never as a substitute for the §25.3 ledger; and — stated as a consequence to accept before enabling — that **Zero Data Retention does not apply to this BYOK path**, that ZDR and gateway logging are separate controls, and that `cf-aig-collect-log: false` is the per-request control that suppresses the entire gateway entry. Record separately the OpenAI account's upstream retention posture. The per-request gateway log view being empty for Pattern traffic is the designed outcome, not an incident.

  The subsection must carry an explicit **dashboard-state checklist**, because these are settings no Worker test can observe: Guardrails **off**; DLP **off**; no Dynamic Route; any spend-limit action set to **Block**, not fallback; retry defaults documented even though every request overrides attempts to `1`; and the gateway's own logging and Automatic Log Deletion settings recorded. Guardrails routes configured prompt/response scopes through Llama Guard and, for `P1`, Prompt Guard; DLP is a separate content-inspection service. Both process private packet or prose bytes outside the disclosed provider boundary, and Guardrails' `S6`/`S11` categories are live false-positive risks for psychological-timing prose. Record the verification of each as a gate, not an assumption.

  Carry a separate **credential cutover gate**. First prove the deployed
  `worker` mode is byte-identical for the already-live reading path. Then stage
  one Worker version in which gateway ids, stored-key alias, and
  `AI_GATEWAY_TOKEN` are present while `OPENAI_API_KEY` is absent; do not expose
  traffic to either invalid intermediate combination. Record the Worker version
  id and the exact secret/var evidence without recording secret values.
- [ ] **Step 3: Record the invariants that span files in `CLAUDE.md`.** The counter invariant **as Task 8b states it** — no transition writes the counter of the pass whose result it is committing, and every write commits in the batch that authorizes the next call — and the artifact-first probe that depends on it. Do not write "`retryStage` is the sole incrementer": `returnToWriter` also increments, and recording the shorter sentence would put an invariant in `CLAUDE.md` that the code does not hold. Also: attempt-scoped artifact identity, the writer-per-job / verifier-per-candidate scope split, the derived-not-copied schema rule, the runtime allowlist at the provider boundary, and the Q1/Q3 decisions with their enforcement lines.
- [ ] **Step 4: Commit.** `docs: add the Pattern adapter rollout runbook and invariants`

---

## Dependency and checkpoint map

    Task 1 (shared boundary) ─┬─> Task 4 (adapter) ──> Task 5 (interface, ──> Task 5a (credential mode) ──> Task 6 (protocol) ┬─> Task 7  (provenance)
    Task 2 (packet) ──────────┤                          extracts the                                                        ├─> Task 8  (constants, Q1 approved)
    Task 3 (prompts) ─────────┤                          semantic evaluator                                                  ├─> Task 8a (ledger 0010, Q6 approved)
    Task 3a (correction) ─────┘                          to break the cycle)                                                 └─> Task 8b (attempt ceilings, no migration)
                                                                  Task 6 + 7 + 8 + 8a + 8b ──> Task 9 (integration) ──> Task 10 (gate + runbook)

**Checkpoints.**

- After Task 1: the reading publisher's behavior is unchanged and its test file has no diff.
- After Task 3: no provider call exists yet; Phase A is pure input construction and is fully testable offline.
- After Task 5: `pattern-execute.ts` is still untouched and production behavior is byte-identical.
- After Task 6: an `openai` pin reaches a provider in test only; `PATTERN_AI_ROLLOUT` is still `off` everywhere.
- After Task 10: the code is a rollout candidate. It is not deployed, no secret is set, and no rollout has moved.

**Decision and sign-off status (2026-08-19).** Q1–Q6 and Task 5a are approved;
no implementation-plan sign-off gate remains. The approved counting rule is
two verifier calls per candidate inclusive of the first, 11 worst-case provider
calls per Pattern, and a per-candidate verifier scope. Q6 resolves to the
forward-only `0010` migration; amending §25.3 instead is no longer an open
alternative. The
human-free generation invariant is also binding: none of these tasks may add a
human review or publication gate. Deployment, secret mutation, and rollout
remain separately controlled operational actions and are not authorized by
this design approval.

**A note on sourcing.** Three documents govern this work and all are normative, in this order: `docs/superpowers/specs/2026-08-16-m7-spec-artifact-amendments.md` settles freeze-versus-design conflicts; `docs/superpowers/specs/2026-08-14-ai-generated-pattern-design.md` (the M7 design) is normative for attempt, budget, verification, and rollout rules and is the source of every `§` reference in this plan; `docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md` (the adapter design) is normative for the adapter's own structure and defers to the M7 design elsewhere. Neither design document is historical. The adapter design's resolved questions cite the M7 design by section, and its summaries are not always the whole of what those sections say. Q2 was largely settled by §14.1 and carried an unmentioned enforceable requirement in §14.2; Q1's attempt count came with a correction-document protocol in §13.5; Q6 was a conformance gap against §25.3 rather than an open choice. Read the amendment and the cited M7 section before implementing any task that leans on one.
