# Reviewer notes — Pattern Ontology Source Manual

**Corpus:** 60 fragments, en-US, edition 0.1 (2026) — pilot 8 plus the full grid
**Origin:** model-generated. Not human-authored, and not represented as such.
**`license_class`:** `licensed_excerpt` on all 60. Product/operator approval of the rights classification was recorded on 2026-08-22 in `ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md`; counsel review and the exact generating-model record remain separate public-activation conditions.
**Validation:** `node validate-fragments.mjs fragments.json` — 60 fragments, no failures, no warnings.

> Product/operator approval authorizes this edition for the production-shaped Gate 7B pipeline run. It is not a claim that counsel or a human editor has certified every fragment for public activation.

| | |
| --- | --- |
| Bodies 11 · Signs 12 · Houses 12 · Aspects 5 · Angles 4 · Patterns 4 · Uncertainty 4 · Cross-cutting 8 | matches the SOW §7 grid exactly |
| Excerpt length | 789–921 chars, mean 862 |
| Proposition length | 84–134 chars, all single-sentence |
| Exclusions | 180 total, minimum 3 per fragment |
| `developmental_arc` granted | 14 of 60 |
| `shared_motif` granted | 11 of 60 |

---

## What this batch is for

The first eight covered one member of each SOW §10 pilot category: body, sign, house, aspect, angle, pattern, uncertainty, cross-cutting. The remaining 52 apply those conventions across the complete grid. The first production-shaped run now tests whether those conventions survive contact with the generator and evaluator at full-corpus scale.

Three things I expect to be wrong and want to see fail:

1. **The exclusion strings are guesses.** They are written to catch phrases a drifting record would actually produce, but nobody has seen a real derived record yet. Some will never fire; at least one will probably over-refuse. This is the main thing the pilot is for.
2. **`allowed_transformations` may be over-granted.** I gave `shared_motif` to two fragments and `developmental_arc` to four. If `derived_synthesis` starts producing thin records, these are the first thing to tighten.
3. **The sign and house fragments are the weakest.** They are where "generic sign-based filler" lives, and where an essentialist reading is easiest to fall into.

---

## Per-fragment

### `mars-body-initiation` — §1.5 Mars

Carries the tension between decisiveness and impatience as **one trait read twice**, not two traits. The counter-expression is deliberately non-obvious: a low threshold for starting is also a low threshold for repair, so short grudges are part of the same finding rather than a consolation added afterward.

*Check:* that "friction" does not get read as aggression downstream. The exclusion `"a violent temper"` is aimed exactly at that drift, but it is a narrow phrase and may never fire — watch whether records reach for anger vocabulary the exclusion does not cover.

*Note:* no `developmental_arc`. Mars here has no time dimension in the source text, and granting one would let a synthesis invent a maturation story the fragment does not support.

### `virgo-sign-improvement` — §2.6 Virgo

Written specifically against the stereotype. The move is to make Virgo a **method rather than a personality**, so that the flattering and unflattering readings are the same habit of attention pointed at different objects. That is what makes the tension and counter-expression genuinely distinct rather than "good version / bad version."

*Check hardest:* "turns inward and finds a gap that will not close" is the line most likely to read as a mental-health claim. It survives the regex and I think it survives §4.2, because it describes where attention goes rather than a state a person is in — but it is the closest call in the batch and I would not defend it to the death. All three exclusions guard this one line.

*Note:* `developmental_arc` granted on the strength of the final sentence ("more often early than permanent"), which is there to stop a synthesis fixing this as a permanent trait.

### `tenth-house-visibility` — §3.10 Tenth house

Separates **visible** from **important**, which is the tension. The counter-expression — that legibility to strangers is materially useful — is there so the fragment does not collapse into "external validation is hollow," which is both a cliché and one-sided.

*Check:* the exclusion `"your career will"` is the most likely to actually fire in this batch, because a tenth-house record drifting toward prediction will reach for exactly that construction. If it never fires, that is evidence the generator is better behaved than assumed, not evidence the exclusion was wrong.

*Note:* the last sentence ("says nothing about whether the visible thing is any good") is doing anti-flattery work. Readings about the tenth house drift complimentary.

### `square-aspect-structural-friction` — §4.3 Square

The load-bearing claim is that **neither side is the obstacle** — two methods with equal standing. That framing is what stops derived records producing "X is held back by Y," which is one-sided by construction.

*Check:* "those two facts are not unrelated" was written to get the correlation across without tripping `caus*`. It does trip nothing, but read it for whether it is doing the same job as a causal claim in disguise. If the evaluator flags `unsupported_expansion` anywhere in the batch, I would bet on this sentence.

