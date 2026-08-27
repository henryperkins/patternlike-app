# Codex reader rollout — active runbook

**Created:** 2026-08-27

**Status:** NOT RUN. No step in this file has been executed. Every remote,
production, or real-provider section below opens with its own `**State:** NOT
RUN` line and an `**Evidence required:**` line naming what the restricted change
record must receive. A blank field means the step has not been performed; it
does not mean the step passed.

This file is the ordered procedure for releasing Codex-backed Daily readings and
account-wide Pattern from one immutable candidate. It implements
[`../superpowers/plans/2026-08-27-codex-reader-rollout.md`](../superpowers/plans/2026-08-27-codex-reader-rollout.md),
which remains the authority on task ordering and stop conditions.

## How to read this file

- **Nothing here authorizes anything.** The operator must explicitly authorize
  each production mutation at its own checkpoint: the ontology decision, the
  named migration, the runner service change, the merge and deploy, each canary,
  and the later secret retirement. Committing this runbook is not that
  authorization, and neither is a successful dry run.
- **One SHA owns everything.** Every code, migration, build, provider,
  deployment, and canary result must resolve to the single `CANDIDATE_SHA`
  recorded in the first section. If `origin/main` moves, the candidate is
  rebuilt and `npm run ci:local` rerun before any production action.
- **Nothing private is committed here.** No prompt, response, generated prose,
  birth value, chart packet, user id, consent id, account or workspace identity,
  lease token, artifact key, or credential appears in this file. Those live in
  the restricted change record, referenced by opaque id.
- **A source declaration is not an observation.** Committed configuration says
  what the next deploy would carry, not what production is serving. Every
  verification step below re-queries the live surface.
- **`npm run ci:local` is the merge gate.** GitHub Actions is billing-locked on
  this account and fails before checkout; `main` is not branch protected. A
  green local gate is local build and test evidence only and proves nothing
  about production state.

## Two decisions this runbook inherits

**Pattern serves from an authored ontology.** `ontologyServesAccount` admits a
`synthetic_internal` release on origin alone. The `machine_pipeline` branch
still earns `public` scope only by producing its whole evidence chain, but the
authored release now active does not, and does not need to. Fifteen machine
candidate versions are logged in
[`openai-pattern-rollout.md`](./openai-pattern-rollout.md) and none passed the
regressing stage, so requiring a public machine release would close Pattern for
every reader rather than open it. The trade: an authored release skips the
independent evaluator and the seven regression hard gates, and those gates run
nowhere else in the product. Since Pattern is account-wide, nothing contains the
consequence. This is recorded so it is not rediscovered during an incident.

**Pattern has no kill switch.** `READING_V5_ROLLOUT` contains Daily only.
Stopping the runner is the shared provider containment control. A Pattern fault
is contained by rolling the entire Worker back to the last known-good version.

---


## Candidate identity

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the full candidate SHA, the base SHA, the branch name, `node -v` / `npm -v` / `npx wrangler --version` as observed on the build host, the `package-lock.json` sha256, the `ci:local` verdict together with the retained `$ROLLOUT_DIR/ci-local.txt`, the dry-run artifact checksum file `$ROLLOUT_DIR/dry-run-files.sha256`, and the exact restricted rollout directory path. The complete `ci:local` summary must be pasted into the PR. Nothing below is pre-filled; a field left blank means the step has not been executed.

| Field | Value | Source when executed |
| --- | --- | --- |
| `CANDIDATE_SHA` (full) | | `git rev-parse HEAD` after every check passes |
| `BASE_SHA` (full) | | `git rev-parse origin/main` |
| Branch | | `git rev-parse --abbrev-ref HEAD` |
| Node version | | `node -v` — must match `.nvmrc`, which pins major `22` |
| npm version | | `npm -v` — the repository pins no npm version (`engines` names only `node: >=20`) |
| Wrangler version | | `npx wrangler --version` — `package-lock.json` resolves `node_modules/wrangler` at `4.116.0`; `apps/api/package.json` declares `^4.16.1` and `apps/ontology-signer/package.json` pins `4.116.0` |
| `package-lock.json` sha256 | | `$ROLLOUT_DIR/package-lock.sha256` |
| `ci:local` verdict | | final line of `$ROLLOUT_DIR/ci-local.txt` plus its exit status |
| Dry-run artifact checksum | | `$ROLLOUT_DIR/dry-run-files.sha256` |
| Restricted rollout directory (`$ROLLOUT_DIR`) | | recorded in the restricted change record; keep only its restricted-record reference here |
| Migration present on the candidate | | `db/d1/0017_codex_reading_provider.sql` |

The rollout directory is created once, in Task 1, and the same task-specific variable is restored at the start of every later operator shell:

```bash
ROLLOUT_DIR="$(mktemp -d /home/henry/patternlike-codex-readers.XXXXXX)"
chmod 700 "$ROLLOUT_DIR"
```

### Freeze procedure (plan Task 3)

Prove the implementation branch contains plans 1 and 2, migration `0017`, the reviewed release-gate commit, and no unrelated working-tree changes:

```bash
git fetch origin
git status --short
git log --oneline --decorate -12
git merge-base --is-ancestor origin/main HEAD
```

Reconcile or remove all working-tree changes before continuing. Do not build or deploy from the planning checkout's pre-existing dirty state.

Pin the repository Node and install the lockfile exactly:

```bash
nvm install "$(cat .nvmrc)"
nvm use "$(cat .nvmrc)"
npm ci
```

Run the local merge gate and save its complete output outside the repository in an owner-only directory:

```bash
test -d "$ROLLOUT_DIR"
test "$(stat -c '%a' "$ROLLOUT_DIR")" = "700"
npm run ci:local | tee "$ROLLOUT_DIR/ci-local.txt"
test "${PIPESTATUS[0]}" -eq 0
```

Run the production dry-run build again after the gate and ensure it resolves the production environment:

```bash
npm run build
find apps/api/dist apps/web/dist -type f -print0 | sort -z | xargs -0 sha256sum > "$ROLLOUT_DIR/dry-run-files.sha256"
```

Record `BASE_SHA="$(git rev-parse origin/main)"`, then freeze the exact candidate only after all checks pass:

```bash
CANDIDATE_SHA="$(git rev-parse HEAD)"
git status --short
git show --stat --oneline "$CANDIDATE_SHA"
sha256sum package-lock.json > "$ROLLOUT_DIR/package-lock.sha256"
```

An empty `git status --short` is required. If the branch, lockfile, generated assets, migration, consent copy, config, or docs change after this point, the candidate is invalidated and this task repeats. Every code, migration, build, provider, deployment, and canary result in this runbook must resolve to the one `CANDIDATE_SHA` recorded above; if `origin/main` moves, rebuild the candidate and rerun `npm run ci:local` before any production action.

### What `npm run ci:local` actually covers

GitHub Actions is billing-locked on this account and is expected to fail before checkout, and `main` is not branch protected, so `npm run ci:local` (`scripts/ci-local.sh`) is the merge gate. It runs every lane rather than stopping at the first failure, and exits `0` only when all of them pass.

