# Daily reading uncertainty disclosure

## The gap

`prepareConstrainedReadingInput` requires an uncertainty note whenever the chart
carries a suppressed **or** a qualified feature. The accepted disclosure forms in
`packages/reading-engine/src/claim-support.ts` are built from only two things:
the fixed approximate-time sentence, and three suppression sentences that must
name a feature class actually present in `suppressed_features`. Every one of
those sentences requires at least one feature phrase — the `scope` group has no
empty alternative — and each phrase is then checked against the suppression set.

So when nothing is suppressed and the birth time is not `approximate`, no
accepted sentence exists. Omitting the note is not an escape either: a required
note that is absent or blank fails `required_note_missing`. Both halves of the
pincer are deterministic, not probabilistic.

That state is reachable in production. `buildUncertainty()` in
`apps/calc-stub/src/engine.ts` qualifies `birthplace` when the birthplace
resolves below high confidence, and `birth_instant` when the civil time carries
a zone-boundary or ambiguity code. **Both are emitted at every accuracy**, not
only for approximate births, and `suppressAngles` depends on whether houses
computed rather than on location confidence. An exact-time chart with real
coordinates and a qualified birthplace therefore has an empty suppression set
and a mandatory note it can never satisfy.

Left unguarded, every candidate is rejected `unsupported_uncertainty_disclosure`
after the provider has been paid, and `publisher_output_invalid` is in
`V5_AUTOMATIC_REPLACEMENT_FAILURE_CODES`, so the command is automatically
replaced until the three-generation cap is spent. That is how
`rdg_8e544ee742bd0140977fcd8e006c740c` reached `command_generation` 3 with no
reading on 2026-09-11.

## The guard

`prepareConstrainedReadingInput` now refuses such a packet before building a
command, raising `ConstrainedInputError`. Both callers already handle it:
the enqueue path (`generation-command-v2.ts`) returns `context_ineligible` and
never creates a job, and the execute path (`generate-daily-reading-v5.ts`)
fails `generation_input_id_mismatch` before any provider call. Neither code is
an automatic replacement reason, so the refusal is terminal and cheap rather
than self-replacing. On the enqueue path the return happens before
`persistCycles`, `replaceCommand`, and `dispatch`, so no job row, no cycle
envelope, and no queue message is created.

A reader on the affected chart gets `424 reading_generation_failed`
("Today's reading could not be prepared") with `retryable: false`, which is the
honest answer: the condition does not resolve on its own. The refusal detail
names the birth-time accuracy and a qualification count, and stays internal —
`routes/readings.ts` switches on the reason and emits hardcoded messages, and
`safeLog` records the reason only.

`generation_input_id_mismatch` is an imprecise label here — nothing is
mismatched, the packet is unrepresentable — and it was left alone deliberately.
That mapping is shared by every `ConstrainedInputError` at execute, and only
commands frozen *before* this guard shipped can still reach it, since enqueue
now refuses first. Widening the failure vocabulary for a transient case is more
surface than a stop-gap earns.

The representability rule lives in `claim-support.ts` beside the grammar it
mirrors, as `uncertaintyDisclosureRepresentable`. It is deliberately not a
second copy of the rule maintained by hand: the cross-check in
`candidate-validation.test.ts` drives the real grammar with every sentence it
can generate, across every (accuracy, suppression) shape, and fails if the
predicate and the grammar disagree. This defect began as exactly that kind of
divergence — `contracts/m3/common.schema.json` narrowed `qualifiedFeatureId` to
`["moon","houses"]` from a partial reading of the same `buildUncertainty()` it
was meant to mirror, and `toAssemblyUncertainty` laundered the difference
through two unchecked `as` casts.

## What the guard does not do

**It is a stop-gap that stops the spend, not a repair.** Affected readers get no
Daily reading; they now get a clean terminal refusal and an intact generation
cap instead of three wasted generations. The qualification still goes
undisclosed.

**The disclosure gap is wider than the outage.** On `approximate` charts the
note names only the birth time, and on `unknown`-time charts only the suppressed
classes. In both cases a surviving location qualification is silently dropped,
and every attempt to state it is rejected. So "every surviving qualification is
announced" is not an invariant the M5 path currently holds — the exact-time case
is the same defect where the fallback happens to be empty.

The V1 assembler does hold it: `assemble.ts` sources the notice from an
editorial `uncertainty` modifier, which can say anything, and records
`no_uncertainty_modifier_for_locale` with `N qualified feature(s) unannounced`
when it cannot. The constrained-model path replaced editorial prose with a
closed grammar and never gave that grammar the location vocabulary.

## The pending fix

A versioned successor projection, decided 2026-09-11:

- Widen `qualifiedFeatureId` / `featureQualification` in
  `contracts/m3/common.schema.json` to the four combinations `buildUncertainty()`
  actually emits, with a schema-version bump and a freeze note. The frozen M0
  contract already permits them — `feature_id` is `{"type":"string"}` and
  `technique_specific` is in its enum — so this records what production already
  hashes rather than changing any identity. No runtime validator enforces
  `assembly-identity.schema.json` today; it appears only in tests.
- Carry qualification classes into the M5 provider request, which currently has
  no `qualified_features` field at all, with an M5 schema and prompt version bump.
- Add matching disclosure forms and terms, with a validation policy bump from
  `1.1.1`. Queued commands pinned to the old policy fail `policy_unsupported`
  rather than executing new semantics under an old identity, which is the
  designed behavior.
- Replace `uncertaintyDisclosureRepresentable` with the widened rule, or delete
  it if every reachable packet becomes representable. The cross-check test is
  what proves which.

Do not instead narrow the note trigger to suppression only. The M3 schema states
the invariant it would break — *"A surviving qualified feature forces an
uncertainty_notice paragraph"* — so that is a contract change too, just an
undeclared one, and it would make concealment universal rather than partial.

## Recovery

`rdg_8e544ee742bd0140977fcd8e006c740c` has an exhausted generation cap and is
untouched. Recovering it needs a separately authorized bounded path that
preserves the existing failure history and the cap; it is not addressed here and
must not proceed before the versioned fix, because a replacement command built
today would be refused by the guard for the same reason the original failed.
