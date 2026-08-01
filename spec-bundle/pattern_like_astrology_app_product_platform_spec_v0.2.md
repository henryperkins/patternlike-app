# Pattern-Like Astrology App
## Product, UX, Data, and Platform Design Specification

**Version:** 0.2  
**Date:** July 30, 2026  
**Status:** Product and engineering baseline  
**Calculation authority:** Swiss Ephemeris  
**Architecture profile:** Cloudflare-first, WordPress.com editorial control plane, Fly.io portable compute option

> The app presents private psychological timing as a sequence of inspectable natal patterns and active cycles. Celestial calculations establish eligibility. User context may rank, frame, or schedule a valid interpretation, but it may not alter chart facts or be presented as something astrology independently discovered.

## 1. Executive architecture decision

Launch without making Fly.io part of the critical path:

- **Cloudflare:** application runtime, API, durable workflows, queues, operational data, object storage, Swiss Ephemeris container, and privacy-bounded AI routing.
- **WordPress.com:** interpretation authoring, editorial review, release packaging, public help/policy content, and contributor workflow.
- **Fly.io:** deployable mirror of the native calculation image, optional warm compute, backfills, and a future Managed Postgres migration target.
- **Clients:** iOS/Android application plus an account/evidence web surface.

The launch database is D1 with application-layer envelope encryption. The calculation container is packaged as a portable OCI image so it can move to Fly Machines without changing the calculation contract.

## 2. Product definition

The app combines stable natal patterns, temporary developmental cycles, today's most relevant expression, and a visible timeline. The interface is plain-language first and astrology-transparent on demand.

### Primary navigation

| Surface | Purpose | Required elements |
| --- | --- | --- |
| Today | One coherent daily chapter | Primary theme, supporting influence, reflection, cycle phase, Why this? |
| Your Pattern | Stable natal profile | Integrated pattern chapters, resources, tensions, evidence |
| Timing | Active and upcoming cycles | Start, exact pass(es), end, phase, related readings |
| Time Travel | Reconstruct a selected date | Dominant cycles, phase state, saved context, comparison to present |
| Context & Privacy | User control | Permissions, source freshness, memory, export, deletion, AI settings |

## 3. Product and interpretation contract

- Swiss Ephemeris outputs are normalized into an app-owned, versioned calculation contract.
- Unknown birth time is a first-class mode; houses, angles, and unstable Moon claims are disabled or qualified.
- The language model is optional and subordinate. It receives calculated facts and approved editorial fragments, never raw authority to invent astrology.
- Every paragraph is linked to eligible facts and content versions. Context-only statements are labeled as context.
- Deterministic reviewed copy is the fallback for every generation failure.

## 4. Experience design

The design should feel private, quiet, and precise rather than cosmic, predictive, or gamified. It uses restrained motion, generous whitespace, a readable serif for interpretations, sans-serif for controls, and monospaced technical evidence.

### Core screen requirements

| Screen | Primary content | Key interaction | Failure/uncertainty treatment |
| --- | --- | --- | --- |
| Today | One major cycle and at most one supporting influence | Save, reflect, open evidence | Use deterministic copy; never show a blank day |
| Cycle detail | Long-form phase-aware interpretation | Move across exact passes and related readings | Expose missing birth-time effects |
| Your Pattern | 20-30 reviewed integrated pattern families at launch | Open chapter evidence and counter-expression | Do not fill gaps with generic Sun-sign copy |
| Timing | Active, approaching, exact, reconsidering, integrating | Filter by domain and duration | Show calculation status and last refresh |
| Time Travel | Cycle state for a chosen date | Compare date to now | Distinguish saved context from retrospective reconstruction |
| Privacy center | All active sources and allowed uses | Pause, revoke, delete, reset personalization | Revocation takes effect before next reading |

## 5. Automatable data-source model

The normative registry contains **139 sources and policy exclusions** across seven classes. **54 non-excluded sources are assigned to launch.** The YAML registry remains the machine-readable source of truth.

| Category | Entries | Implementation default |
| --- | --- | --- |
| A. Calculation authority and astrological sources | 20 | cloudflare-api-worker |
| B. First-party, user-owned sources | 24 | cloudflare-api-worker + workflow |
| C. Device and operating-system sources | 17 | mobile-client; cloudflare-api-worker receives minimized aggregate |
| D. Linked cloud-service sources | 20 | cloudflare-connector-worker + workflow |
| E. Public and ambient sources | 12 | cloudflare-connector-worker |
| F. Derived and inferred features | 22 | cloudflare-workflow + deterministic rules package |
| G. Deliberately excluded sources and uses | 24 | none |

