# Personable Daily Reading Design

**Status:** Approved in conversation on 2026-08-29.

## Goal

Make generated Daily readings warmer, more emotionally resonant, and as personally specific as the already-consented input permits, without weakening calculated-fact provenance or adding identity, behavioral-ranking, schema, database, UI, provider, or deployment scope.

## Writing contract

The Daily writer speaks like a warm, perceptive person addressing one reader directly. It starts with a plausible lived or emotional experience before technical astrology when the supplied material supports that move, uses natural cadence, and may be gently wry. Challenges are paired with compassion and agency.

Emotion remains invitational rather than asserted. The writer may say that the reader *may* notice or feel something; it must not claim certainty about feelings, manufacture familiarity, diagnose, use therapy-speak, or imply that the system knows the reader beyond the packet.

Personal calculated facts are the primary foundation. When consented context is present and has a compatible `allowed_use`, the writer should use one safe, concrete detail or constraint meaningfully in an eligible prose unit and let it shape the reading's throughline. Context never becomes astrological evidence. Prior readings are used only for continuity and repetition avoidance.

If a line could fit most readers, it should be rewritten around a supplied personal fact or eligible context. If the packet contains only collective facts and no eligible personal basis, the writer must identify the shared sky honestly instead of faking personalization.

Suggestions and the reflection question should be concrete, low-stakes, and connected to the supplied material. Avoid report-like prose, mystical theatrics, purple prose, canned reassurance, hype, generic affirmations, and rigid formula labels.

## Technical boundary

- Keep the existing `ReadingGenerationRequest` and output schema unchanged.
- Keep user-authored text isolated as JSON data in the provider request.
- Keep the existing validator, context `allowed_use` enforcement, provider, model, selection policy, and non-blocking qualitative publication tradeoff unchanged.
- Bump `READING_PROMPT_VERSION` from `1.0.1` to `1.0.2` for any policy wording change.
- Align the production Wrangler pin and every current-version test fixture with `1.0.2`.
- Increment the offline evaluation corpus to `1.0.2`, pin it to prompt `1.0.2`, and retain a clean synthetic candidate that demonstrates an emotional, context-specific throughline.
- Do not change historical contract fixtures whose `1.0.1` values remain valid evidence of the older prompt.
- Do not commit, push, merge, or deploy as part of this implementation.

## Verification

Run the focused Daily prompt, configuration, generation, and evaluation tests; the Wrangler configuration test; TypeScript typechecking; the build; and the repository merge gate `npm run ci:local` using the worktree-local `.venv` selected by that script.
