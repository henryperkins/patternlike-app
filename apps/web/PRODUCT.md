# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pattern/Like is for individual adults using astrology for private self-reflection and day-to-day psychological timing. The primary user is examining their own natal pattern, current cycles, and daily themes; this is not a professional client-management product for astrologers.

Users need a coherent view of what may matter now, a way to revisit longer patterns and selected dates, and enough evidence to understand why an interpretation appeared. They should never need specialist astrology knowledge to use the product.

## Product Purpose

Pattern/Like combines stable natal patterns, temporary developmental cycles, a focused daily chapter, and a visible timeline. It exists to make astrology-informed reflection private, intelligible, and bounded by what the underlying calculation can actually support.

Success means a user can understand a relevant theme in plain language, inspect the facts and editorial sources behind it, see uncertainty instead of false precision, and retain clear control over their data.

## Positioning

Pattern/Like is calculated, not invented. Swiss Ephemeris establishes chart facts and interpretation eligibility; reviewed editorial material supplies the language; user context may rank or frame a valid interpretation but may never alter chart facts. Every substantive interpretation remains traceable to eligible facts and approved content versions.

## Operating Context

The product is a responsive web PWA used across desktop and mobile. A user signs in, provides a birth date and the most honest available birth-time accuracy, optionally supplies birthplace coordinates, reviews the resolved historical timezone, and explicitly permits chart calculation.

The core product loop spans Today, Your Pattern, Timing, Time Travel, and Context & Privacy. Users move between a focused daily chapter, stable chart material, active and upcoming cycles, date reconstruction, and controls for sources, export, and deletion. Plain-language interpretation is primary; astrological and technical evidence is available on demand.

## Capabilities and Constraints

- Swiss Ephemeris is the calculation authority, normalized through versioned application contracts.
- Exact, approximate, and unknown birth times are first-class inputs. Unsupported houses, angles, and time-sensitive claims must be suppressed or explicitly qualified.
- Every interpretive paragraph must resolve to eligible calculated facts and approved editorial content, or be explicitly identified as user context.
- Deterministic reviewed copy is the fallback when generated assembly is unavailable or invalid.
- User context can rank themes, select domains, adapt framing, or schedule delivery; it cannot change the chart or be presented as an astrological discovery.
- The product must not make predictive guarantees, diagnoses, causal claims, or claims that exceed the available birth data.
- Birth values and other private user content are encrypted at rest. Sensitive payloads do not belong in analytics, logs, or the editorial system.
- Users must be able to understand active data sources and request export or deletion without hidden state or misleading success messages.

## Brand Commitments

The product name is **Pattern/Like**. Its established verbal commitments are “Calculated, not invented” and “Private by design. Inspectable by default.”

The voice is calm, precise, direct, and non-mystifying. It leads with ordinary language, makes uncertainty visible, and avoids cosmic spectacle, prediction, diagnosis, gamification, and generic sign-based filler.

## Evidence on Hand

- `spec-bundle/pattern_like_astrology_app_product_platform_spec_v0.2.md` is the product and engineering baseline.
- `apps/web/src/App.tsx` and the components under `apps/web/src/components/` implement the signed-out, onboarding, chart, Today, Timing, Time Travel, and privacy surfaces.
- `apps/web/public/mark.svg` and `apps/web/public/manifest.webmanifest` contain the current product mark, name, and PWA metadata.
- Contract fixtures, calculation fingerprints, uncertainty metadata, and technical evidence exposed by the application support inspectability claims.
- No testimonials, named customers, usage benchmarks, pricing claims, clinical claims, or research validation are established in the repository; future work must not fabricate them.

## Product Principles

1. Facts before meaning: calculation and eligibility boundaries precede interpretation.
2. Honest uncertainty: reduce or qualify claims instead of manufacturing precision.
3. Private by design: minimize access, encrypt sensitive data, and keep control visible to the user.
4. Inspectable by default: explain why content appeared without forcing technical detail into the primary reading experience.
5. Context stays in its lane: personalization may frame valid material but never rewrite astrological facts.

## Accessibility & Inclusion

Target WCAG 2.2 AA across the responsive web PWA. Core workflows must remain usable by keyboard and assistive technology, preserve visible focus and semantic status/error communication, respect reduced-motion preferences, and avoid requiring astrology expertise or precise birth-time knowledge.
