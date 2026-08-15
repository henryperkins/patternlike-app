# OpenAI Pattern Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the three deterministic stand-ins behind M7 Your Pattern with a real OpenAI provider adapter — planner, writer, and semantic verifier — so an eligible consented reader receives a Pattern organized, written, and independently checked by a model inside the evidence envelope the deterministic selector already produces, instead of the `publisher_unavailable` terminal failure that any non-synthetic pin produces today.

**Architecture:** Keep the existing stage machine, queue, lease, and artifact envelope exactly as they are. Add one shared Responses boundary lifted from the reading publisher, one minimizing packet builder, one prompt module whose strict schemas are derived at module load from `contracts/m7`, and one provider adapter behind a `PatternPublisher` interface with two implementations — `openai` and the existing deterministic stand-ins, which become a selectable publisher rather than dead code. `pattern-execute.ts` changes at exactly four call sites. The deterministic engine proposes nothing and disposes everything: `validatePatternPlan` and `validatePatternCandidate` run unchanged, afterwards.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Queues, D1 and R2, Vitest with the Workers pool, Node test through tsx, Python jsonschema validation, OpenAI Responses API, and npm workspaces.

**Authoritative design:** `docs/superpowers/specs/2026-08-15-openai-pattern-adapter-design.md`. If implementation evidence requires a behavioral change, stop and amend/reapprove the design before changing code.

---

## Resolved open questions

The design lists six points that "may not be resolved silently during implementation." Each is resolved below with its evidence. **Q1 and Q3 change a committed constant or a contract posture and need explicit sign-off before Task 8 and Task 1 respectively; the other four are recorded engineering decisions.**

### Q1 — Writer attempt ceiling: adopt 3, widen the type

M7 design §13.5 specifies three writer attempts against one frozen plan. The frozen command declares `writer_attempts_max: 2` as a *literal type* (`apps/api/src/services/pattern-command.ts:53`) written by `pattern-enqueue.ts:264`. The field has never been read, which is why the disagreement never surfaced.

The design worries that changing the constant "changes the frozen command shape for jobs already enqueued." That risk is empty in production: `PATTERN_AI_ROLLOUT = "off"` in **both** wrangler blocks (`wrangler.toml:151`, `:268`), and production has no ontology release, so no Pattern command has ever been frozen there. Only dev/test rows can carry a `2`.

**Decision:** the enqueuer writes `3`, and the command type widens to `writer_attempts_max: 2 | 3` so any dev-era row still decodes through `isPatternCommand`. Narrow back to `3` once no `2` rows remain. Note `planner_attempts_max` and `verifier_attempts_max` are also literal `2` and are **not** changed — §13.5 specifies three attempts for the writer only.

**What the attempt count implies, and what this plan originally missed.** §13.5 does not describe a bare retry. A deterministic or semantic rejection triggers another writer attempt carrying a *closed correction document* of finding codes, affected chapter and section keys, the policy rule violated, and the instruction to preserve the frozen plan and evidence assignments — and **rejected prose is never echoed into the correction prompt**. §14.5 closes the loop from the other side: a semantic rejection returns to the writer correction path if attempts remain, retaining the same frozen plan. No correction path exists in the codebase today (the only `correction` matches are the unrelated `chart_correction` lifecycle). Task 3a builds it.

### Q2 — Verifier visibility of the plan: already settled upstream; the open part is narrower

Read against the M7 design, this is mostly not an open question. §14.1 enumerates the seven items the verifier receives and the frozen plan is one of them, and the adapter design's own "Verifier independence" section states that the design "accepts the framing bias." What is genuinely open is only the *further* narrowing — whether the plan should be projected down to chapter keys, aliases, and authorized rules without `working_title` or `purpose`.

**Decision:** supply the full frozen plan, per §14.1. Do not treat this as a choice to re-litigate during implementation. Make the residual bias measurable rather than argued: Task 9 injects candidates deliberately drifted from their plan assignment, and a verifier pass-rate that does not move under injected drift is the signal to revisit the projection.

**The enforceable requirement this question was hiding.** §14.2 is a hard constraint that my task breakdown originally missed: the verifier configuration must not be identical to the writer's, and at minimum the tuple `(provider, model, prompt_version)` must differ. Today writer and verifier share both model (`gpt-5.6-sol`) and reasoning (`high`); only the prompt version differs — `"1.0.0"` against `"1.0.0-verifier"` (`pattern-publisher.ts:25,31`) — and **nothing enforces that they stay different**. The separation is an accident of two constants, not a checked relationship. `resolvePatternPublisherConfiguration` must refuse a configuration where the two prompt versions are equal. Task 5 carries this.

Also from §14.1: the verifier's inputs include derived-synthesis dependency graphs and the uncertainty policy, which Task 2's builder must supply. §14.5 completes the loop — a verifier transport failure retries the identical candidate at most twice, and a semantic rejection never re-runs the verifier against unchanged prose.

### Q3 — `assembly_mode` for the synthetic publisher: no schema bump

`assembly_mode` is `{"type": "string", "const": "constrained_model"}` in both `contracts/m7/pattern-document-internal.schema.json:43` and `pattern-response.schema.json:69`. Adding `deterministic_stand_in` turns a `const` into an `enum`, which is a `schema_version` bump rippling through every `0.7.0` const in the package.

The design frames this as "the M7-to-M8 window is the only cheap time to decide." That framing assumes the defect can reach a reader. It cannot: `resolvePatternPublisherConfiguration` already refuses `PATTERN_PUBLISHER=synthetic` outside development (`pattern-publisher.ts:152-154`), and `checkSecureConfig` calls it on every request and inside `queue()`. A synthetic-authored document is structurally impossible in any environment serving real readers.

**Decision:** do not bump `schema_version`. Task 5 adds a regression test pinning the refusal at `pattern-publisher.ts:152` as the enforcement boundary, and the limitation is recorded in the plan and in a code comment at the synthetic factory. Revisit only if the synthetic publisher is ever proposed for a non-development environment — which would be the actual defect.

### Q4 — Verifier finding vocabulary: closed list in code, not in the contract

