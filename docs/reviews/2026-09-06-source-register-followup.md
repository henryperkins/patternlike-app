# Source-register validation and approved follow-up

The supplied register is useful historical evidence at `eccddcc`. It cannot be
used as a current production attestation. The refreshed register is bound to
`cefc97981981dfde7a36ce050e7fb33367c830be`, current read-only operational
observations, and the explicitly uncommitted follow-up tools below.

[Open the refreshed HTML register](./artifacts/2026-09-06-source-register-followup/source-register-current.html).
The [original HTML](./artifacts/2026-09-06-source-register-followup/original-source-register.html)
is preserved byte for byte: SHA-256
`6421c23973e47827573f11955f6103d71b21f3a842f49fdeafa3696063ef7f9d`.
All 22 referenced Git file objects exist; 11 have unchanged bytes and 11 differ
from the current source. See the [file-by-file check](./artifacts/2026-09-06-source-register-followup/git-source-validation.json).

## Work completed

- Added a bounded fresh Pattern evaluation harness using the actual planner,
  writer and verifier request builders, schemas, validators, and publication
  safety check. Two fictional packets permit at most six provider calls, one
  attempt per stage, with no repair/retry loop. New outputs feed subsequent
  stages. A failed stage stops that chain. Private samples, output hashes,
  source snapshots, cancellation and a source-change stop preserve the evidence.
- Ran six new Daily generations, five new Pattern stage calls, and nine new
  verifier calls using the installed CLI and service account's existing login
  in a separate private source copy. All 20 calls returned output without a
  transport failure. No real reader or durable Worker job was exercised.
- Added an HTTPS operational canary for public configuration/auth boundaries,
  consented place search, a specified recent published Daily, and account-wide
  Geoapify credit thresholds. Missing authenticated checks or account usage
  remain incomplete. It does not generate content or change consent. Usage
  collection, scheduling and notification delivery are not configured.
- Prepared a complete 60-fragment human review packet and an account-owner
  evidence form. Both leave human judgments and attestations incomplete.
- Built a standalone candidate runner and verified both entrypoint imports and
  native Sharp operation on Node 22.23.2 and the installed Node 24.19.0. The
  candidate is in `/tmp/patternlike-source-register-runner-candidate-20260906`.

The implementation is isolated in `.worktrees/source-register-followup` on
`codex/source-register-followup`. No commit, push, migration, Worker deployment,
service replacement, production account mutation, or external notification was
performed. The main checkout's unrelated `.impeccable/` remains untouched.

## Findings that remain open

| Priority | Finding and exact evidence | Next action and acceptance condition |
| --- | --- | --- |
| P1 | Installed runner bundle `3a0139ae4268…` still uses `codex exec` for ordinary text. The current candidate `edb25e3ce62a…` uses isolated app-server JSON. CLI 0.153.3 and ChatGPT login are verified; they do not establish installation of the new transport. | Activate the separately reviewed candidate through the existing runner rollout procedure, preserving rollback. Verify the installed hash, new service process, compatible CLI/dependencies, polling and a dedicated account's durable publication. |
| P1 | The authored exact-time verifier control was rejected again. The verifier questions treating birth-time accuracy as a personal tendency and a synthesis dependency absent from the calculated facts. The harness counts this as a false rejection against its authored expectation; that expectation remains disputed. | Have the designated independent reviewer adjudicate the exact input, source dependencies and expected verdict. Version a justified fixture correction or verifier change; retain both original failed runs. Do not change the expected result merely to make the score pass. |
| P2 | Daily accepted 5/6 new outputs. The approximate-time sample cited an unknown fact ID and was correctly rejected by `known_references.unknown_fact_reference`. Three accepted samples carry the diagnostic `context_supplied_but_unused`; that heuristic alone is not an editorial failure. | Keep citation membership enforcement. Inspect how the prompt/correction path constrains reference IDs, then rerun the fixed six-profile panel after any correction. Have the editor assess whether unused context was relevant. |
| P2 | The new exact-time Pattern writer exceeded the 550-word chapter maximum: the runtime validator measured 596 and 572 words in two chapters. | Preserve the word limit. Check budget communication and the existing bounded writer correction path. Exercise that path with retained output; then obtain fresh samples under the resulting frozen policy. This first-attempt harness does not measure production recovery after corrections. |
| P2 | The unknown-time Pattern's model verifier passed, but deterministic publication safety rejected a negated guarantee. A separate minimal reproduction flags “No particular outcome is guaranteed.” The affirmative and compound harmful controls still reject. | Add a narrow negation regression at `pattern-publication-safety.ts` before changing its grammar. Require both the benign denial and affirmative/compound controls to behave correctly; version the safety policy/source fingerprint and rerun publication-safety and aggregate gates. No validator was relaxed in this follow-up. |
| External evidence | Corpus review remains 0/60 signed passing fragments; the actual provider account category, training/sharing controls and retention basis remain unverified. | Obtain named human reviews and the actual account owner's dated evidence. Current CLI authentication cannot fill historical corpus provenance or current account settings. |
| Operational input | No dedicated test account, Geoapify allowance/usage source, or alert destination has been supplied. | Supply those inputs, then run the lifecycle and monitoring procedures below. Public health checks cannot close these items. |

