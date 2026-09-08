# Slice 1: source truth and map maintenance

Date: 2026-09-07

Status: specification for review; implementation has not started.

Planning basis: [Slice 1 in the delivery ledger](../plans/2026-09-07-mind-map-alignment-slices.md#slice-1--source-truth-and-map-maintenance) and [the alignment roadmap](../../reviews/2026-09-07-mind-map-alignment-roadmap.md), especially sections 2, 4, 5, 7, and 8.

Source baseline inspected: `6e706741f03253f2807d33380afb529161f3481f`, including the existing local Observatory edits represented in the original map. This commit alone does not contain those edits.

## 1. Outcome and boundaries

A maintainer can correct an explanation, attach it to concrete source evidence, capture a new map, and run one offline command to determine whether that captured map still matches its inputs and referenced source files. A reader can distinguish current source facts from dated observations and follow each map statement to its evidence.

The slice delivers two review units:

1. **Source-truth corrections:** current comments/guidance agree with source; dated observations and original map artifacts retain their provenance.
2. **Map maintenance:** one authored input produces the Markdown map, evidence index, and immutable dated snapshot, with deterministic checking and regression coverage.

This slice does not change application behavior, provider configuration, ontology content or activation, generation policy, saved readings, or the Observatory implementation. It does not implement the Slice 2 release preflight. A map check establishes a defined set of file identities and structural relationships; it does not certify interpretation quality, all repository behavior, or production readiness.

## 2. Source findings that set the scope

The following were checked locally while preparing this specification:

- The original map contains eight branches, 34 topics, 68 leaves, and 86 distinct referenced source files. Its recorded source hashes and Markdown hash match the current local bytes; recorded line numbers are in range. That is not yet a check that every anchor identifies the best implementation boundary.
- The real offline builder under Node `v22.23.2` produces 40 records from 60 fragments. Every record is `source_supported` and cites one prepared fragment. It skips all twelve §2 sign fragments and all eight §8 cross-cutting fragments.
- The rebuilt corpus hash is `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`. The recomputed unsigned bundle hash is `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84`. Both match the [recorded observation](../../reviews/artifacts/2026-09-06-source-register-followup/production-observation.json) at `2026-09-06T18:49:35.205Z`; no live object or active pointer was fetched.
- [Corpus provenance](../../../pattern-corpus/provenance.json) records `model_generated_first_party` and zero certified human-reviewed fragments. The offline builder's evaluator compatibility fields are not an independent evaluation receipt.
- [ontologyServesAccount](../../../apps/api/src/db/pattern-ontology.ts) admits `synthetic_internal` by origin and requires `public` activation scope for `machine_pipeline`. The signing-client comment and runbook activation table contradict this.
- Both TypeScript files selected for comment corrections are absent from [the Pattern source manifest](../../../apps/api/pattern-creation-sources.json). This scope can preserve the generated Pattern source identity; verify the manifest again at implementation time.

## 3. Correction contract

The correction record will live at `docs/architecture/source-map/source-corrections.md`. Each correction records its ID, affected explanation, replacement meaning, evidence paths/anchors, evidence class/date, and verification performed. Record the pre-change Git revision and file hashes for tracked guidance; keep the original untracked map artifacts as described in section 4.

| ID | Location | Required correction and evidence |
| --- | --- | --- |
| ST-01 | `apps/api/scripts/build-internal-ontology.ts`: opening comment and `predicateFor` fallback comment | Describe an unsigned, compilable internal candidate built without a provider call. Report both §2 and §8 omissions. Remove the blanket assertion that sixteen candidates all died in regression; the runbook records failures at earlier boundaries too. |
| ST-02 | Same builder: evaluation-field explanation | Explain `compiler_passed`, `evaluator_passed`, `regression_passed`, and `unevaluated_fixture_count` together with origin and actual work performed. Keep every value and output byte contract unchanged. Explain that sentence matching and proposition fallback are traceable transformations, not editorial adjudication. |
| ST-03 | `apps/api/src/services/ontology-signing-client.ts`: `signInternalOntology` documentation | State that this function signs and returns an internal-origin release; it does not ingest or activate it. Eligible readers can use an admitted internal-origin release. Preserve its separation from machine signing and avoid treating either signature as quality certification. |
| ST-04 | `docs/deploy/openai-pattern-rollout.md`: current status, admission descriptions, and activation table | Distinguish no active release, admitted `synthetic_internal`, machine release without public evidence, and public-capable machine release. Preserve account/chart/locale/consent/pause/claim gates. Correct present-tense claims that internal activation serves nobody or that machine-only admission is required for all readers. |
| ST-05 | Same runbook: current failure/quality summary | Classify recorded failures individually. Describe candidate `0.1.17` as a dated execution that stopped at cursor 95 after 96 regression calls, not 95 completed fixtures. Existing closure rules and named failure events make the historical diagnosis a lead for Slice 13, not a reproduced current defect. Shared document publication safety runs on the reader path; whole-corpus machine evaluation remains a distinct process. |
| ST-06 | Same runbook: current-state versus historical operations | Cite the September 6 pointer/hash observation with its date and active-pointer-join scope. Keep older observations dated. Separate obsolete cohort transitions in Gates 8/10 from still-needed lifecycle evidence; do not blanket-mark every gate passed, open, or inapplicable. Mark older operational steps as requiring current-source reconciliation before use. |
| ST-07 | `CLAUDE.md`: M7 and isolated-signing explanations | Apply the same supply/admission/coverage/safety distinctions. Keep thirty frozen regression fixtures and the eleven-call worst-case envelope. Remove the unverified minimum-seven-fixtures claim from current guidance; no fixture reduction or new minimum is authorized. Preserve historical provider/model provenance and current Codex deployment admission. |
| ST-08 | Maintained map and evidence index | Show offline ontology supply separately from the parked machine producer; shared Codex text mechanics separately from domain ownership; frozen Daily V1/V2 execution compatibility; and observability/release identity with their actual limits. Replace selection/planning anchors that point only at imports with owning implementations and relevant call sites. |

For ST-04, the current admission table must distinguish:

| Available release | Ontology admission result |
| --- | --- |
| None, invalid, or unavailable through the release-loading path | No usable ontology; other eligibility states may also apply |
| Valid admitted `synthetic_internal` | Admitted by origin; remaining account/generation gates still apply |
| Valid `machine_pipeline` without re-derived `public` scope | Not admitted for reader generation |
| Valid `machine_pipeline` with re-derived `public` scope | Admitted, subject to remaining account/generation gates |

Historical ledger rows and raw dated observations remain unchanged. Where an older narrative conclusion contradicts current source, retain it as an explicitly superseded historical interpretation and put the corrected current explanation outside that record. Preserve existing runbook heading anchors where possible so incoming links continue to work. A pointer/hash observation does not prove a current signature, current activation, or a complete evidence-table census.

The maintained map must describe the production observability configuration literally: top-level `enabled = false`, nested logs enabled, nested traces disabled. It must label these as committed settings. Health means liveness; `/v1/meta` reports configured release identity. Neither proves successful provider execution or installed runner adoption.

## 4. Authored input and historical preservation

Use an authored JSON definition with deterministic Markdown rendering. Keeping hand-edited Markdown plus a separate citation manifest would require duplicate structure and permit silent divergence. Automatic import/AST graph generation would describe code relationships without establishing the meaning of the prose. The selected design keeps semantic authorship explicit and automates identity/structure checks.

Create these files during implementation:

| Path | Responsibility |
| --- | --- |
| `docs/architecture/source-map/README.md` | Scope, maintenance commands, current published snapshot link, archive provenance, and how to interpret check results |
| `docs/architecture/source-map/map.json` | Sole maintained source of map prose, hierarchy, stable IDs, and evidence selectors |
| `docs/architecture/source-map/source-corrections.md` | ST-01–ST-08 dispositions and verification evidence |
| `docs/architecture/source-map/archive/2026-09-07-184743/` | Byte-identical copies of the original map Markdown, source-evidence Markdown, and source-snapshot JSON |
| `docs/architecture/source-map/snapshots/<capture-id>/` | Four-file generated snapshot bundle described in section 6 |
| `scripts/source-map/model.mjs` | Closed input validation and pure Markdown/evidence rendering |
| `scripts/source-map/snapshot.mjs` | Source/selector resolution, snapshot identity, capture, and comparison |
| `scripts/source-map/cli.mjs` | Argument handling and bounded JSON result/exit-code interface |
| `scripts/source-map/source-map.test.mjs` | Temporary-repository regression tests for the authored model and capture/check behavior |

Archive the three files currently under `output/mindmaps/2026-09-07-184743/` before adapting their content. Record each archive file's exact SHA-256 and original path in the README. Do not normalize their links, line endings, dates, absolute checkout path, or renderer-reported flags. Explain that their absolute links are historical and their hashes alone cannot reconstruct the uncommitted source bytes. Leave the originals and the alignment roadmap unchanged.

The maintained map keeps the original eight branch subjects. Split the old ontology-preparation topic into **Offline ontology supply** and **Parked machine-ontology producer**. Add **Shared Codex exchange mechanics** and **Observability and release identity** under runtime services. This gives an initial target of 37 topics if all other topics are retained; actual counts are derived, not hardcoded into the validator. Preserve useful existing prose and record substantive changes in the correction record. Do not claim new Observatory behavior from an isolated checkout unless that checkout contains it.

## 5. Definition and evidence model

The following is the normative logical shape. It is a tooling input, not a product wire contract; it does not belong in frozen M0 schemas.

```ts
type EvidenceKind = "source" | "recorded_observation";

interface Evidence {
  id: string;
  kind: EvidenceKind;
  path: string;
  selector: { text: string };
  observed_at: string | null;
}

interface MapLeaf {
  id: string;
  text: string;
  evidence_ids: string[];
}

interface MapTopic {
  id: string;
  title: string;
  leaves: MapLeaf[];
}

interface MapBranch {
  id: string;
  title: string;
  topics: MapTopic[];
}

interface SourceMap {
  schema_version: "patternlike-source-map.v1";
  title: string;
  branches: MapBranch[];
  evidence: Evidence[];
}
```

Validation rules:

- Reject unsupported versions, unknown object fields, wrong types, empty title/prose/selectors, and empty structural arrays. Node/evidence IDs are globally unique and match `^[a-z][a-z0-9-]*$`.
- Every leaf cites at least one defined evidence ID, without duplicate references; every evidence entry is used. All evidence for one leaf has the same kind. Split a sentence that otherwise conflates current source with historical observation.
- `source` requires `observed_at: null`. `recorded_observation` requires a valid UTC timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form, supported by the cited record. Rendering labels recorded observations with their dates; date syntax alone does not authenticate the observation.
- Titles and prose are single-line plain text. Render them as escaped Markdown text, not executable HTML or user-supplied link markup. Selectors may contain multiple lines and are limited to 2,048 UTF-8 bytes; they name a small, meaningful piece of repository evidence.
- Evidence paths are normalized repository-relative POSIX paths. Reject absolute paths, drive prefixes, backslashes, traversal/dot/empty segments, control characters, ignored files, and symlinks in any path component. Refuse `.git/`, dependencies/build outputs, local secret/environment files, `output/`, and the maintained source-map directory as evidence targets. This prevents snapshots referring to themselves or silently importing scratch evidence. The explicit `.nvmrc` tooling input is allowed.
- Read only regular UTF-8 evidence files in the repository. Literal selectors are case-sensitive contiguous text matches after CRLF-to-LF normalization for matching only. Require exactly one occurrence. Zero matches means `anchor_missing`; multiple matches means `anchor_ambiguous`. Do not guess an occurrence or replace a selector with line 1.
- Calculate one-based start/end line numbers from the matched text. Hash original file bytes without newline normalization. A source file with the same meaning but different bytes is still changed source.

For example, the admission evidence selector can be `export function ontologyServesAccount(` in `apps/api/src/db/pattern-ontology.ts`. A related leaf can cite a second selector for account eligibility rather than claiming that ontology admission alone grants generation. A historical observation needs an anchor in the dated evidence file, not in a later document repeating the claim.

Stable IDs join prose to its evidence. Ordering of branches, topics, leaves, and each leaf's citations follows the authored arrays. Canonical digest maps sort keys using the existing [canonical JSON helper](../../../scripts/pattern-release/candidates.mjs); no locale-dependent sorting is used.

## 6. Snapshot bundle and identity

Each successful capture creates exactly these four files in a previously absent `snapshots/<capture-id>/` directory:

1. `map-input.json`: the exact bytes of the maintained definition at capture time.
2. `patternlike-source-mindmap.md`: generated hierarchy and prose, with each leaf linked to its stable evidence entry.
3. `source-evidence.md`: generated claim/evidence index with evidence class/date, repository-relative source links, resolved line numbers, and a link to the snapshot's complete hashes.
4. `source-snapshot.json`: metadata and the complete identity manifest below.

Generated Markdown uses LF newlines and a final newline. Source links are relative to the fixed snapshot-directory depth and use `#L<start-line>`; encode path segments where necessary. Leaf/evidence links use explicit stable anchors such as `claim-<leaf-id>`. Rendered Markdown contains no capture timestamp, capture ID, branch, or absolute checkout path; those belong in the snapshot. Thus identical inputs at another dated sibling directory produce identical Markdown bytes.

The snapshot has these top-level fields, and rejects unknown fields:

| Field | Contract |
| --- | --- |
| `schema_version` | `patternlike-source-map-snapshot.v1`; distinct from the original historical map schema |
| `capture_id` | Supplied directory name, beginning with an ISO date and containing only lowercase letters, digits, and hyphens thereafter |
| `captured_at` | Actual capture time in UTC, `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `scope` | Literal `referenced_files_and_map_inputs_only` |
| `repository` | `{ base_commit, branch, worktree_has_changes, dirty_paths }`; full local HEAD, branch string or null, pre-output dirty flag, and sorted dirty paths within the consumed input set |
| `identity` | `{ definition, tooling_files, referenced_files, anchors, outputs, counts }`, defined below |
| `content_sha256` | SHA-256 of UTF-8 `canonicalJson(identity)`, as 64 lowercase hexadecimal characters |

Each file identity is `{ sha256, bytes, executable }`, with the exact byte count and executable-bit boolean. `definition` additionally contains its fixed repository path. `tooling_files` and `referenced_files` are maps keyed by repository-relative path. Hash each distinct referenced file once even when several evidence entries cite it.

The tooling input set is fixed: the three source-map `.mjs` implementation modules, `scripts/pattern-release/candidates.mjs`, root `package.json`, and `.nvmrc`. Any added runtime helper/import must be added to this set with a test. Node built-ins require no package dependency; record the capture/check Node version in command results. Test files are not renderer inputs. The whole repository is outside this manifest's scope.

`anchors` maps every evidence ID to `{ path, start_line, end_line, selector_sha256 }`, where the selector digest hashes the exact UTF-8 selector string from the definition. `outputs` maps the three non-snapshot bundle filenames to file identities. `counts` is `{ branches, topics, leaves, evidence_entries, referenced_files }`, re-derived from the input. There is no recursive hash of `source-snapshot.json`.

`dirty_paths` covers the definition, tooling inputs, and referenced files whose bytes or executable status differ from the captured HEAD tree, including paths absent from that tree. Do not copy raw `git status`, unrelated dirty filenames, diffs, source payloads, or environment values into the result. The fixed output bundle is excluded from the consumed input set.

Repository metadata is outside `content_sha256`. A later commit containing the same consumed bytes can verify successfully with `base_commit_matches: false`; committing a new snapshot must not create an endless recapture/commit cycle. Report both the captured base commit and current HEAD. Matching file content is never represented as proof that the captured base commit contained dirty edits or that a release used them.

No snapshot contains assertions that tests passed, a renderer ran, production was checked, or the explanation is semantically correct. Hashes detect drift; they do not authenticate the author or prove a historical execution if the receipt itself is fabricated.

## 7. Commands and check behavior

Add these root npm scripts; the commands below are the interface to implement, not commands currently available:

```text
npm run map:capture -- 2026-09-07-slice-1
npm run map:check -- docs/architecture/source-map/snapshots/2026-09-07-slice-1
npm run test:source-map
```

`map:capture` invokes `node scripts/source-map/cli.mjs capture <capture-id>`. It always reads `docs/architecture/source-map/map.json` and writes only under the fixed snapshot root. The capture ID must match `^\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)+$` with a valid calendar-date prefix. There is no overwrite or force flag, mutable latest pointer, remote fetch, or renderer call. Update the README's published-snapshot link as a separate documentation edit after reviewing a capture.

Capture sequence:

1. Validate arguments, input, paths, and the absent destination. Resolve the repository with read-only Git operations.
2. Capture HEAD, scoped dirtiness, and all consumed file bytes. Resolve selectors and render from those same buffered bytes.
3. Re-read consumed identities and HEAD before publication. Refuse detected changes with `source_changed_during_capture`; do not describe a mixed read as a stable snapshot.
4. Build all manifest/output bytes, then reserve the final directory with an exclusive `mkdir` that fails if it exists. Create each file exclusively; write `source-snapshot.json` last. A partial directory is not a successful capture and the checker must reject it. On a failed/interrupted write, leave the incomplete directory for inspection and use a new capture ID; do not automatically delete it or overwrite any existing path. This is a completion-marker protocol, not a claim of atomic directory publication.
5. Return a bounded JSON result containing `status: "captured"`, repository-relative snapshot path, `content_sha256`, counts, and Node version. Capture means mechanically complete; the maintainer still reviews the prose/evidence relationship.

`map:check` invokes `node scripts/source-map/cli.mjs check <snapshot-directory>`. It is read-only and never repairs or refreshes a snapshot. It:

- Requires the complete four-file bundle and supported closed schema; verifies hashes, counts, exact evidence membership, and output filenames.
- Re-derives the expected referenced-file set and anchors from the captured definition, rather than trusting an incomplete manifest. Ensures its bytes match both the snapshot output identity and the current maintained `map.json`.
- Requires the complete fixed tooling input set and compares current tooling bytes/modes with the recorded identities.
- Checks all current referenced file identities, resolves selectors, and reproduces the two generated Markdown files byte-for-byte. A still-in-range line number alone is insufficient.
- Rechecks consumed identities/HEAD at the end, reporting detected concurrent drift as failure. It neither scans uncited application files for semantic changes nor treats an unrelated file addition as referenced-source drift.
- Reports the current HEAD and whether it equals the captured base. A HEAD/branch difference between stable checkouts is informational when all consumed bytes match; a change during the check is a failed check.

Check results contain `status: "verified" | "failed"`, scope, snapshot path, `content_sha256`, `base_commit`, `current_head`, `base_commit_matches`, Node version, counts, and `problems`. A problem is `{ code, path, evidence_id }`, with null for inapplicable coordinates. Paths are repository-relative. Print no source excerpts, selector text, private payloads, or arbitrary caught exceptions. Bound the printed list at 50 entries and report `problem_count` plus `problems_truncated`; truncation must never change a failed outcome.

| Exit | Meaning | Representative codes |
| --- | --- | --- |
| 0 | Completed capture or successful source check | No problems |
| 1 | Invalid map/snapshot data or failed identity/structure check | `definition_invalid`, `snapshot_invalid`, `snapshot_version_unsupported`, `source_missing`, `source_changed`, `anchor_missing`, `anchor_ambiguous`, `definition_changed`, `tooling_changed`, `bundle_changed`, `manifest_incomplete`, `source_changed_during_capture`, `source_changed_during_check` |
| 2 | Invocation/environment/output failure; no successful result | `usage_invalid`, `repository_unavailable`, `node_version_unsupported`, `path_unsafe`, `output_exists`, `io_failed` |

Both commands require Node 22, consistent with `.nvmrc`; capture records the actual patch version in its result. Neither command runs npm installation, tests, provider requests, signing, ingestion, Git writes, production queries, or deployment. The original historical snapshot schema is retained in the archive and rejected by the new checker with `snapshot_version_unsupported`; there is no silent conversion of its old verification flags into fresh success.

## 8. Verification and integration

Use Node's built-in test runner and temporary repositories outside the real checkout. Test fixtures include the fixed tooling inputs so missing tooling coverage cannot be hidden by a reduced fixture. Clock/Git/file-reading boundaries may be injected into exported helpers to reproduce drift; do not edit real Observatory files to manufacture a regression.

| Case | Required result |
| --- | --- |
| Same input/source captured twice into new sibling directories | Identical definition/Markdown bytes and `content_sha256`; distinct capture metadata allowed |
| Unchanged committed or dirty referenced files | Check passes and reports the captured source context honestly |
| Referenced dirty bytes change while HEAD stays fixed | `source_changed`, exit 1 |
| Referenced file removed or renamed | `source_missing` or explicit source-set mismatch, exit 1 |
| Selector moved by inserted lines | Old snapshot fails source comparison; new capture resolves the new line numbers |
| Selector deleted or duplicated | `anchor_missing` or `anchor_ambiguous`; capture/check fails without fallback |
| Map prose, citation set, hierarchy, or whitespace changes | `definition_changed` for the old capture |
| Unknown/duplicate IDs, dangling or unused evidence, mixed evidence classes, invalid date | Input rejected before publication |
| Referenced entry removed from a snapshot and digests recomputed | Re-derived manifest membership still rejects the incomplete snapshot |
| Generated Markdown edited, a bundle file absent/extra, or stored digest/count invalid | Bundle/snapshot validation fails |
| Renderer, helper, npm scripts, or `.nvmrc` changed | `tooling_changed`; matching application hashes cannot mask it |
| Executable bit changes with identical bytes | File identity mismatch |
| Different clone path or a later commit with identical consumed content | Check passes without absolute-path dependency; HEAD difference is reported |
| Unreferenced unrelated source addition | Does not invalidate this scoped snapshot; no whole-repository stability claim |
| Symlink, ignored secret file, traversal, self-reference, or path outside repository | Refused; no target read/written outside the allowed boundary |
| Repository path with spaces; Markdown punctuation in prose/path | Valid relative links and escaped text |
| Input/source/HEAD changes during capture or check | Failed result; no successful capture published from detected drift |
| Existing output directory, two captures using one ID, or interrupted write | Exclusive directory creation admits one owner; existing bytes are preserved; a partial bundle cannot pass or be reused silently |
| Unsupported historical schema or malformed command | Correct closed error and exit code; no rewritten archive |
| More than 50 problems | Failed result with total count and explicit truncated diagnostics |

`test:source-map` runs `node --test --test-concurrency=1 "scripts/source-map/*.test.mjs"`. Extend the existing `test:content` command to include that same glob after `"scripts/pattern-release/*.test.mjs"`, retaining serial execution. This keeps map tooling inside the existing content lane and preserves the fourteen-lane `ci:local` summary contract. Do not add a fifteenth gate lane or change release-evidence parsing in Slice 1.

Do not run a current-map freshness check as an unconditional CI test: historical snapshots are expected to become stale as referenced source changes. CI tests the tooling with deterministic fixtures. A maintainer runs `map:check` on the selected publication candidate whenever publishing or refreshing the map; its date and source scope remain visible between refreshes.

For the documentation/comment unit, inspect the diff and compare non-trivia TypeScript token kind/text sequences before and after in the two edited files, using the installed TypeScript scanner. This proves the change is confined to comments/whitespace without creating brittle tests that require particular documentation wording. Preserve the runbook's dated evidence-ledger rows and original archive bytes. Re-run the real corpus preparation/builder in a new temporary directory outside the repository, pinning corpus release ID `pattern-ontology-source-manual-en-us-0.1.0` and `ONTOLOGY_VERSION=pattern-ontology-en-us-internal-0.1.0`. Use `computeOntologyBundleHash` from `apps/api/src/services/pattern-ontology-verify.ts` for the canonical bundle hash; require unchanged content identities and the 40/60/20 breakdown. Do not compare the builder's placeholder `bundle_hash` directly to the recorded release hash.

Before the implementation candidate is reviewed for merge, run:

```text
npm run test:source-map
npm run test:content
npm run check:pattern-source -w @patternlike/api
npm run map:capture -- <new-valid-capture-id>
npm run map:check -- docs/architecture/source-map/snapshots/<new-valid-capture-id>
npm run ci:local
```

The capture ID in this workflow is chosen once per fresh snapshot; never rerun capture against an existing destination. Retain focused results, the offline ontology receipt, the selected map-check result, and the real full-gate summary. These are different evidence types. Complete source/fingerprint work before freezing the gate candidate; re-run affected verification after a relevant change. Slice 2 must be established before the tooling merge, as required by the delivery ledger.

## 9. Acceptance and maintenance handoff

Slice 1 is locally complete only when:

- ST-01–ST-08 have current-source evidence and explicit dispositions, with no unresolved contradiction presented as current guidance.
- The archived originals match their original byte hashes, the roadmap is unchanged, and unrelated checkout work is preserved.
- The maintained definition represents the required supply, compatibility, shared-mechanics, and observability distinctions, with evidence for every leaf.
- A fresh bundle is reproducible from the documented input/commands, passes the checker against its actual source, and retains dirty/base-commit qualifications where relevant.
- The failure matrix and integrated tooling tests pass, executable comment-file tokens and ontology content remain unchanged, and the Pattern source-fingerprint check passes.
- The README identifies the maintainer responsibility, current published snapshot, refresh triggers, check scope, and release/evidence limitations.

Refresh when a cited file or map/tool input changes, a current explanation is found wrong, or a new dated observation is intentionally added. Review the source first, update prose/selectors, capture a new directory, run the check, review the generated evidence index, and then update the README link. Keep older snapshots and their dates; do not repair a historical receipt in place.

Documentation correction and tooling can be reviewed separately. Each PR states its source identity, verification, and remaining release steps; every merge follows repository policy. This specification and a successful local map check provide no authority to merge, deploy, activate ontology, or modify existing readings.

## 10. Specification verification receipt

Preparation included current-source inspection, rechecking the original map identities, and an offline corpus/builder run under Node `v22.23.2`. The run reproduced the two hashes and counts in section 2 without signing, ingestion, provider calls, or production access. The selected comment files' absence from the Pattern fingerprint manifest was checked directly.

The commands, modules, model, and snapshot format above are proposed interfaces, not an implemented tool or a passing implementation test result. Documentation links/structure and checkout preservation are checked separately when saving this specification. Application suites and `ci:local` are not claimed for this specification-only change.
