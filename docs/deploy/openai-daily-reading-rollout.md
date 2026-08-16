# OpenAI daily reading publisher — production rollout

**Status:** not started. Every gate below is separately authorized at execution
time, and nothing in this file has been performed.

**Companion documents:** `docs/deploy/api-production.md` for the deployed Worker,
`docs/superpowers/specs/2026-08-10-openai-daily-reading-publisher-design.md` for
the approved design, and
`spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` for the
normative product contract.

Every Wrangler command below names its configuration and environment explicitly.
A bare `wrangler` command in this repository validates the development block, and
a production gate run against the development block proves nothing.

---

## Gate 0 — the code is a candidate

Local only. Nothing remote.

```powershell
npm run typecheck
npm test
npm run build
python contracts/validate_schemas.py
```

All exit 0, all three contract manifests valid, `contracts/m0` and
`contracts/m3` proven unchanged. `READING_V5_ROLLOUT` is `off` in both Wrangler
blocks and `[env.production.triggers] crons` is `[]`.

**Stop condition:** any failure. Do not proceed to a remote gate on a candidate
that does not build locally.

---

## Gate 1 — measure production before touching it

```powershell
wrangler d1 export patternlike-ops --config apps/api/wrangler.toml --env production --remote --output backup-pre-0003.sql
wrangler d1 time-travel info patternlike-ops --config apps/api/wrangler.toml --env production
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT (SELECT COUNT(*) FROM content_releases) AS releases, (SELECT COUNT(*) FROM daily_readings) AS readings, (SELECT COUNT(*) FROM reading_sources) AS sources, (SELECT COUNT(*) FROM reading_feedback) AS feedback"
```

Record the backup path, the time-travel bookmark, and all four counts in the
migration ledger before anything else happens.

**Expected:** all four counts are zero. Production has never had a content
release, so it has never published a reading.

**Stop condition — hard.** If `daily_readings`, `reading_sources`, or
`reading_feedback` is non-empty, **stop here and do not apply 0003**. Those rows
are envelope-encrypted and AAD-bound to their own table, column, and record; the
migration drops and recreates their tables, and generic SQL cannot carry them
across. A non-empty count means opening a separately authorized
export/decrypt/re-encrypt/copy design with its own verification plan. There is no
version of this runbook in which that path is improvised.

---

## Gate 2 — deploy dual readers with generation disabled

The Worker must be able to read both stored formats *before* the schema changes,
so that a rollback at any later gate lands on code that understands what is in
the database.

```powershell
npm run deploy:api
```

`READING_V5_ROLLOUT` stays `off`. Verify after upload:

- `/health` answers;
- an authenticated `GET /v1/readings/today` behaves exactly as it did;
- `run_worker_first` is still `["/health", "/v1/*", "/internal/*"]`;
- the Queue consumer still has `max_batch_size = 1`;
- production cron is still `[]`.

**Stop condition:** any product regression. Roll back the Worker; the schema has
not moved.

---

## Gate 3 — apply the forward-only migration

