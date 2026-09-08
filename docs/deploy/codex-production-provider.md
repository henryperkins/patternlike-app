# Codex production provider runbook

For the source-inspected text/image/mesh processing boundaries and the account
privacy evidence still outstanding, see
[`codex-provider-privacy-evidence.md`](./codex-provider-privacy-evidence.md)
(2026-09-06). Its local evidence does not certify current upstream account
settings or installed production configuration.

## Daily publication release identity

The [release-attestation runbook](release-attestation.md) requires additive
migration 0029 before compatible Worker runtime and actual Workers Builds CI
SHA injection on both deploy and versions-upload commands. Its durable Daily
receipt preserves observed high/xhigh job pins after provider cleanup without
changing the runner completion contract or reader-facing provider metadata.
This source port does not demonstrate production adoption.

## Current source transport and pause control (2026-09-06)

The source now runs ordinary text work through isolated `codex app-server`
turns, shared with mesh JSON authoring. Each attempt verifies CLI `0.153.3`,
ChatGPT authentication, effective configuration, frozen model/effort, and
provider-reported usage. It creates an ephemeral thread in a private temporary
directory, disables tools/MCP/skills and execution environments, rejects host
instructions and model rerouting, and treats failed local cleanup as fatal.
`CODEX_TEXT_ISOLATION_VERSION=1.0.0` identifies this transport contract. See the
[fresh Daily evaluation](./fresh-reading-evaluation.md) for a bounded fictional
provider check. This source change is not a deployment record.

`PATTERN_GENERATION_ENABLED=0` now pauses new and unfinished Pattern work while
preserving accepted reading access and deletion. Follow the
[pause and resume runbook](./pattern-generation-pause.md); a currently leased,
still-eligible response can be saved during the pause but cannot be published.
Historical `codex exec` and containment records below describe earlier releases.

## Sol reasoning and priority upgrade (2026-09-05)

The selected execution profile is `gpt-5.6-sol` with `xhigh` reasoning. The
runner passes `service_tier="priority"` and enables `fast_mode` explicitly on
every invocation (originally `codex exec`), using its existing ChatGPT login. Sol advertises the
`priority` tier as Fast in the runner account's model catalog. This requests
priority processing; the provider controls the tier actually served and may
apply its documented fallback behavior. Fast mode consumes increased usage.

Migration `0025_codex_xhigh_reasoning.sql` admits `high` and `xhigh`, preserving
every existing provider job and response-upload row. The runner accepts both;
new Daily, Pattern, and ontology commands freeze `xhigh`, while supported
legacy commands retain their original `high` effort. The M5 contract's additive
freeze amendment includes both vocabularies. Ontology regression execution and
report verification derive their reasoning profile from the frozen command,
so existing signed `high` reports keep their original configuration hash.
Model, prompt, output ceilings,
call budgets, consent checks, and ontology rollout state retain their existing
settings.

Release order: run the full local gate; install the compatible runner on the
approved host; export and rehearse a production D1 backup; apply only `0025`;
verify row preservation, indexes, foreign keys, and integrity; then deploy the
Worker that freezes `xhigh`. Verify the live Worker version, production flags,
runner health, and a content-free CLI call using the selected profile. Do not
reissue terminal user jobs or rewrite published documents as part of this
configuration upgrade.

