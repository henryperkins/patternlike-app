# Reader feedback and approved follow-up

Date: 2026-09-09. Authorization: “Approved next steps.”

Implement the approved [Slice 5 design](../specs/2026-09-08-reader-relationships-feedback-design.md), release the completed Slice 4 separately, and close the remaining review work where evidence permits. Preserve the existing verification commands and frozen contracts.

1. Place existing optional feedback on Today alongside the independent check-in. Preserve exact-edition receipts, existing grant behavior, and History compatibility. Explain recording separately from possible later use.
2. Add categorical options and explicit submission with the approved edition and grant preconditions. Store encrypted events independently of resonance; preserve completed idempotent replay after revocation and prevent stale forms from renewing permission.
3. Apply the existing USR-12 storage limit of 24 calendar months to the new event, note, and encrypted mutation copy. Delete expired records through bounded existing privacy maintenance. Seven-day effect expiry remains separate. Register export, account deletion, key rotation, and restore replay before release.
4. Add closed, versioned category signals with no raw note input, evidence-derived targets, permission checks, deterministic bounds, and fixed expiry. Keep new semantics behind their explicit policy and compatible producer switch; old command pins retain their behavior.
5. Add category controls and birth-correction navigation with accurate permission, retention, and lifecycle explanations. Verify Today/History receipts and separate check-in behavior using existing affected suites and rendered checks.
6. Prepare Slice 4 on a separate release branch. Verify the concrete release, apply migration 0030 before the compatible deployment, and inspect the deployed application. Existing repository merge verification applies to an actual merge; local Slice 5 development does not add or run a new gate.
7. Diagnose retained Slice 3 prose failures without new provider calls or ontology activation. Preserve the original evidence. Credit Slice 6 navigation delivered by Slice 4, and prepare the remaining human quality/comprehension exercise without inventing participant results.

## Decisions

- Retention follows the existing registry's USR-12 limit; no aggregate retention or new policy extension is introduced. A revoked grant stops future eligibility but is not an erasure request.
- Categorical storage, interface availability, compiler activation, and measured reader benefit are separate states. Existing resonance remains compatible throughout.
- A successor `account-export-feedback/v1` carries categorical feedback and notes when readings are included. Queued 0.7.0 and 0.8.0 export commands retain their original shapes.
- Source-map maintenance, ontology candidates, and new categorical work are excluded from the separate Slice 4 release.

## Execution

