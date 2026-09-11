# Offline chart-selection panel

Date: 2026-09-09. Assessment assistance: Codex. Human editorial reviewer: unassigned; adjudication pending.

All twelve fictional cases were re-derived and selected against the actual forty-record internal ontology. Every fixture file matched its manifest hash, and every regenerated feature array and feature-set hash matched the stored fixture. Selection produced packets for all twelve cases, with no unsupported feature, capacity omission, or refusal. Those results establish deterministic input/selection agreement; they do not establish calculation accuracy, semantic support, prose quality, or reader benefit.

The panel exposes two useful product findings before any provider call: distinct pattern types receive the same four broad meanings, and sparse/location uncertainty meanings are included even for dense exact-time cases. The fixture labels also overstate what this particular panel exercises against the current ontology: its authored conflict and unsupported-gap cases do not carry those conditions into this assessment.

## Inputs and method

The [observed data](chart-panel.json) retains each input path and raw hash, canonical chart hash, chart fingerprint, regenerated features, selection packet, alias map, accounting manifest, selected meaning IDs, source-fragment mappings, and policy identities. It is a dated data attachment, with no new report schema, command, test lane, or gate.

| Identity | Observed value |
| --- | --- |
| Source revision | `d338b86c9444ebe2f372f2a2f3990f4a1270bc80` with the documented Slice 1 comment/documentation edits and this assessment |
| Existing Pattern creation fingerprint, independently recomputed | `sha256:b1c8ff83924dfc7010c86fcfba37e2bb0f2eb09c0022dd5ee5169dfbc3fdce39`; generated module current |
| Prepared corpus | `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c` |
| Internal ontology version | `pattern-ontology-en-us-internal-0.1.0` |
| Canonical ontology signing-payload hash | `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84` |
| Fixture corpus identity | `sha256:5b73be13623882f0e1143d5ec38b2bd650355ac87b55b3b42ee2489d224299b4` |
| Feature policy | `natal-feature-policy` / `1.0.0` |
| Selection policy | `pattern-selection-policy` / `1.0.0` |
| Validation policy | `pattern-validation-policy` / `1.0.0` |
| Publication-safety version recorded for later comparisons | `1.0.0`; selection alone does not exercise it |
| Provider/model/prompt/transport | Not applicable: no provider generation performed |

Existing corpus preparation and the [internal builder](../../../../../apps/api/scripts/build-internal-ontology.ts) produced the 60-fragment/40-record candidate. Its placeholder `bundle_hash` was replaced only in the scratch working object using [computeOntologyBundleHash](../../../../../apps/api/src/services/pattern-ontology-verify.ts), and `compileOntologyRelease` succeeded. This is an unsigned offline candidate; no release was signed, activated, or observed in production.

For each selected fixture in the [frozen thirty-case manifest](../../../../../contracts/m7/fixtures/corpus/manifest.json), [deriveNatalFeatureSet](../../../../../apps/api/src/services/natal-features.ts) consumed its `chart_snapshot`, uncertainty, chart fingerprint, and effective accuracy. Canonical regenerated feature arrays and hashes were compared with the fixture's stored deterministic features. [selectPatternEvidence](../../../../../packages/pattern-engine/src/selection.ts) then consumed those regenerated features and the forty actual internal records. The fixture's embedded ontology, writer output, and declared chain outcome were excluded.

Execution used Node `22.23.2` and the existing `tsx` runtime in ignored scratch. No calculation service or external provider ran. The [fixture authoring code](../../../../../apps/api/scripts/author-ontology-regression-corpus.ts) creates synthetic positions, aspects, and a fake calculation-container identity. In particular, re-deriving features reads the authored aspect/pattern claims; it does not calculate them from longitudes. These fixtures are suitable for software and evidence-routing comparisons, not independent astronomy verification or a study of real readers.

## Twelve case outcomes

`S` below means the shared sparse source set: Sun, Moon, Mercury (§1.1–§1.3), Square (§4.3), Sparse feature set and Qualified location (§7.3–§7.4). `D` means bodies Sun through Saturn (§1.1–§1.7), all five aspect types (§4.1–§4.5), and §7.3–§7.4. `H` adds twelve houses (§3.1–§3.12) and Ascendant/Midheaven (§5.1–§5.2). `P` adds all four admitted pattern records (§6.2–§6.5). `A` and `U` add approximate-time (§7.2) and unknown-time (§7.1) meanings respectively. Every section abbreviation resolves to an exact record ID and source-fragment ID in `record_register` in the attachment; each case separately lists its selected IDs and feature-to-record bindings.

