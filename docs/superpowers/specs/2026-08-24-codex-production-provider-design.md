# Codex Production Provider Design

**Date:** 2026-08-24  
**Status:** Approved  
**Owner:** Pattern/Like production inference

## Goal

Make the funded ChatGPT/Codex subscription a reusable production inference
provider for both the ontology pipeline and reader-facing Pattern generation.
The Cloudflare Worker remains the authority for commands, budgets, validation,
artifacts, signatures, publication, and retries. A dedicated non-AGPL host runs
the supported local Codex CLI and keeps the ChatGPT-managed credential local.

Success means an unattended runner can process every constrained-model pass,
survive restarts and duplicate deliveries, and produce truthful `Codex`
provenance without a ChatGPT credential or private ChatGPT backend URL in the
Worker.

## Constraints

- Use the supported `codex exec` non-interactive surface with
  `--output-schema`; do not call `chatgpt.com/backend-api/codex/responses`
  directly.
- Keep `~/.codex/auth.json` and all ChatGPT-managed tokens on the dedicated
  runner host. They never enter Worker vars, secrets, requests, logs, D1, or R2.
- Do not place the runner or its credential in `apps/calc-stub` or on the AGPL
  calculation host.
- Preserve the frozen M0 and M7 public contracts. No reader-facing schema
  change is required because Pattern provenance already permits a truthful
  provider string.
- Keep prompt and response prose out of D1 and logs. Store it only in encrypted
  R2 artifacts and return it over authenticated TLS to the runner.
- Keep deterministic validation, ontology evaluation, signing, and publication
  inside the existing Worker pipelines. The runner performs inference only.
- Process one Codex job at a time by default. Every actual CLI invocation must
  consume the applicable UTC-day provider budget before work is handed out.

## Architecture

### Components

1. The API Worker creates an immutable Codex job when a `codex` publisher pass
   has no adoptable response.
2. D1 stores only the job coordinate, frozen pins, hashes, lease state, safe
   failure class, and R2 pointers. A new Worker-only artifact keyring encrypts
   request and response envelopes in R2.
3. A dedicated Node runner polls an authenticated claim endpoint. It receives
   one leased invocation containing the prompt, exact JSON Schema, model,
   reasoning effort, and timeout.
4. The runner invokes `codex exec --ephemeral --sandbox read-only
   --output-schema ... --json`, supplies the prompt on stdin, captures the
   final output in an owner-only temporary directory, and reports the output,
   Codex thread id, and token usage.
5. The Worker commits the response create-only, marks the job complete, and
   nudges the owning Pattern or ontology queue. The ordinary executor adopts
   the response, applies all existing validators, and advances or retries.

The runner exposes no inbound port. All network traffic is outbound HTTPS from
the runner to the Worker.

### Durable job identity

A job is unique by:

`(pipeline, owner_id, pass, stage_generation, stage_attempt, request_hash)`

`pipeline` is `pattern` or `ontology`. Pattern passes are `planner`, `writer`,
and `verifier`; ontology jobs also use `generator` and `evaluator`, while
ontology regression reuses the three Pattern pass names. The tuple is enough
to distinguish every bounded provider attempt without putting prompt text in
D1.

The D1 row has the closed lifecycle `pending -> leased -> completed|failed`.
An expired lease returns to claim eligibility. Completion is accepted only for
the current random lease token, whose hash—not plaintext—is stored in D1.
Repeated completion with the same response hash is idempotent; different bytes
for an already completed coordinate are rejected as an artifact conflict.

### Encrypted artifacts

Each job has an immutable request object and, on successful completion, an
immutable response object under `codex-provider-jobs/<job-id>/`. AES-256-GCM
additional authenticated data binds the job id, artifact role, pipeline,
owner, pass, generation, and attempt. D1 records plaintext, ciphertext, and
envelope hashes plus byte length and key id.

Pattern-owned rows include `user_id` solely for erasure. Their two R2 keys and
D1 rows join the existing account-deletion manifest and are removed before the
Pattern generation rows. Ontology rows are non-user-owned and follow the
ontology run's retention lifecycle.

### Claim and budget ordering

The claim endpoint first proves the domain coordinate is still current. It
then obtains the job lease and consumes one unit from the existing Pattern or
ontology provider ledger before returning the plaintext invocation. If budget
reservation fails, no invocation is returned and the job remains pending or
is terminally failed with the existing safe budget class.

The runner performs no hidden retries. A CLI timeout, authentication failure,
transport failure, refusal, or malformed completion is submitted as one safe
failed result. The domain executor maps it through the existing retry policy,
so each fresh CLI call owns a fresh bounded stage attempt and daily budget unit.

