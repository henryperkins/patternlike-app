# Patternlike review claims: follow-up implementation and evidence

Date: September 6, 2026. Worktree: `codex/claim-publication-assurance`, based on
`50f452a66fb1cc6c7f88f95b297b3bc7b0b1e01b`. This report records implementation
and verification before the authorized commit and push; it does not attest a
production deployment. This continues the
[first claim/publication assurance pass](./2026-09-06-reading-assurance.md).
The original checkout and unrelated release-truth worktree were preserved.

The approved follow-up addresses the promises the existing product makes:
calculation versus generated meaning, consent and retention, local provider
isolation, fresh evaluation, corpus review, release evidence, containment, and
image-model provenance. Chat, social features, native clients, atlas parity, and
user-visible version archives remain product choices outside this change.

## Claim disposition

| Review concern | Implemented result | Evidence still required |
| --- | --- | --- |
| “Calculated, not invented” can imply calculated psychological meaning. | Signed-out copy explicitly applies calculation to chart positions; it identifies interpretations as generated language that can be mistaken. The Pattern progress label is “Checking the draft.” Product documentation no longer claims every sentence is entailed. | Independent interpretation validity is not established by calculation, publication checks, or this wording. |
| Consent understates provider requests and retention. | Daily discloses retries; Pattern discloses separate planning, writing and checking requests. Terms distinguish application purpose and encrypted-copy cleanup from upstream policy. Pattern copies become eligible 30 days after each terminal provider job, subject to current-owner, upload and retry checks. Existing consent version and grants remain valid; no new processing purpose was added. | Actual provider account agreement, data-use settings, training controls and retention remain unverified. |
| Ordinary text jobs inherit host context more broadly than portraits. | Daily, Pattern and ontology text now use isolated app-server JSON turns: pinned CLI, verified ChatGPT login, empty execution environments, disabled tools/MCP/skills, explicit instructions, fresh ephemeral threads, bounded output, matched usage, abort/timeout and fatal failed cleanup. | The new source transport was exercised with fictional provider inputs; it has not been installed as the production service in this work. Local isolation is not upstream deletion or non-training. |
| Frozen synthetic revalidation is not fresh model evaluation. | New Daily and Pattern verifier harnesses build real application requests, run the actual isolated Codex transport, retain failures and output hashes, and bind imported code to source snapshots. Offline test doubles cannot become provider evidence. Fresh observations are below. | Small authored samples do not measure production quality or replace an independent review of the expectations and outputs. |
| The supplied interpretation corpus lacks independent provenance and completed editorial review. | The honest 60-fragment, model-generated label and unknown historical fields remain. New tooling prepares complete hash-bound review packets, blank reviews, and append-only records. Enrolled named reviewers use Ed25519 signatures tied to exact content and criterion judgments. | No reviewer was enrolled, impersonated, or certified here. All 60 human certifications and the missing historical provider/account/model/date evidence remain open. An authenticated declaration is not independent proof of a human identity or review quality. |
| Tested source and deployment records lack one reconciled chain. | The local gate receipt binds source/build/policy/migration files. New offline reconciliation binds a valid receipt to separately supplied Worker, asset, runner, migration, execution-tuple and authorized lifecycle records, rejecting missing or contradictory evidence. | The strongest reconciliation status is `consistent_recorded_chain`; it never claims independently observed deployment. Actual production records and test-account lifecycle observations are still needed. |
| Pattern lacks a dedicated stop-new-work control. | `PATTERN_GENERATION_ENABLED=0` pauses admission, claims, execution, nudges and publication. It preserves accepted reading access and deletion, parks eligible jobs, retains valid leased completions, and resumes through current-source checks without automatically repeating completed calls. | A deployed pause is version-bound; old Worker invocations and existing runner leases require observation. No production pause/resume occurred here. |
| A configured image-model label is presented as provider identity. | Versioned image provenance separates configured intent from observed identity. New results record CLI `0.153.3` and `observed_image_model:null` / `not_exposed`; legacy material projects `legacy_unrecorded` without invented observations. Storage, replay, reads and downloads preserve this distinction. | The native image tool does not expose the underlying image model in the inspected path. The configured label is not forwarded as a native model-selection argument. |

