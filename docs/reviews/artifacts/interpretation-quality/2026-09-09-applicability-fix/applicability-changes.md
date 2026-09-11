# Applicability changes: 0.1.1 to 0.1.2

Date: 2026-09-09. This comparison reads the preserved [0.1.1 candidate](../2026-09-09-counter-expression-fix/candidate.json) and new [0.1.2 candidate](candidate.json). Records are matched by source-fragment ID and accuracy variant, excluding their intentionally version-derived IDs. The [panel](chart-panel.json) records before/after selection for twelve authored chart cases. The [report](README.md) records candidate-validation failures and review limits.

## One narrowed meaning

| Source | Previous match | New match | Reason |
| --- | --- | --- | --- |
| §6.2 Concentration; `srcf_70a53d65d1e84c127bd1249147a880d9` | Any `pattern` feature | `pattern` with `pattern: "stellium"` | The existing source-coverage hint identifies stellium as the supported match. A grand trine or aspect chain alone does not establish concentration. |

The proposition, tensions, counter-expressions, prohibitions, source references, salience, presentation priority, and tags of Concentration remain unchanged. The [existing hint](../../../../../apps/api/src/services/ontology-coverage-source-hints.ts#L65) supplies the narrower mapping. The current [calculation service](../../../../../apps/calc-stub/src/engine.ts#L932) emits `patterns: []`; this change adds no detector.

## Five omitted meanings

| Source | Prepared fragment ID | Previous match | Why omitted |
| --- | --- | --- | --- |
| §6.3 Axis | `srcf_74270f9402b7b429bc6067ad6844782a` | Any pattern | No verified existing matching feature establishes the source's axis configuration. |
| §6.4 Reinforcing loop | `srcf_2acd94adb80de8a171e5185c7bf99627` | Any pattern | The existing pattern labels do not establish this source's reinforcing loop. |
| §6.5 Isolated factor | `srcf_7c21ed1d1d50f0d518ee31a4420e8c64` | Any pattern | A supplied pattern does not establish a factor with no connections. |
| §7.3 Sparse feature set | `srcf_c063ee9a41d23b5640ad360d5e4a265f` | Any uncertainty fact | Birth-time accuracy does not establish a sparse chart; the predicate cannot test selection's separate sparse state. |
| §7.4 Qualified location | `srcf_6248318725160a6320855ef60c246943` | Any uncertainty fact | Birth-time accuracy does not establish imprecise birthplace or time-zone resolution. |

Their source fragments remain in the unchanged corpus. This is an omission from the candidate's admitted meanings, with no deletion of source material, no change to calculation facts, and no change to selection or publication policy. The previous twelve sign and eight cross-cutting omissions remain, bringing total omissions to 25.

## Separate exact-time methodology

Unknown-time §7.1 and approximate-time §7.2 meanings keep their original predicates and content. Exact accuracy cannot use the unknown-time proposition as though the reader's time were unknown. It still has a mandatory uncertainty fact under the existing publication policy.

The added record cites the same prepared §7.1 fragment, `srcf_e208626ca6efa93828a018d6142dac47`, and uses only these source-verbatim sentences:

- **Proposition:** “Where a factor is missing, the honest form is to name what is absent and stop, rather than to substitute a general statement that would be true of anyone.”
- **Tension:** “The failure mode is filling the gap.”
- **Counter-expression:** “What remains is genuinely there.”

Its predicate is `{ "type": "uncertainty", "accuracy": "exact" }`; its ID is `ont_d8e7f799cb1329f38428263cd78f3aaa`. The ID uses the existing version/fragment hash with an explicit `:exact-methodology` discriminator. The builder checks that all three complete sentences occur in the prepared fragment and refuses incompatible source content before writing a candidate.

This is conditional guidance about the limits of a reading. It neither asserts that a specific factor is missing nor changes the recorded birth-time accuracy. Source prohibitions, salience, presentation priority, tags, and `source_supported` classification remain inherited from the cited fragment.

## Selection and preservation

The four exact cases now receive one exact-time methodology record instead of two generic sparse/location records. The four approximate and four unknown cases each retain their appropriate accuracy record and lose the same two generic records. Existing required uncertainty coverage remains in all cases. Missing its note or matching record still causes the existing publication checks to reject the output.

In the three panel cases with authored grand-trine/aspect-chain facts, these pattern facts become `ontology_unsupported` while other supported evidence remains available. A separate builder regression case confirms that a supplied stellium still selects Concentration. This does not establish live calculation support for those patterns.

Apart from Concentration's predicate, all fields of the 35 retained records remain unchanged after excluding IDs. No retained counter-expression, proposition, tension, source reference, or prohibition changes. The only added content is the three source sentences above. Envelope changes are limited to ontology/evaluation version; other metadata and compatibility flags remain unchanged. The zero counter-expression proposition-fallback count from the prior fix is preserved.
