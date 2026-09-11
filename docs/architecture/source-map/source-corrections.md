# Source explanation corrections

Review date: 2026-09-09. Scope: source comments/guidance and maintained-map explanations only. No application behavior, ontology content, provider configuration, saved readings, or Observatory behavior changes are authorized by this record. Source identities establish the referenced files and map inputs only; they do not certify the repository, editorial quality, release execution, or production.

Pre-edit Git baseline: `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`. The worktree also carries prior documentation edits; this baseline alone does not represent their bytes. Pre-edit SHA-256 values for the four tracked targets:

| Path | SHA-256 |
| --- | --- |
| `apps/api/scripts/build-internal-ontology.ts` | `dc4e975cc3aaa6295dc8ed5b3cf4f55ecf30d31e06632f2202a6e401f969d959` |
| `apps/api/src/services/ontology-signing-client.ts` | `44b43c96cbc18a219208426aa37eb623eca39f86c4131c353cb9bab5f473f637` |
| `docs/deploy/openai-pattern-rollout.md` | `fe0dd5a5952197d4751fafbac02e5d1f3ac33e24f67b06145713d6e547ff46fa` |
| `CLAUDE.md` | `b2431d360cd28750e95c56c9735d374ab92eabd396d30764da1c4cc8717d9925` |

## Dispositions

Each source entry is a local source inspection dated September 9 unless the verification column explicitly identifies a recorded observation. Source links name owning files and the adjacent text names the symbol/section anchor. Historical interpretations retained in the runbook are expressly superseded; raw ledger rows and dated observations are unchanged.

| ID | Disposition (2026-09-09) | Replacement meaning | Evidence / anchor | Verification |
| --- | --- | --- | --- | --- |
| ST-01 | Corrected | Unsigned offline candidate; twelve §2 and eight §8 omissions; individually classified historical failures. | [apps/api/scripts/build-internal-ontology.ts](../../../apps/api/scripts/build-internal-ontology.ts): `predicateFor; opening comment` | Comment-token comparison; real corpus preparation/build |
| ST-02 | Corrected | Compilation runs; evaluator/unevaluated compatibility fields do not prove evaluation or coverage; no regression rehearsal. Sentence matching/fallback does not adjudicate prose. | [apps/api/scripts/build-internal-ontology.ts](../../../apps/api/scripts/build-internal-ontology.ts): `evaluation; tensionsFor; counterExpressionsFor` | Comment-token comparison; unchanged canonical bundle hash |
| ST-03 | Corrected | Internal signing returns a signature without ingestion/activation; admitted internal origin can serve eligible readers. Machine signing stays separate; signatures do not certify quality. | [apps/api/src/services/ontology-signing-client.ts](../../../apps/api/src/services/ontology-signing-client.ts): `signInternalOntology; signOntologyCandidate` | Comment-token comparison; inspected ontologyServesAccount |
| ST-04 | Corrected | Runbook admission table separates absent/unusable release, admitted internal origin, and both machine scope outcomes; remaining eligibility/pause/claim gates remain. | [apps/api/src/db/pattern-ontology.ts](../../../apps/api/src/db/pattern-ontology.ts): `ontologyServesAccount` | Owning-source review and corrected runbook table |
| ST-05 | Corrected | Failures classified individually. August 25 cursor 95 means 96 calls across thirty fixtures, not 95 completed fixtures. Closure rules and named failure events exist; historical diagnosis remains a Slice 13 lead. Reader publication safety differs from whole-corpus evaluation. | [apps/api/src/services/pattern-publication-proof.ts](../../../apps/api/src/services/pattern-publication-proof.ts): `evaluatePatternPublicationSafety` | Reviewed proof, pattern-prompt.ts PLAN_CLOSURE_RULES, ontology-pipeline-execute.ts failRegression, and preserved ledger |
| ST-06 | Corrected | September 6 pointer/hash observation is dated and scoped to the active-pointer join. Historical observations stay dated; obsolete cohort transitions do not supply lifecycle evidence. Older steps explicitly require reconciliation. | [docs/reviews/artifacts/2026-09-06-source-register-followup/production-observation.json](../../../docs/reviews/artifacts/2026-09-06-source-register-followup/production-observation.json): `database.observed_at; database.sets[1]` | Recorded observation at 2026-09-06T18:49:35.205Z; ledger/raw-observation byte comparison; no live query |
| ST-07 | Corrected | CLAUDE guidance reflects offline supply, admission, omissions, safety and signing distinctions; thirty frozen fixtures and eleven-call ceiling retained. Unverified minimum-seven claim removed; provider history and Codex declaration retained. | [CLAUDE.md](../../../CLAUDE.md): `AI Pattern generation (M7); isolated signing` | Scoped diff review; no fixture, provider or model changes |
| ST-08 | Corrected in authored map; capture/check separate | Separate offline supply, parked producer, shared Codex mechanics, Daily V1/V2 compatibility, and literal observability/release identity limits; use owning selectors. | [apps/api/src/services/generate-daily-reading.ts](../../../apps/api/src/services/generate-daily-reading.ts): `generateDailyReading` | Task 3 authored-map review confirmed; [map.json](map.json) topic IDs: `topic-offline-ontology-supply`, `topic-parked-machine-ontology-producer`, `topic-publication-and-historical-compatibility`, `topic-shared-codex-exchange-mechanics`, `topic-observability-and-release-identity`, `topic-select-chart-evidence`, `topic-plan-write-and-verify`. Root owns final snapshot check. |
| ST-09 | Corrected in authored map; capture/check separate | Health/meta bypass configGuard; sessions are guarded; deletion status uses its own receipt cookie after session revocation. Credential zones remain separate. | [apps/api/src/index.ts](../../../apps/api/src/index.ts): `route registrations` | Task 3 authored-map review confirmed; [map.json](map.json) topic IDs: `topic-route-authority-zones`. Root owns final snapshot check. |
| ST-10 | Corrected in authored map; capture/check separate | Canary network reads and optional authenticated POST place search that can exercise geocoding, fresh evaluation Codex execution, preparation modes, local-gate evidence, and offline supplied-record reconciliation have distinct effects. | [scripts/pattern-release/operational-canary.mjs](../../../scripts/pattern-release/operational-canary.mjs): `operational canary entrypoint` | Task 3 authored-map review confirmed; [map.json](map.json) topic IDs: `topic-release-assurance-tooling`. Root owns final snapshot check. |
| ST-11 | Corrected in authored map; capture/check separate | revision_reason expresses purpose; scheduler may reserve defect_repair and retries preserve it. Internal reissue and frozen provenance remain visible. | [apps/api/src/services/reading-invalidation.ts](../../../apps/api/src/services/reading-invalidation.ts): `defect_repair` | Task 3 authored-map review confirmed; [map.json](map.json) topic IDs: `topic-operator-generation-and-repair`. Root owns final snapshot check. |
| ST-12 | Corrected in authored map; capture/check separate | Chart-bound portrait automation grant, publication outbox, withdrawal cancellation and runner lanes already exist. Three-to-six reading stations differ from four-chapter artwork eligibility. | [apps/web/src/components/PrivacyView.tsx](../../../apps/web/src/components/PrivacyView.tsx): `portrait automation grant` | Task 3 authored-map review confirmed; [map.json](map.json) topic IDs: `topic-portrait-automation-permissions`, `topic-interactive-observatory`, `topic-images-derived-from-chapters`. Root owns final snapshot check. |