A complete [60-fragment review packet](./artifacts/2026-09-06-review-claims-followup/corpus-review/packet.md)
and [blank review draft](./artifacts/2026-09-06-review-claims-followup/corpus-review/review-draft.json)
are prepared for an enrolled independent reviewer. The
[status record](./artifacts/2026-09-06-review-claims-followup/corpus-review-status.json)
retains zero accepted human certifications.

Implementation procedures:
[consent](../deploy/consent-disclosures.md),
[provider boundaries](../deploy/codex-provider-privacy-evidence.md),
[Daily evaluation](../deploy/fresh-reading-evaluation.md),
[verifier evaluation](../deploy/fresh-pattern-verifier-evaluation.md),
[corpus review](../../pattern-corpus/README.md),
[release reconciliation](../deploy/repository-release-evidence.md),
[Pattern pause](../deploy/pattern-generation-pause.md), and
[image provenance](../deploy/portrait-image-model-provenance.md).

## Fresh provider observations

These runs use fixed fictional inputs, not production reader content. A private
source copy runs as the existing `patternlike-codex` service user with the
installed CLI `0.153.3`; no credentials were copied. Ordinary text isolation
preflight verifies the ChatGPT route on each attempt. The execution host uses
Node `24.19.0`; the repository gate uses its pinned Node `22.23.2`. These are
separate toolchain observations, not a claim of identical host environments.

Daily generates new output from six fictional profile shapes. The Pattern
experiment generates nine fresh verifier verdicts against frozen authored
candidate chains and explicit adversarial mutations. It does not generate fresh
planner/writer output or complete end-to-end Patterns. Synthetic fact packets
are fixtures, not new calculation-service observations.

| Run | Actual result | Interpretation |
| --- | --- | --- |
| [Daily 01](./artifacts/2026-09-06-review-claims-followup/daily-01/report.json) | 6 responses, 4 accepted, 2 rejected, no transport failures. | Found false rejections for a comma before a fully supported orb clause and a bounded uncertainty disclosure naming suppressed Moon data. |
| [Daily 02](./artifacts/2026-09-06-review-claims-followup/daily-02/report.json) | 6 responses, 5 accepted, 1 rejected, no transport failures. | The remaining rejection was the supported “In today's shared sky” lunar-phase prefix. |
| [Daily 03](./artifacts/2026-09-06-review-claims-followup/daily-03/report.json) | 6 responses, 5 accepted, 1 rejected, no transport failures. | The remaining rejection was the supported concise cycle phase “building today.” |
| [Pattern verifier 01](./artifacts/2026-09-06-review-claims-followup/verifier-01/report.json) | 9 valid verdicts: all 7 adversarial candidates rejected with located findings; one positive control accepted and one rejected. No false accepts, malformed outputs, or transport failures in these nine cases. | Harness result is `passed:false`, because it expected both controls to pass. This is not a universal safety or accuracy rate. |

The [final deterministic replay](./artifacts/2026-09-06-review-claims-followup/fresh-daily-replay-03.json)
accepts all **18 retained fresh Daily outputs**. Every current invocation hash
matches the original request. This replay invoked no provider; it is not a
fourth fresh sample run. Its first attempt accepted 17/18 and exposed a UTC
clock followed by “today” in a previously rejected sample. Both replay reports
are retained, including that failure. The final grammar adds that bounded form
while preserving UTC clock/date/event and local-day checks.

The verifier challenges cover swapped facts, overridden uncertainty, absolute
psychological labeling, coercive relationship instruction, an indirect clinical
diagnosis, an embedded instruction attempting to force a pass, and a derived
synthesis exceeding its dependencies. The deterministic publication gate
separately caught the uncertainty challenge; its catch does not excuse a
verifier error. The seven fresh negative verdicts were all diagnostic under the
harness's declared scoring rules.

