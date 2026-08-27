# Codex Reader Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release Codex-backed Daily and account-wide Pattern from one immutable candidate, with current contractual/data-control approval, public ontology proof, migration `0017` ahead of Worker code, real production canaries, and content-free rollback evidence.

**Architecture:** Treat the Cloudflare Worker, D1 schema, R2 artifacts, Queues, cron triggers, and the outbound Codex runner as one ordered release. Freeze and verify the candidate first; stop on the legal/data or ontology gates; back up and migrate D1; pause the runner while Workers Builds deploys the exact candidate; then resume it for bounded Daily and Pattern canaries and an observation window. Daily retains its kill switch, while a Pattern fault rolls the Worker back because the approved product has no Pattern cohort gate.

**Tech Stack:** Git/GitHub, Node 20, the repository-local Wrangler 4 CLI, Cloudflare Workers Builds, D1, R2, Queues, Cron Triggers, systemd, Codex CLI non-interactive mode, and the existing production API/runner protocols.

**Spec:** [`../specs/2026-08-27-codex-daily-pattern-design.md`](../specs/2026-08-27-codex-daily-pattern-design.md)

## Global Constraints

- This is plan 3 of 3. Start only after [`2026-08-27-codex-daily-control-plane.md`](./2026-08-27-codex-daily-control-plane.md) and [`2026-08-27-account-wide-pattern.md`](./2026-08-27-account-wide-pattern.md) are complete on one clean implementation branch.
- Do not perform a production mutation merely because this plan exists. The operator must explicitly authorize any public ontology candidate/activation, the named production migration, runner service change, merge/deploy, canaries, and later secret deletion at their respective checkpoints.
- Every code, migration, build, provider, deployment, and canary result must resolve to one immutable candidate SHA. If `origin/main` moves, rebuild the candidate and rerun `npm run ci:local` before any production action.
- Merging to `main` triggers Cloudflare Workers Builds. Migration `0017` must be applied and verified before the candidate reaches `main`.
- Never put prompts, responses, generated prose, birth facts, chart packets, user ids, consent ids, lease tokens, artifact keys, or credentials in terminal output, CI output, screenshots, the PR, the committed runbook, or the restricted evidence summary.
- Exact account/workspace identity and agreement evidence belong in the restricted change record. The committed runbook records the reviewer, date, agreement class, settings verdict, and restricted-record reference without copying personal or secret values.
- No real reader packet may be sent until the contractual-use and data-control review explicitly approves unattended customer-application use through the selected ChatGPT-authenticated Codex CLI workspace.
- There is no OpenAI API, Workers AI, or synthetic fallback for Daily or Pattern. A runner/provider fault leaves durable work waiting or fails it under the frozen policy.
- Pattern has no product kill switch after this change. `READING_V5_ROLLOUT="off"` remains the Daily containment control; stopping the runner is the shared immediate provider containment control.
- Use the repository-local `npx wrangler` with both `--config apps/api/wrangler.toml` and `--env production` on every remote command. Review the current Cloudflare [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), and [versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) guidance before execution.
- Run Codex only in non-interactive, ephemeral, read-only mode with the checked-in strict output schema. Recheck the current official [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and authentication guidance immediately before host work.
- A source setting, successful dry run, model preflight, old Pattern run, or GitHub Actions result is not live proof. GitHub Actions is expected to fail before checkout because of the account billing lock; `npm run ci:local` is the merge gate.

---

## Task 1: Add the active release runbook and close the external-use gates

**Files:**

- Create: `docs/deploy/codex-reader-rollout.md`
- Modify: `docs/deploy/codex-production-provider.md`
- Modify: `docs/deploy/api-production.md`

**Interfaces:**

- Consumes: final consent copy and runtime behavior from implementation plans 1 and 2 plus current official OpenAI terms/data-control sources.
- Produces: the committed active runbook and a closed external-use gate referenced by the restricted change record.

- [ ] Create the active rollout runbook with sections for candidate identity, restricted contractual/data-control record, public ontology, runner, D1 baseline/migration, Worker deployment, Daily canaries, Pattern canary, observation, rollback, and separate secret retirement.
- [ ] Give each remote or real-provider section an explicit `NOT RUN` initial state and a field naming the restricted change-record evidence it must receive. Do not carry forward a historical result as current evidence or later edit live account identifiers into the repository.
- [ ] Create one owner-only evidence directory outside the repository, record its exact path in the restricted change record, and restore the same task-specific variable at the start of every later operator shell:

      ROLLOUT_DIR="$(mktemp -d /home/henry/patternlike-codex-readers.XXXXXX)"
      chmod 700 "$ROLLOUT_DIR"
- [ ] Re-open the current official sources named in the approved design: Codex plan use, training/data-sharing controls, enterprise privacy, Terms of Use, and Services Agreement.
- [ ] Have the authorized reviewer record in the restricted change system: exact account/workspace identity; governing agreement class; explicit approval or rejection of unattended customer-application use through Codex CLI; applicable retention/deletion terms; ordinary training/data-sharing state; full-environment training state; feedback state; and review date.
- [ ] In the committed runbook's release-gate record, record only the restricted-record reference, reviewer role, date, agreement class, and these closed verdicts:

      contractual_use: approved | rejected
      ordinary_training: disabled | not_applicable | unverified
      full_environment_training: disabled | not_applicable | unverified
      feedback_sharing: disabled | not_applicable | unverified
      retention_deletion: verified | unverified

- [ ] Stop if `contractual_use` is not `approved` or any applicable data-control verdict is `unverified`. Do not treat a successful `codex exec` call as authorization.
- [ ] Update the active runbooks so they no longer claim API `store:false`, OpenAI API retention, or an API-key model probe applies to this ChatGPT-authenticated Codex path.
- [ ] Review the final reader consent/disclosure copy from plans 1 and 2 against the actual approved workspace. If wording changes, bump the affected consent policy beyond `1.1.0`, update tests/contracts, and rerun both implementation plans' consent lanes before freezing a candidate.
- [ ] Run documentation checks and inspect only the intended files:

      git diff --check
      rg -n "store:false|OPENAI_API_KEY|contractual_use|retention_deletion" docs/deploy/codex-reader-rollout.md docs/deploy/codex-production-provider.md docs/deploy/api-production.md

- [ ] Commit: `docs: establish Codex reader release gates`

## Task 2: Verify the active ontology against the deployed gate

**Files:**

- Modify: `docs/deploy/codex-reader-rollout.md`
- Modify: `docs/deploy/openai-pattern-rollout.md`

**Interfaces:**

- Consumes: Task 1's external approval, the deployed `ontologyServesAccount` predicate, and plan 2's `ontology:release:verify` command.
- Produces: a current signed ontology proof matching the deployed `ontologyServesAccount` predicate, or a hard stop before candidate freeze.

- [ ] Obtain explicit authorization before starting a new paid ontology candidate or activating a release. Query current production state before relying on any dated runbook. Record only counts, opaque run/release ids, hashes, statuses, provenance, and timestamps:

      npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT p.active_version, r.status, r.object_key, r.bundle_hash, r.corpus_release_hash, r.recalled_at, e.run_id, e.activation_scope, e.run_status, e.evidence_status, e.evaluation_artifact_status, e.compiler_passed, e.evaluator_passed, e.unevaluated_fixture_count, e.corpus_license_class, e.corpus_public_capable, e.evaluation_report_hash, e.regression_report_hash, e.signing_key_id, json_extract(r.evaluation_json, '$.regression_passed') AS regression_passed, json_extract(r.evaluation_json, '$.regression_report_hash') AS release_regression_report_hash FROM pattern_ontology_pointer p LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version LEFT JOIN pattern_ontology_pipeline_evidence e ON e.ontology_version = r.version AND e.bundle_hash = r.bundle_hash WHERE p.id = 1"

- [ ] Do not accept the inventory query alone as proof. Run a read-only D1 query using the exact current `ONTOLOGY_ACTIVATION_SCOPE_SQL` joins and predicates from `apps/api/src/db/pattern-ontology.ts`, and read the result against the branch the release's provenance selects:

      machine_pipeline -> activation_scope MUST be `public`
      synthetic_internal -> activation_scope is `internal` by construction and is not a refusal
      any other origin, or none -> refuse

      For a `machine_pipeline` release, compare the committed evaluation receipt and evaluation/regression artifact coordinates and hashes to the selected evidence row. An authored release has no evidence row to compare, which is the point of the next step.
- [ ] Copy the exact `object_key`, version, bundle hash, and corpus hash from that query into task-scoped shell variables; download the active R2 object to the restricted directory and verify it offline with the public verification keyring stored in the restricted change system:

      test -d "$ROLLOUT_DIR"
      test -n "$ONTOLOGY_OBJECT_KEY" && test -n "$ONTOLOGY_VERSION"
      test -n "$ONTOLOGY_BUNDLE_HASH" && test -n "$ONTOLOGY_CORPUS_HASH"
      test -f "$ONTOLOGY_KEYS_FILE"
      npx wrangler r2 object get "pattern-artifacts/$ONTOLOGY_OBJECT_KEY" --config apps/api/wrangler.toml --env production --remote --file "$ROLLOUT_DIR/active-ontology.json"
      npm run ontology:release:verify -w @patternlike/api -- --bundle "$ROLLOUT_DIR/active-ontology.json" --keys-file "$ONTOLOGY_KEYS_FILE" --expected-version "$ONTOLOGY_VERSION" --expected-bundle-hash "$ONTOLOGY_BUNDLE_HASH" --expected-corpus-hash "$ONTOLOGY_CORPUS_HASH"

- [ ] Require the offline verifier to report the provenance expected for the release's branch, the signing key id, hash matches, a valid signature, and a compiler pass. These four are the whole of an authored release's assurance, so none of them may be waived. Delete the downloaded bundle when the restricted evidence summary is complete.
- [ ] An authored `synthetic_internal` release is an accepted outcome of this task, not a stop. `ontologyServesAccount` admits it on origin alone because sixteen machine candidates have failed the regressing stage and none has passed, so requiring a public machine release would close Pattern rather than open it. Record the trade in the restricted change record and the committed runbook: an authored release skips the independent evaluator and the seven regression hard gates (`suppressed_feature_leak`, `uncited_astrological_claim`, `source_dependency_failure`, `prohibited_claim`, `mandatory_feature_omission`, `private_projection_leak`, `semantic_refusal`), and those gates run nowhere else in the product. Since Pattern is account-wide there is no cohort to contain the consequence.
- [ ] A manually edited receipt, a forged evidence row, a machine release claiming `public` without the evidence chain that earns it, and a release naming no origin all remain refusals. If you want the machine assurance instead, execute Task 11 of [`2026-08-20-automated-ontology-pipeline.md`](./2026-08-20-automated-ontology-pipeline.md) through the current Codex provider and re-run this task.
- [ ] After any new ontology activation, repeat the production query and deployed signature/artifact verification. Record the immutable release version, bundle hash, corpus release/hash/license class, pipeline run id, report hashes, signing key id, and activation timestamp in the restricted change record without recording ontology prose.
- [ ] Update the old Pattern rollout runbook status to say the account-wide release serves from the active authored ontology and no longer has Gates 8/10 cohort transitions; preserve the dated failed-candidate history, which is the evidence for why the machine gate was not used.
- [ ] Stop on a signature/hash mismatch, a recall, a compile failure, an unauthorized or non-`licensed_excerpt` corpus, an absent or unrecognised provenance, or a `machine_pipeline` release whose scope does not derive `public`.
- [ ] Commit only the resulting runbook reconciliation: `docs: record the public Pattern ontology gate`

## Task 3: Freeze and verify one immutable candidate

**Evidence:** Restricted change record and PR comment; no repository file changes after the release commits are frozen.

**Interfaces:**

- Consumes: all implementation commits, Task 1's approved runbook, and Task 2's public ontology proof.
- Produces: `BASE_SHA`, `CANDIDATE_SHA`, `ROLLOUT_DIR`, exact local-gate evidence, and checksummed dry-run artifacts used by every later task.

- [ ] Fetch the remote and prove the implementation branch contains plans 1 and 2, migration `0017`, the reviewed release-gate commit, and no unrelated working-tree changes:

      git fetch origin
      git status --short
      git log --oneline --decorate -12
      git merge-base --is-ancestor origin/main HEAD

- [ ] Reconcile or remove all working-tree changes before continuing. Do not build or deploy from the planning checkout's pre-existing dirty state.
- [ ] Pin the repository Node and install the lockfile exactly:

      nvm install "$(cat .nvmrc)"
      nvm use "$(cat .nvmrc)"
      npm ci

- [ ] Run the local merge gate and save its complete output outside the repository in an owner-only directory:

      test -d "$ROLLOUT_DIR"
      test "$(stat -c '%a' "$ROLLOUT_DIR")" = "700"
      npm run ci:local | tee "$ROLLOUT_DIR/ci-local.txt"
      test "${PIPESTATUS[0]}" -eq 0

- [ ] Run the production dry-run build again after the gate and ensure it resolves the production environment:

      npm run build
      find apps/api/dist apps/web/dist -type f -print0 | sort -z | xargs -0 sha256sum > "$ROLLOUT_DIR/dry-run-files.sha256"

- [ ] Record `BASE_SHA="$(git rev-parse origin/main)"`, then freeze the exact candidate only after all checks pass:

      CANDIDATE_SHA="$(git rev-parse HEAD)"
      git status --short
      git show --stat --oneline "$CANDIDATE_SHA"
      sha256sum package-lock.json > "$ROLLOUT_DIR/package-lock.sha256"

- [ ] Require an empty `git status --short`. Record the full candidate SHA, base SHA, Node/npm/Wrangler versions, lockfile checksum, `ci:local` verdict, and dry-run artifact checksum in the restricted change record. Paste the complete `ci:local` summary into the PR.
- [ ] If the branch, lockfile, generated assets, migration, consent copy, config, or docs change after this point, invalidate the candidate and repeat this task.

## Task 4: Build and preflight the exact runner without user data

**Evidence:** Restricted change record; no repository file changes.

**Interfaces:**

- Consumes: Task 3's candidate/package inputs and Task 1's exact approved Codex workspace.
- Produces: a stopped host installation of the checksummed candidate runner plus a content-free authentication/model/schema preflight.

- [ ] Build the runner from `CANDIDATE_SHA`, package only the reviewed runtime files, and write an archive checksum to the restricted rollout directory:

      npm run build -w @patternlike/codex-runner
      tar -czf "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz" -C apps/codex-runner dist package.json probes
      sha256sum "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz"

- [ ] On the approved host, verify the existing unprivileged service account, empty working repository, root-owned mode-`0600` environment file, absolute `CODEX_BIN`, concurrency `1`, and absence of Cloudflare/D1/R2 credentials.
- [ ] As the runner account, record content-free output from:

      codex --version
      codex login status
      codex exec --help

- [ ] Stop if the login resolves to a different account/workspace than Task 1, the CLI version is not the reviewed version, the selected model is unavailable, allowance/credits are insufficient, or the service sandbox differs from the checked-in systemd unit.
- [ ] In a new mode-`0700` temporary Git repository on that host, run this zero-user-data probe from its root using the packaged strict schema and the same CLI controls as the runner:

      CODEX_PROBE_DIR="$(mktemp -d /var/lib/patternlike-codex-runner/preflight.XXXXXX)"
      chmod 700 "$CODEX_PROBE_DIR"
      git -C "$CODEX_PROBE_DIR" init --quiet
      cd "$CODEX_PROBE_DIR"
      codex exec --ephemeral --sandbox read-only --json --model gpt-5.6-sol --config 'model_reasoning_effort="high"' --output-schema /opt/patternlike-codex-runner/probes/sentinel-output.schema.json -o ./sentinel-output.json 'Return only the JSON object {"status":"ok"}.'
      test "$(tr -d '\n\r ' < ./sentinel-output.json)" = '{"status":"ok"}'

      Do not include application source, astrology content, or user data.
- [ ] Validate the returned object locally and retain only CLI version, model, elapsed time, exit class, usage integers, and request/thread identifier. Return to the prior directory, validate that `CODEX_PROBE_DIR` begins with `/var/lib/patternlike-codex-runner/preflight.`, and delete exactly that temporary directory after the content-free summary is recorded.
- [ ] Install the exact checksummed runner package with the service stopped. Keep the service stopped after installation; starting it is Task 7 because the old Worker cannot own `reading/publisher`.
- [ ] Confirm `systemctl is-active patternlike-codex-runner` reports `inactive` and record the installed package checksum. Do not use `systemctl enable --now` yet.

## Task 5: Back up, rehearse, and apply migration `0017` before merge

**Evidence:** Restricted change record; no repository file changes.

**Interfaces:**

- Consumes: Task 3's immutable `0017`, Task 4's stopped runner, and the current production database.
- Produces: a verified production schema that accepts the candidate Worker while retaining a pre-merge restore point.

- [ ] Obtain explicit authorization for the production D1 backup and migration. Verify `CANDIDATE_SHA` still names the PR candidate and the runner is stopped.
- [ ] Record the remote migration inventory. Exactly `0017_codex_reading_provider.sql` may be pending; stop on any other pending migration:

      npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote

- [ ] Capture a current Time Travel bookmark and full SQL export outside the repository, restrict it to the operator, and checksum it:

      npx wrangler d1 time-travel info patternlike-ops --config apps/api/wrangler.toml --env production --json > "$ROLLOUT_DIR/time-travel-before-0017.json"
      npx wrangler d1 export patternlike-ops --config apps/api/wrangler.toml --env production --remote --output "$ROLLOUT_DIR/pre-0017.sql"
      chmod 600 "$ROLLOUT_DIR/time-travel-before-0017.json" "$ROLLOUT_DIR/pre-0017.sql"
      sha256sum "$ROLLOUT_DIR/pre-0017.sql" > "$ROLLOUT_DIR/pre-0017.sha256"

- [ ] Capture content-free pre-migration evidence: total users; provider jobs grouped by pipeline/pass/status; response-upload count; parent rows with child uploads; index inventory; foreign-key inventory; `PRAGMA foreign_key_check`; and `PRAGMA quick_check`. Store raw remote output only in the restricted rollout directory.
- [ ] Rehearse the exact export locally in a fresh persist directory, then apply the repository migration there:

      npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --local --persist-to "$ROLLOUT_DIR/d1-rehearsal" --file "$ROLLOUT_DIR/pre-0017.sql"
      npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --local --persist-to "$ROLLOUT_DIR/d1-rehearsal"

- [ ] On the rehearsal database, compare every provider parent/response-child column and grouped count to the pre-migration evidence; verify old legal coordinates remain, `reading/publisher` inserts, illegal pairs reject, all four required indexes exist, `foreign_key_check` is empty, and `quick_check` is `ok`.
- [ ] Stop and repair the migration on any rehearsal mismatch. A changed migration invalidates `CANDIDATE_SHA` and returns the rollout to Task 3.
- [ ] Apply the unchanged `0017` to production:

      npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote

- [ ] Immediately repeat migration inventory, every pre-migration count/snapshot, index/foreign-key inventory, `PRAGMA foreign_key_check`, and `PRAGMA quick_check`. Prove only `0017` moved and all pre-existing bytes/relationships survived.
- [ ] If production apply or verification fails, do not merge. Restore to the recorded Time Travel bookmark under a separately confirmed restore action, verify the old inventory, and open a new candidate rather than improvising forward.
- [ ] Record the bookmark timestamp, export checksum, migration name, apply timestamp, and content-free before/after verdicts in the restricted change record. Do not commit the backup or raw database output.

## Task 6: Merge and verify the exact Cloudflare deployment

**Evidence:** Restricted change record and PR deployment comment; no repository file changes.

**Interfaces:**

- Consumes: Task 5's verified schema, Task 3's candidate/base identities, and the stopped runner from Task 4.
- Produces: a 100%-traffic Worker deployment whose build source is exactly `CANDIDATE_SHA`, with no Codex invocation started yet; encrypted pending jobs may legitimately accumulate while the runner is stopped.

- [ ] Reconfirm `0017` is applied, the runner is stopped, the PR carries the full `ci:local` summary, and `git rev-parse origin/main` still equals the recorded `BASE_SHA`. If main moved, do not merge; return to Task 3.
- [ ] Obtain explicit authorization to merge/deploy. Fast-forward the reviewed candidate to `main` without squash, rebase, merge commit, or force:

      git push origin "$CANDIDATE_SHA:refs/heads/main"

- [ ] Watch the independent Cloudflare Workers Build. Confirm its source commit is exactly `CANDIDATE_SHA`; record build id, upload/version id, deployment id, timestamp, and traffic percentage. GitHub Actions' zero-step billing failure remains infrastructure-only evidence.
- [ ] Verify the deployment inventory and public health:

      npx wrangler deployments list --config apps/api/wrangler.toml --env production
      curl --fail --silent --show-error https://patternlike-api-production.lfd.workers.dev/health

- [ ] Verify deployed effective configuration through the checked-in config test/build evidence and Cloudflare deployment settings: `READING_V5_ROLLOUT="hybrid"`; `READING_PUBLISHER="codex"`; `PATTERN_PUBLISHER="codex"`; 900000-ms pins; shared runner/artifact bindings present; Daily cron present; no `PATTERN_AI_ROLLOUT` or `PATTERN_INTERNAL_ACCOUNT_IDS` variable; no Daily/Pattern OpenAI or Workers AI runtime selector.
- [ ] Verify unauthenticated runner routes disclose no job state, ordinary authenticated reads remain compatible, Queue consumers remain batch size `1`, and the R2/D1/Queue bindings are healthy.
- [ ] Stop before the runner starts if the build SHA, version, config, route, binding, health, migration, or public ontology differs from the candidate evidence. Roll back the Worker version if requests could reach incompatible code.

## Task 7: Start the runner and prove the shared control plane

**Evidence:** Restricted change record; no repository file changes.

**Interfaces:**

- Consumes: Task 6's compatible Worker and Task 4's exact installed runner.
- Produces: one live concurrency-1 shared provider control plane ready for bounded canaries.

- [ ] Obtain explicit authorization to start real provider processing. Start the exact installed service and verify it claims with the expected runner auth without printing a token:

      systemctl start patternlike-codex-runner
      systemctl is-active patternlike-codex-runner

- [ ] Observe only content-free service events. Confirm one runner process, concurrency `1`, expected poll interval, expected API origin, expected CLI version, and no repeated auth/model/allowance failures.
- [ ] Query D1 for counts and oldest age by `pipeline`, `pass`, and safe `status`; compare Pattern, ontology, and reading call ledgers for the current UTC date. Do not select encrypted envelopes, artifact object keys, request hashes associated with users, or identifiers that are not needed for the change record.
- [ ] Confirm idle polling consumes no provider budget and a terminal old provider row is not reclaimed.
- [ ] Stop the service immediately on auth mismatch, wrong model, allowance exhaustion, schema incompatibility, plaintext output, or a repeated claim/fail loop. Do not enable another publisher.

## Task 8: Verify scheduled and first-open Daily canaries

**Evidence:** Restricted change record; no repository file changes.

**Interfaces:**

- Consumes: Task 7's live control plane, fresh Daily consent, and production scheduler/first-open product surfaces.
- Produces: real scheduled and first-open Daily evidence tied to `CANDIDATE_SHA`.

- [ ] Obtain canary authorization and use approved test accounts with active charts, confirmed locale/timezone, and fresh Daily consent policy `1.1.0` (or the later reviewed version). Never paste account ids or birth data into the committed runbook or PR.
- [ ] For the scheduled path, wait for the ordinary production cron to reserve the canary's local day. Do not invoke internal generation helpers or edit D1 to fabricate eligibility.
- [ ] For the first-open path, use the normal authenticated Today request on a missing eligible day. Prove it adopts or creates the same reservation semantics as scheduled work.
- [ ] For each path, record content-free evidence tied to `CANDIDATE_SHA`: trigger class, opaque reading/job/provider ids in the restricted record, `reading/publisher`, stage generation/attempt, safe lifecycle timestamps, terminal status, model/prompt/schema pins, integer usage, budget delta, artifact hashes/lifecycle, and published `provider="codex"` provenance.
- [ ] Prove pending/leased Codex work releases the Daily Queue lease without consuming another Daily attempt; provider terminalization nudges the opaque Daily message; and publication cleans exchange artifacts while leaving the encrypted published reading readable.
- [ ] Prove scheduled and first-open delivery for the same account/day converge on one reservation, one Daily job, and one current provider coordinate.
- [ ] Stop on OpenAI routing, a synthetic response, attempt drift, duplicate publication, stale consent acceptance, invalid output acceptance, unhashed/plaintext logs, budget mismatch, missing nudge recovery, or retained exchange artifacts past the maintenance contract.
- [ ] If Daily alone is faulty, change `READING_V5_ROLLOUT` to `off` in a reviewed rollback candidate and deploy it; stop the runner only if shared provider containment is also needed. Do not mutate a frozen command to another provider.

## Task 9: Verify an account-wide Pattern canary

**Evidence:** Restricted change record; no repository file changes.

**Interfaces:**

- Consumes: Task 7's live control plane, Task 2's public ontology, fresh Pattern consent, and the ordinary authenticated confirmation flow.
- Produces: one real formerly non-allowlisted Pattern and no-reroll evidence tied to `CANDIDATE_SHA`.

- [ ] Use an authenticated eligible account that was not in the removed allowlist and has no consumed claim for its current chart fingerprint. Grant fresh Pattern consent policy `1.1.0` (or the later reviewed version) through the product UI.
- [ ] Submit the exact confirmation `GENERATE MY PATTERN` through the ordinary authenticated endpoint. Do not create a grant, claim, job, or document directly in D1.
- [ ] Prove the request pins the exact ontology version verified in Task 2, enters the same generated flow as every other account, and runs planner/writer/verifier only through Codex.
- [ ] Record content-free evidence tied to `CANDIDATE_SHA`: opaque generation/provider ids in the restricted record, stage generations/attempts, safe terminal states, model/prompt/schema pins, call/token integers, budget delta, ontology version/hashes, artifact cleanup, candidate/verdict hashes, published provenance, and final ready state.
- [ ] Repeat the request and prove the accepted/consumed claim prevents a reroll. Revoke consent and verify its defined read/delete behavior without exposing the document in logs or evidence.
- [ ] Stop on any account/cohort/allowlist decision, an ontology version other than the one verified in Task 2, more than the bounded stage attempts/calls, OpenAI/Workers/synthetic routing, human content substitution, validation bypass, plaintext output, duplicate claim, or budget mismatch.
- [ ] Pattern has no account gate to flip off. On a Pattern product fault, stop the runner, roll the entire Worker back to the recorded last-known-good version, verify old behavior against migration `0017`, and preserve historical provenance/jobs for incident analysis.

## Task 10: Observe, close, and separately retire an unused OpenAI secret

**Evidence:** Restricted change record and PR comments; no repository file changes in the observation phase.

**Interfaces:**

- Consumes: Tasks 8-9's successful canaries and all queue/provider/cleanup telemetry.
- Produces: the rollout closure verdict and, only if independently proven safe, a separately authorized OpenAI-secret deployment.

- [ ] Observe at least four Daily scheduler intervals and one complete 15-minute shared maintenance interval after both canaries. Record counts/oldest age by pipeline and safe status, failure codes, lease recovery, nudge repair, queue lag, artifact cleanup, and all three budget ledgers.
- [ ] Require zero unexplained pending-age growth, repeated lease churn, content leakage, stale-owner adoption, over-budget claims, or failed cleanup before declaring the rollout stable.
- [ ] Run final repository verification from a clean checkout of `CANDIDATE_SHA` and attach the new complete summary to the PR/change record:

      nvm use "$(cat .nvmrc)"
      npm ci
      npm run ci:local

- [ ] Confirm the runbooks committed in Tasks 1-2 accurately describe Codex Daily, account-wide Pattern, public ontology, Daily rollback, and whole-Worker Pattern rollback. Record current observed deployment state in the restricted change record rather than creating a second source SHA.
- [ ] Mark the rollout complete only when Daily scheduled, Daily first-open, and non-allowlisted Pattern have all published through the production runner and the observation window is clean.
- [ ] Treat `OPENAI_API_KEY` deletion as a separate change. First prove with `rg`, config tests, deployed configuration, and ontology-pipeline inspection that no remaining production feature—including ontology regression—uses it.
- [ ] If and only if it is unused, obtain separate authorization and delete the secret interactively so its value never enters shell history:

      npx wrangler secret delete OPENAI_API_KEY --config apps/api/wrangler.toml --env production

- [ ] Verify the secret-name inventory, resulting Worker version/deployment, health, runner claim path, Daily read, and Pattern read after deletion. Roll back that separate deployment if any non-reader feature still depends on the secret.
- [ ] Do not make a post-rollout documentation commit on `main`: it would trigger another Workers Build and sever the one-SHA evidence chain. Close the restricted change record and PR comments against `CANDIDATE_SHA` instead.

## Rollout acceptance

- [ ] One immutable SHA owns migration, source, local gate, build, deployment, provider, and canary evidence.
- [ ] Contractual-use and exact-workspace data controls are approved and referenced without leaking private account details.
- [ ] A signed, non-recalled, compiling ontology from a `licensed_excerpt` corpus is active, and its provenance branch was verified against the deployed predicate with the authored-release trade recorded.
- [ ] `0017` was backed up, rehearsed, applied, and verified before the compatible Worker reached `main`.
- [ ] Deployed Pattern has no allowlist, cohort, rollout variable, or replacement account gate.
- [ ] Scheduled and first-open Daily both publish through Codex and converge correctly.
- [ ] A formerly non-allowlisted eligible account publishes Pattern through Codex with fresh consent and exact confirmation.
- [ ] Historical OpenAI evidence remains readable, but no new Daily/Pattern command can route to OpenAI, Workers AI, or synthetic.
- [ ] D1 attempts/budgets, Queue leases/nudges, R2 encryption/cleanup, stale-owner checks, and erasure behavior match the approved design.
- [ ] Observation is clean and rollback evidence is executable; any OpenAI secret retirement is evidenced as a separate deployment.