### Evidence lanes

| Lane | May influence | Must never do |
| --- | --- | --- |
| Celestial facts | Chart facts, cycle timing, interpretation eligibility | Diagnose, guarantee an event, or claim causation |
| User/context signals | Rank themes, select domain, adapt tone/prompt, schedule delivery | Change the chart or be laundered as a prediction |
| Operational signals | Localize, cache, retry, gate, deliver, audit | Alter interpretive substance |

## 6. Platform architecture

### Service responsibility matrix

| Platform | Required at launch | Responsibilities | Explicit boundary |
| --- | --- | --- | --- |
| Cloudflare | Yes | Workers API, Workflows, Queues, D1, R2, cache, Swiss Container, observability | No raw private content in analytics; AI logs off for private synthesis |
| WordPress.com | Yes | Editorial CMS, content review, signed release bundles, public site | No user birth, journal, relationship, health, or reading records |
| Fly.io | No; deployment-ready | Warm native compute, backfills, optional Managed Postgres | Not in the launch request path unless a documented trigger is met |

### Cloudflare component assignment

| Component | Service | Responsibility |
| --- | --- | --- |
| Public/account web | Workers + Vite | PWA, evidence pages, settings, support |
| API edge | Worker | Authn/authz, consent, validation, idempotency, rate limits |
| Durable processes | Workflows | Chart calculation, daily reading, content release, export/delete |
| Fan-out | Queues | Due-user jobs, connector refreshes, notifications, DLQ |
| Calculation | Container | Pinned Swiss Ephemeris runtime and data files |
| Operational records | D1 | Encrypted profiles, facts, cycles, readings, consent, evidence |
| Objects | R2 | Signed content bundles, renders, exports, immutable artifacts |
| Optional LLM routing | AI Gateway | Provider routing/fallbacks with private logging disabled |
| Metrics | Analytics Engine | Latency, failures, coverage, costs; no private payloads |
| Secrets | Worker secrets / Secrets Store | Root keys, provider tokens, signing keys |

### WordPress.com editorial model

- A custom plugin registers REST-enabled content types for natal patterns, timing cycles, phase variants, domain modifiers, reflection prompts, safety rules, and release records.
- WordPress is the authoring and review surface, not the runtime source of truth.
- A release action validates the content graph, creates a signed JSON bundle, and calls a Cloudflare ingestion endpoint.
- Cloudflare verifies the signature, stores the bundle in R2, runs smoke tests, and atomically activates the release pointer.
- Rollback changes the active release pointer; it does not require editing previously published readings.

### Fly.io role

- Keep the calculation image runnable on Fly Machines from the first tagged release.
- Use an always-warm Fly Machine only if measured Cloudflare Container start latency harms the reading SLO.
- Use Fly Machines for backfills or long migrations that should not compete with interactive jobs.
- Consider Fly Managed Postgres only after a documented database trigger; place a Fly-hosted service in front of the private database rather than exposing the database directly to clients.

## 7. Core workflows

### Birth onboarding and chart calculation

1. Client collects birth date, time-accuracy class, time, and selected birthplace.
2. API validates consent and writes an encrypted pending profile.
3. Workflow resolves coordinates, historical time zone, and UTC birth instant.
4. Swiss container calculates the chart under a pinned contract.
5. Application derives natal aspects and structural patterns.
6. The workflow stores an immutable chart snapshot and exposes a user-readable uncertainty report.

### Daily reading generation

1. Scheduler enqueues due users by local date and notification window.
2. Workflow loads chart facts, active cycles, consent state, fresh context signals, and active editorial release.
3. Eligibility rules select only content supported by calculated facts and uncertainty constraints.
4. Ranking chooses one major theme and at most one supporting influence.
5. Approved fragments are assembled deterministically or lightly edited through a constrained model.
6. Validation checks schema, provenance, dates, unsupported facts, fatalism, diagnosis, and source laundering.
7. Reading and evidence graph are written idempotently; notification is scheduled afterward.

### Content publication