Two preconditions abort with exit `2` before any lane runs: the running Node major must equal `.nvmrc` (`22`), and a repository-local `.venv` must exist (the contracts lane needs it; this host's Python is externally managed with no `ensurepip`, and the bootstrap is in `AGENTS.md`).

Mirroring `.github/workflows/ci.yml`, in order:

1. `contracts: npm run test:contracts` — the workflow's whole `contracts` job (spec renderers, `contracts/validate_schemas.py`, `contracts/m0/smoke_check.py`, `contracts/smoke_check.py`). `ci.yml` pins Python `3.12`; the script warns when the local interpreter differs instead of failing.
2. `monorepo: npm ci --dry-run` — proves the lockfile agrees with `package.json`, which is what Workers Builds' `npm clean-install` enforces. `scripts/ci-local.sh --clean` runs a full `npm ci` instead.
3. `monorepo: ephemeris download` — `npm run ephe:download -w @patternlike/calc-stub`. It needs network: `apps/calc-stub/scripts/download-ephe.mjs` fetches each file from `raw.githubusercontent.com` at the commit pinned in `apps/calc-stub/ephemeris.lock.json`. `--skip-ephe` skips it, printing `… skipped ephemeris download (--skip-ephe)` inline where the lane would have run; the lane is then absent from the `SUMMARY` block entirely, so a pasted summary does not disclose the skip — say so in the PR yourself.
4. `monorepo: npm run typecheck`
5. `monorepo: test @patternlike/shared`
6. `monorepo: test @patternlike/reading-engine`
7. `monorepo: test @patternlike/calc-stub`
8. `monorepo: test @patternlike/ontology-signer`
9. `monorepo: test @patternlike/api`
10. `monorepo: test @patternlike/web`
11. `monorepo: npm run build` — ends in the api workspace's `wrangler deploy --dry-run --outdir=dist --env production`, the only check that reads the `[env.production]` block Workers Builds ships. `--dry-run` contacts no Cloudflare API and needs no credentials, and `--outdir=dist` is what writes `apps/api/dist` for the checksum step above.

Three further lanes `ci.yml` never listed, reported separately under "Beyond ci.yml" so the mirror claim stays exact:

12. `extra: test @patternlike/pattern-engine`
13. `extra: test @patternlike/codex-runner`
14. `extra: npm run test:content`

The script prints a `SUMMARY` block carrying the short commit, branch, Node/npm/Python versions and a pass/FAIL line per lane, ending in `ALL STEPS PASSED — safe to merge on local evidence.` or `AT LEAST ONE STEP FAILED — do not merge.` That block is what gets pasted into the PR; an unpasted claim that tests pass is not evidence, because no green check will ever appear.

There is no linter or formatter lane, and no lane contacts the Cloudflare API, a D1/R2/Queue binding, or the Codex provider — the build lane's `wrangler deploy --dry-run` needs no Cloudflare credentials — though the contracts, install, and ephemeris lanes do reach the network. A green `ci:local` is local build/test evidence only and proves nothing about production state.

## Release gate record

**State:** NOT RUN

**Evidence required:** before any real reader packet is sent, the restricted change record must hold, recorded by the authorized reviewer: the exact account/workspace identity; the governing agreement class; explicit approval or rejection of unattended customer-application use through the ChatGPT-authenticated Codex CLI workspace; the applicable retention/deletion terms; the ordinary training/data-sharing state; the full-environment training state; the feedback state; and the review date. The reviewer re-opens the current official sources named in the approved design — Codex plan use, training/data-sharing controls, enterprise privacy, Terms of Use, and Services Agreement — as part of that review. Exact identity and agreement evidence stay in the restricted record; this committed file carries only the fields below.

| Field | Value |
| --- | --- |
| Restricted change-record reference | |
| Reviewer role | |
| Review date | |
| Agreement class | |

Closed verdicts, unset until the reviewer closes them:

```
contractual_use: approved | rejected
ordinary_training: disabled | not_applicable | unverified
full_environment_training: disabled | not_applicable | unverified
feedback_sharing: disabled | not_applicable | unverified
retention_deletion: verified | unverified
```

**Stop condition.** Stop if `contractual_use` is not `approved`, or if any applicable data-control verdict is `unverified`. Stopping here means no runner start, no canary, no merge — the rest of this runbook does not begin.

**This gate needs a human reviewer.** It cannot be closed by an agent, and a successful `codex exec` call is not authorization: that the CLI answers proves only that a request was accepted, not that unattended customer-application use is permitted, nor that training, data-sharing, feedback, or retention settings are what the product requires. Neither is a source setting, a dry run, a model preflight, an old Pattern run, or a GitHub Actions result. Only the named reviewer, on the record referenced above, may set these verdicts.


## Active ontology

**State:** NOT RUN
**Evidence required:** the restricted change record must receive (a) the inventory-query output reduced to counts, opaque ids, hashes, statuses, provenance and timestamps, (b) which provenance branch the scope predicate was read against and the derived `activation_scope`, (c) the offline verifier's single result line, verbatim and unedited, and (d) the completed release-identity fields in §6 below. No ontology record, rule text, corpus excerpt, or reader-facing prose may be copied into the record, this runbook, a terminal transcript, or a ticket.

This section proves *which* ontology the deployed Worker will serve Pattern from, and on what assurance. It changes nothing. Nothing here authorizes starting a new paid ontology candidate or activating a release; that requires separate, explicit operator authorization at this checkpoint.

### 0. Preconditions

- The external contractual/data-control gate in the release-gate record is closed with `contractual_use: approved` and no applicable verdict left `unverified`.
- `ROLLOUT_DIR` is restored in this shell and is mode `700`.
- `ONTOLOGY_KEYS_FILE` points at the public verification keyring held in the restricted change system. The deployed production keyring is the `PATTERN_ONTOLOGY_KEYS` var in `[env.production.vars]` of `apps/api/wrangler.toml`, which declares exactly one key id, `ontology-machine-2026-08`. A bundle signed under any other key id will not verify in the Worker either.
- Do not rely on a dated runbook — including `docs/deploy/openai-pattern-rollout.md` — for what is active. Query production.

### 1. Inventory the active pointer

**State:** NOT RUN
**Evidence required:** the restricted change record receives this query's output reduced to opaque ids, hashes, statuses, provenance values and timestamps, plus an explicit note of whether the `e.*` evidence columns came back populated or `NULL`. Nothing else from the row leaves the terminal.

Run exactly:

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT p.active_version, r.status, r.object_key, r.bundle_hash, r.corpus_release_hash, r.recalled_at, e.run_id, e.activation_scope, e.run_status, e.evidence_status, e.evaluation_artifact_status, e.compiler_passed, e.evaluator_passed, e.unevaluated_fixture_count, e.corpus_license_class, e.corpus_public_capable, e.evaluation_report_hash, e.regression_report_hash, e.signing_key_id, json_extract(r.evaluation_json, '\$.regression_passed') AS regression_passed, json_extract(r.evaluation_json, '\$.regression_report_hash') AS release_regression_report_hash FROM pattern_ontology_pointer p LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version LEFT JOIN pattern_ontology_pipeline_evidence e ON e.ontology_version = r.version AND e.bundle_hash = r.bundle_hash WHERE p.id = 1"
```

> The `$` in the two `json_extract` paths is escaped above only so a shell does not expand `$.regression_passed`. The SQL the plan pins is `'$.regression_passed'` / `'$.regression_report_hash'`; if you paste from the plan instead, keep it byte-identical and confirm your shell did not eat the `$`.

The `e.*` columns come from `pattern_ontology_pipeline_evidence` through a `LEFT JOIN`. For an authored release there is no evidence row, so every `e.*` column returns `NULL`. That is the expected shape for the branch below, not a failed query.

Record from this query: `active_version`, `status`, `object_key`, `bundle_hash`, `corpus_release_hash`, `recalled_at`, and whether the evidence columns were present or `NULL`.

### 2. Read the deployed scope predicate, not this runbook

**State:** NOT RUN
**Evidence required:** the restricted change record receives the derived `activation_scope`, the `provenance.origin` branch it was read against, and the file and line range of the predicate the read-only query was transcribed from. Record the derivation, not the ontology.

The inventory query alone is not proof. `activation_scope` is not a stored flag: `ONTOLOGY_ACTIVATION_SCOPE_SQL` (`apps/api/src/db/pattern-ontology.ts:27-214`) is interpolated into both loaders and re-derives `public` or `internal` on every read. Run a read-only query using the current joins and predicates from that file and read the result against the branch the release's own provenance selects.

Both branches first pass the same release-integrity checks, which are not part of the scope CASE:

| Check | Where |
| --- | --- |
| `pattern_ontology_pointer.active_version` set, joined release row present, `status = 'active'` | `pattern-ontology.ts:322` |
| R2 object at `object_key` exists and parses as a JSON object | `pattern-ontology.ts:271-283` |
| Bundle hash recomputed from the signature-stripped release equals **both** the D1 `bundle_hash` and the in-bundle `bundle_hash` | `pattern-ontology.ts:287-290` |
| Signature verifies against `PATTERN_ONTOLOGY_KEYS`; an empty keyring is a refusal unless `ENVIRONMENT` is development/test **or** `AUTH_STUB=1` | `pattern-ontology.ts:291-297` |
| `compileOntologyRelease` passes | `pattern-ontology.ts:298-300` |

Then `ontologyServesAccount` (`pattern-ontology.ts:253-263`) dispatches on `release.provenance.origin`:

| Origin in the signed bytes | What the deployed predicate requires | Outcome |
| --- | --- | --- |
| `machine_pipeline` | `activation_scope` must derive to `public` (`pattern-ontology.ts:258`) | serves only with the whole evidence chain |
| `synthetic_internal` | origin alone (`pattern-ontology.ts:262`); scope is `internal` by construction and is **not** a refusal | serves |
| any other value, or absent | neither branch matches | refuse |

**For a `machine_pipeline` release**, `public` is earned only when every one of these holds together — read them from the SQL, do not paraphrase them into a shorter check: an evidence row joined on `(ontology_version, bundle_hash)` with `activation_scope = 'public'`, `run_status = 'succeeded'`, `evidence_status = 'committed'`, `evaluation_artifact_status = 'committed'`, `compiler_passed = 1`, `evaluator_passed = 1`, `unevaluated_fixture_count = 0`, `corpus_license_class = 'licensed_excerpt'`, `corpus_public_capable = 1`, and `corpus_release_hash` equal to the release row's; the release's own `evaluation_json` agreeing with the evidence on `evaluation_report_hash` and `regression_report_hash` and carrying `regression_passed = 1`; well-formed `sha256:`-prefixed 71-character regression report, envelope, and ciphertext hashes; a live `pattern_ontology_pipeline_artifacts` row for the `regressing` stage's `regression_report` at the pinned `stage_generation`/`stage_attempt` with matching plaintext/envelope/ciphertext hashes and neither `expires_at` nor `deleted_at` set; an `evaluating`-stage evaluation-report artifact coordinate (canonical object key, or a live artifact row matching all three hashes); and a `pattern_ontology_evaluation_runs` receipt with `verdict = 'pass'` whose `summary_json` agrees field-for-field with the evidence row — run id, version, scope, bundle hash, corpus release id/hash/license class/public-capable, evaluation report and artifact hashes, `regression_passed = 1`, regression report hash and artifact coordinates, signing key id, `compiler_passed`, `evaluator_passed`, `unevaluated_fixture_count`. Compare the committed receipt and the evaluation/regression artifact coordinates and hashes to the selected evidence row.

**For an authored `synthetic_internal` release** there is no evidence row and no receipt to compare, so the CASE falls to `internal` and the machine branch's scope check is simply not what admits it. That is the point of §3: the bundle's own bytes are the only assurance left, so all four of the bundle checks must hold.

Do not read the bundle's embedded `evaluation` block as an evaluator verdict. `build-internal-ontology.ts:160-169` writes `verdict: "pass"`, `compiler_passed: true`, `evaluator_passed: true`, `regression_passed: false` into the release itself, and `storeOntologyRelease` persists that block verbatim as `pattern_ontology_releases.evaluation_json` (`pattern-ontology.ts:568-581`). Those are the builder's own assertions. The scope CASE never treats them as evidence — it cross-checks them *against* the pipeline evidence row, which an authored release does not have.

### 3. Download the active bundle and verify it offline

**State:** NOT RUN
**Evidence required:** the restricted change record receives the verifier's single result line verbatim and unedited — from stdout on the passing path, from stderr on the failing path — its exit code, the R2 object key and expected version/bundle-hash/corpus-hash the run was given, and confirmation that `$ROLLOUT_DIR/active-ontology.json` was deleted. No bundle bytes, records, or prose are copied anywhere.

Copy the exact `object_key`, version, bundle hash, and corpus hash from §1 into task-scoped shell variables, then run exactly:

```bash
test -d "$ROLLOUT_DIR"
test -n "$ONTOLOGY_OBJECT_KEY" && test -n "$ONTOLOGY_VERSION"
test -n "$ONTOLOGY_BUNDLE_HASH" && test -n "$ONTOLOGY_CORPUS_HASH"
test -f "$ONTOLOGY_KEYS_FILE"
npx wrangler r2 object get "pattern-artifacts/$ONTOLOGY_OBJECT_KEY" --config apps/api/wrangler.toml --env production --remote --file "$ROLLOUT_DIR/active-ontology.json"
npm run ontology:release:verify -w @patternlike/api -- --bundle "$ROLLOUT_DIR/active-ontology.json" --keys-file "$ONTOLOGY_KEYS_FILE" --expected-version "$ONTOLOGY_VERSION" --expected-bundle-hash "$ONTOLOGY_BUNDLE_HASH" --expected-corpus-hash "$ONTOLOGY_CORPUS_HASH"
```

`pattern-artifacts` is the production bucket bound to `ARTIFACTS` (`apps/api/wrangler.toml:532-533`); ontology object keys are prefixed `pattern-ontology/` (`pattern-ontology.ts:20`).

**What the verifier must report.** The command prints one bounded line and exits `0`:

```
PASS version=<ontology_version> bundle_hash=<sha256:...> corpus_release_hash=<sha256:...> signing_key_id=<key id> origin=<origin>
```

The operator must see, on that line and from a `0` exit: the provenance expected for the release's branch, the signing key id, the version/bundle-hash/corpus-hash matches, a valid signature, and a compiler pass. For an authored release these four — hash match, signature, signing key id, compile — are the whole of its assurance, so none of them may be waived, and none may be inferred from a dated document or from the D1 row alone. On failure the command prints `FAIL <code>` **on stderr** and exits `1`; the codes are `bundle_missing`, `bundle_json_invalid`, `bundle_not_an_object`, `ontology_version_mismatch`, `corpus_release_hash_mismatch`, `provenance_not_machine_pipeline`, `bundle_hash_mismatch`, `keys_missing`, `keys_json_invalid`, `keys_empty`, `compiler_rejected`, the signature rejection class, and `verification_failed` for anything else. A malformed argument list is different again: the usage text on stderr and exit `2`, with no `FAIL` line. Capture both streams. The verifier never prints ontology records or prose on either path.

**Known blocker on the authored branch.** As committed on this branch, `ontology:release:verify` requires `machine_pipeline`. It checks `ontology_version`, then `corpus_release_hash`, then origin, and fails at `apps/api/scripts/verify-active-ontology-bundle.ts:130` with `FAIL provenance_not_machine_pipeline` — *before* it recomputes the bundle hash, loads the keyring, verifies the signature, or compiles (lines 133-154). `apps/api/scripts/verify-active-ontology-bundle.test.ts:239-243` asserts exactly that output for a `synthetic_internal` fixture. So against the authored release now active, this command confirms only the expected version and the expected corpus release hash before it stops — not the bundle-hash match, and none of the four that constitute the release's assurance. There is no flag that relaxes it; the argument parser rejects any flag outside the five required ones. Do not work around this by hand-checking the bundle in an ad-hoc script and recording the result as a verifier pass.

**TODO(verify):** how the operator obtains the hash match, signature validity, signing key id, and compiler pass for a `synthetic_internal` bundle. Nothing committed on this branch does it. This must be resolved — and the resolving change frozen into the candidate SHA — before this step can be marked run.

Delete `$ROLLOUT_DIR/active-ontology.json` once the restricted evidence summary is complete. Retain no ontology bytes outside the restricted directory.

### 4. Record the trade before proceeding

An authored `synthetic_internal` release is an accepted outcome of this section, not a stop. `ontologyServesAccount` admits it on origin alone because sixteen machine-pipeline candidates have failed in the `regressing` stage and none has ever passed (`apps/api/scripts/build-internal-ontology.ts:4-9`), so requiring a public machine release would close Pattern for every reader rather than open it. Record what that costs, in the restricted change record and here:

- **The independent evaluator does not run.** `evaluator_passed` in the served bundle is the builder's own assertion; the evaluator verdict that the scope CASE would otherwise require lives in `pattern_ontology_pipeline_evidence`, and an authored release has no such row.
- **The seven regression hard gates do not run.** They are, exactly (`apps/api/src/services/ontology-regression-report.ts:112-120`):
  1. `suppressed_feature_leak`
  2. `uncited_astrological_claim`
  3. `source_dependency_failure`
  4. `prohibited_claim`
  5. `mandatory_feature_omission`
  6. `private_projection_leak`
  7. `semantic_refusal`
- **They run nowhere else in the product.** `evaluateOntologyRegressionHardGates` (`apps/api/src/services/ontology-regression.ts:494`) has exactly one non-test caller, `applyOntologyRegressionPass` in the same file (declared at line 775, calling it at line 923), which is itself called only from the ontology pipeline's `regressing` stage (`apps/api/src/services/ontology-pipeline-execute.ts:2572, 2698`). No Pattern generation path calls it. The live per-generation path has deterministic plan and candidate validation and a model semantic verifier — the `plan_validating`, `candidate_validating`, and `semantic_verifying` stages of `apps/api/src/services/pattern-stage-protocol.ts:11-21` — and those are lexically and structurally different checks; the writer prompt notes that a hard gate is a rule about *words* that a model told only the meaning can fail while believing it complied (`apps/api/src/services/pattern-prompt.ts:260-276`).
- **Nothing contains the consequence.** Pattern is account-wide: `ontologyServesAccount` takes the ontology and nothing else, and its docstring states there is no account either branch can be opened for (`apps/api/src/db/pattern-ontology.ts:227-232, 253-255`). There is no cohort, allowlist, or Pattern kill switch. Every reader who generates gets this ontology, and a Pattern fault is rolled back by rolling back the Worker.
- **What the authored release does carry**, and what §3 is verifying: every record is `meaning_class: "source_supported"` and cites exactly the corpus fragment its proposition came from (`build-internal-ontology.ts:126-142`); the corpus it was built from is recorded as `licensed_excerpt` (`pattern-ontology.ts:243-244`), subject to the §6 `TODO(verify)` on whether that corpus is registered in production `pattern_source_corpus_releases`; it is signed by the isolated signer; and it compiles under the same compiler the Worker runs. The twelve §2 sign fragments are deliberately absent because `PatternFeaturePredicate` has no `sign` field (`build-internal-ontology.ts:73`).

If you want the machine assurance instead of this trade, stop here and execute Task 11 of `docs/superpowers/plans/2026-08-20-automated-ontology-pipeline.md` through the current Codex provider, then re-run this section.

### 5. Refusals — stop the rollout on any of these

- A signature or hash mismatch, in the Worker's derivation or the offline verifier.
- `recalled_at` set, or `status` anything other than `active` on the pointed-at release.
- A compile failure from the offline verifier (`compiler_rejected`).
- A corpus that is not authorized, or whose license class is not `licensed_excerpt`.
- A release whose `provenance.origin` is absent or unrecognised. Note that `POST /internal/pattern-ontology-releases` will *ingest* a release with no origin (`apps/api/src/routes/internal-pattern.ts:148-161` rejects only unknown values), but `ontologyServesAccount` refuses it — such a release is active and unservable, and Pattern answers `ontology_unavailable`.
- A `machine_pipeline` release whose scope does not derive `public`.
- A manually edited receipt, a forged evidence row, or a machine release claiming `public` without the evidence chain that earns it.
- The `TODO(verify)` in §3 still open.

When the predicate refuses, every reader surface refuses uniformly with `ontology_unavailable`: `GET`/generate on the Pattern route returns HTTP 409 (`apps/api/src/routes/pattern-ai.ts:266-267`), enqueue returns 409 (`apps/api/src/services/pattern-enqueue.ts:140-146`), the state surface reports `ontology_unavailable` (`apps/api/src/services/pattern-state.ts:299-300`), and the Codex current-owner check drops in-flight provider work (`apps/api/src/services/codex-provider-domain.ts:170-172`). That is a visible closed product, not a silent substitution.

### 6. Verified release identity — fill on execution

Leave blank until §1-§3 have actually run against production. Do not carry a value forward from a dated runbook.

| Field | Source | Value |
| --- | --- | --- |
| Ontology version | §1 `p.active_version`, confirmed by the verifier's `version=` | |
| Bundle hash | §1 `r.bundle_hash`, confirmed by the verifier's `bundle_hash=` | |
| Corpus release hash | §1 `r.corpus_release_hash`, confirmed by the verifier's `corpus_release_hash=` | |
| Corpus release id | not returned by §1 for an authored release — see the supplementary read below | |
| Corpus license class | §1 `e.corpus_license_class` for a machine release; `NULL` for an authored one — see below | |
| Provenance origin | verifier's `origin=` | |
| Derived `activation_scope` | §2 | |
| Signing key id | §1 `e.signing_key_id` for a machine release; verifier's `signing_key_id=` otherwise | |
| Activation timestamp | `pattern_ontology_pointer.updated_at` — set by the activation pointer flip (`apps/api/src/db/pattern-ontology.ts:649-651`); not returned by §1 | |
| Pipeline run id | §1 `e.run_id`; `NULL` for an authored release | |
| Evaluation / regression report hashes | §1 `e.evaluation_report_hash`, `e.regression_report_hash`; `NULL` for an authored release | |
| Offline verifier result line | §3, verbatim | |
| Restricted change-record reference | | |

For the three fields §1 does not return on the authored branch, one supplementary read-only query covers them. Every identifier below is read from `db/d1/0007_ai_generated_pattern.sql:383-400` and `db/d1/0012_ontology_pipeline.sql:18-31`; run it in the same read-only form as §1:

**State:** NOT RUN
**Evidence required:** the restricted change record receives the corpus release id, license class, `public_capable`, locale, fragment count and activation timestamp exactly as returned — or an explicit note that `c.*` came back `NULL` — and nothing else from the row.

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT p.active_version, p.updated_at AS activated_at, r.created_at, c.corpus_release_id, c.license_class, c.public_capable, c.locale, c.fragment_count FROM pattern_ontology_pointer p LEFT JOIN pattern_ontology_releases r ON r.version = p.active_version LEFT JOIN pattern_source_corpus_releases c ON c.corpus_hash = r.corpus_release_hash WHERE p.id = 1"
```

If `c.*` comes back `NULL`, the active release's corpus was never registered through `POST /internal/ontology-corpora`, and the corpus release id and license class must come from the restricted corpus record instead.

**TODO(verify):** whether the authored release's corpus is registered in production `pattern_source_corpus_releases`. A corpus that resolves to anything other than `licensed_excerpt` / `public_capable = 1` is a refusal under §5.

After any new ontology activation, repeat §1-§3 in full and re-record every field above. Then reconcile `docs/deploy/openai-pattern-rollout.md`: the account-wide release serves from the active authored ontology and no longer has Gates 8/10 cohort transitions. Preserve that document's dated failed-candidate history — it is the evidence for why the machine gate was not used.


## Codex runner (plan Tasks 4 and 7)

This section covers building and packaging the outbound Codex runner from the frozen candidate, verifying the approved host without sending any user data, installing the package with the service **stopped** (plan Task 4), and starting it only after the candidate Worker is deployed (plan Task 7).

Restore the task-scoped variables from Tasks 1 and 3 at the start of every operator shell in this section: `ROLLOUT_DIR` (mode-`0700`, outside the repository) and `CANDIDATE_SHA`. No command below writes anything into the repository.

### Why the service stays stopped between installation and Task 7

Plan Task 4 ends with the service installed and inactive because **the Worker built from `origin/main` cannot own the `reading`/`publisher` coordinate**, in two independent ways:

1. **The pre-`0017` schema forbids the values.** `db/d1/0013_codex_provider_jobs.sql` declares `pipeline TEXT NOT NULL CHECK (pipeline IN ('pattern', 'ontology'))` (line 11) and `pass ... CHECK (pass IN ('planner', 'writer', 'verifier', 'generator', 'evaluator'))` (lines 14-16), plus two relationship CHECKs (lines 98-105):

   ```sql
   CHECK (
     (pipeline = 'pattern' AND user_id IS NOT NULL)
     OR (pipeline = 'ontology' AND user_id IS NULL)
   ),
   CHECK (
     (pass IN ('generator', 'evaluator') AND pipeline = 'ontology')
     OR pass IN ('planner', 'writer', 'verifier')
   ),
   ```

   What the old constraint permits is therefore exactly: `pattern` × {`planner`, `writer`, `verifier`} with a non-null `user_id`, and `ontology` × {`planner`, `writer`, `verifier`, `generator`, `evaluator`} with a null `user_id`. Neither `reading` nor `publisher` is in the vocabulary at all, so an insert naming either fails the CHECK and aborts. Migration `0017` is what widens all three: `pipeline IN ('pattern', 'ontology', 'reading')` (0017:77), `publisher` added to the `pass` enum (0017:81-83), `(pipeline IN ('pattern', 'reading') AND user_id IS NOT NULL)` (0017:170), and the single closed pair CHECK ending `OR (pipeline = 'reading' AND pass = 'publisher')` (0017:178-182).

2. **The Worker built from `origin/main` has no reading branch.** On `origin/main`, `consumeBudget` in `apps/api/src/routes/codex-provider.ts` (lines 206-235) branches on `job.pipeline === "pattern"` and otherwise falls through to the ontology ledger; there is no `reading` case and no reading owner loader (`apps/api/src/services/reading-current-owner.ts` does not exist on `origin/main`). So even after `0017` is applied in plan Task 5, a Worker built from `origin/main` cannot create a Daily provider job, and any reading row that did exist would be charged against the ontology allowance by that fallthrough. TODO(verify): that the version currently serving production was built from `origin/main`. The repository cannot show which upload is live; Task 6 records the build id, version id, and deployment id that do.

A runner started before the candidate deploys can therefore produce **zero** Daily evidence, while still claiming whatever `pattern`/`ontology` work is claimable — the claim selector is FIFO across pipelines (`ORDER BY available_at, created_at, id`) on both branches, at `origin/main:apps/api/src/db/codex-provider-jobs.ts:388` for the Worker running at that moment and at `apps/api/src/db/codex-provider-jobs.ts:430-437` on the candidate — and budget is charged at claim time. Starting it in Task 7, after Task 6's verified deployment, is what makes the first coordinate it can serve a coordinate the running Worker actually owns.

### 4.1 Build and package the runner from the candidate

**State:** NOT RUN

**Evidence required:** the restricted change record must receive `CANDIDATE_SHA`, the SHA-256 of `codex-runner-$CANDIDATE_SHA.tgz`, and the Node/npm versions used to build it.

Run from the repository root of a checkout at `CANDIDATE_SHA`, on the `.nvmrc` Node (`22`), after Task 3's `npm ci`:

```
npm run build -w @patternlike/codex-runner
tar -czf "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz" -C apps/codex-runner dist package.json probes
sha256sum "$ROLLOUT_DIR/codex-runner-$CANDIDATE_SHA.tgz"
```

- `build` is `tsc -p tsconfig.json` (`apps/codex-runner/package.json:8`) emitting to `dist/`.
- `dist/` is **git-ignored** (`.gitignore:2`). Task 3's required empty `git status --short` cannot detect a stale `dist/` left by an earlier checkout, so run the build immediately before the `tar`, in the same checkout, and never reuse an archive across candidates.
- The workspace declares **no runtime dependencies** — only `devDependencies` (`apps/codex-runner/package.json:13-17`) — so the archive is self-contained and no `node_modules` is installed on the host; `dist/index.js` imports only Node built-ins and its own relative modules.
- The archive's three members are the whole reviewed runtime surface: `dist`, `package.json`, and `probes` (the sentinel schema used in 4.4).
- The runner's own unit tests, including the two that pin the sentinel asset, already ran inside Task 3's gate as `extra: test @patternlike/codex-runner` (`scripts/ci-local.sh:148`). Do not re-run tests on the production host.

### 4.2 Host preconditions to verify

**State:** NOT RUN

**Evidence required:** a pass/fail verdict per line below, recorded in the restricted change record with the host reference, and no file contents, tokens, or credential paths copied anywhere.

| Precondition | Verify | Enforced where |
| --- | --- | --- |
| Unprivileged service account | Service runs as `patternlike-codex` with home under `/var/lib/patternlike-codex-runner` | `systemd/patternlike-codex-runner.service:10-15` (`User=`, `Group=`, `HOME=`, `CODEX_HOME=`) |
| Empty working repository | `/var/lib/patternlike-codex-runner/workspace` is an empty Git repository owned by the service account and contains no application or reader data | `WorkingDirectory=` (unit line 12); the Codex child inherits it because `runCodexInvocation` is called with no `cwd` (`src/index.ts:49-52`) and runs `--sandbox read-only`, so anything left there is readable by the model |
| Root-owned mode-`0600` env file | `/etc/patternlike-codex-runner.env` is `root:root` `0600` and contains **only** `PATTERNLIKE_API_ORIGIN`, `CODEX_RUNNER_TOKEN`, `CODEX_BIN`, `CODEX_RUNNER_POLL_MS=5000`, `CODEX_RUNNER_CONCURRENCY=1` | `EnvironmentFile=` (unit line 16); the five-assignment list is `docs/deploy/codex-production-provider.md` §6 |
| Absolute `CODEX_BIN` | The value is an absolute path to the Codex executable | **Host-verified, not code-enforced**: `parseRunnerConfiguration` rejects only a NUL byte or a value over 4096 characters and falls back to the bare name `codex` (`src/runner.ts:66-69`). The unit's `PATH` is restricted to `/opt/patternlike-codex-runner/bin:/usr/bin:/bin` (unit line 15) |
| Concurrency 1 | `CODEX_RUNNER_CONCURRENCY=1` | Code-enforced: parsed with minimum 1 and maximum 1, any other value throws (`src/runner.ts:77-83`) and the process logs `codex_runner_fatal` and exits 1 (`src/index.ts:24-28`) |
| No Cloudflare/D1/R2 credentials | No Cloudflare API token, D1 or R2 credential, or `CODEX_PROVIDER_ARTIFACT_KEYRING` value exists in the env file, the service account's environment, or its home | `docs/deploy/codex-production-provider.md` §6 ("Never place the Worker artifact keyring in this file"). Defence in depth: `CODEX_CHILD_ENVIRONMENT_KEYS` (`src/codex-cli.ts:27-54`) is a closed allowlist that omits `CODEX_RUNNER_TOKEN`, `PATTERNLIKE_API_ORIGIN`, and `CODEX_BIN`, so the runner bearer never reaches a Codex child |
| API origin shape | `PATTERNLIKE_API_ORIGIN` is an HTTPS origin with no credentials, path `/`, no query and no fragment | Code-enforced (`src/runner.ts:45-61`); the bearer shape `^[A-Za-z0-9._-]{32,512}$` is enforced at `src/runner.ts:62-65` |
| Node path in the unit | `ExecStart=/opt/patternlike-codex-runner/bin/node /opt/patternlike-codex-runner/dist/index.js` resolves on the host | Unit line 17; `docs/deploy/codex-production-provider.md` §6 says to use the actual observed Node path |
| Sandbox matches the checked-in unit | The installed unit is identical to `apps/codex-runner/systemd/patternlike-codex-runner.service` at `CANDIDATE_SHA` apart from the `ExecStart` Node path 4.5 permits; every `[Service]` sandbox directive matches | Plan Task 4 stop condition ("the service sandbox differs from the checked-in systemd unit"); `docs/deploy/codex-production-provider.md` §6 permits the observed Node path |

### 4.3 Content-free CLI checks

**State:** NOT RUN

**Evidence required:** the CLI version string, the exit class of `codex login status`, and a restricted-record reference to the account/workspace identity approved in Task 1. Do not copy account identifiers, credential files, or `codex login status` output into this repository.

As the runner account:

```
codex --version
codex login status
codex exec --help
```

Stop if the login resolves to a different account or workspace than the one Task 1 approved, the CLI version is not the reviewed version, the selected model is unavailable, allowance or credits are insufficient, or the service sandbox differs from the checked-in systemd unit.

- `codex login status` is not merely advisory here: `checkCodexAuthentication` (`src/codex-cli.ts:238-263`) spawns exactly `codex login status` with `stdio: "ignore"` and a 10-second timeout and requires exit code `0`; `main()` runs it **before** the first poll and exits 1 on failure (`src/index.ts:30-34`).
- TODO(verify): the reviewed Codex CLI version. Nothing in this repository pins one — the string `codex --version` appears only in the rollout plan (`docs/superpowers/plans/2026-08-27-codex-reader-rollout.md:172`) and in `docs/deploy/codex-production-provider.md` §1 (line 53), with no expected value. The version the stop condition compares against must come from the restricted change record.

### 4.4 Zero-user-data sentinel probe

**State:** NOT RUN

**Evidence required:** CLI version, model, elapsed time, exit class, usage integers, and the request/thread identifier — the identifier in the restricted change record only. No prompt, response body, or host path beyond the two named below.

The probe schema is checked in at **`apps/codex-runner/probes/sentinel-output.schema.json`** and is packaged by 4.1. The probe command below reads it from `/opt/patternlike-codex-runner/probes/sentinel-output.schema.json`, so unpack 4.1's checksummed archive under `/opt/patternlike-codex-runner` — the first bullet of 4.5 — **before** running this probe; 4.5's remaining steps (the unit install, `daemon-reload`, and the `inactive` confirmation) still follow it. Its entire content is:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["status"],
  "properties": {
    "status": {
      "type": "string",
      "enum": ["ok"]
    }
  }
}
```

`apps/codex-runner/src/protocol.test.ts:145-166` asserts that exact object, that `additionalProperties` is `false`, that `status` is the only property, and that the file mentions none of `chart`, `birth`, `reading`, `user`, `prompt`, `consent` — a widened schema would let the preflight pass on output that proves nothing. A second case (`protocol.test.ts:168-179`) parses it as a real claim `output_schema`, so the asset is known to satisfy the same claim validator the runner applies in production.

In a new mode-`0700` temporary Git repository on that host, run this from its root:

```
CODEX_PROBE_DIR="$(mktemp -d /var/lib/patternlike-codex-runner/preflight.XXXXXX)"
chmod 700 "$CODEX_PROBE_DIR"
git -C "$CODEX_PROBE_DIR" init --quiet
cd "$CODEX_PROBE_DIR"
codex exec --ephemeral --sandbox read-only --json --model gpt-5.6-sol --config 'model_reasoning_effort="high"' --output-schema /opt/patternlike-codex-runner/probes/sentinel-output.schema.json -o ./sentinel-output.json 'Return only the JSON object {"status":"ok"}.'
test "$(tr -d '\n\r ' < ./sentinel-output.json)" = '{"status":"ok"}'
```

Do not include application source, astrology content, or user data.

- The flags match what the runner actually executes — `exec --ephemeral --sandbox read-only --json --model <model> --config model_reasoning_effort="<reasoning_effort>" --output-schema <path> -o <path>` (`src/codex-cli.ts:288-304`), where both `<model>` and `<reasoning_effort>` are interpolated from the claim (`options.claim.model`, `options.claim.reasoning_effort`) — with one deliberate difference: the runner sends its prompt on stdin (trailing `-`, line 303, written by `child.stdin.end(prompt)` at line 175), while the probe passes a literal, content-free prompt as an argument. The probe's `gpt-5.6-sol` and `high` are the values a real Daily claim carries, from `OPENAI_READING_MODEL` and `OPENAI_READING_REASONING`.
- Those pins are deployed values, not runner constants: `OPENAI_READING_MODEL = "gpt-5.6-sol"` with `OPENAI_READING_REASONING = "high"` and `OPENAI_READING_TIMEOUT_MS = "900000"` in `[env.production.vars]` (`apps/api/wrangler.toml:468-475`), and the same model is pinned for the Pattern planner/writer/verifier passes (lines 412-425). The probe therefore exercises the model the canaries will use.
- Validate the returned object locally and retain only CLI version, model, elapsed time, exit class, usage integers, and the request/thread identifier. Return to the prior directory, validate that `CODEX_PROBE_DIR` begins with `/var/lib/patternlike-codex-runner/preflight.`, and delete exactly that temporary directory after the content-free summary is recorded.

### 4.5 Install the package with the service stopped

**State:** NOT RUN

**Evidence required:** the installed package SHA-256 (equal to 4.1's archive checksum), the installed unit's diff verdict against `apps/codex-runner/systemd/patternlike-codex-runner.service` at `CANDIDATE_SHA` (the `ExecStart` Node path is the only permitted difference), and the literal `systemctl is-active patternlike-codex-runner` result.

- Install the exact checksummed archive from 4.1 — no rebuild on the host, no substitution — unpacking `dist/`, `package.json`, and `probes/` read-only under `/opt/patternlike-codex-runner`. **This bullet runs before 4.4's probe**, which reads `/opt/patternlike-codex-runner/probes/sentinel-output.schema.json`; the bullets below it follow the probe. `docs/deploy/codex-production-provider.md` §6 step 2 names only `dist/` and `package.json`; it predates the probe asset, which was added with the Daily coordinate work, so treat `probes/` as a third required install target. TODO(verify): whether the approved host already carries a `/opt/patternlike-codex-runner/probes/` directory — the repository cannot say, so the host check resolves it.
- Install `apps/codex-runner/systemd/patternlike-codex-runner.service` unchanged apart from the observed Node path, then `daemon-reload`.
- **Do not** use `systemctl enable --now`. This supersedes §6's "enable and start the service" for this rollout: installation ends stopped.
- Confirm `systemctl is-active patternlike-codex-runner` reports `inactive` and record the installed package checksum.

### Task 7: start the runner and prove the shared control plane

**State:** NOT RUN

**Evidence required:** explicit start authorization reference; start timestamp; the exact set of journal event names observed; the content-free D1 counts below; and confirmation that no provider ledger moved during idle polling. Never record a bearer or lease token, an artifact object key, a user, chart, or consent id, or any prompt or output text.

Preconditions: Task 6's deployment is verified at 100% traffic on `CANDIDATE_SHA`, `0017` is applied and verified, and 4.1-4.5 are complete with the service still `inactive`.

Obtain explicit authorization to start real provider processing, then:

```
systemctl start patternlike-codex-runner
systemctl is-active patternlike-codex-runner
```

**What the journal may contain.** The runner writes one JSON line per event with exactly a `timestamp` and an `event` field (`src/index.ts:14-19`), and the event vocabulary is closed and complete at six values:

`codex_runner_started`, `codex_runner_stopped`, `codex_runner_fatal` (`src/index.ts:14`), `codex_runner_idle`, `codex_runner_job_processed`, `codex_runner_poll_failed` (`src/runner.ts:14-18`).

Any other string in the journal — a prompt, a model output, stdout or stderr from the child, a bearer or lease token — is a defect and a stop condition. Child stderr is discarded at the source (`stdio: ["pipe", "pipe", "ignore"]`, `src/codex-cli.ts:125`).

**What the journal cannot show, and how to verify it instead.** The log lines carry no origin, model, or version field, so:

- *One runner process, concurrency 1* — the unit is `Type=simple` with a single `ExecStart` (unit lines 9, 17); confirm one main PID via `systemctl status patternlike-codex-runner`, and note that a `CODEX_RUNNER_CONCURRENCY` other than `1` cannot start at all (4.2).
- *Expected poll interval* — read `CODEX_RUNNER_POLL_MS` from the root-owned env file as root. The default is `5000` and the accepted range is `250`-`60000` (`src/runner.ts:70-76`); observed idle spacing is jittered to 0.8-1.2× that value (`src/runner.ts:139-142`), so `5000` shows as roughly 4-6 seconds between `codex_runner_idle` lines.
- *Expected API origin* — read `PATTERNLIKE_API_ORIGIN` from the same file as root, and corroborate from the Worker side that claims are arriving.
- *Expected CLI version* — re-run `codex --version` as the service account (4.3); the runner does not log it.
- *No repeated auth/model/allowance failures* — a failed startup authentication check exits 1 immediately (`src/index.ts:30-34`), and `Restart=on-failure` with `RestartSec=30s`, `StartLimitBurst=5` over `StartLimitIntervalSec=15min` (unit lines 5-6, 18-19) means a persistent auth fault appears as a restart loop that systemd then gives up on. Treat any `codex_runner_fatal` after start as a stop.

**Content-free D1 check.**

**State:** NOT RUN

**Evidence required:** the grouped counts and `oldest_created_at` values only, plus the three ledger totals below, recorded in the restricted change record. No encrypted envelope, object key, user id, request hash, or lease token.

TODO(verify): the plan gives no verbatim D1 query for this step. The block below is assembled from the `npx wrangler d1 execute ... --env production --remote --command` wrapper the Global Constraints mandate (as used in plan Tasks 2 and 5) plus columns read from `db/d1/0017_codex_reading_provider.sql` (`pipeline`, `pass`, `status`, `created_at`); review it before running it. It selects no encrypted envelope, no object key, no user id, and no request hash:

```
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT pipeline, pass, status, COUNT(*) AS jobs, MIN(created_at) AS oldest_created_at FROM codex_provider_jobs GROUP BY pipeline, pass, status ORDER BY pipeline, pass, status"
```

Compare the three call ledgers for the current UTC date separately: `reading_provider_daily_usage` (keyed `utc_date`, with `used_calls`; `db/d1/0003_m5_openai_reading_publisher.sql:92-97`), `pattern_provider_daily_usage`, and `pattern_ontology_provider_daily_usage`.

**What the first minutes must show.**

- *Idle polling consumes no provider budget.* An empty claim returns `204` before any ledger is touched — `if (claimed.status === "empty") return c.body(null, 204);` precedes `consumeBudget` in the claim route (`apps/api/src/routes/codex-provider.ts:272`). A ledger that moves while every log line is `codex_runner_idle` is a defect.
- *A terminal old provider row is not reclaimed.* The claim selector matches only `status = 'pending' AND available_at <= ?` or `status = 'leased' AND lease_expires_at <= ?` (`apps/api/src/db/codex-provider-jobs.ts:430-437`); `completed`, `failed`, and `cancelled` rows are unreachable by it. The pre-existing terminal Codex jobs must keep their counts and terminal timestamps unchanged.
- *Budget is charged at claim, once per lease, including a reclaimed one* — including for `reading`, which is charged in its own branch against `reading_provider_daily_usage` and nowhere else (`apps/api/src/routes/codex-provider.ts:237-249`). Creating, adopting, polling, completing, validating, and publishing are free.
- *Encrypted work waits, it does not fail.* Pending Daily provider jobs that accumulated while the runner was stopped (plan Task 6) are legitimate; a Daily owner parked at `result_class = 'publisher_pending'` reads as *waiting*.

**Stop immediately** — `systemctl stop` the service, and do not enable another publisher — on an auth mismatch, the wrong model, allowance exhaustion, schema incompatibility, plaintext output anywhere, or a repeated claim/fail loop. Stopping is graceful by design: SIGTERM aborts the poll loop after the current invocation (`src/index.ts:35-38`, with the loop's `while (!options.signal.aborted)` gate at `src/runner.ts:172`), and `TimeoutStopSec=16min` (unit line 21) deliberately exceeds the 900000-ms — 15-minute — provider timeout (`CODEX_PROVIDER_TIMEOUT_MS`, `apps/api/src/services/codex-provider-contract.ts:6`) by one minute, the relationship `docs/deploy/codex-production-provider.md` §6 states directly. A separate five-minute margin sits inside the control plane: the claimed lease is 1200000 ms (`CODEX_PROVIDER_LEASE_MS`, line 7), 300000 ms longer than the invocation timeout.


## D1 baseline and migration `0017`

**State:** NOT RUN

**Evidence required:** the restricted change record must receive, for this section: the authorizing operator and the authorization timestamp; the pre-apply `d1 migrations list` output; the Time Travel bookmark captured immediately before the apply; the export path outside the repository with its byte size, `0600` mode, and SHA-256; the content-free pre-migration counts and integrity verdicts; the rehearsal verdict; the production apply timestamp and command count; the post-apply repeat of every count and verdict; and the post-apply bookmark. Nothing raw goes in this repository — no export bytes, no `owner_id`, `user_id`, `request_object_key`, `lease_token_hash`, or any hash column value.

### What `0017` actually does

`db/d1/0017_codex_reading_provider.sql` admits exactly one new coordinate on the Codex provider control plane: `pipeline = 'reading'` with `pass = 'publisher'`. That is the coordinate Daily uses — the generic Daily `jobs.id` as `owner_id`, the frozen `command_generation` as `stage_generation`, and `jobs.attempts - 1` as the zero-based `stage_attempt` (`docs/deploy/codex-production-provider.md` §9a).

SQLite cannot alter a CHECK constraint, and every constraint that has to move sits on `codex_provider_jobs`, so the migration rebuilds the parent forward-only. Its only child, `codex_provider_response_uploads`, declares `ON DELETE CASCADE`, so the file never lets that cascade fire. The order is:

1. Stage every child row into `codex_provider_response_uploads_staging`, a copy declared with **no** `REFERENCES` clause so it outlives the parent it describes, then probe that the staged count equals the live child count.
2. Probe the inbound foreign-key inventory: any table in `sqlite_master` other than the four this file knows whose `sql` mentions `codex_provider_jobs` arms the abort. A later migration that adds a second referencing table without updating this file stops the rebuild instead of orphaning it.
3. Create the widened parent as `codex_provider_jobs_reading`.
4. Copy every parent column explicitly and probe that the copy is row-complete.
5. `DROP TABLE codex_provider_response_uploads;` then `DROP TABLE codex_provider_jobs;` — child first, in dependency order — and `ALTER TABLE codex_provider_jobs_reading RENAME TO codex_provider_jobs;`.
6. Recreate the child with its `0014` text, restore every staged row, and probe that the restored count equals the staged count.
7. Recreate all four indexes with their `0013`/`0014` definitions.
8. `DROP TABLE codex_provider_response_uploads_staging;`.

The aborts use the `assertion_probe` primitive from `0002` (`id INTEGER PRIMARY KEY CHECK (id = 0)`, `reason TEXT NOT NULL`). Each probe is an `INSERT ... SELECT 1, '<reason>' WHERE <bad condition>`: the insert runs only when the condition holds, and then fails `CHECK (id = 0)`. Because D1 applies a migration file as one transaction (the behaviour the `0007` ledger note records and this file's header relies on), an armed probe rolls back everything, including the drops. The four reasons are `staged response uploads do not match the live child table`, `an unrecorded table references codex_provider_jobs`, `the widened parent copy is not row-complete`, and `restored response uploads do not match the staged inventory`. Note that the three probes that can run *before* a destructive statement do: the staged-count probe, the inbound foreign-key probe, and the row-complete parent-copy probe all sit ahead of the first `DROP TABLE`, and only the restored-uploads probe has to run after.

`0017` adds **no column** — in particular no prompt or response content column. Codex request and response bodies live only in create-only AES-GCM R2 envelopes; D1 holds coordinates, pins, hashes, sizes, leases, safe failure codes, and R2 pointers. It is **not** a crypto-version break: `AEAD_VERSION` and `KEK_DERIVATION_VERSION` are unchanged, no ciphertext is rewritten, and no encrypted column is added or moved, so `ENCRYPTED_COLUMNS` needs no edit.

### The exact CHECK widenings

`0017`'s header and the `MIGRATIONS.json` entry both describe this as three widened relationship CHECKs. Counted as constraint *texts* in the `CREATE TABLE`, four change: the two column-level enums are the two halves of one coordinate, and the two table-level CHECKs are the ownership rule and the pipeline/pass relationship. Before, as `0013` declared them:

```sql
  pipeline TEXT NOT NULL CHECK (pipeline IN ('pattern', 'ontology')),
  pass TEXT NOT NULL CHECK (
    pass IN ('planner', 'writer', 'verifier', 'generator', 'evaluator')
  ),
  CHECK (
    (pipeline = 'pattern' AND user_id IS NOT NULL)
    OR (pipeline = 'ontology' AND user_id IS NULL)
  ),
  CHECK (
    (pass IN ('generator', 'evaluator') AND pipeline = 'ontology')
    OR pass IN ('planner', 'writer', 'verifier')
  ),
