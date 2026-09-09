---
target: the pattern page (PatternExperience and portrait components)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/henry/patternlike-app/apps/web/src/components/PatternExperience.tsx"
target_fingerprint: "sha256:0f0ec87b1e233a43f7a27d3366c2abd10aff29b51b256966bf4ba342b4b0fb38"
target_path: /home/henry/patternlike-app/apps/web/src/components/PatternExperience.tsx
timestamp: 2026-09-09T02-22-38Z
slug: apps-web-src-components-patternexperience-tsx
---
Method: dual-agent (A: ses_f7c09d3c6ffeDOkTmdj5EXxsWy · B: ses_f7c09be5effeJ4ezZ6Rgykvmo8)
Target: apps/web/src/components/PatternExperience.tsx (+ PatternConsent, PatternPortrait, PatternSculpture, AccountPatternPortrait, AccountPortraitExplorer)
Mode: Operate with Experience element. All 10 heuristics scored; max 40.

# Pattern Page — UX Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong polling/stage states; errors can be suppressed when stale state exists (PatternExperience.tsx:533) |
| 2 | Match System / Real World | 3 | Calm honest copy; jargon leaks: processor, policy version, ontology unavailable |
| 3 | User Control and Freedom | 3 | Cancel/back/toggle everywhere; no cancel-generation; no undo for delete |
| 4 | Consistency and Standards | 2 | Fragmented vocabulary + detector: 33 off-system values in portrait CSS |
| 5 | Error Prevention | 3 | Type-to-confirm + idempotency keys; exact-uppercase phrases create friction |
| 6 | Recognition Rather Than Recall | 3 | Chapter index/tabs/labels; type-to-confirm forces verbatim recall |
| 7 | Flexibility and Efficiency | 3 | Reading/3D toggle, keyboard access, reduced-motion; no accelerators |
| 8 | Aesthetic and Minimalist Design | 2 | Consent front-loads ~13 blocks before one button; 3D view dense |
| 9 | Error Recovery | 3 | Retry + request IDs; aftermath of delete/regenerate silent |
| 10 | Help and Documentation | 2 | Inline explanations; nothing layered at decision points |
| Total | | 27/40 | Acceptable |

## Design Specificity Verdict

LLM: Genuinely authored for this product — honest state language, surfaced provenance/privacy minimization, non-mystifying tone. Coherence cracks at the vocabulary (Pattern/portrait/constellation/artwork/explorer) and at the portrait surface's private visual language.

Deterministic scan: 0 findings in all five TSX components; 33 advisory findings in CSS. pattern-portrait.css: 9 undocumented colors (#091923, #e5e8e5, #c2d1d7, #879ca8, #213b49, #e9cf96) + 21 font sizes off the DESIGN.md ramp (11-38px, clamp(31px,3.1vw,45px)). account-pattern-portrait.css: 0.5rem radius (breaks square rule) + 0.925rem type. No false positives.

## Overall Impression

The state machine is the star: every lifecycle state handled with honest copy and real a11y attributes. Biggest opportunity: consolidation — one vocabulary, one portrait implementation, tokenized night-stage palette.

## What's Working

1. Honest state language at high-stakes moments (regeneration survival, failure non-consumption, art-vs-sky disclaimer).
2. Graceful 3D degradation: WebGL/context/image/hash failures all fall back to readable chapters.
3. Real accessibility engineering: keyboard chapter index mirrors star picking, canvas role/labels, managed focus, SHA-256-verified assets.

## Priority Issues

[P1] Consent surface is a wall, not a staircase (PatternConsent.tsx:39-84). ~13 blocks before Generate. Fix: one-sentence lead + 4 collapsed sections (sent / never sent / training & retention / withdraw). Command: /impeccable distill

[P1] Fragmented object vocabulary (PatternPortrait/AccountPatternPortrait/AccountPortraitExplorer). Fix: two nouns — Pattern (text), constellation (visual); buttons "Explore your constellation" / "Back to reading". Command: /impeccable clarify

[P1] Portrait surface runs a private undocumented design system (pattern-portrait.css 31 findings; account-pattern-portrait.css 2). Fix: tokenize night stage as documented extension or remap to existing tokens; remove 0.5rem radius. Command: /impeccable extract

[P2] Type-to-confirm hostile to mobile/a11y (PatternExperience.tsx:80-81,143-186,287-332). Fix: case-insensitive or checkbox-enables-danger-button; keep consequence copy. Command: /impeccable adapt

[P2] Irreversible actions end silently; stale state can swallow errors (PatternExperience.tsx:533,469-522). Fix: role=status confirmations after delete/regenerate; render error banner alongside stale content. Command: /impeccable harden

## Persona Red Flags

Jordan (First-Timer): consent wall before value; "The first visit is the consent surface" frames first beat as compliance. Pre-generation abandonment risk.
Sam (Accessibility): exact-uppercase delete/regenerate phrases hardest for the promised data-control actions; star-tap selection not announced; #e9cf96 stage focus contrast unverified.
Casey (Mobile): typing REGENERATE MY PATTERN on phone; 5 camera buttons + index + legend + reader on small stage; WebGL + dual polling.

## Minor Observations

- "Delete this Pattern" uses button--secondary; should be Signal Coral danger (PatternExperience.tsx:334-336).
- Legend hardcodes "Four images" while explorer accepts 3-6 chapters (PatternPortrait.tsx:160).
- key={tension.text}/key={resource.text} React key collisions on duplicate AI strings (PatternExperience.tsx:56-68).
- Provenance "the model ({provider})" vs consent "Codex, run by OpenAI" — align.
- 2s + 3s fixed polling, no backoff, two timers for one operation.
- AccountPatternPortrait.tsx exports legacy + live explorer; file name misleads maintainers.
- Camera cluster: 5 visible options exceeds <=4 budget (PatternPortrait.tsx:141-147).
- "Tracing the four chapter images…" poetic but opaque loading state.

## Questions to Consider

- Consent: wall or staircase — progressive disclosure without hiding anything?
- Are Pattern/portrait/constellation/artwork four names for one idea?
- Is the night stage an intentional second vocabulary deserving tokens, or drift?
- Does type-to-confirm protect users or punish them?
- Should deletion offer an exit ritual (export first) rather than a typing test?