1. Editor updates content in WordPress.com.
2. Plugin validates required fields, references, prohibited claims, and semantic versioning.
3. Authorized reviewer approves a release.
4. Plugin signs and submits the bundle to Cloudflare.
5. Cloudflare stores the immutable bundle, validates fixtures, optionally refreshes editorial embeddings, and activates or rejects the release.

### Export and deletion

1. User requests export or deletion from the privacy center.
2. Workflow freezes new jobs and revokes active connector tokens.
3. Export composes a portable archive in R2 with a short-lived download URL.
4. Deletion removes active rows and destroys the per-user data-encryption key.
5. Backup copies may still contain ciphertext, but crypto-shredding prevents recovery without the destroyed key.

## 8. Data architecture

Use queryable metadata plus encrypted payloads. D1 stores stable identifiers, state, dates, versions, and hashes in clear application columns; birth values, journal text, relationship data, private context, and generated prose are encrypted with a per-user data-encryption key.

### Core entities

`users`, `identities`, `consents`, `birth_profiles`, `chart_snapshots`, `natal_features`, `cycle_instances`, `context_signals`, `content_releases`, `daily_readings`, `reading_sources`, `reading_feedback`, `device_tokens`, `connector_accounts`, `jobs`, `audit_events`

### Encryption model

- Generate one random DEK per user.
- Encrypt sensitive fields with authenticated encryption and unique nonces.
- Wrap the DEK with a versioned root key held in Cloudflare secrets.
- Store only the wrapped DEK in D1.
- Rotate root keys by rewrapping DEKs, not decrypting user records.
- Deletion destroys the wrapped DEK and active derived copies.

## 9. API surface

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /v1/birth-profiles | Create/update a birth profile and start calculation |
| GET | /v1/chart | Return normalized natal facts and uncertainty summary |
| GET | /v1/readings/today | Return the local-date daily reading |
| GET | /v1/readings/{id}/evidence | Return fact/content/context provenance |
| GET | /v1/pattern | Return stable natal pattern chapters |
| GET | /v1/timing | Return active and upcoming cycle instances |
| GET | /v1/time-travel?date= | Reconstruct a selected date |
| POST | /v1/check-ins | Store an explicit short-lived context signal |
| POST | /v1/readings/{id}/feedback | Record structured reading feedback |
| GET/PUT | /v1/context-sources | Inspect, enable, pause, or revoke sources |
| POST | /v1/exports | Start account export |
| DELETE | /v1/account | Start deletion workflow |
| POST | /internal/content-releases | Receive signed WordPress release bundles |

All mutating endpoints require an idempotency key. Queue consumers and Workflows must use the same key as a uniqueness constraint because queue delivery is at least once.

## 10. Reading assembly and AI boundary

The default renderer is deterministic. Optional model use is limited to transitions, compression, and repetition reduction over approved fragments.

The model request may contain calculated fact IDs, phase, approved fragment IDs/text, minimal user-declared domain preferences, and output schema. It must not contain raw health records, full calendar events, raw device history, stable direct identifiers, or unreviewed source text.

AI Gateway logging is disabled for private synthesis requests. The application records only provider/model ID, latency, token counts, route version, validation result, and response hash.

## 11. Security, privacy, and governance

| Risk | Required control |
| --- | --- |
| Birth/journal data exposure | Envelope encryption, least-privileged APIs, no sensitive logs, short-lived support access |
| Context laundering | Evidence-lane labels and paragraph-level provenance |
| Queue duplicate | Idempotency keys and unique database constraints |
| WordPress compromise | Signed immutable bundles; WordPress cannot read or write user data |
| Model hallucination | Eligibility allowlist, structured output, deterministic validation and fallback |
| Connector overreach | Narrow scopes, explicit allowed uses, freshness/consent checks before every job |
| Staff access | Role-separated editorial and operations access; production support access audited |
| Deletion vs backups | Per-user crypto-shredding plus active-row deletion |

## 12. Reliability and observability

| Target | Launch objective | Measurement |
| --- | --- | --- |
| API availability | 99.9% monthly | Cloudflare request and error metrics |
| Daily reading readiness | 99% ready before the user notification window | Workflow completion by local date |
| No duplicate published reading | 100% | Unique user/local-date/release key |
| Calculation reproducibility | Byte-stable normalized facts for golden fixtures | Container digest and chart fingerprint |
| Content rollback | Under 10 minutes | Release pointer rollback drill |
| Revocation enforcement | Before next source read or reading job | Consent-state test and audit event |
| Deletion completion | Within 24 hours | Workflow completion and key-destruction proof |