```powershell
wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Prove it, and record every answer in the ledger:

```powershell
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reading_provider_daily_usage','daily_readings','reading_sources')"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA quick_check"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT COUNT(*) AS guards FROM assertion_probe"
```

**Expected:** the tables exist with their final names, `foreign_key_check`
returns zero rows, `quick_check` is `ok`, and `assertion_probe` is empty.

**Stop condition:** the migration aborts on its own preflight if any dependent
reading row exists. That is the abort working. Return to Gate 1.

---

## Gate 4 — the calculation service

The Worker cannot generate anything until the daily-sky endpoint is live. Deploy
it from the repository root, never from inside the app directory:

```powershell
fly deploy --config fly.toml
```

Before deploying, diff `app`, `primary_region`, and the `[[http_service.checks]]`
block against the committed file: Fly Launch has rewritten this configuration
once before, pointing the calculation Dockerfile at the web app's name.

Verify: the deployed image digest matches what was built; `/health` answers; and
an authenticated synthetic `POST /v1/daily-sky` — invented coordinates, no real
account — returns ordered facts with an anchor and a lunar phase.

**Stop condition:** any check failing. No Worker V2 call may be made against an
unverified calculation service.

---

## Gate 5 — model preflight, secret, and configuration

```powershell
$env:OPENAI_API_KEY = "<the authorized key>"
npm run publisher:model:verify -w @patternlike/api
```

**Expected:** the configured model exists on the authorized account. This is the
gate that establishes the pinned id is real for the key that will use it, and it
repeats for every later model change.

Then, and only then:

```powershell
wrangler secret put OPENAI_API_KEY --config apps/api/wrangler.toml --env production
```

Set the publisher variables in `[env.production.vars]` and deploy them.
`READING_DAILY_PROVIDER_CALL_LIMIT` has no default: production configuration is
invalid until an operator approves a number.

**Record before approving it:** the approved ceiling, the current published price
per input and output token for the exact model, and the arithmetic giving the
worst-case daily spend at that ceiling with the configured request and output
maxima. A ceiling nobody has costed is not an approved ceiling.

The current candidate configuration sets `OPENAI_READING_MAX_OUTPUT_TOKENS=4000`.
For the Responses API this ceiling includes reasoning tokens and visible output
tokens together; it is therefore both a reliability control and the output-side
term in the spend calculation. Record the arithmetic as the approved daily call
limit multiplied by the worst-case input charge plus 4,000 times the current
output-token price. This repository change does not constitute that operator
approval.

These variables are set now but are **not yet load-bearing**: while
`READING_V5_ROLLOUT` is `off`, `resolvePublisherConfiguration` returns before it
reaches the required-value block, so a probe here would answer 200 whether or not
the ceiling is set. That is the guard behaving correctly, not a fault — do not
read it as one. The refusal is proven two ways instead: Gate 0's `npm test`
covers it directly (`config.test.ts` asserts an enabled rollout with the limit
unset is refused), and Gate 7 exercises it live at the moment the rollout leaves
`off`.

Separately configure and deploy the production Queue consumer at
`max_concurrency = 4`.

### Optional — route through Cloudflare AI Gateway

Off by default. `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_ID` ship empty in both
`wrangler.toml` blocks, and empty means the adapter calls `api.openai.com`
directly, which is the launch decision the M5 design recorded and platform spec
v0.5 §16.3 left open. Filling both in is the entire switch: the frozen publisher
pin does not name a route, so commands frozen before and after describe the same
prose, and nothing about the request body, the model, or the response parsing
changes.

```powershell
# Both, or neither. One without the other is 503 configuration_error on every
# path — deliberately, because falling back to direct calls would look like a
# working deployment with an empty gateway dashboard.
#   AI_GATEWAY_ACCOUNT_ID = "<32 lowercase hex>"   # wrangler whoami
#   AI_GATEWAY_ID         = "<gateway id>"
# Only if the gateway has Authenticated Gateway on:
wrangler secret put AI_GATEWAY_TOKEN --config apps/api/wrangler.toml --env production
```

`AI_GATEWAY_TOKEN` is the `cf-aig-authorization` credential, not a provider key —
the OpenAI key still rides `Authorization` for the gateway to forward. Setting it
without the two ids is a misconfiguration, not a no-op, and is refused.

**If a provider key is stored in the gateway (BYOK), this procedure bypasses it.**
Cloudflare's documented credential precedence is *request key → BYOK → Unified
Billing*: a provider `Authorization` header on the request is forwarded unchanged
and the stored key is **not consulted**. The Worker as shipped always sends that
header, so a stored key configured in the dashboard does nothing while this
procedure is followed — the deployment looks BYOK and is not. Using the stored
key requires omitting `Authorization`, which the current adapter cannot do; that
is the subject of Task 5a in
`docs/superpowers/plans/2026-08-15-openai-pattern-adapter.md`, and it is a
single-version cutover — gateway ids, key alias and `AI_GATEWAY_TOKEN` become
present while `OPENAI_API_KEY` becomes absent in the same Worker version, because
either intermediate combination is refused on every request. Do not attempt it by
deleting the secret first.

What the adapter pins per request, overriding whatever the gateway dashboard
says, because request-level `cf-aig-*` headers win:

| Header | Value | Why it is not left to the dashboard |
| --- | --- | --- |
| `cf-aig-collect-log` | `false` | Gateway logs store the prompt and the response verbatim. Platform spec v0.2 §10 disables logging for private synthesis; the prompt is the reader's decrypted context and the response is their reading. |
| `cf-aig-max-attempts` | `1` | A gateway retry makes one queue delivery up to five provider calls that `reading_provider_daily_usage` counts as one — the ledger the approved ceiling above is computed from. |
| `cf-aig-skip-cache` | `true` | A cache hit would give two readings one `provider_request_id` and one `provider_response_hash`, which is stored evidence for a generation that did not happen. |

**Consequence to accept before enabling:** with logging off, the gateway's
per-request log view is empty for reading traffic. Rate limiting, spend limits,
fallbacks, and DLP still apply; per-request prompt/response inspection does not.
`safeLog` and `ProviderMetadata` remain the record, as the spec assigns. If you
want metadata-only gateway logs instead — token counts, cost, latency, no
payloads — that is `cf-aig-collect-log-payload: false` in place of
`cf-aig-collect-log` in `openai-reading-publisher.ts`, and it is a privacy
decision that belongs to whoever owns the spec sentence, not to the adapter.

**Stop condition:** a preflight failure, or an unapproved ceiling.

---

## Gate 6 — the versioned quality gate

```powershell
$env:OPENAI_API_KEY = "<the authorized key>"
npm run publisher:eval:live -w @patternlike/api
```

**Expected:** exit 0, every synthetic profile publishable, qualitative findings
within threshold. The command prints ids, verdicts, input/output/reasoning token
counts, and failure codes only; the whole report is safe to paste into the
rollout record, and it should be. A provider response stopped at the configured
ceiling is reported as `provider.max_output_tokens_exhausted`, not as malformed
candidate JSON.

The corpus refuses to run when its recorded gates do not match the deployed
model, reasoning effort, response-token ceiling, prompt, selection, validation,
and evaluation-policy versions. **This gate repeats in full before every later
model, prompt, selection-policy, or validation-policy change**, along with the
Gate 5 model preflight. The single end-to-end canary below does not substitute
for it.

Then run the synthetic end-to-end canary: one internal account with invented
birth data, through calculation and generation to publication, proving the whole
path before a real reader is on it.

**Stop condition:** any hard failure, or a qualitative regression past threshold.

---

## Gate 7 — internal enablement

First prove the fail-closed budget guard, now that it is load-bearing: with
`READING_DAILY_PROVIDER_CALL_LIMIT` unset and the rollout leaving `off`,
`checkSecureConfig` must refuse every request with `503 configuration_error`.
Restore the approved ceiling before continuing.

Then set `READING_V5_ROLLOUT = internal` and deploy. This admits authenticated
internal reservations and nothing public.

Run the existing bounded authenticated recovery sweep so anything paused by the
kill switch resumes, then prove one complete consented internal flow:
consent granted, command frozen, job claimed, provider called once, candidate
validated, reading published, evidence readable, and the three provenance layers
correct in the interface.

**Stop condition:** a configuration guard that does not refuse, or anything
short of one complete flow.

---

## Gate 8 — first open

Set `READING_V5_ROLLOUT = first_open` and deploy. Readers now generate on demand.

Observe for a bounded period before proceeding: queue age, generation latency,
attempts, provider and validation failure classes, token counts, and
call-budget consumption.

**Stop condition:** sustained provider failures, a validation-failure rate
outside what the corpus predicts, or budget consumption inconsistent with the
observed reader count.

---

## Gate 9 — the load probe

Before any scheduler runs, measure what it would do:

```powershell
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT COUNT(*) AS due_now FROM users WHERE status='active' AND next_due_at IS NOT NULL AND next_due_at <= datetime('now')"
wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT COUNT(*) AS unseeded FROM users WHERE status='active' AND next_due_at IS NULL"
```

Compare the due-row count against the per-invocation dispatch cap and the
approved daily call ceiling. A backlog larger than the cap is not a reason to
raise the cap; it is a reason to understand why the cursors are where they are.

---

## Gate 10 — the scheduler

A separate configuration change, deployed on its own:

```toml
[env.production.triggers]
crons = ["*/15 * * * *"]
```

Then set `READING_V5_ROLLOUT = hybrid`.

The quarter-hour cadence is required because IANA zones include quarter- and
half-hour offsets, not because generation needs to run that often.

**Stop condition:** queue age growing across invocations, or call-budget
consumption approaching the ceiling before the day ends.

---

## Monitoring

Bounded to: generation counts; queue age; generation latency; job attempts;
provider failure class; validation failure class; input and output token counts;
model and prompt versions; call-budget consumption; and hash-only integrity
fields.

Alert on: growing queue age; sustained provider failures; a validation-failure
rate outside the corpus's prediction; generation latency regression; unexpected
token growth; and call-budget consumption ahead of schedule.

**Prohibited, without exception:** logging a prompt, a context packet, a birth
value, a reader's own text, or generated prose. The safe logging boundary is the
only thing in the Worker that may write a log line, and it takes an event name
and hashes.

---

## Rollback

Rollback is bounded, and the bound is the point.

1. Set `READING_V5_ROLLOUT = off` and deploy. New reservations stop; already
   queued work pauses durably in D1 rather than burning platform retries.
2. Remove the production cron trigger and deploy.
3. If the Worker itself is at fault, deploy only a version that understands the
   migrated schema.

Rollback does **not**: rewind D1, delete published readings, select a different
model, relax validation, or reactivate the editorial-release fallback. Readings
already published stay readable. Readers without a valid reading see the honest
unavailable state, which is the designed behavior and not an incident to be
papered over with standing copy.

---

## Ledger

Record for each gate: the date and time in UTC, the operator, the exact command,
the exact output or count, and the verdict. A gate without a recorded output was
not run.

| Gate | Date (UTC) | Operator | Result |
| --- | --- | --- | --- |
| 0 candidate | | | |
| 1 measure | | | |
| 2 dual readers | | | |
| 3 migration | | | |
| 4 calculation service | | | |
| 5 model, secret, ceiling | | | |
| 6 corpus and canary | | | |
| 7 internal | | | |
| 8 first open | | | |
| 9 load probe | | | |
| 10 scheduler | | | |
