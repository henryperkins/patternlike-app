# Maintained source map

[map.json](map.json) is the sole maintained definition of the architecture map: eight branch subjects, authored claims, stable identifiers, and literal source selectors. The map maintainer owns both the meaning of each claim and its evidence choice. Generated Markdown must be reviewed, not hand-edited.

Dated publication: [September 9 map](snapshots/2026-09-09-slice-1/patternlike-source-mindmap.md), [claim/evidence index](snapshots/2026-09-09-slice-1/source-evidence.md), and [complete source identity](snapshots/2026-09-09-slice-1/source-snapshot.json). At capture, checks succeeded for eight branches, 42 topics, 97 claims, and 201 evidence selectors across 119 referenced files. The later September 9 restoration of `test:content` changed `package.json`, a captured tooling input, so this snapshot no longer matches the current checkout. The later contrast/applicability fixes also changed the builder; the maintained definition reflects 0.1.2 while this snapshot preserves the earlier 40-record mapping. Retain it as a dated reference; create a new snapshot when a refreshed map is needed. Older captures remain immutable.

This is a source architecture overview. Its identity scope is **referenced files and map inputs only**. A successful check establishes matching bytes, modes, selectors, structure, and generated output within that scope. It does not certify the whole repository, semantic completeness, editorial quality, tests, a release, production configuration, provider execution, or runner installation. The [correction record](source-corrections.md) explains the source-boundary corrections.

## Maintain and publish

Run capture and check from the repository root using the Node 22 pinned by `.nvmrc` on Linux with functioning `/proc/self/fd` directory-handle paths. The tooling uses these paths to bind I/O to validated directory handles; an unsupported environment refuses operations with `io_failed` and exit 2. This environment requirement applies to capture/check, not to archived content or shareable generated Markdown.

Optional maintainer commands (not part of the application verification gate):

```sh
npm run test:source-map
npm run map:capture -- 2026-09-09-refreshed
npm run map:check -- docs/architecture/source-map/snapshots/2026-09-09-refreshed
```

Choose a new date-prefixed capture ID for every capture. The example name above must not be reused once its directory exists. Capture creates four files in a previously absent directory and writes the snapshot receipt last. It has no overwrite or force option. If interrupted, retain the incomplete directory for inspection and use a new ID. Check is read-only and never refreshes the receipt.

Refresh when a cited file, definition, or tooling input changes; when a claim is found wrong; or when adding an intentional dated observation:

1. Inspect the owning implementation and relevant call sites. Update prose and selectors in `map.json`; retain stable IDs when meaning remains the same.
2. Use a unique, small literal selector that identifies meaningful evidence. Avoid imports as proof of execution, broad comments in place of owning logic, and line numbers as authored anchors.
3. Separate current source from recorded observations. An observation must cite its actual dated record and supported UTC timestamp. Source evidence uses a null observation date.
4. Run `test:source-map` when changing the tooling. Capture into a new directory and check that exact directory against the current checkout.
5. Review the generated claim/evidence index and the complete file identities, including dirty-source qualifications. Update the published links in this README only after that review.

Evidence paths are repository-relative regular UTF-8 files. Ignored files, symlinks, dependencies, build output, local environment/secret files, `output/`, and this maintained map directory are excluded as evidence targets. All evidence entries must be used; each claim must cite evidence of one class. Counts are derived from the input, not a coverage target.

## Read a check result

Exit 0 means a completed capture or a verified scoped check. Exit 1 means invalid data or failed identity/structure checks; exit 2 means invocation, environment, unsafe-path, or output failure. Results contain bounded problem codes and repository-relative coordinates, never source excerpts.

`source_changed` reports referenced byte or executable-mode drift even when the meaning appears unchanged. `anchor_missing` and `anchor_ambiguous` require source review and a new selector; they never fall back to an old line number. `definition_changed`, `tooling_changed`, or `bundle_changed` identify different input/output boundaries. Detected concurrent drift also fails. Correct current inputs and capture a new snapshot instead of editing an old receipt to make it pass.