See the [runner observation](./artifacts/2026-09-06-source-register-followup/runner-observation.json),
[standalone candidate manifest](./artifacts/2026-09-06-source-register-followup/standalone-runner-candidate.json),
and [minimal negation diagnostic](./artifacts/2026-09-06-source-register-followup/negation-diagnostic.json).

## New model evidence

| Run, UTC | Fresh calls | Observed result | Boundary |
| --- | --- | --- | --- |
| `daily-04`, 18:20–18:24 | 6 Daily outputs | 5 accepted, 1 rejected, 0 transport failures; `passed: false` | Prompt 1.0.3, selection 1.1.0, validation 1.1.1. |
| `pattern-generation-01`, 18:25–18:32 | 2 planners, 2 writers, 1 verifier | 0/2 accepted chains; word-limit rejection and publication-safety rejection; `passed: false` | New stage outputs, fixed fictional packets/reference ontology, one attempt per stage. Neither chain is a successful durable production Pattern. |
| `verifier-02`, 18:34–18:38 | 9 verifier outputs | All 7 negative cases rejected; 1 positive accepted, 1 positive rejected; `passed: false` | Writer inputs are authored controls/mutations, not fresh writer outputs. Positive-control adjudication remains open. |

All runs used Sol/xhigh and text isolation 1.0.0 with CLI 0.153.3. Pattern pins
were planner 1.0.1, writer 1.0.3 and verifier 1.0.0-verifier. Token settings in
request metadata are configuration values, not evidence of an upstream hard
output limit. Source hashes remained unchanged during each run.

The first Pattern generation run preceded two harness-reporting fixes: filtering
unexpected verifier codes out of metadata and retaining malformed completions
privately. Its actual finding codes are approved codes, and its transports were
valid; the exported report is unchanged. Its snapshot binds the earlier harness,
not the later fixed harness. The fixes were reproduced with failing tests and
verified separately, not applied retroactively to the provider run.

The three different source snapshot hashes identify successive private source
copies containing the evaluation tooling available at each run. Their application
source is based on `cefc979`; these are not three production releases. Raw
fictional prompts and outputs remain in the private service-owned evaluation
directory. The [export manifest](./artifacts/2026-09-06-source-register-followup/evaluation-export.json)
lists only metadata reports and source hashes. No failed sample was omitted,
regenerated until accepted, or relabelled as a successful live reading.

Reports: [Daily](./artifacts/2026-09-06-source-register-followup/daily-04/report.json),
[Pattern generation](./artifacts/2026-09-06-source-register-followup/pattern-generation-01/report.json),
[verifier](./artifacts/2026-09-06-source-register-followup/verifier-02/report.json).

## Direct production observations