`contracts/m7` types `finding.code` as a free-form `{"type": "string", "minLength": 1, "maxLength": 64}` with no enum. The design compiles a closed list in `pattern-prompt.ts` and rejects codes outside it.

**Decision:** keep the list in `pattern-prompt.ts` for this implementation. The vocabulary is prompt-coupled and no live verifier output exists yet; freezing today's guesses into `contracts/m7` as a new `$def` would harden a list written before a single real finding was observed. The manifest permits that `$def` additively at any later date, so nothing is lost by waiting. Promote it after the evaluation corpus has run against a live verifier and the list has stopped changing.

### Q5 — `MAX_STAGE_CLAIMS`: raise 8 → 16

`pattern-sweep.ts:19` sets `MAX_STAGE_CLAIMS = 8`. The pinned per-pass attempt budgets are unreachable beneath it.

**Decision:** raise to 16. This is safe *because* of the budget move in Task 6: once a provider call is charged immediately before the fetch rather than at stage entry, `MAX_STAGE_CLAIMS` bounds claim churn only, and spend stays bounded independently by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`. Raising it without the budget move would raise the spend ceiling too, so Task 6 and Task 8 land in that order.

### Q6 — Cross-pass budget attribution: this is a conformance gap, not an open question

**This reverses an earlier reading of mine.** Checked against the M7 design rather than the adapter doc's summary, §25.3 is not silent: *"the ledger records used calls **by stage class** in bounded integer columns or separate rows without user identity."* The shipped `pattern_provider_daily_usage` (`db/d1/0007_ai_generated_pattern.sql:420`) is keyed on `utc_date` alone with a single undifferentiated `used_calls` column. The table does not satisfy §25.3, and pointing at the `pass` field in the safe-log arms does not fix that — §25.3 assigns the recording to the *ledger*, and a log is not a ledger.

Two parts of §25.3 must not be conflated. The **ceiling** is shared: "planner, writer, and verifier share the approved Pattern ceiling unless the operator explicitly configures separate sub-ceilings." The **recording** is per stage class. One shared ceiling with per-stage-class counters satisfies both.

**Decision:** add migration `0008` giving `pattern_provider_daily_usage` bounded per-stage-class counters alongside the existing `used_calls` total, which stays the quantity the shared ceiling is enforced against. Do it now: the table is empty in every environment, so this is the cheapest it will ever be, and the alternative — deferring past `internal` — means migrating a table that is actively being written by live generation. If instead the intent is that one column is sufficient, that is an **amendment to §25.3 of the M7 design** and must be recorded there, not decided inside this plan. Task 8a carries the migration.

§25.3 also settles a second thing in this plan's favour: *"the reservation is atomic and consumed immediately before each provider call."* Task 6's budget move is therefore **conformance to the design, not an optimization** — the current charge-at-stage-entry is the deviation.

---

## AI Gateway integration

Checked against `https://developers.cloudflare.com/ai-gateway/llms-full.txt` (fetched 2026-08-15). The gateway is optional and ships inert — `AI_GATEWAY_ACCOUNT_ID`/`AI_GATEWAY_ID` are `""` in both wrangler blocks — but when it is switched on it sits in the provider path for every Pattern pass, so its behavior is part of this plan's contract.

### Verified against the source

Everything the adapter already pins is confirmed, and two claims that read like guesses turn out to be exact:

- **The URL.** "Replace `https://api.openai.com/v1` … with `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai`", and the Responses endpoint is documented as `…/openai/responses`. `responsesUrlFor` is right, and the design's warning that `…/openai/v1/responses` is a 404 — read by this adapter as `publisher_model_unavailable`, a terminal failure blaming the model for a mistyped URL — is a real trap, not a hypothetical one.
- **`cf-aig-max-attempts`** is documented "Retry attempts (**max 5**)". The adapter's comment that a gateway retry turns one queue delivery into up to five provider calls the ledger counts as one is exactly the documented ceiling.
- **`cf-aig-collect-log`** turns the entire log entry on or off. **`cf-aig-collect-log-payload`** affects payload storage only — token counts, model, provider, status code, cost, and duration are still logged — and **defaults to `true`**. The rollout doc's description of the two is accurate, and the default is why sending `collect-log: false` explicitly matters rather than relying on a dashboard state.
- **`cf-aig-authorization`** authenticates the request *to the gateway*; the provider key rides its own header and the gateway forwards it. Matches `env.ts`, including the "only while Authenticated Gateway is on" reading — the documented behavior table is explicit that with the setting off, a request with no header succeeds. The gateway token needs **`Run`** permission.
- **Request headers beat gateway settings.** The documented configuration hierarchy is "request-level headers take precedence over gateway-level settings," which is the assumption the entire header-pinning strategy rests on.
- **`collect-log: false` dominates `collect-log-payload`.** "If `cf-aig-collect-log` is set to `false`, the entire log entry (including metadata) is skipped regardless of the `cf-aig-collect-log-payload` value." The adapter's choice of the broader header is correct, and the rollout doc's description of the two as a swap is accurate.
- **Logs are on by default and persist.** "Logs… are enabled by default for each gateway," they record "the user prompt, model response… token usage, cost, duration, and the user agent," and "these logs persist, giving you the flexibility to store them for your preferred duration." There is no automatic expiry to fall back on — only a per-gateway storage limit that stops *new* logs once full.

### Zero Data Retention does not apply to this deployment

Worth stating plainly because the dashboard exposes a **Zero Data Retention** toggle that sounds like exactly what a privacy-first app wants, and it does not cover Pattern traffic:

> "This setting only applies to Unified Billing requests that use Cloudflare-managed credentials. **It does not apply to BYOK or other AI Gateway requests.**"

This deployment is BYOK — `OPENAI_API_KEY` is ours and rides `Authorization` for the gateway to forward — so ZDR is unavailable on this path, and `cf-aig-zdr` is a Unified Billing header. The source is also explicit that "ZDR does not control AI Gateway logging": they are two separate controls. `cf-aig-collect-log: false` is therefore the *only* mechanism keeping prompts and responses out of gateway storage. Do not record ZDR as a mitigation anywhere, and do not let a future reviewer treat the toggle as covering this traffic.

