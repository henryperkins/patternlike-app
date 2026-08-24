# Codex production provider runbook

**Status (2026-08-24):** the rollout-off control plane, migration `0013`, and
Worker secrets are deployed. Release hardening adds migration `0014`, which
must be applied before the hardened Worker is deployed. Dedicated-host
installation, interactive service-account login, and the ontology/Pattern
canaries remain.

This runbook operates the supported Codex CLI provider for Pattern generation
and the ontology pipeline. The API Worker owns durable jobs, budgets,
validation, signing, publication, and encrypted artifacts. A dedicated
non-AGPL host performs inference through `codex exec` using its local ChatGPT
login.

The runner has no inbound port. Never copy its Codex credential store to
Cloudflare, put a ChatGPT token in Worker configuration, or place this service
on the AGPL calculation host.

## 1. Preconditions

- Repository typecheck, tests, and production dry-run build are green.
- The production D1 database and R2 bucket are healthy.
- The Pattern and ontology queues and ontology signer Worker are healthy.
- A dedicated non-AGPL Linux host with Node 20+ and the supported Codex CLI is
  approved.
- The operator has Cloudflare deployment access and a secure password-manager
  record for the shared runner bearer secret.
- Both AI rollouts are `off` during migration and initial deployment.

Confirm the local CLI surface before installation:

```bash
codex --version
codex exec --help
codex login status
```

The deployed runner uses `--ephemeral`, `--sandbox read-only`, `--json`, and
`--output-schema`. Do not replace this with a private HTTP endpoint.

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
the matching Worker code can receive traffic. Production already has `0013`;
the hardened release adds `0014`. Apply pending migrations in recorded order:

```bash
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
```

Expected result:

- in the recorded 2026-08-24 production state, only migration `0014` is newly
  applied; a fresh pre-provider environment applies `0013` then `0014`;
- `PRAGMA foreign_key_check` returns no rows;
- the preflight table counts are unchanged;
- `codex_provider_jobs` and `codex_provider_response_uploads` exist and are
  empty.

Stop if any other migration is pending or any foreign-key row is returned.

## 4. Provision Worker secrets

Generate two independent values in an approved secret-management workflow:

- `CODEX_RUNNER_TOKEN`: 32–512 URL-safe characters, unique to this runner
  authority and not reused as `SERVICE_AUTH_TOKEN` or `PATTERN_ADMIN_TOKEN`;
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

## 5. Deploy with both rollouts off

Before deploying, confirm the production variables contain:

```toml
PATTERN_AI_ROLLOUT = "off"
ONTOLOGY_PIPELINE_ROLLOUT = "off"
```

Deploy through the normal root command:

```bash
npm run deploy:api
```

Verify the public health endpoint, existing authenticated reads, queue health,
and that `codex_provider_jobs` remains empty. An unauthenticated request to the
runner routes must not reveal whether work exists. Keep the deployed Worker
version id in the change record.

## 6. Install the dedicated runner

Build the Node artifact on the release checkout:

```bash
npm ci
npm run build -w @patternlike/codex-runner
```

On the approved host:

1. Create an unprivileged service account whose home is under
   `/var/lib/patternlike-codex-runner`.
2. Install the runner's `dist/` directory and `package.json` read-only under
   `/opt/patternlike-codex-runner`.
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
   - `CODEX_RUNNER_CONCURRENCY=1`.

Never place the Worker artifact keyring in this file.

Install a systemd unit with these effective properties:

```ini
[Unit]
Description=Pattern/Like Codex production inference runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=patternlike-codex
Group=patternlike-codex
WorkingDirectory=/var/lib/patternlike-codex-runner/workspace
EnvironmentFile=/etc/patternlike-codex-runner.env
ExecStart=/usr/bin/node /opt/patternlike-codex-runner/dist/index.js
Restart=on-failure
RestartSec=30s
TimeoutStopSec=16min
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/patternlike-codex-runner
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

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

With both domain rollouts still off:

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

Reserve exactly one new immutable candidate through the existing authenticated
internal operation. Do not use the local diagnostic corpus. Monitor only safe
state and counters.

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

After ontology activation, deploy these production changes together:

- `PATTERN_PUBLISHER="codex"`;
- planner, writer, and verifier timeouts `900000`;
- `PATTERN_AI_ROLLOUT="internal"`;
- `PATTERN_INTERNAL_ACCOUNT_IDS` containing only the approved canary account;
- all existing model, prompt, output, input, attempt, retention, and daily-call
  pins unchanged.

Use the normal authenticated consent and first-open generation flow. Never
enqueue a synthetic document directly into the reader pipeline.

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

## 10. Budget and repair checks

Use read-only D1 queries to inspect only:

- status counts in `codex_provider_jobs`;
- pass-level rows in the existing Pattern and ontology daily usage tables;
- lease expiry, completion timestamps, and closed failure codes;
- current domain stage/generation/attempt coordinates;
- encrypted object keys, byte lengths, and hashes.

Scheduled maintenance cancels stale pending work, re-dispatches a terminal job
whose completion nudge was interrupted, removes user-owned rows during account
erasure, prunes stale Pattern-owned terminal artifacts after 30 days, and
expires ontology-owned artifacts when a failed run reaches its seven-day
retention deadline. It never deletes an active lease or a current pending
coordinate.

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

1. set both rollouts to `off` and deploy;
2. stop and disable the runner;
3. leave migrations `0013` and `0014` and encrypted artifacts in place;
4. investigate using only safe state, hashes, counters, and closed codes;
5. redeploy the last known-good Worker only if its schema is compatible with
   the additive migration.

Do not roll back the D1 migration, delete leased jobs, overwrite encrypted
objects, switch a frozen in-flight command to another publisher, or move the
Codex credential into Cloudflare. Retained terminal jobs and scheduled repair
make recovery forward-safe.