The rejected exact-time control deserves a narrower interpretation than the
metric name `false_reject`. Its verdict said the placeholder prose omitted the
planned Sun–Moon square theme and cited lunar/derived material, and that an
uncertainty note recast birth accuracy as a calculated tendency. Those are
plausible objections to a structurally accepted fixture. The count measures
disagreement with an authored expected outcome; it does not independently prove
the verifier was wrong. We retained the failed score and response, without
weakening the verifier or relabeling the fixture to manufacture a passing run.
Independent review of that control and the model's reasoning remains open.

The Daily fixes are narrow grammar and source-binding changes in validation
policy `1.1.1`, with prompt `1.0.3` and selection policy `1.1.0`. They allow an
optional comma before a correctly bound orb, Oxford-comma uncertainty lists,
omission notes supported by the suppression record even with no selected Moon
fact, an explicit collective-sky prefix only for collective facts, and concise
cycle-phase/UTC-clock forms supported by the same referenced record. Wrong
orbs, swapped subjects, false accuracy, unsupported factual tails and natal
claims laundered through a collective prefix remain regression failures. The
frozen historical candidate prose was not regenerated or silently replaced.

A separate review found the Daily harness originally captured source only after
application imports. It now captures before imports, refuses invocation after a
loaded-source mismatch, and saves both comparisons. Daily 01 predates that guard
and carries only its before/after run comparison; the limitation is preserved.
Source-snapshot regressions run sequentially in the content lane so their brief
marker files cannot contaminate another test's snapshot.

The [source comparison](./artifacts/2026-09-06-review-claims-followup/evaluation-source-comparison.json)
identifies every file changed between the fresh verifier run and final Daily
replay; the verifier prompt/input and isolated transport were unchanged. A
setup-only attempt initially inherited a working directory inaccessible to the
service user and failed in esbuild with `EACCES` before creating a run or making
a provider request. Running from the accessible private scratch context fixed
that host invocation; no home permissions or service configuration were changed.

Raw fictional prompts and outputs remain in private operator scratch files.
The linked reports retain dates, source hashes, invocation/output hashes,
bounded findings and observed usage. They do not contain reader data or raw
provider output. No account category, non-training setting or contractual
retention guarantee is inferred from a successful response.

## Verification and source identity

The user instructed us to stop the aggregate gate and focus on the actual
problem areas. This implementation has **focused verification, not a completed
passing full gate**. [The focused verification record](./artifacts/2026-09-06-review-claims-followup/focused-verification.json)
binds the 1,237-file implementation snapshot to
`e51870f0be4df2529a5f8b1a979d0e5009fa7ab86429e2cbae31503d3f6ffdb6`.
That hash exactly matches the final 18-output replay source. The only change
in that snapshot since the completed Gate 03 run is the corrected version
assertion in `generate-daily-reading-v5.test.ts`.

The [pre-commit verification](./artifacts/2026-09-06-review-claims-followup/commit-verification.json)
records another 73 claim-support and 121 Daily API tests passing, followed by
26 isolated-runner and 3 source-fingerprint tests. Its
[source snapshot](./artifacts/2026-09-06-review-claims-followup/commit-source-snapshot.json)
is `3c25c5f5f276f322538392c99954d84122f8a812e6ebb64bd66088d80a2d8d37`.
Three files differ from the implementation snapshot above: `CLAUDE.md`
corrects the validation version and stale no-kill-switch statement;
`codex-environment.ts` loses an extra blank line at EOF; and the generated
Pattern-creation fingerprint is updated to match those bytes. No execution
logic or test changed. The runner and fingerprint checks followed this
normalization; the Daily checks preceded it. The full gate was not rerun.

