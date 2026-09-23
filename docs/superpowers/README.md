# Plans and designs

This directory keeps only plans and designs that still drive work or that
something live cites as an authority. Plans and designs whose work shipped, was
superseded, or was withdrawn were removed on 2026-09-23. They remain in Git
history: `git log --all --full-history -- '**/<file>'` finds the removing
commit, and `git show <commit>^:<path>` prints the last version.

## Open-work indexes

- [`plans/2026-09-07-mind-map-alignment-slices.md`](plans/2026-09-07-mind-map-alignment-slices.md) — the current delivery ledger.
- [`plans/2026-08-15-m7-remaining-slices-ledger.md`](plans/2026-08-15-m7-remaining-slices-ledger.md) — remaining M7 work, cited by the Pattern rollout runbook.
- [`plans/2026-08-01-backend-completion-roadmap.md`](plans/2026-08-01-backend-completion-roadmap.md) and its web counterpart [`plans/2026-08-01-frontend-completion-roadmap.md`](plans/2026-08-01-frontend-completion-roadmap.md) — the backend roadmap still owns open items (Stream 7 place search, the geocode-grade half of the uncertainty report, Stream 8's deferred async workflow, Stream 9's key-rotation caller and rate limiting).

## Normative and operational authorities

- [`plans/2026-08-09-m3-daily-reading-pipeline.md`](plans/2026-08-09-m3-daily-reading-pipeline.md) — `CLAUDE.md` cites its §5 as the ordered runbook for every D1 migration, and `contracts/m3/common.schema.json` names it a normative source.
- [`specs/2026-08-10-openai-daily-reading-publisher-design.md`](specs/2026-08-10-openai-daily-reading-publisher-design.md) and [`specs/2026-08-27-codex-daily-pattern-design.md`](specs/2026-08-27-codex-daily-pattern-design.md) — normative sources named by the frozen `contracts/m5/` package.
- [`specs/2026-08-14-ai-generated-pattern-design.md`](specs/2026-08-14-ai-generated-pattern-design.md), [`specs/2026-08-16-m7-spec-artifact-amendments.md`](specs/2026-08-16-m7-spec-artifact-amendments.md), and [`specs/2026-08-29-pattern-source-regeneration-design.md`](specs/2026-08-29-pattern-source-regeneration-design.md) — the normative Your Pattern chain cited by `CLAUDE.md` and `apps/web/PRODUCT.md`.
- [`specs/2026-08-16-m7-evidence-gates-design.md`](specs/2026-08-16-m7-evidence-gates-design.md) — Slice D criteria and the restore drill remain open; cited by the Pattern rollout runbook.
- [`specs/2026-09-06-review-claims-followup-design.md`](specs/2026-09-06-review-claims-followup-design.md) — governs `docs/deploy/fresh-reading-evaluation.md` and `fresh-pattern-verifier-evaluation.md`.
- [`specs/2026-09-07-source-truth-map-maintenance-design.md`](specs/2026-09-07-source-truth-map-maintenance-design.md) — the standing spec for the optional source-map tooling in `docs/architecture/source-map/`.
- The four `specs/2026-09-08-*-design.md` documents — adaptive observatory, interpretation-quality baseline, reader relationships and feedback, and readiness/runner fairness each carry open work cross-cited by the delivery ledger.
- [`specs/2026-09-05-chapter-image-prompts.json`](specs/2026-09-05-chapter-image-prompts.json) — prompt record named by `apps/web/src/preview/references/provenance.json`.
- [`2026-09-05-pattern-portrait-handoff.md`](2026-09-05-pattern-portrait-handoff.md) — `apps/web/src/preview/DESIGN.md` defers to it for the preview harness; [`artifacts/pattern-portrait/`](artifacts/pattern-portrait/) holds the files it cites.

## Parked

- [`plans/2026-08-20-automated-ontology-pipeline.md`](plans/2026-08-20-automated-ontology-pipeline.md) and [`specs/2026-08-15-ontology-pipeline-design.md`](specs/2026-08-15-ontology-pipeline-design.md) — engineering finished, but machine-ontology production is parked rather than closed. The M7 ledger cites both and the Pattern rollout runbook cites the plan; Slice 13 of the delivery ledger governs any re-entry.