| Case | Feature count = packet count | Distinct records | Selected source set | Selection mode | Case status | Generated prose |
| --- | ---: | ---: | --- | --- | --- | --- |
| exact-01 | 5 | 6 | S | Sparse | `selected` | No compatible sample bound |
| exact-02 | 27 | 28 | D + H | Standard | `selected` | No compatible sample bound |
| exact-05 | 5 | 6 | S | Sparse | `selected` | No compatible sample bound |
| exact-06 | 29 | 32 | D + H + P | Standard | `selected` | No compatible sample bound |
| approximate-01 | 5 | 7 | S + A | Sparse | `selected` | No compatible sample bound |
| approximate-02 | 27 | 29 | D + H + A | Standard | `selected` | No compatible sample bound |
| approximate-05 | 5 | 7 | S + A | Sparse | `selected` | No compatible sample bound |
| approximate-06 | 29 | 33 | D + H + P + A | Standard | `selected` | No compatible sample bound |
| unknown-01 | 5 | 7 | S + U | Sparse | `selected` | No compatible sample bound |
| unknown-02 | 13 | 15 | D + U | Standard | `selected` | No compatible sample bound |
| unknown-05 | 5 | 7 | S + U | Sparse | `selected` | No compatible sample bound |
| unknown-06 | 15 | 19 | D + P + U | Standard | `selected` | No compatible sample bound |

No case is recorded as `output_available`, `generation_failed`, or `omitted_by_policy`: every case selected evidence, and no assessed provider generation was attempted. Missing prose has no numeric quality score. A compatible retained-output audit may supply a separately identified sample later; historical prose cannot inherit current input pins by assumption.

## Actual contrasts and uncertainty

All three accuracy groups use the same authored position longitudes within a suffix; they remain distinct chart IDs, not controlled birth-time perturbations of one person. Sparse cases have Sun/Moon/Mercury plus Sun–Moon square (orb 2.1°) and uncertainty. Dense cases add Venus/Mars/Jupiter/Saturn plus Sun–Mercury conjunction (1.4°), Moon–Venus trine (3.2°), Mars–Jupiter opposition (4.1°), and Jupiter–Saturn sextile (2.7°).

| Suffix | Selected position longitudes in body order Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn | Additional pattern features |
| --- | --- | --- |
| 01 | 19.5°, 62.5°, 105.5°; remaining bodies absent | None |
| 02 | 22°, 65°, 108°, 151°, 194°, 237°, 280° | None |
| 05 | 29.5°, 72.5°, 115.5°; remaining bodies absent | None |
| 06 | 32°, 75°, 118°, 161°, 204°, 247°, 290° | `grand_trine` of Jupiter/Moon/Sun; `aspect_chain` of Mars/Mercury/Moon/Sun |

Exact and approximate dense cases also include house cusps 5°, 35°, 65°, 95°, 125°, 155°, 185°, 215°, 245°, 275°, 305°, and 335°; Ascendant 5° and Midheaven 275°; and position house labels 1–7 in that body order. These are authored fixture values, not a fresh calculation. All sparse cases and all unknown-time cases have null position houses and no selected house-cusp/angle features.

| Comparison | Distinguishing admitted features | Quality condition actually available |
| --- | --- | --- |
| exact-01 → exact-02 | Four additional bodies, four additional aspects, twelve house cusps, two angles; Sun/Moon/Mercury longitudes each move +2.5° | Strong sparse/dense evidence contrast; source-backed prose comparison remains missing |
| approximate-01 → approximate-02 | Same added features; both retain the approximate-time uncertainty meaning | Sparse/dense contrast with the same uncertainty class; no accuracy improvement claim |
| unknown-01 → unknown-02 | Four additional bodies and four additional aspects; houses/angles remain absent | Sparse/dense contrast that must remain useful without houses/angles |
| exact-05 → exact-06 | Dense-case additions plus two patterns; Sun crosses Aries→Taurus | Different evidence is present, but the fixture's original conflict/gap outcomes do not transfer |
| approximate-05 → approximate-06 | Same additions plus approximate-time meaning in both | Same conflict/gap limitation, with explicit approximate-time restrictions |
| unknown-05 → unknown-06 | Four bodies, four aspects, and two patterns added; houses/angles remain absent | Same conflict/gap limitation without houses/angles |

The four exact cases carry no suppressed classes. Every approximate case carries `angle_transits` and `moon_time_sensitive`; every unknown case carries those plus `angles` and `houses`. The packet preserves those lists exactly. An absent suppressed class is not treated as a prose claim: this selection assessment can observe that unknown-time houses/angles are absent but cannot certify whether later language leaks a suppressed inference. Approximate dense cases retain natal houses/angles because these fixture inputs suppress angle **transits**, not natal angles or houses. Broad Moon positions/aspects remain present alongside the time-sensitive-Moon restriction; understanding that distinction in prose is still an untested quality condition.

