# Handoff — Pattern generation on production

**Date:** 2026-08-23; operational state updated 2026-08-24
**Goal as given:** generate a Pattern on production.
**Status (updated 2026-08-24):** the original provider blocker has an approved,
implemented, and deployed replacement. The durable Codex control plane and
secrets are live with both product rollouts off. A real local subscription call
and an authenticated production idle poll passed. Installing the always-on
runner on the explicitly approved existing DigitalOcean droplet, activating
one ontology, and generating the Pattern canary remain.

Current operations are in
[`codex-production-provider.md`](./codex-production-provider.md). The direct
Worker-to-ChatGPT experiment described later in this historical handoff has
been removed, including its Worker credential fields and streaming adapter.
Do not use those historical instructions.

## 0. Current production state — 2026-08-24

- `npm run typecheck`, `npm test`, and `npm run build` passed across all
  workspaces. The API gate passed 105 files / 1,816 tests; the web gate passed
  21 files / 214 tests; all contract and migration smoke checks passed.
- A real `codex exec` invocation through the compiled runner wrapper succeeded
  with schema-valid output, a provider request id, and positive input/output
  token usage. No prompt, response, event stream, or credential was recorded.
- The production D1 backup checksum before migration was
  `sha256:7bca9cc17becb566984c4a35c3ef25eca8897090a78a69f1ac21e2c350b6076b`.
  Migration `0013_codex_provider_jobs.sql` was the only pending migration and
  applied successfully. `PRAGMA foreign_key_check` stayed empty; users `4`,
  ontology runs `16`, Pattern jobs `0`, and Pattern documents `0` were
  unchanged. `codex_provider_jobs` is empty.
- Worker code version `9313dde3-bb8b-4bde-b910-30e7bef0cae0` fixed the static
  asset routing so `/codex-provider/*` reaches Hono. The current deployed
  version after the two secret changes is
  `2271897b-e5a4-48c2-9f53-a5e467ee0a6a`.
- `CODEX_RUNNER_TOKEN` and `CODEX_PROVIDER_ARTIFACT_KEYRING` are present as
  Worker secrets. The shared token has a root-owned mode-0600 escrow copy on
  the operator VM; its value was never printed.
- Production health returns 200, the app shell returns 200, an invalid runner
  bearer returns 401, and an authenticated claim returns 204/empty. A compiled
  daemon smoke produced only `started`, `idle`, and `stopped` events. No Codex
  provider job or Pattern/ontology usage row was created.
- `PATTERN_AI_ROLLOUT="off"` and
  `ONTOLOGY_PIPELINE_ROLLOUT="off"`. The incumbent OpenAI publishers remain
  selected, so no reader or ontology traffic can enter Codex yet.
- The reproducible release branch adds reviewed boundary hardening and additive
  migration `0014_codex_provider_response_uploads.sql`. That migration is not
  part of the deployed version above and must be applied before deploying the
  hardened Worker; keep both rollouts off throughout the change.

The existing DigitalOcean droplet is explicitly approved as the always-on
non-AGPL runner host. The remaining host dependency is installation and an
interactive `codex login` for its dedicated unprivileged service account.
After that, follow the ontology and Pattern canaries in
[`codex-production-provider.md`](./codex-production-provider.md).

The sections below preserve the 2026-08-23 investigation as historical context.
Statements about the old direct Worker transport or its deployment state are
superseded by this section and the current runbook.

---

## 1. Historical starting point

The single fact that governs everything: **production needs a model provider
that is both funded and reachable from a Cloudflare Worker, and none of the
three currently is.**

| Provider | Funded | Reachable from Workers | Passes all three passes |
| --- | --- | --- | --- |
| OpenAI API (`gpt-5.6-sol`) | ✗ `credit_balance_exhausted` | ✓ | ✓ (proven, see §4) |
| Codex / ChatGPT subscription | ✓ | ✗ `403` Cloudflare challenge | ✓ (proven, see §4) |
| Cloudflare Workers AI | ✓ | ✓ | ✗ writer fails word counts |

The cheapest route to a Pattern on production is **add OpenAI credit**. A full
ontology pipeline run is ~83 provider calls against a 500/day ceiling. With
credit, the sequence in §6 should run start to finish.

---

## 2. Historical production snapshot

Worker version **`1aaed29c-29eb-436b-86f3-990379ce94c4`**, healthy, serving.

- `PATTERN_AI_ROLLOUT` is still `"off"` and `PATTERN_INTERNAL_ACCOUNT_IDS` is
  still `""`. Nothing about Pattern generation is switched on.
- D1 untouched: `pattern_ontology_releases` 0, pointer `NULL`,
  `content_releases` 0, `pattern_documents` 0, `pattern_generation_jobs` 0,
  `users` 4.