## Offline content verification

On 2026-09-09, Node `v22.23.2` ran the real corpus preparation and internal builder in a fresh temporary directory outside the checkout. Pins were corpus release `pattern-ontology-source-manual-en-us-0.1.0` and `ONTOLOGY_VERSION=pattern-ontology-en-us-internal-0.1.0`.

- Prepared fragments: **60**; emitted records: **40**; omitted fragments: **20** (twelve §2 and eight §8).
- Corpus hash: `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`.
- Canonical unsigned bundle hash, recomputed using [computeOntologyBundleHash](../../../apps/api/src/services/pattern-ontology-verify.ts): `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84`.

These match the dated September 6 observation's identities; the builder's zero placeholder bundle_hash was not treated as the canonical hash. No provider, signing, ingestion, activation, or production request ran.

The installed TypeScript scanner, guided by parser token boundaries for regular expressions and template literals, compared non-trivia kind/text sequences against the baseline: **1,135 builder tokens** and **961 signing-client tokens**, unchanged. Both files are absent from [the Pattern source manifest](../../../apps/api/pattern-creation-sources.json). The runbook evidence ledger and August 27 raw observation were compared byte-for-byte with the baseline and remain unchanged. These focused checks do not substitute for the separate full local merge gate.

## Historical narrative preservation follow-up

Integration review on 2026-09-09 found that the opening correction had removed
the original explicitly dated August 27 superseding-decision narrative. It is
now restored verbatim under the runbook's
[superseded historical heading](../../deploy/openai-pattern-rollout.md#superseded-historical-decision-2026-08-27),
with a link back to the September 9 current explanation. Its incorrect blanket
regression, reader-safety, and gate-closure interpretations are marked as
superseded outside the retained bytes. The original two-paragraph decision block,
evidence ledger, and raw August 27 observation were compared byte-for-byte
against the recorded Git baseline. The corrected current opening and admission
table remain intact. This follow-up changes documentation only.
