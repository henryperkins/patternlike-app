# Pattern page: user experience review

Date: 2026-09-09. Status: review complete; implementation unchanged.

The Pattern page (`PatternExperience` and its portrait wrappers) has a strong, honest state machine and good accessibility intent, but the first-run experience is front-loaded with consent density, the object vocabulary is fragmented across components, and the portrait surface has drifted from the DESIGN.md system. None of the findings block task completion; three are high-leverage improvements to trust, learnability, and visual coherence.

## Scope and evidence

- Source review only; no live browser session was run in this pass. Prior visual evidence for the portrait surface exists in [2026-09-06-pattern-portrait-experience-review.md](2026-09-06-pattern-portrait-experience-review.md).
- Reviewed: [PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx), [PatternConsent.tsx](../../apps/web/src/components/PatternConsent.tsx), [PatternPortrait.tsx](../../apps/web/src/components/PatternPortrait.tsx), [PatternSculpture.tsx](../../apps/web/src/components/PatternSculpture.tsx), [AccountPatternPortrait.tsx](../../apps/web/src/components/AccountPatternPortrait.tsx), [AccountPortraitExplorer.tsx](../../apps/web/src/components/AccountPortraitExplorer.tsx), [pattern-portrait.css](../../apps/web/src/components/pattern-portrait.css), [account-pattern-portrait.css](../../apps/web/src/components/account-pattern-portrait.css), and the `.pattern-*` rules in [styles.css](../../apps/web/src/styles.css).
- Design context: `apps/web/PRODUCT.md`, `apps/web/DESIGN.md` (Private Observatory system).
- Automated design-system scan over the two portrait stylesheets returned 33 advisory findings (22 off-ramp font sizes, 9 undocumented colors, 1 off-scale radius). All TSX components scanned clean. No false positives identified.

## Findings, ordered by impact

### 1. High — the consent surface is a wall, not a staircase

On `consent_required` and `available`, the page renders a four-cell fact grid, a category list, and eight note paragraphs before the single Generate button ([PatternConsent.tsx](../../apps/web/src/components/PatternConsent.tsx#L39), [PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L624)). The content is accurate and matches the product's inspectability commitment, but the first emotional beat of the product is compliance. A first-time user must parse processor, generation service, purpose, policy version, categories, input minimization, exclusions, training limits, retention, revocation, non-rerollability, and permanent deletion before any value appears.

Recommendation: keep every fact, restructure disclosure. One lead sentence ("Pattern/Like will send minimized chart-derived facts to Codex, run by OpenAI, to write one Pattern for this chart — nothing else."), then four collapsed sections: what is sent, what is never sent, training and retention, withdrawing consent. The fact grid and mono policy version become the evidence layer, not the opening.

### 2. High — fragmented object vocabulary

The same artifact is called "Pattern", "portrait", "3D portrait", "constellation", "artwork", "reading", and "explorer" depending on which wrapper renders it:

- "Your constellation" / "View constellation" / "Download constellation" in [AccountPatternPortrait.tsx](../../apps/web/src/components/AccountPatternPortrait.tsx#L166)
- "Explore your 3D portrait" / "Loading your saved artwork" / "Retry artwork" in [AccountPortraitExplorer.tsx](../../apps/web/src/components/AccountPortraitExplorer.tsx#L198)
- "Pattern portrait" / "Complete Pattern reading" in [PatternPortrait.tsx](../../apps/web/src/components/PatternPortrait.tsx#L111)

A product whose promise is inspectability should not make the user reverse-engineer its object model. Choose two user-facing nouns and hold them everywhere: **Pattern** for the written reading, **constellation** for the visual instrument. Buttons then read "Explore your constellation" / "Back to reading"; "artwork" and "portrait" become internal/code terms only.

### 3. High — the portrait surface runs a private, undocumented design system

DESIGN.md defines the Observatory palette, type ramp, and square-components rule. [pattern-portrait.css](../../apps/web/src/components/pattern-portrait.css) introduces six undocumented colors — night stage `#091923`, `#e5e8e5`, `#c2d1d7`, `#879ca8`, `#213b49`, and gold focus `#e9cf96` (lines 13–24) — and 21 font sizes outside the documented ramp (11, 13, 15, 16, 18, 19, 23, 24, 25, 34, 38px, plus `clamp(31px, 3.1vw, 45px)`). [account-pattern-portrait.css](../../apps/web/src/components/account-pattern-portrait.css#L5) adds a `0.5rem` radius that violates the square rule.

The dark stage may be intentional — the observatory at night — but intent that is not written down is drift. Either tokenize it as a documented extension (`night-surface`, `on-night`, `night-focus`, portrait-specific type steps added to the DESIGN.md ramp) or remap the values onto existing tokens. The radius should go regardless.

### 4. Medium — type-to-confirm is hostile to mobile and assistive use

Deletion requires typing `DELETE PATTERN` and regeneration requires `REGENERATE MY PATTERN`, both exact-uppercase ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L80)). The seriousness is right; the mechanism is not. Exact-case typing is error-prone on phones, burdensome for motor-impaired users, and awkward under screen readers — and it makes exercising data control, the thing this product promises, physically harder than anything else on the page.

Recommendation: case-insensitive match at minimum, or replace with an "I understand this is permanent" checkbox that enables a danger-styled confirm button. Keep the consequence copy verbatim; it is excellent.

### 5. Medium — irreversible actions end silently, and stale state can swallow errors

After delete or regenerate, the UI increments `attempt` and relies on the refetch to produce the next state ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L469)). There is no explicit closure moment — no "Your Pattern was deleted" or "Update started; your current Pattern stays until the replacement passes checks" — even though the regeneration panel already contains that reassurance for the in-flight case.

Separately, the top-level error branch only renders when `!state || (state === "ready" && !document)` ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L533)). A failed background refresh on top of an existing state object sets `error` but shows nothing. Errors should render as a non-blocking banner alongside stale content, and destructive actions should announce their outcome via `role="status"`.