The receipt records the actual base commit, branch, and dirty paths within consumed inputs. A base-commit mismatch is informational if all consumed bytes still match. An unchanged HEAD does not hide dirty-source drift, and a hash of dirty bytes does not prove those bytes belonged to the recorded commit. Unrelated repository changes are outside the check scope. The definition and complete fixed tooling inputs are included alongside referenced files; hashes establish identity, not authorship or interpretation quality.

The selected snapshot is intentionally a dated publication. Map capture/check and `test:source-map` are optional maintenance commands; `test:content` and existing gates do not run them. Product work does not depend on refreshing the map. Follow the existing [repository merge policy](../../../AGENTS.md) when undertaking a merge. A map check supplies no authority to merge, deploy, sign, ingest, activate ontology, evaluate providers, or alter saved readings.

## Historical archives and provenance

All five files below were copied byte-for-byte before adaptation. Their links, newline bytes, dates, original absolute checkout paths, and historical renderer flags remain unchanged. Original files under `output/mindmaps/` remain untouched. The alignment roadmap is maintained separately. SHA-256 values hash original bytes; each archive was directly compared to its original after copying.

The September 7 generation records baseline `6e706741f03253f2807d33380afb529161f3481f` plus local Observatory edits. That commit alone does not include those edits. Its original receipt references 86 source files, eight branches, 34 topics, and 68 leaves. Historical absolute links may not resolve in another checkout, and file hashes cannot reconstruct the uncommitted source bytes. Stored renderer or verification flags remain historical assertions, not fresh executions by this maintenance tooling.

The September 9 corrected generation has eight branches, 38 topics, 83 claim bullets, and 129 file-and-line anchors across 100 files. It has no explicit original source baseline or complete source-hash manifest. The later review baseline `d338b86c9444ebe2f372f2a2f3990f4a1270bc80` is review metadata, not an invented original capture identity. The earlier 86-file receipt does not authenticate the corrected map. Neither historical generation has been converted into the new snapshot schema.

The maintained map was reconciled in the isolated Slice 1 checkout based on `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`, including carried Observatory source and the scoped documentation/comment corrections. The published snapshot records the actual consumed source identities and dirty qualifications. The one September 6 pointer observation remains explicitly dated and separate from current source claims; its active-pointer join is not a current signature check or a complete machine-evidence census.

| Original repository path | Preserved archive | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `output/mindmaps/2026-09-07-184743/patternlike-source-mindmap.md` | [patternlike-source-mindmap.md](archive/2026-09-07-184743/patternlike-source-mindmap.md) | 11778 | `a6f49b58777a4e43e29fd13778f33c03f50dec23b7cbc1dcccf2fa7f666ca2e3` |
| `output/mindmaps/2026-09-07-184743/source-evidence.md` | [source-evidence.md](archive/2026-09-07-184743/source-evidence.md) | 17032 | `bd8babe923cc9630fd61b41d52b76f06e497d0cdc5027d24fc990d3e4e3cec00` |
| `output/mindmaps/2026-09-07-184743/source-snapshot.json` | [source-snapshot.json](archive/2026-09-07-184743/source-snapshot.json) | 21695 | `a54b6367b014389c5036584950feb6455f2b8697d5f4af0fbfdbda306d71ec3a` |
| `output/mindmaps/2026-09-09-corrected/patternlike-source-mindmap.md` | [patternlike-source-mindmap.md](archive/2026-09-09-corrected/patternlike-source-mindmap.md) | 15585 | `b09bc6e9275e5e530423f76ebbbc1b80447bb9e71356bf39214c6d91f9d74e9e` |
| `output/mindmaps/2026-09-09-corrected/patternlike-source-mindmap.with-anchors.md` | [patternlike-source-mindmap.with-anchors.md](archive/2026-09-09-corrected/patternlike-source-mindmap.with-anchors.md) | 22084 | `05fca0beb6314ce2d0889f4a229c1d48221bde58de0e4965c895355fd8c3606a` |