### Gateway features that must stay off, and why

Two gateway features are marketed as safety features and would be tempting for a privacy-conscious operator to enable. Both are wrong here, and neither is visible from the Worker's code — they are dashboard state, so the runbook must assert them.

**Guardrails must be off.** Guardrails evaluates "both prompts and responses" for text-generation models by running them through **Llama Guard 3 8B on Workers AI**. For this product that means the Pattern packet and the reader's generated prose are sent to an additional model, which the design's disclosure surface does not name — a consent question, not merely an operational one. Three further specifics make it actively unsafe here:

- The hazard categories include **S6 Specialized Advice** and **S11 Suicide & Self-Harm**. This app writes psychological-timing prose about a reader's own patterns. A category set to `block` would kill legitimate Patterns, and category `P1 Prompt Injection` could reject authorized ontology text that this design already defends against in `pattern-prompt.ts`.
- The failure mode is closed in the wrong direction: "if at least one hazard category is set to `block`, but AI Gateway is unable to receive a response from Workers AI, **the request will be blocked**." A Workers AI incident becomes a Pattern outage.
- It adds roughly 500 ms per request, and long content is "automatically segment[ed]… into smaller chunks, processing each through separate Guardrail requests" — so a packet near `PATTERN_INPUT_MAX_BYTES` is fanned out into several additional inferences over private content.

**DLP must be off.** DLP "scans the full request and response body" for non-streaming traffic — again, the reader's context going in and their Pattern coming out. It is also *redundant by construction* here: Task 2 makes the packet structurally incapable of carrying a chart id, birth value, consent id, or user id, so a correctly built request has nothing for DLP to find. Enabling it buys no detection the type system does not already guarantee, while adding an inspector of private content and a blocking failure mode. Note also that DLP matches write extra fields into the log entry.

**Fallbacks are structurally unavailable, which is the outcome we want.** Fallbacks are configured on the Universal endpoint — which the reference marks **deprecated** — and this adapter uses provider-native endpoints. The design's "no automatic provider or model failover" is therefore enforced by the endpoint choice rather than by a setting anyone could toggle. Record it that way so a later migration to the Universal or REST endpoint is understood to reopen the question.

### Gateway-originated failures share status codes with provider failures

This is a gap in the current failure taxonomy, which was written for a direct-to-provider world. With a gateway in the path, the same status can mean two different things with two different operator remedies:

| Status | Provider meaning | Gateway meaning | Remedy differs how |
| --- | --- | --- | --- |
| `429` | Provider rate limit — transient, retry later | Gateway **rate limit** or **spend limit** | A spend limit persists until the window resets; retrying is futile until an operator raises the budget |
| `401`/`403` | `OPENAI_API_KEY` invalid | Authenticated Gateway on with a missing or bad `cf-aig-authorization` | Rotate `AI_GATEWAY_TOKEN`, not the provider key |

The spend-limit case carries a second consequence. Spend limits are evaluated "before sending a request to the provider," so a gateway 429 means **no provider call occurred** — while `pattern_provider_daily_usage` has already charged a unit immediately before the fetch. That is consistent with §25.3 ("failed, timed-out, and rejected responses still consume a unit"), so the charge stays, but the *diagnosis* must not read as a provider failure.

**Requirement:** when a route is configured, the adapter must classify gateway-originated failures distinctly from provider-originated ones, and the safe-log arm must carry which layer refused. Failing to do this makes a forgotten gateway spend limit look exactly like an OpenAI outage. Task 4 covers it.

### Response headers worth asserting

The reference documents response headers that turn two of this design's stated invariants into checked ones:

- **`cf-aig-cache-status`** indicates whether a request was served from cache. The design's justification for `skip-cache: true` is that a cache hit would give two Patterns one `provider_request_id` and one `provider_response_hash` — "stored evidence naming a generation that did not happen." Asserting this header is not a hit converts that argument into a runtime check, and it is the only way to notice if `skip-cache` ever stops being honored.
- **`cf-aig-dlp`** is returned when a DLP policy matches. Its presence proves DLP is enabled on the gateway despite the runbook. Treat it as a terminal misconfiguration rather than accepting a DLP-processed response.

### Headers this adapter must never send

Each of these is a documented feature that would quietly falsify something the Worker states. The Task 4 tests assert their **absence**, not just the presence of the three we pin.

| Header | Why it is forbidden here |
| --- | --- |
| `cf-aig-metadata` | Documented as tagging requests "with user IDs or other identifiers", attached to the log entry. The design forbids user identity at the provider boundary outright; this is the most inviting way to violate it. |
| `cf-aig-request-timeout` | Documented as triggering "fallbacks or a retry if a provider takes too long". That would manufacture a second provider call for one delivery, defeating `max-attempts: 1`. The Worker's per-pass `AbortController` is the single deadline authority. |
| `cf-aig-retry-delay`, `cf-aig-backoff` | The retry triple that accompanies `max-attempts`. Harmless while attempts are 1, but their presence invites raising attempts. Omit all three-minus-one. |
| `cf-aig-cache-ttl`, `cf-aig-cache-key` | Caching is refused via `skip-cache: true`; a TTL or custom key is a second, contradicting statement about caching. |
| `cf-aig-collect-log: true` | The header is a bidirectional override: "if logging is disabled at the gateway level, this header will **save** the log for that request." Sending `true` would defeat a correctly configured gateway. Only ever send `false`. |
| `cf-aig-custom-cost` | Rewrites the cost the gateway records, which is the number any spend-limit backstop and any later audit reads. The Worker must not be able to understate its own spend. |

### Two operational notes for the runbook