```

After, as `0017` declares them:

```sql
  pipeline TEXT NOT NULL CHECK (pipeline IN ('pattern', 'ontology', 'reading')),
  pass TEXT NOT NULL CHECK (
    pass IN (
      'planner', 'writer', 'verifier', 'generator', 'evaluator', 'publisher'
    )
  ),
  CHECK (
    (pipeline IN ('pattern', 'reading') AND user_id IS NOT NULL)
    OR (pipeline = 'ontology' AND user_id IS NULL)
  ),
  CHECK (
    (pipeline = 'pattern' AND pass IN ('planner', 'writer', 'verifier'))
    OR (pipeline = 'ontology' AND pass IN (
      'planner', 'writer', 'verifier', 'generator', 'evaluator'
    ))
    OR (pipeline = 'reading' AND pass = 'publisher')
  ),
```

Two properties of that rewrite matter to the operator:

- **The pipeline/pass pair stays one closed relationship.** Widening `pipeline` and `pass` as independent enums would have admitted `reading`/`planner` and `ontology`/`publisher` as a side effect, and neither has an owner loader, a budget ledger, or a current-owner check behind it.
- **It admits nothing new for existing rows.** For `pattern` and `ontology` the restated relationship accepts exactly the set `0013` accepted, so live Pattern and ontology rows carry through the rebuild untouched rather than being re-validated against a different rule.

Comparing the `0013` `CREATE TABLE codex_provider_jobs` body against `0017`'s `CREATE TABLE codex_provider_jobs_reading` body, nothing else differs but the table name: every id-shape, envelope, hash, lease, nonce, model/timeout/budget pin, safe-failure pairing, lifecycle, uniqueness, and timestamp constraint is the `0013` text unchanged, and all four `UNIQUE` tuples are unchanged.

### The four indexes `0017` recreates

| Index | Definition recreated |
| --- | --- |
| `idx_codex_provider_jobs_claimable` | `(available_at, lease_expires_at, created_at, id) WHERE status IN ('pending', 'leased')` |
| `idx_codex_provider_jobs_owner` | `(pipeline, owner_id, pass, stage_generation, stage_attempt)` |
| `idx_codex_provider_jobs_user` | `(user_id, id) WHERE user_id IS NOT NULL` |
| `idx_codex_provider_response_uploads_created` | `(created_at, job_id)` |

A rebuild drops the parent's indexes with it. All four must exist after the apply, with these definitions; anything less turns the claim, owner, user-erasure, and upload-maintenance lanes into scans.

### Why "migration before the Worker reaches `main`" is load-bearing

Merging to `main` triggers Cloudflare Workers Builds, which is unaffected by the GitHub Actions billing lock. The lost CI removed the check on a merge, not its consequences: the schema step is a hard gate **ahead of** the merge. This is not theoretical here — for `0007`, Workers Builds deployed the M7 Worker 59 seconds after the push, ahead of the schema, and `GET /v1/pattern-state` and `GET /v1/pattern` returned `500 internal_error` for the whole interval; for `0016`, Workers Builds deployed about a minute after merge, again ahead of the schema.

The `0017` failure shape is worse than a read error, because Daily's enqueue writes R2 first:

- The Worker's own guard already permits the coordinate — `validCodexProviderCoordinate` in `apps/api/src/db/codex-provider-jobs.ts` returns true for `reading`/`publisher`. D1 would be the only thing refusing.
- `createCodexReadingPublisher` puts the create-only encrypted request envelope into R2 (`putCodexProviderArtifact`) and only then calls `enqueueCodexProviderJob`, deliberately, so a crash between them leaves an object with no job rather than a job whose request cannot be read.
- Against a pre-`0017` schema the row fails the old `pipeline` CHECK. Because the enqueue is `INSERT OR IGNORE`, SQLite skips the row rather than raising; `enqueueCodexProviderJob` then finds no row on its post-insert identity read and throws `codex provider job identity conflict`, the surrounding `catch` returns `unavailable()` — `failure("publisher_unavailable", "network_error")`, the *retryable* class — and the Daily retry policy tries again. Every scheduled and first-open Daily would loop through that class while orphan encrypted request objects accumulate in R2 with no job row referencing them.
- There is no second transport to absorb it: `READING_PUBLISHER` accepts only `codex` and the direct-OpenAI adapter is deleted.

### 1. Authorization checkpoint

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the authorizing
operator's role, the date and time of the authorization, the exact scope
authorized (production D1 export plus the single named migration
`0017_codex_reading_provider.sql`), and the `CANDIDATE_SHA` the authorization
was given against. An authorization recorded against a different candidate does
not carry forward.

Obtain explicit operator authorization for the production D1 backup **and** the migration. This section's existence authorizes nothing. Before running anything below, confirm the preconditions the earlier tasks established:

```bash
test -d "$ROLLOUT_DIR"
test "$(stat -c '%a' "$ROLLOUT_DIR")" = "700"
git status --short
systemctl is-active patternlike-codex-runner
```

`git status --short` must be empty and `CANDIDATE_SHA` must still name the frozen PR candidate; `systemctl is-active` must report `inactive`. Record the authorizing operator, role, and timestamp in the restricted change record.

### 2. Migration inventory

**State:** NOT RUN

**Evidence required:** the full `d1 migrations list` output for the production database, and the explicit confirmation that nothing other than `0017_codex_reading_provider.sql` is pending, in the restricted change record.

```bash
npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Exactly `0017_codex_reading_provider.sql` may be pending. **Stop on any other pending migration.** The committed ledger records `0016_birth_calc_usage.sql` applied to production on 2026-08-27 ~06:35 UTC with nothing then pending, so `0017` alone is the expected answer — but the live list is the authority, not the ledger, and not this runbook.

