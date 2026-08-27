# Codex reader rollout

Release Codex-backed Daily readings and account-wide Pattern from one commit.

Nothing here has been executed. Fill the values as you go.

```
CANDIDATE_SHA =
BASE_SHA      =
ROLLOUT_DIR   =            # mktemp -d, chmod 700, outside the repo
```

## The one ordering rule

Merging to `main` triggers Workers Builds, which deploys automatically. It is
not affected by the GitHub Actions billing lock. So **`0017` must be applied to
production before the merge**, not after — a Worker that reaches the old CHECK
fails every Daily enqueue closed, and because the enqueue is `INSERT OR IGNORE`
it fails as the *retryable* class and loops while orphan R2 objects accumulate.

Everything else in this file is in execution order.

## Before you start

`npm run ci:local` is the merge gate — Actions is billing-locked and `main` is
not branch protected. It needs Node 22 (`nvm use 22`) and a repo-local `.venv`
(bootstrap in `AGENTS.md`). Paste its SUMMARY block into the PR.

```bash
git fetch origin
git status --short                                  # must be empty
git merge-base --is-ancestor origin/main HEAD
nvm use "$(cat .nvmrc)" && npm ci
npm run ci:local
npm run build
```

If `origin/main` moves after this, redo it.

**Data controls.** This sends calculated astrological facts to a model through
your ChatGPT-authenticated Codex CLI, and gets back prose about a specific
person. No birth value, chart id, user id, or consent id crosses that boundary —
`findPatternInputViolation` in `services/pattern-packet.ts` enforces it. Before
real reader packets flow, know: which OpenAI agreement governs the account,
whether training is off, and the retention/deletion window. Recorded
2026-08-27 as operator-asserted, not observed: training disabled, feedback
sharing disabled, environment training not applicable, retention verified. The
agreement class is still unnamed.

## 1. Ontology

Pattern serves from the authored `synthetic_internal` release already active.
`ontologyServesAccount` admits it on origin alone. The `machine_pipeline` branch
still needs `public` scope and its whole evidence chain, but nothing has ever
earned it — fifteen candidate versions, zero passes.

The trade, so it isn't rediscovered mid-incident: an authored release skips the
independent evaluator and the seven regression hard gates
(`suppressed_feature_leak`, `uncited_astrological_claim`,
`source_dependency_failure`, `prohibited_claim`, `mandatory_feature_omission`,
`private_projection_leak`, `semantic_refusal`). Those run nowhere else in the
product. Pattern is account-wide, so nothing contains the consequence.

Confirm what is actually active and that it verifies offline:

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote \
  --command "SELECT p.active_version, r.status, r.bundle_hash, r.object_key, r.recalled_at
             FROM pattern_ontology_pointer p
             LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version
             WHERE p.id = 1"

npx wrangler r2 object get "pattern-artifacts/$ONTOLOGY_OBJECT_KEY" \
  --config apps/api/wrangler.toml --env production --remote \
  --file "$ROLLOUT_DIR/active-ontology.json"

npm run ontology:release:verify -w @patternlike/api -- \
  --bundle "$ROLLOUT_DIR/active-ontology.json" --keys-file "$ONTOLOGY_KEYS_FILE" \
  --expected-version "$ONTOLOGY_VERSION" --expected-bundle-hash "$ONTOLOGY_BUNDLE_HASH" \
  --expected-corpus-hash "$ONTOLOGY_CORPUS_HASH"
```

Failure prints `FAIL <code>` on **stderr** and exits 1. Delete the bundle after.

**Stop on:** signature or hash mismatch, a recall, a compile failure, a
non-`licensed_excerpt` corpus, absent or unrecognised provenance, or a
`machine_pipeline` release whose scope does not derive `public`.

**TODO(verify):** whether the active release's corpus is registered in
production `pattern_source_corpus_releases`.

## 2. Migration 0017

`0017_codex_reading_provider.sql` rebuilds `codex_provider_jobs` forward-only to
widen three closed relationship CHECKs so `reading`/`publisher` becomes legal.
SQLite cannot alter a CHECK, so it stages the child rows, drops both tables in
dependency order, recreates the widened parent plus all four indexes, and
restores. Production already holds Pattern and ontology rows it must carry
through untouched.

Back up first — this is the only real recovery path:

```bash
npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
# exactly 0017 may be pending; stop on anything else

npx wrangler d1 time-travel info patternlike-ops --config apps/api/wrangler.toml --env production \
  --json > "$ROLLOUT_DIR/time-travel-before-0017.json"
npx wrangler d1 export patternlike-ops --config apps/api/wrangler.toml --env production --remote \
  --output "$ROLLOUT_DIR/pre-0017.sql"