- **`default` is a magic gateway id.** The source documents that using `default` as the gateway ID auto-creates a gateway on first request. `AI_GATEWAY_ID_PATTERN` accepts it, so an operator can bring a never-reviewed gateway into existence by typo-adjacent configuration. Per-request `collect-log: false` still protects the payloads, but the gateway's own settings would be nobody's decision. Name the gateway explicitly.
- **Gateway spend limits are defense in depth, not the ledger.** Spend limit rules can cap spend per gateway, scoped by model, provider, or custom metadata, and they do apply to BYOK traffic "for models with known pricing." Useful as a backstop under the approved ceiling, but they cannot replace `pattern_provider_daily_usage` — §25.3 assigns the auditable record to the ledger — the custom-metadata scoping is unavailable to us because `cf-aig-metadata` is forbidden above, and they are documented as "eventually consistent," so "a burst of concurrent requests can briefly exceed the limit before enforcement catches up." If one is set, it must be reconciled with the 429 classification requirement above.
- **The gateway token's blast radius is the whole account.** The reference is explicit that `AI Gateway Read`/`Run`/`Edit` "cannot be restricted to a single gateway," and that any token with `Run` "can send requests through every gateway in the account, including any configured with stored provider keys through BYOK, consuming those credentials." `AI_GATEWAY_TOKEN` is therefore an account-scoped credential, not a gateway-scoped one, and must be treated with the same care as `ROOT_KEK` in the secret inventory. Cloudflare's own recommendation for isolation is "separate Cloudflare accounts or a Worker-side AI Gateway binding rather than relying on token scope."

### Open decision: gateway binding versus fetch

Because this API *is* a Cloudflare Worker, the binding option Cloudflare recommends for isolation is available: "when an AI Gateway is accessed from a Cloudflare Worker using a binding, the `cf-aig-authorization` header does not need to be manually included. Requests made through bindings are pre-authenticated within the associated Cloudflare account." That would delete `AI_GATEWAY_TOKEN` from the secret inventory entirely and remove the account-wide blast radius above.

It is **not** adopted by this plan, and the trade is real: the approved design specifies a direct `fetch` boundary, `test/mock-calc-service.ts` achieves hermetic tests by intercepting `fetch` by hostname, and a binding would need a different interception strategy across every Pattern test. Recording it as an open decision for the rollout owner rather than resolving it here. If the gateway is never enabled, the question never arises — the direct path uses no gateway credential at all.

One related forward-compatibility note: the reference says `gateway.ai.cloudflare.com` provider-native endpoints "continue to work," but "for new integrations, we recommend using the REST API at `api.cloudflare.com`." That path changes the authentication model and the credential story, so it is not a drop-in. Flagging it so the choice is understood as deliberate rather than unexamined.

---

## Planned deployment: a stored provider key on the default endpoint

The operator has confirmed the configuration: the **OpenAI provider key is already stored in AI Gateway (BYOK)**, and there will be **no custom domain and no Cloudflare Access**. The Worker calls the default `gateway.ai.cloudflare.com` endpoint.

One thing here contradicts code that has already landed — the stored key — and it is the only gateway-driven change this plan needs. Nothing is blocking today, because the gateway ships disabled, but the adapter cannot be enabled against a stored key as written.

### The shipped adapter conflicts with a stored provider key

BYOK's own instructions are: "Remove provider authorization headers from your requests. Note that you still need to pass `cf-aig-authorization`." The shipped `createOpenAiReadingPublisher` does the opposite — it *requires* `OPENAI_API_KEY`, refuses with `publisher_auth_failed` when absent, and sends `authorization: Bearer ${apiKey}` on every request. The Pattern adapter in Task 4 was specified to mirror it.

Sending it anyway is not harmless. The reference states that when AI Gateway already holds the credentials through a stored provider key, the forwarded key "is ignored." So under this deployment the Worker's `OPENAI_API_KEY` becomes **decorative**: still required by `resolvePublisherConfiguration`, still transmitted, and ignored by the gateway, which bills and authenticates on the stored key. An operator rotating the Worker secret would believe they had rotated the key while nothing changed. That is precisely the class of silent falsehood this codebase's configuration guards exist to prevent.

Two further consequences:

- **`AI_GATEWAY_TOKEN` stops being optional.** BYOK's prerequisites require an authenticated gateway, so `cf-aig-authorization` becomes mandatory whenever the stored key is in use. The comment in `env.ts` describing the token as needed "only while the gateway has Authenticated Gateway on" is still true in the abstract but no longer describes this deployment: here the two are the same condition. Configuration must refuse a stored-key mode with no token rather than discovering it as a 401 on a reader's Pattern.
- **The key alias should be pinned.** With no `cf-aig-byok-alias` header the gateway uses the alias `default`. This codebase pins every other provider-identity value; leaving key selection to an implicit default is inconsistent, and it means adding a second stored key later silently changes nothing until someone notices which one is `default`.

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
- The model receives no chart identifier, fingerprint, birth value, consent ID, user ID, source-fragment text, previous Pattern, or personal context. The packet builder must be *structurally* incapable of emitting one — this is a type-level guarantee in Task 2, not a review convention.
- `selected.aliasMap` never leaves the Worker (`packages/pattern-engine/src/types.ts:23`).
- One queue delivery makes at most one provider call per pass. No retry inside the adapter, no second call inside a stage.
- Every provider request and response exists only as an encrypted, expiring R2 artifact under a closed `artifact_class`. Prompt, packet, plan, draft, and prose logging is forbidden. Safe-log arms carry event name, pass, model, prompt version, latency, token counts, failure class, and hashes.
- No new encrypted column. If one becomes necessary, it must be added to `ENCRYPTED_COLUMNS` in `apps/api/src/db/users.ts` or DEK rotation destroys its data — but the design's intent is that none is needed.
- Merging advances no rollout. `PATTERN_AI_ROLLOUT` stays `off` in both wrangler blocks, and no Worker secret is configured as an implicit consequence of this work.
- These lines in `pattern-execute.ts` are load-bearing and must not change semantics: `claimStage`'s three-statement batch and its `assertion_probe` abort (`:136-179`), the `stageMovedOn` fallback (`:180-191`), `ownershipProbes` (`:350-370`), `advance`'s `stage_generation + 1` guard and `dispatched_at = NULL` (`:372-416`), `nudgeNextStage(..., claimed.job.stage_generation + 1)`, the `try` opening above `selectPatternEvidence` (`:600`), the eligibility and ontology rechecks (`:587-618`), and `publishPattern`'s single guarded batch (`:795-856`).