> Documentation drift to reconcile: `CLAUDE.md` on this branch still says "The remote ledger is now at **0015**", while `db/d1/MIGRATIONS.json` records the `0016` apply. Fix the `CLAUDE.md` line in a documentation commit; do not resolve it by trusting either text over the live query.

### 3. Bookmark, export, restrict, checksum

**State:** NOT RUN

**Evidence required:** the Time Travel bookmark captured immediately before the apply, and the export's path outside the repository with its byte size, `0600` mode, and SHA-256 — path, size, mode, and checksum only, never a byte of the export itself — in the restricted change record.

House procedure is bookmark and export first, exactly as `0002`, `0008`, and `0016` did, with the export written **outside the repository** in the owner-only rollout directory at mode `0600` and recorded only by path, size, and checksum:

```bash
npx wrangler d1 time-travel info patternlike-ops --config apps/api/wrangler.toml --env production --json > "$ROLLOUT_DIR/time-travel-before-0017.json"
npx wrangler d1 export patternlike-ops --config apps/api/wrangler.toml --env production --remote --output "$ROLLOUT_DIR/pre-0017.sql"
chmod 600 "$ROLLOUT_DIR/time-travel-before-0017.json" "$ROLLOUT_DIR/pre-0017.sql"
sha256sum "$ROLLOUT_DIR/pre-0017.sql" > "$ROLLOUT_DIR/pre-0017.sha256"
```

The export is a full copy of production, including every user's ciphertext. Treat it and everything derived from it (the rehearsal database in step 5) as restricted material under the operator's existing retention policy: never committed, never pasted into the PR, never attached to a public issue. D1 Time Travel retains roughly 30 days, so the bookmark is a bounded restore point, not an archive — the export is the durable one.

### 4. Content-free pre-migration evidence

**State:** NOT RUN

**Evidence required:** every count and integrity verdict below, recorded as counts, names, and verdicts only — no identifier, key, hash, or object key — in the restricted change record.

Capture the baseline through the same `d1 execute --command` form the provider runbook already uses, writing raw output only into `$ROLLOUT_DIR`:

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "PRAGMA foreign_key_check"
```

Run that form once per statement below. Every one is an aggregate or a schema inventory; none selects an identifier, key, hash, or object key:

- total users — `SELECT COUNT(*) AS count FROM users`
- provider jobs by coordinate and state — `SELECT pipeline, pass, status, COUNT(*) AS count FROM codex_provider_jobs GROUP BY pipeline, pass, status ORDER BY pipeline, pass, status`
- response uploads — `SELECT COUNT(*) AS count FROM codex_provider_response_uploads`
- parents with children — `SELECT COUNT(DISTINCT job_id) AS parents_with_uploads FROM codex_provider_response_uploads`
- index inventory — `SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('codex_provider_jobs', 'codex_provider_response_uploads') ORDER BY name`
- inbound foreign-key inventory (the same question `0017`'s step-2 probe asks) — `SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%codex_provider_jobs%' ORDER BY name`
- `PRAGMA foreign_key_check`
- `PRAGMA quick_check`
- `SELECT COUNT(*) AS count FROM assertion_probe`

Expect a **populated** rebuild, not an empty one: the last recorded production inventory (2026-08-25) found 124 terminal Codex provider jobs. Re-query rather than carrying that number forward — it is dated evidence, not current state — but a zero count is itself a signal worth stopping on.

Never widen these queries to `owner_id`, `user_id`, `request_object_key`, `response_object_key`, `lease_token_hash`, or any `*_hash` column. Grouped counts are the evidence; row identity is not.

### 5. Local rehearsal against the real export

**State:** NOT RUN

**Evidence required:** the rehearsal verdict — that the restricted export loaded into the fresh persist directory, that the repository `0017` applied there, and the command count wrangler reports — plus the persist-directory path, in the restricted change record. The rehearsal database holds production bytes; none of its rows may be recorded.

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --local --persist-to "$ROLLOUT_DIR/d1-rehearsal" --file "$ROLLOUT_DIR/pre-0017.sql"
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --local --persist-to "$ROLLOUT_DIR/d1-rehearsal"
```

The fresh `--persist-to` directory keeps this out of the developer database at `apps/api/.wrangler/state/v3/d1`. This rehearsal is the production-bytes lane; the repository already carries the synthetic one, which runs inside Task 3's `npm run ci:local`: `apps/api/test/apply-migrations.ts` seeds Pattern and ontology parent rows and response-upload children *before* `0017` runs and then upgrades them, and `apps/api/src/db/codex-provider-schema.test.ts` asserts the result — byte-for-byte row preservation, the new coordinate admitted, illegal pairs refused, no staging table left behind, and an unarmed probe.

`CLAUDE.md` documents `npm test -w @patternlike/api -- <path>` as the single-test form, but `@patternlike/api`'s `test` script is a six-command `&&` chain, so the appended path reaches its last command rather than `vitest run` and the whole chain runs:

```bash
npm test -w @patternlike/api -- src/db/codex-provider-schema.test.ts
```

TODO(verify): the invocation that runs codex-provider-schema.test.ts in isolation under this workspace's chained test script.

### 6. What to compare on the rehearsal database

**State:** NOT RUN

**Evidence required:** each comparison below recorded as pass or fail with its content-free counts and verdicts, and the disposition of any mismatch, in the restricted change record.

Run every step-4 statement again against `--local --persist-to "$ROLLOUT_DIR/d1-rehearsal"` and compare:

- **Every grouped count identical** to the pre-migration evidence — the parent by `pipeline`/`pass`/`status`, the child total, and the parents-with-children count.
- **Every provider parent and child column preserved**, not merely counted. Compare column-by-column for the seeded/real rows rather than trusting the row totals, since `0017`'s own probes only check counts.
- **Old legal coordinates still insert**: `pattern` with `planner`/`writer`/`verifier`; `ontology` with all five of `planner`, `writer`, `verifier`, `generator`, `evaluator`.
- **The new coordinate inserts**: `reading`/`publisher` with a non-null `user_id`.
- **Illegal pairs still reject**: `reading`/`planner`, `ontology`/`publisher`, `pattern`/`publisher`, `pattern`/`generator`; plus `reading` with a null `user_id` and `ontology` with a non-null one.
- **All four indexes exist** with the definitions in the table above.
- **`codex_provider_response_uploads_staging` is gone.**
- **`PRAGMA foreign_key_check`** returns no rows, **`PRAGMA quick_check`** is `ok`, and **`assertion_probe` is empty**.

Stop and repair the migration on any mismatch. **A changed migration invalidates `CANDIDATE_SHA`** and returns the rollout to the candidate-freeze task: re-freeze, re-run `npm run ci:local` on the pinned Node, and re-record the lockfile and dry-run checksums before coming back here. Do not hand-edit production to match a migration, and do not apply a migration that differs by one byte from the one in the frozen candidate.

Delete `$ROLLOUT_DIR/d1-rehearsal` once the restricted evidence summary is complete. Retain `$ROLLOUT_DIR/pre-0017.sql` and `pre-0017.sha256` at mode `0600` under the operator's existing retention policy until the rollout closes — the Rollback section names that export as the independent restore authority once the Time Travel window has passed.

### 7. Apply to production

**State:** NOT RUN

**Evidence required:** apply timestamp, the command count wrangler reports, and the migration name, in the restricted change record.

```bash
npx wrangler d1 migrations apply patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

Apply the **unchanged** `0017` — the exact bytes in `CANDIDATE_SHA`. This runs before the merge, with the runner stopped and the candidate Worker not yet deployed.

### 8. Post-apply verification

**State:** NOT RUN

**Evidence required:** the post-apply `d1 migrations list` result, the post-apply repeat of every step-4 count and integrity verdict, the four-index and staging-table verdicts, and the fresh post-apply Time Travel bookmark, in the restricted change record.

Immediately repeat, against production:

- `d1 migrations list` — nothing pending, and only `0017` moved.
- Every step-4 count and inventory — parent grouped counts, child count, parents-with-children, index inventory, inbound foreign-key inventory.
- `PRAGMA foreign_key_check` — zero rows.
- `PRAGMA quick_check` — `ok`.
- `SELECT COUNT(*) FROM assertion_probe` — 0.
- A fresh Time Travel bookmark, recorded as the post-apply restore point.

The verdict to record is: only `0017` moved, all pre-existing rows and relationships survived, the widened coordinate is legal, all four indexes are present, and no staging table remains. Content-free verdicts and counts only.

If the apply or the verification fails, **do not merge**. Go to rollback.

Local developers pick the change up under the standing D1 policy, which recreates rather than re-applies:

```bash
rm -rf apps/api/.wrangler/state/v3/d1 && npm run db:local -w @patternlike/api
```

(`db:local` is `wrangler d1 migrations apply patternlike-ops --local`, i.e. the ordered `db/d1` directory, not just `0001`.)

### Rollback

**State:** NOT RUN

**Evidence required:** the restore authorization, the bookmark restored to, and the post-restore repeat of the step-4 inventory, in the restricted change record.

`0017` is forward-only; there is no down migration. The rollback is the Time Travel bookmark captured in step 3, restored under a **separately confirmed** restore action — not as an improvised continuation of a failed apply.

- Restore to the bookmark in `$ROLLOUT_DIR/time-travel-before-0017.json`, then verify the *old* inventory: `d1 migrations list` shows `0017` pending again, the pre-migration grouped counts return, `PRAGMA foreign_key_check` is empty, and `PRAGMA quick_check` is `ok`.
- `$ROLLOUT_DIR/pre-0017.sql` (checksum in `pre-0017.sha256`) is the independent authority if the bookmark window has passed or a restore is refused.
- Then open a **new** candidate rather than improvising forward. The Worker change must never precede `0017`.

TODO(verify): the exact `wrangler d1 time-travel restore` invocation. No file in this repository records one — the plan says only "restore to the recorded Time Travel bookmark under a separately confirmed restore action", and `d1 time-travel info` is the only time-travel subcommand that appears anywhere in the repository. Confirm the current flag set against the Cloudflare Time Travel documentation before running it, and record the exact command used.

After a successful merge and deploy, do **not** roll `0017` back as a remedy for a Daily or Pattern fault: `READING_V5_ROLLOUT="off"` is Daily's containment control, stopping the runner is the shared provider control, and a Pattern fault rolls the Worker version back. Migrations `0013`, `0014`, and `0017` stay in place.

### Step state

| Step | State |
| --- | --- |
| 1. Authorization checkpoint | NOT RUN |
| 2. Migration inventory | NOT RUN |
| 3. Bookmark, export, restrict, checksum | NOT RUN |
| 4. Content-free pre-migration evidence | NOT RUN |
| 5. Local rehearsal | NOT RUN |
| 6. Rehearsal comparison | NOT RUN |
| 7. Production apply | NOT RUN |
| 8. Post-apply verification | NOT RUN |
| Rollback (only if 7 or 8 fails) | NOT RUN |


## Worker deployment

**State:** NOT RUN

**Evidence required:** the restricted change record must receive, for this task: the reconfirmed `BASE_SHA` and `CANDIDATE_SHA`, the `0017` migration-inventory reading taken immediately before the push, the runner's `systemctl is-active` reading before the push, the Workers Builds build id and its source commit, the uploaded version id, the deployment id, the deployment timestamp and traffic percentage, the `wrangler deployments list` and `/health` outputs, the deployed-variable reading for the recorded version, the route/binding probe status codes and content types, and the go/stop verdict. No prompt, response, reader prose, user id, generation id, consent id, lease token, artifact key, or credential may be recorded here or in the restricted record.

This task corresponds to Task 6 of [`../superpowers/plans/2026-08-27-codex-reader-rollout.md`](../superpowers/plans/2026-08-27-codex-reader-rollout.md). It produces a 100%-traffic Worker deployment whose build source is exactly `CANDIDATE_SHA`, with no Codex invocation started. Encrypted pending provider jobs may legitimately accumulate while the runner is stopped — that is the expected state at the end of this task, not a fault.

Restore the task-scoped shell variables (`ROLLOUT_DIR`, `BASE_SHA`, `CANDIDATE_SHA`) from the candidate-identity section before running anything below.

### Why the merge is the deploy

`CLAUDE.md` states both halves of this and they are the reason the ordering in this runbook is not negotiable:

- GitHub Actions is unavailable on this account — every run fails with a billing lock, that is not expected to change, and `main` is not branch protected, so nothing mechanical stops an unverified merge. `npm run ci:local` is the replacement merge gate.
- Cloudflare Workers Builds is a **separate** system and is unaffected by the billing lock, so merging to `main` still deploys. "The lost CI removed the check on a merge, not its consequences — which is why a migration must be applied remotely *before* the merge that deploys the code reading it."

The consequence for ordering is concrete, and `db/d1/MIGRATIONS.json` records it happening twice. On 2026-08-15 Workers Builds deployed the M7 Worker 59 seconds after the push, ahead of the schema, and `GET /v1/pattern-state` and `GET /v1/pattern` both returned `500 internal_error` in the interval. On 2026-08-27 it deployed a Worker version about one minute after the PR #35 merge, again ahead of `0016`. So:

- **`0017` must be applied and verified before the push**, not after. Its own `MIGRATIONS.json` note says the same: the rebuild drops and recreates `codex_provider_jobs` and `codex_provider_response_uploads` inside one transaction, so a Worker that reaches the old CHECK "fails every Daily provider enqueue closed."
- **The runner must still be stopped at the moment of the push.** Starting it belongs to the next section, because the pre-merge Worker cannot own a `reading/publisher` provider job.
- **There is no window in which to "get ready" after merging.** Everything that must be true has to be true before `git push`.

### Pre-merge reconfirmation

**State:** NOT RUN

**Evidence required:** all four reconfirmation readings, verbatim and content-free, in the restricted change record, each with its timestamp.

Obtain explicit authorization to merge and deploy before running any of this. Then reconfirm, in this order:

1. `0017` is applied and nothing else is pending:

```
npx wrangler d1 migrations list patternlike-ops --config apps/api/wrangler.toml --env production --remote
```

2. The runner is installed but not running:

```
systemctl is-active patternlike-codex-runner
```

Require `inactive`. Anything else stops the merge.

3. The PR carries the complete `ci:local` summary from the candidate-freeze section, and the working tree is clean:

```
git status --short
```

4. `main` has not moved and the candidate is still a fast-forward of it:

```
git fetch origin
git rev-parse origin/main
git merge-base --is-ancestor origin/main "$CANDIDATE_SHA"
```

`git rev-parse origin/main` must still equal the recorded `BASE_SHA`. If `main` moved, **do not merge** — return to the candidate-freeze section, rebuild the candidate, and rerun `npm run ci:local`.

### Fast-forward push

**State:** NOT RUN

**Evidence required:** the push timestamp, the exact `CANDIDATE_SHA` pushed, and confirmation that `origin/main` afterwards equals `CANDIDATE_SHA`.

Fast-forward the reviewed candidate to `main` without squash, rebase, merge commit, or force:

```
git push origin "$CANDIDATE_SHA:refs/heads/main"
```

Do not merge through the GitHub UI. A squash or merge commit creates a SHA that is not `CANDIDATE_SHA`, and every later verification in this runbook is written against `CANDIDATE_SHA` exactly.

### Watch the Workers Build

**State:** NOT RUN

**Evidence required:** build id; the build's source commit (must be exactly `CANDIDATE_SHA`); build outcome; uploaded version id; deployment id; deployment timestamp; traffic percentage.

Workers Builds starts on its own. Watch it in the Cloudflare dashboard for the `patternlike-api-production` Worker and record, without pasting build logs into the repository:

- **build id** and its **source commit** — the source commit must be exactly `CANDIDATE_SHA`. A build whose source is a squash or merge SHA is not this candidate; stop.
- **build outcome**. A failed build means nothing was deployed and the previous version is still serving; investigate before doing anything else.
- **uploaded version id**, **deployment id**, **deployment timestamp**, and **traffic percentage** (must be 100% to the new version).

Do not run `npm run deploy:api` in this task. The deploy here is the Workers Build, and a manual upload would create a second version whose provenance is a local tree rather than the recorded build. A manual upload is a fallback only if Workers Builds does not deploy at all; if it is used, it must run from a clean checkout of `CANDIDATE_SHA` and be recorded in the restricted change record as a manual upload with its own version id.

### Deployment inventory and public health

**State:** NOT RUN

**Evidence required:** the `deployments list` output (version/deployment identifiers and traffic split) and the `/health` and `/v1/meta` response bodies, all content-free.

```
npx wrangler deployments list --config apps/api/wrangler.toml --env production
curl --fail --silent --show-error https://patternlike-api-production.lfd.workers.dev/health
```

`GET /health` is served by `apps/api/src/routes/health.ts` and returns `{ ok, service, schema_version, environment }`. Require `service` `"patternlike-api"` and `environment` `"production"`. An `environment` of `development` or `test` would mean the deploy resolved the wrong block — `isDevEnvironment()` treats both as development, which disables `configGuard`.

`GET /v1/meta` is the second live read of deployed configuration (same file, public, not behind `authenticate`):

```
BASE=https://patternlike-api-production.lfd.workers.dev
curl -s $BASE/v1/meta
```

It returns `{ schema_version, architecture_profile, calc_service_configured, auth_stub }`. Require `auth_stub` **false** and `calc_service_configured` **true**. `auth_stub` true on a production deployment is an immediate stop and a rollback condition: it is the flag that would let an unauthenticated `X-User-Id` header name a user.

### Deployed configuration to verify

**State:** NOT RUN

**Evidence required:** the deployed variable list read from Cloudflare's deployment settings for the recorded version id, compared line by line against the table below, plus the `npm run test:wrangler-config -w @patternlike/api` verdict from a checkout of `CANDIDATE_SHA`.

Two different things are being checked and they are not interchangeable. `npm run test:wrangler-config -w @patternlike/api` (documented in [`codex-production-provider.md`](./codex-production-provider.md) §9) resolves `apps/api/wrangler.toml` with `unstable_readConfig` and asserts what the **committed file** says. A source setting is not live proof. The live proof is the deployed variable and binding list for the **recorded version id**, read from Cloudflare's deployment settings. Record both.

Every value below was read from `[env.production]` in `apps/api/wrangler.toml` on `CANDIDATE_SHA`.

**Worker identity** (top-level, inherited by the named environment):

| Key | Required value |
| --- | --- |
| `name` (in `[env.production]`) | `patternlike-api-production` |
| `main` | `src/index.ts` |
| `compatibility_date` | `2025-05-01` |
| `compatibility_flags` | `["nodejs_compat", "allow_eval_during_startup"]` |

**Daily reading:**

