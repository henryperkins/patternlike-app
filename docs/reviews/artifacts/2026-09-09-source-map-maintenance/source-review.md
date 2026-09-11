# Slice 1 integration/source review

Reviewed 2026-09-09 in `/home/henry/patternlike-app-source-map` against the source-truth design, executed implementation plan, integration-review.diff, and Task 1–3 reports. Read-only source review; this report is the only write. No tests, provider calls, production observations, commits, or application edits were performed by this reviewer.

## Verdicts

- **Spec compliance: changes requested.** One material historical-preservation omission remains below. The authored map implements ST-08–ST-12 and the current source explanations implement ST-01–ST-07; final snapshot publication and gate evidence remain root integration work.
- **Quality: acceptable after the preservation fix**, with one optional evidence improvement. No substantive false current-source claim or application-semantic change was identified in the reviewed scope. Tooling correctness is assigned to the separate tooling reviewer and is not approved by this report.

## Findings

### P2 — Preserve the removed explicitly dated August 27 interpretation

Location: `docs/deploy/openai-pattern-rollout.md:5` (replacement opening review; deleted baseline block starts at `HEAD:docs/deploy/openai-pattern-rollout.md:20`).

The new current-source explanation deletes the original **Superseding decision (2026-08-27)** block, including its conclusions that every candidate entered regression, safety gates ran nowhere else in the product, and Gates 8/10 were closed as inapplicable. These are precisely the historical interpretations being corrected. The raw ledger and separate August 27 production observation are preserved, but neither retains this distinct dated decision narrative.

Spec section 3 explicitly requires: “Where an older narrative conclusion contradicts current source, retain it as an explicitly superseded historical interpretation and put the corrected current explanation outside that record.” Deleting the block loses the in-document provenance for the correction, even though Git retains an older version.

**Action:** retain the original dated block verbatim in a clearly marked superseded-history section (with its original date), and link readers to the September 9 current-source correction. Keep the corrected opening and the raw historical ledger unchanged. Update the preservation report to cover this block as well.

### P3 — Cite the owning record for the open shared-package licensing decision (optional)

Location: `docs/architecture/source-map/map.json:1143`, `leaf-pure-engines-and-licensing-boundary-2`.

The claim is supported by repository records, but its attached evidence consists of engine purity comments and package license declarations. `UNLICENSED` alone does not establish that a licensing-boundary decision is pending. The explicit open decision is in `docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md:126` (“Decide terms for packages/shared”), with rationale in `LICENSING.md:30` onward.

**Action:** add a unique selector into one of those owning records to this leaf. This is an evidence-precision improvement, not a finding that the underlying claim is false or a request to change licensing.

## Reviewed integration and evidence boundaries

- Inspected all maintained-map claim text and evidence selectors; targeted owning-source reads confirmed the high-risk routing, ontology-admission, publication-safety, automation withdrawal, and runner-scheduling distinctions. Selection/plan validation now cite owning functions and executor call sites instead of imports. The proof module also actually calls publication safety, beyond importing it.
- The map separates offline ontology supply from the parked machine producer, shared Codex transport from domain ownership, and Daily V1/V2 frozen dispatch. Its configuration and health/meta statements limit themselves to committed settings, liveness, and configured identities.
- The one recorded observation cites the September 6 database record with its matching timestamp and active-pointer/hash scope; no current signature, complete evidence census, activation, provider result, or installed runner adoption is inferred.
- Source changes in the two TypeScript files are comments only on the inspected diff. Task 1 reports unchanged executable token streams, unchanged canonical builder output, and exclusion from the Pattern source manifest. No runtime, ontology, fixture, provider, or Observatory implementation changes are introduced by these corrections.
- Runbook admission distinguishes absent/unusable ontology, internal-origin admission, and machine public-scope outcomes. Remaining account/chart/locale/consent/pause/claim gates and the thirty-fixture/eleven-call boundaries remain visible. Historical raw ledger and August 27 observation preservation are supported by the inspected diff and Task 1 byte-comparison report; the omitted dated interpretation is the exception above.
- README records all five archive identities, original paths, historic absolute-link limitations, the original uncommitted Observatory qualification, and the corrected map’s missing capture identity. Task 3 reports byte-identical copies and selector/path checks; these completed checks were not repeated without suspicion.
- The authored input and README use the implemented npm capture/check interface and distinguish scoped identity from semantic/release certification. The maintained map’s 8 branches, 42 topics, 97 leaves, 199 evidence entries and 117 referenced files are handoff counts, not coverage guarantees. Generated snapshot review and publication links remain pending root capture; their absence at this review stage is not an implementation defect.
- The existing eight carried roadmap/spec edits are reviewed inputs, outside new Slice 1 implementation. Slice 2 remains an implementation plan only, with no merge or deployment authorization implied.

## Final integration limitations

Root is still resolving separate tooling findings before capture and the final local gate. This report does not claim a passing final snapshot check, complete local merge gate, approved merge, or deployed release. Re-review the corrected historical block and any materially changed map input, then attach actual final snapshot/gate evidence separately.
