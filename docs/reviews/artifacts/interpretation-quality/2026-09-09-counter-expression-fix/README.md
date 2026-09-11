# Counter-expression extraction fix

Date: 2026-09-09. **Implemented and verified locally.** The builder now retains explicit source counter-expressions before considering loose keyword matches. The [unsigned candidate](candidate.json) is `pattern-ontology-en-us-internal-0.1.1`; no signing, ingestion, activation, deployment, provider evaluation, or saved-reading change occurred.

## Result

| Measure | Preserved 0.1.0 baseline | New 0.1.1 candidate |
| --- | ---: | ---: |
| Admitted records / omitted fragments | 40 / 20 | 40 / 20 |
| Records whose first counter sentence is an explicit source marker | 3 | 39 |
| Counter-expression arrays that fall back to the main proposition | 17 | 0 |
| Explicit counter-expression labels retained | 3 of 38 | 38 of 38 |

Mars supplies the additional `counterweight` marker. The unmarked unknown-time record keeps its existing extracted sentence. Thirty-six counter arrays change; three already selected the intended assertion, so their counter text also remains unchanged. [All changed passages](counter-expression-changes.md) are available for review.

The previously recorded [offline baseline](../2026-09-09-baseline/README.md) and every attachment remain byte-identical. This fixes demonstrated extraction loss, not the broader applicability issues or missing sign meanings identified there. Improved generated prose and reader benefit have not yet been measured.

## Behavior

In the [internal builder](../../../../../apps/api/scripts/build-internal-ontology.ts), a sentence beginning `The counter-expression is` or `The counterweight is` takes priority over incidental `the same`, `also`, or similar matches elsewhere in the excerpt. The first matching source assertion is retained verbatim.

A complete `is that …` assertion stands alone. A short label such as `is durability`, `is depth`, or `is concentration` retains its immediately following explanatory sentence as well, within the existing two-sentence limit. This avoids cutting a longer contrast after an opposing setup while dropping its later resolution. Unmarked excerpts retain the existing keyword selection and proposition fallback.

This is a bounded rule for the reviewed corpus’s source conventions, not a general semantic parser. The selected assertion can omit useful later elaboration; the change does not claim to recover every sentence of a full source passage or certify its editorial quality.

## Identity and compatibility

The prepared corpus remains `pattern-ontology-source-manual-en-us-0.1.0`, with hash `sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c`. The reproduced old builder output has canonical signing-payload hash `sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84`. The new candidate’s canonical signing-payload hash is `sha256:98297b1d7a45e7a5fc89807bcc0fe311fa882bb978b0340c472fc7deadc4b0c4`.

The builder defaults to a new ontology version because extraction changes content. All forty record IDs consequently change through the existing version-plus-fragment identity rule. Match versions by source-fragment ID when reviewing the diff; historical readings and their original rule IDs are not rewritten. `authored_by` correctly remains the unchanged source manual version, and `ONTOLOGY_VERSION` overrides remain supported.

The comparison confirms unchanged predicates, source-fragment references, propositions, tensions, prohibited claims, salience, ordering, and tags. Envelope differences are confined to ontology/evaluation version and the version-derived records. The existing compiler accepts the candidate. Its on-disk `bundle_hash` is the builder’s unsigned placeholder; the canonical hash above is independently computed using the existing signing-payload helper. Compatibility evaluation fields do not constitute human or provider evaluation.

## Verification

Two regression cases were added to the existing [corpus preparation test file](../../../../../apps/api/scripts/prepare-ontology-corpus.test.ts). They invoke the real builder and cover actual source recovery, bare labels, Mars, preserving unknown-time handling, incidental quoted labels, unmarked alternatives, missing alternatives, and default/explicit candidate versions. Both failed against the old extraction; all five tests passed after the fix.

The first API typecheck caught optional `location` handling in the new test helper; that was corrected. The final API typecheck passed. The offline comparison compiled both candidates, checked all forty records, confirmed every extracted sentence occurs verbatim in its source, and confirmed all baseline attachments remained unchanged.

```sh
npm run test:ontology-corpus-prepare -w @patternlike/api
npm run typecheck -w @patternlike/api
```

Verification used Node 22.23.2. Existing package commands and gate definitions are unchanged; no new lane or mandatory map check was added. The full local gate was not run, as directed by the user.

## Next work

Review the candidate’s improved source expressions alongside the unchanged applicability limitations. A later rollout uses this separate candidate identity and the existing release procedure; local implementation does not imply the candidate is serving readers. The next recommended product fix remains narrowing the six meanings whose conditions are not established by their current predicates.