| Variable | Required value |
| --- | --- |
| `READING_V5_ROLLOUT` | `hybrid` |
| `READING_PUBLISHER` | `codex` |
| `OPENAI_READING_MODEL` | `gpt-5.6-sol` |
| `OPENAI_READING_REASONING` | `high` |
| `OPENAI_READING_PROMPT_VERSION` | `1.0.1` |
| `OPENAI_READING_TIMEOUT_MS` | `900000` |
| `OPENAI_READING_MAX_OUTPUT_TOKENS` | `4000` |
| `READING_CONTEXT_MAX_BYTES` | `98304` |
| `READING_PREGEN_ACTIVE_DAYS` | `30` |
| `READING_PREGEN_LEAD_MINUTES` | `30` |
| `READING_PREGEN_SPREAD_MINUTES` | `45` |
| `READING_SCHEDULER_BATCH_LIMIT` | `100` |
| `READING_DAILY_PROVIDER_CALL_LIMIT` | `10000` |

`hybrid` is the mode in which the 15-minute cron is the **primary** Daily entry point and first-open repairs a missed day. It is also Daily's kill switch: `off` pauses queued work durably before any claim, decryption, or provider job. `resolvePublisherConfiguration` in `apps/api/src/services/reading-publisher.ts` compares eleven of these for **equality** with a compiled constant — the seven pinned integers plus `READING_PUBLISHER`, `OPENAI_READING_MODEL`, `OPENAI_READING_REASONING`, and `OPENAI_READING_PROMPT_VERSION` — so a single drifted value there is `503 configuration_error` on the next request rather than a bad reading. Two rows are not equality pins and this table is the only check on them: `READING_V5_ROLLOUT` is validated only as one of `off`, `internal`, `first_open`, `hybrid`, and `READING_DAILY_PROVIDER_CALL_LIMIT` only has to parse as an integer of 1 or more, so a drifted spend ceiling is accepted by the Worker and must be caught by reading it here.

**Pattern** — no rollout variable, by contract:

| Variable | Required value |
| --- | --- |
| `PATTERN_PUBLISHER` | `codex` |
| `OPENAI_PATTERN_PLANNER_MODEL`, `OPENAI_PATTERN_WRITER_MODEL`, `OPENAI_PATTERN_VERIFIER_MODEL` | `gpt-5.6-sol` |
| `OPENAI_PATTERN_PLANNER_REASONING`, `OPENAI_PATTERN_WRITER_REASONING`, `OPENAI_PATTERN_VERIFIER_REASONING` | `high` |
| `OPENAI_PATTERN_PLANNER_PROMPT_VERSION` | `1.0.1` |
| `OPENAI_PATTERN_WRITER_PROMPT_VERSION` | `1.0.1` |
| `OPENAI_PATTERN_VERIFIER_PROMPT_VERSION` | `1.0.0-verifier` |
| `OPENAI_PATTERN_PLANNER_TIMEOUT_MS` | `900000` |
| `OPENAI_PATTERN_WRITER_TIMEOUT_MS` | `900000` |
| `OPENAI_PATTERN_VERIFIER_TIMEOUT_MS` | `900000` |
| `OPENAI_PATTERN_PLANNER_MAX_OUTPUT_TOKENS`, `OPENAI_PATTERN_WRITER_MAX_OUTPUT_TOKENS`, `OPENAI_PATTERN_VERIFIER_MAX_OUTPUT_TOKENS` | `32000` |
| `PATTERN_INPUT_MAX_BYTES` | `98304` |
| `PATTERN_DAILY_PROVIDER_CALL_LIMIT` | `100` |
| `PATTERN_ARTIFACT_RETENTION_DAYS` | `30` |
| `PATTERN_ONTOLOGY_KEYS` | present, containing the `ontology-machine-2026-08` Ed25519 verification key (public material; do not transcribe the key into the restricted record) |
| `PATTERN_AI_ROLLOUT` | **must not appear** |
| `PATTERN_INTERNAL_ACCOUNT_IDS` | **must not appear** |

The three `900000` values are the pins `resolvePatternPublisherConfiguration` expects for every pass; the older `120000` OpenAI values fail the pin check rather than running long. Absence of the two rollout names is the contract, not an oversight: `apps/api/scripts/wrangler-config.test.ts` asserts `"PATTERN_AI_ROLLOUT" in block.vars` is `false` and `"PATTERN_INTERNAL_ACCOUNT_IDS" in block.vars` is `false` for **both** blocks, because an empty string would be a switch someone could set. If either name appears in the deployed variable list, stop — Pattern is account-wide and has no cohort gate to fall back on.

**Ontology pipeline — parked, and it stays parked:**

| Variable | Required value |
| --- | --- |
| `ONTOLOGY_PIPELINE_ROLLOUT` | `off` |
| `ONTOLOGY_PIPELINE_PUBLISHER` | `codex` |
| `ONTOLOGY_PIPELINE_ALLOW_EQUAL_MODELS` | `1` |
| `OPENAI_ONTOLOGY_GENERATOR_MODEL`, `OPENAI_ONTOLOGY_EVALUATOR_MODEL` | `gpt-5.6-sol` |
| `OPENAI_ONTOLOGY_GENERATOR_REASONING`, `OPENAI_ONTOLOGY_EVALUATOR_REASONING` | `high` |
| `OPENAI_ONTOLOGY_GENERATOR_PROMPT_VERSION` | `1.0.5` |
| `OPENAI_ONTOLOGY_EVALUATOR_PROMPT_VERSION` | `1.0.0-evaluator` |
| `OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS` | `900000` |
| `OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS` | `900000` |
| `OPENAI_ONTOLOGY_GENERATOR_MAX_OUTPUT_TOKENS` | `8000` |
| `OPENAI_ONTOLOGY_EVALUATOR_MAX_OUTPUT_TOKENS` | `4000` |
| `ONTOLOGY_PIPELINE_INPUT_MAX_BYTES` | `98304` |
| `ONTOLOGY_PIPELINE_DAILY_PROVIDER_CALL_LIMIT` | `500` |
| `ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS` | `7` |

`ONTOLOGY_PIPELINE_ROLLOUT = "off"` is load-bearing for this release. `apps/api/scripts/wrangler-config.test.ts` records why, in the comment above its `ONTOLOGY_PIPELINE_ROLLOUT` assertion: the machine pipeline's regression stage "rehearsed thirty Pattern generations per candidate -- about four hours and 130 provider calls -- and never once passed in sixteen attempts." (The comment on the variable itself in `apps/api/wrangler.toml` records only the 2026-08-22 internal control-plane approval, which does not admit consumer Pattern generation on its own.) Pattern is serving from the authored `synthetic_internal` ontology recorded in the public-ontology section of this runbook, with the trade recorded there. Do not turn this variable on as part of this deployment.

**No runtime OpenAI or Workers AI selector for Daily or Pattern:**

| Variable | Required value |
| --- | --- |
| `AI_GATEWAY_ACCOUNT_ID` | empty string |
| `AI_GATEWAY_ID` | empty string |
| `OPENAI_GATEWAY_KEY_ALIAS` | empty string |
| `OPENAI_CREDENTIAL_SOURCE` | `worker` |
| Workers AI (`[ai]`) binding | **must not appear** in either block |

`OPENAI_CREDENTIAL_SOURCE` staying at `worker` is expected and is not a Daily or Pattern route: it is the ontology pipeline's transport selector and is unread while that pipeline is on Codex. `resolvePublisherConfiguration`'s required list carries no OpenAI key, credential mode, gateway id, or BYOK alias — its comment says so directly ("None of them can produce a reading any more"). Retiring the `OPENAI_API_KEY` secret is the separate secret-retirement section of this runbook and is not part of this task.

**Baseline identity and guard variables** (unchanged; confirm they did not move):

| Variable | Required value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `AUTH_STUB` | `0` (explicitly off, never omitted) |
| `SCHEMA_VERSION` | `0.2.0` |
| `SE_LICENSE_MODE` | `agpl` |
| `CALC_SERVICE_URL` | `https://patternlike-calc.fly.dev` |
| `CALC_FETCH_TIMEOUT_MS` | `10000` |
| `BIRTH_CALC_DAILY_LIMIT` | `5` |
| `CHECK_IN_RETENTION_MONTHS` | `13` |
| `TIME_TRAVEL_RECEIPT_EPOCH` | `1` |
| `TIME_TRAVEL_DAILY_SCAN_LIMIT` | `32` |
| `OIDC_ISSUER` / `OIDC_AUDIENCE` / `OIDC_JWKS_URL` | byte-identical to the committed `[env.production.vars]` values — do not transcribe them here and do not change them; `identities.provider` stores the issuer string, so changing it orphans every existing account |

### Cron triggers

**State:** NOT RUN

**Evidence required:** the deployed cron list for the recorded version id.

`[env.production.triggers]` declares an explicit override rather than inheriting the top-level block:

```
crons = ["*/15 * * * *", "7,22,37,52 * * * *"]
```

Both must be present on the deployed version. `apps/api/src/scheduled.ts` routes them: `"7,22,37,52 * * * *"` is `ONTOLOGY_PIPELINE_MAINTENANCE_CRON` and runs the Codex provider sweep plus ontology-pipeline lease/dispatch/artifact maintenance; every other cron invocation runs the incumbent lane — the Codex provider sweep, the reading scheduler, privacy maintenance, and the Pattern sweep.

The `*/15 * * * *` trigger is the Daily cron the plan requires to be present. Under `hybrid` it is the primary Daily entry point; without it, every scheduled reading would fall to first-open repair and a reader who does not open the app would never get one. Expect it to begin reserving Daily work as soon as the version is live — with the runner still stopped, that work parks as encrypted pending provider jobs, which is the intended state until the next section.

`scheduled()` does not enter the Hono pipeline, so it calls `checkSecureConfig(env)` itself and returns without doing work on a development-shaped deployment. A silent no-op cron is therefore a possible symptom of a configuration fault, not proof of one; read the deployed variables above rather than inferring.

### Bindings, queues, and routes

**State:** NOT RUN

**Evidence required:** the deployed binding list for the recorded version id; the four queue consumer settings as deployed; the route probe status codes and content types.

Named environments inherit nothing, so `[env.production]` redeclares every binding. Confirm the deployed version carries exactly these:

| Kind | Binding | Target |
| --- | --- | --- |
| D1 | `DB` | `patternlike-ops` (the `database_id` committed in `[[env.production.d1_databases]]`, `migrations_dir = ../../db/d1`) |
| R2 | `ARTIFACTS` | `pattern-artifacts` |
| R2 | `PATTERN_REPLAY_LEDGER` | `pattern-erasure-replay` |
| Service | `ONTOLOGY_SIGNER` | `patternlike-ontology-signer-production` |
| Queue producer | `READING_QUEUE` | `patternlike-daily-readings` |
| Queue producer | `PRIVACY_QUEUE` | `patternlike-privacy` |
| Queue producer | `PATTERN_QUEUE` | `patternlike-pattern-generation` |
| Queue producer | `ONTOLOGY_PIPELINE_QUEUE` | `patternlike-ontology-pipeline` |

`ARTIFACTS` must be the production bucket `pattern-artifacts`, not the default `pattern-artifacts-dev`; the same distinction applies to `PATTERN_REPLAY_LEDGER`. The Codex posture that `resolvePublisherConfiguration` and `resolvePatternPublisherConfiguration` both require is `CODEX_RUNNER_TOKEN` + `CODEX_PROVIDER_ARTIFACT_KEYRING` + a bound `ARTIFACTS`; the two secrets must be present on the Worker but their values must never be read, printed, or recorded.

Queue consumers, as declared for production:

| Queue | `max_batch_size` | `max_batch_timeout` | `max_concurrency` | `max_retries` | Dead-letter queue |
| --- | --- | --- | --- | --- | --- |
| `patternlike-daily-readings` | 1 | 5 | not declared | 3 | `patternlike-daily-readings-dlq` |
| `patternlike-privacy` | 1 | 5 | not declared | 3 | `patternlike-privacy-dlq` |
| `patternlike-pattern-generation` | 1 | 5 | 2 | 3 | `patternlike-pattern-generation-dlq` |
| `patternlike-ontology-pipeline` | 1 | 5 | 1 | 3 | `patternlike-ontology-pipeline-dlq` |

All four are batch size `1`. The production queue names carry no `-dev` suffix — a deploy that inherited the development queues would publish real readings off a queue nobody watches.

Static assets and routing, from `[env.production.assets]`:

```
directory = "../web/dist"
not_found_handling = "single-page-application"
run_worker_first = [ "/health", "/v1/*", "/internal/*", "/admin/*", "/codex-provider/*" ]
```

A path family missing from `run_worker_first` is **not** a 404: assets answer first and `single-page-application` returns `index.html` with a **200**, silently serving HTML to an API client. Probe every family and check the content type, using the checks documented in [`api-production.md`](./api-production.md) §3:

```
BASE=https://patternlike-api-production.lfd.workers.dev
curl -s $BASE/            -o /dev/null -w 'shell  %{http_code}\n'   # 200 = assets serving
curl -s $BASE/v1/chart    -o /dev/null -w 'api    %{http_code}\n'   # 401 = API enforcing auth
curl -s $BASE/health      -o /dev/null -w 'health %{http_code}\n'   # 200 = Worker reached

# A 200 with an HTML content-type on /v1/* means run_worker_first is missing a
# path and static assets answered instead:
curl -sI $BASE/v1/chart | grep -i content-type   # expect application/json
```

Extend the same shape to the three remaining families. Every one of these must answer `application/json`, and a `200 text/html` on any of them is a `run_worker_first` fault:

```
curl -sI $BASE/internal/                                   | grep -i content-type
curl -sI $BASE/admin/pattern-generations/does-not-exist    | grep -i content-type
curl -s -o /dev/null -D - -X POST $BASE/codex-provider/v1/jobs/claim | grep -i content-type
```

**Unauthenticated runner routes must disclose no job state.** The three runner routes are `POST /codex-provider/v1/jobs/claim`, `POST /codex-provider/v1/jobs/{jobId}/complete`, and `POST /codex-provider/v1/jobs/{jobId}/fail`, all behind `configGuard` then `codexRunnerAuth` (`apps/api/src/index.ts`). With no `Authorization` header, `codexRunnerAuth` returns `401` with `{ error: { code: "unauthorized", message: "Invalid runner token", request_id } }` and nothing else — no job id, no queue depth, no count. Require exactly that envelope:

```
curl -s -X POST $BASE/codex-provider/v1/jobs/claim
```

Do **not** send a valid `CODEX_RUNNER_TOKEN` from an operator shell. A successful claim consumes a durable job and leases it to a caller that is not the runner.

`/internal/*` (behind `serviceAuth`) and `/admin/*` (behind the administrator token) must likewise answer `401` unauthenticated. Ordinary authenticated reads stay compatible — `GET /v1/readings/today`, `GET /v1/pattern`, `GET /v1/pattern-state` — and must answer `401` without a session cookie rather than `500`. Verify the signed-in behaviour of those reads through the app in a browser, recording status codes only. Do not call `PUT /v1/readings/today` in this task: under `hybrid` it may reserve, and the runner is deliberately still stopped.

A `503 configuration_error` on `/v1/*` means `configGuard` is refusing — an OIDC var, `ROOT_KEK`, or a Codex posture value is unset or drifted. That is a stop, not a wait.

### Record before proceeding

Fill these fields in the restricted change record. Leave no value in this committed file.

```
base_sha:                    <full SHA>
candidate_sha:               <full SHA>
migration_0017_confirmed_at: <UTC timestamp>
runner_state_at_push:        inactive | other
push_at:                     <UTC timestamp>
workers_build_id:            <id>
workers_build_source_commit: <full SHA — must equal candidate_sha>
worker_version_id:           <id>
deployment_id:               <id>
deployment_at:               <UTC timestamp>
traffic_percentage:          <percent — must be 100>
health_environment:          production | other
meta_auth_stub:              false | true
deployed_config_verdict:     matches | drift
bindings_verdict:            matches | drift
routes_verdict:              matches | drift
verdict:                     proceed | stop
```

### Stop conditions

Stop **before the runner starts** — that is, do not begin the next section — if any of the following is true. Where requests could reach incompatible code, roll the Worker back to the last known-good version first and only then investigate; the rollback section of this runbook owns that procedure.

- `git rev-parse origin/main` did not equal `BASE_SHA` at reconfirmation time, or the pushed history is not a fast-forward.
- The Workers Build's source commit is not exactly `CANDIDATE_SHA`, or the build failed.
- No deployment reached 100% traffic, or `wrangler deployments list` does not show the recorded version serving.
- `/health` reports an `environment` other than `production`, or `/v1/meta` reports `auth_stub` true.
- Any deployed value differs from the table above — including `READING_V5_ROLLOUT` not being `hybrid`, `READING_PUBLISHER` or `PATTERN_PUBLISHER` not being `codex`, any of the four `900000` pins (reading, planner, writer, verifier) differing, or `ONTOLOGY_PIPELINE_ROLLOUT` not being `off`.
- `PATTERN_AI_ROLLOUT` or `PATTERN_INTERNAL_ACCOUNT_IDS` appears in the deployed variable list under any value.
- An `[ai]` / Workers AI binding, a non-empty AI Gateway id, or a non-empty `OPENAI_GATEWAY_KEY_ALIAS` appears on the deployed version.
- A binding is missing, points at a `-dev` bucket or queue, or a queue consumer no longer reports `max_batch_size` 1.
- A cron is missing from `["*/15 * * * *", "7,22,37,52 * * * *"]`.
- Any `run_worker_first` family answers with an HTML content type, or an unauthenticated runner, internal, or admin route returns anything other than the bare error envelope.
- `/v1/*` returns `503 configuration_error`.
- The migration inventory, the active ontology, or the ontology's signature/hash proof no longer matches the evidence recorded in the earlier sections of this runbook.

Rolling back the Worker version is safe here and rolling back `0017` is not: `0017` is forward-only and additive to the CHECK relationships only, and the rollback guidance in [`codex-production-provider.md`](./codex-production-provider.md) §12 says to leave `0013`, `0014`, and `0017` and the encrypted artifacts in place. Do not delete leased jobs, overwrite encrypted objects, or switch a frozen in-flight command to another publisher.


## Daily canaries

**State:** NOT RUN

**Evidence required:** the restricted change record must receive, for each of the two paths below and tied to `CANDIDATE_SHA`: the trigger class, the opaque `daily_readings.id` / `jobs.id` / `codex_provider_jobs.id` coordinate, the `(pipeline, owner_id, pass, stage_generation, stage_attempt)` tuple, the published `model` block from the evidence surface, safe lifecycle timestamps, terminal status, integer token counts, the `reading_provider_daily_usage` delta, the request/response envelope hashes and their post-publication cleanup state, and the observed lease-release / nudge / purge outcomes. Nothing in this committed file may be edited to hold a result, an account identifier, a provider request id, or a word of generated prose.

Two Daily entry points must be exercised separately and then shown to converge. `READING_V5_ROLLOUT = "hybrid"` is the only mode that admits both: `ADMITS` in `apps/api/src/services/reading-rollout.ts` gives `hybrid` the `internal`, `first_open`, and `scheduled` entries, and `apps/api/scripts/wrangler-config.test.ts` asserts the production block is `"hybrid"` with `READING_PUBLISHER = "codex"`.

### Preconditions

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the deployed Worker version id observed against `CANDIDATE_SHA`, the canary account coordinates, and the UTC time each precondition was confirmed. The change record itself carries only the two declared cron expressions, the runner's polling state, and the `AI_SYNTHESIS_POLICY_VERSION` and `READING_DAILY_PROVIDER_CALL_LIMIT` values read out of the frozen candidate.

