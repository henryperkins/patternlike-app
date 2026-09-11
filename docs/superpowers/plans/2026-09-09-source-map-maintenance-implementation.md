# Source-map maintenance implementation plan

**Superseding decision (2026-09-09):** The user requested simpler verification. `test:content` has been restored to its original scope; the map tests remain available only through optional `test:source-map`. Slice 2’s proposed release preflight is withdrawn and is not a dependency. Completed tasks and test counts below describe the earlier execution, not current gate membership.

> **For agentic workers:** Use `superpowers:subagent-driven-development` to implement this plan. Checkboxes track local work; merge and operational adoption remain separate.

**Goal:** Deliver Slice 1's corrected guidance, maintained map, immutable source snapshots, and offline drift checker.

**Architecture:** An authored JSON definition supplies prose and literal evidence selectors. Pure validation/rendering and filesystem/Git snapshot operations remain separate modules; a small CLI exposes bounded JSON results. Historical maps remain byte-identical archives.

**Tech stack:** Node 22 ES modules on Linux with `/proc/self/fd`, built-in `node:test`, Git read operations, existing canonical JSON helper, installed TypeScript scanner for comment verification.

**Spec:** [Source truth and map maintenance](../specs/2026-09-07-source-truth-map-maintenance-design.md). The spec's exact schemas, error codes, file sets, and failure matrix govern this plan.

## Global constraints

- Preserve application behavior, ontology content, provider configuration, saved readings, and the existing observatory.
- Preserve both historical map generations byte-for-byte, the roadmap, and all eight carried documentation edits.
- Use Node 22 and no new runtime dependencies.
- Bind capture/check filesystem operations to validated Linux directory/file handles with no-follow opens. Unsupported filesystem environments fail closed; generated Markdown remains portable.
- Map evidence covers referenced files and map inputs only; it is not whole-repository, release, editorial, or production certification.
- Reject unsafe paths, ignored evidence, symlinks, malformed or incomplete identities, and detected concurrent drift. Never print source excerpts or arbitrary errors.
- Keep `test:content` serial and the existing fourteen-lane gate unchanged.
- Work only in `/home/henry/patternlike-app-source-map` on `codex/source-map-maintenance`. Keep the original checkout intact.
- No push, merge, deployment, signing, activation, or provider evaluation is part of this execution.

## Task 1: Correct source explanations and record their evidence

**Files:** Modify only comments in `apps/api/scripts/build-internal-ontology.ts` and `apps/api/src/services/ontology-signing-client.ts`; update `docs/deploy/openai-pattern-rollout.md` and `CLAUDE.md`; create `docs/architecture/source-map/source-corrections.md`.

**Interfaces:** Consume the spec's ST-01–ST-12 inventory and actual owning source. Produce a correction record with dated dispositions and source links. Task 3 owns map changes for ST-08–ST-12; coordinate their final verification without claiming them early.

- [x] Inspect each target and record pre-edit hashes and base revision in the correction record.
- [x] Apply ST-01–ST-07 without modifying historical ledger rows or executable TypeScript tokens.
- [x] Record evidence for ST-08–ST-12 and coordinate the maintained-map disposition with Task 3.
- [x] Compare non-trivia TypeScript scanner token sequences against the base files and confirm neither file belongs to the Pattern source fingerprint manifest.
- [x] Run the real offline corpus preparation/build in a temporary directory with the spec's fixed release/version pins; recompute the canonical bundle hash with `computeOntologyBundleHash` and retain the 60/40/20 counts and both hashes.
- [x] Review the diff and links; retain exact commands/results in the task report.

## Task 2: Implement snapshot tooling and regression coverage

**Files:** Create `scripts/source-map/model.mjs`, `snapshot.mjs`, `cli.mjs`, and `source-map.test.mjs`; update root `package.json` scripts.

**Interfaces:** Consume the exact `SourceMap` and snapshot contracts in spec sections 5–7. Produce `capture <capture-id>` and `check <snapshot-directory>` through the CLI. Keep module interfaces small and documented in exports. Task 3 consumes the CLI and schema, not internal helper names.

- [x] Write failing fixture-repository tests for deterministic capture/check and changed referenced bytes before implementing those behaviors. Use a tiny valid definition with one branch/topic/leaf and one unique source selector; include every fixed tooling input.

```js
const captured = invoke("capture", "2026-09-09-fixture");
assert.equal(captured.exitCode, 0);
assert.equal(invoke("check", captured.result.snapshot_path).result.status, "verified");
writeFileSync(sourcePath, "export const answer = 43;\n");
const stale = invoke("check", captured.result.snapshot_path);
assert.equal(stale.exitCode, 1);
assert.ok(stale.result.problems.some((problem) => problem.code === "source_changed"));
```