Operational telemetry goes to Analytics Engine or platform logs without prompt, response, journal, birth, OAuth payload, or relationship content. Error events use opaque user/job IDs and source error classes.

## 13. Scale and migration triggers

| Trigger | Action |
| --- | --- |
| Cloudflare Container p95 start/compute time misses the reading SLO | Keep a warm Fly Machine or move bulk calculation jobs to Fly |
| D1 shard approaches operational limit or queries require complex relational reporting | Introduce Fly Managed Postgres and a Fly-hosted data API |
| Editorial bundle lookup or semantic search becomes slow | Use R2/KV release cache; optionally Vectorize approved content only |
| LLM spend or provider errors become material | Use AI Gateway route budgets, fallbacks, and version rollback |
| External connector failures create backlog | Use per-connector queues, retry delays, circuit breakers, and DLQs |

## 14. Delivery sequence

### Milestone 0 - contracts and licensing

- Resolve Swiss Ephemeris licensing before public activation.
- Freeze calculation, orb, uncertainty, content, and evidence schemas.
- Create the monorepo, CI, OCI build, environments, and secret policy.

### Milestone 1 - chart integrity

- Birth onboarding and historical time-zone normalization.
- Swiss container, golden fixtures, unknown-time mode, chart snapshot and fingerprint.
- Minimal account and privacy center.

### Milestone 2 - editorial control plane

- WordPress.com plugin and content types.
- Validation, approval, signed bundles, Cloudflare ingestion, release rollback.

### Milestone 3 - daily product loop

- Cycle detection, ranking, deterministic reading assembly, evidence drawer, history, notifications, feedback.

### Milestone 4 - context and Time Travel

- Explicit priorities, check-ins, life events, journal themes, free/busy, weather/daylight, source controls, date reconstruction.

### Milestone 5 - optional intelligence

- Constrained model editing, editorial semantic retrieval, advanced timing techniques, Bonds only after the individual product is stable.

## 15. Launch acceptance criteria

- A chart generated from a golden fixture matches the expected normalized snapshot and fingerprint.
- Unknown and approximate birth times suppress or qualify time-sensitive claims.
- Every daily paragraph resolves to at least one calculated fact and approved content version, or is explicitly labeled as user context.
- Revoked/stale signals are excluded from the next reading.
- WordPress release activation and rollback are atomic and auditable.
- Queue redelivery cannot create duplicate readings or notifications.
- Model failure or validation rejection always produces reviewed deterministic copy.
- Export and deletion workflows complete in staging, including connector revocation and DEK destruction.
- No source outside the registry can enter reading assembly.

## 16. Open decisions

- Consumer identity provider and passkey/magic-link implementation.
- Final visual name and design system.
- Residence-location policy for solar returns and relocation features.
- Whether constrained LLM editing ships at launch or after deterministic content coverage is measured.
- Data-region commitments and whether users can select a region.
- Exact threshold for D1-to-Postgres migration.
- Push notification vendor and delivery analytics policy.

## 17. Data-source registry summary

Entries by category: {'A. Calculation authority and astrological sources': 20, 'B. First-party, user-owned sources': 24, 'C. Device and operating-system sources': 17, 'D. Linked cloud-service sources': 20, 'E. Public and ambient sources': 12, 'F. Derived and inferred features': 22, 'G. Deliberately excluded sources and uses': 24}

Status/phase counts: {('required', 'launch'): 32, ('recommended', 'launch'): 20, ('recommended', 'phase_1'): 8, ('optional', 'phase_2'): 18, ('optional', 'phase_3'): 3, ('optional', 'launch'): 2, ('optional', 'phase_1'): 13, ('restricted', 'phase_2'): 9, ('experimental', 'experiment'): 7, ('required', 'phase_1'): 1, ('excluded', 'never'): 25, ('experimental', 'phase_2'): 1}

The complete registry is delivered as `pattern_like_astrology_app_data_source_registry_v0.2.yaml`. Each source now includes an implementation owner, primary runtime, storage targets, and delivery path.

## 18. Official technical references