- Task 7 is closed: the runner is live, polling at concurrency 1, with no repeated auth/model/allowance failures.
- The deployed Worker version is exactly `CANDIDATE_SHA`, and `[env.production.triggers]` in `apps/api/wrangler.toml` declares `crons = ["*/15 * * * *", "7,22,37,52 * * * *"]`. The `*/15` lane is the Daily entry point: `apps/api/src/scheduled.ts` sends every cron other than `"7,22,37,52 * * * *"` to `runIncumbentMaintenance`, the only lane that runs `runReadingScheduler`. The `7,22,37,52` lane runs ontology-pipeline maintenance — but both lanes open with `maintainCodexProviderJobs`, so Daily nudge repair and reading-artifact purge can fire on either lane, not only on `*/15`.
- The canary accounts have an active chart, `timezone_source` and `locale_source` both `user_confirmed`, and a current `ai_synthesis` grant.
- **Consent policy version.** Daily requires `AI_SYNTHESIS_POLICY_VERSION`, declared as `"1.1.0"` at `apps/api/src/db/consents.ts:37`. This is a *different constant* from Pattern's, which also currently reads `"1.1.0"`; bumping one does not move the other. Verify the constant in the frozen candidate before granting, and record the value observed — not the value this paragraph names.
- `READING_DAILY_PROVIDER_CALL_LIMIT` is `"10000"` in the production block, asserted by the config test. `providerLimit` in `generate-daily-reading-v5.ts` refuses a non-positive or non-integer value, so a typo fails the command closed rather than running unbounded.

### What may not be done

The scheduled canary is only evidence if ordinary production work produced it.

- Do not call `POST /internal/readings/generate`, `/readings/reissue`, `/readings/invalidate`, `/readings/replace`, or `/readings/sweep` (`apps/api/src/routes/internal-generation.ts`) to create or advance the canary reservation. `/readings/generate` calls `enqueueDailyReading` (`apps/api/src/services/enqueue.ts`), which freezes a legacy deterministic command and never consults the rollout at all; the `pending` row it reserves is `assembly_mode = 'deterministic'` and holds the account's one pending slot for that local day under `uq_daily_readings_pending`, so it does not merely bypass the path under test — it blocks it. Only two surfaces reserve a constrained-model reading: the scheduler (`entry: "scheduled"`) and `PUT /v1/readings/today` (`entry: "first_open"`).
- Do not `UPDATE`, `INSERT`, or `DELETE` any row in `users`, `daily_readings`, `jobs`, `codex_provider_jobs`, or `reading_provider_daily_usage` to fabricate eligibility, reset a cursor, or clear a budget. Every D1 command in this section is `SELECT`-only.
- Do not decrypt `jobs.payload_enc`, `daily_readings.reading_enc`, `reading_sources.evidence_enc`, or any R2 provider envelope for evidence. The clear operational columns and the authenticated product surfaces carry everything the change record needs.

### Canary D1 — the scheduled path

**State:** NOT RUN

**Evidence required:** the cron interval in which the reservation appeared, the opaque reservation/job/provider coordinate, and confirmation that no first-open request was made for that account before the reservation existed.

- Wait for the ordinary `*/15 * * * *` cron to reach the account. `runIncumbentMaintenance` in `apps/api/src/scheduled.ts` runs `maintainCodexProviderJobs`, then `runReadingScheduler`, then privacy maintenance and the Pattern sweep, in that order.
- `runReadingScheduler` reserves through `enqueueConstrainedReading(env, userId, { entry: "scheduled", reservationReason: "scheduled", … })` (`apps/api/src/services/run-reading-scheduler.ts`). The rollout gate runs first, before any calculation call, context decryption, or consent read (`enqueueConstrainedReading` in `apps/api/src/services/enqueue.ts`).
- `daily_readings` has **no clear `reservation_reason` column** (`db/d1/0003_m5_openai_reading_publisher.sql`); the frozen reason lives only inside the encrypted command. The trigger class is therefore established by observation, not by a column: record the cron minute against `jobs.created_at`, and record that the operator issued no `PUT /v1/readings/today` for this account before the reservation appeared. Do not decrypt the command to prove it.
- `TODO(verify):` whether a clear, content-free trigger-class signal should be added. None exists in the current schema.

### Canary D2 — the first-open path

**State:** NOT RUN

**Evidence required:** the HTTP status of the ordinary authenticated request, whether it adopted or created the reservation, and the resulting coordinate.

- Use the normal authenticated product request, `PUT /v1/readings/today` (`apps/api/src/routes/readings.ts`), against an eligible local day with no published reading. The web client calls the same path (`apps/web/src/lib/api-client.ts`).
- The route advances only this authenticated owner's own durable rollout pause, then calls `ensureTodayReading(env, identity, { generationMode: "v5", rolloutEntry: "first_open" })`. It never claims or decrypts in the request path; dispatch stays an opaque `{job_id, reading_id}` nudge and the Queue consumer re-checks the rollout before execution.
- **Adoption, not duplication.** In `apps/api/src/services/ensure-today-reading.ts`, when a pending reservation already exists the route returns `202 preparing` and re-dispatches only when `activeJob.dispatchedAt === null` and the job is due, or when a `running` job's lease has already expired. Only when no reservation exists does it call `enqueueConstrainedReading` with `entry: rolloutEntry` and `reservationReason: "first_open"` — the same primitive the scheduler uses, differing only in the entry admitted by the rollout mode.

### Convergence: one reservation, one Daily job, one current provider coordinate

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the single `daily_readings.id` for that account and local day, the single `jobs.id` its `active_generation_job_id` points at, and the single `(pipeline, owner_id, pass, stage_generation, stage_attempt)` coordinate. The change record itself carries only the row counts that prove one pending row, one published row, one job, and one coordinate.

Prove all three for the same account and local day, whichever path ran first.

- **One reservation.** `db/d1/0003_m5_openai_reading_publisher.sql` creates `uq_daily_readings_pending` — `UNIQUE (user_id, local_date) WHERE status = 'pending'` — and `uq_daily_readings_live` — `UNIQUE (user_id, local_date) WHERE status = 'published'`. A second reservation for the same day is structurally impossible, not merely avoided by ordering.
- **One Daily job.** The reservation points at one `daily_readings.active_generation_job_id`, and `apps/api/src/db/generation.ts` `claimJob` performs a zero-row claim when another consumer holds a live lease or the job is terminal, so a duplicate at-least-once delivery does no work.
- **One current provider coordinate.** `codex_provider_jobs` in `db/d1/0017_codex_reading_provider.sql` carries `UNIQUE (pipeline, owner_id, pass, stage_generation, stage_attempt)` and a CHECK admitting `pipeline = 'reading'` only with `pass = 'publisher'`. `createCodexReadingPublisher` supplies `stageGeneration = command.command_generation` and `stageAttempt = claim.attempts - 1` (`apps/api/src/services/generate-daily-reading-v5.ts`), so both entry points that reach the same claim land on the same coordinate and adopt rather than re-request.

### Lease, nudge, and cleanup proofs

**State:** NOT RUN

**Evidence required:** the restricted change record must receive `jobs.attempts` and `stage_attempt` read before and after each `publisher_pending` cycle, the `codex_provider_nudge_observed` outcomes with their repair count, and the before/after presence of the two exchange object keys — the object keys themselves are never written down, in either record.

- **The Daily lease is handed back without spending a Daily attempt.** `publish` returns `{ ok: false, code: "publisher_pending", job_id }` while the runner holds the work (`apps/api/src/services/codex-reading-publisher.ts`). `apps/api/src/queue.ts` then calls `releaseClaimForPublisherPending` *before* acknowledging; if D1 cannot prove the release it retries instead of acking, so the job is never stranded behind a live lease. `releaseClaimForPublisherPending` (`apps/api/src/db/generation.ts`) sets `status = 'queued'`, `result_class = 'publisher_pending'`, and clears `claim_token`, `lease_expires_at`, and `available_at`, guarded on the claim token. `claimJob` then leaves `attempts` unchanged when `result_class = 'publisher_pending'` — which is what keeps `stageAttempt` on the same coordinate. **Expected evidence: `jobs.attempts` does not increase across a `publisher_pending` cycle, and `stage_attempt` does not move.**
- **Terminalization nudges the opaque Daily message.** After a proven release the Queue handler re-reads the provider job and, if it is `completed` or `failed`, calls `nudgeCodexProviderOwner`. For `pipeline = 'reading'` that is `nudgeCurrentDailyOwner` (`apps/api/src/services/codex-provider-domain.ts`): it clears `dispatched_at` under a guard that also compares `command_generation` against the reservation's clear column, sends `{ job_id, reading_id }` on the reading queue, then stamps `dispatched_at`. A failed send deliberately leaves `dispatched_at` NULL so scheduled repair finds it.
- **A lost nudge is repaired on a cron interval.** `READING_NUDGE_REPAIR_SQL` in `apps/api/src/services/codex-provider-maintenance.ts` selects terminal reading provider jobs whose Daily owner is `queued`, unclaimed, `result_class = 'publisher_pending'`, with a `pending` `constrained_model` reservation, and whose `dispatched_at` is NULL or predates `provider.completed_at`. Each repair emits `codex_provider_nudge_observed` with its outcome. **Expected evidence: at most a bounded repair count, and zero `still_owned` loops.**
- **Cleanup is owner-driven for Daily, not time-driven.** `READING_PURGE_SQL` selects terminal reading provider jobs for which no live owner remains, and `purgeTerminalJobs` deletes both R2 object keys, re-`head`s them, and only then deletes the D1 row. It skips any job whose owner is still current or which has an uncommitted response upload. There is no retention cutoff on the reading branch; the 30-day `PATTERN_ARTIFACT_RETENTION_DAYS` cutoff applies to the pattern branch only. **Expected evidence: the exchange artifacts are gone after publication, and `GET /v1/readings/today` plus `GET /v1/readings/{id}/evidence` still answer for the published reading.**

### Read-only observation commands

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the exact command text as run, the UTC time it was run, and the returned rows — every selected column is a count, a hash-free closed code, a pin, an integer, or a timestamp, and any row correlated to an account or a reservation stays in that record only. The change record itself carries the aggregate counts and the closed status vocabulary observed, nothing else.

Run these only against production, only as written, and only after the canary has had time to reach a terminal state. Every selected column is a count, a hash-free closed code, a pin, an integer, or a timestamp.

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT pipeline, pass, status, stage_generation, stage_attempt, model, reasoning_effort, prompt_version, timeout_ms, daily_call_limit, failure_code, safe_detail_code, input_tokens, output_tokens, created_at, completed_at FROM codex_provider_jobs WHERE pipeline = 'reading' ORDER BY created_at DESC LIMIT 10"
```

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT 'reading' AS ledger, utc_date, used_calls, NULL AS planner_calls, NULL AS writer_calls, NULL AS verifier_calls FROM reading_provider_daily_usage UNION ALL SELECT 'pattern', utc_date, used_calls, planner_calls, writer_calls, verifier_calls FROM pattern_provider_daily_usage UNION ALL SELECT 'ontology', utc_date, used_calls, generator_calls, evaluator_calls, regression_calls FROM pattern_ontology_provider_daily_usage ORDER BY ledger, utc_date DESC LIMIT 12"
```

The budget is charged in exactly one place: `consumeBudget` in `apps/api/src/routes/codex-provider.ts` calls `consumeProviderCallBudget` at the moment the runner is handed a plaintext invocation. Creating, adopting, polling, completing, and publishing are all free, and a reclaimed lease charges again on purpose. `reading_provider_daily_usage` is keyed by `utc_date` alone — there is no per-user counter, by design (`apps/api/src/db/provider-usage.ts`).

### Content-free evidence to record, per path

| Field | Where it is read | Restricted record only? |
| --- | --- | --- |
| Trigger class (scheduled / first-open) | operator observation; see Canary D1 | no |
| `daily_readings.id`, `jobs.id`, `codex_provider_jobs.id` | product response / D1 | **yes** |
| `stage_generation`, `stage_attempt`, `jobs.attempts` | `codex_provider_jobs`, `jobs` | no |
| `status`, `failure_code`, `safe_detail_code`, `result_class` | closed vocabularies in `0017` and `jobs` | no |
| `model`, `prompt_version`, `reasoning_effort`, `timeout_ms`, `daily_call_limit` | `codex_provider_jobs` | no |
| `input_tokens`, `output_tokens` | `codex_provider_jobs` | no |
| `reading_provider_daily_usage.used_calls` before/after | D1 | no |
| Published `model.provider` = `"codex"` | `GET /v1/readings/{id}/evidence` `model` block | no |
| `provider_request_id` | same `model` block | **yes** |
| `content_hash`, `provider_response_hash` | same evidence response | **yes** |
| `created_at`, `completed_at`, `dispatched_at` | D1 | no |
| Nudge outcome | `codex_provider_nudge_observed` (`pipeline`, `outcome`) | no |
| Provider job count and oldest age, per pass and status | `codex_provider_pipeline_observed` | no |
| Artifact purge | no log line exists — `maintainCodexProviderJobs` returns its purge count and `scheduled.ts` discards it. Observe purge as the terminal `codex_provider_jobs` rows disappearing between two runs of the first query above. | no |

`READING_PUBLISHER_PROVIDER` is `"codex"` (`apps/api/src/services/reading-publisher.ts`), and it is what `generate-daily-reading-v5.ts` writes into the sealed evidence header's `model.provider`. The reader-facing `disclosure` string is a fixed sentence in the same file and is not per-run evidence. The evidence response also carries paragraph fact labels — **do not copy those anywhere**; record only the `model` block, the hashes, and the calculation pins.

### Stop conditions

Stop the canary and do not proceed to Task 9 on any of: OpenAI or Workers AI routing; a synthetic response; `stage_attempt` drift across a `publisher_pending` cycle; a second `pending` or `published` row for the same account/day; acceptance of a stale `ai_synthesis` policy version; a candidate accepted past `validateOutputSchema` or `validateReadingCandidate`; any prompt, response, prose, user id, or lease token in log output; a `reading_provider_daily_usage` delta that does not match the observed claim count; a `publisher_pending` job that no nudge or scheduled repair ever wakes; or exchange artifacts still present after the owner reached a terminal state.

### Daily rollback control

**State:** NOT RUN

**Evidence required:** the reviewed rollback commit SHA, the resulting Worker version and deployment ids, and the observed pause counts — recorded only if this control is exercised.

If Daily alone is faulty, set `READING_V5_ROLLOUT` to `"off"` in a reviewed rollback candidate and deploy it. This is a committed variable in `[env.production.vars]` of `apps/api/wrangler.toml`, so it is a code change and a deployment, not a console edit. `off` is a real kill switch, not a provider switch: `enqueueConstrainedReading` refuses before any calculation call or DEK load, and `apps/api/src/queue.ts` calls `pauseQueuedV2ForRolloutOff` to durably defer work already in flight **before** any claim, command decryption, or provider job — so the platform retry budget is not spent and no provider is reached. Published readings stay readable.

Stop the runner only if shared provider containment is also needed; it is the shared control for Daily, Pattern, and the ontology pipeline at once. Do not mutate a frozen command to another publisher, and do not reintroduce an account gate.

---

## Pattern canary

**State:** NOT RUN

**Evidence required:** the restricted change record must receive, tied to `CANDIDATE_SHA`: the opaque `generation_id` and per-pass `codex_provider_jobs.id` coordinates, `stage_generation` and the three attempt counters at each terminal transition, the closed terminal stage, the frozen model/prompt/timeout pins, integer token counts, the `pattern_provider_daily_usage` delta with its per-pass attribution, the ontology version and bundle/corpus hashes actually pinned, `plan_hash` / `candidate_hash` / `semantic_verdict_hash`, the published `compact_provenance_json`, `pattern_documents.content_hash`, and the observed artifact cleanup. No prompt, plan, draft, verdict text, Pattern prose, account id, or consent id may enter this file or the PR.

Every subsection below carries its own `**State:**` and `**Evidence required:**` pair; none of them inherits this one silently.

### Preconditions

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the canary account coordinate, the prior-allowlist non-membership finding, and the UTC time each precondition was confirmed. The change record itself carries the Task 2 ontology coordinates re-read at candidate freeze, the observed absence of `PATTERN_AI_ROLLOUT` and `PATTERN_INTERNAL_ACCOUNT_IDS` from the deployed configuration, the runner's polling state, and the `PATTERN_GENERATION_CONSENT_POLICY_VERSION` value read out of the frozen candidate.

- Task 2 is closed and its result is recorded, **including the authored-release trade**: `ontologyServesAccount` (`apps/api/src/db/pattern-ontology.ts`) returns true for `provenance.origin === "synthetic_internal"` on origin alone, and requires `activationScope === "public"` only for `machine_pipeline`. An authored active ontology therefore serves every account while skipping the independent evaluator and the seven regression hard gates, and Pattern is account-wide, so there is no cohort to contain the consequence.
- Task 7 is closed and the runner is live.
- **The account was never in the removed allowlist.** The allowlist is gone from the code: `apps/api/scripts/wrangler-config.test.ts` asserts that neither `PATTERN_AI_ROLLOUT` nor `PATTERN_INTERNAL_ACCOUNT_IDS` appears in either the development or the production `vars` block, under any value. Confirm from the restricted record of the *prior* allowlist that this canary account was never a member, and confirm the deployed configuration declares neither name.
- The account has an active chart, `locale_source = "user_confirmed"`, and no consumed claim for its current chart fingerprint.
- **Consent policy version.** Pattern requires `PATTERN_GENERATION_CONSENT_POLICY_VERSION`, declared as `"1.1.0"` at `packages/shared/src/m7-types.ts:33`. It is versioned independently of `M7_SCHEMA_VERSION` (`"0.7.0"`) and independently of Daily's `AI_SYNTHESIS_POLICY_VERSION`. Read the constant out of the frozen candidate and record the value observed.

### Granting fresh consent and submitting the confirmation

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the opaque `generation_id`, the account coordinate, and the idempotency key used. The change record itself carries the HTTP status (`202` for a fresh acceptance, `200` for a replay), which rung of the admission ladder answered, and the `consent_policy_version` string sent and accepted. No confirmation body, prompt, `consent_id`, or generated prose is recorded in either record.

There is no `POST /v1/consents/pattern-generation`. `apps/api/src/routes/pattern-ai.ts` exposes only `GET` and `DELETE` on that path; the grant is minted inside the accepted generation request itself, by `insertPatternConsentGrant` in `enqueuePatternGeneration` when the account has no live grant. So the confirmation submission **is** the consent event, and it must be made through the ordinary authenticated product flow.

The request must satisfy, exactly (`apps/api/src/routes/pattern-ai.ts`):

- an `Idempotency-Key` header, 8–128 characters;
- `schema_version` equal to `M7_SCHEMA_VERSION`;
- `confirm` equal to the literal string `GENERATE MY PATTERN`;
- `reason` one of `first_open`, `first_open_retry`, `failed_attempt_retry`;
- `consent_policy_version` a string, which `enqueuePatternGeneration` compares against `PATTERN_GENERATION_CONSENT_POLICY_VERSION` and refuses with `409 consent_policy_version_stale` on any mismatch.

Do not create a grant, claim, job, `pattern_generation_jobs` row, or `pattern_documents` row directly in D1, and do not hand-post a request that bypasses the authenticated session.

### What the accepted request proves about admission

`enqueuePatternGeneration` (`apps/api/src/services/pattern-enqueue.ts`) is the whole admission ladder, in this order, with no account, cohort, allowlist, or product switch anywhere in it:

1. stale consent policy version → `409 consent_policy_version_stale`;
2. stored reservation under the same idempotency key → `200` replay of the same `generation_id`;
3. no active chart → `409 chart_required`;
4. locale not `user_confirmed` → `409 locale_confirmation_required`;
5. `ontologyServesAccount` false → `409 ontology_unavailable`;
6. consumed claim → `409 pattern_already_consumed`; a `reserved` claim replays;
7. `reason: "failed_attempt_retry"` with no prior `failed` job for that chart fingerprint → `409 pattern_retry_not_available`;
8. **last**, deployment provider configuration → `503 pattern_generation_unavailable`. It is placed last deliberately, so a spend/transport control cannot shadow a refusal the reader can act on.

(`409 pattern_generation_consent_required` also exists at this point but is reachable only for the internal `chart_correction` reason, which the authenticated route cannot send.)

Record which rung answered, and the HTTP status — `202` for a fresh acceptance, `200` for a replay.

### Ontology pin and the generated flow

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the `generation_id`, the per-pass provider job ids, `plan_hash`, `candidate_hash`, `semantic_verdict_hash`, and `pattern_documents.content_hash`. The change record itself carries the pinned `ontology_version`, `ontology_bundle_hash`, and `corpus_release_hash` compared against Task 2, the observed public stage sequence, the frozen model/prompt/timeout pins, the three attempt counters, the total provider-call count, and integer token counts. No plan, draft, verdict text, or Pattern prose is recorded in either record.