## Findings and panel gaps

1. **Different patterns collapse onto the same meaning set.** In `exact-06`, aliases `f006` (`aspect_chain`) and `f013` (`grand_trine`) each select Axis `ont_25921eae592962d9579fc70ee3218ba7`, Concentration `ont_6ca9db402944f3d5484bae48d6db18e8`, Isolated factor `ont_3c392d79beda94f2efc9d560ca869179`, and Reinforcing loop `ont_e12a8be03287e598f27d2e3f97f4d0b7`. The same four-record match occurs for both pattern features in approximate-06 and unknown-06. Every predicate is simply `{ "type": "pattern" }`; selection therefore does not establish that a particular topology supports each distinct proposition. This is a mapping-stage support/contrast finding, with final semantic adjudication pending.

2. **Uncertainty meanings are broader than their labels.** Sparse feature set `ont_e3af08a193f2cd2d728f672cd2b529d7` and Qualified location `ont_8563a483d077048b29fe10fb63e4983b` match every case's uncertainty feature through `{ "type": "uncertainty" }`. For example, both attach to `exact-02.f021` despite the packet's `sparse_pattern=false` and absence of a selected location-qualification fact. This means selection has not established those conditions. Conditional wording may remain legitimate guidance, so this result alone does not label resulting prose false.

3. **The admitted meanings provide limited position-specific contrast.** Within each accuracy class, suffixes 01 and 05 select identical records despite a 10° change in each position; their signs happen to remain the same. Comparing suffixes 02 and 06 also crosses the Sun from Aries to Taurus and Jupiter from Scorpio to Sagittarius, while each body's selected record remains unchanged. Raw signs, longitudes, and houses remain in the packet, but admitted body predicates do not distinguish them. Sign meanings are among the twenty omitted source fragments; a writer cannot safely recover that missing semantic support by inventing sign interpretations. The lack of an admitted sign contrast is a mapping limitation, not proof that every raw degree should produce different prose.

4. **The authored conflict/gap labels are not achieved current-release coverage.** Suffix 05 cases exercise the same selected record sets as suffix 01. Their fixture-only conflicting records were deliberately not imported, and no source conflict has been adjudicated in these selected sets. Suffix 06 cases produce zero `ontology_unsupported` accounting rows because the broad pattern predicates match both authored pattern types. Their original unsupported-gap axis is therefore unexercised. A broadly matching record is not proof of semantic support; it is the reason this assessment must distinguish selector coverage from interpretation quality.

5. **Six of forty records have no selected feature in this panel.** Uranus `ont_cd94f0de95df234c24a4dcc2e64e2585`, Neptune `ont_fa383b8282816d961dcc597a23228417`, Pluto `ont_d058b396005f78eddd6cfffa5dcaf69f`, and Lunar node `ont_a0b091f2ae1e86ab86a456acdbb33c8e` lack input positions. Descendant `ont_34aa37108a65368ed08320232f166bd7` and Imum coeli `ont_43f745a0536e4daf8917f1558e518dab` are also absent; the current natal-feature derivation emits only Ascendant/Midheaven angle facts. Thus four are panel-input omissions and two also have a current derivation-path limitation. All forty can still receive source/mapping review; 34/40 selection coverage must not be described as full prose coverage.

The [record assessment](record-assessment.md) traces the implicated source propositions and predicates; the [fragment register](fragment-register.md) accounts for all sixty inputs. The prescribed panel is preserved. No extra fictional case was silently added to claim coverage, and the thirty-case activation corpus was unchanged. Capacity refusal, unsupported-feature omission, adjudicated source conflict, matched historical/fresh generated prose, and human comprehension remain gaps.

## Synthetic helper boundary and result

The existing `buildDeterministicPlan`/`validatePatternPlan` helpers produced valid plans for all twelve packets, and `buildDeterministicWriterOutput` built output for each. Those outputs were retained only in ignored scratch for the separate explicitly synthetic negative controls. They are template/padding-based test material; they do not change case status to `output_available`, count as provider evaluations, or receive fabricated editorial scores. Candidate/publication checks of individual controls are recorded in the controls assessment rather than inferred from plan validity.

Panel execution is complete for the twelve prescribed cases. Source/meaning coverage findings are reviewable now. Prose adjudication, interpretation quality certification, calculation validation, and a reader study remain unperformed.