---

## Phase A: Shared boundary, minimized input, and prompts

### Task 1: Extract the shared Responses boundary

**Files:**

- Create: `apps/api/src/services/openai-responses-adapter.ts`
- Create: `apps/api/src/services/openai-responses-adapter.test.ts`
- Modify: `apps/api/src/services/openai-reading-publisher.ts`
- Modify: `apps/api/src/services/reading-publisher.ts`

Lift verbatim from `openai-reading-publisher.ts`: `extractOutputText` (`:57-106`), `retryAfterSeconds` (`:47-55`), the `failure()` helper, and the `PublisherFailureCode` / safe-detail unions. Re-export `resolveAiGatewayRoute`, `responsesUrlFor`, and `AiGatewayRoute` so Pattern does not import the reading module.

These functions carry no reading semantics — the only reading-specific line in `extractOutputText` is its return type, which becomes a generic parameter. Copying instead of extracting would let the two drift on the one behavior that is expensive to rediscover: a refusal part accompanied by text, two text parts, reasoning items ahead of the message.

- [ ] **Step 1: Write the failing shared-boundary test.** Cover the envelope cases directly: a refusal part alongside an `output_text` part resolves to refusal; two text parts is `publisher_output_invalid`, not a silent first-wins; reasoning items preceding the message are skipped; `incomplete_details.reason` of `max_output_tokens` maps to its own safe detail and not to malformed JSON. Assert `responsesUrlFor(null)` is the direct origin and a route yields `…/openai/responses`, never `…/openai/v1/responses`.
- [ ] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts

- [ ] **Step 3: Extract, and prove the reading publisher unchanged.** Move the functions, re-point `openai-reading-publisher.ts` at the new module, and change no reading behavior. The existing reading suite is the regression proof — it must pass untouched.
- [ ] **Step 4: Run both lanes.**

      npm exec -w @patternlike/api -- vitest run src/services/openai-responses-adapter.test.ts src/services/openai-reading-publisher.test.ts src/config.test.ts
      npm run typecheck -w @patternlike/api

  Expected: all pass, and the reading publisher's test file has **no diff**.
- [ ] **Step 5: Commit.** `api: extract the shared OpenAI Responses boundary`

### Task 2: Add the minimizing Pattern packet builders

**Files:**

- Create: `apps/api/src/services/pattern-packet.ts`
- Create: `apps/api/src/services/pattern-packet.test.ts`

Three builders producing the provider-visible input documents for planner, writer, and verifier from the fact packet, the frozen plan, the authorized ontology records, and nothing else. The verifier builder supplies exactly the seven items §14.1 enumerates — validated candidate, frozen plan, exact normalized facts, exact authorized ontology records, derived-synthesis dependency graphs, uncertainty policy, and the strict verdict schema — and nothing beyond them. Per the adapter design's independence section, it must never receive the raw source corpus, the writer's rejected candidates, the writer's correction documents, or the planner's prompt or rejected attempts.

Make the guarantee structural. The builders accept narrow input types that do not carry a chart id, fingerprint, birth value, consent id, user id, or alias map, so emitting one is a type error rather than a review miss. Do not accept the wide `selected` object and pick fields off it.

- [ ] **Step 1: Write the failing minimization tests.** Assert each builder's output serializes to a document containing none of the forbidden identifiers, using a deep scan over the serialized JSON against a fixture whose every private value is a recognizable sentinel. Assert `aliasMap` is absent from all three. Assert the byte size is bounded by `PATTERN_INPUT_MAX_BYTES` and that exceeding it is a typed refusal, not a truncation.
- [ ] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/services/pattern-packet.test.ts

- [ ] **Step 3: Implement the three builders.** Deterministic key order so the same packet yields identical bytes across calls — the artifact hash depends on it.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add minimizing Pattern provider packet builders`

### Task 3: Add the Pattern prompt module and derived strict schemas

**Files:**

- Create: `apps/api/src/services/pattern-prompt.ts`
- Create: `apps/api/src/services/pattern-prompt.test.ts`

Three system policies, three request builders, three output-schema names, the closed verifier finding vocabulary (Q4), and the strict-schema derivation. Exports `PATTERN_PLANNER_PROMPT_VERSION`, `PATTERN_WRITER_PROMPT_VERSION`, `PATTERN_VERIFIER_PROMPT_VERSION` as compiled constants.

Schemas are **derived at module load** from the normative `contracts/m7` documents by stripping the two keywords OpenAI strict mode does not support — not checked in as a second copy. A second copy is a contract that drifts silently.

- [ ] **Step 1: Write the failing prompt and derivation tests.** Assert each derived schema is the contract schema minus exactly the unsupported keywords, with every `required` and every `additionalProperties: false` preserved. Assert the request shape: exact model, reasoning effort, `max_output_tokens`, `store: false`, no background, no tools, no browsing/file-search/code/MCP fields, and `text.format` of type `json_schema` with `strict: true`. Assert prompt-injection resistance: ontology rule text and packet values that read as instructions cannot alter system policy, schema, tools, model, or request fields.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement policies, builders, derivation, and the closed finding vocabulary.** Record the Q4 decision in a module comment: the list lives here until a live corpus stabilizes it.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add Pattern prompt policies and derived strict schemas`

### Task 3a: Add the writer correction path

**Files:**

- Modify: `apps/api/src/services/pattern-packet.ts`
- Modify: `apps/api/src/services/pattern-packet.test.ts`
- Modify: `apps/api/src/services/pattern-prompt.ts`
- Modify: `apps/api/src/services/pattern-prompt.test.ts`

§13.5's retry is not a bare re-send. A deterministic or semantic rejection produces a **closed correction document** — finding codes, affected chapter and section keys, the policy rule violated, and the instruction to preserve the frozen plan and evidence assignments — and the writer is called again with it. §14.5 supplies the other half: a semantic rejection returns here rather than re-running the verifier on unchanged prose.

