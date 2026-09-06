# Review claim follow-up implementation

Design: [approved contracts](../specs/2026-09-06-review-claims-followup-design.md).
All work is in `codex/claim-publication-assurance`, preserving its first pass.

- [x] Correct `SignedOut`, Daily/Pattern consent and checking-state copy. Verify
      application retention against maintenance code and render the changed views.
- [x] Add attributable, hash-bound corpus review packet/record tooling and tests;
      keep the incomplete historical provenance immutable and explicitly open.
- [x] Add the Pattern generation pause across admission, execution, provider work,
      publication and retry/resume, with focused lifecycle and preservation tests.
- [x] Make requested versus observed image model identity explicit from runner
      completion through stored provenance and downloads, retaining legacy reads.
- [x] Route ordinary text stages through verified isolated Codex JSON turns, with
      hostile-host, tool, auth, timeout, output-limit and cleanup regressions.
- [x] Add fresh-output evaluation tooling with source-bound real invocations,
      deterministic result records and a separate independent review boundary.
- [x] Add release/evidence reconciliation tooling and a concrete lifecycle protocol;
      refuse to close missing deployed/account observations or human review.
- [x] Review the combined implementation and run affected tests, source fingerprint
      generation, type checks and relevant rendered UI verification.
- [x] Finish verification of the actual problem areas and record the exact source,
      focused results and remaining external evidence in a self-contained report.
      User explicitly stopped the aggregate gate; preserve incomplete/failed
      receipts and do not claim a passing final full gate.

Independent implementation domains may use isolated agent tasks: Pattern pause,
image identity, and copy/corpus review. Root owns text isolation, evaluation,
release reconciliation, shared integration and aggregate verification. Agents
must coordinate before touching files owned by another domain.