- The frozen command carries `ontology_version`, `ontology_bundle_hash`, and `corpus_release_hash` copied from `loadActiveOntology` at enqueue. **These must equal the coordinates verified in Task 2.**
- At execute, `apps/api/src/services/pattern-execute.ts` re-loads the ontology by the pinned version and fails the job closed unless the stored bundle hash matches the pinned one. A later activation cannot silently re-point an in-flight generation.
- The bounded stage ceilings are frozen into the command: `planner_attempts_max: 2`, `writer_attempts_max: 3`, `verifier_attempts_max: 2`. Inclusive and differently scoped, the worst case is `2 + 3 + (3 × 2) = 11` provider calls for one generation — not 7 and not 14.
- Every pass calls `getArtifactAt` before reserving budget or fetching, so a crash after a create-only response write reuses the same attempt coordinate and spends no second call.
- `runPublisherPass` rejects executed metadata whose provider, pass, model, or prompt version differs from the frozen pin, or whose token counts or response hash are null. `provenanceFromExecutedPin` refuses any publisher but Codex for a *new* document and maps only the compiled writer model into a public `model_family`.
- Public stage progression the reader sees is the closed set `organizing_evidence` → `writing` → `checking_claims` (`publicStageFor` in `apps/api/src/services/pattern-stage-protocol.ts`), then state `ready`. Observe it through `GET /v1/pattern-generations/{generation_id}` and `GET /v1/pattern-state`.
- On publication the document row records `ontology_version`, `ontology_bundle_hash`, `content_hash`, and `compact_provenance_json`; the claim flips to `accepted` with `consumed_at` and `accepted_at`; an audit row `pattern_generation.published` is written. The published compact provenance is `assembly_mode: "constrained_model"`, `provider: "Codex"`, `model_family` from the compiled allowlist, `raw_birth_details_sent: false`, plus the ontology and selection policy versions. Note the case: Daily stores `"codex"`, Pattern stores the display name `"Codex"` (`patternProviderDisplayName`).

### Read-only observation commands

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the exact command text as run, the UTC time it was run, and any returned row correlated to a generation. The change record itself carries the closed stage and failure vocabularies, the counters, the pins, the integers, and the timestamps observed. The `generation_id` is copied into the restricted change record from the authenticated product response, never from a widened query.

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT stage, stage_generation, planner_attempts, writer_attempts, verifier_attempts, reservation_reason, consent_policy_version, ontology_version, public_failure_stage, failure_class, cancellation_reason, created_at, updated_at, finished_at FROM pattern_generation_jobs ORDER BY created_at DESC LIMIT 5"
```

```bash
npx wrangler d1 execute patternlike-ops --config apps/api/wrangler.toml --env production --remote --command "SELECT pipeline, pass, status, stage_generation, stage_attempt, model, reasoning_effort, prompt_version, timeout_ms, daily_call_limit, failure_code, safe_detail_code, input_tokens, output_tokens, created_at, completed_at FROM codex_provider_jobs WHERE pipeline = 'pattern' ORDER BY created_at DESC LIMIT 20"
```

Neither query selects a user id, a generation id, an object key, a request hash, or any encrypted column. Copy the opaque `generation_id` into the restricted record from the authenticated product response, not from a widened query.

### The no-reroll proof

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the two `generation_id` values returned and the two idempotency keys used. The change record itself carries both HTTP statuses (`200` replay, `409 pattern_already_consumed`) and the `pattern_provider_daily_usage` row for the day shown unchanged across both repeats.

Two distinct repeats, and they answer differently:

- **Same `Idempotency-Key`.** `loadStoredReservation` finds the stored reservation and returns `200` with the *same* `generation_id` and the replayed public stage. No second job, no second claim, no second provider call.
- **New `Idempotency-Key`, after the claim is consumed.** `isConsumedStatus` (`apps/api/src/db/pattern-claims.ts`) treats `accepted`, `deleted`, `superseded`, and `withdrawn` as consumed, so the request is refused `409 pattern_already_consumed`. `pattern_generation_claims` is `UNIQUE (user_id, chart_fingerprint_hash)` and `pattern_documents` is `UNIQUE (user_id)`, so a second Pattern for the same chart is structurally impossible, not merely refused by a check.

Record both statuses, both response bodies' `generation_id` values (restricted record only), and the fact that `pattern_provider_daily_usage` did not move for either repeat.

### Consent revocation behavior

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the account coordinate and the idempotency key used. The change record itself carries the HTTP status, the `existing_pattern_retained` boolean, the resulting `pattern_generation_claims.status`, the `pattern_generation_jobs.cancellation_reason`, and the `jobs.result_class` of any cancelled row. No `consent_id`, consent-chain row, or document content is recorded in either record.

Revoke through the ordinary authenticated `DELETE /v1/consents/pattern-generation` with an idempotency key. `revokePatternGenerationConsent` (`apps/api/src/services/pattern-lifecycle.ts`) commits one batch that:

- appends a revoke row to the append-only consent chain (driven by the stored row, not by the grant helper, so a policy-version bump cannot turn revoke into a silent no-op);
- sets every non-terminal `pattern_generation_jobs` row for the user to `stage = 'cancelled'` with `cancellation_reason = 'consent_revoked'`;
- cancels the user's `queued`/`running` Pattern `jobs` rows with `result_class = 'consent_revoked'`, clearing claim token and lease;
- returns a `reserved`, unconsumed claim to `available` — an already-`accepted` claim is untouched.

It returns `{ retained }`, which the route surfaces as `existing_pattern_retained`. **Revocation does not erase a published Pattern.** Erasure is the separate `DELETE /v1/pattern` with `confirm: "DELETE PATTERN"`, which deletes the document row, nulls every wrapped artifact key for the user, moves the claim to `deleted`, and writes a replay-ledger intent. Record the boolean and the resulting `pattern_generation_claims.status` — never the document.

### Content-free evidence to record

`generation_id`, per-pass provider job ids, `provider_request_id`s, and `content_hash` go to the restricted record only. The following may be recorded in the change record without restriction: closed stage and failure vocabularies; `stage_generation`; the three attempt counters; `consent_policy_version`; `ontology_version` and bundle/corpus hashes (already public in Task 2's proof); the frozen model, prompt version, reasoning effort, and 900000-ms timeout pins; integer token counts; the `pattern_provider_daily_usage` delta with `planner_calls` / `writer_calls` / `verifier_calls` attribution; artifact cleanup counts; and the final `ready` state.

### Stop conditions

Stop on any of: an account, cohort, or allowlist decision appearing anywhere in the path; an `ontology_version` other than the one verified in Task 2; more than the frozen 2 / 3 / 2 attempts or more than 11 provider calls for one generation; OpenAI, Workers AI, or synthetic routing; human content substituted for a model pass; a candidate published without deterministic plan validation, deterministic candidate validation, and independent semantic verification; any plaintext prompt, plan, draft, verdict, or prose in logs or terminal output; a duplicate claim or a second document for one chart fingerprint; or a budget delta that does not match the observed per-pass claim count.

### Rollback: there is no Pattern kill switch

**State:** NOT RUN

**Evidence required:** the restricted change record must receive the reviewed rollback commit SHA, the resulting Worker version and deployment ids observed from `wrangler deployments list` before and after, and the runner stop/start record with its UTC times — recorded only if this control is exercised.

Verified against both the plan and `apps/api/wrangler.toml`: the production block declares **no** Pattern rollout, cohort, or allowlist variable, and `apps/api/scripts/wrangler-config.test.ts` asserts that `PATTERN_AI_ROLLOUT` and `PATTERN_INTERNAL_ACCOUNT_IDS` are absent from both blocks — absence is the contract, because an empty string would be a switch someone could set. `READING_V5_ROLLOUT` governs Daily only and is not a Pattern control.

On a Pattern product fault:

1. stop the runner — this is the shared immediate provider containment control, and it stops Daily and the ontology pipeline too. In-flight provider work is then cancelled by the ordinary current-owner checks at claim time rather than by an account gate;
2. roll the entire Worker back to the recorded last-known-good version;
3. verify the rolled-back behavior against migration `0017`, which stays applied — do not roll a migration back, delete leased jobs, or overwrite encrypted objects;
4. preserve historical provenance, jobs, and terminal rows for incident analysis.

Record the deployment inventory before and after with the command the plan already uses:

```bash
npx wrangler deployments list --config apps/api/wrangler.toml --env production
```

`TODO(verify):` the exact repository-local Wrangler invocation that performs the version rollback. Neither the plan nor any committed runbook states it, and it must not be guessed — confirm it against current Cloudflare versions-and-deployments guidance before the rollback is needed, not during it.

Recalling the active ontology is the one remaining Pattern-specific containment lever, and it is **not** a quiet switch: `isOntologyRecalled` causes an already-published document to read as state `withdrawn` for its reader (`apps/api/src/services/pattern-state.ts`), and new requests refuse with `409 ontology_unavailable`. Treat it as a reader-visible product action requiring its own authorization, not as a rollback step.


## Observation window

**State:** NOT RUN

**Evidence required:** the restricted change record must receive, tied to `CANDIDATE_SHA` — the window's start and end timestamps in UTC; the number of `*/15` and `7,22,37,52` cron invocations observed; per-pipeline/per-pass/per-status counts and oldest waiting age at the first and last invocation; every `failure_code`/`safe_detail_code` pair observed; nudge-outcome counts; queue-lag counts; artifact-cleanup counts; the three budget ledger deltas for each UTC date the window spans; and the complete `npm run ci:local` summary from the clean checkout. No prompt, response, prose, account id, chart value, consent id, lease token, artifact key, or object key may appear in any of it.

### The interval claims, confirmed against the cron expressions

Both crons are declared for production in `apps/api/wrangler.toml:286-287`:

```toml
[env.production.triggers]
crons = ["*/15 * * * *", "7,22,37,52 * * * *"]
```

`apps/api/scripts/wrangler-config.test.ts:61-64` asserts that exact pair, and `apps/api/src/scheduled.ts` dispatches on the string: `ONTOLOGY_PIPELINE_MAINTENANCE_CRON = "7,22,37,52 * * * *"` (`scheduled.ts:15-16`) routes to `runOntologyPipelineMaintenance` (lines 31-34), and every other cron falls through to `runIncumbentMaintenance` (line 35). What each lane runs:

| Lane | Cron | Fires per hour | Runs |
| --- | --- | --- | --- |
| Incumbent | `*/15 * * * *` | 4 (`:00 :15 :30 :45`) | `maintainCodexProviderJobs`, `runReadingScheduler`, `runPrivacyMaintenance`, `sweepPatternJobs` (`scheduled.ts:38-67`) |
| Ontology | `7,22,37,52 * * * *` | 4 (`:07 :22 :37 :52`) | `maintainCodexProviderJobs`, then the four ontology-pipeline lanes (`scheduled.ts:69-108`) |

Three corrections follow from that, and they change how the window is timed:

1. **The Daily scheduler interval is 15 minutes.** `runReadingScheduler` runs only in the incumbent lane, so four Daily scheduler intervals is **60 minutes of wall clock**, starting at the first `*/15` boundary strictly after both canaries reached a terminal state.
2. **The shared provider maintenance is not exclusive to the 15-minute lane.** `maintainCodexProviderJobs` is the first call in *both* handlers (`scheduled.ts:44`, `scheduled.ts:75`), so it runs 8 times an hour at alternating 7–8 minute gaps. "One complete 15-minute shared maintenance interval" is therefore satisfied *inside* the four-interval window and is not an additional wait — the binding constraint is the 60 minutes. Do not shorten the window on the belief that the maintenance pass is the shorter of the two.
3. **Ages must be judged against the lease, not the cron.** `CODEX_PROVIDER_LEASE_MS = 1_200_000` and `CODEX_PROVIDER_TIMEOUT_MS = 900_000` (`apps/api/src/services/codex-provider-contract.ts:6-7`). A legitimately leased provider job outlives a full 15-minute maintenance interval by design, so a single `leased` row aged under 20 minutes is not evidence of anything. A 60-minute window covers three lease lifetimes, which is the minimum that makes "pending-age growth" a meaningful reading.

### What to record

Every item below is a count, an age, a closed status, or an integer. Nothing here carries content.

**Provider control plane** — from `codex_provider_jobs`, grouped by `pipeline`, `pass`, and `status`, with oldest `created_at` age, captured at the first and last cron invocation in the window. `observePipeline` already emits exactly this shape as `codex_provider_pipeline_observed` with `{pipeline, pass, status, count, oldest_age_seconds}` (`apps/api/src/services/codex-provider-maintenance.ts:354-387`); `oldest_age_seconds` is populated only for `pending` and `leased`. Note that `maintainCodexProviderJobs` skips a pipeline entirely when it has no rows (`hasPipelineJobs`, line 337), so an absent pipeline line means "no rows", not "not observed".

**Failure codes** — the closed vocabulary the schema permits, from `db/d1/0017_codex_reading_provider.sql:136-151`: `failure_code` ∈ `publisher_unavailable`, `publisher_output_invalid`, `publisher_refused`, `publisher_auth_failed`, `publisher_model_unavailable`, `publisher_budget_exhausted`; `safe_detail_code` ∈ `request_timeout`, `network_error`, `rate_limited`, `provider_5xx`, `authentication_failed`, `model_not_available`, `provider_refusal`, `max_output_tokens_exhausted`, `missing_output_text`, `multiple_output_text`, `invalid_json`, `schema_mismatch`, `daily_call_limit_reached`. Record the pair, never a message.

**Lease recovery and stale cancellation** — count of rows cancelled by `cancelStaleJobs`, which selects `pending` rows and `leased` rows whose `lease_expires_at` has passed, and cancels only those whose owner is no longer current (`codex-provider-maintenance.ts:47-69`). Each pass is bounded at `MAINTENANCE_LIMIT = 50` per pipeline (line 17); a count that pins to 50 on consecutive passes is a backlog, not a clean window.

**Nudge repair** — `codex_provider_nudge_observed` with `outcome` ∈ `sent`, `not_current`, `still_owned`, `send_failed` (`codex-provider-maintenance.ts:171-175`; the type is at `codex-provider-domain.ts:275-279`). `sent` is repair working. Repeated `send_failed` for the same pipeline is a Queue fault; `still_owned` in bulk means the ownership comparison is rejecting results.

**Queue lag** — count and oldest age of Daily rows in the parked state the nudge repair exists for: `jobs.job_type = 'generate_daily_reading'`, `status = 'queued'`, `claim_token IS NULL`, `result_class = 'publisher_pending'`, with a `pending` `constrained_model` reservation (`READING_NUDGE_REPAIR_SQL`, `codex-provider-maintenance.ts:81-100`). Also record `scheduler_repair_quota_exhausted`, emitted when the scheduler's repair quota is spent in a pass (`scheduled.ts:50-52`; `SchedulerSummary.repairQuotaExhausted`, `run-reading-scheduler.ts:42`).

**Worker events** — the closed `safeLog` event names that would appear if something went wrong, with counts only: `generation_retryable_failure`, `generation_failed`, `generation_threw`, `generation_message_malformed`, `generation_claim_release_failed`, `codex_provider_dispatch_failed` (`apps/api/src/queue.ts`), `pattern_dispatch_failed`, `pattern_stage_terminal_failure`, `pattern_stage_terminal_failure_write_failed`, `pattern_artifact_cleanup_failed` (`apps/api/src/services/pattern-sweep.ts`), `codex_provider_job_conflict` (`apps/api/src/routes/codex-provider.ts:279-283`), and `insecure_configuration` (`scheduled.ts:25-27`, `queue.ts:167`) — the last of which must be zero, because it means the cron or queue refused on configuration.

**Artifact cleanup** — three different clocks, and only two of them are observable in a 60-minute window:

- *Reading* artifacts are owner-driven, not time-driven: `READING_PURGE_SQL` selects terminal reading jobs with no live Daily owner (`codex-provider-maintenance.ts:111-126`), so a published canary reading's exchange artifacts should be deleted within the window. This is the cleanup to prove.
- *Stale response uploads* are purged every pass regardless of pipeline (`purgeStaleResponseUploads`, lines 265-325, called before the pipeline loop at line 335). Record the count; a persistently non-zero count means R2 deletes are failing.
- *Pattern* artifacts wait `PATTERN_ARTIFACT_RETENTION_DAYS = 30` (`apps/api/src/services/pattern-publisher.ts:100`, pinned as `"30"` at `wrangler.toml:429`), and *ontology* failed artifacts wait `failed_artifact_expires_at` under `ONTOLOGY_PIPELINE_FAILED_ARTIFACT_RETENTION_DAYS = "7"` (`wrangler.toml:455`). **Neither can be observed inside this window.** Record that as expected, not as failed cleanup.

**All three budget ledgers**, for every UTC date the window spans — `reading_provider_daily_usage` (`db/d1/0003_m5_openai_reading_publisher.sql:92`), `pattern_provider_daily_usage` and `pattern_ontology_provider_daily_usage` (`db/d1/0007_ai_generated_pattern.sql:420,427`). Record `used_calls` at window start and end and the delta. The ontology ledger's delta must be zero: `ONTOLOGY_PIPELINE_ROLLOUT = "off"` (`wrangler.toml:440`, asserted at `wrangler-config.test.ts:93`).

### Zero-tolerance conditions before declaring stable

Any one of these is a stop; none is a judgement call:

- **Unexplained pending-age growth.** `oldest_age_seconds` for any `pending` or `leased` pass rising across consecutive passes without a lease or a running invocation that accounts for it.
- **Repeated lease churn.** The same job coordinate re-appearing as `leased` after cancellation, or `cancelStaleJobs` returning non-zero on every pass.
- **Content leakage.** Any prompt, model output, prose fragment, birth value, account id, chart id, consent id, lease token, artifact key, or object key in Worker logs, runner journal, or any recorded evidence.
- **Stale-owner adoption.** Any published result whose provider coordinate did not satisfy `codexProviderOwnerIsCurrent` — visible as a `codex_provider_job_conflict` that nevertheless produced a publication, or a `not_current` nudge followed by a publish.
- **Over-budget claims.** A ledger delta exceeding the invocations the recorded jobs account for, or any `publisher_budget_exhausted` / `daily_call_limit_reached` pair that the approved ceilings do not explain (`READING_DAILY_PROVIDER_CALL_LIMIT = "10000"` at `wrangler.toml:498`, `PATTERN_DAILY_PROVIDER_CALL_LIMIT = "100"` at line 428).
- **Failed cleanup.** A `pattern_artifact_cleanup_failed` event, a reading exchange artifact still present after its Daily owner reached a terminal state, or a `codex_provider_response_uploads` row surviving repeated passes.
- **Any `insecure_configuration` event**, on any surface.

### Final clean-checkout verification

Run from a clean checkout of `CANDIDATE_SHA` and attach the new complete summary to the PR and change record:

```
nvm use "$(cat .nvmrc)"
npm ci
npm run ci:local
```

`ci:local` is `bash scripts/ci-local.sh` (`package.json:20`); `.nvmrc` pins Node `22`. GitHub Actions' billing failure remains infrastructure-only evidence and is not a substitute.

Then confirm the runbooks committed in Tasks 1–2 still accurately describe Codex Daily, account-wide Pattern, the active ontology, the Daily rollback, and the whole-Worker Pattern rollback. Record the current observed deployment state in the restricted change record — **do not create a second source SHA to hold it.**

Mark the rollout complete only when scheduled Daily, first-open Daily, and a formerly non-allowlisted Pattern have all published through the production runner **and** the observation window is clean by every condition above.

## Rollback

**State:** NOT RUN

**Evidence required:** if any control is exercised, the restricted change record must receive — which control, who authorized it, the UTC timestamp, the exact command or request issued (with no secret, token, account id, or version-scoped identifier that is itself sensitive), the resulting Worker version and deployment id where one is created, the before/after counts the control was expected to move, and the verification that the *uncovered* surfaces named in its row were checked and found unaffected.

Verified against the code and configuration in this worktree, not against the plan's prose. Read the "does not cover" column before choosing a control: **no single control here contains everything**, and two of them are irreversible.

| Control | Exact action | What it does NOT cover | Blast radius |
| --- | --- | --- | --- |
| **Daily — `READING_V5_ROLLOUT="off"`** | It is a committed var, not a secret: set `READING_V5_ROLLOUT = "off"` in `[env.production.vars]` (`apps/api/wrangler.toml:356`) in a reviewed rollback candidate and deploy it. `wrangler-config.test.ts:69` asserts the value, so this is a code change with its own gate — either merged (which triggers Workers Builds) or deployed directly with `npm run deploy:api` (`package.json:21`). | Pattern — there is no equivalent switch, and `wrangler-config.test.ts:101-102` asserts `PATTERN_AI_ROLLOUT` and `PATTERN_INTERNAL_ACCOUNT_IDS` stay absent from both blocks. Not the ontology pipeline. Not the runner or its ChatGPT session. Not provider spend already counted in `reading_provider_daily_usage` — there is no refund. Not the encrypted request artifact already written for a created provider job. | Every account and all three Daily entry points at once: `ADMITS.off` is the empty set (`services/reading-rollout.ts:54`). Queued Daily jobs park as `result_class = 'rollout_paused'` with no command decryption, no claim, and no provider call (`queue.ts:290-303`, `db/generation.ts:1115-1135`); `runReadingScheduler` returns `status: "disabled"` and reserves nothing (`run-reading-scheduler.ts:122`); published readings stay readable. In-flight provider work is refused, not adopted — with the rollout off `resolvePublisherConfiguration` yields a null config, `readingProviderOwnerIsCurrent` returns false (`services/reading-current-owner.ts:105-107,141`), and both `POST /codex-provider/v1/jobs/claim` and `POST /codex-provider/v1/jobs/:jobId/complete` cancel the job instead (`routes/codex-provider.ts:273-285`, `463-470`). **Reversible:** `resumePausedV2AfterRollout` re-offers the parked rows on the scheduler's next pass (`run-reading-scheduler.ts:142`; counted as `repair.rolloutPausesResumed`). |
| **Shared provider containment — stop the runner** | On the runner host: `systemctl stop patternlike-codex-runner`, then `systemctl is-active patternlike-codex-runner`. | Nothing already published. Not the Worker: it keeps serving, keeps reserving Daily days, keeps accepting Pattern confirmations, and keeps *creating* `codex_provider_jobs` rows and encrypted request artifacts, which accumulate `pending`. Not the crons. Not the ChatGPT session or workspace authorization. Not instantaneous — the stop is graceful and the runner finishes its one active invocation, with `TimeoutStopSec=16min` deliberately exceeding the 15-minute `CODEX_PROVIDER_TIMEOUT_MS` (`apps/codex-runner/systemd/patternlike-codex-runner.service:21`; `docs/deploy/codex-production-provider.md:261-263`), so allow ~16 minutes and expect one more provider result to arrive. | All three pipelines at once — `reading`, `pattern`, and `ontology` share one runner at `CODEX_RUNNER_CONCURRENCY=1` (`apps/codex-runner/src/runner.ts:77-83`; `docs/deploy/codex-production-provider.md:199`). This is the only control that contains Pattern without changing the Worker. Pending work waits durably; `cancelStaleJobs` cancels a pending row only once its owner is no longer current (`codex-provider-maintenance.ts:47-69`). **Persistence caveat:** the unit declares `[Install] WantedBy=multi-user.target` (`apps/codex-runner/systemd/patternlike-codex-runner.service:44-45`), so a stop alone does not survive a reboot if the unit is enabled. **TODO(verify):** the install step tells the operator to enable the service (`docs/deploy/codex-production-provider.md:255-256`), but neither the plan nor the runbooks give a disable command or a `systemctl is-enabled` check — confirm with the operator whether the unit is enabled in production before treating a stop as durable containment. |
| **Pattern — whole-Worker version rollback** | `npx wrangler deployments list --config apps/api/wrangler.toml --env production` to identify the last-known-good version, then `npx wrangler rollback <version-id> --config apps/api/wrangler.toml --env production`. Interactive: it prints the current deployment, prompts for a ≤120-character message, and asks to confirm 100% of traffic (`node_modules/wrangler/wrangler-dist/cli.js:405208-405282`). | D1 — Wrangler's own warning is verbatim: *"Rolling back to a previous deployment will not rollback any of the bound resources (Durable Object, D1, R2, KV, etc)."* `0017` stays applied. It does not undo an ontology activation, a published `pattern_documents` row, a consumed claim, an R2 artifact, or provider spend. It does not stop the runner — pair it with the row above. | **Wider than "Pattern".** The pre-candidate deployment is built from `origin/main`, whose production block declares `crons = ["7,22,37,52 * * * *"]` only — no `*/15` lane at all — plus `READING_V5_ROLLOUT = "first_open"` and `READING_PUBLISHER = "openai"`. So the rollback target has no Daily scheduler, no privacy maintenance, and no Pattern sweep on the 15-minute lane, and it points Daily at the OpenAI transport. `origin/main` also types `CodexProviderPipeline` as `"pattern" \| "ontology"` and loops maintenance over `["pattern", "ontology"]` only, so any `pipeline = 'reading'` rows left in D1 get no nudge repair and no artifact purge; its claim selector is pipeline-agnostic and routes a non-`pattern` job to `ontologyDomainIsCurrent`, whose owner load returns null for a Daily owner id, so such a row is cancelled on claim rather than executed — safe, but its R2 objects are orphaned. **TODO(verify):** whether a version rollback restores the target version's cron trigger list. The CLI warning says the rolled-back version becomes *the active deployment across all your deployed triggers* (`node_modules/wrangler/wrangler-dist/cli.js:405272`), which reads as replacing code under the currently deployed triggers rather than as reverting the trigger list itself. Confirm against current Cloudflare versions/deployments and Cron Triggers guidance before the rollback control is relied on. See also the secret-retirement section: after `OPENAI_API_KEY` is deleted this rollback target refuses every request. |
| **Ontology — recall** | `POST /internal/pattern-ontology-releases/{version}/recall` (`apps/api/src/routes/internal-pattern.ts:294`), behind `configGuard` + `serviceAuth` on the `/internal` mount (`apps/api/src/index.ts:83-85`). The reason class is fixed to `critical_defect` by the route. | Daily — nothing in the Daily path reads the ontology. Not the runner. Not provider spend. Not the `codex_provider_jobs` inventory directly. **Not reversible:** the recall writes an `ontology_recalled` tombstone into `pattern_erasure_replay_events` and re-activating a recalled version is refused (`db/pattern-ontology.ts:462-472`, `721-739`). | **The most destructive control in this table.** `recallOntologyAndWithdraw` (`services/pattern-lifecycle.ts:267-360`) flips the release to `recalled`, then for every `pattern_generation_jobs` row on that version it DELETEs the `pattern_documents` row, cancels the generation and its `jobs` row with `result_class = 'ontology_recalled'`, nulls `payload_enc`, moves an `accepted` claim to `withdrawn`, nulls the wrapped key in `pattern_generation_artifact_keys` with `erased_at`, and deletes the generation's R2 objects. Pattern is account-wide and one release is active, so that is **every reader's published Pattern, erased**. Afterwards `loadActiveOntology` returns null for the recalled row (`db/pattern-ontology.ts:361`); `POST /v1/pattern-generations` and `GET /v1/pattern` answer `409 ontology_unavailable` (`services/pattern-enqueue.ts:140-146`; `routes/pattern-ai.ts:266-267` inside `serveGeneratedPattern`, reached from `routes/pattern.ts:19`), and `GET /v1/pattern-state` answers `200` with `state: "ontology_unavailable"` (`services/pattern-state.ts:299-300` via `emptyState`, returned by `routes/pattern-ai.ts:44-48`) — a client state, not an error status. An operator watching that surface for a 409 after a recall would see a 200 and wrongly conclude the recall had not taken effect. In-flight Pattern provider work stops being current, because `patternDomainIsCurrent` calls `ontologyServesAccount` (`services/codex-provider-domain.ts:171-172`). |
| **D1 — Time Travel bookmark restore** | The bookmark is captured in Task 5 with the plan's verbatim `npx wrangler d1 time-travel info patternlike-ops --config apps/api/wrangler.toml --env production --json`. To restore: `npx wrangler d1 time-travel restore patternlike-ops --config apps/api/wrangler.toml --env production --bookmark "<bookmark>"` — `--bookmark` and `--timestamp` are mutually exclusive (`node_modules/wrangler/wrangler-dist/cli.js:286506-286546`). Task 5 scopes this to a failed `0017` apply or verification, under a separately confirmed restore action. | R2 (`pattern-artifacts`, `pattern-erasure-replay`), Queues, Worker versions, and Worker secrets — none of them move. Restoring D1 alone leaves R2 objects and in-flight Queue messages describing rows that no longer exist. It is the exact mirror of the Worker-rollback warning. | The **entire `patternlike-ops` database, for every feature**, back to one point in time: users, identities, wrapped DEKs, charts, readings, Pattern, consents, and all three ledgers. Everything written after the bookmark is lost, including consents granted and readings published during the canaries. Task 5's instruction stands: if production apply or verification fails, restore, verify the old inventory, and open a new candidate rather than improvising forward. **Do not confuse this with the product feature of the same name** — `TIME_TRAVEL_RECEIPT_EPOCH` and `TIME_TRAVEL_DAILY_SCAN_LIMIT` (`wrangler.toml:391-392`) are the reader-facing Time Travel surface and have nothing to do with D1 Time Travel. |

## Separate: retire the unused OpenAI secret

**State:** NOT RUN

**Evidence required:** the restricted change record must receive — the separate authorization to delete, the reference-audit result below re-run against `CANDIDATE_SHA`, the secret-name inventory before and after (names only, never values), the Worker version and deployment id the deletion creates, its timestamp, and the post-deletion verification results. Treat this as its own change with its own approval; it is not a step of the rollout.

### What still references `OPENAI_API_KEY`

Repo-wide `rg` excluding `node_modules` and `package-lock.json`, sorted by whether it can affect the deployed Worker:

**Deployed Worker source — two files, one live path.**

- `apps/api/src/env.ts:197` — the optional `OPENAI_API_KEY?: string` field on `Env`, with the comment at line 200 that the credential mode is never inferred from its presence. A type declaration, not a read.
- `apps/api/src/services/reading-publisher.ts:213-271` — `resolveProviderCredentialMode` reads it at line 218 and refuses without it at line 230 when `OPENAI_CREDENTIAL_SOURCE=worker`. **Its only non-test caller is `apps/api/src/middleware/config-guard.ts:337`**, inside the `else` branch that is taken only when `ONTOLOGY_PIPELINE_PUBLISHER !== "codex"` (the `codex` branch is lines 316-335 and never resolves a credential).

That is the whole live surface. Production pins `ONTOLOGY_PIPELINE_PUBLISHER = "codex"` (`wrangler.toml:441`, asserted at `wrangler-config.test.ts:94`) with `ONTOLOGY_PIPELINE_ROLLOUT = "off"` (`wrangler.toml:440`, asserted at line 93), so the deployment never reaches that branch at all: `ONTOLOGY_PIPELINE_ROLLOUT = "off"` returns `config: null` outright at `config-guard.ts:254`. The nearest checked-in assertion is `apps/api/src/services/codex-publisher.test.ts:104-113` ("resolves the durable runner without any OpenAI API key"), which proves `config.credential` is `null` under `ONTOLOGY_PIPELINE_ROLLOUT: "internal"` with the Codex publisher (`codex-publisher.test.ts:80-81`) — the stricter case, not the deployed one.

**The ontology regression stage specifically.** This is the historic consumer and it is worth stating precisely, because the dependency is gone by *pin*, not by deletion. `runOntologyPipelineExecution` selects the ontology publisher at `apps/api/src/services/ontology-pipeline-execute.ts:3144-3151`: `resolved.config.publisher === "codex"` yields `createCodexOntologyPublisher(env)`, otherwise `createOpenAiOntologyPublisher(resolved.config.credential!, …)`; the `generating` and `evaluating` stages use it (lines 3159, 3163). The `regressing` stage builds a *second*, separate publisher on the same test — `createCodexPatternPublisher(env)` when the resolved publisher is `codex`, otherwise `createOpenAiPatternPublisher(resolved.config.credential!, …)` (lines 3164-3178). Two objects, one pin: both branches are gated on `resolved.config.publisher === "codex"`, which is why the Codex pin removes the key from both. `apps/api/src/services/codex-ontology-publisher.ts` contains no `OPENAI_API_KEY` or `apiKey` reference at all, and the regression lane reuses the Pattern passes through the runner (`ONTOLOGY_REGRESSION_PATTERN_PIN`, imported at `services/codex-provider-domain.ts:18` and checked at `213-224`).

**The dependency returns only when both deployed pins move.** `resolveOntologyPipelineConfiguration` returns `{ok: true, rollout, config: null}` at `config-guard.ts:254` whenever `ONTOLOGY_PIPELINE_ROLLOUT` is `off`, before the publisher/credential branch at `config-guard.ts:316-340` is reached at all. Setting `ONTOLOGY_PIPELINE_PUBLISHER` to `openai` — or removing it, since the default when the var is absent is `"openai"` (`config-guard.ts:131`) — is therefore not by itself enough to re-require the key; the rollout must also leave `off` for `internal`. In that state a missing key is `503 configuration_error` with code `ontology_pipeline_misconfigured` (`config-guard.ts:74-76`, `539-548`) on **every** request, because `checkSecureConfig` calls `resolveOntologyPipelineConfiguration` on every product request, in `queue()`, and in `scheduled()` (`config-guard.ts:466-469`; `scheduled.ts:23-28`; `queue.ts:165`) — not a degraded pipeline.

**Reader paths do not read it, and the code says so.** `resolvePublisherConfiguration` for Daily has no `credential` field at all (`reading-publisher.ts:326`, asserted at `services/reading-publisher.test.ts:116`, in a test whose title is "accepts a complete hybrid Codex deployment with no OpenAI credential"). `resolvePatternPublisherConfiguration` likewise carries no credential (`services/pattern-publisher.ts:163-165`). `wrangler-config.test.ts:82-88` records the same conclusion for the deployed vars.

**The runner never sees it.** `buildCodexChildEnvironment` passes only `HOME`, `PATH`, `CODEX_HOME`, `HTTPS_PROXY`, and `SSL_CERT_FILE` to the Codex child process; `apps/codex-runner/src/codex-cli.test.ts:30-50` asserts `OPENAI_API_KEY` is dropped along with `CODEX_RUNNER_TOKEN`, `SERVICE_AUTH_TOKEN`, `PATTERN_ADMIN_TOKEN`, and `NODE_OPTIONS`.

**Operator script, not a Worker read.** `apps/api/scripts/verify-openai-pattern-model.ts` (script `publisher:pattern:model:verify`, `apps/api/package.json:13-14`) reads `process.env.OPENAI_API_KEY` on the operator's machine (line 296-299) and calls `https://api.openai.com` directly. It never reads the Worker secret, so deleting the secret does not change it — and Task 1 already requires the runbooks stop claiming an API-key model probe applies to this ChatGPT-authenticated Codex path.