*Note:* this fragment should be a heavy participant in `derived_synthesis`. If it is not being cited, something is wrong with selection rather than with the fragment.

### `ascendant-angle-approach` — §5.1 Ascendant

Approach vs interior. The counter-expression pushes back on the usual "mask" reading, which is both tired and faintly accusatory.

*Note:* this fragment **handles its own suppression** in the final two sentences. It is the pattern I would want repeated for every angle and house fragment in the full 60 — the source text says what to do when the factor is absent, so the generator does not have to work it out. Worth confirming that a record derived from this actually inherits that instruction rather than dropping it.

*Check:* `"how you really are"` as an exclusion is the broadest phrase in the batch. It may catch legitimate prose. First candidate for removal if refusal rates look high.

### `pattern-concentration-weight` — §6.2 Concentration

Deliberately **not** the "stellium means giftedness" reading. Weight, not talent. The tension is that the concentrated area is hard to assess from inside; the counter-expression is accumulation over time.

*Note:* granted all seven transformation classes except none — this is the most permissive fragment in the batch, because concentration genuinely interacts with everything. If over-granting is a problem anywhere, it is here first.

*Check:* `"a special talent"` is guarding against the exact reading I wrote the fragment to avoid. If records still produce talent framing without using that phrase, the exclusion needs to be wider or the excerpt needs to be blunter.

### `uncertainty-unknown-birth-time` — §7.1 Unknown birth time

Not a claim about a chart factor. It is **source support for the suppression path**, so that a reading missing houses and angles has something to cite rather than improvising. Without a fragment like this, records about absence are `expression_guidance` with no grounding.

*Note:* narrowest transformation set in the batch — `contrast`, `counterbalance`, `expression_range` only. No `intersection` or `tension`, because this is methodological and should not be synthesised into claims about a person. That restriction is deliberate and I would resist widening it.

*Check:* the exclusions here are anti-substitution phrases (`"approximately noon"`, `"we can assume your birth time"`). They guard the one failure mode that matters most — a reading quietly filling the gap. Verify they are matched against the record text and not only the visible prose.

### `crosscutting-two-tempos` — §8.3 Tempo

The most useful fragment in the batch and the one most likely to be under-cited. It supplies the reason a reading should not resolve into a single verdict, which is the thing that makes `tensions` and `counter_expressions` cohere rather than read as hedging.

*Note:* all seven transformation classes. If any fragment justifies that, it is this one — tempo cuts across every other category.

*Check:* whether records citing this one actually get more two-sided, or whether the fragment just adds a disclaimer sentence. The former is the point. The latter would mean the fragment is decorative and should be rewritten.

---

## The remaining 52, by category

### Bodies (10 added)

Each written as **one instrument producing both readings**, never as a good half and a bad half. Saturn is a fresh draft rather than the SOW §3 example — same finding, tighter, with the ordering point ("the weight is at the front") added because a synthesis needs to know the sequence.

The four with real drift risk are Neptune, Pluto, Moon, and Mercury. Neptune is written away from substances and delusion toward *indistinct edges and bookkeeping*; Pluto away from trauma toward *depth of involvement*; the Moon away from mood toward *the return route*; Mercury away from intelligence toward *handling method*. Each carries three exclusions aimed squarely at the reading it was written to avoid. If records still drift there, the excerpts need to be blunter — the exclusions alone will not hold it.

`developmental_arc` granted only to Sun, Mercury, Saturn, and the node, where the source text actually contains a time dimension. Withholding it from Mars, Venus, Jupiter, Uranus, Neptune, and Pluto is deliberate: it stops a synthesis inventing a maturation story the fragment does not support.

### Signs (11 added)

All twelve now read as **working methods**, per the Virgo precedent. Each closes by naming the stereotype it is not, which is the only reliable way I found to stop the essentialist reading — the exclusions catch the phrase, the closing line catches the frame.

Watch Scorpio and Aquarius hardest. Scorpio is the one most likely to attract conduct and sexuality material; Aquarius the one most likely to attract politics. Both have exclusions pointed at it, and both are single points of failure.

Aries, Leo, and Capricorn are written against the flattering stereotype rather than the unflattering one, which is the less obvious risk — "a natural leader" is as much a fabrication as "an aggressive personality" and reads as accurate to more people.

### Houses (11 added)

Every house fragment ends with **"This house requires a birth time"**, following the ascendant precedent. That sentence is in the source text so the generator inherits the suppression rule rather than having to derive it. Verify a derived record actually carries it — if it drops, the whole convention is decorative.