### 6. Low — minor observations

- "Delete this Pattern" uses `button--secondary` ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L334)); Signal Coral danger styling exists for exactly this.
- The legend hardcodes "Four images trace one connected constellation" ([PatternPortrait.tsx](../../apps/web/src/components/PatternPortrait.tsx#L160)) while the explorer accepts 3–6 chapters ([AccountPortraitExplorer.tsx](../../apps/web/src/components/AccountPortraitExplorer.tsx#L45)). Copy should follow the actual chapter count.
- `key={tension.text}` and `key={resource.text}` ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L56)) collide if AI output repeats a string; index-composite keys are safer.
- Provenance says "were not sent to the model ({provider})" ([PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L276)) while consent names "Codex, operated by OpenAI" ([PatternConsent.tsx](../../apps/web/src/components/PatternConsent.tsx#L16)); align the two phrasings.
- Two fixed polling intervals (2s for generation in `PatternExperience`, 3s for portrait status in the wrappers) with no backoff; one visible operation, two timers.
- The camera cluster exposes five visible options — rotate left/right, zoom in/out, reset ([PatternPortrait.tsx](../../apps/web/src/components/PatternPortrait.tsx#L141)) — over the ≤4 working-memory budget; group rotation/zoom or fold reset into a single control.
- "Tracing the four chapter images…" ([PatternSculpture.tsx](../../apps/web/src/components/PatternSculpture.tsx#L406)) is on-brand but opaque as a loading state; "Loading constellation images…" reads clearer.
- `AccountPatternPortrait.tsx` exports both the legacy constellation wrapper and the live explorer path; the filename now misleads maintainers.

## What's working

- **Honest state language at high-stakes moments.** "Your current Pattern stays readable until the replacement succeeds", "A failed attempt does not use up this chart's one Pattern", "Your Pattern was not changed." This is the brand voice doing real work.
- **Graceful degradation of the 3D layer.** WebGL failure, context loss, image load failure, and asset-hash mismatch all fall back to "you can still read every chapter" ([PatternSculpture.tsx](../../apps/web/src/components/PatternSculpture.tsx#L244), [AccountPortraitExplorer.tsx](../../apps/web/src/components/AccountPortraitExplorer.tsx#L201)). The reading is never gated by the spectacle.
- **Real accessibility engineering.** Keyboard chapter index mirrors star picking, the canvas carries `role="img"` with a descriptive label ([PatternSculpture.tsx](../../apps/web/src/components/PatternSculpture.tsx#L284)), focus is managed across the reading/constellation toggle, and SHA-256 verification of images and meshes backs the inspectability claim with code.

## Heuristic scores

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3/4 | Strong stage/polling states; background-refresh errors can be suppressed (#5) |
| 2 | Match between system and real world | 3/4 | Calm plain language; "processor", "policy version", "ontology unavailable" leak through |
| 3 | User control and freedom | 3/4 | Cancel/back/toggle throughout; no cancel-generation, no undo for delete |
| 4 | Consistency and standards | 2/4 | Vocabulary fragmentation (#2) and portrait design-system drift (#3) |
| 5 | Error prevention | 3/4 | Type-to-confirm and idempotency keys; exact-uppercase matching adds its own failure mode (#4) |
| 6 | Recognition rather than recall | 3/4 | Chapter index and tabs reduce recall; confirmation phrases force verbatim typing |
| 7 | Flexibility and efficiency of use | 3/4 | Reading/3D modes, keyboard access, reduced motion; no accelerators |
| 8 | Aesthetic and minimalist design | 2/4 | Consent wall (#1); 3D view presents stage + 5 controls + index + legend + reader at once |
| 9 | Error recovery | 3/4 | Retries and request IDs everywhere; destructive aftermath is silent (#5) |
| 10 | Help and documentation | 2/4 | Inline explanations exist; nothing layered or contextual at decision points |
| **Total** | | **27/40** | Acceptable — solid foundation, three high-leverage fixes |

## Persona red flags

- **Jordan (first-timer):** meets the consent wall before any value; the page literally announces "The first visit is the consent surface." Highest abandonment risk is pre-generation.
- **Sam (accessibility):** exact-uppercase confirmation phrases are the sharpest barrier to the two data-control actions; star-tap selection is not announced distinctly from the chapter index; the stage's gold focus color needs documented contrast verification.
- **Casey (mobile):** typing `REGENERATE MY PATTERN` on a phone keyboard, five camera buttons plus index and legend on a small stage, WebGL plus two polling timers on a long session. The "you can leave and come back" generation copy is the one element that respects this user.

## Recommended next steps

1. Restructure consent into layered disclosure (finding 1).
2. Unify user-facing vocabulary to Pattern + constellation (finding 2).
3. Tokenize the night stage in DESIGN.md or remap it; remove the off-scale radius (finding 3).
4. Replace or soften type-to-confirm (finding 4).
5. Add explicit post-action status and render refresh errors alongside stale content (finding 5).

A follow-up pass should re-score after 1–3; they carry most of the consistency and minimalism deficit.