References: [Codex speed](https://learn.chatgpt.com/docs/agent-configuration/speed)
and [API Fast mode](https://developers.openai.com/api/docs/guides/fast-mode).

**Status (reconciled 2026-08-26):** the last recorded production inventory
(2026-08-25) found migrations through `0015` applied, 124 terminal Codex provider
jobs, ontology rollout `internal` / `codex`, Pattern rollout `off`, and the runner
polling successfully. Current committed configuration instead declares Pattern
`internal` / `codex` and ontology rollout `off`. Re-query both deployed bindings
and runner health before acting; repository declarations and dated live
observations are not interchangeable. No active ontology or accepted Pattern is
recorded, and Gate 6 spend certification remains open. Neither this status nor
any later runbook edit authorizes a deployment, provider call, ontology
activation, or rollout advance.

**Migration evidence (2026-09-08):** `db/d1/MIGRATIONS.json` records 0025–0028
applied and a prospective prerequisite for 0029. The later
[0029 apply receipt](../reviews/artifacts/2026-09-07-release-attestation/production-migration-0029.json)
and [release review](../reviews/2026-09-07-release-attestation-merge.md#completed-deployment-prerequisites)
record its production apply at 2026-09-07 10:15:26 UTC. Keep that dated evidence
distinct from both the 2026-08-25 inventory above and a fresh live query.
Portrait image/mesh work is a separate runner poll after the text queue
(`CODEX_RUNNER_PORTRAITS`, `CODEX_RUNNER_MESHES`; only `"0"` or `"1"`). See
[`apps/codex-runner/README.md`](../../apps/codex-runner/README.md) for enablement
order. Committed API flags and an applied migration are not proof that the host
is polling those queues.

This runbook operates the supported Codex CLI provider for **daily readings**,
Pattern generation, and the ontology pipeline. The API Worker owns durable jobs,
budgets, validation, signing, publication, and encrypted artifacts. An approved
non-AGPL host performs inference through isolated `codex app-server` turns using its local ChatGPT
login.

Daily joined this control plane on 2026-08-27 and has no other transport: the
direct-OpenAI adapter is deleted, and `READING_PUBLISHER` accepts only `codex`.
`docs/deploy/openai-daily-reading-rollout.md` is superseded as a procedure and
retained only as dated evidence of the direct-API rollout.

The runner has no inbound port. Never copy its Codex credential store to
Cloudflare, put a ChatGPT token in Worker configuration, or place this service
on the AGPL calculation host.

**Gate 6 status:** this runbook does not assert current Codex spend
certification. Before its first durable ontology or Pattern job, obtain the
selected-provider Gate 6 written approval in
[`openai-pattern-rollout.md`](./openai-pattern-rollout.md): authorized
account/plan, 100/500 D1 call ceilings, the effective output envelope of 8k
ontology-generator, 4k ontology-evaluator, and 32k Pattern/regression
planner/writer/verifier limits, 900000-ms timeout, concurrency 1, and applicable
attempt/input limits.

## 1. Preconditions

- Repository typecheck, tests, and production dry-run build are green.
- The production D1 database and R2 bucket are healthy.
- The Pattern and ontology queues and ontology signer Worker are healthy.
- An always-on non-AGPL Linux host with Node 20+ and the supported Codex CLI is
  approved. A dedicated VM is preferred; the existing DigitalOcean droplet was
  explicitly approved for this rollout on 2026-08-24.
- The operator has Cloudflare deployment access and a secure password-manager
  record for the shared runner bearer secret.
- Both AI rollouts are `off` during migration and initial deployment.

Confirm the local CLI surface before installation:

```bash
codex --version
codex app-server --help
codex login status
```

The source requires the pinned CLI and uses ephemeral, read-only app-server
threads with a strict output schema. Confirm the installed runner matches the
tested artifact; do not infer deployment from this source description.

## 2. Verify and back up before migration

Run from the repository root:

```bash
npm run typecheck
npm test
npm run build
npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Export a dated D1 backup to an owner-only operator directory. Keep the backup
outside the repository and follow the existing production retention policy.
Record only its timestamp and checksum in the change ticket.

Read-only preflight queries should record counts for `users`,
`pattern_ontology_pipeline_runs`, `pattern_generation_jobs`, and
`pattern_documents`. Do not export provider prompts or decrypted artifacts.

## 3. Apply migration before Worker code

Migrations `0013_codex_provider_jobs.sql` and
`0014_codex_provider_response_uploads.sql` are additive and must exist before
the matching Worker code can receive traffic. The 2026-08-24 read-only audit
found both applied in production. First inspect the migration list:

```bash
npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

If `0015_ontology_pipeline_regression_evidence` is pending, do **not** run the
provider-only apply command below. Leave this section and follow ontology Gate 2
in [`openai-pattern-rollout.md`](./openai-pattern-rollout.md), which owns its
backup, prechecks, application, and compatible-Worker sequencing. Stop if any
other migration is pending.

Only in a fresh provider environment with `0013` and/or `0014` pending (or when
neither is pending, as a no-op) run:

```bash
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
```

Expected result:

- in the recorded 2026-08-24 production state, `0013` and `0014` are already
  applied; a fresh pre-provider environment applies `0013` then `0014`;
- `PRAGMA foreign_key_check` returns no rows;
- the preflight table counts are unchanged;
- `codex_provider_jobs` and `codex_provider_response_uploads` exist; record and
  compare their status counts to the preflight, with no unexpected pending or
  leased jobs; and
- uploads are consistent with retained jobs. Empty job/upload tables are
  expected only for a fresh provider environment.

Stop if any foreign-key row is returned. `0015` remains branch-pending and is
not represented as applied in this provider-only procedure.

## 4. Provision Worker secrets

Generate two independent values in an approved secret-management workflow:

- `CODEX_RUNNER_TOKEN`: 32–512 URL-safe characters, unique to this runner
  authority and not reused as `SERVICE_AUTH_TOKEN`;
- `CODEX_PROVIDER_ARTIFACT_KEYRING`: a version-1 JSON keyring containing one
  random 32-byte AES key encoded as base64url.

Store the runner token in the password manager because the same value is needed
once in the host's root-owned environment file. The artifact keyring belongs
only in the Worker secret store.

Use Wrangler's interactive prompt so values never appear in shell arguments or
history:

```bash
npx wrangler secret put CODEX_RUNNER_TOKEN --config apps/api/wrangler.toml --env production
npx wrangler secret put CODEX_PROVIDER_ARTIFACT_KEYRING --config apps/api/wrangler.toml --env production
```

Do not print either value to verify it. Confirm only that both secret names are
present in the deployment's secret inventory.

## 5. Deploy with the machine pipeline off

Before deploying, confirm the production variables contain:

```toml
ONTOLOGY_PIPELINE_ROLLOUT = "off"
PATTERN_GENERATION_ENABLED = "0"
```

Keep Pattern paused until compatible artifacts and the intended ontology are
verified. Enabling the switch does not bypass reader eligibility: an active
chart, confirmed locale, current consent, an available claim, and a serving
ontology remain necessary. A missing switch preserves the legacy enabled
behavior, so an intended pause must set it explicitly.

Deploy through the normal root command:

```bash
npm run deploy:api
```

Verify the public health endpoint, existing authenticated reads, queue health,
and that `codex_provider_jobs` remains empty. An unauthenticated request to the
runner routes must not reveal whether work exists. Keep the deployed Worker
version id in the change record.

## 6. Install the runner

Build the Node artifact on the release checkout:

```bash
npm ci
npm run build -w @patternlike/codex-runner
```

On the approved host:

1. Create an unprivileged service account whose home is under
   `/var/lib/patternlike-codex-runner`.
2. Copy the generated `apps/codex-runner/dist/` contents into a fresh release
   directory, including **`dist/package.json`**, and install its production
   dependencies on the target host. Do not copy the source workspace manifest.
   The standalone package contains bundled shared code and only public Sharp/Three
   dependencies. Keep optional dependencies enabled for Sharp's native packages:

   ```bash
   runner_release=/opt/patternlike-codex-runner/releases/VERIFIED_COMMIT
   install -d "$runner_release/dist"
   cp -R apps/codex-runner/dist/. "$runner_release/dist/"
   npm install --prefix "$runner_release/dist" --omit=dev
   ```

   While the service is stopped, publish a real directory copy at
   `/opt/patternlike-codex-runner/dist`; the systemd `ExecStart` below keeps that
   stable path. Do not use a directory symlink: the direct-entry guard compares
   the module URL with the invoked filename. Install the release files read-only
   for the service account and keep the previous directory for rollback. A Node 22 ESM import of
   both `index.js` and `portrait-mesh-canary.js` from this installed directory
   must succeed without a TypeScript loader or repository `node_modules`.
   The [runner build documentation](../../apps/codex-runner/README.md#standalone-release-artifact)
   describes the offline artifact regression and release boundaries.
3. Create `/var/lib/patternlike-codex-runner/workspace` as an empty Git
   repository owned by the service account. It contains no application data;
   it is only the Codex working directory.
4. Install the Codex CLI at a stable absolute path accessible to the account.
5. Run `codex login` interactively as that account, then run
   `codex login status`. Do not inspect or copy its credential file.
6. Create `/etc/patternlike-codex-runner.env` as `root:root` mode `0600`. It
   contains only these assignments:

   - `PATTERNLIKE_API_ORIGIN` — the production API HTTPS origin;
   - `CODEX_RUNNER_TOKEN` — the password-manager value provisioned above;
   - `CODEX_BIN` — the absolute Codex executable path;
   - `CODEX_RUNNER_POLL_MS=5000`;
   - `CODEX_RUNNER_CONCURRENCY=1`;
   - optional `CODEX_RUNNER_PORTRAITS=0|1` and `CODEX_RUNNER_MESHES=0|1`
     (omit or `0` keeps the text-only poller; `"true"`/`"yes"` fail closed).

Never place the Worker artifact keyring in this file.

Install the checked-in
`apps/codex-runner/systemd/patternlike-codex-runner.service` unit. Its effective
properties are:

```ini
[Unit]
Description=Pattern/Like Codex production inference runner
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=15min
StartLimitBurst=5

[Service]
Type=simple
User=patternlike-codex
Group=patternlike-codex
WorkingDirectory=/var/lib/patternlike-codex-runner/workspace
Environment=HOME=/var/lib/patternlike-codex-runner
Environment=CODEX_HOME=/var/lib/patternlike-codex-runner/.codex
Environment=PATH=/opt/patternlike-codex-runner/bin:/usr/bin:/bin
EnvironmentFile=/etc/patternlike-codex-runner.env
ExecStart=/opt/patternlike-codex-runner/bin/node /opt/patternlike-codex-runner/dist/index.js
Restart=on-failure
RestartSec=30s
TimeoutStartSec=30s
TimeoutStopSec=16min
UMask=0077
CapabilityBoundingSet=
AmbientCapabilities=
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectClock=true
ProtectHome=true
ProtectHostname=true
ProtectKernelLogs=true
ProtectSystem=strict
ReadWritePaths=/var/lib/patternlike-codex-runner
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

Use the actual Node path observed on the host. After `daemon-reload`, enable and
start the service. `systemctl status` and the journal should show only closed
events such as started, idle, processed, poll failed, stopped, or fatal. They
must never contain prompts, model output, stdout, stderr, bearer tokens, or
lease tokens.

Stopping the service is graceful: the runner finishes its one active invocation
before exit. The 16-minute systemd stop deadline is intentionally longer than
the 15-minute provider timeout.

## 7. Rollout-off protocol smoke

Use this protocol only when both domain rollouts are intentionally off. It is
not a claim about the current production audit, which found ontology `internal`
and Pattern `off` as recorded above.

- verify repeated runner polls receive no work;
- verify no D1 provider budget is consumed;
- verify no provider artifact prefix is created;
- verify the service exposes no listening socket;
- verify `codex login status` succeeds as the service account.

If the runner reports fatal, leave rollouts off. Correct the executable path or
refresh the interactive Codex login, then restart it.

## 8. Internal ontology canary

Change the production ontology pins together in one reviewed deployment:

- `ONTOLOGY_PIPELINE_PUBLISHER="codex"`;
- generator and evaluator timeouts `900000`;
- `ONTOLOGY_PIPELINE_ROLLOUT="internal"`;
- all existing model, prompt, input, attempt, and daily-call pins unchanged.

For `codex`, generator, evaluator, and regression passes are all fixed at
900000 ms. Each claimed provider job has a 1200000-ms lease, preserving a
five-minute terminal-upload margin. The Codex contract rejects another timeout;
do not mix these values with the 120000-ms OpenAI path.

Reserve exactly one new immutable candidate through the existing authenticated
internal operation. Do not use the local diagnostic corpus. Monitor only safe
state and counters. The ordinary generator job is the reachable Codex Gate 4
check for the generator schema: let the runner claim that durable job; do not
create a diagnostic job or invoke a separate runner route. Close that schema's
Gate 4 evidence only if its terminal response is schema-valid within timeout
with the pinned model/prompt and safe ids, hashes, and counters. Otherwise stop
the candidate. Do not reserve it until the selected Codex Gate 6 approval above
is recorded.

Acceptance evidence:

- generator, evaluator, and regression calls are charged exactly once per
  claimed provider job;
- no pending or leased provider job remains after terminal pipeline state;
- candidate, compilation, evaluation, and regression hashes are present;
- evaluation and regression receipts pass;
- the signer key id and signed bundle verify;
- the new ontology is active through the ordinary pointer;
- request and response objects exist only as encrypted envelopes.

On a hard-gate or terminal provider failure, set the ontology rollout back to
`off`; do not force ingestion.

## 9. Pattern canary

**Activating a public-capable ontology is what opens Pattern generation.** There
is no account-scoped canary any more: the same activation that lets the canary
account generate lets every eligible account generate. Plan the canary as the
first generation after activation, observed closely — not as a change that
admits one account and excludes the rest.

The publisher configuration is already deployed and asserted by
`npm run test:wrangler-config -w @patternlike/api`:

- `PATTERN_PUBLISHER="codex"`, the only value configuration accepts;
- planner, writer, and verifier timeouts all `900000`;
- all existing model, prompt, output, input, attempt, retention, and daily-call
  pins unchanged.

For `codex`, planner, writer, and verifier passes are all fixed at 900000 ms,
with the same 1200000-ms provider-job lease and five-minute terminal-upload
margin. There are no OpenAI 120000-ms values left to inherit: a deployment
carrying them fails `checkSecureConfig` on every request rather than running
long.

`PATTERN_GENERATION_ENABLED=0` is the dedicated Pattern pause control.
`PATTERN_DAILY_PROVIDER_CALL_LIMIT` separately bounds the day's spend. Stopping
the shared runner also stops other provider domains; use the dedicated control
when only Pattern work needs to pause.

Use the normal authenticated, confirmed first-use flow. It creates the current
Pattern-generation grant and reservation atomically; only chart-correction
auto-reservation needs a prior grant. Never enqueue a synthetic document
directly into the reader pipeline. The ordinary planner job is the reachable
Codex Gate 4 check for the Pattern strict schema: let the runner claim that
durable job, with no added diagnostic job or runner route. Close that schema's
Gate 4 evidence only on a terminal schema-valid response within timeout with
the pinned model/prompt and safe ids, hashes, and counters; otherwise stop the
canary.

Acceptance evidence:

- one claim is consumed and one Pattern document is accepted;
- planner, writer, and verifier attempts and daily usage are within pins;
- provenance names Codex and carries the exact model/prompt pins;
- the active ontology version and bundle hash match the canary document;
- word-count and semantic validation pass;
- authenticated `GET /v1/pattern` returns the accepted document;
- provider jobs are terminal, and encrypted R2 pointers and hashes agree;
- no prompt or response prose appears in D1, logs, or the change record.

Keep the allowlist at one account until the canary evidence is reviewed.

## 9a. Daily readings on the Codex control plane

Daily uses the coordinate `pipeline = 'reading'`, `pass = 'publisher'`, with the
generic Daily `jobs.id` as `owner_id`, the frozen `command_generation` as
`stage_generation`, and `jobs.attempts - 1` as the zero-based `stage_attempt`.
Migration `0017` is what makes that coordinate legal, and it must be applied to
D1 **before** the Worker that writes it is deployed.

The Daily Queue message stays exactly `{job_id, reading_id}`. Provider job ids,
prompts, responses, lease tokens, and artifact keys never enter it, and never
enter a log.

**`publisher_pending` is not a failure.** While the runner works, the Daily job
sits `queued` with `result_class = 'publisher_pending'`, no claim token, no
lease, `available_at` NULL, and `dispatched_at` deliberately still set — which
is what keeps the outbox sweep from re-offering it every cycle for the life of
a fifteen-minute call. Reacquiring such a job does **not** spend a Daily
attempt; only a genuine new provider attempt does. A queue-age dashboard should
read that state as *waiting*, never as *stuck*.

`READING_V5_ROLLOUT` remains Daily's kill switch and is independent of the
Pattern and ontology rollouts. `off` pauses queued work durably before any
claim, decryption, or provider job, published readings stay readable, and it
requires no runnable provider configuration. Set it before stopping the runner
if Daily is what you need to stop.

The runner is **concurrency one and FIFO across all three pipelines**. Daily,
Pattern, and ontology work share one claim order; that is deliberate simplicity,
not a capacity claim. Add fairness or concurrency only after real queue-age
evidence and a separate capacity review.

Content-free evidence to record for a Daily canary: pipeline, pass, closed
status, model, prompt version, job age, lease age, latency, integer token
counts, request/response hashes, the D1 coordinate, the `reading_provider_daily_usage`
delta, and the nudge outcome. Never the prompt, the output, runner stderr, a
user id, a chart id, a consent id, a birth value, or a word of the prose.

## 10. Budget and repair checks

Use read-only D1 queries to inspect only:

- status counts in `codex_provider_jobs`, grouped by pipeline and pass;
- oldest pending/leased age per pipeline;
- pass-level rows in the Pattern and ontology daily usage tables, and the
  date-keyed `reading_provider_daily_usage` ledger for Daily;
- lease expiry, completion timestamps, and closed failure codes;
- current domain stage/generation/attempt coordinates;
- encrypted object keys, byte lengths, and hashes;
- Daily jobs sitting at `result_class = 'publisher_pending'`, and how long.

Budget is charged when the **runner claims**, once per lease, including a
reclaimed one — the previous holder may have invoked before it died. Creating,
adopting, polling, completing, validating, and publishing are all free. A
reading ledger that moves without a corresponding claim is a defect, not spend.

Scheduled maintenance cancels stale pending work, re-dispatches a terminal job
whose completion nudge was interrupted — including a Daily owner still parked at
`publisher_pending`, which no other sweep can see — removes user-owned rows
during account erasure, prunes stale Pattern-owned terminal artifacts after 30
days, expires ontology-owned artifacts when a failed run reaches its seven-day
retention deadline, and deletes a Daily exchange only once its owner is terminal.
A completed provider job whose Daily owner is still waiting is nudge-eligible,
never cleanup-eligible: deleting its response would destroy the candidate the
reader is about to be shown. It never deletes an active lease or a current
pending coordinate.

## 11. Credential expiry and incident response

If the ChatGPT login is missing or expired, the runner submits the closed
`publisher_auth_failed` / `authentication_failed` result for claimed work and
exits nonzero. The service manager then alerts/restarts; every actual claim has
already consumed one daily budget unit.

Recovery:

1. set both rollouts to `off` if failures are recurring;
2. stop the runner;
3. run `codex login` interactively as the service account;
4. verify `codex login status` without printing credential files;
5. start the runner and confirm idle polling;
6. re-enable only the smallest approved canary.

Rotate `CODEX_RUNNER_TOKEN` as a coordinated Worker-and-host change. Stop the
runner, update the Worker secret interactively, update the mode-0600 host file,
deploy/restart, and verify idle polling. Never reuse an old service token.

## 12. Rollback

The safe rollback is:

1. set the affected controls and deploy: `READING_V5_ROLLOUT=off` for Daily,
   `ONTOLOGY_PIPELINE_ROLLOUT=off` for the ontology pipeline, or
   `PATTERN_GENERATION_ENABLED=0` for Pattern. These controls are independent.
   Follow the pause runbook for retained leases and resume behavior;
2. stop and disable the runner if the fault is the runner itself. If rolling
   back to Worker code without the Pattern pause control, verify containment
   through the runner and ontology policy before returning traffic;
3. leave migrations `0013`, `0014`, and `0017` and encrypted artifacts in place;
4. investigate using only safe state, hashes, counters, and closed codes;
5. redeploy the last known-good Worker only if its schema is compatible with
   the additive migration.

Do not roll back the D1 migration, delete leased jobs, overwrite encrypted
objects, switch a frozen in-flight command to another publisher, or move the
Codex credential into Cloudflare. Retained terminal jobs and scheduled repair
make recovery forward-safe.