The four hazardous houses are handled by relocating the subject rather than by hedging: 4th is *the base* not childhood, 6th is *repeated work* not health, 8th is *joint holdings* not death, 12th is *the unwitnessed* not mental health. The 1st is written away from physical appearance, which is the gap with no deterministic check behind it.

### Aspects (4 added)

The set is now built on one axis — **how much supervision the combination needs**. Conjunction fused, sextile on request, trine unattended, square structural friction, opposition alternating. That makes them genuinely contrastive rather than five variations on "gets along / doesn't get along", and it should give `contrast` and `counterbalance` real material to work with.

Trine is the one written most against type: reliability framed as *unexamined* rather than as luck. If a record turns it back into good fortune, the fragment is losing.

### Angles (3 added)

Midheaven, descendant, and imum coeli, each paired against the ascendant. The descendant is the riskiest fragment in the corpus — it sits one sentence away from "you attract this kind of person", which is both unfalsifiable and quietly victim-blaming. The excerpt states explicitly that nothing here says a person attracts anything or is responsible for others' behaviour, and three exclusions guard it. I would review this one personally before activation.

### Chart patterns (3 added)

Axis, reinforcing loop, isolated factor. All three are structural rather than evaluative, and all three are written to resist the "rare configuration means special person" reading. The isolated-factor fragment gets the narrowest transformation set of the three — no `intersection` or `shared_motif`, because a factor defined by having no connections should not be synthesised into connections.

### Uncertainty (3 added)

Approximate time, sparse feature set, qualified location. Together with the pilot's unknown-birth-time fragment these cover the four real degradation paths, and they map onto surfaces that already exist — `geocode_confidence`, the timezone qualification, and the sparse-chapter word floor in `policy.ts`.

The sparse fragment is the one I would keep even if everything else were cut. It names the exact mechanism by which a quiet chart becomes a bad reading: length reads as value, so padding happens, and padding is done with material general enough to be true of anyone.

### Cross-cutting (7 added)

These are the corpus's spine and are the least like conventional astrological source material. Collective material, absence, convergence, contradiction, description-vs-instruction, strength-vs-frequency, and no-ranking. Six of the seven map directly onto `PATTERN_FINDING_CODES` — `collective_material_claimed_unique`, `one_sided_labeling`, `possibility_stated_as_certainty` — which means a verifier finding now has a citable source rather than only a rule.

`crosscutting-description-not-instruction` uses `"you should"` as an exclusion, which is the broadest string in the corpus. It is deliberate and I expect it to fire. If refusal rates are unworkable, narrow it before removing it.

---

## What the validator caught

One real failure, worth recording because it is the exact trap in SOW §4.1: `seventh-house-the-counterpart` closed with *"predicts nothing about anyone's relationships"* — a **denial** of prediction, which trips `predict*` identically to an assertion. Changed to "says nothing about". Two single-word exclusions (`two-faced`, `self-undoing`) were flagged as over-refusing and replaced with phrases.

Everything else passed first time, which is evidence the conventions below are doing real work rather than being post-hoc description.

---

## Conventions used, applied across all 60

Worth agreeing before activation, because each convention is now applied across the full grid and would be expensive to reverse.

| Convention | Why |
| --- | --- |
| "is associated with" / "the usual report is" / "people describe" | The only reliable way to state a tendency without tripping `caus*` or `predict*` |
| "says nothing about", never "predicts nothing about" | Denials trip the regex identically to assertions. This is the one that actually failed |
| "shows up as", never "manifests as" | `manifest` is a banned hype term |
| Closing line names the stereotype the fragment is not | The exclusions catch the phrase; only the excerpt can catch the frame |
| House and angle fragments state their own suppression rule | Puts it where the generator inherits it |
| Tension and counter-expression both stated in the excerpt, in that order | `source_supported` records need both, and the generator inherits the order |
| Final sentence removes a flattering or fatalistic reading | Stops the record resolving into a verdict |
| Exclusions are 2–4 word noun phrases | Single words over-refuse; full sentences never fire |
| Factors that suppress under unknown birth time say so in their own text | Puts the instruction where the generator will see it |

---

## Open questions

1. **Resolved: exclusions match the full record text.** `exclusionsAllow()` checks the proposition, tensions, counter-expressions, `prohibited_claims`, and cluster tags. Copying an exclusion into a guardrail field therefore refuses the candidate. The first pipeline run should reveal whether the generator needs a more explicit instruction not to repeat exclusions in any output field.
2. **Is 60 fragments actually the right number** for a 40–50 record ontology, or does the generator need more source per record than assumed? The full-corpus derived-record yield will answer this, and the answer changes any later edition's size.
3. **Should `author` carry the model name and version?** `provenance.authored_by` on the release is the more honest home for it, but that field is optional and sits on a different object.