Cloudflare currently serves Worker version
`52a5c8df-3b67-499b-951e-0586a604c89f` at 100% through deployment
`a845f8e2-5b0f-4a30-a469-d8d50e873f3e`. Build
`52b8e50c-dd06-4589-9269-2318ab832e88` succeeded from `cefc979` on `main`.
The deployment began September 6 at 17:24 UTC. This was observed, not deployed
by this follow-up.

Current Worker settings have Daily hybrid/Codex, Pattern Codex, Sol/xhigh,
Daily/writer prompt 1.0.3, both portrait flags enabled, Geoapify enabled and the
ontology pipeline off. Migrations 0025–0028 are recorded as applied. The active
ontology pointer is `pattern-ontology-en-us-internal-0.1.0`, with no matching
machine-pipeline evidence run. Source inspection still distinguishes its release
assurance from the shared per-document publication checks.

The read-only D1 observation found two enabled portrait grants, one ready
portrait and four complete mesh jobs. Those completions predate the current
Worker deployment. It found no provider jobs created since that deployment,
no pending/leased provider jobs, and no unfinished Pattern generation jobs at
the checkpoint. These aggregate rows do not establish current-prompt execution,
saved-asset reuse, withdrawal, deletion, cleanup, or rejection of a late upload.

The [production receipt](./artifacts/2026-09-06-source-register-followup/production-observation.json)
contains timestamps, selected nonsecret configuration, exact read-only queries,
results and zero rows written. The [public canary](./artifacts/2026-09-06-source-register-followup/public-canary.json)
observes HTTP 200 for health/configuration and 401 for an unauthenticated protected
reading route. Its overall result is `incomplete` because authenticated and
account-wide credit inputs are absent.

## Verification

The final tools passed their focused regressions: six fresh-chain tests and
seven operational-canary tests. Independent code review found and closed the
report privacy/retention defects and canary evidence defects; it is not human
editorial certification. No remaining material code-review finding was reported.

The September 6 aggregate attempts did not produce a completed receipt. Their
[original final placeholder](./artifacts/2026-09-06-source-register-followup/local-release-evidence.json)
and [interrupted placeholder](./artifacts/2026-09-06-source-register-followup/interrupted-local-release-evidence.json)
are retained as zero-byte files; neither is passing evidence. The earlier report
of an exit-143 interruption is historical context, not a completed gate.

On September 7, merge review closed a provenance-classification gap: an explicit
executable or environment override now produces `unverified_process`, while an
injected callback remains `test_double`. Validated custom-process output cannot
set provider-evidence flags or a passing evaluation result. The new offline
regression exercised complete valid fake-process chains; the seven fresh-chain
tests passed. The earlier seven canary regressions remain covered by the full gate.
The original evaluation reports above are preserved unchanged as dated observations.

The [completed September 7 aggregate receipt](./artifacts/2026-09-07-source-register-merge/local-release-evidence-final.json)
records exit 0, all 14 lanes passing, and unchanged source before and after the run.
Its [paste-ready CI summary](./artifacts/2026-09-07-source-register-merge/ci-local-summary.txt)
is recorded only after process completion. A
[September 7 attempt stopped for the provenance fix](./artifacts/2026-09-07-source-register-merge/local-release-evidence.json)
remains explicitly nonpassing. These receipts are local source/build evidence;
production deployment and editorial quality remain separate, unverified claims.

## Remaining execution

The [operator handoff](./artifacts/2026-09-06-source-register-followup/operator-handoff.md)
provides the activation, dedicated-account lifecycle and monitoring sequence,
including exact completion evidence. The [complete human packet](./artifacts/2026-09-06-source-register-followup/human-review-packet/packet.md)
and [blank signed-review input](./artifacts/2026-09-06-source-register-followup/human-review-packet/review-draft.json)
are ready for the designated reviewer. The
[account-owner form](./artifacts/2026-09-06-source-register-followup/account-owner-evidence-draft.json)
is ready for dated account-specific evidence.