chmod 600 "$ROLLOUT_DIR"/pre-0017.sql "$ROLLOUT_DIR"/time-travel-before-0017.json
sha256sum "$ROLLOUT_DIR/pre-0017.sql" > "$ROLLOUT_DIR/pre-0017.sha256"
```

Record row counts, `PRAGMA foreign_key_check`, and `PRAGMA quick_check` before.
Rehearse against the real export, then apply:

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml \
  --local --persist-to "$ROLLOUT_DIR/d1-rehearsal" --file "$ROLLOUT_DIR/pre-0017.sql"
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml \
  --local --persist-to "$ROLLOUT_DIR/d1-rehearsal"

# only if the rehearsal is clean:
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Repeat every count and pragma after. Time Travel retains ~30 days.

**TODO(verify):** the exact `d1 time-travel restore` invocation. Nothing in this
repo records one.

## 3. Merge and verify the deploy

```bash
git rev-parse origin/main                           # must still equal BASE_SHA
git push origin "$CANDIDATE_SHA:refs/heads/main"    # fast-forward, no squash
```

Watch the Workers Build; confirm its source commit is exactly `CANDIDATE_SHA`.

```bash
npx wrangler deployments list --config apps/api/wrangler.toml --env production
curl --fail --silent --show-error https://patternlike-api-production.lfd.workers.dev/health
```

Verify deployed: `READING_V5_ROLLOUT=hybrid`, `READING_PUBLISHER=codex`,
`PATTERN_PUBLISHER=codex`, `ONTOLOGY_PIPELINE_ROLLOUT=off`, the 900000-ms
timeouts, both crons (`*/15` and `7,22,37,52`), no `PATTERN_AI_ROLLOUT`, no
`PATTERN_INTERNAL_ACCOUNT_IDS`.

The runner stays stopped until this passes. Encrypted pending jobs accumulating
meanwhile is expected.

## 4. Start the runner

```bash
npm run build -w @patternlike/codex-runner
tar -czf "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz" -C apps/codex-runner dist package.json probes
sha256sum "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz"
```

On the host, as the runner account: confirm `codex login status` resolves to the
approved workspace, concurrency is 1, the env file is root-owned `0600`, and
there are no Cloudflare/D1/R2 credentials. Then:

```bash
systemctl start patternlike-codex-runner
systemctl is-active patternlike-codex-runner
```

**Stop immediately on:** auth mismatch, wrong model, allowance exhaustion,
plaintext output, or a repeated claim/fail loop.

**TODO(verify):** the reviewed Codex CLI version — nothing in the repo pins one.

## 5. Canaries

**Daily, scheduled.** Wait for the ordinary production cron. Do not call
`POST /internal/readings/generate` — it takes the same enqueue path and would
fabricate the evidence you are trying to collect.

**Daily, first-open.** Normal authenticated Today request on a missing eligible
day. Same account and day must converge on one reservation, one job, one current
provider coordinate.

**Pattern.** An eligible account that was never in the removed allowlist, fresh
consent, exact confirmation `GENERATE MY PATTERN` through the ordinary endpoint.
Repeat it and prove the consumed claim blocks a reroll.

**Stop on:** OpenAI routing, synthetic response, attempt drift, duplicate
publication, stale consent acceptance, budget mismatch, or retained exchange
artifacts.

## 6. Rollback

| Fault | Action | Does not cover |
| --- | --- | --- |
| Daily only | `READING_V5_ROLLOUT=off` in a reviewed candidate, deploy | Pattern; in-flight provider work |
| Provider-wide | `systemctl stop patternlike-codex-runner` | Anything already published |
| Pattern | `npx wrangler rollback <version-id> --config apps/api/wrangler.toml --env production` | D1 — `0017` stays applied. Not the ontology, published documents, consumed claims, R2 artifacts, or spend |
| Bad ontology | Recall the active release | Patterns already generated |
| Schema | Time Travel restore to the recorded bookmark | ~30-day window |

**The Worker rollback is wider than it looks.** The pre-candidate deployment is
built from `origin/main`, whose production block declares only the
`7,22,37,52` cron — no `*/15` lane at all — plus `READING_V5_ROLLOUT=first_open`
and `READING_PUBLISHER=openai`. Rolling back therefore removes the Daily
scheduler, privacy maintenance and the Pattern sweep, and points Daily at a
transport that no longer exists. Any `pipeline='reading'` rows left in D1 get no
nudge repair and no artifact purge.

**TODO(verify):** whether a version rollback restores that version's cron list.

## Things that will surprise you

- **Pattern has no kill switch.** `READING_V5_ROLLOUT` is Daily only. Pattern
  containment is stopping the runner or rolling the whole Worker back.
- **`OPENAI_API_KEY` is unused by pin, not by deletion.** Both ontology
  publisher branches test `resolved.config.publisher === "codex"`. Flip that pin
  and the key is load-bearing again. Delete it as a separate change, after
  proving nothing reads it.
- **No post-rollout doc commit on `main`.** It triggers another Workers Build
  and breaks the one-commit evidence chain.
