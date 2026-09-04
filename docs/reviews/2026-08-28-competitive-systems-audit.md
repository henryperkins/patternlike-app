# Competitive audit

Patternlike is already close to the evidence-bounded architecture proposed in the [competitive brief](./2026-08-28-competitive-systems-brief.md#7-a-more-defensible-architecture-for-this-category), but it is not close to feature parity with The Pattern, Co–Star, or Astro.com.

Its differentiator is a narrow, private, highly controlled self-reflection system: deterministic calculations, explicit uncertainty, bounded AI generation, consent, provenance, replay, export, and deletion. Its largest gaps are relationships/social features, conversational questions, attributable human interpretation material, full crisis/third-party safeguards, Astro.com-style configuration breadth, and proven general production availability.

## Scope caveat

I audited the current working tree at `9fc32dc25b77bdc2abf9288a533371094cd0813e`, including its uncommitted changes.

That checkout is `ahead 1, behind 10` relative to the locally known `origin/main` (`29ee03543f4186dbfbb4d57c5a420553a6928adb`). Those newer commits add persisted account-processing consent, Google place search/geocoding, crypto controls, and migrations 0018–0022. I did not fetch or switch branches, so findings below describe the checkout you gave me; the two location/consent gaps are already addressed on the newer local remote-tracking ref. Commit `9fc32dc` is not on `main`; the same change landed there as `29ee035`.

## Yes / partial / no matrix

| Dimension | Verdict | Patternlike today |
|---|---|---|
| Calculation separated from language generation | **Yes** | Swiss Ephemeris 2.10.03 calculates chart facts before any interpretation model runs. The wrapper, data files, body set, true node, orb policy, tropical/geocentric mode, and house behavior are pinned or recorded. See [engine.ts](../../apps/calc-stub/src/engine.ts#L1) and the [ephemeris lock](../../apps/calc-stub/ephemeris.lock.json#L2). |
| Exact, approximate, and unknown birth times | **Yes** | These are first-class inputs. Unknown time uses noon only for planetary computation and suppresses unsupported time-sensitive claims. |
| End-to-end place/time provenance | **Partial** | Coordinate-to-zone resolution is private and offline, with boundary and pre-1970 warnings. However, this checkout requires manual place/coordinate entry, uses a 2019b timezone-boundary raster, and relies on the runtime’s `Intl` database rather than a fully pinned historical atlas. See [timezone.ts](../../apps/api/src/services/timezone.ts#L13). |
| Core self-reflection product | **Yes in source; partial live** | Today, Your Pattern, Timing, Time Travel, chart evidence, and Context & Privacy exist—the five-view product loop defined in [AppShell.tsx](../../apps/web/src/components/AppShell.tsx#L4). |
| Relationships, compatibility, social graph | **No** | No Bonds, synastry, friend charts, romantic transits, shared experiences, community, or dating surface. This is consistent with the current self-only positioning in [PRODUCT.md](../../apps/web/PRODUCT.md#L11), but it is a substantial feature gap against The Pattern and Co–Star. |
| Open-ended astrology questions or chat | **No** | Nothing comparable to The Pattern’s In-Depth conversation or Co–Star’s Ask the Stars. Generation is product-initiated and schema-bounded. |
| Astro.com-style chart/report breadth | **No** | No professional chart-management workflow, report marketplace, extensive technique selection, or user-selectable house system. Patternlike fixes Placidus with Porphyry fallback. |
| Interpretation corpus | **Partial** | The corpus is immutable, hashed, versioned, rule-selected, and reviewable. But the current edition is model-generated first-party material—not a named, externally attributable human corpus—and counsel, generating-model provenance, and human editorial review remain open. The repository explicitly calls the grounding “self-referential” in the [corpus decision](../../pattern-corpus/ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md#L72). |
| Model and operational traceability | **Yes internally; partial for readers** | Frozen commands record chart, claim, corpus, ontology, consent, model, prompt, selection, and validation pins. Daily’s “Why this?” exposes unusually rich evidence. Your Pattern explicitly does **not** expose evidence per paragraph, as shown in [PatternExperience.tsx](../../apps/web/src/components/PatternExperience.tsx#L88). |
| Personalization | **Partial, deliberately bounded** | Enabled personal context may rank or frame valid material but cannot change chart facts. There is no opaque behavioral ranking, chat-history profile, social graph, or cross-user inference. That limits breadth while reducing privacy and manipulation risk. |
| Output safety | **Partial** | Structured-output validation, chart-fact enforcement, uncertainty rules, prohibited medical/legal/financial framing, and an independent Pattern semantic verifier are implemented. |
| Input/crisis/third-party safety | **No as a complete system** | There is no explicit self-harm classifier, crisis-resource routing, consequential-use enforcement, third-party subject consent, or policy governing employee/applicant/patient/student interpretations. The lack of open chat and relationship features currently reduces—but does not eliminate—this exposure. |
| Privacy and user control | **Mostly yes; partial in this checkout** | Separate Daily and Pattern consents, minimized model packets, encryption, revocation, export, deletion, and honest processor-retention language exist. The model is not sent birth date, birthplace, coordinates, or account ID. This checkout’s chart-processing consent ID is locally synthesized rather than durably granted; newer `origin/main` addresses that. See [AI consent](../../apps/web/src/components/AiConsent.tsx#L26) and [privacy routes](../../apps/api/src/routes/privacy.ts#L87). |
| Non-generative mode | **No** | There is no user-selectable deterministic-only interpretation mode. Failed AI generation fails closed rather than falling back to reviewed or templated copy. |
| Evaluation and replay | **Partial** | Internal calculation, corpus, schema, semantic, privacy, replay-ledger, and regression coverage is extensive. There is no public model card, external safety evaluation, interpretation-validity study, or public prompt/corpus/safety change log. Tests establish implementation behavior, not astrological validity. |
| General live availability | **Not proven** | Dated 2026-08-27 production evidence recorded 13 Daily readings and one accepted Pattern. That Pattern used an internal bypass subsequently removed; current account-wide source would refuse new generation until a public-capable ontology is active. The Daily runbook likewise says Codex/hybrid configuration is source state, not a verified deployment observation. See the [Pattern rollout record](../../docs/deploy/openai-pattern-rollout.md#L114) and [Daily rollout record](../../docs/deploy/openai-daily-reading-rollout.md#L1). |

## Direct comparison

- **Versus The Pattern:** Patternlike matches natal self-reading, transits/timing, and Time Travel, but lacks Bonds, romantic/shared experiences, audio depth, and open conversation. Patternlike exposes substantially more calculation, consent, prompt, model, and validation detail. The Pattern currently advertises the broader relationship/social surface and says its In-Depth model runs on its own hardware using its human-created material. [The Pattern product page](https://www.thepattern.com/), [official In-Depth description](https://thepattern.zendesk.com/hc/en-us/articles/42545042932628-In-Depth-AI-Conversation-Feature).

- **Versus Co–Star:** Patternlike is more conservative: no behavior ranking, social graph, or arbitrary questions, and its model cannot invent chart facts. Co–Star has the broader consumer loop and a publicly described crisis refusal/resource path that Patternlike lacks. Co–Star describes JPL-derived calculations, rule/NLG and GPT-like generation, a proprietary human-built database, Ask the Stars, and ranking based partly on prior behavior. [Co–Star FAQ](https://www.costarastrology.com/faq/), [Co–Star engineering description](https://www.costarastrology.com/jobs).

- **Versus Astro.com:** Patternlike shares the Swiss Ephemeris foundation and adds modern consented personalization plus per-reading runtime provenance. Astro.com remains broader in chart configuration, historical location infrastructure, authored reports, named interpretive authors, and deterministic expert-system synthesis. [Astro.com’s system history](https://www.astro.com/contact/contact_about_e.htm), [Swiss Ephemeris information](https://www.astro.com/swisseph/swephinfo_e.htm), [Astro.com atlas](https://www.astro.com/atlas), [house-system guidance](https://www.astro.com/faq/fq_fh_gen_j.htm).

## Most consequential gaps

1. **Release truth:** reconcile this checkout with the ten newer `origin/main` commits, then establish fresh authenticated production evidence for Daily and account-wide Pattern.
2. **Interpretation provenance:** replace or supplement the self-referential corpus with attributable human/editorial sources, complete legal review, and carry source IDs into each Pattern paragraph.
3. **Safety completeness:** add crisis detection/resource routing, third-party subject controls, and explicit prohibitions on consequential decisions before adding chat or relationship analysis.
4. **Reader-facing transparency:** bring Pattern up to Daily’s “Why this?” standard and publish model, prompt, corpus, and safety change evidence.
5. **Product-scope clarity:** decide whether the absence of relationships, social features, and open chat is deliberate positioning or deferred competitor parity. The current product contract strongly suggests it is deliberate.

## Verification

The focused command covering the relevant workspaces completed with exit code 0:

- **2,610 tests passed** across reading-engine, pattern-engine, calculation, API, M3 compatibility, model verification, ontology packaging/release verification, Wrangler configuration, and web.
- I did not run `npm run ci:local`, typecheck, build, browser-based UX verification, or fresh authenticated production checks.
- I made no repository edits. The existing dirty working tree was preserved.
- Prior-run memory was used only to locate dated provider history; current status claims were refreshed against the present source and deployment records.

Next action: decide whether relationships/social/chat are intentional exclusions; that determines whether the roadmap should deepen Patternlike’s evidence advantage or pursue consumer feature parity.

<oai-mem-citation>
<citation_entries>
MEMORY.md:315-323|note=[located prior Daily and Pattern diagnosis]
rollout_summaries/2026-08-27T07-41-48-d79j-codex_provider_daily_pattern_diagnosis_and_rollout_plans.md:15-27|note=[used dated provider architecture context before refreshing source]
</citation_entries>
<rollout_ids>
01a0422a-fe00-7213-b28a-b1eefb325bc5
</rollout_ids>
</oai-mem-citation>