- What the deploy contained: the max-output-token pin raise (4000/8000/4000 →
  32000 for all three passes) and the derived regression budget. See §3.

**Nothing in §5 (the Codex and Workers AI providers) is deployed.** That work is
uncommitted in the working tree.

### Corrections to `CLAUDE.md`

Three claims there are stale and were verified false against production:

- `ONTOLOGY_PIPELINE_ARTIFACT_KEYRING` **is** provisioned on the API Worker.
- `PATTERN_ONTOLOGY_SIGNING_KEY` **is** provisioned on the signer Worker.
- Cloudflare is not exclusive: production's `CALC_SERVICE_URL` is
  `https://patternlike-calc.fly.dev` and that host is live, serving Swiss
  Ephemeris 2.10.03. The retired `patternlike-app.fly.dev` no longer resolves.

### Security item worth acting on

The `SERVICE_AUTH_TOKEN` in `apps/api/.dev.vars` **also authenticates against
production `/internal/*`**. That is how the ontology run in §4 was enqueued. If
dev and production are meant to have separate operator tokens, they do not.

---

## 3. Defects found and fixed (deployed)

**a. The planner could never succeed at its pinned ceiling.**
`OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS` was `4000` while `reasoning` is
pinned `high`. Reproduced against the live Responses API: the planner consumed
the entire 4000-token allowance on reasoning tokens and returned
`status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, with
no output text, after 55.8 s. Raised to `32000` for all three passes; the
planner then succeeded first try.

This also explains part of Gate 7B. Counting stored regression artifacts splits
the fourteen failed ontology candidates into two classes that had been recorded
as one:

| candidate | cursor | requests | responses | meaning |
| --- | --- | --- | --- | --- |
| `0.1.14` | 68 | 69 | 69 | model answered, **content** hard-gate rejected |
| `0.1.12` | 14 | 17 | 14 | **no output text** — the ceiling defect |
| `0.1.11` | 71 | 73 | 71 | **no output text** |
| `0.1.10` | 45 | 46 | 46 | content rejection |
| `0.1.9` | 2 | 3 | 3 | content rejection |

Only the second class is fixed by the pin. The content rejections are the gate
doing its job and still need candidate iteration. `0.1.14` reached cursor 68 of
~72 — the closest any candidate has come.

**b. The regression token budget silently mispriced itself.**
`ONTOLOGY_REGRESSION_MAXIMUM_OUTPUT_TOKENS` restated the Q1 ceilings as literals
(`2 * 4_000 + 3 * 8_000 + 3 * 2 * 4_000`) instead of deriving them from the
pins, so raising a pin left the budget pricing the old value and every
regression cursor rescheduled on an exhausted budget. Now derived. The cap rises
1.68M → 10.56M output tokens; actual spend rises only insofar as passes now
complete instead of truncating.

**c. Pattern pass timeouts are coupled to the ontology pipeline's claim lease.**
`consumeClaimedOntologyProviderCallBudget` (`db/ontology-provider-usage.ts:144`)
admits a reservation only while the run's remaining lease covers
`timeoutMs` plus a persistence margin. Raising `OPENAI_PATTERN_*_TIMEOUT_MS` to
`600000` makes **every** regression reservation refuse and reschedule instead of
advancing. They were deliberately left at `120000`. Do not raise them without
also raising the lease.

**d. Every 429 is treated as retryable.** `openai-responses-adapter.ts:452` maps
all 429s to `publisher_unavailable` / `rate_limited`. A
`429 insufficient_quota / credit_balance_exhausted` is permanent, so a dead
billing account burns the entire 3-attempt writer ceiling in about three
seconds. **Not fixed** — it needs a decision on how to classify quota
exhaustion.

---

## 4. What was proven, and how

**Production has no credit — measured, not inferred.** Ontology run
`oprun_ae8a9369-94e5-467c-ac19-07aa260acc54` (candidate `0.1.15`) was enqueued
against the deployed Worker. It reached `generating` and consumed generator
calls 9–13 across five attempts, every one failing, never producing a candidate
hash. Bounded by `MAX_ONTOLOGY_PIPELINE_DELIVERY_CLAIMS = 16`; it fails closed
on its own, no cleanup needed. Its configuration hash differs from earlier runs
(`sha256:dd76aa95…`) because the token pins are part of the command identity.

**The pipeline and prompts are sound.** A full local run through Codex
(`gpt-5.6-sol`) published a real Pattern —
`pat_5ec48ac43d3d8b9f8236400c30970d32`, 6 chapters, 4 signatures, 3080 words —
with **all three passes succeeding on the first attempt**: planner 114 s / 7.4 KB,
writer 393 s / 30.3 KB, verifier 175 s. Rendered output and the run log are in
`build/generated-pattern-2026-08-23.md` and `.run.log` (gitignored). So when the
writer fails under Workers AI, that is model capability, not the pipeline.

**Codex is blocked at the edge.** From workerd with valid credentials,
`chatgpt.com/backend-api/codex/responses` answers `403` with a Cloudflare
challenge page for every request — no User-Agent, the Codex CLI's, and a
browser's alike — while the identical request from an ordinary host answers
`200`. This is an access control. **Do not route around it**, including via the
Fly calc host: that would also put a personal subscription credential and
reader-facing content generation inside the AGPL-licensed component.

**Workers AI is viable as a provider.** 64 models on the account.
`@cf/openai/gpt-oss-120b` honours the real M7 planner schema including `$ref`,
`enum` and `minItems`. On a synthetic 40-alias packet (the real
`MAX_ELIGIBLE_ALIASES` ceiling) it passed coverage 4/4 runs. The alternatives are
worse: `glm-5.2` and `deepseek-v4-pro` drop features, `nemotron-3-120b` times
out.

> Note for whoever repeats the bake-off: an earlier version of it was wrong.
> Feature aliases are `^f[0-9]{3}$` and **1-indexed** (`aliasFor` in
> `packages/pattern-engine/src/selection.ts` returns `f001`). A packet built with
> `f00`-style aliases makes every model look like it is inventing ids.

---

## 5. Uncommitted work in the tree

Nothing here is deployed. `npm run typecheck` is clean across all workspaces and
the API suite was green (97 files / 1783 tests) as of the Codex provider; the
Workers AI provider was added after that and its suite has **not** been re-run.

### Codex provider — complete, tested, unusable here

`PATTERN_PUBLISHER=codex` and `ONTOLOGY_PIPELINE_PUBLISHER=codex`, with
`CODEX_AUTH_TOKEN` / `CODEX_ACCOUNT_ID` as secrets. Three things worth keeping
whatever happens to it:

- **Truthful provenance.** A Codex-authored Pattern records
  `provider: "Codex"`, not `"OpenAI"`. `provenance.provider` is a plain string
  in the frozen contract, so the honest value cost no schema bump. The
  executed-pin check stays exact, now keyed to the pin's publisher rather than
  hardcoded.
- **No configurable base URL.** `responsesUrlFor` stays total; Codex is a third
  fixed constant.
- **SSE normalisation.** Codex refuses `stream: false`, rejects
  `max_output_tokens`, and its terminal `response.completed` event carries an
  **empty** `output` array — the message arrives separately as
  `response.output_item.done`. `assembleCodexResponseBody` reassembles it before
  the existing envelope logic runs. Reading only the completed event is
  indistinguishable from a provider that returned no text.

The Workers-unreachability is documented next to `CODEX_RESPONSES_URL` in
`services/reading-publisher.ts`. 15 tests in
`src/services/codex-publisher.test.ts`.

### Workers AI provider — works up to the writer

`PATTERN_PUBLISHER=workers_ai`. New file
`src/services/workers-ai-pattern-publisher.ts`, deliberately not routed through
the Responses adapter (Workers AI is a binding, not an origin — there is no URL,
credential, or gateway to give it). `[ai] binding = "AI"` declared in both
wrangler blocks. Provenance reports
`provider: "Cloudflare Workers AI"`, `model_family: "gpt-oss"`.

Section 14.2 independence is *stronger* here than on the OpenAI path: writer and
verifier are genuinely different models (`@cf/openai/gpt-oss-120b` and
`@cf/deepseek-ai/deepseek-v4-pro-0813`) rather than one model under two prompt
versions.

Two Workers-AI-specific prompt policies were added under their own prompt
version, additive to the shared ones, leaving the OpenAI pins untouched:

- `WORKERS_AI_PLANNER_POLICY` — states the closure properties
  `validatePatternPlan` enforces but the shipped policy never spells out. Each
  live run exposed one more rule; the final set covers alias closure, mandatory
  assignment, `covered_by` validity, `uncertainty_only_chapter`, chapter
  `ontology_rule_ids` derivation, and expression-id construction. **This works —
  the planner now passes against real data.**
- `WORKERS_AI_WRITER_POLICY` — states the word bounds, which
  `toStrictProviderSchema` strips from the schema the model sees. **This does not
  work yet.**

### Where it stands, precisely

Last live run: planner passed, writer failed all three attempts on
`chapter_word_count` and `total_word_count`, with one `unauthorized_rule`. Across
runs the writer oscillates — told a chapter is too short it overshoots into
`paragraph_too_long`, and the 3-attempt Q1 ceiling runs out mid-convergence. The
last change (unshipped in effect) states the arithmetic that reconciles
`CHAPTER_WORD_MIN = 250` against `PARAGRAPH_WORD_MAX = 180`: a 250-word chapter
cannot be two paragraphs, so lengthening means adding a section. That run was
interrupted before a verdict.

**Honest read:** `gpt-oss-120b` can plan but struggles to write 4–6 chapters of
250–550 words each under a 180-word paragraph cap within three attempts. The M7
quality bar looks calibrated to a frontier model.

### Scaffolding to remove before any commit

- `apps/api/src/services/pattern-execute.ts` — **two `TEMPORARY DIAGNOSTIC`
  `console.log` blocks** at roughly lines 1134 and 1280, printing plan and
  candidate validation failure codes. They print closed codes only, no prose, but
  they must not ship.
- `apps/api/src/generate-pattern.live.ts`, `apps/api/vitest.live.config.ts`,
  `apps/api/src/corpus-ontology.live-data.ts` — the live-run harness. Useful;
  keep or delete deliberately. The live config drops the hermetic
  `outboundService` so the Worker reaches the real calc service and real
  providers, and matches `src/**/*.live.ts` so `npm test` never picks it up.
- `pattern-ontology-corpus.zip` at the repo root — pre-existing, not mine. Its
  `fragments.json` and `validate-fragments.mjs` are byte-identical to
  `pattern-corpus/`; only the three prose docs differ and the repo copies are
  newer. It adds nothing.

### The local corpus ontology

`corpus-ontology.live-data.ts` holds 48 records built from the real
`pattern-corpus/fragments.json` — propositions, prohibited claims, tensions and
counter-expressions all verbatim corpus text. It is labelled
`provenance.origin: "synthetic_internal"` because no generator ran and nothing is
signed. **It is local-only and must not be ingested into production**: it has not
been through the evaluator or the 30-fixture regression gate that all fourteen
candidates were held to.

Worth knowing: 12 of the 60 corpus fragments (every sign fragment) cannot be
mapped, because `PatternFeaturePredicate` has `body`, `aspect`, `angle`, `house`
and `accuracy` but no `sign`. They would have to attach to every position
indiscriminately. Widening the grammar is a contract change.

---

## 6. Next steps

**If you add OpenAI credit (recommended):**

1. Revert nothing. The deployed pin fix is what the pipeline needs.
2. `POST /internal/ontology-pipeline-runs` with a fresh
   `candidate_ontology_version`. `ONTOLOGY_PIPELINE_ROLLOUT` is already
   `internal` and the maintenance cron (`7,22,37,52 * * * *`) is live.
3. Expect the no-response failures to be gone. The content hard-gate rejections
   at cursors 2/45/68 are real and may still need candidate iteration.
4. On activation, deploy with `PATTERN_AI_ROLLOUT="internal"` and
   `PATTERN_INTERNAL_ACCOUNT_IDS="usr_3ca4f7c2f2498c4eab97511fc3c6ff97"`.
5. Canary signs in, grants first-use consent, `POST /v1/pattern-generations`.
6. If a provider retry backs off it will **not** self-recover: production runs
   only the ontology cron, so `sweepPatternJobs` never fires. Use
   `POST /internal/pattern-generations/:generation_id/reconcile` after
   `available_at`.

**If you want to finish Workers AI instead**, in rough order of expected value:

1. Re-run the interrupted live run to see whether the section-arithmetic rule
   closes the writer gap:
   `cd apps/api && LIVE_PATTERN_PUBLISHER=workers_ai npx vitest run --config vitest.live.config.ts --reporter=verbose --silent=false`
   (needs the calc service:
   `SE_LICENSE_MODE=agpl PORT=8080 npx tsx apps/calc-stub/src/server.ts`).
2. If it still oscillates, the honest options are a stronger writer model, or
   raising the writer attempt ceiling — which is a frozen Q1 value and a
   governance change, not a tweak.
3. Then: run the full API suite, remove the diagnostics, add tests for the
   Workers AI publisher mirroring `codex-publisher.test.ts`, and extend
   `ONTOLOGY_PIPELINE_PUBLISHER` to accept `workers_ai` so the ontology can also
   be produced without OpenAI credit.

**Before any of it reaches readers**, note that swapping the model family is a
real product decision. The whole Gate 7B/8 apparatus exists to validate that a
specific pinned configuration produces acceptable prose, and the 30-fixture
regression harness is what would have to re-approve a different one.

---

## 7. Reference

- Findings recorded in `docs/deploy/openai-pattern-rollout.md` under Gate 7B.
- Generated Pattern and run log: `build/generated-pattern-2026-08-23.md`,
  `build/generated-pattern-2026-08-23.run.log`.
- Production account `a77e479f6736120eadd99973dbeb705e`, D1 `patternlike-ops`,
  origin `https://patternlike-api-production.lfd.workers.dev`.