Slice 5A and 5B software is implemented and verified locally in `codex/source-map-maintenance`. Slice 4 was released separately in [PR 52](https://github.com/henryperkins/patternlike-app/pull/52); migration 0030 preceded the merge, and the [release record](2026-09-09-reader-journey-production-implementation.md#authorized-separate-release--2026-09-09) records the successful build and observed runtime SHA/version. Production migration history ends at 0030. Migration 0031, the new categorical interface/API and new compiler have not been deployed.

### Implemented behavior

- Today offers optional feedback alongside its independent check-in. History reloads the exact edition’s receipt. Copy distinguishes 24-hour check-in freshness, up to 13 months of check-in storage, feedback retention, permission and possible later selection.
- Additive feedback options and event routes bind the actual stored revision/hash/paragraph. Submission uses an explicit grant-state precondition and idempotency key. Active grants are reused, renewal is explained, and stale forms cannot renew permission. Concurrent identical retries return the original receipt, including after revocation; changed payloads conflict.
- Migration 0031 stores each encrypted event, optional note and replay payload in one owner-scoped row. Retention is 24 calendar months, with leap-day handling. Existing bounded privacy maintenance removes expired rows; export, account/document erasure, key rotation and restore replay include the new storage. The successor account export preserves queued M7/M8 formats.
- Selection 1.2.0 pairs with prompt 1.0.4. `CATEGORIZED_FEEDBACK_EFFECTS_ENABLED` defaults off; enabling it requires the matching prompt configuration. Existing commands retain selection 1.1.0 / prompt 1.0.3 behavior. New signals contain closed categories and supported targets, with private edition coordinates replaced by a packet-local reference before provider submission. Notes and copied readings are excluded.
- Repetition has a fixed seven-day eligibility window. `unclear` is recorded without a generation effect. Current V5 evidence does not carry supported theme associations, so `not_relevant_today` is also recorded without a ranking effect. The compiler does not infer themes from notes or prose. Permission, exact source identity and expiry are rechecked at execution, runner admission and atomic publication. Admitted input is not a claim of actual output influence.
- “My birth details are wrong” opens the existing correction flow and its consequences without creating an event, grant or correction merely by navigating. Existing resonance remains compatible when categorical options are unavailable.

### Verification

Node 22.23.2 was used. Existing affected commands passed; no gate or mandatory tooling was added. The full local gate was used only for the separate Slice 4 merge, as required by the existing repository policy.

| Check | Final observed result |
| --- | --- |
| Shared, reading-engine, API and web typechecks | Passed; API typecheck also passed after the final retry-race fix |
| API lifecycle, compiler, command/prompt ownership and Pattern safety suites | 20 files, 331 tests passed |
| Categorical events, existing resonance and account export integration | 3 files, 62 tests passed after the race fix |
| Web feedback, connections, check-in, History and App | Seven files, 96 tests passed |
| Today integration | 59 tests passed after updating two obsolete expectations; one feedback prompt and a separate check-in are positively asserted |
| Reading-engine constrained input | 34 tests passed, including unchanged factual selection and private target projection |
| Existing contract package validator | All packages passed, including the additive category/export schemas and rejection fixtures |
| Existing D1 smoke check | All 31 migrations apply; foreign-key and integrity checks pass |
| Desktop/mobile rendered feedback and correction flow | [Retained browser evidence](../../reviews/artifacts/reader-feedback/2026-09-09-implementation/README.md), with fixture scope and accessibility limits stated |

The API commands, run from `apps/api`, were:

```sh
npx vitest run src/services/privacy-maintenance.test.ts src/db/encrypted-columns.test.ts src/services/deletion-manifest.test.ts src/routes/privacy-deletion.integration.test.ts src/routes/internal-pattern-replay.integration.test.ts src/services/reading-feedback-policy.test.ts src/services/reading-feedback-compiler.test.ts src/services/reading-feedback-admission.test.ts src/services/context-compiler.test.ts src/services/generation-command-v2.test.ts src/services/generate-daily-reading-v5.test.ts src/services/reading-publisher.test.ts src/services/reading-prompt.test.ts src/services/reading-current-owner.test.ts src/services/codex-reading-publisher.test.ts src/services/codex-provider-domain.test.ts src/services/pattern-publication-safety.test.ts src/services/pattern-publication-safety.integration.test.ts src/services/pattern-publication-proof.test.ts src/services/pattern-lifecycle.test.ts
npx vitest run src/routes/feedback-events.integration.test.ts src/routes/feedback.integration.test.ts src/routes/privacy-export.integration.test.ts
```

Web commands and browser scripts are retained with the browser evidence. The final Today command was `npm test --workspace @patternlike/web -- src/components/TodayView.test.tsx`. The combined eight-file run initially passed 153/155; its two old assertions expected “Held until” and the absence of Today feedback. The corrected 59-test Today run passed without changing application behavior. These runs cover 155 distinct web tests, not 155 additional tests beyond the earlier 96.

Independent review found and resolved a current-grant expiry/policy check and the overlapping first-submission retry race. Real encrypted D1 regressions cover the identified failure paths and atomic publication races. Final review found no remaining concrete blocker in the reviewed authorization, encryption, retention, replay and publication boundaries. This is local software evidence, not production category adoption or a reader-benefit result.

### Remaining evidence and release boundaries

The [retained Slice 3 prose diagnosis](../../reviews/artifacts/interpretation-quality/2026-09-09-retained-prose-diagnosis/README.md) is complete locally: the 245-word chapter remains a correct rejection; a narrow lexical false positive is fixed under safety policy 1.0.1. All 22 original comparison artifacts remain unchanged. This follow-up made no provider call and activated no ontology candidate. That fix was excluded from Slice 4’s deployment.

Slice 6 receives credit for Slice 4’s exact-chapter entry/return, tested 3/4/5/6 component behavior, complete text and a rendered desktop/mobile journey. Its wider rendered chapter-count/recovery matrix and conditional artwork expansion remain open; the artwork extension has not been selected.

The [human-review worksheet](../../reviews/artifacts/reader-feedback/2026-09-09-implementation/human-review-worksheet.md) is prepared and unfilled. A signed-in production navigation check was requested; none has been observed yet. Editorial adjudication, consented comprehension results and measured feedback effects remain open. No participant results or improved quality claims are inferred from automated checks.

For a later Slice 5 rollout, apply migration 0031 before compatible Worker/client deployment and retain the default-off compiler until its paired configuration is deliberately activated. This plan adds no release prerequisite beyond the existing repository procedure. Slices 7/8 and ontology activation were not started.

## Integration follow-up — 2026-09-11

Recovered onto main `69a4f78` without replacing its ReadingConnections component, tests or stylesheet. Corrected categorical selection to inspect up to 100 SQL-matching candidates before target/category/grant rejection; the existing shared 20-record feedback admission cap remains downstream. Six real encrypted D1 regressions cover starvation, deterministic ties and legacy compatibility. The affected API set passed 179 tests and the combined web feedback/journey set passed 163 tests. The desktop/mobile real-App fixture walkthrough passed receipt/History, independent check-in, correction/Back, overflow and scoped accessibility checks without application errors. These results describe local software, not production category effects.

The remote migration ledger was read on September 11 and still ended at 0030. The integration release must apply the additive 0031 migration before compatible code. New categorical effects remain default-off. The user selected independent AI editorial reviews and simulated comprehension; the historical human worksheet remains unfilled. The current [integration plan](2026-09-11-roadmap-integration.md) and its PR carry subsequent outcomes.