The load-bearing constraint is what the correction document must **not** contain: rejected prose is never echoed into the correction prompt. Nor is the verifier's rationale text, which is prose about prose. The document carries codes, keys, and rule identifiers only.

- [ ] **Step 1: Write the failing correction-document tests.** Assert the builder emits only codes, chapter/section keys, and rule ids — prove it with a rejected candidate whose every sentence is a recognizable sentinel, and a deep scan showing no sentinel survives into the correction document or the rebuilt writer request. Assert the frozen plan and evidence assignments are carried through unchanged. Assert the writer may rephrase and reorganize sections within a chapter but cannot change chapter membership, chapter count, omitted features, or ontology authorization (§13.5).
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement the correction document builder and correction prompt variant.**
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add the Pattern writer correction document and prompt`

---

## Phase B: The provider boundary

### Task 4: Add the OpenAI Pattern publisher

**Files:**

- Create: `apps/api/src/services/openai-pattern-publisher.ts`
- Create: `apps/api/src/services/openai-pattern-publisher.test.ts`
- Modify: `apps/api/test/mock-calc-service.ts`

The provider boundary for all three passes: headers, one `AbortController`, one fetch, hash-before-parse, the ordered post-200 gauntlet, typed failures. The gateway route is a required constructor parameter, never read from `env` here, exactly as `createOpenAiReadingPublisher` now takes it — a default would let a new call site route around the gateway by saying nothing.

Send the same three `cf-aig-*` headers the reading adapter pins, for the same three reasons: `collect-log: false` because gateway logs store prompt and response verbatim and payload storage defaults to on, `max-attempts: 1` because a gateway retry makes one delivery into up to five calls the usage ledger counts as one, and `skip-cache: true` because a cache hit gives two Patterns one `provider_response_hash`. See the AI Gateway integration section for the verification of each against the Cloudflare source, and for the headers that must never be sent.

- [ ] **Step 1: Write the failing adapter tests.** One fetch maximum per pass. Hash computed over the exact response bytes before parsing, then the bytes discarded. Failure mapping: timeout/network/429/retryable-5xx to `publisher_unavailable`, 401/403 to `publisher_auth_failed`, model-not-found to `publisher_model_unavailable`, refusal part to `publisher_refused`, malformed or incomplete output to `publisher_output_invalid`. No provider text, header, URL, or exception message reaches a returned detail or a log.

  **Gateway-layer classification.** When a route is configured, a `429` from a gateway rate or spend limit and a `401` from a missing or bad `cf-aig-authorization` must classify distinctly from their provider-originated twins, and the safe-log arm must record which layer refused. Assert that a gateway spend-limit `429` is not reported as a provider outage — the remedies differ, and the spend-limit case means no provider call happened at all.

  **Invariant assertions on response headers.** Assert `cf-aig-cache-status` never indicates a hit — this is the runtime check behind `skip-cache: true`, and the condition it guards is two Patterns sharing one `provider_response_hash`. Assert a present `cf-aig-dlp` header is treated as a terminal misconfiguration rather than an acceptable response, since it proves DLP is inspecting payloads the runbook says it must not. Assert the three `cf-aig-*` headers are present with a route and absent without one. Assert the **forbidden headers are absent on every request, with and without a route**: `cf-aig-metadata`, `cf-aig-request-timeout`, `cf-aig-retry-delay`, `cf-aig-backoff`, `cf-aig-cache-ttl`, and `cf-aig-cache-key`. Write this as an allowlist assertion over the outgoing header names rather than six negative checks, so a header added later fails the test by default. Assert the gateway URL is `…/openai/responses` and never `…/openai/v1/responses`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement the three pass methods.**
- [ ] **Step 4: Extend the hermetic mock.** `mock-calc-service.ts` already routes `AI_GATEWAY_HOST`; add the Pattern pass scenarios keyed by request id or scenario header. Unknown hosts keep failing closed.
- [ ] **Step 5: Run the lane and typecheck.**
- [ ] **Step 6: Commit.** `api: add the OpenAI Pattern provider adapter`

### Task 5: Add the PatternPublisher interface and two factories

**Files:**

- Modify: `apps/api/src/services/pattern-publisher.ts`
- Modify: `apps/api/src/config.test.ts`
- Create: `apps/api/src/services/pattern-publisher.test.ts`

Add the interface, `createOpenAiPatternPublisher`, and `createSyntheticPatternPublisher` wrapping the existing `buildDeterministicPlan` (`packages/pattern-engine/src/synthetic.ts:30`), `buildDeterministicWriterOutput` (`:113`), and the module-local `evaluateSemanticVerdict` (`pattern-execute.ts:525`). The `PATTERN_SEMANTIC_FORCE_REJECT` escape moves into the synthetic implementation and keeps its `AUTH_STUB=1` condition.

    export interface PatternPublisher {
      plan(input: PlannerInput, options: PassOptions): Promise<PassResult<PatternPlan>>;
      write(input: WriterInput, options: PassOptions): Promise<PassResult<PatternWriterOutput>>;
      verify(input: VerifierInput, options: PassOptions): Promise<PassResult<PatternSemanticVerdict>>;
    }

    export interface PassOptions {
      requestId: string;
      timeoutMs: number;
      pin: PatternPublisherPin;
    }

- [ ] **Step 1: Write the failing interface and configuration tests.** Include the **Q3 regression test**: `checkSecureConfig` refuses `PATTERN_PUBLISHER=synthetic` outside development, so a `constrained_model` document authored by the stand-ins cannot exist in a reader-serving environment. Add the gateway refusals for the Pattern path — a half-configured pair is `publisher_not_configured`, never a fallback to the direct origin. Add the **§14.2 verifier-independence refusal**: `resolvePatternPublisherConfiguration` rejects a configuration where `OPENAI_PATTERN_VERIFIER_PROMPT_VERSION` equals `OPENAI_PATTERN_WRITER_PROMPT_VERSION`. Today the two differ only by the accident of two constants (`pattern-publisher.ts:25,31`); this makes the separation a checked relationship, so one model configuration cannot become sole author and judge without the deployment refusing.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement both factories.** Comment the synthetic factory with the Q3 decision and its enforcement line.
- [ ] **Step 4: Run the lane and typecheck.**
- [ ] **Step 5: Commit.** `api: add the Pattern publisher interface and two factories`

### Task 5a: Make the provider credential model explicit

**Files:**

- Modify: `apps/api/src/services/reading-publisher.ts`
- Modify: `apps/api/src/services/openai-reading-publisher.ts`
- Modify: `apps/api/src/services/openai-pattern-publisher.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/wrangler.toml`

**Requires sign-off, and touches the shipped reading adapter.** Today "the Worker holds the provider key" is an unstated assumption compiled into both adapters. The operator's gateway stores the key, which makes that assumption false and the transmitted key decorative. Replace the assumption with a declared credential mode.

    export type ProviderCredentialMode =
      | { source: "worker"; apiKey: string }      // Authorization: Bearer <key>
      | { source: "gateway_stored"; alias: string }; // no Authorization header; cf-aig-byok-alias

Resolution rules, all enforced in `resolvePublisherConfiguration` so a wrong combination is a `503` on the next request rather than a runtime surprise:

- `gateway_stored` without a configured gateway route is refused. A stored key only exists behind a gateway.
- `gateway_stored` with `OPENAI_API_KEY` present is refused rather than tolerated. Accepting both is what creates the rotate-and-nothing-happens illusion; the refusal message must say the gateway holds the key.
- `worker` mode keeps today's behavior exactly, so the direct path and the existing reading rollout are unaffected.
- The alias is pinned explicitly and sent as `cf-aig-byok-alias`, never left to the implicit `default`.

- `gateway_stored` with no `AI_GATEWAY_TOKEN` is refused, because BYOK requires an authenticated gateway. Discovering this as a 401 mid-generation would misreport a configuration error as a provider auth failure.

`responsesUrlFor` and the `AI_GATEWAY_ACCOUNT_ID`/`AI_GATEWAY_ID` validators are **unchanged** — with no custom domain, the shipped id-path URL builder is exactly right for this deployment. This task is the credential mode only.

- [ ] **Step 1: Write the failing credential tests.** Assert `gateway_stored` sends **no** `authorization` header and does send `cf-aig-byok-alias`; assert `worker` mode produces a byte-identical request to today's. Assert each refusal above with its message. Assert `responsesUrlFor` still produces the direct origin and the id-path gateway URL and is otherwise untouched.
- [ ] **Step 2: Run and confirm failure.**

      npm exec -w @patternlike/api -- vitest run src/config.test.ts src/services/openai-reading-publisher.test.ts src/services/openai-pattern-publisher.test.ts
- [ ] **Step 3: Implement the credential mode.** The reading adapter changes shape here; its existing suite must still pass unchanged in `worker` mode.
- [ ] **Step 4: Run both adapter lanes, config, and typecheck.**
- [ ] **Step 5: Commit.** `api: declare the provider credential mode`

---

## Phase C: Rewiring the stage machine

### Task 6: Rewire the four edit points and move the budget

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`

