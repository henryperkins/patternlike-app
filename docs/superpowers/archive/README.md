# Archived designs and plans

Documents whose work is finished, superseded, or explicitly marked historical by
their own authors. Nothing here drives open work. They are kept because they
record *why* shipped behaviour is the way it is, and several are cited by review
and rollout documents that are still live.

Active designs live in [`../specs/`](../specs/); active plans in
[`../plans/`](../plans/). The current index for open work is
[`../plans/2026-08-15-m7-remaining-slices-ledger.md`](../plans/2026-08-15-m7-remaining-slices-ledger.md).

Status headers inside these files were written mid-flight and were not rewritten
on archival. Where a header disagrees with the table below, the table is the
later reading of the repository.

## Plans

| Document | Why archived |
| --- | --- |
| `plans/2026-08-01-code-review-remediation.md` | Self-declared `STATUS: EXECUTED`, `53847f0..0d2784b`. |
| `plans/2026-08-01-identity-and-sessions.md` | Self-declared `STATUS: EXECUTED`, `38e13c9..e758f48`. |
| `plans/2026-08-08-pr-8-review-remediation.md` | PR #8 merged; the production API it gated has been live since 2026-08-08 (`docs/deploy/api-production.md`). |
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

## Designs

| Document | Why archived |
| --- | --- |
| `specs/2026-08-01-stream0-decisions-design.md` | All five decisions implemented; streams 1, 2, 4, and 5 landed. Still the rationale `apps/api/src/db/users.ts` cites for the `crypto_subject` split. |
| `specs/2026-08-09-timing-live-surface-design.md` | Implemented by the archived Timing plan. |
| `specs/2026-08-09-today-on-demand-reading-design.md` | Implemented by the archived Today on-demand plan. |
| `specs/2026-08-11-privacy-lifecycle-and-daily-check-in-design.md` | M6 shipped: `contracts/m6`, `0004_privacy_context.sql`, `0006_usr05_topic_exclusions.sql`, `routes/privacy.ts`, check-ins and life events. |
| `specs/2026-08-13-your-pattern-time-travel-v02-design.md` | M4 shipped: `contracts/m4`, `0005_m4_pattern_time_travel.sql`, `routes/pattern.ts`, `routes/time-travel.ts`. Partly superseded for the AI cohort by `../specs/2026-08-14-ai-generated-pattern-design.md` §165. |

## Deliberately not archived

Three finished documents stayed in the active directories because something
still points at them as a normative or operational authority:

- `../plans/2026-08-01-backend-completion-roadmap.md` and
  `../plans/2026-08-01-frontend-completion-roadmap.md` — not finished. Stream 7
  place search, the geocode-grade half of the uncertainty report, Stream 8's
  deferred async workflow, and Stream 9's key-rotation caller and rate limiting
  are all still open.
- `../plans/2026-08-09-m3-daily-reading-pipeline.md` — M3 shipped, but `CLAUDE.md`
  cites its §5 as the ordered runbook for every remaining D1 migration, and
  `contracts/m3/common.schema.json` names it a normative source.
- `../specs/2026-08-10-openai-daily-reading-publisher-design.md` — M5 shipped, but
  the frozen `contracts/m5/common.schema.json` names it *the* normative source
  for the package.

The `contracts/` pointers were left untouched rather than rewritten: those files
are frozen, and no frozen contract references anything that moved.
