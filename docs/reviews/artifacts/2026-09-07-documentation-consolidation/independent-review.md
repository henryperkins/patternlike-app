# Task 5 independent documentation spec and quality review

Reviewed 2026-09-07 at initial candidate
`787b8f1767a73a9ea020846ff5409b43bee9c3e6` over base
`29af8d2bef354a6b3c6a3ac15ee360cf34227ea5`; scoped fix re-reviewed at
`727acaa37b958d48ce90257738b58cb69a6bdd5d`.

## Verdict

- Spec compliance: **PASS after one Important documentation correction**.
- Documentation quality: **PASS after one Important documentation correction**.
- Critical findings: none.
- Important findings: none open; one resolved in the scoped fix.

## Resolved Important finding

### I1. The reconciled command guide still describes the old workspace and gate inventory

- Files/lines: `CLAUDE.md:14-16`; source authority `package.json:11-16`.
- The candidate correctly updates the architecture section to eight workspaces,
  but its adjacent command annotations still say `npm test` covers only
  `shared + calc-stub + ontology-signer + api + web, then test:contracts` and
  summarize `npm run build` as only `shared/calc/signer`, Vite, and the API
  dry-run.
- The actual root scripts run shared, reading-engine, pattern-engine, calc-stub,
  codex-runner, ontology-signer, API, and web. `npm test` then also runs
  `test:content` before `test:contracts`; `npm run build` explicitly builds all
  eight workspaces, with the web build before the API production dry-run.
- Impact: the primary contributor guide now contradicts its own corrected
  eight-workspace overview and under-reports three workspace lanes plus the
  content gate. That defeats Task 5's source-backed current workspace guidance
  and can produce an incomplete review or handoff account even though the root
  commands themselves execute the omitted work.
- Resolution at `727acaa37b958d48ce90257738b58cb69a6bdd5d`:
  `CLAUDE.md:14-16` now describes `npm test` as all eight workspaces followed by
  `test:content` and `test:contracts`, and describes `npm run build` as all eight
  workspaces in order with web assets before the API production dry-run. These
  two annotations match `package.json:11-16` exactly enough for durable command
  guidance.
- Scoped fix boundary: the commit changes only those two `CLAUDE.md` comment
  lines relative to `787b8f1`; no runtime, configuration, script, or other
  documentation content changed.

## Confirmed compliance

- The candidate changes exactly the nine authorized documentation/comment-only
  paths. The worktree was clean at the reviewed commit. The TypeScript and TOML
  changes alter comments only; no runtime statement or configuration value
  changed. `.env.example` removes only stale consent scaffolding and corrects
  comments.
- Node and repository topology now match `.nvmrc`, the root `>=22` engine, and
  the five app plus three package workspace inventory. Setup uses the ordered D1
  migration command without an evergreen numeric ceiling.
- The local seed account is described accurately: it creates `users` and
  `user_keys` with a crypto subject and wrapped DEK, and creates neither an
  `identities` row nor an account-processing grant.
- The README grant-first example matches the current policy, required
  idempotency and UI-surface headers, returned `consent_id`, and the birth
  route's exact-current-grant check. Withdrawal/freeze/regrant and the separate
  generative-permission boundary match current middleware, handlers, and policy.
- The exact `127.0.0.1:5173` development origin and Auth0 registration guidance
  match the web configuration and retained canary authority. `VITE_CONSENT_ID`
  is gone from current setup/environment guidance; remaining occurrences are
  historical specifications/plans describing its removal.
- Geoapify wording distinguishes committed production enablement from credential
  and live-provider evidence. Search, resolve, and new consent grants fail with
  `geocoder_unavailable` when unavailable, while consent reads/withdrawal and
  unrelated routes remain available; manual place data remains the fallback.
- Both configured cron lanes and their Daily, Pattern, Codex, ontology,
  portrait, privacy, recovery, failure, and retention responsibilities match
  `wrangler.toml`, `scheduled.ts`, and the focused service implementations. The
  manual reading sweep and one-job Pattern reconcile are described as bounded
  service-authenticated controls rather than the scheduled implementation.
- Release guidance correctly treats Workers Builds as the automatic API/PWA
  path, rejects bare deploy commands that omit `RELEASE_GIT_SHA`, and refers
  manual release to the clean, gated, explicit-SHA procedure. It preserves all
  six `run_worker_first` route families and the retired Fly PWA distinction.
  Source support, migration application, deployed version, installed runner,
  provider execution, and reader lifecycle remain separate evidence layers;
  no Task 5 documentation claims migration 0029 or the release-attestation
  runtime is deployed.
- The dated snapshot notice is six lines and the historical review body after
  it is byte-identical to the base document (matching SHA-256
  `79c8785658d0e2fe239389160fb4ae711c84564868b87935b393599edda2a73a`).
  Current model, prompt, source, provenance, privacy, and bounded-assurance
  wording remains intact.

## Review actions and limits

- Read the implementation brief, port analysis, implementation report, supplied
  frozen diff, all nine changed files, and the focused current source authorities
  for setup, consent, geocoding, scheduling/recovery, release attestation,
  routing, receipts, migrations, and Fly topology.
- Inspected commit identity, changed-path scope, clean status, comment-only
  boundaries, historical-body equality, current-workspace inventory, and
  `git diff --check`; no whitespace error was reported.
- Per the latest user restriction, no test, CI lane, build, runtime command,
  external call, modification to candidate source, subagent, commit, push,
  merge, or deployment was performed. This is a source/documentation review,
  not live adoption evidence. The missing aggregate gate is not a finding in
  this review.
- The fix re-review was limited to the two-line
  `787b8f1767a73a9ea020846ff5409b43bee9c3e6..727acaa37b958d48ce90257738b58cb69a6bdd5d`
  diff, its `package.json` authority, and the implementer's appended fix record.
  No fresh broad review or executable verification was performed.