- [x] Implement closed validation, globally unique IDs, evidence membership, UTC dates, normalized safe paths, and escaped deterministic Markdown.
- [x] Implement buffered source reads, literal selectors, byte/mode identities, scoped Git dirtiness, canonical identity hashes, and completion-marker publication with exclusive directory/file creation.
- [x] Implement closed snapshot validation and independent re-derivation of definition, tooling, source, anchors, counts, and generated output; reject incomplete or tampered manifests even when stored digests are recomputed.
- [x] Add failing tests then implementations for every spec section 8 failure-matrix row, including clone relocation, later identical-content commits, path escapes/symlinks/secrets, source/HEAD drift, concurrency, interrupted output, and bounded diagnostics.
- [x] Add `map:capture`, `map:check`, and `test:source-map`. The initially added `test:content` glob was subsequently removed under the superseding decision above.
- [x] Run focused tests and content integration; report commands, counts, and any limitations.

## Task 3: Author the maintained map and preserve both archives

**Files:** Create `docs/architecture/source-map/map.json`, `README.md`, and the two archive directories. Task 1 owns the correction record; Task 4 publishes the generated snapshot.

**Interfaces:** Produce the exact `SourceMap` input from spec section 5. Selectors must be unique in current source and independent of comment wording Task 1 changes. Preserve eight branch subjects; derive topic/leaf/evidence counts rather than imposing a target count.

- [x] Archive the original three files and corrected two Markdown files with exact byte hashes and original paths in README.
- [x] Adapt the corrected map into stable branch/topic/leaf/evidence IDs and plain single-line prose; verify each source claim at the owning implementation.
- [x] Split offline supply from the parked producer; add shared exchange mechanics and literal committed observability/release identity; correct ST-09–ST-12.
- [x] Replace import-only selection/planning citations with meaningful selectors and required call-site evidence. Keep dated observations distinct from current source leaves.
- [x] Verify literal selector uniqueness and source membership before handing input to the CLI. Record any source-boundary correction for Task 1.
- [x] Write maintainer commands, scope, drift interpretation, refresh procedure, archive limitations, and the selected publication link after Task 4 captures it.

## Task 4: Integrate, review, and establish local verification

**Files:** Review all Task 1–3 output; publish `docs/architecture/source-map/snapshots/2026-09-09-slice-1/` once inputs are stable; record evidence under `docs/reviews/artifacts/2026-09-09-source-map-maintenance/` and update this plan's completion record.

**Interfaces:** Use the CLI and fixed npm scripts. Capture IDs are exclusive: if an incomplete or stale candidate needs replacement, use a new date-prefixed ID and retain the old directory honestly.

- [x] Inspect task reports and review source correctness and implementation behavior independently. Resolve material findings before freezing inputs.
- [x] Verify archive identity, unchanged roadmap/carried edits, Markdown links, and non-trivia token preservation.
- [x] Run `npm run test:source-map`, `npm run test:content`, and `npm run check:pattern-source -w @patternlike/api`.
- [x] Capture and check the selected map; inspect generated claims/evidence and preserve command results separately from the snapshot manifest.
- [x] Retain the final focused tooling/content results and source identities. The user explicitly waived the full local gate for this local implementation task; do not run `ci:local` here. This execution performs no merge or deployment.
- [x] Update local completion status and record remaining release/adoption steps. Keep final work available in this isolated worktree.

## Withdrawn follow-on: Slice 2 release safeguards

A release-preflight implementation plan was prepared but not implemented. The [superseding decision](../specs/2026-09-08-release-preflight-design.md) withdraws that work. It is not a prerequisite for a later tooling merge or product work.

## Completion record

Started 2026-09-09 from `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`, carrying the eight previously reviewed documentation edits. Local execution is complete. All 148 content tests passed, including 69 source-map tests; the maintained map capture/check passed with 201 selectors across 119 files. The original checkout, carried documentation, five archives, executable TypeScript tokens, ontology content identities, and Pattern fingerprint were preserved. Included source identity remained unchanged through the content suite. The full local gate was not run at the user’s direction. See the [verification receipt](../../reviews/artifacts/2026-09-09-source-map-maintenance/verification.json). Work remains uncommitted in the isolated worktree; no merge or deployment was performed. Slice 2’s prepared implementation plan was subsequently withdrawn. Later verification-policy edits supersede the carried-document preservation and gate-membership statements for the current checkout; the linked receipt retains the earlier results. The dated map snapshot predates the restored package script and is preserved without claiming a current match.
