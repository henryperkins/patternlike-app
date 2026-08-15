# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pattern/Like is for individual adults using astrology for private self-reflection and day-to-day psychological timing. The primary user is examining their own natal pattern, current cycles, and daily themes; this is not a professional client-management product for astrologers.

Users need a coherent view of what may matter now, a way to revisit longer patterns and selected dates, and enough evidence to understand why an interpretation appeared. They should never need specialist astrology knowledge to use the product.

## Product Purpose

Pattern/Like combines stable natal patterns, temporary developmental cycles, a focused daily chapter, and a visible timeline. It exists to make astrology-informed reflection private, intelligible, and bounded by what the underlying calculation can actually support.

Success means a user can understand a relevant theme in plain language, inspect the calculated facts and uncertainty behind the chart, see why a daily reading appeared, and retain clear control over their data. AI-written Pattern chapters do not expose claim-level evidence to the reader; inspectability there is the chart facts, uncertainty, consent, and data controls.

## Positioning

Pattern/Like is calculated, not invented. Swiss Ephemeris establishes chart facts, the daily sky, and interpretation eligibility; a configured model writes the language of a daily reading under an explicit consent, within a closed set of supplied facts; user context may rank or frame a valid interpretation but may never alter chart facts. Every astrological statement in a published reading resolves to calculated evidence, and every reading records which model, prompt, and policy versions produced it.

The language of a daily reading is no longer reviewed editorial copy. That is a deliberate change, not a drift: the calculation, eligibility, consent, minimization, structured-output, deterministic-validation, and provenance controls are unchanged, and the reviewed-copy control over prose was removed in exchange for a reading that is genuinely about the reader's own day. Historical readings written by the earlier editorial pipeline remain readable exactly as they were published.

## Operating Context

The product is a responsive web PWA used across desktop and mobile. A user signs in, provides a birth date and the most honest available birth-time accuracy, optionally supplies birthplace coordinates, reviews the resolved historical timezone, and explicitly permits chart calculation.

The core product loop spans Today, Your Pattern, Timing, Time Travel, and Context & Privacy. Users move between a focused daily chapter, stable chart material, active and upcoming cycles, date reconstruction, and controls for sources, export, and deletion. Plain-language interpretation is primary; astrological and technical evidence is available on demand.

## Capabilities and Constraints

- Swiss Ephemeris is the calculation authority, normalized through versioned application contracts.
- Exact, approximate, and unknown birth times are first-class inputs. Unsupported houses, angles, and time-sensitive claims must be suppressed or explicitly qualified.
- The calculated daily sky — positions and lunar phase at the reader's local-day anchor, exact transit contacts inside that day, and collective sky events — is what makes a reading daily. It is calculated, never inferred by the model.
- Every astrological claim in a published reading cites the calculated fact behind it. A paragraph may be carried by permitted personal context instead, and then it claims nothing about the sky.
- A reading is written by a configured model and published only after deterministic validation. There is no reviewed-copy fallback, no previous-day reuse, no alternate model, and no second model reviewing the first daily reading: a reading that cannot be produced and validated says so honestly instead. Your Pattern is a separate publication contract: a planner pass, a frozen plan, a writer pass, deterministic validation, and an independent semantic verifier, published only as a complete document.
- Sending anything to a model requires an explicit consent for that purpose. Daily readings use AI-synthesis consent. Your Pattern uses a separate Pattern-generation consent. Both are separate from research and model-training consent and are revocable at any time. Revoking stops future generation of that kind; it does not rewrite a reading or Pattern already published.
- The model receives an accuracy label, the derived uncertainty, calculated facts, confirmed locale and local date, and the personal context the reader enabled. It never receives the birth instant, birthplace, coordinates, scheduling zone, account identifiers, or security material.
- User context can rank themes, select domains, adapt framing, or schedule delivery; it cannot change the chart or be presented as an astrological discovery.
- The product must not make predictive guarantees, diagnoses, causal claims, or claims that exceed the available birth data.
- Birth values and other private user content are encrypted at rest. Sensitive payloads do not belong in analytics, logs, or the editorial system.
- Users must be able to understand active data sources and request export or deletion without hidden state or misleading success messages.
- A published reading is stable for its local day. New context, feedback, ordinary preference changes, and consent revocation affect future readings. Only a factual invalidation — a corrected birth profile, a corrected chart, a calculation defect — may remove a published reading from Today before a successor exists, and only for readings the model wrote.

## Brand Commitments

The product name is **Pattern/Like**. Its established verbal commitments are “Calculated, not invented” and “Private by design. Inspectable by default.”

The voice is calm, precise, direct, and non-mystifying. It leads with ordinary language, makes uncertainty visible, and avoids cosmic spectacle, prediction, diagnosis, gamification, and generic sign-based filler.

## Evidence on Hand

- `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.5.md` is the current product and engineering specification. The v0.2 bundle beside it is the superseded baseline and is kept, unedited, as a truthful record of the editorial-assembly architecture.
- `apps/web/src/App.tsx` and the components under `apps/web/src/components/` implement the signed-out, onboarding, chart, Today, Timing, Time Travel, and privacy surfaces.
- `apps/web/public/mark.svg` and `apps/web/public/manifest.webmanifest` contain the current product mark, name, and PWA metadata.
- Contract fixtures, calculation fingerprints, uncertainty metadata, and technical evidence exposed by the application support inspectability claims.
- No testimonials, named customers, usage benchmarks, pricing claims, clinical claims, or research validation are established in the repository; future work must not fabricate them.

## Product Principles

1. Facts before meaning: calculation and eligibility boundaries precede interpretation, and the model is given facts rather than trusted to produce them.
2. Honest uncertainty: reduce or qualify claims instead of manufacturing precision.
3. Private by design: minimize access, encrypt sensitive data, and keep control visible to the user.
4. Inspectable by default: explain why calculated facts and daily readings appeared without forcing technical detail into the primary reading experience. AI-written Pattern paragraphs do not carry a claim-level “Why this?” disclosure; the chart facts, uncertainty, and data controls remain inspectable.
5. Context stays in its lane: personalization may frame valid material but never rewrite astrological facts.

## Accessibility & Inclusion

Target WCAG 2.2 AA across the responsive web PWA. Core workflows must remain usable by keyboard and assistive technology, preserve visible focus and semantic status/error communication, respect reduced-motion preferences, and avoid requiring astrology expertise or precise birth-time knowledge.
