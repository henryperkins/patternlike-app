# Archived designs and plans

Documents whose work is finished, superseded, withdrawn, or explicitly marked
historical by their own authors. Nothing here drives open work. They are kept
because they record *why* shipped behaviour is the way it is, and several are
cited by review and rollout documents that are still live.

Active designs live in [`../specs/`](../specs/); active plans in
[`../plans/`](../plans/). The current indexes for open work are
[`../plans/2026-08-15-m7-remaining-slices-ledger.md`](../plans/2026-08-15-m7-remaining-slices-ledger.md)
and
[`../plans/2026-09-07-mind-map-alignment-slices.md`](../plans/2026-09-07-mind-map-alignment-slices.md).

Status headers inside these files were written mid-flight and were not rewritten
on archival. Where a header disagrees with the tables below, the tables are the
later reading of the repository. Every document archived on or after 2026-08-22
carries a dated `ARCHIVED` banner at its head.

## Plans

| Document | Why archived |
| --- | --- |
| `plans/2026-08-01-code-review-remediation.md` | Self-declared `STATUS: EXECUTED`, `53847f0..0d2784b`. |
| `plans/2026-08-01-identity-and-sessions.md` | Self-declared `STATUS: EXECUTED`, `38e13c9..e758f48`. |
| `plans/2026-08-08-pr-8-review-remediation.md` | PR #8 merged; the production API it gated has been live since 2026-08-08. |
| `plans/2026-08-09-m3-generation-followup.md` | Batching, placeholder-grammar validation, canonicalization fixtures, and queue backoff all shipped. |
| `plans/2026-08-09-m3-implementation-handoff.md` | Handoff prompt for the M3 pipeline; superseded by the shipped pipeline. Its own banner overstates one item: phase 7's DEV-01 foreground/system-change preference sync has no client half. The API side is ready (`apps/api/src/db/preferences.ts`), but nothing in `apps/web/src` ever writes a `device_derived` preference — `PreferenceWriteSource` is declared and only ever passed `user_confirmed`. |
| `plans/2026-08-09-today-lead-line.md` | Shipped in `apps/web/src/components/TodayView.tsx`. |
| `plans/2026-08-09-today-on-demand-reading.md` | Shipped: `PUT /v1/readings/today` and `services/ensure-today-reading.ts`. |
| `plans/2026-08-10-openai-daily-reading-publisher.md` | M5 shipped: `contracts/m5`, `0003_m5_openai_reading_publisher.sql`, `services/openai-reading-publisher.ts`. |
| `plans/2026-08-10-openai-daily-reading-publisher-handoff.md` | Superseded by the tasks 9–17 handoff, which states so on its own first page. |
| `plans/2026-08-10-openai-daily-reading-publisher-handoff-tasks-9-17.md` | Self-declared "complete. All seventeen tasks landed and M5 shipped." Supersedes the Tasks 5–17 handoff above. |
| `plans/2026-08-10-openai-daily-reading-publisher-execution-notes.md` | Execution record for work that completed. |
| `plans/2026-08-10-timing-live-surface.md` | Shipped: `apps/api/src/routes/timing.ts`, `apps/web/src/components/TimingView.tsx`. |
| `plans/2026-08-11-openai-reading-gate-6-remediation.md` | Code half landed: the 4,000-token ceiling, the `1.0.1` corpus/prompt pins, and the `max_output_tokens_exhausted` classification are in `apps/api/src`. The live 6/6 Gate 6 rerun it names is a rollout action, tracked in `docs/deploy/openai-daily-reading-rollout.md`. |
| `plans/2026-08-15-m7-remaining-slices-handoff.md` | Self-declared "Historical scoping brief. Do not use this file for current task status." |
| `plans/2026-08-15-openai-pattern-adapter.md` | Adapter engineering complete and `0009`/`0010` applied; new Pattern commands later pivoted to the Codex provider. |
| `plans/2026-08-20-internal-ontology-activation.md` | Executed on production 2026-08-26: internal-0.1.0 signed, activated, canary accepted. |
| `plans/2026-08-22-auth0-pattern-canary.md` | Canary preflight executed 2026-08-22; evidence recorded in the rollout runbook. |
| `plans/2026-08-22-auth0-react-sdk.md` | `@auth0/auth0-react` integrated in `apps/web`; Universal Login flow shipped. |
| `plans/2026-08-22-pattern-erasure-replay-ledger.md` | Replay ledger runtime shipped (`services/pattern-replay-ledger.ts`); `0008` applied. |
| `plans/2026-08-23-pattern-stage-protocol.md` | The durable stage machine shipped as `services/pattern-stage-protocol.ts`. |
| `plans/2026-08-24-codex-production-provider.md` | `0013`/`0014` applied; the installed runner operates in production. |
| `plans/2026-08-26-birth-operational-guards.md` | `0016` applied 2026-08-27; the budget guard serves in production. |
| `plans/2026-08-26-crypto-operator-control-plane.md` | `0021` applied; `/crypto-operator/*` mounted; rotation runbooks live in `docs/deploy/`. |
| `plans/2026-08-26-onboarding-place-and-device-sync.md` | Device sync and place routes shipped; its Google composite adapter was superseded by `docs/decisions/2026-09-04-geoapify-geocoder.md`. |
| `plans/2026-08-26-p0-p1-hardening-and-core-loop.md` | All four workstreams landed (`0016`, `0021`, `0022`/`0024`, `0028`). |
| `plans/2026-08-26-reading-history-and-save.md` | Definition of done fully checked; PR #43 merged; `0028` applied. |
| `plans/2026-08-27-account-wide-pattern.md` | `PATTERN_AI_ROLLOUT` and `PATTERN_INTERNAL_ACCOUNT_IDS` removed; Pattern is account-wide. |
| `plans/2026-08-27-codex-daily-control-plane.md` | Codex Daily control plane shipped on `main`. |
| `plans/2026-08-27-codex-reader-rollout.md` | `0017` applied; the Codex reader rollout is live. |
| `plans/2026-08-29-pattern-source-regeneration.md` | `0023` and `7a15e7f` shipped the creation-source fingerprint and regeneration path. |
| `plans/2026-08-29-personable-daily-reading.md` | Shipped as Daily prompt `1.0.2` in `e02950f`. |
| `plans/2026-09-05-image-only-sculpture.md` | Image-only constellation delivered per its handoff and merged. |
| `plans/2026-09-05-pattern-portrait.md` | Self-declared historical first-milestone record; superseded by the image-only-sculpture direction. |
| `plans/2026-09-05-personalized-portrait.md` | Account portraits shipped behind `0026`; production portrait flags are on. |
| `plans/2026-09-05-personalized-portrait-handoff.md` | Delivery record for account portraits; the production release boundary has since been crossed. |
| `plans/2026-09-06-portrait-automation.md` | Automation shipped with `0027` and `ce52443`. |
| `plans/2026-09-06-portrait-explorer.md` | Explorer shipped in `9b45db0`. |
| `plans/2026-09-06-portrait-observatory.md` | Shipped in PR #45 (`7cda3fc`). |
| `plans/2026-09-06-portrait-second-pass.md` | Second pass landed in `875c09b` and `cefc979`. |
| `plans/2026-09-06-reading-assurance.md` | Publication-safety evaluation shipped; review record at `docs/reviews/2026-09-06-reading-assurance.md`. |
| `plans/2026-09-06-review-claims-followup.md` | Every follow-up task landed; the plan itself records that no passing final gate was claimed. |
| `plans/2026-09-06-zodiac-observatory.md` | Zodiac instrument shipped in PR #45. |
| `plans/2026-09-09-interpretation-quality-baseline-implementation.md` | Self-declared offline completion; baseline evidence under `docs/reviews/artifacts/interpretation-quality/`. |
| `plans/2026-09-09-reader-feedback-implementation.md` | Integrated and merged in PR #54 (`b38d87c`); categorical feedback shipped with `0031`. |
| `plans/2026-09-09-reader-journey-production-implementation.md` | Merged in PR #52 (`c4e94f2`); `0030` applied before the compatible Worker. |
| `plans/2026-09-09-release-preflight-implementation.md` | Withdrawn: cancelled before implementation on 2026-09-09 under the Slice 2 decision in `specs/2026-09-08-release-preflight-design.md`. |
| `plans/2026-09-09-source-map-maintenance-implementation.md` | Map maintenance landed (PR #54); the maintained source map was released 2026-09-23 (`docs/architecture/source-map/`). |
| `plans/2026-09-11-all-chapter-artwork.md` | Merged in PR #56 (`f9ad1a0`); `0033` applied 2026-09-11. Remaining producer enablement is owned by `docs/deploy/adaptive-portrait-artwork.md`. |
| `plans/2026-09-11-readiness-metrics.md` | Merged in PR #55 (`59404a2`); results in `docs/reviews/2026-09-11-readiness-metrics-results.md`. |
| `plans/2026-09-11-roadmap-integration.md` | Merged in PR #54; results in `docs/reviews/2026-09-11-roadmap-integration-results.md`. |

## Designs

| Document | Why archived |
| --- | --- |
| `specs/2026-08-01-stream0-decisions-design.md` | All five decisions implemented; streams 1, 2, 4, and 5 landed. Still the rationale `apps/api/src/db/users.ts` cites for the `crypto_subject` split. |
| `specs/2026-08-09-timing-live-surface-design.md` | Implemented by the archived Timing plan. |
| `specs/2026-08-09-today-on-demand-reading-design.md` | Implemented by the archived Today on-demand plan. |
| `specs/2026-08-11-privacy-lifecycle-and-daily-check-in-design.md` | M6 shipped: `contracts/m6`, `0004_privacy_context.sql`, `0006_usr05_topic_exclusions.sql`, `routes/privacy.ts`, check-ins and life events. |
| `specs/2026-08-13-your-pattern-time-travel-v02-design.md` | M4 shipped: `contracts/m4`, `0005_m4_pattern_time_travel.sql`, `routes/pattern.ts`, `routes/time-travel.ts`. Partly superseded for the AI cohort by `../specs/2026-08-14-ai-generated-pattern-design.md` §165. |
| `specs/2026-08-15-internal-ontology-activation-design.md` | Executed on production 2026-08-26; the internal-origin path is documented in `CLAUDE.md` and the rollout runbook. |
| `specs/2026-08-15-openai-pattern-adapter-design.md` | Implemented including the 2026-08-28 amendment; OpenAI is no longer selected for new Pattern commands. |
| `specs/2026-08-16-admin-authorization-design.md` | Self-declared implemented and deployed; Access cutover completed 2026-08-28. |
| `specs/2026-08-16-pattern-replay-ledger-design.md` | Self-declared approved and implemented. |
| `specs/2026-08-22-auth0-react-canary-design.md` | SDK integrated; canary executed 2026-08-22. |
| `specs/2026-08-23-pattern-invariant-kernel-design.md` | Stage protocol, publication proof, and `0019` claim guards landed. |
| `specs/2026-08-24-codex-production-provider-design.md` | The installed runner ships and operates in production. |
| `specs/2026-08-28-account-processing-consent-design.md` | Shipped with `0018` and the account freeze/recovery flow. |
| `specs/2026-08-29-personable-daily-reading-design.md` | Shipped as Daily prompt `1.0.2`. |
| `specs/2026-09-05-pattern-object-direction.md` | The approved four-image direction shipped as the constellation preview. |
| `specs/2026-09-05-pattern-portrait-design.md` | Self-declared historical first-milestone record; retained as the origin note for the shipped direction. |
| `specs/2026-09-05-personalized-portrait-design.md` | Account portraits shipped behind `0026`. |
| `specs/2026-09-06-pattern-portrait-experience-redesign.md` | The redesigned experience shipped as the portrait explorer. |
| `specs/2026-09-06-portrait-automation-design.md` | Shipped with `0027`. |
| `specs/2026-09-06-portrait-observatory-design.md` | Shipped in PR #45; still cited as the courtyard brief by the live explorer component docs. |
| `specs/2026-09-06-reading-assurance-design.md` | Publication-safety evaluation shipped. |
| `specs/2026-09-06-zodiac-observatory-design.md` | Shipped in PR #45; still cited as the zodiac direction contract by the live explorer component docs. |
| `specs/2026-09-08-release-preflight-design.md` | Withdrawn 2026-09-09; the canonical Slice 2 withdrawal record the active ledger and sibling specs cite. |

## Deliberately not archived

Finished or parked documents stay in the active directories when something still
points at them as a normative or operational authority, or when they carry
conditionally open work:

- `../plans/2026-08-01-backend-completion-roadmap.md` and
  `../plans/2026-08-01-frontend-completion-roadmap.md` — retained by the first
  archival pass; the backend roadmap still owns open items (Stream 7 place
  search, the geocode-grade half of the uncertainty report, Stream 8's deferred
  async workflow, Stream 9's key-rotation caller and rate limiting).
- `../plans/2026-08-09-m3-daily-reading-pipeline.md` — M3 shipped, but `CLAUDE.md`
  cites its §5 as the ordered runbook for every remaining D1 migration, and
  `contracts/m3/common.schema.json` names it a normative source.
- `../specs/2026-08-10-openai-daily-reading-publisher-design.md` and
  `../specs/2026-08-27-codex-daily-pattern-design.md` — the frozen
  `contracts/m5/` package names both as normative sources.
- `../specs/2026-08-14-ai-generated-pattern-design.md`,
  `../specs/2026-08-16-m7-spec-artifact-amendments.md`, and
  `../specs/2026-08-29-pattern-source-regeneration-design.md` — the normative
  Your Pattern chain cited by `CLAUDE.md` and `apps/web/PRODUCT.md`.
- `../plans/2026-08-20-automated-ontology-pipeline.md` and
  `../specs/2026-08-15-ontology-pipeline-design.md` — engineering finished, but
  machine-ontology production is deliberately *parked*, not closed: the
  alignment ledger's Slice 13 keeps conditional re-entry pointed at these.
- `../specs/2026-08-16-m7-evidence-gates-design.md` — Slice D criteria and the
  restore drill remain open; cited by the live rollout runbook.
- `../specs/2026-09-06-review-claims-followup-design.md` — the governing design
  named by the live `docs/deploy/fresh-reading-evaluation.md` and
  `fresh-pattern-verifier-evaluation.md` procedures.
- `../specs/2026-09-07-source-truth-map-maintenance-design.md` — the standing
  spec for the optional source-map tooling exercised again on 2026-09-23.
- The four `../specs/2026-09-08-*-design.md` documents — adaptive observatory
  rollout, interpretation-quality adjudication, reader-feedback measured
  effects, and readiness alert adoption each carry explicitly open work and are
  cross-cited by the active ledger.
- `../2026-09-05-pattern-portrait-handoff.md` — the live
  `apps/web/src/preview/DESIGN.md` defers to it for the preview harness's
  current verification and delivery claims.

The `contracts/` pointers were left untouched rather than rewritten: those files
are frozen, and no frozen contract references anything that moved.
