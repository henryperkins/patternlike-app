# Fresh Daily reading evaluation

[The harness](../../scripts/pattern-release/fresh-reading-evaluation.mjs) generates
fresh Codex output for six fixed fictional profiles using the actual Daily
preparation, prompt, request conversion, and candidate validator. It calls the
existing isolated Codex transport directly. It does not call a production
Worker, read account data, create a durable generation job, publish a reading,
or exercise consent and deletion flows.

The [approved follow-up design](../superpowers/specs/2026-09-06-review-claims-followup-design.md)
requires source-bound evidence and a separate independent review boundary.
`independent_review.status` remains `unverified` for every run. Automatic
acceptance does not establish psychological truth, editorial approval, or a
production success rate.

## Frozen inputs and fresh output

The six profiles cover exact, approximate, and unknown birth time; a day with no
cycles; a day with collective material only; and injected user text. They come
from the synthetic
[evaluation corpus](../../apps/api/test/fixtures/reading-evaluation-corpus.json).
There are no real birth details, production account records, or D1 reads.

[`prepareProfile()`](../../apps/api/src/services/reading-evaluation.ts) compiles
each profile through `prepareConstrainedReadingInput()`. The harness then calls
[`buildResponsesRequest()`](../../apps/api/src/services/reading-prompt.ts) with
the compiled current Daily pin and converts it through
[`invocationFromResponsesRequest()`](../../apps/api/src/services/codex-provider-contract.ts).
[`runCodexInvocation()`](../../apps/codex-runner/src/codex-cli.ts) supplies the
existing isolated Codex JSON transport, including its current authentication and
isolation checks. The harness does not select another account or change the
model, prompt, policy, or response schema.

The frozen corpus also contains authored candidate strings for offline
[regression tests](../../apps/api/src/services/reading-evaluation.test.ts).
Revalidating those strings measures whether the current validator agrees with
the corpus expectations. The fresh harness uses only their prepared profile
inputs and generates new output; it never sends a frozen candidate as the
expected response. Corpus revalidation and fresh model evaluation are distinct
evidence, and neither is a production publication exercise.

## Prepare and run

Use the repository's Node 22 environment. Preparation writes pin, corpus,
profile-shape and invocation-hash metadata without invoking a provider:

```bash
node scripts/pattern-release/fresh-reading-evaluation.mjs prepare /tmp/daily-evaluation-plan.json
```

An authorized fresh run uses the already configured Codex executable:

```bash
node scripts/pattern-release/fresh-reading-evaluation.mjs run /tmp/daily-evaluation-run /path/to/codex 1
```

The final argument is repetitions: one by default, an integer from one through
three. Every repetition attempts all six profiles once, with no correction loop
or retry. The normal budget is six invocations and the maximum is eighteen.
The existing runner applies its current timeout and output byte limit. A token
field recorded in the request pin does not establish an additional token ceiling
in the Codex JSON transport. Actual returned token usage is recorded per sample.

The destination must be new and outside runtime source. Within this repository,
allowed locations are under `output/`, `docs/reviews/`, or `docs/superpowers/`.
Run directories use mode `0700`; files use exclusive-create mode `0600`. An
existing directory is refused, including a partial run. Preserve that directory
and choose a new destination for any later run. The CLI forwards SIGINT/SIGTERM
through an abort signal; cancellation or a fatal transport failure prevents
remaining calls from being attempted.

The exported runner function accepts an injected `invoke` only for offline
tests. Such results are labelled `execution_kind: "test_double"`, report no
observed provider samples, and cannot set `passed: true`. Only actual execution
through the existing Codex process can supply fresh-provider evidence.

## Reading the evidence

`hardGateFindings()` uses the actual `validateReadingCandidate()` boundary. Each
received output becomes `accepted` or `rejected`; malformed candidate JSON is
rejected. Transport failure and unattempted work have separate statuses. Keep
rejected samples: they can expose either an unsupported model claim or a
validator false rejection. The automatic status alone does not distinguish
those causes.

Accepted candidates also receive `qualitativeFindings()` signals for issues
such as unused permitted context, repetition, thin leads, and tone. These are
automatic heuristics. They do not change the hard-gate acceptance result and do
not establish independent usefulness or editorial quality.

Each returned output is retained with its prepared request in a private sample
file, including rejected output. The isolated transport rejects non-JSON final
messages before returning them; the harness retains the resulting safe failure
metadata and cannot recover raw bytes it never received. The content-free
`report.json` records source identity, source comparisons, compiled model and
policy pins, corpus version, invocation and output hashes, usage, findings,
sample pointers, and accepted/rejected/failure/unattempted totals. Read source
comparison and completion fields together with the counts; a partial run cannot
be promoted into a completed evaluation.

Keep the included source unchanged throughout a run. Source drift prevents a
passing result; a process killed before its report is written leaves incomplete
evidence. A pass requires actual Codex execution, unchanged source, and automatic
acceptance of every planned output. It leaves independent assessment of
fact-to-sentence support, uncertainty, safety, context attribution, and usefulness
unverified. Record fresh run results from their actual artifacts separately;
this runbook makes no claim about the latest run.

For the separate authored-input Pattern semantic challenge harness, see
[Fresh Pattern verifier challenges](fresh-pattern-verifier-evaluation.md).