Four edit points, and nothing else in the file changes semantics:

1. `:637-640` — the fail-closed guard becomes publisher selection. The gateway route resolves before this point; a half-configured gateway is a terminal `publisher_not_configured`.
2. `:648` — `buildDeterministicPlan(...)` becomes `publisherImpl.plan(...)`. `validatePatternPlan` at `:649` stays verbatim.
3. `:685` — `buildDeterministicWriterOutput(...)` becomes `publisherImpl.write(...)`. `validatePatternCandidate` at `:686` stays verbatim.
4. `:717` — `evaluateSemanticVerdict(env, writer)` becomes `publisherImpl.verify(...)`.

Then move `consumePatternProviderCallBudget` from stage entry to immediately before the fetch, so a delivery that never reaches the provider never spends a unit. This is **conformance to §25.3** — "the reservation is atomic and consumed immediately before each provider call" — not an optimization; charge-at-stage-entry is the current deviation. Note it is **three** call sites, one per stage class (`:643`, `:670`, `:701`), not one — each moves independently and each must keep charging exactly once. §25.3 also fixes the failure semantics: failed, timed-out, and rejected responses still consume a unit, and retries are never refunded. Give artifact identity an attempt component, and compute every hash advanced into D1 over the bytes R2 actually committed — so a provider success followed by a failed D1 advance converges on the first response rather than a second one.

- [ ] **Step 1: Write the failing rewiring tests.** An `openai` pin reaches the adapter instead of failing closed. A synthetic pin still produces the deterministic document in development. A delivery that fails eligibility or ontology recheck spends no budget. A provider success whose D1 advance fails, replayed, converges on the first artifact hash.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Apply the four edits and the budget move.** Touch nothing on the load-bearing list in Global Constraints.
- [ ] **Step 4: Run the Pattern lane and typecheck.**
- [ ] **Step 5: Commit.** `api: wire the Pattern stage machine to the publisher interface`

### Task 7: Derive provenance from the pin that ran

**Files:**

- Modify: `apps/api/src/services/pattern-execute.ts`
- Modify: `apps/api/src/services/safe-log.ts`

`compact_provenance.provider` and `model_family` are the hardcoded literals `"OpenAI"` and `"gpt"` at `pattern-execute.ts:773-774`. Derive both from the publisher pin that actually ran, so stored provenance names the model that wrote the prose. Add the two new closed safe-log arms with their `pass` field — the attribution mechanism the Q6 decision relies on.

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

**Requires Q1 sign-off.** Raise `MAX_STAGE_CLAIMS` from 8 to 16 (Q5) — after Task 6's budget move, not before. Widen `writer_attempts_max` to `2 | 3` and have the enqueuer write `3` (Q1). Leave `planner_attempts_max` and `verifier_attempts_max` at literal `2`.

- [ ] **Step 1: Write the failing constant tests.** A stored dev-era command carrying `writer_attempts_max: 2` still decodes through `isPatternCommand`. A newly frozen command carries `3`. Claim churn up to 16 is permitted while spend stays bounded by `PATTERN_DAILY_PROVIDER_CALL_LIMIT`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Apply the constants.**
- [ ] **Step 4: Run the Pattern lane and typecheck.**
- [ ] **Step 5: Commit.** `api: adopt the resolved Pattern attempt and claim ceilings`