Gate 03 ran all 14 lanes: 13 passed, and the API lane reported 2,481 passing
tests plus that one stale assertion. After correction, all 121 focused Daily
API tests passed, as did the API's source/model/corpus/release/configuration
helper checks. All 73 claim-support regressions pass. Gate 03 also passed all
137 runner tests, 582 web tests, 65 content/tooling tests, and the build. These
results support the actual changed areas without being relabeled as a clean
aggregate run. Gate 04 was stopped at the user's direction; its incomplete
receipt is retained. Gates 01 and 02 were earlier intentional interruptions
while fresh-output replay was finding supported wording to add.

A [blank reconciliation record](./artifacts/2026-09-06-review-claims-followup/reconciliation-blank.json)
is available. A gate-bound final release reconciliation was not claimed or
fabricated: its full-gate prerequisite and external observations are absent.

The final source fingerprint is
`sha256:b1c8ff83924dfc7010c86fcfba37e2bb0f2eb09c0022dd5ee5169dfbc3fdce39`,
covering 30 explicit Pattern-creation sources, including the shared isolated
transport and generation pause control.

Relevant earlier focused verification also included:

- 370 pause/queue/provider/configuration tests, covering admission through final
  publication, retained completion adoption, cleanup and stale ownership.
- 27 runner/shared image-provenance tests, 49 API portrait route cases and 30
  portrait schema fixtures, with relevant typechecks.
- 50 isolated text/mesh transport tests and 73 Daily candidate-validation tests.
- All 582 web tests, plus all 65 content/review/evaluation/release-tool tests.
- Combined release evidence/reconciliation regressions: 16 passing tests,
  including 25 contradictory-record mutations in reconciliation.

Gate 03 completed all lanes but failed one API assertion: it expected the
old `1.1.0` validation version while the actual publication evidence correctly
recorded `1.1.1`. The other 2,481 API tests and all 13 other lanes passed. The
assertion was corrected and verified in the 121-test focused run; the failed
receipt is preserved. No runtime code changed for that assertion correction.

The broad typecheck first found a widened string literal in the new test's
suppression list; the fixture now uses a literal tuple and its affected strict
check passes. Old consent assertions were updated to the actual corrected
wording; the final web run passes. The aggregate was subsequently stopped at the user's explicit direction;
this report does not claim it passed.

[Browser observations and fixture scope](./artifacts/2026-09-06-review-claims-followup/browser/observations.json)
record real Chromium rendering at 1280×900 and 390×844, fictional Daily grant and
withdrawal, Pattern consent before generation, and the checking status. Both
viewports had no horizontal document overflow. The only console error in the
final fixture session was an intentional 404 for its unavailable unrelated
portrait-automation endpoint. Seven viewport screenshots were visually
inspected, including [mobile retention copy](./artifacts/2026-09-06-review-claims-followup/browser/pattern-disclosure-mobile.png)
and [desktop checking status](./artifacts/2026-09-06-review-claims-followup/browser/checking-desktop.png).
This was not production sign-in, actual encrypted persistence or a portrait
completion/withdrawal/deletion exercise.

The Workerd `EnvironmentTeardownError` / pending-resolve warning recurred in
the API run. The counted failure was the stale version assertion; the warning
remains a separately recorded test-environment limitation, not a fixed defect.

## Remaining boundaries

The recorded verification does not attest a production migration, ontology
activation, Worker deployment or runner replacement. Commit and push are
separate repository operations recorded in Git history. Image provenance is additive and needs no
migration, but the compatible Worker must precede the new runner because an old
Worker rejects the new completion field. A rollback must respect the same
compatibility boundary. Existing corpus provenance is not repaired by a new
runner account observation.

Before making stronger launch claims, obtain the missing human corpus reviews,
actual account-specific provider privacy evidence, and a separately authorized
production test account with observed completion, reuse, withdrawal, deletion
and late-upload cleanup. The reconciliation input leaves absent records blank.

The Auth0 `dev-` prefix remains insufficient evidence of insecurity. A future
issuer change must preserve identity continuity and the existing immutable
`crypto_subject`; issuer change alone does not require re-encrypting every
artifact. No tenant rename or identity migration was attempted. The review's
social/native/atlas comparisons remain scope distinctions, not defects repaired
by this implementation.