- **CF-01 - Cloudflare: Containers overview.** Native/full-runtime compute integrated with Workers. https://developers.cloudflare.com/containers/
- **CF-02 - Cloudflare: Containers connections to Workers bindings.** Container access to D1, R2, KV, Durable Objects, and other bindings. https://developers.cloudflare.com/containers/platform-details/workers-connections/
- **CF-03 - Cloudflare: Workflows overview.** Durable multi-step execution, retries, waits, and state. https://developers.cloudflare.com/workflows/
- **CF-04 - Cloudflare: Queues overview.** Guaranteed delivery, batching, retries, delays, and dead-letter handling. https://developers.cloudflare.com/queues/
- **CF-05 - Cloudflare: Queues delivery guarantees.** At-least-once delivery and idempotency requirements. https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- **CF-06 - Cloudflare: D1 overview.** Serverless SQLite-compatible operational database and read replication. https://developers.cloudflare.com/d1/
- **CF-07 - Cloudflare: D1 Time Travel and backups.** Point-in-time recovery within the documented retention window. https://developers.cloudflare.com/d1/reference/time-travel/
- **CF-08 - Cloudflare: R2 data security.** Automatic encryption at rest and TLS in transit. https://developers.cloudflare.com/r2/reference/data-security/
- **CF-09 - Cloudflare: AI Gateway logging.** Prompt/response logging controls and per-request override. https://developers.cloudflare.com/ai-gateway/observability/logging/
- **CF-10 - Cloudflare: AI Gateway dynamic routing.** Versioned routing, fallbacks, quotas, budgets, and rollback. https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/
- **CF-11 - Cloudflare: Secrets Store overview.** Account-level encrypted secrets; currently documented as open beta. https://developers.cloudflare.com/secrets-store/
- **CF-12 - Cloudflare: Workers Analytics Engine.** High-cardinality operational metrics without storing private payloads. https://developers.cloudflare.com/analytics/analytics-engine/
- **CF-13 - Cloudflare: Vectorize overview.** Optional semantic retrieval for approved editorial content. https://developers.cloudflare.com/vectorize/
- **CF-14 - Cloudflare: Vite plugin for Workers.** Web app and Worker development in a production-compatible runtime. https://developers.cloudflare.com/workers/vite-plugin/
- **WP-01 - WordPress.com: Use your plugins.** Custom plugin deployment is available on paid WordPress.com plans. https://wordpress.com/support/plugins/use-your-plugins/
- **WP-02 - WordPress.com: REST API.** Content, taxonomy, media, users, and authenticated API access. https://developer.wordpress.com/docs/api/
- **WP-03 - WordPress.com: OAuth2 authentication.** Scoped WordPress.com and Jetpack API authorization. https://developer.wordpress.com/docs/api/oauth2/
- **WP-04 - WordPress.org: REST support for custom content types.** Custom post type and taxonomy exposure through REST. https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-rest-api-support-for-custom-content-types/
- **FLY-01 - Fly.io: Fly Machines.** Fast-starting VM/container runtime with lifecycle and region control. https://fly.io/docs/machines/
- **FLY-02 - Fly.io: Autostop/autostart Machines.** Scale-to-idle behavior for variable workloads. https://fly.io/docs/launch/autostop-autostart/
- **FLY-03 - Fly.io: Managed Postgres.** Managed HA PostgreSQL, backups, encryption, monitoring, and pooling. https://fly.io/docs/mpg/
- **FLY-04 - Fly.io: Managed Postgres client configuration.** Pooled/direct connections and PgBouncer constraints. https://fly.io/docs/mpg/client-configuration/
- **FLY-05 - Fly.io: Private networking.** Private service-to-service networking inside Fly organizations. https://fly.io/docs/networking/private-networking/
- **FLY-06 - Fly.io: Secrets and Fly Apps.** Encrypted application secrets injected at Machine startup. https://fly.io/docs/apps/secrets/
- **SE-01 - Astrodienst: Swiss Ephemeris official repository and releases.** Pinned engine and data files; official release metadata. https://github.com/aloistr/swisseph
- **SE-02 - Astrodienst: Swiss Ephemeris Programming Interface.** Calculation flags, houses, polar fallback, and dual-license requirements. https://www.astro.com/swisseph-download/doc/swephprg.2.10.htm

## Implementation note

This document is a product and engineering specification, not legal advice. Swiss Ephemeris licensing, privacy law, app-store review, provider terms, security review, and any research protocol require separate review before public launch.