### Task 8a: Bring the provider usage ledger into conformance with §25.3

**Files:**

- Create: `db/d1/0008_pattern_stage_class_usage.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/src/db/pattern-provider-usage.ts`
- Modify: `apps/api/test/apply-migrations.ts`
- Modify: `apps/api/test/helpers.ts`

**Requires Q6 sign-off.** §25.3 requires the ledger to record used calls by stage class; `pattern_provider_daily_usage` has one undifferentiated `used_calls` column. Add bounded per-stage-class counters beside it. `used_calls` remains the total the shared ceiling is enforced against, so the ceiling semantics §25.3 also specifies are unchanged.

Unlike M0's edit-in-place policy, `0007` is applied to production (ledger entry, commit `ff23d00`), so this is a forward-only `0008`. The table is empty in every environment today, which is why this lands now rather than after `internal`.

- [ ] **Step 1: Write the failing ledger tests.** Each pass increments its own counter and the shared total. The shared ceiling is still enforced against the total. Existing rows — none in practice, but prove it — default to zero counters without violating the `CHECK (>= 0)` constraints.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Write the migration and update the reservation helper.** Record the change in `MIGRATIONS.json` with its rationale. Add the table to the FK-ordered delete list in `test/helpers.ts` if it is not already there, or it will leak rows between suites.
- [ ] **Step 4: Run the Pattern lane, the contract validator, and typecheck.**

      npm exec -w @patternlike/api -- vitest run
      npm run test:contracts
      npm run typecheck -w @patternlike/api

- [ ] **Step 5: Commit.** `db: record Pattern provider usage by stage class`

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

- Create: `docs/deploy/openai-pattern-rollout.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full gate.**

      npm run typecheck
      npm test
      npm run build
      python contracts/validate_schemas.py

  Expected: all exit 0, and `contracts/m7` proven byte-identical — this plan expects no contract edit.
- [ ] **Step 2: Write the rollout runbook.** Transcribe the design's ten ordered gates, each with its evidence requirement and stop condition, and an empty ledger table. Carry the design's worst-case spend requirement verbatim: 14 provider attempts per Pattern × pinned token bounds × current model rates × maximum new Patterns per UTC day, against `PATTERN_DAILY_PROVIDER_CALL_LIMIT`, approved in writing before any non-`off` rollout.

  Include an AI Gateway subsection covering: that the pair is optional and empty is the shipped state; that the gateway token needs `Run` permission and is **account-scoped**, so it reaches every gateway in the account including any BYOK stored keys; that the gateway must be named explicitly rather than left as `default`, which auto-creates one; that gateway spend limits may be set as a backstop but never as a substitute for the §25.3 ledger; and — stated as a consequence to accept before enabling — that **Zero Data Retention does not apply to this BYOK path**, that ZDR and logging are separate controls, and that `cf-aig-collect-log: false` is consequently the only thing keeping prompts and readings out of gateway storage, which is durable and has no automatic expiry. The per-request log view being empty for Pattern traffic is the designed outcome, not an incident.

  The subsection must carry an explicit **dashboard-state checklist**, because these are settings no Worker test can observe: Guardrails **off**, DLP **off**, no fallback configuration, and the gateway's own logging setting recorded. Guardrails and DLP each route the reader's packet and generated prose through an additional inspecting model, and Guardrails' `S6`/`S11` categories are live false-positive risks for psychological-timing prose. Record the verification of each as a gate, not an assumption.
- [ ] **Step 3: Record the invariants that span files in `CLAUDE.md`.** The four edit points, the derived-not-copied schema rule, the structural minimization guarantee, and the Q1/Q3 decisions with their enforcement lines.
- [ ] **Step 4: Commit.** `docs: add the Pattern adapter rollout runbook and invariants`

---

## Dependency and checkpoint map

    Task 1 (shared boundary) ─┬─> Task 4 (adapter) ──> Task 5 (interface) ──> Task 5a (credential mode) ──> Task 6 (rewire) ─┬─> Task 7 (provenance)
    Task 2 (packet) ──────────┤                                                                                              ├─> Task 8  (constants, needs Q1)
    Task 3 (prompts) ─────────┤                                                                                              └─> Task 8a (ledger 0008, needs Q6)
    Task 3a (correction) ─────┘
                                                                        Task 6 + 7 + 8 + 8a ──> Task 9 (integration) ──> Task 10 (gate + runbook)

**Checkpoints.**

- After Task 1: the reading publisher's behavior is unchanged and its test file has no diff.
- After Task 3: no provider call exists yet; Phase A is pure input construction and is fully testable offline.
- After Task 5: `pattern-execute.ts` is still untouched and production behavior is byte-identical.
- After Task 6: an `openai` pin reaches a provider in test only; `PATTERN_AI_ROLLOUT` is still `off` everywhere.
- After Task 10: the code is a rollout candidate. It is not deployed, no secret is set, and no rollout has moved.

**Sign-off gates.** Q1 blocks Task 8. Q6 blocks Task 8a, and its two outcomes are a `0008` migration or a recorded amendment to §25.3 — not a silent third option. Task 5a needs sign-off because it modifies the already-shipped reading adapter, making it the one task in this plan that changes live-path code before Task 6; the credential mode itself is settled — the gateway stores the key. Q3 blocks Task 5's regression test only in the sense that reversing the decision would require a `schema_version` bump and a much larger plan. All decisions are recorded above with their evidence; none may be reversed silently during implementation.

**A note on sourcing.** The adapter design's open questions cite the M7 design by section, and its summaries are not always the whole of what those sections say. Q2 was largely settled by §14.1 and carried an unmentioned enforceable requirement in §14.2; Q1's attempt count came with a correction-document protocol in §13.5; Q6 was a conformance gap against §25.3 rather than an open choice. Read `2026-08-14-ai-generated-pattern-design.md` at the cited section before implementing any task that leans on one, and treat `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` as normative above both design documents.