### Asynchronous pipeline behavior

`publisher_pending` is a control-plane result, not a provider failure. When a
pass creates or observes a pending/leased job, the executor releases its domain
claim without advancing the stage generation or attempt. It acknowledges the
current Queue message. Completion clears the domain outbox marker and sends an
opaque queue nudge; scheduled repair remains authoritative if that send fails.

On re-entry, the publisher adopts a completed job. Successful raw output and
token metadata enter the same provenance and deterministic-validation paths as
OpenAI output. Failed jobs enter the existing provider failure mapping. A stale
job can never advance a pipeline because both completion and adoption recheck
the exact domain coordinate.

## Runner protocol

The dedicated surface uses `CODEX_RUNNER_TOKEN`, separate from consumer auth,
`SERVICE_AUTH_TOKEN`, and Pattern administration. It provides:

- `POST /codex-provider/v1/jobs/claim` — lease the oldest eligible job or
  return `204`.
- `POST /codex-provider/v1/jobs/:id/complete` — submit exact JSON output,
  thread id, and integer token usage.
- `POST /codex-provider/v1/jobs/:id/fail` — submit one closed safe failure code.

Requests and responses have strict size and exact-field checks. Neither route
returns provider prose in an error. The bearer token and lease token are
compared through SHA-256 digests, and logs contain only job id, pipeline, pass,
model, latency, token counts, hashes, and safe status.

The runner uses a 15-minute invocation timeout and a 20-minute lease. It polls
with bounded jitter, handles `SIGINT`/`SIGTERM`, deletes its temporary directory
after every attempt, and exits nonzero on missing local Codex authentication so
the service manager can alert and restart after an operator runs `codex login`.

## Configuration

Worker secrets:

- `CODEX_RUNNER_TOKEN`
- `CODEX_PROVIDER_ARTIFACT_KEYRING`

Worker bindings and pinned vars:

- existing `ARTIFACTS`, `PATTERN_QUEUE`, and `ONTOLOGY_PIPELINE_QUEUE`
- `PATTERN_PUBLISHER="codex"`
- `ONTOLOGY_PIPELINE_PUBLISHER="codex"`
- compiled model, prompt, input, attempt, and daily-budget pins

Runner environment:

- `PATTERNLIKE_API_ORIGIN`
- `CODEX_RUNNER_TOKEN`
- optional `CODEX_BIN` (default `codex`)
- optional `CODEX_RUNNER_POLL_MS` (default `5000`)
- optional `CODEX_RUNNER_CONCURRENCY` (default `1`, maximum initially `1`)

`CODEX_AUTH_TOKEN` and `CODEX_ACCOUNT_ID` are removed from the Worker contract.

## Failure handling

- Expired job lease: reclaim the same job; the first valid completion wins.
- Runner crash: lease expiry makes work recoverable; the domain attempt does
  not advance until a result exists.
- Local Codex authentication missing/expired: safe authentication failure,
  domain fails closed, and no credential is copied to Cloudflare.
- CLI timeout/network failure: normal bounded provider retry and budget charge.
- Invalid JSON or missing usage/thread metadata: safe output-invalid result.
- Schema-valid but policy-invalid output: existing deterministic validators and
  correction documents decide the retry.
- Queue nudge failure: the D1 outbox remains undispatched for scheduled repair.
- Stale coordinate, revoked consent, deleted account, recalled ontology, or
  disabled rollout: claim/adoption refuses and the work row is cancelled.
- Conflicting response bytes: retain the first create-only artifact and emit a
  closed artifact-conflict event; never overwrite.

## Verification and rollout

1. Migration tests prove clean apply, populated upgrade, constraints, indexes,
   and deletion ordering.
2. Unit tests cover envelope crypto, request conversion, token/lease checks,
   CLI event parsing, exact schemas, size caps, and safe failures.
3. Worker integration tests cover claim, budget, lease expiry, idempotent and
   conflicting completion, stale coordinates, queue repair, Pattern adoption,
   ontology generation/evaluation, and regression adoption.
4. A local end-to-end test runs one real Codex CLI invocation through the same
   HTTP protocol without printing content.
5. Run repository typecheck, affected suites, full tests, and production Worker
   dry-run.
6. Apply the D1 migration and deploy with both rollouts still off. Provision
   the two Worker secrets, authenticate Codex on the dedicated host, and start
   the runner service.
7. Enable the ontology pipeline internally, generate/evaluate/sign/ingest one
   production ontology, then enable Pattern for the canary account and generate
   one Pattern. Verify terminal state, encrypted artifacts, exact provenance,
   budgets, signatures, and reader retrieval before any broader rollout.