**Tests and docs only.** `apps/api/test/hermetic-bindings.ts:43` and `apps/api/test/helpers.ts:1135-1139` deliberately blank it; several suites set fake values. The remaining hits are `docs/` narrative and archived plans.

**Deployed inventory.** `docs/deploy/openai-pattern-rollout.md:122-126` records `OPENAI_API_KEY` among nine production secrets observed 2026-08-27, values never read.

**Verdict to record:** under the deployed pins, no reader feature and no live Worker path reads `OPENAI_API_KEY`. The single code path that would is the ontology pipeline's OpenAI transport, and neither deployed pin selects it: `ONTOLOGY_PIPELINE_ROLLOUT = "off"` returns before any credential is resolved (`config-guard.ts:254`), and `ONTOLOGY_PIPELINE_PUBLISHER = "codex"` would still not select it if the rollout moved. **One consequence must be recorded before deleting:** `origin/main` — the pre-candidate rollback target — declares production `READING_V5_ROLLOUT = "first_open"` with `OPENAI_CREDENTIAL_SOURCE = "worker"`, so its `resolvePublisherConfiguration` calls `resolveProviderCredentialMode`, which refuses without the key; `checkSecureConfig` runs that *before* the development short-circuit, so **that rollback target would answer `503 configuration_error` on every request once the secret is gone.** Deleting the secret narrows the Worker-rollback control in the table above to versions that do not require it. **TODO(verify):** whether rolling back to a Worker version created before the deletion restores that version's secret binding. Wrangler's rollback warning names only Durable Object, D1, R2, and KV (`node_modules/wrangler/wrangler-dist/cli.js:405274`) and says nothing about secrets. What this worktree does show is that the rollback is not silent about it: the API refuses a rollback across a changed secret with code `10220`, and Wrangler catches that code, lists the changed secret names, and requires a second confirmation before retrying (`node_modules/wrangler/wrangler-dist/cli.js:405297-405316`). Confirm the binding behaviour against current Cloudflare versions/deployments guidance before relying on it; either way the recovery is `npx wrangler secret put OPENAI_API_KEY`.

### Deletion

Only if the audit above is re-run against `CANDIDATE_SHA` and still finds it unused, and only with separate authorization. Delete interactively so the value never enters shell history:

```
npx wrangler secret delete OPENAI_API_KEY --config apps/api/wrangler.toml --env production
```

This creates a new Worker version and deploys immediately. That version's source is **not** `CANDIDATE_SHA`; record it as a separate deployment, which is the whole reason this is its own change.

### Post-deletion verification

Run all of it, and record only names, ids, statuses, and counts:

1. **Secret-name inventory** — confirm eight names remain and `OPENAI_API_KEY` is gone. `wrangler secret list` is a registered command in the pinned Wrangler `4.116.0` (`node_modules/wrangler/wrangler-dist/cli.js:411199`); the flag pair follows the plan's global constraint and matches the `secret put` form in `docs/deploy/codex-production-provider.md:137`:
   ```
   npx wrangler secret list --config apps/api/wrangler.toml --env production
   ```
2. **Resulting version and deployment** — record build/upload/version/deployment ids and traffic percentage:
   ```
   npx wrangler deployments list --config apps/api/wrangler.toml --env production
   ```
3. **Public health**:
   ```
   curl --fail --silent --show-error https://patternlike-api-production.lfd.workers.dev/health
   ```
4. **No configuration refusal.** Any `503 configuration_error` — in particular `ontology_pipeline_misconfigured` or `reading_publisher_misconfigured` — means a pin was not what this audit assumed. Roll the separate deployment back and re-put the secret.
5. **Runner claim path** — `POST /codex-provider/v1/jobs/claim` (`apps/api/src/routes/codex-provider.ts:266`) still answers `204` on an empty queue and the runner keeps claiming with no auth or model failures; unauthenticated it discloses no job state.
6. **Daily read** — `GET /v1/readings/today` on a consented canary account still returns its published reading (`apps/api/src/routes/readings.ts:466`), and `PUT /v1/readings/today` still reserves (line 270).
7. **Pattern read** — `GET /v1/pattern-state` (`routes/pattern-ai.ts:44`) and `GET /v1/pattern` on a canary account still return the published Pattern — `pattern-state` a `200` whose `state` is not `ontology_unavailable`.
8. **Local config gates**, from the clean checkout, to prove the deployment shape resolves without the key: `apps/api/scripts/wrangler-config.test.ts`, `apps/api/src/services/reading-publisher.test.ts`, `apps/api/src/services/codex-publisher.test.ts`.

If any non-reader feature still depends on the secret, roll back that separate deployment and restore it with:

```
npx wrangler secret put OPENAI_API_KEY --config apps/api/wrangler.toml --env production
```

### Final constraint

**Do not make a post-rollout documentation commit on `main`.** It triggers another Cloudflare Workers Build and severs the one-SHA evidence chain that migration, source, local gate, build, deployment, provider, and canary evidence all resolve to. Close the restricted change record and the PR comments against `CANDIDATE_SHA` instead, and record current observed deployment state there rather than creating a second source SHA to hold it.
