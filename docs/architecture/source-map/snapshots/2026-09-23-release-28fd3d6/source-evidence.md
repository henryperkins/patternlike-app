# Source evidence

Scope: referenced files and map inputs only. This is not repository, release, editorial, or production certification. See [capture context and complete file identities](source-snapshot.json).

<a id="claim-leaf-application-and-navigation-1"></a>
- [App\.tsx routes six authenticated views by URL hash, defaulting to the pattern view, and AppShell\.tsx labels their navigation Today, History, Your pattern \(Pattern on mobile\), Timing, Time travel, and Privacy\. The \#deletion\-status route renders DeletionStatusView outside the shell with or without a session; on any other route a signed\-out caller gets the SignedOut screen, also outside the shell\.](patternlike-source-mindmap.md#claim-leaf-application-and-navigation-1) — [evidence-apps-web-app-tsx](#evidence-evidence-apps-web-app-tsx) [evidence-b1-app-default-view](#evidence-evidence-b1-app-default-view) [evidence-b1-appshell-nav-labels](#evidence-evidence-b1-appshell-nav-labels) [evidence-b1-appshell-mobile-pattern-label](#evidence-evidence-b1-appshell-mobile-pattern-label) [evidence-b1-app-signed-out](#evidence-evidence-b1-app-signed-out) [evidence-b1-deletion-status-route-first](#evidence-evidence-b1-deletion-status-route-first)

<a id="claim-leaf-application-and-navigation-2"></a>
- [Onboarding saves calculation permission, then submits birth details with that consent id\. A frozen account, or one with a chart but no current calculation permission, gets AccountAccessRecovery; an account state that cannot be read or reconciled still offers export, deletion, and sign out; deletion status has its own screen\.](patternlike-source-mindmap.md#claim-leaf-application-and-navigation-2) — [evidence-b1-onboarding-grant](#evidence-evidence-b1-onboarding-grant) [evidence-b1-onboarding-profile-consent](#evidence-evidence-b1-onboarding-profile-consent) [evidence-b1-app-access-recovery](#evidence-evidence-b1-app-access-recovery) [evidence-b1-app-unavailable-controls](#evidence-evidence-b1-app-unavailable-controls) [evidence-app-sign-out](#evidence-evidence-app-sign-out) [evidence-deletion-status-view](#evidence-evidence-deletion-status-view)

<a id="claim-leaf-today-and-history-1"></a>
- [Today shows the reading for the current local day in the reader's scheduling time zone, sets any reflection apart as an aside, and offers an evidence explanation and a save control\. Every paragraph carries a Where this connects link, and the reading ends with the response card and then the optional check\-in\.](patternlike-source-mindmap.md#claim-leaf-today-and-history-1) — [evidence-b1-today-local-date](#evidence-evidence-b1-today-local-date) [evidence-b1-today-article-check-in](#evidence-evidence-b1-today-article-check-in) [evidence-b1-reflection-tone-v3](#evidence-evidence-b1-reflection-tone-v3) [evidence-b1-reflection-tone-v5](#evidence-evidence-b1-reflection-tone-v5) [evidence-b1-article-reflection](#evidence-evidence-b1-article-reflection) [evidence-b1-article-why-this](#evidence-evidence-b1-article-why-this) [evidence-b1-article-save](#evidence-evidence-b1-article-save) [evidence-b1-article-paragraph-connection](#evidence-evidence-b1-article-paragraph-connection) [evidence-b1-article-response-card](#evidence-evidence-b1-article-response-card)

<a id="claim-leaf-today-and-history-2"></a>
- [History lists one readable edition per local date, newest first, and a Saved view ordered by save time\. Opening an item fetches that exact reading into the shared article, without the check\-in, showing its historical date, revision status, and stored evidence\.](patternlike-source-mindmap.md#claim-leaf-today-and-history-2) — [evidence-b1-history-filters](#evidence-evidence-b1-history-filters) [evidence-b1-history-canonical-order](#evidence-evidence-b1-history-canonical-order) [evidence-b1-history-saved-order](#evidence-evidence-b1-history-saved-order) [evidence-b1-history-open-reading](#evidence-evidence-b1-history-open-reading) [evidence-b1-history-article](#evidence-evidence-b1-history-article) [evidence-b1-article-historical-date](#evidence-evidence-b1-article-historical-date) [evidence-b1-article-revision-status](#evidence-evidence-b1-article-revision-status) [evidence-b1-reading-evidence-route](#evidence-evidence-b1-reading-evidence-route)

<a id="claim-leaf-today-and-history-3"></a>
- [Every Today and History reading ends with ReadingResponseCard, and only Today adds the check\-in\. The card offers a Report a problem form with an optional note, a My birth details are wrong link to birth correction in Privacy, and a collapsed Say how it landed overall form; that older resonance form appears alone when response options return 404\.](patternlike-source-mindmap.md#claim-leaf-today-and-history-3) — [evidence-b1-article-response-card](#evidence-evidence-b1-article-response-card) [evidence-b1-today-article-check-in](#evidence-evidence-b1-today-article-check-in) [evidence-b1-history-article](#evidence-evidence-b1-history-article) [evidence-b1-response-report-heading](#evidence-evidence-b1-response-report-heading) [evidence-b1-response-note](#evidence-evidence-b1-response-note) [evidence-b1-response-birth-correction](#evidence-evidence-b1-response-birth-correction) [evidence-b1-response-overall](#evidence-evidence-b1-response-overall) [evidence-b1-response-legacy](#evidence-evidence-b1-response-legacy)

<a id="claim-leaf-today-and-history-5"></a>
- [Today sends PUT /v1/readings/today only for a new preparation request, starting on first load; polling, Check again, and other reloads use GET /v1/readings/today\. If a refresh fails with a generic error while a reading is shown, the reading stays \(not for 401, 403, 404, 409, or 410\) and a status line offers Check again\.](patternlike-source-mindmap.md#claim-leaf-today-and-history-5) — [evidence-b1-today-ensure-first-load](#evidence-evidence-b1-today-ensure-first-load) [evidence-b1-today-put-then-get](#evidence-evidence-b1-today-put-then-get) [evidence-b1-api-ensure-today-put](#evidence-evidence-b1-api-ensure-today-put) [evidence-b1-api-get-today](#evidence-evidence-b1-api-get-today) [evidence-b1-today-reload-get](#evidence-evidence-b1-today-reload-get) [evidence-b1-today-resume-preparation](#evidence-evidence-b1-today-resume-preparation) [evidence-b1-today-keep-reading](#evidence-evidence-b1-today-keep-reading) [evidence-b1-today-status-line](#evidence-evidence-b1-today-status-line)

<a id="claim-leaf-passage-connections-1"></a>
- [ReadingConnections wraps the shared article, so every Today and History paragraph carries Where this connects, which opens that passage's supported links, each with a stated reason\. Opening the link list and each link pushes a history entry, so Back to where you were and the browser Back button step back through the link list to the passage\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-1) — [evidence-b1-article-connections-wrapper](#evidence-evidence-b1-article-connections-wrapper) [evidence-b1-connections-link](#evidence-evidence-b1-connections-link) [evidence-b1-connections-reason](#evidence-evidence-b1-connections-reason) [evidence-b1-connections-explanation-push](#evidence-evidence-b1-connections-explanation-push) [evidence-b1-connections-push](#evidence-evidence-b1-connections-push) [evidence-b1-connections-back](#evidence-evidence-b1-connections-back) [evidence-b1-connections-popstate](#evidence-evidence-b1-connections-popstate)

<a id="claim-leaf-passage-connections-2"></a>
- [Links follow four routes: a Daily passage to Pattern chapters and Timing passes, a chapter to Timing passes, and a Timing pass to Daily readings drawn from the source and earlier saved readings on the same chart\. Opened chapters and passes list their own onward links; an opened Daily reading does not\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-2) — [evidence-b1-relationship-routes-allowed](#evidence-evidence-b1-relationship-routes-allowed) [evidence-b1-relationship-source-unit](#evidence-evidence-b1-relationship-source-unit) [evidence-b1-relationship-saved-candidates](#evidence-evidence-b1-relationship-saved-candidates) [evidence-b1-connections-destinations](#evidence-evidence-b1-connections-destinations) [evidence-b1-connections-onward-links](#evidence-evidence-b1-connections-onward-links)

<a id="claim-leaf-passage-connections-3"></a>
- [A Daily target renders through the same article without the check\-in, a Pattern target shows that exact chapter, and a Timing target shows the stored pass without recalculating it\. The browser rejects a target whose coordinates or chapter hash do not match, and an unavailable edition or support shows a notice instead of a newer reading\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-3) — [evidence-b1-connections-daily-target](#evidence-evidence-b1-connections-daily-target) [evidence-b1-connected-pattern-chapter](#evidence-evidence-b1-connected-pattern-chapter) [evidence-b1-connected-timing](#evidence-evidence-b1-connected-timing) [evidence-b1-connection-target-check](#evidence-evidence-b1-connection-target-check) [evidence-b1-connection-chapter-hash](#evidence-evidence-b1-connection-chapter-hash) [evidence-b1-connections-no-substitute](#evidence-evidence-b1-connections-no-substitute)

<a id="claim-leaf-passage-connections-4"></a>
- [Four GET routes on the product API serve connections: relationship\-source, relationships, and relationship\-target under /v1/readings/:id, and /v1/timing/cycles/:id\. A middleware sets private, no\-store for these paths before configGuard runs\. Timing destinations reach the web through relationship\-target; nothing in apps/web calls /v1/timing/cycles/:id\. A Daily destination opens only if saved\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-4) — [evidence-b1-relationship-source-route](#evidence-evidence-b1-relationship-source-route) [evidence-b1-relationships-route](#evidence-evidence-b1-relationships-route) [evidence-b1-relationship-target-route](#evidence-evidence-b1-relationship-target-route) [evidence-b1-timing-cycle-route](#evidence-evidence-b1-timing-cycle-route) [evidence-b1-relationship-no-store](#evidence-evidence-b1-relationship-no-store) [evidence-b1-timing-target-via-relationship](#evidence-evidence-b1-timing-target-via-relationship) [evidence-b1-relationship-saved-target](#evidence-evidence-b1-relationship-saved-target)

<a id="claim-leaf-passage-connections-5"></a>
- [Each link needs stored support: a shared calculated feature, a shared natal participant, or a dated occurrence, and a feature that needs the birth time counts only when it is exact\. The resolver does no prose matching, recalculation, or network access and stops at three hops, four links per item, and twelve overall\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-5) — [evidence-b1-relationship-kinds](#evidence-evidence-b1-relationship-kinds) [evidence-b1-relationship-exact-time](#evidence-evidence-b1-relationship-exact-time) [evidence-b1-relationship-resolver-contract](#evidence-evidence-b1-relationship-resolver-contract) [evidence-b1-relationship-hops](#evidence-evidence-b1-relationship-hops) [evidence-b1-relationship-caps](#evidence-evidence-b1-relationship-caps)

<a id="claim-leaf-passage-connections-6"></a>
- [Support records are prepared when a V5 Daily reading or a Pattern is published, encrypted under the owner's data key as one sealed record per document, and inserted in that publication's batch \(batch detail under Daily reading pipeline and Pattern generation\)\. Reads filter by owner and document and discard support recorded for another edition\.](patternlike-source-mindmap.md#claim-leaf-passage-connections-6) — [evidence-b1-daily-relationship-support](#evidence-evidence-b1-daily-relationship-support) [evidence-b1-daily-relationship-batch](#evidence-evidence-b1-daily-relationship-batch) [evidence-b1-pattern-relationship-batch](#evidence-evidence-b1-pattern-relationship-batch) [evidence-b1-relationship-support-sealed](#evidence-evidence-b1-relationship-support-sealed) [evidence-b1-owner-data-key](#evidence-evidence-b1-owner-data-key) [evidence-b1-relationship-support-unique](#evidence-evidence-b1-relationship-support-unique) [evidence-b1-relationship-support-owner](#evidence-evidence-b1-relationship-support-owner) [evidence-b1-relationship-support-edition](#evidence-evidence-b1-relationship-support-edition)

<a id="claim-leaf-your-pattern-1"></a>
- [ChartView leads with the generated Pattern reading and follows it with normalized chart positions, aspects, houses, uncertainty, and calculation provenance\.](patternlike-source-mindmap.md#claim-leaf-your-pattern-1) — [evidence-apps-web-components-chartview-tsx-2](#evidence-evidence-apps-web-components-chartview-tsx-2) [evidence-b1-chart-wheel](#evidence-evidence-b1-chart-wheel) [evidence-b1-chart-uncertainty](#evidence-evidence-b1-chart-uncertainty) [evidence-b1-chart-provenance](#evidence-evidence-b1-chart-provenance)

<a id="claim-leaf-your-pattern-2"></a>
- [PatternExperience renders each generated chapter's summary, sections, tensions, resources, and counter\-expression, then additional signatures and uncertainty, and labels the reading as AI\-generated from the calculated chart\.](patternlike-source-mindmap.md#claim-leaf-your-pattern-2) — [evidence-b1-pattern-chapter-fields](#evidence-evidence-b1-pattern-chapter-fields) [evidence-b1-pattern-signatures](#evidence-evidence-b1-pattern-signatures) [evidence-b1-pattern-uncertainty](#evidence-evidence-b1-pattern-uncertainty) [evidence-b1-pattern-provenance-label](#evidence-evidence-b1-pattern-provenance-label)

<a id="claim-leaf-your-pattern-3"></a>
- [PatternExperience's text is the reading view of AccountPatternPortrait, which renders AccountPortraitExplorer\. A matching Pattern of three to six chapters opens the 3D observatory on first view, and Explore your 3D portrait reopens it after the reader returns to the text; other Patterns show only the text\. The observatory itself is covered under Portrait and 3D observatory\.](patternlike-source-mindmap.md#claim-leaf-your-pattern-3) — [evidence-apps-web-components-patternexperience-tsx](#evidence-evidence-apps-web-components-patternexperience-tsx) [evidence-b1-portrait-explorer-wrapper](#evidence-evidence-b1-portrait-explorer-wrapper) [evidence-b1-portrait-can-render](#evidence-evidence-b1-portrait-can-render) [evidence-b1-portrait-default-open](#evidence-evidence-b1-portrait-default-open) [evidence-b1-portrait-first-view](#evidence-evidence-b1-portrait-first-view) [evidence-b1-portrait-explore-button](#evidence-evidence-b1-portrait-explore-button) [evidence-b1-portrait-text-only](#evidence-evidence-b1-portrait-text-only)

<a id="claim-leaf-timing-and-time-travel-1"></a>
- [Timing lists active and upcoming transit cycles with phase and duration filters and marks the latest Daily scan as current, stale, or not scanned\. Time travel sets a selected date beside today\.](patternlike-source-mindmap.md#claim-leaf-timing-and-time-travel-1) — [evidence-b1-timing-status](#evidence-evidence-b1-timing-status) [evidence-b1-timing-filters](#evidence-evidence-b1-timing-filters) [evidence-b1-timing-scan-status](#evidence-evidence-b1-timing-scan-status) [evidence-b1-timing-not-scanned](#evidence-evidence-b1-timing-not-scanned) [evidence-b1-time-travel-comparison](#evidence-evidence-b1-time-travel-comparison)

<a id="claim-leaf-timing-and-time-travel-2"></a>
- [Time travel reuses cached scan receipts and spends a per\-user UTC\-day budget of 32 scans only on cache misses\. It requires a confirmed scheduling time zone, resolves dates in it, rejects skipped civil dates, and passes the chart's suppressed uncertainty features to the cycle calculation\.](patternlike-source-mindmap.md#claim-leaf-timing-and-time-travel-2) — [evidence-b1-time-travel-cache](#evidence-evidence-b1-time-travel-cache) [evidence-b1-time-travel-budget](#evidence-evidence-b1-time-travel-budget) [evidence-b1-time-travel-scan-limit](#evidence-evidence-b1-time-travel-scan-limit) [evidence-b1-time-travel-confirmed-zone](#evidence-evidence-b1-time-travel-confirmed-zone) [evidence-b1-time-travel-local-day](#evidence-evidence-b1-time-travel-local-day) [evidence-b1-time-travel-suppressed](#evidence-evidence-b1-time-travel-suppressed)

<a id="claim-leaf-timing-and-time-travel-3"></a>
- [Time travel shows saved life events beside the reconstruction and states that they are never evidence for it\. Adding or editing an event needs the life\-event permission; listing and deleting stay available without it\.](patternlike-source-mindmap.md#claim-leaf-timing-and-time-travel-3) — [evidence-apps-web-components-timetravelview-tsx](#evidence-evidence-apps-web-components-timetravelview-tsx) [evidence-b1-life-events-boundary](#evidence-evidence-b1-life-events-boundary) [evidence-b1-life-events-can-write](#evidence-evidence-b1-life-events-can-write) [evidence-b1-life-events-delete-available](#evidence-evidence-b1-life-events-delete-available)

<a id="claim-leaf-readiness-and-consequences-1"></a>
- [App\.tsx scopes reader state to the account, session epoch, chart, and profile version; a 401 that a view reports through onUnauthorized advances the epoch, and the portrait session remounts when the scope changes\. selectReaderReadiness offers start or retry only from a known, in\-scope observation at most 60 seconds old, and the module declares that no observation authorizes a server operation\.](patternlike-source-mindmap.md#claim-leaf-readiness-and-consequences-1) — [evidence-b1-reader-scope](#evidence-evidence-b1-reader-scope) [evidence-b1-view-unauthorized-wiring](#evidence-evidence-b1-view-unauthorized-wiring) [evidence-b1-session-epoch](#evidence-evidence-b1-session-epoch) [evidence-b1-portrait-session-key](#evidence-evidence-b1-portrait-session-key) [evidence-b1-readiness-max-age](#evidence-evidence-b1-readiness-max-age) [evidence-b1-readiness-fresh-actions](#evidence-evidence-b1-readiness-fresh-actions) [evidence-b1-readiness-contract](#evidence-evidence-b1-readiness-contract)

<a id="claim-leaf-readiness-and-consequences-2"></a>
- [ReaderConsequences states what an action retains, erases, or stops for six actions: birth correction, Pattern deletion, withdrawing calculation, Daily, or Pattern permission, and turning off automatic artwork\. It shows that text only for a known observation at most 60 seconds old; otherwise it says consequences could not be checked and asks for a reload\.](patternlike-source-mindmap.md#claim-leaf-readiness-and-consequences-2) — [evidence-b1-consequence-actions](#evidence-evidence-b1-consequence-actions) [evidence-b1-consequence-freshness](#evidence-evidence-b1-consequence-freshness) [evidence-b1-consequence-known-only](#evidence-evidence-b1-consequence-known-only) [evidence-b1-consequence-fallback](#evidence-evidence-b1-consequence-fallback)

<a id="claim-leaf-readiness-and-consequences-3"></a>
- [Birth correction shows that statement beside Privacy's Correct button and on the correction form's review step, keeps submit disabled until the chart observation is fresh, and rechecks freshness after saving calculation permission\. Pattern deletion shows it in the typed confirmation and disables Confirm deletion until the Pattern observation is fresh\.](patternlike-source-mindmap.md#claim-leaf-readiness-and-consequences-3) — [evidence-b1-privacy-correct-consequences](#evidence-evidence-b1-privacy-correct-consequences) [evidence-b1-onboarding-consequences](#evidence-evidence-b1-onboarding-consequences) [evidence-b1-onboarding-fresh-submit](#evidence-evidence-b1-onboarding-fresh-submit) [evidence-b1-onboarding-recheck](#evidence-evidence-b1-onboarding-recheck) [evidence-b1-pattern-delete-consequences](#evidence-evidence-b1-pattern-delete-consequences) [evidence-b1-pattern-delete-fresh](#evidence-evidence-b1-pattern-delete-fresh)

<a id="claim-leaf-birth-data-and-place-resolution-1"></a>
- [POST /v1/birth\-profiles requires an Idempotency\-Key, rejects a malformed accuracy, coordinate pair, or time zone hint, and answers a succeeded, queued, or running job for the same key without recalculating\. Before calling calculation it requires the exact current account\-processing consent and reserves the per\-user daily budget\.](patternlike-source-mindmap.md#claim-leaf-birth-data-and-place-resolution-1) — [evidence-apps-api-routes-birth-ts](#evidence-evidence-apps-api-routes-birth-ts) [evidence-b2-birth-idempotency-key](#evidence-evidence-b2-birth-idempotency-key) [evidence-b2-birth-accuracy-check](#evidence-evidence-b2-birth-accuracy-check) [evidence-b2-birth-coordinate-pair](#evidence-evidence-b2-birth-coordinate-pair) [evidence-b2-birth-zone-hint-check](#evidence-evidence-b2-birth-zone-hint-check) [evidence-b2-birth-job-replay](#evidence-evidence-b2-birth-job-replay) [evidence-b2-birth-budget-reservation](#evidence-evidence-b2-birth-budget-reservation) [evidence-b2-birth-consent-before-calc](#evidence-evidence-b2-birth-consent-before-calc)

<a id="claim-leaf-birth-data-and-place-resolution-2"></a>
- [/v1/places/search and /v1/places/resolve call Geoapify from the Worker only when GEOCODER\_ROLLOUT is enabled with a GEOAPIFY\_API\_KEY and the user holds current geocoder consent\. A resolved place is kept for 24 hours, and birth submission uses its place\_id without a fresh geocoder\-consent check\.](patternlike-source-mindmap.md#claim-leaf-birth-data-and-place-resolution-2) — [evidence-b2-place-search-gated](#evidence-evidence-b2-place-search-gated) [evidence-b2-place-resolve-gated](#evidence-evidence-b2-place-resolve-gated) [evidence-b2-geoapify-server-fetch](#evidence-evidence-b2-geoapify-server-fetch) [evidence-b2-geocoder-rollout-gate](#evidence-evidence-b2-geocoder-rollout-gate) [evidence-b2-geocoder-consent-gate](#evidence-evidence-b2-geocoder-consent-gate) [evidence-b2-place-resolution-ttl](#evidence-evidence-b2-place-resolution-ttl) [evidence-b2-birth-place-resolution-load](#evidence-evidence-b2-birth-place-resolution-load) [evidence-b2-place-resolution-lookup](#evidence-evidence-b2-place-resolution-lookup)

<a id="claim-leaf-birth-data-and-place-resolution-3"></a>
- [The new chart commits in a batch that supersedes the user's other active chart and pending or active profile versions\. The route then invalidates only the current local day's published constrained Daily reading and tries to reserve one repair; fact\-repair reservations never cover other days\. It erases the Pattern, re\-enqueuing it only under a live Pattern grant\. History lists one edition per local date with no chart filter, so earlier days' readings stay listed\.](patternlike-source-mindmap.md#claim-leaf-birth-data-and-place-resolution-3) — [evidence-b2-birth-chart-supersede](#evidence-evidence-b2-birth-chart-supersede) [evidence-b2-birth-profile-supersede](#evidence-evidence-b2-birth-profile-supersede) [evidence-b2-birth-fact-repair](#evidence-evidence-b2-birth-fact-repair) [evidence-b2-fact-repair-current-day](#evidence-evidence-b2-fact-repair-current-day) [evidence-b2-fact-repair-day-limit](#evidence-evidence-b2-fact-repair-day-limit) [evidence-b2-birth-pattern-reconcile](#evidence-evidence-b2-birth-pattern-reconcile) [evidence-b2-pattern-correction-erase](#evidence-evidence-b2-pattern-correction-erase) [evidence-b2-pattern-correction-grant](#evidence-evidence-b2-pattern-correction-grant) [evidence-b2-history-no-chart-filter](#evidence-evidence-b2-history-no-chart-filter) [evidence-b2-history-one-per-date](#evidence-evidence-b2-history-one-per-date) [evidence-b2-history-canonical-rank](#evidence-evidence-b2-history-canonical-rank)

<a id="claim-leaf-time-zones-and-uncertainty-1"></a>
- [The chart zone comes from the selected place's or typed coordinates through tz\-lookup and overrides any hint; a valid IANA hint applies only when coordinates yield no zone, and UTC is the last resort\. The web form locks its zone field once coordinates are entered, and calculation resolves the local birth time in that zone with luxon\.](patternlike-source-mindmap.md#claim-leaf-time-zones-and-uncertainty-1) — [evidence-b2-birth-effective-coordinates](#evidence-evidence-b2-birth-effective-coordinates) [evidence-b2-timezone-tzlookup](#evidence-evidence-b2-timezone-tzlookup) [evidence-b2-timezone-coordinates-first](#evidence-evidence-b2-timezone-coordinates-first) [evidence-b2-onboarding-zone-derived](#evidence-evidence-b2-onboarding-zone-derived) [evidence-b2-onboarding-zone-readonly](#evidence-evidence-b2-onboarding-zone-readonly) [evidence-b2-engine-luxon-instant](#evidence-evidence-b2-engine-luxon-instant)

<a id="claim-leaf-time-zones-and-uncertainty-2"></a>
- [The API requires birth\_time\_local unless accuracy is unknown\. Without a real time, calculation uses noon only as an epoch and stores no birth instant, suppresses houses, angles, angle transits, and time\-sensitive Moon claims, and leaves the Moon out of natal aspects; an approximate time qualifies Moon and house claims across its window\. Houses and angles also require coordinates\.](patternlike-source-mindmap.md#claim-leaf-time-zones-and-uncertainty-2) — [evidence-b2-birth-time-required](#evidence-evidence-b2-birth-time-required) [evidence-b2-engine-noon-not-stored](#evidence-evidence-b2-engine-noon-not-stored) [evidence-b2-engine-unknown-suppression](#evidence-evidence-b2-engine-unknown-suppression) [evidence-b2-engine-moon-aspects](#evidence-evidence-b2-engine-moon-aspects) [evidence-b2-engine-approximate-qualification](#evidence-evidence-b2-engine-approximate-qualification) [evidence-b2-engine-houses-condition](#evidence-evidence-b2-engine-houses-condition)

<a id="claim-leaf-time-zones-and-uncertainty-3"></a>
- [Zone resolution attaches pre\_1970\_zone\_boundary for any civil year before 1970, near\_zone\_boundary near a zone border, and local\_time\_ambiguous or local\_time\_nonexistent for repeated or skipped local times; the birth route records them with its confidence grade and passes them to calculation\. At every accuracy, calculation qualifies birth\_instant for any of those four codes and birthplace when location confidence is medium, low, or none\.](patternlike-source-mindmap.md#claim-leaf-time-zones-and-uncertainty-3) — [evidence-b2-timezone-civil-qualifiers](#evidence-evidence-b2-timezone-civil-qualifiers) [evidence-b2-tzdb-stable-year](#evidence-evidence-b2-tzdb-stable-year) [evidence-b2-birth-command-qualifiers](#evidence-evidence-b2-birth-command-qualifiers) [evidence-b2-birth-calc-qualifiers](#evidence-evidence-b2-birth-calc-qualifiers) [evidence-b2-engine-birth-instant-qualification](#evidence-evidence-b2-engine-birth-instant-qualification) [evidence-b2-engine-birthplace-qualification](#evidence-evidence-b2-engine-birthplace-qualification) [evidence-b2-timezone-near-boundary](#evidence-evidence-b2-timezone-near-boundary)

<a id="claim-leaf-time-zones-and-uncertainty-4"></a>
- [Constrained Daily reads the chart's stored uncertainty and needs a note whenever a feature is suppressed or qualified, but accepts one only for approximate time or a suppression; otherwise it fails before any provider call, and command building returns context\_ineligible\. An exact\-time chart with coordinates and nothing suppressed thus gets no constrained Daily reading if anything is qualified, as every pre\-1970 chart the current engine calculated is\. The code calls this a stop\-gap, not a repair\.](patternlike-source-mindmap.md#claim-leaf-time-zones-and-uncertainty-4) — [evidence-b2-note-required](#evidence-evidence-b2-note-required) [evidence-b2-disclosure-representable](#evidence-evidence-b2-disclosure-representable) [evidence-b2-note-unrepresentable-refusal](#evidence-evidence-b2-note-unrepresentable-refusal) [evidence-b2-context-ineligible](#evidence-evidence-b2-context-ineligible) [evidence-b2-disclosure-stop-gap](#evidence-evidence-b2-disclosure-stop-gap) [evidence-b2-timezone-civil-qualifiers](#evidence-evidence-b2-timezone-civil-qualifiers) [evidence-b2-engine-birth-instant-qualification](#evidence-evidence-b2-engine-birth-instant-qualification) [evidence-b2-daily-stored-uncertainty](#evidence-evidence-b2-daily-stored-uncertainty)

<a id="claim-leaf-swiss-ephemeris-compute-service-1"></a>
- [Despite its directory name, apps/calc\-stub is a Node HTTP service that computes positions through the sweph Swiss Ephemeris binding, with Placidus houses and a Porphyry fallback\. It refuses any body result whose returned flags differ from those requested, which is how a silent Moshier substitution shows, and rejects birth instants outside the pinned ephemeris coverage\.](patternlike-source-mindmap.md#claim-leaf-swiss-ephemeris-compute-service-1) — [evidence-apps-calc-stub-server-ts](#evidence-evidence-apps-calc-stub-server-ts) [evidence-b2-sweph-dependency](#evidence-evidence-b2-sweph-dependency) [evidence-b2-sweph-calc-ut](#evidence-evidence-b2-sweph-calc-ut) [evidence-b2-sweph-houses-fallback](#evidence-evidence-b2-sweph-houses-fallback) [evidence-b2-sweph-flag-refusal](#evidence-evidence-b2-sweph-flag-refusal) [evidence-b2-ephemeris-coverage](#evidence-evidence-b2-ephemeris-coverage)

<a id="claim-leaf-swiss-ephemeris-compute-service-2"></a>
- [POST /v1/calculate, /v1/cycles, and /v1/daily\-sky share one token check: a configured CALC\_SERVICE\_AUTH\_TOKEN is enforced in every environment, and a missing one returns 503 in production and leaves the routes open elsewhere\. GET /health and /v1/engine stay public\.](patternlike-source-mindmap.md#claim-leaf-swiss-ephemeris-compute-service-2) — [evidence-b2-calc-route-calculate](#evidence-evidence-b2-calc-route-calculate) [evidence-b2-calc-route-cycles](#evidence-evidence-b2-calc-route-cycles) [evidence-b2-calc-route-daily-sky](#evidence-evidence-b2-calc-route-daily-sky) [evidence-b2-calc-auth-token-enforced](#evidence-evidence-b2-calc-auth-token-enforced) [evidence-b2-calc-auth-missing-production](#evidence-evidence-b2-calc-auth-missing-production) [evidence-b2-calc-route-health](#evidence-evidence-b2-calc-route-health) [evidence-b2-calc-route-engine](#evidence-evidence-b2-calc-route-engine)

<a id="claim-leaf-swiss-ephemeris-compute-service-3"></a>
- [The engine declares geocentric tropical coordinates\. Chart output carries positions, aspects, the uncertainty report, and identity fields: a content\-hash fingerprint, contract id and version, container\_digest, and tzdb\_version\.](patternlike-source-mindmap.md#claim-leaf-swiss-ephemeris-compute-service-3) — [evidence-b2-engine-tropical-geocentric](#evidence-evidence-b2-engine-tropical-geocentric) [evidence-b2-engine-positions](#evidence-evidence-b2-engine-positions) [evidence-b2-engine-aspects](#evidence-evidence-b2-engine-aspects) [evidence-b2-engine-uncertainty-report](#evidence-evidence-b2-engine-uncertainty-report) [evidence-b2-engine-fingerprint](#evidence-evidence-b2-engine-fingerprint) [evidence-b2-engine-chart-identity](#evidence-evidence-b2-engine-chart-identity)

<a id="claim-leaf-swiss-ephemeris-compute-service-4"></a>
- [container\_digest is CONTAINER\_DIGEST when that variable is set, otherwise a hash of fixed service and Swiss Ephemeris version strings that is the same for every image with those versions; no committed Dockerfile or fly\.toml sets CONTAINER\_DIGEST\. tzdb\_version is the constant 2026a\.](patternlike-source-mindmap.md#claim-leaf-swiss-ephemeris-compute-service-4) — [evidence-b2-engine-container-digest](#evidence-evidence-b2-engine-container-digest) [evidence-b2-engine-tzdb-constant](#evidence-evidence-b2-engine-tzdb-constant) [evidence-b2-calc-dockerfile-env](#evidence-evidence-b2-calc-dockerfile-env) [evidence-b2-fly-calc-env](#evidence-evidence-b2-fly-calc-env)

<a id="claim-leaf-swiss-ephemeris-compute-service-5"></a>
- [Committed fly\.toml builds apps/calc\-stub/Dockerfile as Fly app patternlike\-app in region ams, and fly\.web\.toml gives that same app name to apps/web/Dockerfile, while the production CALC\_SERVICE\_URL in apps/api/wrangler\.toml is https://patternlike\-calc\.fly\.dev\. The Worker sends CALC\_SERVICE\_AUTH\_TOKEN as a bearer token when it is set\. These are committed settings, not deployed state\.](patternlike-source-mindmap.md#claim-leaf-swiss-ephemeris-compute-service-5) — [evidence-b2-fly-calc-app](#evidence-evidence-b2-fly-calc-app) [evidence-b2-fly-web-app](#evidence-evidence-b2-fly-web-app) [evidence-b2-wrangler-production-calc](#evidence-evidence-b2-wrangler-production-calc) [evidence-b2-calc-client-bearer](#evidence-evidence-b2-calc-client-bearer)

<a id="claim-leaf-shared-factual-inputs-1"></a>
- [The Worker derives natal features from the stored chart, keeping houses and angles only when the time is known and they are not suppressed, and Pattern evidence selection reads them\. Calculation supplies transit cycles to Daily V1 and V2 command building and to Time travel, Timing lists stored active cycles, and constrained Daily also requests a separate set of daily\-sky facts\.](patternlike-source-mindmap.md#claim-leaf-shared-factual-inputs-1) — [evidence-b2-natal-time-eligibility](#evidence-evidence-b2-natal-time-eligibility) [evidence-b2-pattern-selection-features](#evidence-evidence-b2-pattern-selection-features) [evidence-b2-daily-v1-cycles](#evidence-evidence-b2-daily-v1-cycles) [evidence-b2-daily-v2-cycles](#evidence-evidence-b2-daily-v2-cycles) [evidence-b2-time-travel-cycles](#evidence-evidence-b2-time-travel-cycles) [evidence-b2-timing-stored-cycles](#evidence-evidence-b2-timing-stored-cycles) [evidence-b2-daily-v2-daily-sky](#evidence-evidence-b2-daily-v2-daily-sky)

<a id="claim-leaf-shared-factual-inputs-2"></a>
- [Birth calculation is one synchronous call bounded by CALC\_FETCH\_TIMEOUT\_MS \(1,000 to 30,000 ms\) and a per\-user UTC\-day BIRTH\_CALC\_DAILY\_LIMIT \(1 to 50\); committed production configuration sets 10,000 ms and 5\. A spent budget returns 429 with Retry\-After\. Each chart snapshot row stores the fingerprint, contract id and version, container\_digest, tzdb\_version, and calculation time\.](patternlike-source-mindmap.md#claim-leaf-shared-factual-inputs-2) — [evidence-b2-birth-calc-timeout](#evidence-evidence-b2-birth-calc-timeout) [evidence-b2-calc-client-abort](#evidence-evidence-b2-calc-client-abort) [evidence-b2-birth-operational-bounds](#evidence-evidence-b2-birth-operational-bounds) [evidence-b2-wrangler-production-calc](#evidence-evidence-b2-wrangler-production-calc) [evidence-b2-birth-budget-ledger](#evidence-evidence-b2-birth-budget-ledger) [evidence-b2-birth-budget-retry-after](#evidence-evidence-b2-birth-budget-retry-after) [evidence-b2-chart-snapshot-provenance](#evidence-evidence-b2-chart-snapshot-provenance)

<a id="claim-leaf-shared-factual-inputs-3"></a>
- [The chart request carries the user id and profile version with the birth date, local time, zone, coordinates, and place label\. Cycle requests carry the chart fingerprint, natal longitudes, natal accuracy, a window, policy ids, and any suppressed features; daily\-sky requests carry natal longitudes and house cusps that survive suppression, the uncertainty report, a day window, and policy ids\. Neither carries the user id or birth details\.](patternlike-source-mindmap.md#claim-leaf-shared-factual-inputs-3) — [evidence-b2-birth-calc-request](#evidence-evidence-b2-birth-calc-request) [evidence-b2-cycle-request-fields](#evidence-evidence-b2-cycle-request-fields) [evidence-b2-daily-sky-request-fields](#evidence-evidence-b2-daily-sky-request-fields) [evidence-b2-daily-sky-longitude-filter](#evidence-evidence-b2-daily-sky-longitude-filter) [evidence-b2-daily-sky-cusp-filter](#evidence-evidence-b2-daily-sky-cusp-filter)

<a id="claim-leaf-shared-factual-inputs-4"></a>
- [Constrained Daily calls /v1/cycles and /v1/daily\-sky when it builds a command and pins each request and response digest with the container digest and ephemeris data version\. It repeats both calls at execution and fails generation\_input\_id\_mismatch if a response digest, container digest, or ephemeris data version differs\.](patternlike-source-mindmap.md#claim-leaf-shared-factual-inputs-4) — [evidence-b2-daily-v2-cycles](#evidence-evidence-b2-daily-v2-cycles) [evidence-b2-daily-v2-daily-sky](#evidence-evidence-b2-daily-v2-daily-sky) [evidence-b2-daily-calc-pins](#evidence-evidence-b2-daily-calc-pins) [evidence-b2-daily-execute-cycles](#evidence-evidence-b2-daily-execute-cycles) [evidence-b2-daily-execute-cycle-match](#evidence-evidence-b2-daily-execute-cycle-match) [evidence-b2-daily-execute-sky](#evidence-evidence-b2-daily-execute-sky) [evidence-b2-daily-execute-sky-match](#evidence-evidence-b2-daily-execute-sky-match)

<a id="claim-leaf-reserve-and-schedule-1"></a>
- [PUT /v1/readings/today calls ensureTodayReading with generationMode v5 and the first\_open rollout entry\. The service refuses a scheduling time zone or content locale still at its unconfirmed default and returns a reading already published for the day; otherwise it advances, replaces, or reserves a constrained reading only when READING\_V5\_ROLLOUT admits first\_open, and a new reservation takes the current local date in the reader's time zone\.](patternlike-source-mindmap.md#claim-leaf-reserve-and-schedule-1) — [evidence-b3-today-put-route](#evidence-evidence-b3-today-put-route) [evidence-apps-api-routes-readings-ts](#evidence-evidence-apps-api-routes-readings-ts) [evidence-b3-today-first-open-entry](#evidence-evidence-b3-today-first-open-entry) [evidence-b3-today-unconfirmed-zone](#evidence-evidence-b3-today-unconfirmed-zone) [evidence-b3-today-unconfirmed-locale](#evidence-evidence-b3-today-unconfirmed-locale) [evidence-b3-today-published-before-rollout](#evidence-evidence-b3-today-published-before-rollout) [evidence-b3-today-pending-rollout-gate](#evidence-evidence-b3-today-pending-rollout-gate) [evidence-b3-today-failed-rollout-gate](#evidence-evidence-b3-today-failed-rollout-gate) [evidence-b3-today-reserve-rollout-gate](#evidence-evidence-b3-today-reserve-rollout-gate) [evidence-b3-today-target-date](#evidence-evidence-b3-today-target-date)

<a id="claim-leaf-reserve-and-schedule-2"></a>
- [First open and the scheduler's due lane both reserve through enqueueConstrainedReading, and the reservation batch refuses a second pending or published reading for the same user and local date\. The frozen V2 command pins the chart, calculation request and response digests, selected context and prior readings, the AI\-consent grant, and publisher settings including prompt, selection, and validation policy versions\.](patternlike-source-mindmap.md#claim-leaf-reserve-and-schedule-2) — [evidence-b3-first-open-reservation](#evidence-evidence-b3-first-open-reservation) [evidence-b3-scheduled-reservation](#evidence-evidence-b3-scheduled-reservation) [evidence-b3-user-day-reservation-guard](#evidence-evidence-b3-user-day-reservation-guard) [evidence-b3-v2-command-pins](#evidence-evidence-b3-v2-command-pins) [evidence-b3-v5-calculation-pin-digests](#evidence-evidence-b3-v5-calculation-pin-digests) [evidence-b3-publisher-pin-versions](#evidence-evidence-b3-publisher-pin-versions)

<a id="claim-leaf-reserve-and-schedule-3"></a>
- [The scheduler replaces a failed command only for result classes on a closed list, recording the reason automaticReplacementReason maps from the failed job's own class: V2 execution\_error becomes publisher\_unavailable, and policy\_unsupported becomes policy\_upgraded \(V1\) or publisher\_superseded \(V2\)\. It freezes a new command only below command generation 3 and for the current local day, the next day \(V2\), or the previous day \(V1\)\.](patternlike-source-mindmap.md#claim-leaf-reserve-and-schedule-3) — [evidence-b3-v5-automatic-failure-codes](#evidence-evidence-b3-v5-automatic-failure-codes) [evidence-b3-replacement-reason-mapping](#evidence-evidence-b3-replacement-reason-mapping) [evidence-b3-scheduler-derived-reason](#evidence-evidence-b3-scheduler-derived-reason) [evidence-b3-scheduler-reason-must-match](#evidence-evidence-b3-scheduler-reason-must-match) [evidence-b3-scheduler-generation-cap](#evidence-evidence-b3-scheduler-generation-cap) [evidence-b3-replacement-day-window](#evidence-evidence-b3-replacement-day-window)

<a id="claim-leaf-compile-permitted-context-1"></a>
- [loadConstrainedContext loads current, conflict\-free context signals, resonance feedback, and up to seven earlier V5 readings\. prepareConstrainedReadingInput then drops signals expired at the generation anchor, not fresh, outside the source registry, or without an active source grant, keeps only uses the signal and its source consent share, caps feedback at 20 records, and stops adding context at the byte or item limit\.](patternlike-source-mindmap.md#claim-leaf-compile-permitted-context-1) — [evidence-b3-context-current-signals](#evidence-evidence-b3-context-current-signals) [evidence-b3-prior-readings-v5-only](#evidence-evidence-b3-prior-readings-v5-only) [evidence-b3-context-record-limits](#evidence-evidence-b3-context-record-limits) [evidence-b3-context-expired-at-anchor](#evidence-evidence-b3-context-expired-at-anchor) [evidence-b3-context-fresh-and-registered](#evidence-evidence-b3-context-fresh-and-registered) [evidence-b3-context-source-gate](#evidence-evidence-b3-context-source-gate) [evidence-b3-context-use-intersection](#evidence-evidence-b3-context-use-intersection) [evidence-b3-context-cap-and-budget](#evidence-evidence-b3-context-cap-and-budget)

<a id="claim-leaf-compile-permitted-context-2"></a>
- [Resonance feedback is offered to the packet as a USR\-12 signal allowed for repetition\_control and theme\_ranking, and enters only through an active USR\-12 source grant\. Facts come only from calculation inputs, and the within\-lane fact ranker receives no context or feedback \(seenRecently is fixed false\), so feedback never alters or reorders calculated facts\.](patternlike-source-mindmap.md#claim-leaf-compile-permitted-context-2) — [evidence-b3-resonance-feedback-uses](#evidence-evidence-b3-resonance-feedback-uses) [evidence-b3-feedback-source-usr12](#evidence-evidence-b3-feedback-source-usr12) [evidence-b3-context-source-gate](#evidence-evidence-b3-context-source-gate) [evidence-b3-facts-from-calculation](#evidence-evidence-b3-facts-from-calculation) [evidence-b3-rank-facts-call](#evidence-evidence-b3-rank-facts-call) [evidence-b3-ranker-seen-recently-false](#evidence-evidence-b3-ranker-seen-recently-false)

<a id="claim-leaf-compile-permitted-context-3"></a>
- [Categorical feedback events compile only when the command is built under the categorical selection version, which the publisher configuration chooses only when CATEGORIZED\_FEEDBACK\_EFFECTS\_ENABLED is 1; committed wrangler\.toml does not set the flag and pins the non\-categorical prompt 1\.0\.3\. Only repetitive events can compile, as repetition\_control: unclear is dropped, and not\_relevant\_today needs theme ids the writer never stores\.](patternlike-source-mindmap.md#claim-leaf-compile-permitted-context-3) — [evidence-b3-categorical-compile-gate](#evidence-evidence-b3-categorical-compile-gate) [evidence-b3-command-feedback-selection](#evidence-evidence-b3-command-feedback-selection) [evidence-b3-feedback-flag-policy](#evidence-evidence-b3-feedback-flag-policy) [evidence-b3-feedback-flag-read](#evidence-evidence-b3-feedback-flag-read) [evidence-b3-publisher-pin-selection](#evidence-evidence-b3-publisher-pin-selection) [evidence-b3-committed-prompt-pin](#evidence-evidence-b3-committed-prompt-pin) [evidence-b3-categorical-unclear-and-use](#evidence-evidence-b3-categorical-unclear-and-use) [evidence-b3-categorical-theme-required](#evidence-evidence-b3-categorical-theme-required) [evidence-b3-feedback-targets-no-themes](#evidence-evidence-b3-feedback-targets-no-themes)

<a id="claim-leaf-compile-permitted-context-4"></a>
- [prepareConstrainedReadingInput orders facts within each lane by DER\-02 score\. A cycle's exactness is temporal: 1 at an exact pass and 0 at orb entry or exit, measured against its envelope and neighbouring passes\. The default selection policy is 1\.3\.0 and V1 assembly identity profile v2 binds the same envelope and pass times; a Codex\-pinned V2 command with an older selection version, or a V1 command naming an older identity profile, fails policy\_unsupported\.](patternlike-source-mindmap.md#claim-leaf-compile-permitted-context-4) — [evidence-b3-lane-then-score](#evidence-evidence-b3-lane-then-score) [evidence-b3-selection-policy-1-3-0](#evidence-evidence-b3-selection-policy-1-3-0) [evidence-b3-temporal-exactness](#evidence-evidence-b3-temporal-exactness) [evidence-b3-assembly-identity-v2](#evidence-evidence-b3-assembly-identity-v2) [evidence-b3-assembly-identity-envelope](#evidence-evidence-b3-assembly-identity-envelope) [evidence-b3-v2-codex-policy-guard](#evidence-evidence-b3-v2-codex-policy-guard) [evidence-b3-publisher-provider-codex](#evidence-evidence-b3-publisher-provider-codex) [evidence-b3-supported-policy-pairs](#evidence-evidence-b3-supported-policy-pairs) [evidence-b3-v2-policy-unsupported](#evidence-evidence-b3-v2-policy-unsupported) [evidence-b3-v1-identity-guard](#evidence-evidence-b3-v1-identity-guard)

<a id="claim-leaf-generate-and-validate-1"></a>
- [The executor sends the frozen packet to Codex as a provider job and schema\-checks the candidate\. validateReadingCandidate rejects it whole on any failed check, including unknown references, context outside its lane, astrology claims its cited facts do not support, a missing or unrequested uncertainty note, context used as evidence, and safety, markup, or leakage matches\. An inexpressible required note is refused before the call \(see Calculation authority\)\.](patternlike-source-mindmap.md#claim-leaf-generate-and-validate-1) — [evidence-b3-codex-publish](#evidence-evidence-b3-codex-publish) [evidence-apps-api-services-generate-daily-reading-v5-ts](#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts) [evidence-b3-validate-candidate-reject](#evidence-evidence-b3-validate-candidate-reject) [evidence-b3-references-and-lanes](#evidence-evidence-b3-references-and-lanes) [evidence-b3-fact-support-check](#evidence-evidence-b3-fact-support-check) [evidence-b3-uncertainty-note-check](#evidence-evidence-b3-uncertainty-note-check) [evidence-b3-content-rules](#evidence-evidence-b3-content-rules) [evidence-b3-disclosure-refusal](#evidence-evidence-b3-disclosure-refusal)

<a id="claim-leaf-generate-and-validate-2"></a>
- [The executor rechecks AI consent and pinned context before and after replaying calculation and reproduces both frozen input hashes before any provider call; while the provider job is unfinished, the Daily lease is handed back\. The Worker charges the daily call budget when the runner claims the job, and runner completion only stores the response and nudges the owner, which then adopts, validates, encrypts, and commits it\.](patternlike-source-mindmap.md#claim-leaf-generate-and-validate-2) — [evidence-b3-first-consent-check](#evidence-evidence-b3-first-consent-check) [evidence-b3-input-hashes-then-recheck](#evidence-evidence-b3-input-hashes-then-recheck) [evidence-b3-publisher-pending-release](#evidence-evidence-b3-publisher-pending-release) [evidence-b3-budget-at-runner-claim](#evidence-evidence-b3-budget-at-runner-claim) [evidence-b3-runner-completion-nudge](#evidence-evidence-b3-runner-completion-nudge) [evidence-b3-adopt-completed-candidate](#evidence-evidence-b3-adopt-completed-candidate) [evidence-b3-seal-reading](#evidence-evidence-b3-seal-reading) [evidence-apps-api-services-generate-daily-reading-v5-ts-2](#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-2)

<a id="claim-leaf-publication-and-historical-compatibility-1"></a>
- [completeReading publishes in one D1 batch that asserts the reservation and claim are unchanged and stores the reading, one evidence row per paragraph carrying its fact and context references, and, for V5, a publication receipt\. Routes under /v1/readings list history and serve a reading, its evidence, resonance feedback, and saves\.](patternlike-source-mindmap.md#claim-leaf-publication-and-historical-compatibility-1) — [evidence-b3-publication-claim-assertion](#evidence-evidence-b3-publication-claim-assertion) [evidence-b3-paragraph-evidence-refs](#evidence-evidence-b3-paragraph-evidence-refs) [evidence-b3-reading-sources-insert](#evidence-evidence-b3-reading-sources-insert) [evidence-b3-receipt-in-batch](#evidence-evidence-b3-receipt-in-batch) [evidence-apps-api-routes-readings-ts-2](#evidence-evidence-apps-api-routes-readings-ts-2) [evidence-b3-reading-by-id-route](#evidence-evidence-b3-reading-by-id-route) [evidence-b3-reading-evidence-route](#evidence-evidence-b3-reading-evidence-route) [evidence-reading-feedback-write](#evidence-evidence-reading-feedback-write) [evidence-b3-reading-save-route](#evidence-evidence-b3-reading-save-route)

<a id="claim-leaf-publication-and-historical-compatibility-2"></a>
- [dispatchGeneration selects the executor from the frozen command rather than current settings: V1 commands run deterministic V3 assembly and V2 commands run constrained\-model V5\. With READING\_V5\_ROLLOUT off, queued V2 jobs are paused before any claim\. V3 readings and their evidence stay readable, and the Today route treats a deterministic reservation for the day as terminal instead of replacing it\.](patternlike-source-mindmap.md#claim-leaf-publication-and-historical-compatibility-2) — [evidence-b3-dispatch-by-command](#evidence-evidence-b3-dispatch-by-command) [evidence-b3-rollout-off-pause-guard](#evidence-evidence-b3-rollout-off-pause-guard) [evidence-b3-v3-reading-projection](#evidence-evidence-b3-v3-reading-projection) [evidence-b3-v3-evidence-projection](#evidence-evidence-b3-v3-evidence-projection) [evidence-b3-today-deterministic-terminal](#evidence-evidence-b3-today-deterministic-terminal)

<a id="claim-leaf-publication-and-historical-compatibility-3"></a>
- [Each V5 publication records content\-free quality findings on its receipt: a sorted, deduplicated JSON array drawn from seven fixed codes, in the column migration 0034 adds\. They are computed after validation and never block publication\. The same batch inserts the reading's passage\-connection support record; connections are covered under Reader experience\.](patternlike-source-mindmap.md#claim-leaf-publication-and-historical-compatibility-3) — [evidence-b3-quality-codes](#evidence-evidence-b3-quality-codes) [evidence-b3-quality-at-publication](#evidence-evidence-b3-quality-at-publication) [evidence-b3-quality-receipt-json](#evidence-evidence-b3-quality-receipt-json) [evidence-b3-migration-0034](#evidence-evidence-b3-migration-0034) [evidence-b1-daily-relationship-support](#evidence-evidence-b1-daily-relationship-support) [evidence-b1-daily-relationship-batch](#evidence-evidence-b1-daily-relationship-batch)

<a id="claim-leaf-categorical-reader-feedback-1"></a>
- [GET /v1/readings/:id/feedback\-options returns the closed categories, a grant\-state tag, the effect window and retention, the latest event for that exact target, and generation\_effects\_active, true only when the configured publisher pins the categorical prompt and selection versions\. POST /v1/readings/:id/feedback\-events requires an Idempotency\-Key, confirm\_feedback\_use, and the current tag; a changed grant state returns 409 feedback\_use\_changed\.](patternlike-source-mindmap.md#claim-leaf-categorical-reader-feedback-1) — [evidence-b3-feedback-options-route](#evidence-evidence-b3-feedback-options-route) [evidence-b3-feedback-options-body](#evidence-evidence-b3-feedback-options-body) [evidence-b3-feedback-events-route](#evidence-evidence-b3-feedback-events-route) [evidence-b3-feedback-idempotency](#evidence-evidence-b3-feedback-idempotency) [evidence-b3-feedback-confirm-use](#evidence-evidence-b3-feedback-confirm-use) [evidence-b3-feedback-tag-check](#evidence-evidence-b3-feedback-tag-check) [evidence-b3-feedback-use-changed-409](#evidence-evidence-b3-feedback-use-changed-409)

<a id="claim-leaf-categorical-reader-feedback-2"></a>
- [Each event seals its request, including any note, with the receipt, the grant binding, and derived fact targets into one encrypted payload in reading\_feedback\_events \(migration 0031\)\. A write without an active USR\-12 grant creates or renews it in the same batch, which also asserts that the grant state and target reading are unchanged\. Effects last 7 days, none for unclear, and every event carries a 24\-month retention\.](patternlike-source-mindmap.md#claim-leaf-categorical-reader-feedback-2) — [evidence-b3-feedback-note-in-request](#evidence-evidence-b3-feedback-note-in-request) [evidence-b3-feedback-event-payload](#evidence-evidence-b3-feedback-event-payload) [evidence-b3-feedback-event-insert](#evidence-evidence-b3-feedback-event-insert) [evidence-b3-migration-0031](#evidence-evidence-b3-migration-0031) [evidence-b3-feedback-grant-insert](#evidence-evidence-b3-feedback-grant-insert) [evidence-b3-feedback-batch-probes](#evidence-evidence-b3-feedback-batch-probes) [evidence-b3-feedback-window-constants](#evidence-evidence-b3-feedback-window-constants) [evidence-b3-feedback-effect-expiry](#evidence-evidence-b3-feedback-effect-expiry)

<a id="claim-leaf-categorical-reader-feedback-3"></a>
- [Notes never reach generation: a compiled signal carries only the category, exact target, and fact and theme ids, the provider packet replaces that target with a context alias, and the resonance loader does not select stored notes\. Execution and runner admission recompile each pinned event against the live grant, and the publication batch fails if the event, its reading, or the grant changed\.](patternlike-source-mindmap.md#claim-leaf-categorical-reader-feedback-3) — [evidence-b3-feedback-signal-value](#evidence-evidence-b3-feedback-signal-value) [evidence-b3-feedback-target-alias](#evidence-evidence-b3-feedback-target-alias) [evidence-b3-resonance-feedback-select](#evidence-evidence-b3-resonance-feedback-select) [evidence-b3-feedback-execution-recheck](#evidence-evidence-b3-feedback-execution-recheck) [evidence-b3-feedback-runner-recheck](#evidence-evidence-b3-feedback-runner-recheck) [evidence-b3-feedback-publication-guard](#evidence-evidence-b3-feedback-publication-guard) [evidence-b3-feedback-guards-in-batch](#evidence-evidence-b3-feedback-guards-in-batch)

<a id="claim-leaf-select-chart-evidence-1"></a>
- [Execution reloads the command's ontology version, derives or reuses the chart's natal feature set, and cancels when the bundle or feature\-set hash no longer matches\. selectPatternEvidence then builds the packet the planner receives before any Pattern prose exists\.](patternlike-source-mindmap.md#claim-leaf-select-chart-evidence-1) — [evidence-b4-execute-frozen-ontology](#evidence-evidence-b4-execute-frozen-ontology) [evidence-b4-execute-feature-set](#evidence-evidence-b4-execute-feature-set) [evidence-b4-natal-feature-derivation](#evidence-evidence-b4-natal-feature-derivation) [evidence-apps-api-services-pattern-execute-ts](#evidence-evidence-apps-api-services-pattern-execute-ts) [evidence-b4-execute-planner-input](#evidence-evidence-b4-execute-planner-input)

<a id="claim-leaf-select-chart-evidence-3"></a>
- [Selection accounts for every feature: one without a matching ontology record is marked unsupported, mandatory evidence is always kept or selection fails, and the rest are ranked by score, with feature\-ID tie\-breaks, up to the packet bound\.](patternlike-source-mindmap.md#claim-leaf-select-chart-evidence-3) — [evidence-b4-selection-unsupported](#evidence-evidence-b4-selection-unsupported) [evidence-b4-selection-mandatory](#evidence-evidence-b4-selection-mandatory) [evidence-b4-selection-ranking](#evidence-evidence-b4-selection-ranking) [evidence-b4-selection-bound](#evidence-evidence-b4-selection-bound)

<a id="claim-leaf-select-chart-evidence-2"></a>
- [Reservation freezes a command that pins the chart fingerprint, feature set, selection policy, locale, consent, ontology version and bundle hash, Pattern source hash, and publisher settings\. Execution cancels when the source hash, consent, active chart, or claim ownership no longer match it\.](patternlike-source-mindmap.md#claim-leaf-select-chart-evidence-2) — [evidence-b4-enqueue-command-pins](#evidence-evidence-b4-enqueue-command-pins) [evidence-b4-execute-source-gate](#evidence-evidence-b4-execute-source-gate) [evidence-b4-execute-consent-gate](#evidence-evidence-b4-execute-consent-gate) [evidence-b4-execute-chart-gate](#evidence-evidence-b4-execute-chart-gate) [evidence-b4-execute-claim-owner](#evidence-evidence-b4-execute-claim-owner)

<a id="claim-leaf-plan-write-and-verify-1"></a>
- [Each delivery claims its stage before a planner, writer, or semantic verifier pass, and commands cap attempts at 2, 3, and 2\. An invalid plan retries the planner while planner attempts remain and otherwise fails as plan\_invalid; candidate\-validation, semantic, and correctable publication\-safety failures return to the writer with a correction document while writer attempts remain\. Correction documents accumulate sanitized, deduplicated findings from earlier attempts; retained history must match the frozen plan hash and carry an earlier positive attempt number\.](patternlike-source-mindmap.md#claim-leaf-plan-write-and-verify-1) — [evidence-b4-execute-claim-stage](#evidence-evidence-b4-execute-claim-stage) [evidence-b4-enqueue-attempt-caps](#evidence-evidence-b4-enqueue-attempt-caps) [evidence-b4-execute-plan-retry](#evidence-evidence-b4-execute-plan-retry) [evidence-b4-execute-deterministic-correction](#evidence-evidence-b4-execute-deterministic-correction) [evidence-b4-execute-semantic-correction](#evidence-evidence-b4-execute-semantic-correction) [evidence-b4-execute-safety-correction](#evidence-evidence-b4-execute-safety-correction) [evidence-b4-correction-history-guards](#evidence-evidence-b4-correction-history-guards) [evidence-b4-correction-history-projection](#evidence-evidence-b4-correction-history-projection) [evidence-b4-correction-history-deduplication](#evidence-evidence-b4-correction-history-deduplication) [evidence-b4-correction-history-reuse](#evidence-evidence-b4-correction-history-reuse)

<a id="claim-leaf-plan-write-and-verify-2"></a>
- [The executor runs validatePatternPlan on planner output and validatePatternCandidate on each writer output before the publication proof\. The proof rereads stored artifacts, compares the fact packet, recomputes the plan and candidate hashes against the job, and reads the verdict at the job's current verifier attempt, which must be pass; the publish transition then records the verdict hash\.](patternlike-source-mindmap.md#claim-leaf-plan-write-and-verify-2) — [evidence-apps-api-services-pattern-execute-ts-2](#evidence-evidence-apps-api-services-pattern-execute-ts-2) [evidence-apps-api-services-pattern-execute-ts-7](#evidence-evidence-apps-api-services-pattern-execute-ts-7) [evidence-b4-execute-publication-proof](#evidence-evidence-b4-execute-publication-proof) [evidence-b4-proof-verdict-read](#evidence-evidence-b4-proof-verdict-read) [evidence-b4-proof-hash-recompute](#evidence-evidence-b4-proof-hash-recompute) [evidence-b4-stage-publish-verdict-hash](#evidence-evidence-b4-stage-publish-verdict-hash)

<a id="claim-leaf-plan-write-and-verify-3"></a>
- [The proof builds the public projection, which drops feature aliases and rule citations, and runs deterministic publication safety over the writer output and that projection\. Suppressed\-feature leaks, uncited astrological claims, broken source dependencies, prohibited claims, missing mandatory coverage, private\-identifier leaks, and a non\-pass verdict each block publication\.](patternlike-source-mindmap.md#claim-leaf-plan-write-and-verify-3) — [evidence-b4-projection-text-only](#evidence-evidence-b4-projection-text-only) [evidence-b4-proof-safety](#evidence-evidence-b4-proof-safety) [evidence-b4-safety-failure-codes](#evidence-evidence-b4-safety-failure-codes) [evidence-b4-proof-safety-refusal](#evidence-evidence-b4-proof-safety-refusal)

<a id="claim-leaf-plan-write-and-verify-4"></a>
- [Publication runs one D1 batch that re\-checks account, chart, locale, consent, ontology, and claim state, stores the encrypted document, and inserts the Pattern's passage\-connection support record; connections are covered under Reader experience\.](patternlike-source-mindmap.md#claim-leaf-plan-write-and-verify-4) — [evidence-b4-execute-authorization-guard](#evidence-evidence-b4-execute-authorization-guard) [evidence-b4-proof-authorization-account](#evidence-evidence-b4-proof-authorization-account) [evidence-b4-proof-authorization-consent-claim](#evidence-evidence-b4-proof-authorization-consent-claim) [evidence-b4-execute-document-encryption](#evidence-evidence-b4-execute-document-encryption) [evidence-b1-pattern-relationship-batch](#evidence-evidence-b1-pattern-relationship-batch)

<a id="claim-leaf-read-regenerate-and-erase-1"></a>
- [GET /v1/pattern answers only from the generated Pattern for the active chart, decrypting the stored document and projecting it without private evidence\. A recalled ontology, a deleted, withdrawn, or in\-progress claim, or a failed last generation gets an explicit refusal\. Legacy editorial releases are covered under Contracts, content, and verification\.](patternlike-source-mindmap.md#claim-leaf-read-regenerate-and-erase-1) — [evidence-apps-api-routes-pattern-ts](#evidence-evidence-apps-api-routes-pattern-ts) [evidence-b4-state-decrypt-project](#evidence-evidence-b4-state-decrypt-project) [evidence-b4-read-recalled](#evidence-evidence-b4-read-recalled) [evidence-b4-read-claim-refusals](#evidence-evidence-b4-read-claim-refusals) [evidence-b4-read-failed-refusal](#evidence-evidence-b4-read-failed-refusal)

<a id="claim-leaf-read-regenerate-and-erase-2"></a>
- [A generation claim is unique per account and chart fingerprint; the publication batch accepts it, and it ends deleted, superseded, or withdrawn\. DELETE /v1/pattern removes the document, cancels Pattern work, erases the account's generation keys, and marks the claim deleted in one batch\.](patternlike-source-mindmap.md#claim-leaf-read-regenerate-and-erase-2) — [evidence-b4-claims-unique](#evidence-evidence-b4-claims-unique) [evidence-b4-claims-accept](#evidence-evidence-b4-claims-accept) [evidence-b4-claims-terminal](#evidence-evidence-b4-claims-terminal) [evidence-b4-delete-route](#evidence-evidence-b4-delete-route) [evidence-b4-delete-erasure](#evidence-evidence-b4-delete-erasure)

<a id="claim-leaf-read-regenerate-and-erase-3"></a>
- [For an accepted Pattern on the active chart, Pattern state marks regeneration eligible when its source hash differs from the current one, generation is enabled, consent is granted, the ontology serves readers, and no replacement is in flight\. A confirmed source\_update request reserves that replacement on the accepted claim; the reader shows its progress and offers regeneration only when eligible\.](patternlike-source-mindmap.md#claim-leaf-read-regenerate-and-erase-3) — [evidence-b4-state-regeneration-eligibility](#evidence-evidence-b4-state-regeneration-eligibility) [evidence-b4-state-regeneration-in-flight](#evidence-evidence-b4-state-regeneration-in-flight) [evidence-b4-regenerate-confirm](#evidence-evidence-b4-regenerate-confirm) [evidence-b4-claims-pending-regeneration](#evidence-evidence-b4-claims-pending-regeneration) [evidence-b4-web-regeneration-progress](#evidence-evidence-b4-web-regeneration-progress) [evidence-b4-web-regeneration-gate](#evidence-evidence-b4-web-regeneration-gate)

<a id="claim-leaf-offline-ontology-supply-1"></a>
- [apps/api/scripts/build\-internal\-ontology\.ts reads a corpus\-release file named on the command line \(prepare\-ontology\-corpus\.ts builds one from the committed fragments\), copies its corpus hash without a registration check, and writes an unsigned synthetic\_internal candidate of source\_supported records that each cite one fragment\. It makes no provider call\.](patternlike-source-mindmap.md#claim-leaf-offline-ontology-supply-1) — [evidence-b4-builder-corpus-input](#evidence-evidence-b4-builder-corpus-input) [evidence-b4-prepare-corpus-cli](#evidence-evidence-b4-prepare-corpus-cli) [evidence-b4-builder-corpus-hash-copy](#evidence-evidence-b4-builder-corpus-hash-copy) [evidence-b4-builder-contract](#evidence-evidence-b4-builder-contract) [evidence-b4-builder-record-shape](#evidence-evidence-b4-builder-record-shape) [evidence-b4-builder-origin](#evidence-evidence-b4-builder-origin)

<a id="claim-leaf-offline-ontology-supply-2"></a>
- [Against the committed 60\-fragment corpus, default version pattern\-ontology\-en\-us\-internal\-0\.1\.2 maps 35 fragments to 36 records\. Concentration \(6\.2\) matches only stellium; the sign sections, section 8, 6\.3 to 6\.5, and 7\.3 to 7\.4 get no record; section 7\.1 adds an exact\-time methodology record; explicit source counter\-expressions are kept verbatim\.](patternlike-source-mindmap.md#claim-leaf-offline-ontology-supply-2) — [evidence-b4-builder-version](#evidence-evidence-b4-builder-version) [evidence-b4-builder-yield](#evidence-evidence-b4-builder-yield) [evidence-b4-builder-stellium](#evidence-evidence-b4-builder-stellium) [evidence-b4-builder-exact-time](#evidence-evidence-b4-builder-exact-time) [evidence-b4-builder-counter-marker](#evidence-evidence-b4-builder-counter-marker)

<a id="claim-leaf-offline-ontology-supply-3"></a>
- [The builder exits unless the candidate compiles, then writes evaluator\_passed true, unevaluated\_fixture\_count 0, and regression\_passed false as constants; no evaluator or regression rehearsal runs\. These fields and its sentence matching are not independent evaluation, editorial adjudication, or completed human review\.](patternlike-source-mindmap.md#claim-leaf-offline-ontology-supply-3) — [evidence-b4-builder-compile-gate](#evidence-evidence-b4-builder-compile-gate) [evidence-b4-builder-evaluation-fields](#evidence-evidence-b4-builder-evaluation-fields) [evidence-b4-builder-yield](#evidence-evidence-b4-builder-yield) [evidence-b4-corpus-human-review](#evidence-evidence-b4-corpus-human-review)

<a id="claim-leaf-offline-ontology-supply-4"></a>
- [The internal sign route accepts only compiled synthetic\_internal releases and returns the release, with a recomputed bundle hash, and the isolated signer's signature without storing it; POST /internal/pattern\-ontology\-releases stores and activates it\. An active synthetic\_internal release is admitted by origin, and neither signing path certifies interpretation quality\.](patternlike-source-mindmap.md#claim-leaf-offline-ontology-supply-4) — [evidence-b4-sign-origin](#evidence-evidence-b4-sign-origin) [evidence-b4-sign-route-return](#evidence-evidence-b4-sign-route-return) [evidence-b4-internal-store](#evidence-evidence-b4-internal-store) [evidence-b4-ontology-pointer-update](#evidence-evidence-b4-ontology-pointer-update) [evidence-b4-ontology-internal-origin](#evidence-evidence-b4-ontology-internal-origin) [evidence-b4-sign-quality-limit](#evidence-evidence-b4-sign-quality-limit)

<a id="claim-leaf-offline-ontology-supply-5"></a>
- [The September 6 active\-pointer join recorded internal release 0\.1\.0 with bundle hash sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84, corpus hash sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c, and a null joined machine evidence run; it does not prove a current signature, current activation, or a complete evidence census\.](patternlike-source-mindmap.md#claim-leaf-offline-ontology-supply-5) — [evidence-b4-recorded-ontology-pointer-join](#evidence-evidence-b4-recorded-ontology-pointer-join)

<a id="claim-leaf-parked-machine-ontology-producer-1"></a>
- [The implemented machine producer takes a registered corpus through generation, compilation, evaluation, regression, signing by the isolated signer, and ingestion\. Run commands are refused and deliveries retry without claiming a run unless rollout resolves to internal; committed production configuration sets ONTOLOGY\_PIPELINE\_ROLLOUT off\.](patternlike-source-mindmap.md#claim-leaf-parked-machine-ontology-producer-1) — [evidence-b4-pipeline-registered-corpus](#evidence-evidence-b4-pipeline-registered-corpus) [evidence-b4-pipeline-stage-graph](#evidence-evidence-b4-pipeline-stage-graph) [evidence-b4-pipeline-isolated-signer](#evidence-evidence-b4-pipeline-isolated-signer) [evidence-b4-pipeline-rollout-gate](#evidence-evidence-b4-pipeline-rollout-gate) [evidence-b4-pipeline-command-gate](#evidence-evidence-b4-pipeline-command-gate) [evidence-apps-api-wrangler-toml](#evidence-evidence-apps-api-wrangler-toml)

<a id="claim-leaf-parked-machine-ontology-producer-3"></a>
- [Ingestion stores the signed release with its committed pipeline evidence, moves the active pointer to it, and marks the previous active release superseded\. It then recalls earlier releases that lack committed pipeline evidence, withdrawing the Patterns generated from them\.](patternlike-source-mindmap.md#claim-leaf-parked-machine-ontology-producer-3) — [evidence-b4-pipeline-ingest-activate](#evidence-evidence-b4-pipeline-ingest-activate) [evidence-b4-ontology-pointer-update](#evidence-evidence-b4-ontology-pointer-update) [evidence-b4-ontology-supersede](#evidence-evidence-b4-ontology-supersede) [evidence-b4-lifecycle-recall-scope](#evidence-evidence-b4-lifecycle-recall-scope) [evidence-b4-lifecycle-machine-recall](#evidence-evidence-b4-lifecycle-machine-recall) [evidence-b4-lifecycle-withdraw-documents](#evidence-evidence-b4-lifecycle-withdraw-documents)

<a id="claim-leaf-parked-machine-ontology-producer-2"></a>
- [New generation needs an active release that ontologyServesAccount admits: synthetic\_internal by origin, machine\_pipeline only with public activation scope, re\-derived on each read from committed evidence that includes a licensed\_excerpt, public\-capable corpus\. Enqueue checks the pause switch before this test and refuses with ontology\_unavailable when the release does not qualify\.](patternlike-source-mindmap.md#claim-leaf-parked-machine-ontology-producer-2) — [evidence-b4-ontology-internal-origin](#evidence-evidence-b4-ontology-internal-origin) [evidence-b4-ontology-machine-scope](#evidence-evidence-b4-ontology-machine-scope) [evidence-b4-ontology-licensed-excerpt](#evidence-evidence-b4-ontology-licensed-excerpt) [evidence-b4-enqueue-ontology-gate](#evidence-evidence-b4-enqueue-ontology-gate) [evidence-b4-enqueue-pause-gate](#evidence-evidence-b4-enqueue-pause-gate)

<a id="claim-leaf-source-provenance-and-rights-1"></a>
- [The fragment validator fails unless provenance\.json keeps model\-generated first\-party origin, the rights decision file's hash, and one canonical hash per fragment\. review\.mjs records a review only with a valid signature from a reviewer enrolled as human and independent of generation\.](patternlike-source-mindmap.md#claim-leaf-source-provenance-and-rights-1) — [evidence-b4-validator-provenance](#evidence-evidence-b4-validator-provenance) [evidence-b4-provenance-origin-check](#evidence-evidence-b4-provenance-origin-check) [evidence-b4-provenance-rights-hash](#evidence-evidence-b4-provenance-rights-hash) [evidence-b4-provenance-fragment-hash](#evidence-evidence-b4-provenance-fragment-hash) [evidence-b4-review-signature](#evidence-evidence-b4-review-signature) [evidence-b4-review-enrollment](#evidence-evidence-b4-review-enrollment)

<a id="claim-leaf-source-provenance-and-rights-2"></a>
- [By its own account the committed record is incomplete: 60 model\-generated fragments; provider, model, model version, account context, and generation time all unverified; zero certified fragments; an empty reviewer registry; and five outstanding public\-activation items\.](patternlike-source-mindmap.md#claim-leaf-source-provenance-and-rights-2) — [evidence-pattern-corpus-readme-md](#evidence-evidence-pattern-corpus-readme-md) [evidence-b4-provenance-generation](#evidence-evidence-b4-provenance-generation) [evidence-b4-corpus-human-review](#evidence-evidence-b4-corpus-human-review) [evidence-pattern-corpus-reviewers-json](#evidence-evidence-pattern-corpus-reviewers-json) [evidence-b4-provenance-outstanding](#evidence-evidence-b4-provenance-outstanding)

<a id="claim-leaf-source-provenance-and-rights-3"></a>
- [A licensed\_excerpt class, a source\_supported label, and passing hash or signature checks do not establish human authorship, completed review, or activation approval\. The corpus rights decision defines source\_supported as supported by a source the project generated\.](patternlike-source-mindmap.md#claim-leaf-source-provenance-and-rights-3) — [evidence-b4-readme-rights-authorship](#evidence-evidence-b4-readme-rights-authorship) [evidence-b4-readme-no-activation](#evidence-evidence-b4-readme-no-activation) [evidence-b4-review-operator-attested](#evidence-evidence-b4-review-operator-attested) [evidence-b4-decision-source-supported](#evidence-evidence-b4-decision-source-supported)

<a id="claim-leaf-source-provenance-and-rights-4"></a>
- [At runtime a licensed\_excerpt corpus is public\-capable, and publication safety accepts a source\_supported record when its cited fragment IDs belong to the registered corpus\.](patternlike-source-mindmap.md#claim-leaf-source-provenance-and-rights-4) — [evidence-b4-corpus-public-capable](#evidence-evidence-b4-corpus-public-capable) [evidence-b4-safety-source-supported](#evidence-evidence-b4-safety-source-supported) [evidence-b4-execute-registered-fragments](#evidence-evidence-b4-execute-registered-fragments)

<a id="claim-leaf-failed-generation-inspection-1"></a>
- [GET /admin/pattern\-generations/:generation\_id/diagnostics projects one generation from lifecycle, attempt, queue\-schedule, and current provider\-pass columns only, mapping stored values onto closed enums; it reads no encrypted column or artifact\. Access recording is covered under Identity and privacy\.](patternlike-source-mindmap.md#claim-leaf-failed-generation-inspection-1) — [evidence-b4-admin-mount](#evidence-evidence-b4-admin-mount) [evidence-b4-admin-diagnostics-route](#evidence-evidence-b4-admin-diagnostics-route) [evidence-b4-diagnostics-columns](#evidence-evidence-b4-diagnostics-columns) [evidence-b4-diagnostics-closed](#evidence-evidence-b4-diagnostics-closed)

<a id="claim-leaf-failed-generation-inspection-2"></a>
- [The candidate\-revalidation admin route accepts only a generation that failed as candidate\_invalid within artifact retention\. It checks the frozen plan hash and ontology bundle and corpus hashes, requires a writer request rebuilt from the retained plan, packet, and ontology to equal the retained one, and reruns validatePatternCandidate on the exact retained writer response\.](patternlike-source-mindmap.md#claim-leaf-failed-generation-inspection-2) — [evidence-b4-revalidation-route](#evidence-evidence-b4-revalidation-route) [evidence-b4-revalidation-scope](#evidence-evidence-b4-revalidation-scope) [evidence-b4-revalidation-plan-hash](#evidence-evidence-b4-revalidation-plan-hash) [evidence-b4-revalidation-ontology](#evidence-evidence-b4-revalidation-ontology) [evidence-b4-revalidation-request](#evidence-evidence-b4-revalidation-request) [evidence-b4-revalidation-rerun](#evidence-evidence-b4-revalidation-rerun)

<a id="claim-leaf-failed-generation-inspection-3"></a>
- [The result carries coordinates, seven hashes, and failures limited to a fixed code list with JSON paths; a binding, retention, or erasure change seen after the reads refuses it\. The route records access before decrypting and refuses when that record fails \(audit rows under Identity and privacy\)\. It is not semantic approval, publication, or regeneration\.](patternlike-source-mindmap.md#claim-leaf-failed-generation-inspection-3) — [evidence-b4-revalidation-result-hashes](#evidence-evidence-b4-revalidation-result-hashes) [evidence-b4-revalidation-fixed-codes](#evidence-evidence-b4-revalidation-fixed-codes) [evidence-b4-revalidation-final-recheck](#evidence-evidence-b4-revalidation-final-recheck) [evidence-b4-revalidation-audit-first](#evidence-evidence-b4-revalidation-audit-first) [evidence-b4-revalidation-audit-unavailable](#evidence-evidence-b4-revalidation-audit-unavailable) [evidence-b4-revalidation-contract](#evidence-evidence-b4-revalidation-contract)

<a id="claim-leaf-images-derived-from-chapters-1"></a>
- [Under the adaptive v2 protocol, which the web client requests, a published Pattern of three to six chapters can have a portrait; the v1 protocol still admits exactly four chapters\. New v2 reservations return 503 adaptive\_portrait\_unavailable unless PATTERN\_ADAPTIVE\_PORTRAITS\_ENABLED is exactly 1, and both committed wrangler blocks set it to 0\.](patternlike-source-mindmap.md#claim-leaf-images-derived-from-chapters-1) — [evidence-b5-portrait-chapter-count-gate](#evidence-evidence-b5-portrait-chapter-count-gate) [evidence-b5-portrait-chapter-count-range](#evidence-evidence-b5-portrait-chapter-count-range) [evidence-b5-portrait-v1-four-chapters](#evidence-evidence-b5-portrait-v1-four-chapters) [evidence-b5-web-portrait-protocol-v2](#evidence-evidence-b5-web-portrait-protocol-v2) [evidence-b5-adaptive-admission-503](#evidence-evidence-b5-adaptive-admission-503) [evidence-b5-adaptive-switch-exact](#evidence-evidence-b5-adaptive-switch-exact) [evidence-b5-wrangler-adaptive-default](#evidence-evidence-b5-wrangler-adaptive-default) [evidence-b5-wrangler-adaptive-production](#evidence-evidence-b5-wrangler-adaptive-production)

<a id="claim-leaf-images-derived-from-chapters-3"></a>
- [Each image job's prompt carries one chapter's complete published text, title through counter\-expression, as source material\. The runner fails the run on any item type other than image generation and passive messages, reasoning, function\-call output, or plans, and on a second completed image item\. The Worker encrypts each image under the Pattern document's content key and stores it in R2 under pattern\-portraits/, apart from the document\.](patternlike-source-mindmap.md#claim-leaf-images-derived-from-chapters-3) — [evidence-b5-portrait-chapter-source-text](#evidence-evidence-b5-portrait-chapter-source-text) [evidence-b5-portrait-prompt-source-material](#evidence-evidence-b5-portrait-prompt-source-material) [evidence-b5-runner-passive-items](#evidence-evidence-b5-runner-passive-items) [evidence-b5-runner-image-items-only](#evidence-evidence-b5-runner-image-items-only) [evidence-b5-runner-single-image](#evidence-evidence-b5-runner-single-image) [evidence-b5-portrait-document-key](#evidence-evidence-b5-portrait-document-key) [evidence-b5-portrait-image-encryption](#evidence-evidence-b5-portrait-image-encryption) [evidence-b5-portrait-object-key](#evidence-evidence-b5-portrait-object-key)

<a id="claim-leaf-images-derived-from-chapters-2"></a>
- [Portrait and job rows bind images to the owner, chart, Pattern document hash and revision, and each chapter's source hash, which is re\-checked when a job is claimed\. Completions must match the lease and source hash, and v2 terminals must also match chapter count, index, and revision\. Image serving re\-checks the owner and current Pattern and verifies the decrypted image hash\.](patternlike-source-mindmap.md#claim-leaf-images-derived-from-chapters-2) — [evidence-b5-portrait-row-matches](#evidence-evidence-b5-portrait-row-matches) [evidence-b5-portrait-claim-source-hash](#evidence-evidence-b5-portrait-claim-source-hash) [evidence-b5-portrait-completion-binding](#evidence-evidence-b5-portrait-completion-binding) [evidence-b5-portrait-terminal-v2-binding](#evidence-evidence-b5-portrait-terminal-v2-binding) [evidence-b5-portrait-image-serving-query](#evidence-evidence-b5-portrait-image-serving-query) [evidence-b5-portrait-plaintext-hash](#evidence-evidence-b5-portrait-plaintext-hash)

<a id="claim-leaf-compiled-and-inspected-3d-objects-1"></a>
- [The runner has one model call author a schema\-constrained geometry program from the chapter image and chapter text, compiles it into a GLB, and renders four fixed inspection views\. It reports success only when a separate audit call over those four views sets every acceptance criterion true\.](patternlike-source-mindmap.md#claim-leaf-compiled-and-inspected-3d-objects-1) — [evidence-b5-mesh-author-instructions](#evidence-evidence-b5-mesh-author-instructions) [evidence-b5-mesh-program-schema](#evidence-evidence-b5-mesh-program-schema) [evidence-apps-codex-runner-portrait-mesh-invocation-ts](#evidence-evidence-apps-codex-runner-portrait-mesh-invocation-ts) [evidence-b5-mesh-four-previews](#evidence-evidence-b5-mesh-four-previews) [evidence-b5-mesh-separate-audit](#evidence-evidence-b5-mesh-separate-audit) [evidence-b5-mesh-audit-criteria](#evidence-evidence-b5-mesh-audit-criteria)

<a id="claim-leaf-compiled-and-inspected-3d-objects-2"></a>
- [Worker and browser checks bind each model to its chapter, source image, source text, document revision, compiler and authoring provenance, program hash, and GLB hash; v2 models also bind chapter count and index\. The browser checks the GLB's embedded identity and hash again before the loader parses it\.](patternlike-source-mindmap.md#claim-leaf-compiled-and-inspected-3d-objects-2) — [evidence-b5-mesh-completion-glb-identity](#evidence-evidence-b5-mesh-completion-glb-identity) [evidence-b5-mesh-serving-binding](#evidence-evidence-b5-mesh-serving-binding) [evidence-b5-mesh-browser-v2-binding](#evidence-evidence-b5-mesh-browser-v2-binding) [evidence-b5-mesh-browser-glb-provenance](#evidence-evidence-b5-mesh-browser-glb-provenance) [evidence-apps-web-components-accountportraitexplorer-tsx](#evidence-evidence-apps-web-components-accountportraitexplorer-tsx) [evidence-b5-scene-glb-reverify](#evidence-evidence-b5-scene-glb-reverify)

<a id="claim-leaf-compiled-and-inspected-3d-objects-3"></a>
- [Download complete portrait fetches a private, no\-store bundle of the published reading, chapter images, GLB models, programs, and audits\. Before offering the file, the browser re\-validates the bundle against the current Pattern and checks every image, GLB, program, and chapter source text against its recorded hash\.](patternlike-source-mindmap.md#claim-leaf-compiled-and-inspected-3d-objects-3) — [evidence-b5-explorer-download-models](#evidence-evidence-b5-explorer-download-models) [evidence-b5-explorer-download-bundle](#evidence-evidence-b5-explorer-download-bundle) [evidence-b5-mesh-routes-no-store](#evidence-evidence-b5-mesh-routes-no-store) [evidence-b5-download-verified-before-save](#evidence-evidence-b5-download-verified-before-save) [evidence-b5-download-reading-match](#evidence-evidence-b5-download-reading-match) [evidence-b5-download-image-hash](#evidence-evidence-b5-download-image-hash) [evidence-b5-download-model-hashes](#evidence-evidence-b5-download-model-hashes)

<a id="claim-leaf-adaptive-schema-guards-1"></a>
- [Migration 0033 stores each reservation's chapter count, three to six, and its protocol\. Table checks allow v1 only with four chapters and policy 1\.0\.0 and v2 only with policy 2\.0\.0, and triggers reject later count or protocol changes and image or mesh job indexes outside the count\.](patternlike-source-mindmap.md#claim-leaf-adaptive-schema-guards-1) — [evidence-b5-0033-count-range](#evidence-evidence-b5-0033-count-range) [evidence-b5-0033-protocol-check](#evidence-evidence-b5-0033-protocol-check) [evidence-b5-0033-identity-immutable](#evidence-evidence-b5-0033-identity-immutable) [evidence-b5-0033-image-index-trigger](#evidence-evidence-b5-0033-image-index-trigger) [evidence-b5-0033-mesh-index-trigger](#evidence-evidence-b5-0033-mesh-index-trigger)

<a id="claim-leaf-adaptive-schema-guards-2"></a>
- [Portrait matching reads rows without the adaptive columns as v1 four\-chapter portraits\. Image and mesh maintenance return early, and mesh work is unavailable, until PRAGMA table\_info shows chapter\_count and protocol\_version, so these lanes cancel no portrait and delete no stored object before migration 0033 is applied\.](patternlike-source-mindmap.md#claim-leaf-adaptive-schema-guards-2) — [evidence-b5-portrait-legacy-row-shape](#evidence-evidence-b5-portrait-legacy-row-shape) [evidence-b5-adaptive-schema-probe](#evidence-evidence-b5-adaptive-schema-probe) [evidence-b5-portrait-maintenance-stand-down](#evidence-evidence-b5-portrait-maintenance-stand-down) [evidence-b5-mesh-migration-gate](#evidence-evidence-b5-mesh-migration-gate) [evidence-b5-mesh-maintenance-stand-down](#evidence-evidence-b5-mesh-maintenance-stand-down)

<a id="claim-leaf-interactive-observatory-1"></a>
- [The Three\.js observatory builds one reading station per published chapter, three through six, with reading desks, object inspection, comparison, guided reading, and a chart\-informed zodiac instrument\.](patternlike-source-mindmap.md#claim-leaf-interactive-observatory-1) — [evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx](#evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx) [evidence-b5-observatory-per-chapter](#evidence-evidence-b5-observatory-per-chapter) [evidence-b5-observatory-stations](#evidence-evidence-b5-observatory-stations) [evidence-b5-observatory-reading-desk](#evidence-evidence-b5-observatory-reading-desk) [evidence-b5-observatory-look-closer](#evidence-evidence-b5-observatory-look-closer) [evidence-b5-observatory-compare](#evidence-evidence-b5-observatory-compare) [evidence-b5-observatory-guided](#evidence-evidence-b5-observatory-guided) [evidence-b5-observatory-zodiac](#evidence-evidence-b5-observatory-zodiac)

<a id="claim-leaf-interactive-observatory-2"></a>
- [On Your Pattern it is the default presentation of a matching published Pattern of three to six chapters; a chapter opened from a passage connection starts as text with the observatory closed\. It needs no generated artwork: a chapter without a verified asset renders an authored reading folio in the same station\.](patternlike-source-mindmap.md#claim-leaf-interactive-observatory-2) — [evidence-b1-portrait-can-render](#evidence-evidence-b1-portrait-can-render) [evidence-b1-portrait-default-open](#evidence-evidence-b1-portrait-default-open) [evidence-b5-linked-chapter-closed](#evidence-evidence-b5-linked-chapter-closed) [evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx](#evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx) [evidence-apps-web-components-portrait-explorer-portraitscene-tsx](#evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx) [evidence-b5-scene-folio-fallback](#evidence-evidence-b5-scene-folio-fallback) [evidence-b5-scene-glb-reverify](#evidence-evidence-b5-scene-glb-reverify)

<a id="claim-leaf-interactive-observatory-3"></a>
- [The observatory offers daylight and dusk, roof controls, object turns, desk interactions, and navigation through source\-linked chapter passages\.](patternlike-source-mindmap.md#claim-leaf-interactive-observatory-3) — [evidence-b5-controls-lighting](#evidence-evidence-b5-controls-lighting) [evidence-b5-controls-roof](#evidence-evidence-b5-controls-roof) [evidence-b5-controls-turn](#evidence-evidence-b5-controls-turn) [evidence-b5-controls-desk](#evidence-evidence-b5-controls-desk) [evidence-b5-scene-source-passage](#evidence-evidence-b5-scene-source-passage) [evidence-b5-reader-show-passage](#evidence-evidence-b5-reader-show-passage)

<a id="claim-leaf-complete-reading-and-graphics-recovery-1"></a>
- [The full reading retains chapter perspectives, additional signatures, and uncertainty; unavailable, generating, failed, and unverified\-artwork states discard the artwork and leave the reading standing rather than swapping in a separate view\.](patternlike-source-mindmap.md#claim-leaf-complete-reading-and-graphics-recovery-1) — [evidence-b5-complete-chapter-perspectives](#evidence-evidence-b5-complete-chapter-perspectives) [evidence-b5-complete-reading-signatures](#evidence-evidence-b5-complete-reading-signatures) [evidence-b5-explorer-discard-not-ready](#evidence-evidence-b5-explorer-discard-not-ready) [evidence-b5-explorer-verified-only](#evidence-evidence-b5-explorer-verified-only) [evidence-b5-explorer-asset-failure-stations](#evidence-evidence-b5-explorer-asset-failure-stations) [evidence-b5-scene-fallback-notice](#evidence-evidence-b5-scene-fallback-notice)

<a id="claim-leaf-complete-reading-and-graphics-recovery-2"></a>
- [Navigation preserves reading and camera state; reduced motion, low\-power graphics, authenticated asset verification, and WebGL cleanup support the experience\.](patternlike-source-mindmap.md#claim-leaf-complete-reading-and-graphics-recovery-2) — [evidence-b5-nav-memory-snapshot](#evidence-evidence-b5-nav-memory-snapshot) [evidence-b5-camera-bookmarks](#evidence-evidence-b5-camera-bookmarks) [evidence-b5-motion-and-power-settings](#evidence-evidence-b5-motion-and-power-settings) [evidence-b5-portrait-blob-credentials](#evidence-evidence-b5-portrait-blob-credentials) [evidence-b5-explorer-image-verify](#evidence-evidence-b5-explorer-image-verify) [evidence-b5-webgl-context-release](#evidence-evidence-b5-webgl-context-release)

<a id="claim-leaf-portrait-automation-permissions-1"></a>
- [Privacy's Pattern generation panel renders PortraitAutomationControl when a chart exists\. Its checkbox sets a chart\-bound automation grant separate from Pattern generation consent, and the client sends the fixed confirm string the route requires\. The control is hidden when the read reports automation unavailable and no enabled grant; while mesh automation is unavailable, the read reports no grant at all and changes return 503\.](patternlike-source-mindmap.md#claim-leaf-portrait-automation-permissions-1) — [evidence-b5-privacy-automation-control](#evidence-evidence-b5-privacy-automation-control) [evidence-b5-automation-grant-table](#evidence-evidence-b5-automation-grant-table) [evidence-b5-automation-checkbox](#evidence-evidence-b5-automation-checkbox) [evidence-b5-automation-client-confirm](#evidence-evidence-b5-automation-client-confirm) [evidence-b5-automation-confirm-strings](#evidence-evidence-b5-automation-confirm-strings) [evidence-b5-automation-control-hidden](#evidence-evidence-b5-automation-control-hidden) [evidence-b5-automation-read](#evidence-evidence-b5-automation-read) [evidence-b5-automation-set-503](#evidence-evidence-b5-automation-set-503) [evidence-b5-mesh-available](#evidence-evidence-b5-mesh-available)

<a id="claim-leaf-portrait-automation-permissions-4"></a>
- [Grants carry policy 1\.1\.0, for four\-chapter portraits only, or 2\.0\.0, for three to six chapters\. A 2\.0\.0 request needs the v2 header and enabling it needs the adaptive switch; enabling 2\.0\.0 turns off an enabled 1\.1\.0 grant, while a 1\.1\.0 request cannot replace an enabled 2\.0\.0 grant and is refused\. When mesh automation is available, v2 reads flag an enabled 1\.1\.0 grant as legacy\_enabled; the control can stop it, and its renewal checkbox is disabled while the adaptive switch is off\.](patternlike-source-mindmap.md#claim-leaf-portrait-automation-permissions-4) — [evidence-b5-automation-grant-protocol](#evidence-evidence-b5-automation-grant-protocol) [evidence-b5-automation-v2-header](#evidence-evidence-b5-automation-v2-header) [evidence-b5-automation-v2-switch](#evidence-evidence-b5-automation-v2-switch) [evidence-b5-automation-legacy-cannot-replace](#evidence-evidence-b5-automation-legacy-cannot-replace) [evidence-b5-automation-disable-other-policy](#evidence-evidence-b5-automation-disable-other-policy) [evidence-b5-automation-read](#evidence-evidence-b5-automation-read) [evidence-b5-automation-legacy-controls](#evidence-evidence-b5-automation-legacy-controls) [evidence-b5-automation-checkbox](#evidence-evidence-b5-automation-checkbox)

<a id="claim-leaf-portrait-automation-permissions-2"></a>
- [New Pattern documents, through a trigger, and newly enabled grants queue portrait starts on the grant's chart\. A repair step, run before mesh claims and by mesh maintenance, starts each queued portrait for the current Pattern under the grant's protocol and queues one mesh job per completed image; mesh claims re\-check the live grant, protocol, compiler, image, revision, and source hashes\.](patternlike-source-mindmap.md#claim-leaf-portrait-automation-permissions-2) — [evidence-b5-automation-publish-trigger](#evidence-evidence-b5-automation-publish-trigger) [evidence-b5-automation-enable-outbox](#evidence-evidence-b5-automation-enable-outbox) [evidence-b5-mesh-claim-repair](#evidence-evidence-b5-mesh-claim-repair) [evidence-b5-mesh-maintenance-repair](#evidence-evidence-b5-mesh-maintenance-repair) [evidence-b5-outbox-current-pattern](#evidence-evidence-b5-outbox-current-pattern) [evidence-b5-automation-grant-protocol](#evidence-evidence-b5-automation-grant-protocol) [evidence-b5-mesh-job-enqueue](#evidence-evidence-b5-mesh-job-enqueue) [evidence-b5-mesh-claim-context](#evidence-evidence-b5-mesh-claim-context)

<a id="claim-leaf-portrait-automation-permissions-3"></a>
- [Disabling automation clears the grant's enabled flag, and a trigger cancels its pending outbox rows and unfinished image and mesh jobs and marks unfinished portraits failed, without touching completed jobs or the Pattern document\. The control's save message confirms the preference, not completed cancellation\. Consent withdrawal, Pattern erasure, and account deletion run separate triggers\.](patternlike-source-mindmap.md#claim-leaf-portrait-automation-permissions-3) — [evidence-b5-automation-disable](#evidence-evidence-b5-automation-disable) [evidence-b5-automation-withdraw-trigger](#evidence-evidence-b5-automation-withdraw-trigger) [evidence-b5-automation-saved-message](#evidence-evidence-b5-automation-saved-message) [evidence-b5-consent-withdraw-trigger](#evidence-evidence-b5-consent-withdraw-trigger) [evidence-b5-document-erasure-trigger](#evidence-evidence-b5-document-erasure-trigger) [evidence-b5-account-delete-trigger](#evidence-evidence-b5-account-delete-trigger)

<a id="claim-leaf-worker-web-assets-and-pwa-1"></a>
- [apps/api is one Hono Worker whose default export provides fetch, queue, and scheduled handlers\. Committed production configuration serves the built React web app from apps/web/dist as that Worker's static assets, so the PWA and the API share one origin\.](patternlike-source-mindmap.md#claim-leaf-worker-web-assets-and-pwa-1) — [evidence-b6-worker-entry-points](#evidence-evidence-b6-worker-entry-points) [evidence-b6-hono-app](#evidence-evidence-b6-hono-app) [evidence-production-web-assets](#evidence-evidence-production-web-assets) [evidence-b6-web-react](#evidence-evidence-b6-web-react)

<a id="claim-leaf-worker-web-assets-and-pwa-2"></a>
- [Committed production configuration lists /health, /v1, /internal, /admin, /codex\-provider, and /crypto\-operator in run\_worker\_first, so the Worker handles them before static assets, and sets not\_found\_handling to single\-page\-application for other paths\. The service worker registers only in production builds, precaches the app shell, and bypasses /v1 requests\.](patternlike-source-mindmap.md#claim-leaf-worker-web-assets-and-pwa-2) — [evidence-apps-api-wrangler-toml-2](#evidence-evidence-apps-api-wrangler-toml-2) [evidence-b6-spa-fallback](#evidence-evidence-b6-spa-fallback) [evidence-b6-sw-registration](#evidence-evidence-b6-sw-registration) [evidence-b6-sw-shell-precache](#evidence-evidence-b6-sw-shell-precache) [evidence-apps-web-public-sw-js](#evidence-evidence-apps-web-public-sw-js)

<a id="claim-leaf-durable-work-and-maintenance-1"></a>
- [Four dedicated queues carry Daily, privacy, Pattern, and ontology\-pipeline messages that hold only job coordinates and type tags, while commands stay in D1\. The Daily consumer claims its job first, acknowledges a zero\-row claim as a duplicate delivery, and fails the job at its attempt budget; Pattern execution cancels work that fails consent, staleness, ontology, or creation\-source checks\.](patternlike-source-mindmap.md#claim-leaf-durable-work-and-maintenance-1) — [evidence-b6-queue-bindings](#evidence-evidence-b6-queue-bindings) [evidence-b6-queue-message-shapes](#evidence-evidence-b6-queue-message-shapes) [evidence-b6-daily-claim-duplicate](#evidence-evidence-b6-daily-claim-duplicate) [evidence-b6-daily-attempt-budget](#evidence-evidence-b6-daily-attempt-budget) [evidence-b6-pattern-cancellation-checks](#evidence-evidence-b6-pattern-cancellation-checks) [evidence-b6-pattern-cancel-transition](#evidence-evidence-b6-pattern-cancel-transition)

<a id="claim-leaf-durable-work-and-maintenance-2"></a>
- [Committed production declares two crons\. The 15\-minute lane runs Codex provider maintenance, the Daily scheduler, privacy maintenance, the Pattern sweep, portrait and mesh maintenance, and runtime\-health audit expiry; the 7,22,37,52 lane runs Codex provider maintenance and ontology lease, dispatch, and outbox recovery plus expired\-artifact cleanup\. Outbox dispatch does nothing while ONTOLOGY\_PIPELINE\_ROLLOUT is off, as committed\.](patternlike-source-mindmap.md#claim-leaf-durable-work-and-maintenance-2) — [evidence-b6-production-crons](#evidence-evidence-b6-production-crons) [evidence-b6-cron-lane-split](#evidence-evidence-b6-cron-lane-split) [evidence-b6-incumbent-maintenance](#evidence-evidence-b6-incumbent-maintenance) [evidence-b6-ontology-maintenance](#evidence-evidence-b6-ontology-maintenance) [evidence-b6-ontology-outbox-rollout-gate](#evidence-evidence-b6-ontology-outbox-rollout-gate) [evidence-apps-api-wrangler-toml](#evidence-evidence-apps-api-wrangler-toml)

<a id="claim-leaf-codex-runner-and-host-dependency-1"></a>
- [apps/codex\-runner exits at startup unless codex login status reports a ChatGPT login, then claims text jobs from the Worker's /codex\-provider routes with its bearer token\. The Worker parses every completion document before accepting it\.](patternlike-source-mindmap.md#claim-leaf-codex-runner-and-host-dependency-1) — [evidence-b6-runner-startup-auth](#evidence-evidence-b6-runner-startup-auth) [evidence-b6-runner-chatgpt-login](#evidence-evidence-b6-runner-chatgpt-login) [evidence-b6-runner-bearer](#evidence-evidence-b6-runner-bearer) [evidence-b6-runner-text-claim](#evidence-evidence-b6-runner-text-claim) [evidence-b6-provider-completion-parse](#evidence-evidence-b6-provider-completion-parse)

<a id="claim-leaf-codex-runner-and-host-dependency-2"></a>
- [Text jobs, portrait images, and portrait meshes have separate Worker routes and runner lanes\. The image and mesh lanes exist only when CODEX\_RUNNER\_PORTRAITS or CODEX\_RUNNER\_MESHES is 1, and both artwork clients request the v2 portrait protocol \(see Portrait and 3D observatory\)\.](patternlike-source-mindmap.md#claim-leaf-codex-runner-and-host-dependency-2) — [evidence-b6-provider-routes](#evidence-evidence-b6-provider-routes) [evidence-b6-runner-lanes](#evidence-evidence-b6-runner-lanes) [evidence-b6-runner-lane-flags](#evidence-evidence-b6-runner-lane-flags) [evidence-b6-runner-v2-portrait-protocol](#evidence-evidence-b6-runner-v2-portrait-protocol) [evidence-b6-runner-v2-mesh-protocol](#evidence-evidence-b6-runner-v2-mesh-protocol)

<a id="claim-leaf-codex-runner-and-host-dependency-3"></a>
- [One process runs one job at a time, rotating claim opportunities through six weighted slots under policy weighted\-work\-classes/v1: four text, one portrait, one mesh\. The cursor advances on every opportunity, so an empty or disabled class yields its slot, and a failed poll cools only that class\. With work waiting in every class, each six\-job cycle runs four text, one portrait, and one mesh job\.](patternlike-source-mindmap.md#claim-leaf-codex-runner-and-host-dependency-3) — [evidence-b6-runner-single-concurrency](#evidence-evidence-b6-runner-single-concurrency) [evidence-b6-runner-work-slots](#evidence-evidence-b6-runner-work-slots) [evidence-b6-runner-cursor](#evidence-evidence-b6-runner-cursor) [evidence-b6-runner-slot-skip](#evidence-evidence-b6-runner-slot-skip) [evidence-b6-runner-cooldown](#evidence-evidence-b6-runner-cooldown)

<a id="claim-leaf-codex-runner-and-host-dependency-4"></a>
- [Text and mesh JSON turns share runIsolatedCodexJson, which starts a fresh ephemeral, read\-only Codex thread with approvals off for each turn\. Its version check accepts any released codex\-cli X\.Y\.Z that reports a ChatGPT login, leaving compatibility to effective\-configuration and protocol checks that fail closed\.](patternlike-source-mindmap.md#claim-leaf-codex-runner-and-host-dependency-4) — [evidence-b6-text-json-turn-fail-closed](#evidence-evidence-b6-text-json-turn-fail-closed) [evidence-b6-mesh-json-turn](#evidence-evidence-b6-mesh-json-turn) [evidence-b6-json-turn-isolation](#evidence-evidence-b6-json-turn-isolation) [evidence-b6-json-turn-cli-version](#evidence-evidence-b6-json-turn-cli-version) [evidence-b6-json-turn-config-check](#evidence-evidence-b6-json-turn-config-check)

<a id="claim-leaf-codex-runner-and-host-dependency-5"></a>
- [Portrait image turns still require exactly codex\-cli 0\.153\.3\. This is repository code; no installed runner, CLI version, or host liveness is claimed\.](patternlike-source-mindmap.md#claim-leaf-codex-runner-and-host-dependency-5) — [evidence-b6-portrait-cli-pin](#evidence-evidence-b6-portrait-cli-pin) [evidence-b6-portrait-cli-check](#evidence-evidence-b6-portrait-cli-check)

<a id="claim-leaf-operator-generation-and-repair-1"></a>
- [POST /internal/readings/reissue requires user\_id, the expected live reading id, which must still be published, and a revision reason from chart\_recalculated, consent\_revoked, safety\_correction, or defect\_repair\. It freezes a deterministic V1 successor command, which cannot be built without an active editorial content release\.](patternlike-source-mindmap.md#claim-leaf-operator-generation-and-repair-1) — [evidence-b6-reissue-reasons](#evidence-evidence-b6-reissue-reasons) [evidence-b6-reissue-validation](#evidence-evidence-b6-reissue-validation) [evidence-b6-reissue-live-predecessor](#evidence-evidence-b6-reissue-live-predecessor) [evidence-b6-reissue-v1-builder](#evidence-evidence-b6-reissue-v1-builder) [evidence-b6-v1-release-required](#evidence-evidence-b6-v1-release-required)

<a id="claim-leaf-operator-generation-and-repair-2"></a>
- [POST /internal/readings/invalidate accepts only the reason calculation\_defect\. Its successor is a V2 command with revision reason defect\_repair \(a chart\_correction invalidation yields chart\_recalculated instead\), reserved by the route or later by the scheduler's orphan\-repair lane\.](patternlike-source-mindmap.md#claim-leaf-operator-generation-and-repair-2) — [evidence-b6-invalidate-calculation-defect](#evidence-evidence-b6-invalidate-calculation-defect) [evidence-b6-invalidation-revision-reason](#evidence-evidence-b6-invalidation-revision-reason) [evidence-b6-fact-repair-v2-builder](#evidence-evidence-b6-fact-repair-v2-builder) [evidence-b6-route-fact-repair](#evidence-evidence-b6-route-fact-repair) [evidence-apps-api-services-run-reading-scheduler-ts-2](#evidence-evidence-apps-api-services-run-reading-scheduler-ts-2)

<a id="claim-leaf-operator-generation-and-repair-3"></a>
- [The revision reason states why a revision exists, not who started it; V2 commands record initiation separately as a reservation reason, such as scheduled, automatic\_replacement, manual\_reissue, or fact\_repair\. A replacement for a failed command keeps the revision's reason, and POST /internal/readings/replace takes its actor, operator or scheduler, from the caller\.](patternlike-source-mindmap.md#claim-leaf-operator-generation-and-repair-3) — [evidence-b6-reason-vocabularies](#evidence-evidence-b6-reason-vocabularies) [evidence-b6-v1-replacement-keeps-reason](#evidence-evidence-b6-v1-replacement-keeps-reason) [evidence-apps-api-services-enqueue-ts](#evidence-evidence-apps-api-services-enqueue-ts) [evidence-b6-reservation-reason-mapping](#evidence-evidence-b6-reservation-reason-mapping) [evidence-b6-replace-actor](#evidence-evidence-b6-replace-actor)

<a id="claim-leaf-storage-and-isolated-signing-1"></a>
- [Production binds one D1 database as DB\. Its migrations define the relational state, including users, chart snapshots, daily readings, and jobs\.](patternlike-source-mindmap.md#claim-leaf-storage-and-isolated-signing-1) — [evidence-apps-api-wrangler-toml-4](#evidence-evidence-apps-api-wrangler-toml-4) [evidence-b6-d1-users](#evidence-evidence-b6-d1-users) [evidence-b6-d1-chart-snapshots](#evidence-evidence-b6-d1-chart-snapshots) [evidence-b6-d1-daily-readings](#evidence-evidence-b6-d1-daily-readings) [evidence-b6-d1-jobs](#evidence-evidence-b6-d1-jobs)

<a id="claim-leaf-storage-and-isolated-signing-3"></a>
- [Production binds the pattern\-artifacts R2 bucket as ARTIFACTS\. It stores signed release bundles, written with a conditional create, and sealed generation artifacts such as Codex exchange envelopes, which are AES\-256\-GCM encrypted and written create\-only\.](patternlike-source-mindmap.md#claim-leaf-storage-and-isolated-signing-3) — [evidence-production-artifacts](#evidence-evidence-production-artifacts) [evidence-b6-release-bundle-put](#evidence-evidence-b6-release-bundle-put) [evidence-b6-codex-artifact-seal-alg](#evidence-evidence-b6-codex-artifact-seal-alg) [evidence-b6-codex-artifact-create-only](#evidence-evidence-b6-codex-artifact-create-only)

<a id="claim-leaf-storage-and-isolated-signing-2"></a>
- [PATTERN\_REPLAY\_LEDGER is a separate R2 bucket for Ed25519\-signed Pattern erasure replay events, written create\-only\. Ontology signing goes through the ONTOLOGY\_SIGNER service binding to a separate Worker whose environment declares only its PATTERN\_ONTOLOGY\_SIGNING\_KEY secret\.](patternlike-source-mindmap.md#claim-leaf-storage-and-isolated-signing-2) — [evidence-apps-api-wrangler-toml-5](#evidence-evidence-apps-api-wrangler-toml-5) [evidence-b6-replay-ledger-create-only](#evidence-evidence-b6-replay-ledger-create-only) [evidence-b6-replay-ledger-signing-key](#evidence-evidence-b6-replay-ledger-signing-key) [evidence-b6-signer-service-binding](#evidence-evidence-b6-signer-service-binding) [evidence-b6-signer-env](#evidence-evidence-b6-signer-env)

<a id="claim-leaf-committed-production-switches-1"></a>
- [Committed production configuration sets READING\_V5\_ROLLOUT to hybrid, PATTERN\_GENERATION\_ENABLED to 1, PATTERN\_PORTRAIT\_ENABLED and PATTERN\_PORTRAIT\_MESH\_ENABLED to 1, and GEOCODER\_ROLLOUT to enabled, and keeps ONTOLOGY\_PIPELINE\_ROLLOUT off\.](patternlike-source-mindmap.md#claim-leaf-committed-production-switches-1) — [evidence-production-daily-rollout](#evidence-evidence-production-daily-rollout) [evidence-pattern-generation-switch](#evidence-evidence-pattern-generation-switch) [evidence-b6-production-portrait-flags](#evidence-evidence-b6-production-portrait-flags) [evidence-production-geocoder](#evidence-evidence-production-geocoder) [evidence-apps-api-wrangler-toml](#evidence-evidence-apps-api-wrangler-toml)

<a id="claim-leaf-committed-production-switches-4"></a>
- [PATTERN\_ADAPTIVE\_PORTRAITS\_ENABLED is committed as 0, so a new v2 artwork reservation returns 503 adaptive\_portrait\_unavailable, while v1 artwork for four\-chapter Patterns can still start\. CATEGORIZED\_FEEDBACK\_EFFECTS\_ENABLED is not set in committed configuration, and the Daily publisher resolves it to the non\-categorical prompt 1\.0\.3\.](patternlike-source-mindmap.md#claim-leaf-committed-production-switches-4) — [evidence-b6-production-portrait-flags](#evidence-evidence-b6-production-portrait-flags) [evidence-b5-adaptive-admission-503](#evidence-evidence-b5-adaptive-admission-503) [evidence-b6-v1-four-chapters](#evidence-evidence-b6-v1-four-chapters) [evidence-b3-feedback-flag-read](#evidence-evidence-b3-feedback-flag-read) [evidence-b6-feedback-default-off](#evidence-evidence-b6-feedback-default-off)

<a id="claim-leaf-committed-production-switches-2"></a>
- [New constrained\-model Daily readings and Pattern passes pin Codex with gpt\-5\.6\-sol at xhigh reasoning, and configuration naming another Daily or Pattern publisher is refused\. OpenAI Responses adapters remain in source; the parked ontology pipeline can still select one \(see Pattern generation and ontology\)\. Pattern writer prompt 1\.0\.5 adds claim\-grounding and cumulative\-correction guidance; the request builder retains the older instructions for writer pins 1\.0\.1 through 1\.0\.3 and the offline writer pin\.](patternlike-source-mindmap.md#claim-leaf-committed-production-switches-2) — [evidence-b6-daily-publisher-refusal](#evidence-evidence-b6-daily-publisher-refusal) [evidence-b6-daily-model-pins-code](#evidence-evidence-b6-daily-model-pins-code) [evidence-b6-pattern-publisher-refusal](#evidence-evidence-b6-pattern-publisher-refusal) [evidence-b6-pattern-model-pins-code](#evidence-evidence-b6-pattern-model-pins-code) [evidence-b6-ontology-openai-branch](#evidence-evidence-b6-ontology-openai-branch) [evidence-b6-pattern-writer-grounding-policy](#evidence-evidence-b6-pattern-writer-grounding-policy) [evidence-b6-pattern-writer-historical-policies](#evidence-evidence-b6-pattern-writer-historical-policies)

<a id="claim-leaf-committed-production-switches-5"></a>
- [POST /internal/readings/generate and /internal/readings/reissue build V1 commands, which run on the deterministic executor, pin no model, and pass no READING\_V5\_ROLLOUT gate; that gate applies only to constrained\-model reservations\.](patternlike-source-mindmap.md#claim-leaf-committed-production-switches-5) — [evidence-b6-generate-route-v1](#evidence-evidence-b6-generate-route-v1) [evidence-b6-generate-v1-builder](#evidence-evidence-b6-generate-v1-builder) [evidence-b6-reissue-v1-builder](#evidence-evidence-b6-reissue-v1-builder) [evidence-b6-daily-executor-by-version](#evidence-evidence-b6-daily-executor-by-version) [evidence-b6-constrained-rollout-gate](#evidence-evidence-b6-constrained-rollout-gate)

<a id="claim-leaf-committed-production-switches-3"></a>
- [These are committed settings only\. The committed production RELEASE\_GIT\_SHA is an all\-zero placeholder that configuration checks refuse outside development, secrets are set outside the file, and nothing here establishes runner health, an active ontology, applied migrations, granted consent, or which release production serves\.](patternlike-source-mindmap.md#claim-leaf-committed-production-switches-3) — [evidence-apps-api-wrangler-toml-6](#evidence-evidence-apps-api-wrangler-toml-6) [evidence-b6-production-release-placeholder](#evidence-evidence-b6-production-release-placeholder) [evidence-b6-release-placeholder-refused](#evidence-evidence-b6-release-placeholder-refused) [evidence-b6-secrets-outside-config](#evidence-evidence-b6-secrets-outside-config)

<a id="claim-leaf-shared-codex-exchange-mechanics-1"></a>
- [Daily, Pattern, and ontology\-pipeline text work share one Codex exchange: the request is sealed as an AES\-256\-GCM artifact written create\-only to R2, and an INSERT OR IGNORE codex\_provider\_jobs row takes an id derived from pipeline, owner, pass, stage generation, attempt, and request hash, so a duplicate delivery adopts the existing job\.](patternlike-source-mindmap.md#claim-leaf-shared-codex-exchange-mechanics-1) — [evidence-b6-codex-pipelines](#evidence-evidence-b6-codex-pipelines) [evidence-b6-codex-job-id-derivation](#evidence-evidence-b6-codex-job-id-derivation) [evidence-b6-codex-job-insert-or-ignore](#evidence-evidence-b6-codex-job-insert-or-ignore) [evidence-b6-codex-artifact-seal-alg](#evidence-evidence-b6-codex-artifact-seal-alg) [evidence-b6-codex-artifact-create-only](#evidence-evidence-b6-codex-artifact-create-only)

<a id="claim-leaf-shared-codex-exchange-mechanics-3"></a>
- [A runner claim takes a 20\-minute lease, can reclaim an expired lease, and skips Pattern work while Pattern generation is paused\. The Worker reads each completion within a byte bound, seals the output as a response artifact, and cancels the job instead of accepting it when its owner is no longer current\.](patternlike-source-mindmap.md#claim-leaf-shared-codex-exchange-mechanics-3) — [evidence-b6-codex-claim-filter](#evidence-evidence-b6-codex-claim-filter) [evidence-b6-codex-lease](#evidence-evidence-b6-codex-lease) [evidence-b6-completion-bound](#evidence-evidence-b6-completion-bound) [evidence-b6-completion-response-artifact](#evidence-evidence-b6-completion-response-artifact) [evidence-b6-completion-owner-recheck](#evidence-evidence-b6-completion-owner-recheck)

<a id="claim-leaf-shared-codex-exchange-mechanics-2"></a>
- [Shared exchange mechanics do not merge domain ownership: the Daily executor validates and publishes its own candidate, while the Pattern executor runs its own passes, from planner to verifier, and builds its publication proof\.](patternlike-source-mindmap.md#claim-leaf-shared-codex-exchange-mechanics-2) — [evidence-b6-daily-validate](#evidence-evidence-b6-daily-validate) [evidence-apps-api-services-generate-daily-reading-v5-ts-2](#evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-2) [evidence-b6-pattern-planner-pass](#evidence-evidence-b6-pattern-planner-pass) [evidence-b6-pattern-verifier-pass](#evidence-evidence-b6-pattern-verifier-pass) [evidence-b4-execute-publication-proof](#evidence-evidence-b4-execute-publication-proof)

<a id="claim-leaf-observability-and-release-identity-1"></a>
- [Committed production observability has top\-level enabled = false, nested logs enabled = true, and nested traces enabled = false; these are source settings rather than evidence of collected production telemetry\.](patternlike-source-mindmap.md#claim-leaf-observability-and-release-identity-1) — [evidence-apps-api-wrangler-toml-7](#evidence-evidence-apps-api-wrangler-toml-7) [evidence-apps-api-wrangler-toml-8](#evidence-evidence-apps-api-wrangler-toml-8) [evidence-apps-api-wrangler-toml-9](#evidence-evidence-apps-api-wrangler-toml-9)

<a id="claim-leaf-observability-and-release-identity-2"></a>
- [/health returns a fixed ok document naming the service, schema version, and environment, and checks no dependency\. /v1/meta reports the configured release Git SHA and the Cloudflare Worker version id, each null when malformed or absent\. Neither proves provider execution or an installed runner\.](patternlike-source-mindmap.md#claim-leaf-observability-and-release-identity-2) — [evidence-b6-health-fixed-ok](#evidence-evidence-b6-health-fixed-ok) [evidence-b6-meta-release-identity](#evidence-evidence-b6-meta-release-identity) [evidence-b6-release-identity-readers](#evidence-evidence-b6-release-identity-readers)

<a id="claim-leaf-observability-and-release-identity-3"></a>
- [The runner's main process logs to stdout only through a closed serializer that emits at most a timestamp, an event name, the scheduling policy, and a work class, and replaces any other shape with codex\_runner\_log\_rejected\.](patternlike-source-mindmap.md#claim-leaf-observability-and-release-identity-3) — [evidence-b6-runner-log-sink](#evidence-evidence-b6-runner-log-sink) [evidence-b6-runner-log-fields](#evidence-evidence-b6-runner-log-fields) [evidence-b6-runner-log-rejected](#evidence-evidence-b6-runner-log-rejected)

<a id="claim-leaf-runtime-health-1"></a>
- [GET /admin/runtime\-health sits in the Cloudflare Access admin router \(see Identity and privacy\) and requires exactly one purpose, incident\_response\. It reports content\-free counts, pending ages, and lease state for text, portrait, and mesh work from the Codex provider, portrait, and mesh job tables, plus a count of Pattern publication\-safety failures\.](patternlike-source-mindmap.md#claim-leaf-runtime-health-1) — [evidence-b6-runtime-health-route-purpose](#evidence-evidence-b6-runtime-health-route-purpose) [evidence-b6-runtime-health-admin-mount](#evidence-evidence-b6-runtime-health-admin-mount) [evidence-b6-runtime-health-work-tables](#evidence-evidence-b6-runtime-health-work-tables) [evidence-b6-runtime-health-publication-failures](#evidence-evidence-b6-runtime-health-publication-failures)

<a id="claim-leaf-runtime-health-2"></a>
- [A work class with more than 10,000 matching rows reports sample\_limit\_exceeded instead of partial counts\. Completion latency is reported as p50 and p95 over work completed in the day before sampling\.](patternlike-source-mindmap.md#claim-leaf-runtime-health-2) — [evidence-b6-runtime-health-sample-limit](#evidence-evidence-b6-runtime-health-sample-limit) [evidence-b6-runtime-health-limit-check](#evidence-evidence-b6-runtime-health-limit-check) [evidence-b6-runtime-health-day](#evidence-evidence-b6-runtime-health-day) [evidence-b6-runtime-health-window](#evidence-evidence-b6-runtime-health-window) [evidence-b6-runtime-health-latency](#evidence-evidence-b6-runtime-health-latency)

<a id="claim-leaf-runtime-health-3"></a>
- [Migration 0032 adds completed\_at to portrait and mesh jobs without a backfill, so completions from before it count as missing timestamps and keep that class's latency coverage partial\.](patternlike-source-mindmap.md#claim-leaf-runtime-health-3) — [evidence-b6-runtime-health-completed-at](#evidence-evidence-b6-runtime-health-completed-at) [evidence-b6-runtime-health-latency](#evidence-evidence-b6-runtime-health-latency)

<a id="claim-leaf-runtime-health-4"></a>
- [Each read, including one refused for its purpose, is audited as granted, denied, or unavailable in runtime\_health\_access\_events with a 13\-month expiry, and a failed audit write returns 503 without data; scheduled maintenance deletes expired rows\. runner\_enabled is always null, so the endpoint cannot show whether a runner is installed or healthy\.](patternlike-source-mindmap.md#claim-leaf-runtime-health-4) — [evidence-b6-runtime-health-audit-route](#evidence-evidence-b6-runtime-health-audit-route) [evidence-b6-runtime-health-audit-failure](#evidence-evidence-b6-runtime-health-audit-failure) [evidence-b6-runtime-health-audit-expiry](#evidence-evidence-b6-runtime-health-audit-expiry) [evidence-b6-runtime-health-audit-purge](#evidence-evidence-b6-runtime-health-audit-purge) [evidence-b6-runtime-health-runner-null](#evidence-evidence-b6-runtime-health-runner-null)

<a id="claim-leaf-route-authority-zones-1"></a>
- [/health and /v1/meta mount first, outside configGuard; a comment on /v1/meta records that exclusion as deliberate, so release verification can still query a deployment whose RELEASE\_GIT\_SHA fails the guard\. Session exchange attaches configGuard to its own paths, and POST /v1/sessions verifies the OIDC ID token it receives before minting a session\.](patternlike-source-mindmap.md#claim-leaf-route-authority-zones-1) — [evidence-apps-api-index-ts-6](#evidence-evidence-apps-api-index-ts-6) [evidence-b7-meta-outside-config-guard](#evidence-evidence-b7-meta-outside-config-guard) [evidence-apps-api-index-ts-7](#evidence-evidence-apps-api-index-ts-7) [evidence-b7-session-id-token-verify](#evidence-evidence-b7-session-id-token-verify)

<a id="claim-leaf-route-authority-zones-2"></a>
- [Deletion status has its own configGuard registration and no session check\. GET /v1/account/deletion\-status answers only for the deletion\-receipt cookie, looked up by hash while unexpired, so it keeps working after accepting deletion revokes the account's sessions\.](patternlike-source-mindmap.md#claim-leaf-route-authority-zones-2) — [evidence-apps-api-index-ts-8](#evidence-evidence-apps-api-index-ts-8) [evidence-apps-api-routes-privacy-ts-2](#evidence-evidence-apps-api-routes-privacy-ts-2) [evidence-b7-deletion-receipt-lookup](#evidence-evidence-b7-deletion-receipt-lookup) [evidence-b7-deletion-reservation-revocations](#evidence-evidence-b7-deletion-reservation-revocations)

<a id="claim-leaf-route-authority-zones-3"></a>
- [The product API runs configGuard, authenticate, and accountStateGate ahead of every route it mounts, including categorical feedback and passage connections\. Before configGuard, a Cache\-Control\-only middleware sets private, no\-store on /v1/readings/:id/feedback\-options, feedback\-events, relationship\-source, relationships, and relationship\-target and on /v1/timing/cycles/:id, not on the resonance /v1/readings/:id/feedback\.](patternlike-source-mindmap.md#claim-leaf-route-authority-zones-3) — [evidence-apps-api-index-ts-2](#evidence-evidence-apps-api-index-ts-2) [evidence-b7-api-authenticate-gate](#evidence-evidence-b7-api-authenticate-gate) [evidence-b7-api-feedback-connection-mounts](#evidence-evidence-b7-api-feedback-connection-mounts) [evidence-b7-api-private-no-store-paths](#evidence-evidence-b7-api-private-no-store-paths)

<a id="claim-leaf-route-authority-zones-4"></a>
- [The internal service, Cloudflare Access admin, Codex runner, and crypto\-operator sub\-apps each run configGuard and then their own credential check, and the product API mounts after all of them\. /admin, which also serves runtime health, sets no\-store before configGuard, and configGuard refuses a runner token equal to the service token or a crypto\-operator token equal to either\.](patternlike-source-mindmap.md#claim-leaf-route-authority-zones-4) — [evidence-apps-api-index-ts-9](#evidence-evidence-apps-api-index-ts-9) [evidence-apps-api-index-ts-3](#evidence-evidence-apps-api-index-ts-3) [evidence-apps-api-index-ts-10](#evidence-evidence-apps-api-index-ts-10) [evidence-apps-api-index-ts-4](#evidence-evidence-apps-api-index-ts-4) [evidence-apps-api-index-ts-5](#evidence-evidence-apps-api-index-ts-5) [evidence-b7-admin-no-store-before-guard](#evidence-evidence-b7-admin-no-store-before-guard) [evidence-b7-admin-route-order](#evidence-evidence-b7-admin-route-order) [evidence-b7-authority-token-aliasing](#evidence-evidence-b7-authority-token-aliasing)

<a id="claim-leaf-administrator-inspection-and-audit-1"></a>
- [The /admin router relies on Cloudflare Access rather than a shared bearer\. adminAuth verifies the cf\-access\-jwt\-assertion with the configured team domain as issuer and the policy audience, binds the verified subject to a pattern\_admin\_sessions row stored by token hash, whose cookie lasts at most 15 minutes, and sets no\-store, a deny\-all Content\-Security\-Policy, and frame denial\.](patternlike-source-mindmap.md#claim-leaf-administrator-inspection-and-audit-1) — [evidence-b7-admin-access-assertion](#evidence-evidence-b7-admin-access-assertion) [evidence-b7-admin-access-iss-aud](#evidence-evidence-b7-admin-access-iss-aud) [evidence-b7-admin-session-ttl](#evidence-evidence-b7-admin-session-ttl) [evidence-b7-admin-session-insert](#evidence-evidence-b7-admin-session-insert) [evidence-b7-admin-response-headers](#evidence-evidence-b7-admin-response-headers)

<a id="claim-leaf-administrator-inspection-and-audit-2"></a>
- [Pattern generation inspections, diagnostics and candidate revalidation included, need exactly one of four purposes \(quality\_review, safety\_investigation, incident\_response, retention\_audit\)\. A request passing that check and, for diagnostics and revalidation, the generation\-id format check writes a pattern\_admin\_access\_events row naming admin subject, target account, scope hash, and generation; a failed check gets 400 and no row\.](patternlike-source-mindmap.md#claim-leaf-administrator-inspection-and-audit-2) — [evidence-b7-admin-purposes](#evidence-evidence-b7-admin-purposes) [evidence-apps-api-routes-admin-pattern-ts](#evidence-evidence-apps-api-routes-admin-pattern-ts) [evidence-b7-admin-diagnostics-id-check](#evidence-evidence-b7-admin-diagnostics-id-check) [evidence-apps-api-routes-admin-pattern-ts-2](#evidence-evidence-apps-api-routes-admin-pattern-ts-2) [evidence-b7-admin-diagnostics-audit](#evidence-evidence-b7-admin-diagnostics-audit)

<a id="claim-leaf-administrator-inspection-and-audit-3"></a>
- [Artifact content reads and candidate revalidation write that row before opening any key, and revalidation answers 503 when the write fails\. The ontology\-release lookup also needs a purpose but writes no row, and account deletion clears target\_user\_id on existing rows\.](patternlike-source-mindmap.md#claim-leaf-administrator-inspection-and-audit-3) — [evidence-b7-admin-artifact-audit-first](#evidence-evidence-b7-admin-artifact-audit-first) [evidence-b4-revalidation-audit-unavailable](#evidence-evidence-b4-revalidation-audit-unavailable) [evidence-b7-ontology-release-lookup](#evidence-evidence-b7-ontology-release-lookup) [evidence-b7-deletion-clears-admin-target](#evidence-evidence-b7-deletion-clears-admin-target)

<a id="claim-leaf-administrator-inspection-and-audit-4"></a>
- [GET /admin/runtime\-health mounts ahead of the Pattern routes and applies its own purpose check, accepting only incident\_response\. It audits reads, including purpose denials, to runtime\_health\_access\_events, which has no target account \(details under Runtime and generation services\)\.](patternlike-source-mindmap.md#claim-leaf-administrator-inspection-and-audit-4) — [evidence-b7-admin-route-order](#evidence-evidence-b7-admin-route-order) [evidence-b7-runtime-health-incident-only](#evidence-evidence-b7-runtime-health-incident-only) [evidence-b7-runtime-health-denial-audit](#evidence-evidence-b7-runtime-health-denial-audit) [evidence-b7-runtime-health-audit-row](#evidence-evidence-b7-runtime-health-audit-row)

<a id="claim-leaf-sessions-and-account-state-1"></a>
- [POST /v1/sessions checks an OIDC ID token's signature and iss, aud, exp, and nbf, links the identity, and mints a session stored only as a SHA\-256 hash with a 30\-day absolute lifetime\. Browsers get a Secure, HttpOnly, SameSite Strict cookie on /v1; native clients may send the returned token as a bearer\. Committed production configuration names an Auth0 issuer\.](patternlike-source-mindmap.md#claim-leaf-sessions-and-account-state-1) — [evidence-b7-oidc-claim-checks](#evidence-evidence-b7-oidc-claim-checks) [evidence-b7-session-link-and-create](#evidence-evidence-b7-session-link-and-create) [evidence-b7-session-hash-only](#evidence-evidence-b7-session-hash-only) [evidence-b7-session-ttl](#evidence-evidence-b7-session-ttl) [evidence-apps-api-routes-sessions-ts](#evidence-evidence-apps-api-routes-sessions-ts) [evidence-b7-bearer-fallback](#evidence-evidence-b7-bearer-fallback) [evidence-b7-committed-auth0-issuer](#evidence-evidence-b7-committed-auth0-issuer)

<a id="claim-leaf-sessions-and-account-state-2"></a>
- [accountStateGate guards the product API only\. There, an active account outside the recovery routes also needs a live account\-processing grant, a frozen account reaches only DELETE /v1/account, the export routes, and the account\-processing, Daily AI synthesis, and Pattern generation consent routes, and other states get 403\. Withdrawing account processing freezes the account; a later grant lifts that freeze\.](patternlike-source-mindmap.md#claim-leaf-sessions-and-account-state-2) — [evidence-b7-api-authenticate-gate](#evidence-evidence-b7-api-authenticate-gate) [evidence-b7-recovery-routes](#evidence-evidence-b7-recovery-routes) [evidence-b7-account-state-lifecycle](#evidence-evidence-b7-account-state-lifecycle) [evidence-b7-account-processing-required](#evidence-evidence-b7-account-processing-required) [evidence-b7-withdrawal-freezes](#evidence-evidence-b7-withdrawal-freezes) [evidence-b7-regrant-reactivates](#evidence-evidence-b7-regrant-reactivates)

<a id="claim-leaf-sessions-and-account-state-3"></a>
- [DELETE /v1/sessions/current revokes the presented session and clears the cookie, and product routes give unknown, revoked, and expired tokens the same 401\. AUTH\_STUB=1 lets development name a user with X\-User\-Id; configGuard refuses it outside development, and committed production sets AUTH\_STUB to 0\.](patternlike-source-mindmap.md#claim-leaf-sessions-and-account-state-3) — [evidence-b7-logout-revokes](#evidence-evidence-b7-logout-revokes) [evidence-b7-uniform-unauthorized](#evidence-evidence-b7-uniform-unauthorized) [evidence-b7-auth-stub-header](#evidence-evidence-b7-auth-stub-header) [evidence-b7-auth-stub-refused](#evidence-evidence-b7-auth-stub-refused) [evidence-b7-committed-auth-stub-off](#evidence-evidence-b7-committed-auth-stub-off)

<a id="claim-leaf-explicit-processing-permissions-1"></a>
- [Calculation \(account processing\), Daily AI synthesis, Pattern generation, and place search \(geocoder\) are separate consents, and each grant must name that consent's current policy version or is refused as consent\_policy\_version\_stale\. Per\-chart portrait automation is a separate grant accepting policies 1\.1\.0 and 2\.0\.0 \(details under Portrait and 3D observatory\)\.](patternlike-source-mindmap.md#claim-leaf-explicit-processing-permissions-1) — [evidence-b7-account-processing-version-check](#evidence-evidence-b7-account-processing-version-check) [evidence-b7-ai-synthesis-version-check](#evidence-evidence-b7-ai-synthesis-version-check) [evidence-b7-geocoder-version-check](#evidence-evidence-b7-geocoder-version-check) [evidence-b7-pattern-consent-version-check](#evidence-evidence-b7-pattern-consent-version-check) [evidence-b7-portrait-automation-policies](#evidence-evidence-b7-portrait-automation-policies)

<a id="claim-leaf-explicit-processing-permissions-2"></a>
- [Privacy holds the Daily AI synthesis, calculation, geocoder, and Pattern generation consent panels, the portrait automation control, topic exclusions, check\-in and life\-event source controls, and export and deletion\. Withdrawal is rechecked downstream: Daily execution rereads AI consent after calculation, and Pattern execution and publication require the frozen consent to still be current\.](patternlike-source-mindmap.md#claim-leaf-explicit-processing-permissions-2) — [evidence-b7-privacy-consent-panels](#evidence-evidence-b7-privacy-consent-panels) [evidence-b7-privacy-portrait-control](#evidence-evidence-b7-privacy-portrait-control) [evidence-b7-privacy-source-controls](#evidence-evidence-b7-privacy-source-controls) [evidence-b7-privacy-account-data-controls](#evidence-evidence-b7-privacy-account-data-controls) [evidence-b7-daily-consent-reread](#evidence-evidence-b7-daily-consent-reread) [evidence-b4-execute-consent-gate](#evidence-evidence-b4-execute-consent-gate) [evidence-b7-pattern-publication-consent](#evidence-evidence-b7-pattern-publication-consent)

<a id="claim-leaf-explicit-processing-permissions-3"></a>
- [Context sources carry their own allowed uses\. PUT /v1/context\-sources changes only Daily check\-in \(USR\-06\) and the life\-event timeline \(USR\-09\); topic exclusions \(USR\-05\) and resonance feedback \(USR\-12\) gain their first\-party grant when saved\. Categorical feedback creates or reuses that USR\-12 product\_source grant instead of a new consent kind \(see Daily reading pipeline\)\.](patternlike-source-mindmap.md#claim-leaf-explicit-processing-permissions-3) — [evidence-b7-context-source-pair](#evidence-evidence-b7-context-source-pair) [evidence-b7-context-source-uses](#evidence-evidence-b7-context-source-uses) [evidence-b7-topic-exclusion-grant](#evidence-evidence-b7-topic-exclusion-grant) [evidence-b7-feedback-first-party-grant](#evidence-evidence-b7-feedback-first-party-grant) [evidence-b3-feedback-grant-insert](#evidence-evidence-b3-feedback-grant-insert)

<a id="claim-leaf-protected-personal-payloads-1"></a>
- [Each user's random 32\-byte data key is minted at identity link and wrapped with AES\-GCM under a root key derived by HKDF\-SHA256, bound to the crypto subject and key version\. Payloads use AES\-GCM with additional data binding subject, field, record, and key version\. Pattern content keys are wrapped under the owner's data key, and artifact additional data binds generation, artifact, and class\.](patternlike-source-mindmap.md#claim-leaf-protected-personal-payloads-1) — [evidence-b7-dek-minted-at-link](#evidence-evidence-b7-dek-minted-at-link) [evidence-b7-dek-32-bytes](#evidence-evidence-b7-dek-32-bytes) [evidence-b7-root-key-hkdf](#evidence-evidence-b7-root-key-hkdf) [evidence-b7-dek-wrap-aad](#evidence-evidence-b7-dek-wrap-aad) [evidence-b7-payload-aad](#evidence-evidence-b7-payload-aad) [evidence-b7-content-key-wrap](#evidence-evidence-b7-content-key-wrap) [evidence-b7-artifact-aad](#evidence-evidence-b7-artifact-aad)

<a id="claim-leaf-protected-personal-payloads-2"></a>
- [Owner scoping is a query predicate, as in the owned export lookup, and reading routes project wire fields by name instead of spreading decrypted artifacts\. The history, single\-reading, and save handlers set private, no\-store themselves, so refusals before them carry none; Today, evidence, and resonance feedback reads set no Cache\-Control\.](patternlike-source-mindmap.md#claim-leaf-protected-personal-payloads-2) — [evidence-b7-owned-export-query](#evidence-evidence-b7-owned-export-query) [evidence-b7-reading-projection-contract](#evidence-evidence-b7-reading-projection-contract) [evidence-b7-history-private-no-store](#evidence-evidence-b7-history-private-no-store) [evidence-b7-reading-private-no-store](#evidence-evidence-b7-reading-private-no-store) [evidence-b7-save-private-no-store](#evidence-evidence-b7-save-private-no-store) [evidence-b7-today-route](#evidence-evidence-b7-today-route) [evidence-b3-reading-evidence-route](#evidence-evidence-b3-reading-evidence-route) [evidence-b7-resonance-feedback-route](#evidence-evidence-b7-resonance-feedback-route)

<a id="claim-leaf-protected-personal-payloads-3"></a>
- [The Worker's own console output goes only through safeLog, which emits named fields and closed error classes, never messages or stacks\. The main maintenance cron still throws its first lane failure, the raw error except from the runtime\-health audit lane, which substitutes a fixed error; the queue handler adds no catch around privacy messages, so errors escaping the deletion or export processor propagate to the Workers runtime\.](patternlike-source-mindmap.md#claim-leaf-protected-personal-payloads-3) — [evidence-b7-safe-log-boundary](#evidence-evidence-b7-safe-log-boundary) [evidence-b7-safe-exception-class](#evidence-evidence-b7-safe-exception-class) [evidence-b7-scheduled-rethrow](#evidence-evidence-b7-scheduled-rethrow) [evidence-b7-privacy-queue-no-catch](#evidence-evidence-b7-privacy-queue-no-catch)

<a id="claim-leaf-export-deletion-and-key-maintenance-1"></a>
- [POST /v1/exports requires an Idempotency\-Key and queues an export\_account privacy job\. The result is sealed under a random 32\-byte AES\-GCM key wrapped by the root key and stays downloadable for seven days; status and download reads are owner\-scoped, and download returns 410 once expired and serves a ready export as a no\-store attachment\.](patternlike-source-mindmap.md#claim-leaf-export-deletion-and-key-maintenance-1) — [evidence-apps-api-routes-privacy-ts](#evidence-evidence-apps-api-routes-privacy-ts) [evidence-b7-export-queue](#evidence-evidence-b7-export-queue) [evidence-b7-export-random-key](#evidence-evidence-b7-export-random-key) [evidence-b7-export-key-wrap](#evidence-evidence-b7-export-key-wrap) [evidence-b7-export-seven-days](#evidence-evidence-b7-export-seven-days) [evidence-b7-owned-export-query](#evidence-evidence-b7-owned-export-query) [evidence-b7-export-expired-410](#evidence-evidence-b7-export-expired-410) [evidence-b7-export-download-no-store](#evidence-evidence-b7-export-download-no-store)

<a id="claim-leaf-export-deletion-and-key-maintenance-3"></a>
- [DELETE /v1/account requires an Idempotency\-Key and confirm set to DELETE\. Acceptance marks the account pending\_deletion, revokes its sessions and source permissions, cancels queued jobs, and sets the receipt cookie; the privacy job then fences exports, deletes registered objects and user rows, erases the wrapped data key, and tombstones the user\.](patternlike-source-mindmap.md#claim-leaf-export-deletion-and-key-maintenance-3) — [evidence-b7-delete-idempotency-key](#evidence-evidence-b7-delete-idempotency-key) [evidence-b7-delete-confirm](#evidence-evidence-b7-delete-confirm) [evidence-b7-deletion-pending](#evidence-evidence-b7-deletion-pending) [evidence-b7-deletion-reservation-revocations](#evidence-evidence-b7-deletion-reservation-revocations) [evidence-b7-deletion-receipt-cookie](#evidence-evidence-b7-deletion-receipt-cookie) [evidence-b7-deletion-fence-exports](#evidence-evidence-b7-deletion-fence-exports) [evidence-b7-deletion-checkpoints](#evidence-evidence-b7-deletion-checkpoints) [evidence-b7-deletion-key-erasure](#evidence-evidence-b7-deletion-key-erasure) [evidence-b7-deletion-tombstone](#evidence-evidence-b7-deletion-tombstone)

<a id="claim-leaf-export-deletion-and-key-maintenance-2"></a>
- [The /crypto\-operator router, behind its own bearer token, starts and steps per\-user DEK rotations and root\-key rewrap campaigns; each start needs a typed confirmation and an idempotency key\. A rotation freezes the user and sets crypto\_write\_fence, and encrypted writes such as check\-ins and Pattern publication abort their batch unless no fence is set, the status is allowed, and the key version is live\.](patternlike-source-mindmap.md#claim-leaf-export-deletion-and-key-maintenance-2) — [evidence-apps-api-index-ts-4](#evidence-evidence-apps-api-index-ts-4) [evidence-b7-dek-rotation-confirm](#evidence-evidence-b7-dek-rotation-confirm) [evidence-b7-kek-rewrap-confirm](#evidence-evidence-b7-kek-rewrap-confirm) [evidence-b7-rotation-installs-fence](#evidence-evidence-b7-rotation-installs-fence) [evidence-b7-write-fence-predicate](#evidence-evidence-b7-write-fence-predicate) [evidence-b7-check-in-write-fence](#evidence-evidence-b7-check-in-write-fence) [evidence-b7-pattern-publication-write-fence](#evidence-evidence-b7-pattern-publication-write-fence)

<a id="claim-leaf-export-deletion-and-key-maintenance-4"></a>
- [Categorical feedback events are stored encrypted behind a crypto write fence, purged by privacy maintenance when their 24\-month retention ends, exported under account\-export\-feedback/v1 when readings are included, deleted with the account, and re\-encrypted by DEK rotation \(storage details under Daily reading pipeline\)\.](patternlike-source-mindmap.md#claim-leaf-export-deletion-and-key-maintenance-4) — [evidence-b7-feedback-write-fence](#evidence-evidence-b7-feedback-write-fence) [evidence-b7-feedback-retention-months](#evidence-evidence-b7-feedback-retention-months) [evidence-b7-feedback-retention-purge](#evidence-evidence-b7-feedback-retention-purge) [evidence-b7-feedback-export-schema](#evidence-evidence-b7-feedback-export-schema) [evidence-b7-feedback-export-new-jobs](#evidence-evidence-b7-feedback-export-new-jobs) [evidence-b7-feedback-export-included](#evidence-evidence-b7-feedback-export-included) [evidence-b7-deleted-user-tables-new](#evidence-evidence-b7-deleted-user-tables-new) [evidence-b7-rotation-feedback-events](#evidence-evidence-b7-rotation-feedback-events) [evidence-b7-rotation-walks-columns](#evidence-evidence-b7-rotation-walks-columns)

<a id="claim-leaf-export-deletion-and-key-maintenance-5"></a>
- [Passage\-connection support rows are classified non\-portable, and account export leaves them out while exporting the readings they describe; they are deleted with the account and re\-encrypted by DEK rotation \(connections under Reader experience\)\.](patternlike-source-mindmap.md#claim-leaf-export-deletion-and-key-maintenance-5) — [evidence-b7-relationship-supports-non-portable](#evidence-evidence-b7-relationship-supports-non-portable) [evidence-b7-export-omits-relationship-supports](#evidence-evidence-b7-export-omits-relationship-supports) [evidence-b7-deleted-user-tables-new](#evidence-evidence-b7-deleted-user-tables-new) [evidence-b7-rotation-relationship-supports](#evidence-evidence-b7-rotation-relationship-supports) [evidence-b7-rotation-walks-columns](#evidence-evidence-b7-rotation-walks-columns)

<a id="claim-leaf-schemas-and-ordered-migrations-1"></a>
- [contracts/ holds the frozen M0 baseline and later packages: M3 to M9, geocoder\-v2, portrait\-v1 and v2, portrait\-mesh\-v1 and v2, reader\-relationships\-v1, reading\-feedback\-v1, and runtime\-health\-v1, each with JSON Schemas and fixtures\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-1) — [evidence-b8-m0-status-frozen](#evidence-evidence-b8-m0-status-frozen) [evidence-b8-contract-registry](#evidence-evidence-b8-contract-registry) [evidence-b8-mesh-v1-shared-fixtures](#evidence-evidence-b8-mesh-v1-shared-fixtures)

<a id="claim-leaf-schemas-and-ordered-migrations-7"></a>
- [validate\_schemas\.py runs M0's own validator and validates every other package's fixtures except portrait\-mesh\-v1, whose fixtures shared tests read instead\. Full OpenAPI validation runs only when openapi\-spec\-validator and pyyaml are installed and otherwise prints a skip; the separate per\-package OpenAPI projection checks need only pyyaml, and the geocoder\-v2 check imports it unconditionally\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-7) — [evidence-b8-m0-own-validator](#evidence-evidence-b8-m0-own-validator) [evidence-b8-new-package-validation](#evidence-evidence-b8-new-package-validation) [evidence-b8-openapi-skip](#evidence-evidence-b8-openapi-skip) [evidence-b8-mesh-v1-shared-fixtures](#evidence-evidence-b8-mesh-v1-shared-fixtures) [evidence-b8-projection-yaml-guard](#evidence-evidence-b8-projection-yaml-guard) [evidence-b8-geocoder-yaml-import](#evidence-evidence-b8-geocoder-yaml-import)

<a id="claim-leaf-schemas-and-ordered-migrations-3"></a>
- [Each M\-series successor manifest, and geocoder\-v2's, pins its predecessors' manifest digests, and validate\_schemas\.py fails when a pinned digest differs or a frozen package has uncommitted changes\. The M3 manifest records a 2026\-09\-13 additive amendment, a v2 assembly\-identity preimage beside the unchanged v1, and successor manifests re\-pin the amended digest\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-3) — [evidence-b8-freeze-digest-check](#evidence-evidence-b8-freeze-digest-check) [evidence-b8-freeze-git-status](#evidence-evidence-b8-freeze-git-status) [evidence-b8-geocoder-v2-pin](#evidence-evidence-b8-geocoder-v2-pin) [evidence-b8-m3-v2-amendment](#evidence-evidence-b8-m3-v2-amendment) [evidence-b8-m4-repin](#evidence-evidence-b8-m4-repin)

<a id="claim-leaf-schemas-and-ordered-migrations-4"></a>
- [apps/api/scripts/generate\-worker\-validators\.ts compiles standalone Ajv validators from contract schemas, and from the API's ontology output schema objects, into apps/api/src/generated\. Its check mode, check:validators, fails on a stale committed file and runs in the API prebuild, pretest, and predeploy scripts\. Committed Worker configuration sets the disallow\_eval\_during\_startup compatibility flag\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-4) — [evidence-b8-validators-roots](#evidence-evidence-b8-validators-roots) [evidence-b8-validators-ontology-schemas](#evidence-evidence-b8-validators-ontology-schemas) [evidence-b8-validators-stale-check](#evidence-evidence-b8-validators-stale-check) [evidence-b8-api-check-validators-script](#evidence-evidence-b8-api-check-validators-script) [evidence-b8-api-prebuild-check](#evidence-evidence-b8-api-prebuild-check) [evidence-b8-api-pretest-check](#evidence-evidence-b8-api-pretest-check) [evidence-b8-api-predeploy-check](#evidence-evidence-b8-api-predeploy-check) [evidence-b8-disallow-eval-flag](#evidence-evidence-b8-disallow-eval-flag)

<a id="claim-leaf-schemas-and-ordered-migrations-2"></a>
- [db/d1 holds the ordered D1 migrations, 0001 through 0034, each listed with a description in MIGRATIONS\.json\. Both committed D1 bindings, top\-level and production, name that directory as migrations\_dir; db:local applies it through the top\-level binding with wrangler d1 migrations apply \-\-local, and contracts/smoke\_check\.py applies every file to SQLite in numeric order\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-2) — [evidence-b8-migration-0001-entry](#evidence-evidence-b8-migration-0001-entry) [evidence-b8-migration-0034-entry](#evidence-evidence-b8-migration-0034-entry) [evidence-b8-toplevel-migrations-dir](#evidence-evidence-b8-toplevel-migrations-dir) [evidence-b8-production-migrations-dir](#evidence-evidence-b8-production-migrations-dir) [evidence-b8-db-local-apply](#evidence-evidence-b8-db-local-apply) [evidence-b8-smoke-numeric-order](#evidence-evidence-b8-smoke-numeric-order)

<a id="claim-leaf-schemas-and-ordered-migrations-5"></a>
- [MIGRATIONS\.json also keeps dated operator notes: preparation notes, such as the one saying 0032 is not applied to production by its source change, and apply records, such as the 0033 note of 2026\-09\-11\. A same\-day correction says 0029 through 0032 carry no APPLIED note although a read\-only query showed them applied, and tells readers to confirm the live d1\_migrations table instead\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-5) — [evidence-b8-ledger-0032-prep-note](#evidence-evidence-b8-ledger-0032-prep-note) [evidence-b8-ledger-0033-apply-note](#evidence-evidence-b8-ledger-0033-apply-note) [evidence-b8-ledger-correction](#evidence-evidence-b8-ledger-correction)

<a id="claim-leaf-schemas-and-ordered-migrations-6"></a>
- [A dated review records migration 0034 applied to the production D1 database at 2026\-09\-13 22:29:39 to 22:29:40 UTC in 2 commands\. It records that apply, not current database state\.](patternlike-source-mindmap.md#claim-leaf-schemas-and-ordered-migrations-6) — [evidence-b8-0034-production-apply](#evidence-evidence-b8-0034-production-apply)

<a id="claim-leaf-signed-editorial-release-delivery-1"></a>
- [POST /internal/content\-releases runs behind service authentication and validates the request against the M3 or M4 release contract\. It rejects a bundle unless the recomputed bundle hash matches, the signature verifies against the configured release keys, and the content graph and every object hash check out\.](patternlike-source-mindmap.md#claim-leaf-signed-editorial-release-delivery-1) — [evidence-b8-content-release-route](#evidence-evidence-b8-content-release-route) [evidence-b8-internal-service-auth](#evidence-evidence-b8-internal-service-auth) [evidence-b8-internal-prefix](#evidence-evidence-b8-internal-prefix) [evidence-b8-content-release-generated-validators](#evidence-evidence-b8-content-release-generated-validators) [evidence-b8-bundle-hash-check](#evidence-evidence-b8-bundle-hash-check) [evidence-b8-signature-check](#evidence-evidence-b8-signature-check) [evidence-b8-content-graph-check](#evidence-evidence-b8-content-graph-check) [evidence-b8-object-hash-check](#evidence-evidence-b8-object-hash-check)

<a id="claim-leaf-signed-editorial-release-delivery-4"></a>
- [A verified bundle is stored in R2 in its canonical JSON form under a create\-only condition\. A release version already ingested with different bytes, or bytes already ingested under another version, is refused\.](patternlike-source-mindmap.md#claim-leaf-signed-editorial-release-delivery-4) — [evidence-b8-release-canonical-bytes](#evidence-evidence-b8-release-canonical-bytes) [evidence-b8-release-r2-create-only](#evidence-evidence-b8-release-r2-create-only) [evidence-b8-release-version-immutable](#evidence-evidence-b8-release-version-immutable) [evidence-b8-release-bytes-reused](#evidence-evidence-b8-release-bytes-reused)

<a id="claim-leaf-signed-editorial-release-delivery-2"></a>
- [When an activating bundle declares fixtures, pendingFixtureIds returns every declared fixture id, since this route runs no fixture evaluation\. On first ingestion the release row is stored with status submitted, the active pointer stays unchanged, and the 202 response reports accepted\_pending\_tests; a re\-post of that version stores nothing and answers duplicate\. Only a fixture\-free bundle reaches activation\.](patternlike-source-mindmap.md#claim-leaf-signed-editorial-release-delivery-2) — [evidence-apps-api-routes-content-releases-ts](#evidence-evidence-apps-api-routes-content-releases-ts) [evidence-b8-pending-fixture-ids](#evidence-evidence-b8-pending-fixture-ids) [evidence-b8-fixture-hold-branch](#evidence-evidence-b8-fixture-hold-branch) [evidence-b8-release-row-submitted](#evidence-evidence-b8-release-row-submitted) [evidence-b8-pending-response](#evidence-evidence-b8-pending-response) [evidence-b8-pending-status](#evidence-evidence-b8-pending-status) [evidence-b8-release-repost-duplicate](#evidence-evidence-b8-release-repost-duplicate)

<a id="claim-leaf-signed-editorial-release-delivery-3"></a>
- [GET /v1/pattern hands every account to the generated Pattern reader, while M4 editorial releases still ingest as preserved data\. A release\-builder test asserts that no runtime source under apps/api/src, apps/web/src, apps/calc\-stub/src, or packages references the draft candidate files, and the stub router mounts after every product router\.](patternlike-source-mindmap.md#claim-leaf-signed-editorial-release-delivery-3) — [evidence-b8-pattern-route-generated](#evidence-evidence-b8-pattern-route-generated) [evidence-b8-content-release-generated-validators](#evidence-evidence-b8-content-release-generated-validators) [evidence-b8-candidate-boundary-test](#evidence-evidence-b8-candidate-boundary-test) [evidence-legacy-stub-order](#evidence-evidence-legacy-stub-order)

<a id="claim-leaf-pure-engines-and-licensing-boundary-1"></a>
- [reading\-engine and pattern\-engine each declare a purity contract of no fetch, no D1, no Date\.now\(\), and no crypto, and each depends at runtime only on @patternlike/shared\.](patternlike-source-mindmap.md#claim-leaf-pure-engines-and-licensing-boundary-1) — [evidence-packages-reading-engine-index-ts](#evidence-evidence-packages-reading-engine-index-ts) [evidence-packages-pattern-engine-index-ts](#evidence-evidence-packages-pattern-engine-index-ts) [evidence-b8-reading-engine-runtime-deps](#evidence-evidence-b8-reading-engine-runtime-deps) [evidence-b8-pattern-engine-runtime-deps](#evidence-evidence-b8-pattern-engine-runtime-deps)

<a id="claim-leaf-pure-engines-and-licensing-boundary-3"></a>
- [packages/shared is the cross\-service vocabulary that calc\-stub and the API both import: wire types, canonical JSON for stable fingerprints, content\-addressed ids such as cycle pass ids, and runner protocol shapes such as the v2 mesh claim\.](patternlike-source-mindmap.md#claim-leaf-pure-engines-and-licensing-boundary-3) — [evidence-b8-calc-stub-imports-shared](#evidence-evidence-b8-calc-stub-imports-shared) [evidence-b8-api-imports-shared](#evidence-evidence-b8-api-imports-shared) [evidence-b8-shared-canonical-json](#evidence-evidence-b8-shared-canonical-json) [evidence-b8-shared-cycle-pass-id](#evidence-evidence-b8-shared-cycle-pass-id) [evidence-b8-shared-mesh-claim-v2](#evidence-evidence-b8-shared-mesh-claim-v2)

<a id="claim-leaf-pure-engines-and-licensing-boundary-2"></a>
- [apps/calc\-stub is AGPL\-3\.0\-or\-later and imports @patternlike/shared, which declares UNLICENSED pending the AGPL\-boundary decision; the engines stay outside shared so product rules do not enter the AGPL service's imports\. LICENSING\.md and the license decision record leave that boundary open\.](patternlike-source-mindmap.md#claim-leaf-pure-engines-and-licensing-boundary-2) — [evidence-apps-calc-stub-package-json](#evidence-evidence-apps-calc-stub-package-json) [evidence-b8-calc-stub-imports-shared](#evidence-evidence-b8-calc-stub-imports-shared) [evidence-packages-shared-package-json](#evidence-evidence-packages-shared-package-json) [evidence-b8-shared-license-pending](#evidence-evidence-b8-shared-license-pending) [evidence-b8-engines-outside-shared](#evidence-evidence-b8-engines-outside-shared) [evidence-unresolved-license-boundary](#evidence-evidence-unresolved-license-boundary) [evidence-shared-license-decision](#evidence-evidence-shared-license-decision)

<a id="claim-leaf-release-assurance-tooling-1"></a>
- [operational\-canary\.mjs requires an https origin and uses the global fetch unless a test fetcher is injected\. It checks /health, /v1/meta, and a protected route's 401; with a session token it also POSTs a place search and, given a reading id and date, reads that Daily reading back\. Geoapify usage is judged only from an operator\-supplied file\.](patternlike-source-mindmap.md#claim-leaf-release-assurance-tooling-1) — [evidence-b8-canary-https-origin](#evidence-evidence-b8-canary-https-origin) [evidence-b8-canary-native-fetch](#evidence-evidence-b8-canary-native-fetch) [evidence-b8-canary-public-checks](#evidence-evidence-b8-canary-public-checks) [evidence-b8-canary-place-search](#evidence-evidence-b8-canary-place-search) [evidence-b8-canary-daily-readback](#evidence-evidence-b8-canary-daily-readback) [evidence-b8-canary-usage-file](#evidence-evidence-b8-canary-usage-file)

<a id="claim-leaf-release-assurance-tooling-2"></a>
- [Fresh Daily, Pattern, and semantic\-verifier evaluation runs invoke Codex by default; supported Daily and verifier preparation modes construct inputs without those invocations\. The presence of these harnesses is not evidence that any ran\.](patternlike-source-mindmap.md#claim-leaf-release-assurance-tooling-2) — [evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2](#evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2) [evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs](#evidence-evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs) [evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2](#evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2) [evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3](#evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3) [evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3](#evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3)

<a id="claim-leaf-release-assurance-tooling-4"></a>
- [full\-packet\-profiles\.mjs rebuilds two Daily evaluation profiles, exact\_full\_packet with 71 facts and its unknown\-birth\-time counterpart unknown\_full\_packet with 53, and rewrites the corpus fixture\. The fresh Daily evaluation prepares one claim per corpus profile, eight in the committed fixture\.](patternlike-source-mindmap.md#claim-leaf-release-assurance-tooling-4) — [evidence-b8-full-packet-exact-profile](#evidence-evidence-b8-full-packet-exact-profile) [evidence-b8-full-packet-writes-fixture](#evidence-evidence-b8-full-packet-writes-fixture) [evidence-b8-corpus-full-packet-sizes](#evidence-evidence-b8-corpus-full-packet-sizes) [evidence-b8-fresh-daily-case-per-profile](#evidence-evidence-b8-fresh-daily-case-per-profile) [evidence-b8-fresh-daily-eight-profiles](#evidence-evidence-b8-fresh-daily-eight-profiles)

<a id="claim-leaf-release-assurance-tooling-3"></a>
- [release\-evidence\.mjs gate runs npm run ci:local and records the source snapshot, parsed gate summary, artifact hashes, and repository pins, with every deployment field unverified; verify rechecks a receipt against the current checkout\. release\-reconciliation\.mjs accepts only a verified receipt and declares no platform, provider, account, or database calls\.](patternlike-source-mindmap.md#claim-leaf-release-assurance-tooling-3) — [evidence-b8-release-evidence-runs-gate](#evidence-evidence-b8-release-evidence-runs-gate) [evidence-b8-release-evidence-receipt-fields](#evidence-evidence-b8-release-evidence-receipt-fields) [evidence-b8-release-evidence-deployment-unverified](#evidence-evidence-b8-release-evidence-deployment-unverified) [evidence-b8-release-evidence-current-source](#evidence-evidence-b8-release-evidence-current-source) [evidence-b8-reconciliation-requires-verified-gate](#evidence-evidence-b8-reconciliation-requires-verified-gate) [evidence-scripts-pattern-release-release-reconciliation-mjs](#evidence-evidence-scripts-pattern-release-release-reconciliation-mjs)

<a id="claim-leaf-release-assurance-tooling-5"></a>
- [scripts/ci\-local\.sh emits the success line required by parseCiSummary in release\-evidence\.mjs\. The parser also requires all fourteen expected passing lanes in order and a toolchain line; an incomplete receipt summary fails with gate\_summary\_incomplete\. A regression runs the committed CI script with stubbed npm commands and checks that its real success summary is accepted\.](patternlike-source-mindmap.md#claim-leaf-release-assurance-tooling-5) — [evidence-b8-ci-local-success](#evidence-evidence-b8-ci-local-success) [evidence-b8-parse-ci-summary-em-dash](#evidence-evidence-b8-parse-ci-summary-em-dash) [evidence-b8-gate-summary-incomplete](#evidence-evidence-b8-gate-summary-incomplete) [evidence-b8-ci-summary-integration-test](#evidence-evidence-b8-ci-summary-integration-test)

<a id="claim-leaf-local-verification-and-release-gate-1"></a>
- [npm run ci:local runs scripts/ci\-local\.sh\. Its contracts lane, test:contracts, runs the spec\-renderer tests, validate\_schemas\.py, both D1 smoke checks, and an adaptive\-portrait migration regression\. Its monorepo lanes run npm ci \-\-dry\-run \(a full npm ci with \-\-clean\), an ephemeris download step unless \-\-skip\-ephe \(calc\-stub's pretest downloads regardless\), typecheck, six workspaces' tests, and the root build of every workspace, which ends in the API's production dry\-run\.](patternlike-source-mindmap.md#claim-leaf-local-verification-and-release-gate-1) — [evidence-package-json](#evidence-evidence-package-json) [evidence-scripts-ci-local-sh](#evidence-evidence-scripts-ci-local-sh) [evidence-b8-test-contracts-script](#evidence-evidence-b8-test-contracts-script) [evidence-b8-ci-local-install-and-ephemeris](#evidence-evidence-b8-ci-local-install-and-ephemeris) [evidence-b8-ci-local-monorepo-steps](#evidence-evidence-b8-ci-local-monorepo-steps) [evidence-b8-root-build](#evidence-evidence-b8-root-build) [evidence-b8-api-build-dry-run](#evidence-evidence-b8-api-build-dry-run) [evidence-b8-calc-stub-pretest-download](#evidence-evidence-b8-calc-stub-pretest-download)

<a id="claim-leaf-local-verification-and-release-gate-4"></a>
- [calc\-stub's test glob covers its golden suites, so ci:local runs them through the ordinary calc\-stub test lane rather than the separate test:golden script\. The script then runs the pattern\-engine and codex\-runner tests and test:content as separately reported extras\.](patternlike-source-mindmap.md#claim-leaf-local-verification-and-release-gate-4) — [evidence-b8-calc-stub-test-glob](#evidence-evidence-b8-calc-stub-test-glob) [evidence-b8-ci-local-monorepo-steps](#evidence-evidence-b8-ci-local-monorepo-steps) [evidence-b8-ci-local-extra-steps](#evidence-evidence-b8-ci-local-extra-steps)

<a id="claim-leaf-local-verification-and-release-gate-2"></a>
- [Repository guidance names npm run ci:local the merge gate and asks for its summary to be pasted into the PR before merging\. It states that GitHub Actions runs fail on this account and that main is not branch protected, so nothing mechanical blocks an unverified merge\. The checkout cannot confirm either GitHub\-side fact\.](patternlike-source-mindmap.md#claim-leaf-local-verification-and-release-gate-2) — [evidence-agents-md-2](#evidence-evidence-agents-md-2) [evidence-b8-agents-paste-summary](#evidence-evidence-b8-agents-paste-summary) [evidence-b8-agents-actions-billing](#evidence-evidence-b8-agents-actions-billing) [evidence-b8-agents-main-unprotected](#evidence-evidence-b8-agents-main-unprotected)

<a id="claim-leaf-local-verification-and-release-gate-3"></a>
- [Repository guidance states that Cloudflare Workers Builds, separate from GitHub Actions, builds and deploys production on a merge to main, so a migration must be applied remotely before that push\. It places the trigger and its RELEASE\_GIT\_SHA injection in Workers Builds; committed configuration holds only an all\-zero placeholder, and the release runbook says it does not apply that setting\.](patternlike-source-mindmap.md#claim-leaf-local-verification-and-release-gate-3) — [evidence-b8-agents-workers-builds](#evidence-evidence-b8-agents-workers-builds) [evidence-b8-claude-migration-before-push](#evidence-evidence-b8-claude-migration-before-push) [evidence-b8-readme-release-path](#evidence-evidence-b8-readme-release-path) [evidence-b6-production-release-placeholder](#evidence-evidence-b6-production-release-placeholder) [evidence-b8-release-runbook-not-applied](#evidence-evidence-b8-release-runbook-not-applied)

<a id="claim-leaf-maintainer-tooling-outside-the-gate-1"></a>
- [evals/promptfoo holds operator\-side promptfoo lanes with their own package\.json and lockfile, outside the root apps and packages workspaces, and its README states that ci:local, ci\.yml, and test:content never run them\. Its validators lane checks authored corpus candidates through the echo provider without model calls, and eval:daily sends claims through the runner's isolated Codex transport\.](patternlike-source-mindmap.md#claim-leaf-maintainer-tooling-outside-the-gate-1) — [evidence-b8-root-workspaces](#evidence-evidence-b8-root-workspaces) [evidence-b8-promptfoo-boundary](#evidence-evidence-b8-promptfoo-boundary) [evidence-b8-promptfoo-echo-lane](#evidence-evidence-b8-promptfoo-echo-lane) [evidence-b8-promptfoo-daily-script](#evidence-evidence-b8-promptfoo-daily-script) [evidence-b8-promptfoo-codex-transport](#evidence-evidence-b8-promptfoo-codex-transport)

<a id="claim-leaf-maintainer-tooling-outside-the-gate-2"></a>
- [eval:daily takes its claims from the fresh Daily evaluation plan, one test per plan case, so it covers the eight committed corpus profiles, although its README still describes six\. The README treats a run as exploration evidence, not release evidence or merge approval\.](patternlike-source-mindmap.md#claim-leaf-maintainer-tooling-outside-the-gate-2) — [evidence-b8-promptfoo-plan-source](#evidence-evidence-b8-promptfoo-plan-source) [evidence-b8-promptfoo-test-per-case](#evidence-evidence-b8-promptfoo-test-per-case) [evidence-b8-fresh-daily-eight-profiles](#evidence-evidence-b8-fresh-daily-eight-profiles) [evidence-b8-promptfoo-readme-six](#evidence-evidence-b8-promptfoo-readme-six) [evidence-b8-promptfoo-exploration-evidence](#evidence-evidence-b8-promptfoo-exploration-evidence)

<a id="claim-leaf-maintainer-tooling-outside-the-gate-3"></a>
- [scripts/source\-map captures and checks docs/architecture/source\-map/map\.json through root map:capture and map:check, tested by test:source\-map; neither the root test script nor ci:local runs them\. Capture matches each selector as literal text, refuses a missing or repeated one, and writes under docs/architecture/source\-map/snapshots; check reports changed sources, tooling, or definition\.](patternlike-source-mindmap.md#claim-leaf-maintainer-tooling-outside-the-gate-3) — [evidence-b8-map-scripts](#evidence-evidence-b8-map-scripts) [evidence-b8-root-test-lanes](#evidence-evidence-b8-root-test-lanes) [evidence-b8-ci-local-extra-steps](#evidence-evidence-b8-ci-local-extra-steps) [evidence-b8-map-literal-anchors](#evidence-evidence-b8-map-literal-anchors) [evidence-b8-map-capture-refuses](#evidence-evidence-b8-map-capture-refuses) [evidence-b8-map-definition-and-snapshots](#evidence-evidence-b8-map-definition-and-snapshots) [evidence-b8-map-check-changes](#evidence-evidence-b8-map-check-changes)

<a id="evidence-evidence-apps-web-app-tsx"></a>
## evidence-apps-web-app-tsx

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L63), lines 63–63.

<a id="evidence-evidence-b1-app-default-view"></a>
## evidence-b1-app-default-view

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L69), lines 69–69.

<a id="evidence-evidence-b1-appshell-nav-labels"></a>
## evidence-b1-appshell-nav-labels

Current source — [apps/web/src/components/AppShell\.tsx](../../../../../apps/web/src/components/AppShell.tsx#L6), lines 6–13.

<a id="evidence-evidence-b1-appshell-mobile-pattern-label"></a>
## evidence-b1-appshell-mobile-pattern-label

Current source — [apps/web/src/components/AppShell\.tsx](../../../../../apps/web/src/components/AppShell.tsx#L46), lines 46–46.

<a id="evidence-evidence-b1-app-signed-out"></a>
## evidence-b1-app-signed-out

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L416), lines 416–418.

<a id="evidence-evidence-b1-deletion-status-route-first"></a>
## evidence-b1-deletion-status-route-first

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L409), lines 409–410.

<a id="evidence-evidence-b1-onboarding-grant"></a>
## evidence-b1-onboarding-grant

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L295), lines 295–295.

<a id="evidence-evidence-b1-onboarding-profile-consent"></a>
## evidence-b1-onboarding-profile-consent

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L323), lines 323–326.

<a id="evidence-evidence-b1-app-access-recovery"></a>
## evidence-b1-app-access-recovery

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L159), lines 159–162.

<a id="evidence-evidence-b1-app-unavailable-controls"></a>
## evidence-b1-app-unavailable-controls

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L450), lines 450–450.

<a id="evidence-evidence-app-sign-out"></a>
## evidence-app-sign-out

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L328), lines 328–328.

<a id="evidence-evidence-deletion-status-view"></a>
## evidence-deletion-status-view

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L410), lines 410–410.

<a id="evidence-evidence-b1-today-local-date"></a>
## evidence-b1-today-local-date

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L475), lines 475–475.

<a id="evidence-evidence-b1-today-article-check-in"></a>
## evidence-b1-today-article-check-in

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L318), lines 318–319.

<a id="evidence-evidence-b1-reflection-tone-v3"></a>
## evidence-b1-reflection-tone-v3

Current source — [apps/web/src/lib/reading\-format\.ts](../../../../../apps/web/src/lib/reading-format.ts#L24), lines 24–25.

<a id="evidence-evidence-b1-reflection-tone-v5"></a>
## evidence-b1-reflection-tone-v5

Current source — [apps/web/src/lib/reading\-format\.ts](../../../../../apps/web/src/lib/reading-format.ts#L46), lines 46–47.

<a id="evidence-evidence-b1-article-reflection"></a>
## evidence-b1-article-reflection

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L60), lines 60–60.

<a id="evidence-evidence-b1-article-why-this"></a>
## evidence-b1-article-why-this

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L163), lines 163–164.

<a id="evidence-evidence-b1-article-save"></a>
## evidence-b1-article-save

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L123), lines 123–123.

<a id="evidence-evidence-b1-article-paragraph-connection"></a>
## evidence-b1-article-paragraph-connection

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L156), lines 156–156.

<a id="evidence-evidence-b1-article-response-card"></a>
## evidence-b1-article-response-card

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L175), lines 175–181.

<a id="evidence-evidence-b1-history-filters"></a>
## evidence-b1-history-filters

Current source — [apps/web/src/components/HistoryView\.tsx](../../../../../apps/web/src/components/HistoryView.tsx#L290), lines 290–290.

<a id="evidence-evidence-b1-history-canonical-order"></a>
## evidence-b1-history-canonical-order

Current source — [apps/api/src/db/readings\.ts](../../../../../apps/api/src/db/readings.ts#L678), lines 678–680.

<a id="evidence-evidence-b1-history-saved-order"></a>
## evidence-b1-history-saved-order

Current source — [apps/api/src/db/readings\.ts](../../../../../apps/api/src/db/readings.ts#L702), lines 702–702.

<a id="evidence-evidence-b1-history-open-reading"></a>
## evidence-b1-history-open-reading

Current source — [apps/web/src/components/HistoryView\.tsx](../../../../../apps/web/src/components/HistoryView.tsx#L175), lines 175–175.

<a id="evidence-evidence-b1-history-article"></a>
## evidence-b1-history-article

Current source — [apps/web/src/components/HistoryView\.tsx](../../../../../apps/web/src/components/HistoryView.tsx#L263), lines 263–265.

<a id="evidence-evidence-b1-article-historical-date"></a>
## evidence-b1-article-historical-date

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L105), lines 105–105.

<a id="evidence-evidence-b1-article-revision-status"></a>
## evidence-b1-article-revision-status

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L73), lines 73–73.

<a id="evidence-evidence-b1-reading-evidence-route"></a>
## evidence-b1-reading-evidence-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L564), lines 564–564.

<a id="evidence-evidence-b1-response-report-heading"></a>
## evidence-b1-response-report-heading

Current source — [apps/web/src/components/ReadingResponseCard\.tsx](../../../../../apps/web/src/components/ReadingResponseCard.tsx#L213), lines 213–213.

<a id="evidence-evidence-b1-response-note"></a>
## evidence-b1-response-note

Current source — [apps/web/src/components/ReadingResponseCard\.tsx](../../../../../apps/web/src/components/ReadingResponseCard.tsx#L235), lines 235–235.

<a id="evidence-evidence-b1-response-birth-correction"></a>
## evidence-b1-response-birth-correction

Current source — [apps/web/src/components/ReadingResponseCard\.tsx](../../../../../apps/web/src/components/ReadingResponseCard.tsx#L241), lines 241–242.

<a id="evidence-evidence-b1-response-overall"></a>
## evidence-b1-response-overall

Current source — [apps/web/src/components/ReadingResponseCard\.tsx](../../../../../apps/web/src/components/ReadingResponseCard.tsx#L245), lines 245–246.

<a id="evidence-evidence-b1-response-legacy"></a>
## evidence-b1-response-legacy

Current source — [apps/web/src/components/ReadingResponseCard\.tsx](../../../../../apps/web/src/components/ReadingResponseCard.tsx#L200), lines 200–200.

<a id="evidence-evidence-b1-today-ensure-first-load"></a>
## evidence-b1-today-ensure-first-load

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L164), lines 164–164.

<a id="evidence-evidence-b1-today-put-then-get"></a>
## evidence-b1-today-put-then-get

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L212), lines 212–213.

<a id="evidence-evidence-b1-api-ensure-today-put"></a>
## evidence-b1-api-ensure-today-put

Current source — [apps/web/src/lib/api\-client\.ts](../../../../../apps/web/src/lib/api-client.ts#L663), lines 663–664.

<a id="evidence-evidence-b1-api-get-today"></a>
## evidence-b1-api-get-today

Current source — [apps/web/src/lib/api\-client\.ts](../../../../../apps/web/src/lib/api-client.ts#L671), lines 671–672.

<a id="evidence-evidence-b1-today-reload-get"></a>
## evidence-b1-today-reload-get

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L174), lines 174–174.

<a id="evidence-evidence-b1-today-resume-preparation"></a>
## evidence-b1-today-resume-preparation

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L175), lines 175–175.

<a id="evidence-evidence-b1-today-keep-reading"></a>
## evidence-b1-today-keep-reading

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L289), lines 289–289.

<a id="evidence-evidence-b1-today-status-line"></a>
## evidence-b1-today-status-line

Current source — [apps/web/src/components/TodayView\.tsx](../../../../../apps/web/src/components/TodayView.tsx#L323), lines 323–323.

<a id="evidence-evidence-b1-article-connections-wrapper"></a>
## evidence-b1-article-connections-wrapper

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L186), lines 186–187.

<a id="evidence-evidence-b1-connections-link"></a>
## evidence-b1-connections-link

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L194), lines 194–194.

<a id="evidence-evidence-b1-connections-reason"></a>
## evidence-b1-connections-reason

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L201), lines 201–201.

<a id="evidence-evidence-b1-connections-explanation-push"></a>
## evidence-b1-connections-explanation-push

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L185), lines 185–185.

<a id="evidence-evidence-b1-connections-push"></a>
## evidence-b1-connections-push

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L173), lines 173–173.

<a id="evidence-evidence-b1-connections-back"></a>
## evidence-b1-connections-back

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L212), lines 212–212.

<a id="evidence-evidence-b1-connections-popstate"></a>
## evidence-b1-connections-popstate

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L119), lines 119–119.

<a id="evidence-evidence-b1-relationship-routes-allowed"></a>
## evidence-b1-relationship-routes-allowed

Current source — [apps/api/src/services/reader\-relationship\-resolver\.ts](../../../../../apps/api/src/services/reader-relationship-resolver.ts#L50), lines 50–50.

<a id="evidence-evidence-b1-relationship-source-unit"></a>
## evidence-b1-relationship-source-unit

Current source — [apps/api/src/services/reader\-relationships\.ts](../../../../../apps/api/src/services/reader-relationships.ts#L177), lines 177–177.

<a id="evidence-evidence-b1-relationship-saved-candidates"></a>
## evidence-b1-relationship-saved-candidates

Current source — [apps/api/src/services/reader\-relationships\.ts](../../../../../apps/api/src/services/reader-relationships.ts#L185), lines 185–186.

<a id="evidence-evidence-b1-connections-destinations"></a>
## evidence-b1-connections-destinations

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L21), lines 21–23.

<a id="evidence-evidence-b1-connections-onward-links"></a>
## evidence-b1-connections-onward-links

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L219), lines 219–219.

<a id="evidence-evidence-b1-connections-daily-target"></a>
## evidence-b1-connections-daily-target

Current source — [apps/web/src/components/ReadingArticle\.tsx](../../../../../apps/web/src/components/ReadingArticle.tsx#L194), lines 194–194.

<a id="evidence-evidence-b1-connected-pattern-chapter"></a>
## evidence-b1-connected-pattern-chapter

Current source — [apps/web/src/components/ConnectedPatternReading\.tsx](../../../../../apps/web/src/components/ConnectedPatternReading.tsx#L16), lines 16–16.

<a id="evidence-evidence-b1-connected-timing"></a>
## evidence-b1-connected-timing

Current source — [apps/web/src/components/ConnectedTimingReading\.tsx](../../../../../apps/web/src/components/ConnectedTimingReading.tsx#L13), lines 13–13.

<a id="evidence-evidence-b1-connection-target-check"></a>
## evidence-b1-connection-target-check

Current source — [apps/web/src/lib/reading\-connection\-response\.ts](../../../../../apps/web/src/lib/reading-connection-response.ts#L22), lines 22–23.

<a id="evidence-evidence-b1-connection-chapter-hash"></a>
## evidence-b1-connection-chapter-hash

Current source — [apps/web/src/lib/reading\-connection\-response\.ts](../../../../../apps/web/src/lib/reading-connection-response.ts#L36), lines 36–36.

<a id="evidence-evidence-b1-connections-no-substitute"></a>
## evidence-b1-connections-no-substitute

Current source — [apps/web/src/components/ReadingConnections\.tsx](../../../../../apps/web/src/components/ReadingConnections.tsx#L213), lines 213–213.

<a id="evidence-evidence-b1-relationship-source-route"></a>
## evidence-b1-relationship-source-route

Current source — [apps/api/src/routes/reader\-relationships\.ts](../../../../../apps/api/src/routes/reader-relationships.ts#L41), lines 41–41.

<a id="evidence-evidence-b1-relationships-route"></a>
## evidence-b1-relationships-route

Current source — [apps/api/src/routes/reader\-relationships\.ts](../../../../../apps/api/src/routes/reader-relationships.ts#L48), lines 48–48.

<a id="evidence-evidence-b1-relationship-target-route"></a>
## evidence-b1-relationship-target-route

Current source — [apps/api/src/routes/reader\-relationships\.ts](../../../../../apps/api/src/routes/reader-relationships.ts#L55), lines 55–55.

<a id="evidence-evidence-b1-timing-cycle-route"></a>
## evidence-b1-timing-cycle-route

Current source — [apps/api/src/routes/reader\-relationships\.ts](../../../../../apps/api/src/routes/reader-relationships.ts#L62), lines 62–62.

<a id="evidence-evidence-b1-relationship-no-store"></a>
## evidence-b1-relationship-no-store

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L73), lines 73–78.

<a id="evidence-evidence-b1-timing-target-via-relationship"></a>
## evidence-b1-timing-target-via-relationship

Current source — [apps/api/src/services/reader\-relationships\.ts](../../../../../apps/api/src/services/reader-relationships.ts#L242), lines 242–244.

<a id="evidence-evidence-b1-relationship-saved-target"></a>
## evidence-b1-relationship-saved-target

Current source — [apps/api/src/services/reader\-relationships\.ts](../../../../../apps/api/src/services/reader-relationships.ts#L230), lines 230–230.

<a id="evidence-evidence-b1-relationship-kinds"></a>
## evidence-b1-relationship-kinds

Current source — [packages/shared/src/reader\-relationships\-types\.ts](../../../../../packages/shared/src/reader-relationships-types.ts#L41), lines 41–41.

<a id="evidence-evidence-b1-relationship-exact-time"></a>
## evidence-b1-relationship-exact-time

Current source — [apps/api/src/services/reader\-relationship\-resolver\.ts](../../../../../apps/api/src/services/reader-relationship-resolver.ts#L53), lines 53–53.

<a id="evidence-evidence-b1-relationship-resolver-contract"></a>
## evidence-b1-relationship-resolver-contract

Current source — [apps/api/src/services/reader\-relationship\-resolver\.ts](../../../../../apps/api/src/services/reader-relationship-resolver.ts#L85), lines 85–85.

<a id="evidence-evidence-b1-relationship-hops"></a>
## evidence-b1-relationship-hops

Current source — [apps/api/src/services/reader\-relationship\-resolver\.ts](../../../../../apps/api/src/services/reader-relationship-resolver.ts#L93), lines 93–93.

<a id="evidence-evidence-b1-relationship-caps"></a>
## evidence-b1-relationship-caps

Current source — [apps/api/src/services/reader\-relationship\-resolver\.ts](../../../../../apps/api/src/services/reader-relationship-resolver.ts#L108), lines 108–110.

<a id="evidence-evidence-b1-daily-relationship-support"></a>
## evidence-b1-daily-relationship-support

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L842), lines 842–842.

<a id="evidence-evidence-b1-daily-relationship-batch"></a>
## evidence-b1-daily-relationship-batch

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L1556), lines 1556–1556.

<a id="evidence-evidence-b1-pattern-relationship-batch"></a>
## evidence-b1-pattern-relationship-batch

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1964), lines 1964–1964.

<a id="evidence-evidence-b1-relationship-support-sealed"></a>
## evidence-b1-relationship-support-sealed

Current source — [apps/api/src/db/reader\-relationship\-supports\.ts](../../../../../apps/api/src/db/reader-relationship-supports.ts#L86), lines 86–88.

<a id="evidence-evidence-b1-owner-data-key"></a>
## evidence-b1-owner-data-key

Current source — [apps/api/src/db/users\.ts](../../../../../apps/api/src/db/users.ts#L218), lines 218–219.

<a id="evidence-evidence-b1-relationship-support-unique"></a>
## evidence-b1-relationship-support-unique

Current source — [db/d1/0030\_reader\_relationship\_supports\.sql](../../../../../db/d1/0030_reader_relationship_supports.sql#L18), lines 18–18.

<a id="evidence-evidence-b1-relationship-support-owner"></a>
## evidence-b1-relationship-support-owner

Current source — [apps/api/src/db/reader\-relationship\-supports\.ts](../../../../../apps/api/src/db/reader-relationship-supports.ts#L122), lines 122–122.

<a id="evidence-evidence-b1-relationship-support-edition"></a>
## evidence-b1-relationship-support-edition

Current source — [apps/api/src/db/reader\-relationship\-supports\.ts](../../../../../apps/api/src/db/reader-relationship-supports.ts#L131), lines 131–132.

<a id="evidence-evidence-apps-web-components-chartview-tsx-2"></a>
## evidence-apps-web-components-chartview-tsx-2

Current source — [apps/web/src/components/ChartView\.tsx](../../../../../apps/web/src/components/ChartView.tsx#L68), lines 68–68.

<a id="evidence-evidence-b1-chart-wheel"></a>
## evidence-b1-chart-wheel

Current source — [apps/web/src/components/ChartView\.tsx](../../../../../apps/web/src/components/ChartView.tsx#L109), lines 109–112.

<a id="evidence-evidence-b1-chart-uncertainty"></a>
## evidence-b1-chart-uncertainty

Current source — [apps/web/src/components/ChartView\.tsx](../../../../../apps/web/src/components/ChartView.tsx#L129), lines 129–129.

<a id="evidence-evidence-b1-chart-provenance"></a>
## evidence-b1-chart-provenance

Current source — [apps/web/src/components/ChartView\.tsx](../../../../../apps/web/src/components/ChartView.tsx#L209), lines 209–209.

<a id="evidence-evidence-b1-pattern-chapter-fields"></a>
## evidence-b1-pattern-chapter-fields

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L51), lines 51–78.

<a id="evidence-evidence-b1-pattern-signatures"></a>
## evidence-b1-pattern-signatures

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L266), lines 266–266.

<a id="evidence-evidence-b1-pattern-uncertainty"></a>
## evidence-b1-pattern-uncertainty

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L277), lines 277–277.

<a id="evidence-evidence-b1-pattern-provenance-label"></a>
## evidence-b1-pattern-provenance-label

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L285), lines 285–285.

<a id="evidence-evidence-apps-web-components-patternexperience-tsx"></a>
## evidence-apps-web-components-patternexperience-tsx

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L260), lines 260–260.

<a id="evidence-evidence-b1-portrait-explorer-wrapper"></a>
## evidence-b1-portrait-explorer-wrapper

Current source — [apps/web/src/components/AccountPatternPortrait\.tsx](../../../../../apps/web/src/components/AccountPatternPortrait.tsx#L205), lines 205–205.

<a id="evidence-evidence-b1-portrait-can-render"></a>
## evidence-b1-portrait-can-render

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L29), lines 29–29.

<a id="evidence-evidence-b1-portrait-default-open"></a>
## evidence-b1-portrait-default-open

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L36), lines 36–36.

<a id="evidence-evidence-b1-portrait-first-view"></a>
## evidence-b1-portrait-first-view

Current source — [apps/web/src/components/portrait\-explorer/use\-explorer\-navigation\.ts](../../../../../apps/web/src/components/portrait-explorer/use-explorer-navigation.ts#L180), lines 180–180.

<a id="evidence-evidence-b1-portrait-explore-button"></a>
## evidence-b1-portrait-explore-button

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L195), lines 195–195.

<a id="evidence-evidence-b1-portrait-text-only"></a>
## evidence-b1-portrait-text-only

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L193), lines 193–193.

<a id="evidence-evidence-b1-timing-status"></a>
## evidence-b1-timing-status

Current source — [apps/api/src/routes/timing\.ts](../../../../../apps/api/src/routes/timing.ts#L138), lines 138–143.

<a id="evidence-evidence-b1-timing-filters"></a>
## evidence-b1-timing-filters

Current source — [apps/api/src/routes/timing\.ts](../../../../../apps/api/src/routes/timing.ts#L211), lines 211–212.

<a id="evidence-evidence-b1-timing-scan-status"></a>
## evidence-b1-timing-scan-status

Current source — [apps/api/src/routes/timing\.ts](../../../../../apps/api/src/routes/timing.ts#L190), lines 190–190.

<a id="evidence-evidence-b1-timing-not-scanned"></a>
## evidence-b1-timing-not-scanned

Current source — [apps/api/src/routes/timing\.ts](../../../../../apps/api/src/routes/timing.ts#L196), lines 196–196.

<a id="evidence-evidence-b1-time-travel-comparison"></a>
## evidence-b1-time-travel-comparison

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L348), lines 348–348.

<a id="evidence-evidence-b1-time-travel-cache"></a>
## evidence-b1-time-travel-cache

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L258), lines 258–258.

<a id="evidence-evidence-b1-time-travel-budget"></a>
## evidence-b1-time-travel-budget

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L264), lines 264–270.

<a id="evidence-evidence-b1-time-travel-scan-limit"></a>
## evidence-b1-time-travel-scan-limit

Current source — [apps/api/src/services/time\-travel\-config\.ts](../../../../../apps/api/src/services/time-travel-config.ts#L3), lines 3–3.

<a id="evidence-evidence-b1-time-travel-confirmed-zone"></a>
## evidence-b1-time-travel-confirmed-zone

Current source — [apps/api/src/routes/time\-travel\.ts](../../../../../apps/api/src/routes/time-travel.ts#L25), lines 25–25.

<a id="evidence-evidence-b1-time-travel-local-day"></a>
## evidence-b1-time-travel-local-day

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L216), lines 216–224.

<a id="evidence-evidence-b1-time-travel-suppressed"></a>
## evidence-b1-time-travel-suppressed

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L281), lines 281–281.

<a id="evidence-evidence-apps-web-components-timetravelview-tsx"></a>
## evidence-apps-web-components-timetravelview-tsx

Current source — [apps/web/src/components/TimeTravelView\.tsx](../../../../../apps/web/src/components/TimeTravelView.tsx#L681), lines 681–681.

<a id="evidence-evidence-b1-life-events-boundary"></a>
## evidence-b1-life-events-boundary

Current source — [apps/web/src/components/LifeEventTimeline\.tsx](../../../../../apps/web/src/components/LifeEventTimeline.tsx#L540), lines 540–541.

<a id="evidence-evidence-b1-life-events-can-write"></a>
## evidence-b1-life-events-can-write

Current source — [apps/web/src/components/LifeEventTimeline\.tsx](../../../../../apps/web/src/components/LifeEventTimeline.tsx#L513), lines 513–513.

<a id="evidence-evidence-b1-life-events-delete-available"></a>
## evidence-b1-life-events-delete-available

Current source — [apps/web/src/components/LifeEventTimeline\.tsx](../../../../../apps/web/src/components/LifeEventTimeline.tsx#L555), lines 555–555.

<a id="evidence-evidence-b1-reader-scope"></a>
## evidence-b1-reader-scope

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L103), lines 103–104.

<a id="evidence-evidence-b1-view-unauthorized-wiring"></a>
## evidence-b1-view-unauthorized-wiring

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L529), lines 529–529.

<a id="evidence-evidence-b1-session-epoch"></a>
## evidence-b1-session-epoch

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L310), lines 310–310.

<a id="evidence-evidence-b1-portrait-session-key"></a>
## evidence-b1-portrait-session-key

Current source — [apps/web/src/App\.tsx](../../../../../apps/web/src/App.tsx#L544), lines 544–544.

<a id="evidence-evidence-b1-readiness-max-age"></a>
## evidence-b1-readiness-max-age

Current source — [apps/web/src/lib/reader\-readiness\.ts](../../../../../apps/web/src/lib/reader-readiness.ts#L44), lines 44–44.

<a id="evidence-evidence-b1-readiness-fresh-actions"></a>
## evidence-b1-readiness-fresh-actions

Current source — [apps/web/src/lib/reader\-readiness\.ts](../../../../../apps/web/src/lib/reader-readiness.ts#L111), lines 111–111.

<a id="evidence-evidence-b1-readiness-contract"></a>
## evidence-b1-readiness-contract

Current source — [apps/web/src/lib/reader\-readiness\.ts](../../../../../apps/web/src/lib/reader-readiness.ts#L3), lines 3–3.

<a id="evidence-evidence-b1-consequence-actions"></a>
## evidence-b1-consequence-actions

Current source — [apps/web/src/lib/reader\-consequences\.ts](../../../../../apps/web/src/lib/reader-consequences.ts#L1), lines 1–1.

<a id="evidence-evidence-b1-consequence-freshness"></a>
## evidence-b1-consequence-freshness

Current source — [apps/web/src/components/ReaderReadiness\.tsx](../../../../../apps/web/src/components/ReaderReadiness.tsx#L26), lines 26–26.

<a id="evidence-evidence-b1-consequence-known-only"></a>
## evidence-b1-consequence-known-only

Current source — [apps/web/src/components/ReaderReadiness\.tsx](../../../../../apps/web/src/components/ReaderReadiness.tsx#L30), lines 30–30.

<a id="evidence-evidence-b1-consequence-fallback"></a>
## evidence-b1-consequence-fallback

Current source — [apps/web/src/lib/reader\-consequences\.ts](../../../../../apps/web/src/lib/reader-consequences.ts#L45), lines 45–45.

<a id="evidence-evidence-b1-privacy-correct-consequences"></a>
## evidence-b1-privacy-correct-consequences

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L835), lines 835–835.

<a id="evidence-evidence-b1-onboarding-consequences"></a>
## evidence-b1-onboarding-consequences

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L635), lines 635–635.

<a id="evidence-evidence-b1-onboarding-fresh-submit"></a>
## evidence-b1-onboarding-fresh-submit

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L729), lines 729–729.

<a id="evidence-evidence-b1-onboarding-recheck"></a>
## evidence-b1-onboarding-recheck

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L320), lines 320–320.

<a id="evidence-evidence-b1-pattern-delete-consequences"></a>
## evidence-b1-pattern-delete-consequences

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L310), lines 310–310.

<a id="evidence-evidence-b1-pattern-delete-fresh"></a>
## evidence-b1-pattern-delete-fresh

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L331), lines 331–331.

<a id="evidence-evidence-apps-api-routes-birth-ts"></a>
## evidence-apps-api-routes-birth-ts

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L355), lines 355–355.

<a id="evidence-evidence-b2-birth-idempotency-key"></a>
## evidence-b2-birth-idempotency-key

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L369), lines 369–369.

<a id="evidence-evidence-b2-birth-accuracy-check"></a>
## evidence-b2-birth-accuracy-check

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L95), lines 95–95.

<a id="evidence-evidence-b2-birth-coordinate-pair"></a>
## evidence-b2-birth-coordinate-pair

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L150), lines 150–150.

<a id="evidence-evidence-b2-birth-zone-hint-check"></a>
## evidence-b2-birth-zone-hint-check

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L163), lines 163–163.

<a id="evidence-evidence-b2-birth-job-replay"></a>
## evidence-b2-birth-job-replay

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L450), lines 450–454.

<a id="evidence-evidence-b2-birth-budget-reservation"></a>
## evidence-b2-birth-budget-reservation

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L578), lines 578–578.

<a id="evidence-evidence-b2-birth-consent-before-calc"></a>
## evidence-b2-birth-consent-before-calc

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L886), lines 886–886.

<a id="evidence-evidence-b2-place-search-gated"></a>
## evidence-b2-place-search-gated

Current source — [apps/api/src/routes/places\.ts](../../../../../apps/api/src/routes/places.ts#L112), lines 112–113.

<a id="evidence-evidence-b2-place-resolve-gated"></a>
## evidence-b2-place-resolve-gated

Current source — [apps/api/src/routes/places\.ts](../../../../../apps/api/src/routes/places.ts#L148), lines 148–149.

<a id="evidence-evidence-b2-geoapify-server-fetch"></a>
## evidence-b2-geoapify-server-fetch

Current source — [apps/api/src/services/geocoder/geoapify\.ts](../../../../../apps/api/src/services/geocoder/geoapify.ts#L130), lines 130–130.

<a id="evidence-evidence-b2-geocoder-rollout-gate"></a>
## evidence-b2-geocoder-rollout-gate

Current source — [apps/api/src/services/geocoder/index\.ts](../../../../../apps/api/src/services/geocoder/index.ts#L6), lines 6–6.

<a id="evidence-evidence-b2-geocoder-consent-gate"></a>
## evidence-b2-geocoder-consent-gate

Current source — [apps/api/src/routes/places\.ts](../../../../../apps/api/src/routes/places.ts#L84), lines 84–84.

<a id="evidence-evidence-b2-place-resolution-ttl"></a>
## evidence-b2-place-resolution-ttl

Current source — [apps/api/src/db/place\-resolutions\.ts](../../../../../apps/api/src/db/place-resolutions.ts#L17), lines 17–17.

<a id="evidence-evidence-b2-birth-place-resolution-load"></a>
## evidence-b2-birth-place-resolution-load

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L498), lines 498–498.

<a id="evidence-evidence-b2-place-resolution-lookup"></a>
## evidence-b2-place-resolution-lookup

Current source — [apps/api/src/db/place\-resolutions\.ts](../../../../../apps/api/src/db/place-resolutions.ts#L84), lines 84–85.

<a id="evidence-evidence-b2-birth-chart-supersede"></a>
## evidence-b2-birth-chart-supersede

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L1141), lines 1141–1141.

<a id="evidence-evidence-b2-birth-profile-supersede"></a>
## evidence-b2-birth-profile-supersede

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L1166), lines 1166–1166.

<a id="evidence-evidence-b2-birth-fact-repair"></a>
## evidence-b2-birth-fact-repair

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L1637), lines 1637–1640.

<a id="evidence-evidence-b2-fact-repair-current-day"></a>
## evidence-b2-fact-repair-current-day

Current source — [apps/api/src/services/reading\-invalidation\.ts](../../../../../apps/api/src/services/reading-invalidation.ts#L525), lines 525–526.

<a id="evidence-evidence-b2-fact-repair-day-limit"></a>
## evidence-b2-fact-repair-day-limit

Current source — [apps/api/src/services/reading\-invalidation\.ts](../../../../../apps/api/src/services/reading-invalidation.ts#L398), lines 398–398.

<a id="evidence-evidence-b2-birth-pattern-reconcile"></a>
## evidence-b2-birth-pattern-reconcile

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L1648), lines 1648–1648.

<a id="evidence-evidence-b2-pattern-correction-erase"></a>
## evidence-b2-pattern-correction-erase

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L209), lines 209–209.

<a id="evidence-evidence-b2-pattern-correction-grant"></a>
## evidence-b2-pattern-correction-grant

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L237), lines 237–238.

<a id="evidence-evidence-b2-history-no-chart-filter"></a>
## evidence-b2-history-no-chart-filter

Current source — [apps/api/src/db/readings\.ts](../../../../../apps/api/src/db/readings.ts#L670), lines 670–672.

<a id="evidence-evidence-b2-history-one-per-date"></a>
## evidence-b2-history-one-per-date

Current source — [apps/api/src/db/readings\.ts](../../../../../apps/api/src/db/readings.ts#L657), lines 657–658.

<a id="evidence-evidence-b2-history-canonical-rank"></a>
## evidence-b2-history-canonical-rank

Current source — [apps/api/src/db/readings\.ts](../../../../../apps/api/src/db/readings.ts#L678), lines 678–678.

<a id="evidence-evidence-b2-birth-effective-coordinates"></a>
## evidence-b2-birth-effective-coordinates

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L523), lines 523–523.

<a id="evidence-evidence-b2-timezone-tzlookup"></a>
## evidence-b2-timezone-tzlookup

Current source — [apps/api/src/services/timezone\.ts](../../../../../apps/api/src/services/timezone.ts#L51), lines 51–51.

<a id="evidence-evidence-b2-timezone-coordinates-first"></a>
## evidence-b2-timezone-coordinates-first

Current source — [apps/api/src/services/timezone\.ts](../../../../../apps/api/src/services/timezone.ts#L150), lines 150–172.

<a id="evidence-evidence-b2-onboarding-zone-derived"></a>
## evidence-b2-onboarding-zone-derived

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L170), lines 170–170.

<a id="evidence-evidence-b2-onboarding-zone-readonly"></a>
## evidence-b2-onboarding-zone-readonly

Current source — [apps/web/src/components/Onboarding\.tsx](../../../../../apps/web/src/components/Onboarding.tsx#L568), lines 568–568.

<a id="evidence-evidence-b2-engine-luxon-instant"></a>
## evidence-b2-engine-luxon-instant

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L345), lines 345–348.

<a id="evidence-evidence-b2-birth-time-required"></a>
## evidence-b2-birth-time-required

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L111), lines 111–111.

<a id="evidence-evidence-b2-engine-noon-not-stored"></a>
## evidence-b2-engine-noon-not-stored

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L906), lines 906–906.

<a id="evidence-evidence-b2-engine-unknown-suppression"></a>
## evidence-b2-engine-unknown-suppression

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L413), lines 413–426.

<a id="evidence-evidence-b2-engine-moon-aspects"></a>
## evidence-b2-engine-moon-aspects

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L838), lines 838–840.

<a id="evidence-evidence-b2-engine-approximate-qualification"></a>
## evidence-b2-engine-approximate-qualification

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L431), lines 431–447.

<a id="evidence-evidence-b2-engine-houses-condition"></a>
## evidence-b2-engine-houses-condition

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L786), lines 786–786.

<a id="evidence-evidence-b2-timezone-civil-qualifiers"></a>
## evidence-b2-timezone-civil-qualifiers

Current source — [apps/api/src/services/timezone\.ts](../../../../../apps/api/src/services/timezone.ts#L206), lines 206–223.

<a id="evidence-evidence-b2-tzdb-stable-year"></a>
## evidence-b2-tzdb-stable-year

Current source — [packages/shared/src/timezone\.ts](../../../../../packages/shared/src/timezone.ts#L24), lines 24–24.

<a id="evidence-evidence-b2-birth-command-qualifiers"></a>
## evidence-b2-birth-command-qualifiers

Current source — [apps/api/src/services/birth\-command\.ts](../../../../../apps/api/src/services/birth-command.ts#L158), lines 158–161.

<a id="evidence-evidence-b2-birth-calc-qualifiers"></a>
## evidence-b2-birth-calc-qualifiers

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L909), lines 909–910.

<a id="evidence-evidence-b2-engine-birth-instant-qualification"></a>
## evidence-b2-engine-birth-instant-qualification

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L460), lines 460–471.

<a id="evidence-evidence-b2-engine-birthplace-qualification"></a>
## evidence-b2-engine-birthplace-qualification

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L450), lines 450–459.

<a id="evidence-evidence-b2-timezone-near-boundary"></a>
## evidence-b2-timezone-near-boundary

Current source — [apps/api/src/services/timezone\.ts](../../../../../apps/api/src/services/timezone.ts#L186), lines 186–188.

<a id="evidence-evidence-b2-note-required"></a>
## evidence-b2-note-required

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L1000), lines 1000–1000.

<a id="evidence-evidence-b2-disclosure-representable"></a>
## evidence-b2-disclosure-representable

Current source — [packages/reading\-engine/src/claim\-support\.ts](../../../../../packages/reading-engine/src/claim-support.ts#L388), lines 388–388.

<a id="evidence-evidence-b2-note-unrepresentable-refusal"></a>
## evidence-b2-note-unrepresentable-refusal

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L1035), lines 1035–1036.

<a id="evidence-evidence-b2-context-ineligible"></a>
## evidence-b2-context-ineligible

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L738), lines 738–739.

<a id="evidence-evidence-b2-disclosure-stop-gap"></a>
## evidence-b2-disclosure-stop-gap

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L1029), lines 1029–1029.

<a id="evidence-evidence-b2-daily-stored-uncertainty"></a>
## evidence-b2-daily-stored-uncertainty

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L575), lines 575–578.

<a id="evidence-evidence-apps-calc-stub-server-ts"></a>
## evidence-apps-calc-stub-server-ts

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L95), lines 95–95.

<a id="evidence-evidence-b2-sweph-dependency"></a>
## evidence-b2-sweph-dependency

Current source — [apps/calc\-stub/package\.json](../../../../../apps/calc-stub/package.json#L22), lines 22–22.

<a id="evidence-evidence-b2-sweph-calc-ut"></a>
## evidence-b2-sweph-calc-ut

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L525), lines 525–525.

<a id="evidence-evidence-b2-sweph-houses-fallback"></a>
## evidence-b2-sweph-houses-fallback

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L562), lines 562–564.

<a id="evidence-evidence-b2-sweph-flag-refusal"></a>
## evidence-b2-sweph-flag-refusal

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L533), lines 533–533.

<a id="evidence-evidence-b2-ephemeris-coverage"></a>
## evidence-b2-ephemeris-coverage

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L775), lines 775–775.

<a id="evidence-evidence-b2-calc-route-calculate"></a>
## evidence-b2-calc-route-calculate

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L140), lines 140–141.

<a id="evidence-evidence-b2-calc-route-cycles"></a>
## evidence-b2-calc-route-cycles

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L176), lines 176–177.

<a id="evidence-evidence-b2-calc-route-daily-sky"></a>
## evidence-b2-calc-route-daily-sky

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L213), lines 213–214.

<a id="evidence-evidence-b2-calc-auth-token-enforced"></a>
## evidence-b2-calc-auth-token-enforced

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L63), lines 63–63.

<a id="evidence-evidence-b2-calc-auth-missing-production"></a>
## evidence-b2-calc-auth-missing-production

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L56), lines 56–58.

<a id="evidence-evidence-b2-calc-route-health"></a>
## evidence-b2-calc-route-health

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L98), lines 98–98.

<a id="evidence-evidence-b2-calc-route-engine"></a>
## evidence-b2-calc-route-engine

Current source — [apps/calc\-stub/src/server\.ts](../../../../../apps/calc-stub/src/server.ts#L125), lines 125–125.

<a id="evidence-evidence-b2-engine-tropical-geocentric"></a>
## evidence-b2-engine-tropical-geocentric

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L1006), lines 1006–1007.

<a id="evidence-evidence-b2-engine-positions"></a>
## evidence-b2-engine-positions

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L800), lines 800–800.

<a id="evidence-evidence-b2-engine-aspects"></a>
## evidence-b2-engine-aspects

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L841), lines 841–841.

<a id="evidence-evidence-b2-engine-uncertainty-report"></a>
## evidence-b2-engine-uncertainty-report

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L851), lines 851–851.

<a id="evidence-evidence-b2-engine-fingerprint"></a>
## evidence-b2-engine-fingerprint

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L891), lines 891–891.

<a id="evidence-evidence-b2-engine-chart-identity"></a>
## evidence-b2-engine-chart-identity

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L899), lines 899–902.

<a id="evidence-evidence-b2-engine-container-digest"></a>
## evidence-b2-engine-container-digest

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L53), lines 53–57.

<a id="evidence-evidence-b2-engine-tzdb-constant"></a>
## evidence-b2-engine-tzdb-constant

Current source — [apps/calc\-stub/src/engine\.ts](../../../../../apps/calc-stub/src/engine.ts#L42), lines 42–42.

<a id="evidence-evidence-b2-calc-dockerfile-env"></a>
## evidence-b2-calc-dockerfile-env

Current source — [apps/calc\-stub/Dockerfile](../../../../../apps/calc-stub/Dockerfile#L20), lines 20–24.

<a id="evidence-evidence-b2-fly-calc-env"></a>
## evidence-b2-fly-calc-env

Current source — [fly\.toml](../../../../../fly.toml#L12), lines 12–17.

<a id="evidence-evidence-b2-fly-calc-app"></a>
## evidence-b2-fly-calc-app

Current source — [fly\.toml](../../../../../fly.toml#L6), lines 6–10.

<a id="evidence-evidence-b2-fly-web-app"></a>
## evidence-b2-fly-web-app

Current source — [fly\.web\.toml](../../../../../fly.web.toml#L8), lines 8–16.

<a id="evidence-evidence-b2-wrangler-production-calc"></a>
## evidence-b2-wrangler-production-calc

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L333), lines 333–335.

<a id="evidence-evidence-b2-calc-client-bearer"></a>
## evidence-b2-calc-client-bearer

Current source — [apps/api/src/services/calc\-client\.ts](../../../../../apps/api/src/services/calc-client.ts#L105), lines 105–105.

<a id="evidence-evidence-b2-natal-time-eligibility"></a>
## evidence-b2-natal-time-eligibility

Current source — [apps/api/src/services/natal\-features\.ts](../../../../../apps/api/src/services/natal-features.ts#L120), lines 120–125.

<a id="evidence-evidence-b2-pattern-selection-features"></a>
## evidence-b2-pattern-selection-features

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1126), lines 1126–1134.

<a id="evidence-evidence-b2-daily-v1-cycles"></a>
## evidence-b2-daily-v1-cycles

Current source — [apps/api/src/services/generation\-command\.ts](../../../../../apps/api/src/services/generation-command.ts#L574), lines 574–574.

<a id="evidence-evidence-b2-daily-v2-cycles"></a>
## evidence-b2-daily-v2-cycles

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L613), lines 613–613.

<a id="evidence-evidence-b2-time-travel-cycles"></a>
## evidence-b2-time-travel-cycles

Current source — [apps/api/src/services/time\-travel\.ts](../../../../../apps/api/src/services/time-travel.ts#L287), lines 287–287.

<a id="evidence-evidence-b2-timing-stored-cycles"></a>
## evidence-b2-timing-stored-cycles

Current source — [apps/api/src/db/timing\.ts](../../../../../apps/api/src/db/timing.ts#L249), lines 249–251.

<a id="evidence-evidence-b2-daily-v2-daily-sky"></a>
## evidence-b2-daily-v2-daily-sky

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L641), lines 641–641.

<a id="evidence-evidence-b2-birth-calc-timeout"></a>
## evidence-b2-birth-calc-timeout

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L913), lines 913–913.

<a id="evidence-evidence-b2-calc-client-abort"></a>
## evidence-b2-calc-client-abort

Current source — [apps/api/src/services/calc\-client\.ts](../../../../../apps/api/src/services/calc-client.ts#L99), lines 99–99.

<a id="evidence-evidence-b2-birth-operational-bounds"></a>
## evidence-b2-birth-operational-bounds

Current source — [apps/api/src/services/birth\-operational\-config\.ts](../../../../../apps/api/src/services/birth-operational-config.ts#L7), lines 7–10.

<a id="evidence-evidence-b2-birth-budget-ledger"></a>
## evidence-b2-birth-budget-ledger

Current source — [apps/api/src/db/birth\-calc\-usage\.ts](../../../../../apps/api/src/db/birth-calc-usage.ts#L128), lines 128–133.

<a id="evidence-evidence-b2-birth-budget-retry-after"></a>
## evidence-b2-birth-budget-retry-after

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L791), lines 791–791.

<a id="evidence-evidence-b2-chart-snapshot-provenance"></a>
## evidence-b2-chart-snapshot-provenance

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L1089), lines 1089–1090.

<a id="evidence-evidence-b2-birth-calc-request"></a>
## evidence-b2-birth-calc-request

Current source — [apps/api/src/routes/birth\.ts](../../../../../apps/api/src/routes/birth.ts#L896), lines 896–906.

<a id="evidence-evidence-b2-cycle-request-fields"></a>
## evidence-b2-cycle-request-fields

Current source — [apps/api/src/services/cycle\-client\.ts](../../../../../apps/api/src/services/cycle-client.ts#L61), lines 61–78.

<a id="evidence-evidence-b2-daily-sky-request-fields"></a>
## evidence-b2-daily-sky-request-fields

Current source — [apps/api/src/services/daily\-sky\-client\.ts](../../../../../apps/api/src/services/daily-sky-client.ts#L112), lines 112–136.

<a id="evidence-evidence-b2-daily-sky-longitude-filter"></a>
## evidence-b2-daily-sky-longitude-filter

Current source — [apps/api/src/services/daily\-sky\-client\.ts](../../../../../apps/api/src/services/daily-sky-client.ts#L90), lines 90–96.

<a id="evidence-evidence-b2-daily-sky-cusp-filter"></a>
## evidence-b2-daily-sky-cusp-filter

Current source — [apps/api/src/services/daily\-sky\-client\.ts](../../../../../apps/api/src/services/daily-sky-client.ts#L107), lines 107–107.

<a id="evidence-evidence-b2-daily-calc-pins"></a>
## evidence-b2-daily-calc-pins

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L663), lines 663–684.

<a id="evidence-evidence-b2-daily-execute-cycles"></a>
## evidence-b2-daily-execute-cycles

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L461), lines 461–461.

<a id="evidence-evidence-b2-daily-execute-cycle-match"></a>
## evidence-b2-daily-execute-cycle-match

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L468), lines 468–474.

<a id="evidence-evidence-b2-daily-execute-sky"></a>
## evidence-b2-daily-execute-sky

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L523), lines 523–523.

<a id="evidence-evidence-b2-daily-execute-sky-match"></a>
## evidence-b2-daily-execute-sky-match

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L533), lines 533–538.

<a id="evidence-evidence-b3-today-put-route"></a>
## evidence-b3-today-put-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L238), lines 238–238.

<a id="evidence-evidence-apps-api-routes-readings-ts"></a>
## evidence-apps-api-routes-readings-ts

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L269), lines 269–269.

<a id="evidence-evidence-b3-today-first-open-entry"></a>
## evidence-b3-today-first-open-entry

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L270), lines 270–270.

<a id="evidence-evidence-b3-today-unconfirmed-zone"></a>
## evidence-b3-today-unconfirmed-zone

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L118), lines 118–118.

<a id="evidence-evidence-b3-today-unconfirmed-locale"></a>
## evidence-b3-today-unconfirmed-locale

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L125), lines 125–125.

<a id="evidence-evidence-b3-today-published-before-rollout"></a>
## evidence-b3-today-published-before-rollout

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L144), lines 144–152.

<a id="evidence-evidence-b3-today-pending-rollout-gate"></a>
## evidence-b3-today-pending-rollout-gate

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L165), lines 165–166.

<a id="evidence-evidence-b3-today-failed-rollout-gate"></a>
## evidence-b3-today-failed-rollout-gate

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L240), lines 240–247.

<a id="evidence-evidence-b3-today-reserve-rollout-gate"></a>
## evidence-b3-today-reserve-rollout-gate

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L362), lines 362–362.

<a id="evidence-evidence-b3-today-target-date"></a>
## evidence-b3-today-target-date

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L383), lines 383–383.

<a id="evidence-evidence-b3-first-open-reservation"></a>
## evidence-b3-first-open-reservation

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L391), lines 391–393.

<a id="evidence-evidence-b3-scheduled-reservation"></a>
## evidence-b3-scheduled-reservation

Current source — [apps/api/src/services/run\-reading\-scheduler\.ts](../../../../../apps/api/src/services/run-reading-scheduler.ts#L359), lines 359–361.

<a id="evidence-evidence-b3-user-day-reservation-guard"></a>
## evidence-b3-user-day-reservation-guard

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L331), lines 331–331.

<a id="evidence-evidence-b3-v2-command-pins"></a>
## evidence-b3-v2-command-pins

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L198), lines 198–204.

<a id="evidence-evidence-b3-v5-calculation-pin-digests"></a>
## evidence-b3-v5-calculation-pin-digests

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L98), lines 98–101.

<a id="evidence-evidence-b3-publisher-pin-versions"></a>
## evidence-b3-publisher-pin-versions

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L317), lines 317–320.

<a id="evidence-evidence-b3-v5-automatic-failure-codes"></a>
## evidence-b3-v5-automatic-failure-codes

Current source — [apps/api/src/services/generation\-failures\.ts](../../../../../apps/api/src/services/generation-failures.ts#L136), lines 136–137.

<a id="evidence-evidence-b3-replacement-reason-mapping"></a>
## evidence-b3-replacement-reason-mapping

Current source — [apps/api/src/services/generation\-failures\.ts](../../../../../apps/api/src/services/generation-failures.ts#L244), lines 244–247.

<a id="evidence-evidence-b3-scheduler-derived-reason"></a>
## evidence-b3-scheduler-derived-reason

Current source — [apps/api/src/services/run\-reading\-scheduler\.ts](../../../../../apps/api/src/services/run-reading-scheduler.ts#L162), lines 162–162.

<a id="evidence-evidence-b3-scheduler-reason-must-match"></a>
## evidence-b3-scheduler-reason-must-match

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L306), lines 306–306.

<a id="evidence-evidence-b3-scheduler-generation-cap"></a>
## evidence-b3-scheduler-generation-cap

Current source — [apps/api/src/db/reading\-scheduler\.ts](../../../../../apps/api/src/db/reading-scheduler.ts#L226), lines 226–226.

<a id="evidence-evidence-b3-replacement-day-window"></a>
## evidence-b3-replacement-day-window

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L348), lines 348–353.

<a id="evidence-evidence-b3-context-current-signals"></a>
## evidence-b3-context-current-signals

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L105), lines 105–105.

<a id="evidence-evidence-b3-prior-readings-v5-only"></a>
## evidence-b3-prior-readings-v5-only

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L255), lines 255–255.

<a id="evidence-evidence-b3-context-record-limits"></a>
## evidence-b3-context-record-limits

Current source — [packages/reading\-engine/src/constrained\-types\.ts](../../../../../packages/reading-engine/src/constrained-types.ts#L80), lines 80–83.

<a id="evidence-evidence-b3-context-expired-at-anchor"></a>
## evidence-b3-context-expired-at-anchor

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L674), lines 674–674.

<a id="evidence-evidence-b3-context-fresh-and-registered"></a>
## evidence-b3-context-fresh-and-registered

Current source — [packages/reading\-engine/src/eligibility\.ts](../../../../../packages/reading-engine/src/eligibility.ts#L134), lines 134–137.

<a id="evidence-evidence-b3-context-source-gate"></a>
## evidence-b3-context-source-gate

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L694), lines 694–694.

<a id="evidence-evidence-b3-context-use-intersection"></a>
## evidence-b3-context-use-intersection

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L701), lines 701–701.

<a id="evidence-evidence-b3-context-cap-and-budget"></a>
## evidence-b3-context-cap-and-budget

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L1102), lines 1102–1107.

<a id="evidence-evidence-b3-resonance-feedback-uses"></a>
## evidence-b3-resonance-feedback-uses

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L194), lines 194–194.

<a id="evidence-evidence-b3-feedback-source-usr12"></a>
## evidence-b3-feedback-source-usr12

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L33), lines 33–33.

<a id="evidence-evidence-b3-facts-from-calculation"></a>
## evidence-b3-facts-from-calculation

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L954), lines 954–955.

<a id="evidence-evidence-b3-rank-facts-call"></a>
## evidence-b3-rank-facts-call

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L991), lines 991–991.

<a id="evidence-evidence-b3-ranker-seen-recently-false"></a>
## evidence-b3-ranker-seen-recently-false

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L537), lines 537–537.

<a id="evidence-evidence-b3-categorical-compile-gate"></a>
## evidence-b3-categorical-compile-gate

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L212), lines 212–212.

<a id="evidence-evidence-b3-command-feedback-selection"></a>
## evidence-b3-command-feedback-selection

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L656), lines 656–656.

<a id="evidence-evidence-b3-feedback-flag-policy"></a>
## evidence-b3-feedback-flag-policy

Current source — [apps/api/src/services/reading\-feedback\-policy\.ts](../../../../../apps/api/src/services/reading-feedback-policy.ts#L13), lines 13–15.

<a id="evidence-evidence-b3-feedback-flag-read"></a>
## evidence-b3-feedback-flag-read

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L611), lines 611–611.

<a id="evidence-evidence-b3-publisher-pin-selection"></a>
## evidence-b3-publisher-pin-selection

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L691), lines 691–691.

<a id="evidence-evidence-b3-committed-prompt-pin"></a>
## evidence-b3-committed-prompt-pin

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L525), lines 525–525.

<a id="evidence-evidence-b3-categorical-unclear-and-use"></a>
## evidence-b3-categorical-unclear-and-use

Current source — [apps/api/src/services/reading\-feedback\-compiler\.ts](../../../../../apps/api/src/services/reading-feedback-compiler.ts#L14), lines 14–15.

<a id="evidence-evidence-b3-categorical-theme-required"></a>
## evidence-b3-categorical-theme-required

Current source — [apps/api/src/services/reading\-feedback\-compiler\.ts](../../../../../apps/api/src/services/reading-feedback-compiler.ts#L33), lines 33–33.

<a id="evidence-evidence-b3-feedback-targets-no-themes"></a>
## evidence-b3-feedback-targets-no-themes

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L260), lines 260–260.

<a id="evidence-evidence-b3-lane-then-score"></a>
## evidence-b3-lane-then-score

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L542), lines 542–543.

<a id="evidence-evidence-b3-selection-policy-1-3-0"></a>
## evidence-b3-selection-policy-1-3-0

Current source — [packages/reading\-engine/src/constrained\-types\.ts](../../../../../packages/reading-engine/src/constrained-types.ts#L59), lines 59–59.

<a id="evidence-evidence-b3-temporal-exactness"></a>
## evidence-b3-temporal-exactness

Current source — [packages/reading\-engine/src/ranking\.ts](../../../../../packages/reading-engine/src/ranking.ts#L200), lines 200–200.

<a id="evidence-evidence-b3-assembly-identity-v2"></a>
## evidence-b3-assembly-identity-v2

Current source — [packages/reading\-engine/src/identity\.ts](../../../../../packages/reading-engine/src/identity.ts#L41), lines 41–41.

<a id="evidence-evidence-b3-assembly-identity-envelope"></a>
## evidence-b3-assembly-identity-envelope

Current source — [packages/reading\-engine/src/identity\.ts](../../../../../packages/reading-engine/src/identity.ts#L81), lines 81–83.

<a id="evidence-evidence-b3-v2-codex-policy-guard"></a>
## evidence-b3-v2-codex-policy-guard

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L183), lines 183–186.

<a id="evidence-evidence-b3-publisher-provider-codex"></a>
## evidence-b3-publisher-provider-codex

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L50), lines 50–50.

<a id="evidence-evidence-b3-supported-policy-pairs"></a>
## evidence-b3-supported-policy-pairs

Current source — [apps/api/src/services/reading\-feedback\-policy\.ts](../../../../../apps/api/src/services/reading-feedback-policy.ts#L19), lines 19–20.

<a id="evidence-evidence-b3-v2-policy-unsupported"></a>
## evidence-b3-v2-policy-unsupported

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L414), lines 414–414.

<a id="evidence-evidence-b3-v1-identity-guard"></a>
## evidence-b3-v1-identity-guard

Current source — [apps/api/src/services/generate\-daily\-reading\.ts](../../../../../apps/api/src/services/generate-daily-reading.ts#L314), lines 314–314.

<a id="evidence-evidence-b3-codex-publish"></a>
## evidence-b3-codex-publish

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L656), lines 656–656.

<a id="evidence-evidence-apps-api-services-generate-daily-reading-v5-ts"></a>
## evidence-apps-api-services-generate-daily-reading-v5-ts

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L720), lines 720–720.

<a id="evidence-evidence-b3-validate-candidate-reject"></a>
## evidence-b3-validate-candidate-reject

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L723), lines 723–725.

<a id="evidence-evidence-b3-references-and-lanes"></a>
## evidence-b3-references-and-lanes

Current source — [packages/reading\-engine/src/candidate\-validation\.ts](../../../../../packages/reading-engine/src/candidate-validation.ts#L370), lines 370–378.

<a id="evidence-evidence-b3-fact-support-check"></a>
## evidence-b3-fact-support-check

Current source — [packages/reading\-engine/src/candidate\-validation\.ts](../../../../../packages/reading-engine/src/candidate-validation.ts#L405), lines 405–405.

<a id="evidence-evidence-b3-uncertainty-note-check"></a>
## evidence-b3-uncertainty-note-check

Current source — [packages/reading\-engine/src/candidate\-validation\.ts](../../../../../packages/reading-engine/src/candidate-validation.ts#L410), lines 410–419.

<a id="evidence-evidence-b3-content-rules"></a>
## evidence-b3-content-rules

Current source — [packages/reading\-engine/src/candidate\-validation\.ts](../../../../../packages/reading-engine/src/candidate-validation.ts#L430), lines 430–437.

<a id="evidence-evidence-b3-disclosure-refusal"></a>
## evidence-b3-disclosure-refusal

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L1036), lines 1036–1036.

<a id="evidence-evidence-b3-first-consent-check"></a>
## evidence-b3-first-consent-check

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L419), lines 419–427.

<a id="evidence-evidence-b3-input-hashes-then-recheck"></a>
## evidence-b3-input-hashes-then-recheck

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L605), lines 605–621.

<a id="evidence-evidence-b3-publisher-pending-release"></a>
## evidence-b3-publisher-pending-release

Current source — [apps/api/src/queue\.ts](../../../../../apps/api/src/queue.ts#L346), lines 346–346.

<a id="evidence-evidence-b3-budget-at-runner-claim"></a>
## evidence-b3-budget-at-runner-claim

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L373), lines 373–373.

<a id="evidence-evidence-b3-runner-completion-nudge"></a>
## evidence-b3-runner-completion-nudge

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L555), lines 555–556.

<a id="evidence-evidence-b3-adopt-completed-candidate"></a>
## evidence-b3-adopt-completed-candidate

Current source — [apps/api/src/services/codex\-reading\-publisher\.ts](../../../../../apps/api/src/services/codex-reading-publisher.ts#L239), lines 239–239.

<a id="evidence-evidence-b3-seal-reading"></a>
## evidence-b3-seal-reading

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L819), lines 819–819.

<a id="evidence-evidence-apps-api-services-generate-daily-reading-v5-ts-2"></a>
## evidence-apps-api-services-generate-daily-reading-v5-ts-2

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L854), lines 854–854.

<a id="evidence-evidence-b3-publication-claim-assertion"></a>
## evidence-b3-publication-claim-assertion

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L1458), lines 1458–1458.

<a id="evidence-evidence-b3-paragraph-evidence-refs"></a>
## evidence-b3-paragraph-evidence-refs

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L760), lines 760–761.

<a id="evidence-evidence-b3-reading-sources-insert"></a>
## evidence-b3-reading-sources-insert

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L1530), lines 1530–1530.

<a id="evidence-evidence-b3-receipt-in-batch"></a>
## evidence-b3-receipt-in-batch

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L1553), lines 1553–1553.

<a id="evidence-evidence-apps-api-routes-readings-ts-2"></a>
## evidence-apps-api-routes-readings-ts-2

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L521), lines 521–521.

<a id="evidence-evidence-b3-reading-by-id-route"></a>
## evidence-b3-reading-by-id-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L543), lines 543–543.

<a id="evidence-evidence-b3-reading-evidence-route"></a>
## evidence-b3-reading-evidence-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L554), lines 554–554.

<a id="evidence-evidence-reading-feedback-write"></a>
## evidence-reading-feedback-write

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L606), lines 606–606.

<a id="evidence-evidence-b3-reading-save-route"></a>
## evidence-b3-reading-save-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L672), lines 672–672.

<a id="evidence-evidence-b3-dispatch-by-command"></a>
## evidence-b3-dispatch-by-command

Current source — [apps/api/src/services/generate\-daily\-reading\.ts](../../../../../apps/api/src/services/generate-daily-reading.ts#L254), lines 254–257.

<a id="evidence-evidence-b3-rollout-off-pause-guard"></a>
## evidence-b3-rollout-off-pause-guard

Current source — [apps/api/src/queue\.ts](../../../../../apps/api/src/queue.ts#L293), lines 293–296.

<a id="evidence-evidence-b3-v3-reading-projection"></a>
## evidence-b3-v3-reading-projection

Current source — [apps/api/src/services/reading\-product\-projection\.ts](../../../../../apps/api/src/services/reading-product-projection.ts#L70), lines 70–71.

<a id="evidence-evidence-b3-v3-evidence-projection"></a>
## evidence-b3-v3-evidence-projection

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L235), lines 235–235.

<a id="evidence-evidence-b3-today-deterministic-terminal"></a>
## evidence-b3-today-deterministic-terminal

Current source — [apps/api/src/services/ensure\-today\-reading\.ts](../../../../../apps/api/src/services/ensure-today-reading.ts#L158), lines 158–158.

<a id="evidence-evidence-b3-quality-codes"></a>
## evidence-b3-quality-codes

Current source — [apps/api/src/services/reading\-quality\.ts](../../../../../apps/api/src/services/reading-quality.ts#L22), lines 22–30.

<a id="evidence-evidence-b3-quality-at-publication"></a>
## evidence-b3-quality-at-publication

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L890), lines 890–890.

<a id="evidence-evidence-b3-quality-receipt-json"></a>
## evidence-b3-quality-receipt-json

Current source — [apps/api/src/db/daily\-publication\-receipts\.ts](../../../../../apps/api/src/db/daily-publication-receipts.ts#L92), lines 92–92.

<a id="evidence-evidence-b3-migration-0034"></a>
## evidence-b3-migration-0034

Current source — [db/d1/0034\_daily\_reading\_quality\_observations\.sql](../../../../../db/d1/0034_daily_reading_quality_observations.sql#L15), lines 15–15.

<a id="evidence-evidence-b3-feedback-options-route"></a>
## evidence-b3-feedback-options-route

Current source — [apps/api/src/routes/feedback\-events\.ts](../../../../../apps/api/src/routes/feedback-events.ts#L13), lines 13–13.

<a id="evidence-evidence-b3-feedback-options-body"></a>
## evidence-b3-feedback-options-body

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L216), lines 216–223.

<a id="evidence-evidence-b3-feedback-events-route"></a>
## evidence-b3-feedback-events-route

Current source — [apps/api/src/routes/feedback\-events\.ts](../../../../../apps/api/src/routes/feedback-events.ts#L27), lines 27–27.

<a id="evidence-evidence-b3-feedback-idempotency"></a>
## evidence-b3-feedback-idempotency

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L265), lines 265–265.

<a id="evidence-evidence-b3-feedback-confirm-use"></a>
## evidence-b3-feedback-confirm-use

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L54), lines 54–54.

<a id="evidence-evidence-b3-feedback-tag-check"></a>
## evidence-b3-feedback-tag-check

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L271), lines 271–271.

<a id="evidence-evidence-b3-feedback-use-changed-409"></a>
## evidence-b3-feedback-use-changed-409

Current source — [apps/api/src/routes/feedback\-events\.ts](../../../../../apps/api/src/routes/feedback-events.ts#L35), lines 35–36.

<a id="evidence-evidence-b3-feedback-note-in-request"></a>
## evidence-b3-feedback-note-in-request

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L59), lines 59–59.

<a id="evidence-evidence-b3-feedback-event-payload"></a>
## evidence-b3-feedback-event-payload

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L288), lines 288–290.

<a id="evidence-evidence-b3-feedback-event-insert"></a>
## evidence-b3-feedback-event-insert

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L316), lines 316–318.

<a id="evidence-evidence-b3-migration-0031"></a>
## evidence-b3-migration-0031

Current source — [db/d1/0031\_reading\_feedback\_events\.sql](../../../../../db/d1/0031_reading_feedback_events.sql#L4), lines 4–4.

<a id="evidence-evidence-b3-feedback-grant-insert"></a>
## evidence-b3-feedback-grant-insert

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L305), lines 305–305.

<a id="evidence-evidence-b3-feedback-batch-probes"></a>
## evidence-b3-feedback-batch-probes

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L295), lines 295–297.

<a id="evidence-evidence-b3-feedback-window-constants"></a>
## evidence-b3-feedback-window-constants

Current source — [packages/shared/src/reading\-feedback\-types\.ts](../../../../../packages/shared/src/reading-feedback-types.ts#L3), lines 3–4.

<a id="evidence-evidence-b3-feedback-effect-expiry"></a>
## evidence-b3-feedback-effect-expiry

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L282), lines 282–283.

<a id="evidence-evidence-b3-feedback-signal-value"></a>
## evidence-b3-feedback-signal-value

Current source — [apps/api/src/services/reading\-feedback\-compiler\.ts](../../../../../apps/api/src/services/reading-feedback-compiler.ts#L34), lines 34–40.

<a id="evidence-evidence-b3-feedback-target-alias"></a>
## evidence-b3-feedback-target-alias

Current source — [packages/reading\-engine/src/constrained\-input\.ts](../../../../../packages/reading-engine/src/constrained-input.ts#L898), lines 898–898.

<a id="evidence-evidence-b3-resonance-feedback-select"></a>
## evidence-b3-resonance-feedback-select

Current source — [apps/api/src/services/context\-compiler\.ts](../../../../../apps/api/src/services/context-compiler.ts#L180), lines 180–181.

<a id="evidence-evidence-b3-feedback-execution-recheck"></a>
## evidence-b3-feedback-execution-recheck

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L240), lines 240–240.

<a id="evidence-evidence-b3-feedback-runner-recheck"></a>
## evidence-b3-feedback-runner-recheck

Current source — [apps/api/src/services/reading\-current\-owner\.ts](../../../../../apps/api/src/services/reading-current-owner.ts#L165), lines 165–165.

<a id="evidence-evidence-b3-feedback-publication-guard"></a>
## evidence-b3-feedback-publication-guard

Current source — [apps/api/src/db/reading\-feedback\-publication\.ts](../../../../../apps/api/src/db/reading-feedback-publication.ts#L46), lines 46–46.

<a id="evidence-evidence-b3-feedback-guards-in-batch"></a>
## evidence-b3-feedback-guards-in-batch

Current source — [apps/api/src/db/generation\.ts](../../../../../apps/api/src/db/generation.ts#L1450), lines 1450–1450.

<a id="evidence-evidence-b4-execute-frozen-ontology"></a>
## evidence-b4-execute-frozen-ontology

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1107), lines 1107–1108.

<a id="evidence-evidence-b4-execute-feature-set"></a>
## evidence-b4-execute-feature-set

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1117), lines 1117–1118.

<a id="evidence-evidence-b4-natal-feature-derivation"></a>
## evidence-b4-natal-feature-derivation

Current source — [apps/api/src/db/natal\-features\.ts](../../../../../apps/api/src/db/natal-features.ts#L121), lines 121–121.

<a id="evidence-evidence-apps-api-services-pattern-execute-ts"></a>
## evidence-apps-api-services-pattern-execute-ts

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1126), lines 1126–1126.

<a id="evidence-evidence-b4-execute-planner-input"></a>
## evidence-b4-execute-planner-input

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1247), lines 1247–1247.

<a id="evidence-evidence-b4-selection-unsupported"></a>
## evidence-b4-selection-unsupported

Current source — [packages/pattern\-engine/src/selection\.ts](../../../../../packages/pattern-engine/src/selection.ts#L219), lines 219–219.

<a id="evidence-evidence-b4-selection-mandatory"></a>
## evidence-b4-selection-mandatory

Current source — [packages/pattern\-engine/src/selection\.ts](../../../../../packages/pattern-engine/src/selection.ts#L237), lines 237–237.

<a id="evidence-evidence-b4-selection-ranking"></a>
## evidence-b4-selection-ranking

Current source — [packages/pattern\-engine/src/selection\.ts](../../../../../packages/pattern-engine/src/selection.ts#L232), lines 232–233.

<a id="evidence-evidence-b4-selection-bound"></a>
## evidence-b4-selection-bound

Current source — [packages/pattern\-engine/src/selection\.ts](../../../../../packages/pattern-engine/src/selection.ts#L256), lines 256–256.

<a id="evidence-evidence-b4-enqueue-command-pins"></a>
## evidence-b4-enqueue-command-pins

Current source — [apps/api/src/services/pattern\-enqueue\.ts](../../../../../apps/api/src/services/pattern-enqueue.ts#L354), lines 354–373.

<a id="evidence-evidence-b4-execute-source-gate"></a>
## evidence-b4-execute-source-gate

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L841), lines 841–841.

<a id="evidence-evidence-b4-execute-consent-gate"></a>
## evidence-b4-execute-consent-gate

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L847), lines 847–847.

<a id="evidence-evidence-b4-execute-chart-gate"></a>
## evidence-b4-execute-chart-gate

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L853), lines 853–853.

<a id="evidence-evidence-b4-execute-claim-owner"></a>
## evidence-b4-execute-claim-owner

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L888), lines 888–888.

<a id="evidence-evidence-b4-execute-claim-stage"></a>
## evidence-b4-execute-claim-stage

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1042), lines 1042–1042.

<a id="evidence-evidence-b4-enqueue-attempt-caps"></a>
## evidence-b4-enqueue-attempt-caps

Current source — [apps/api/src/services/pattern\-enqueue\.ts](../../../../../apps/api/src/services/pattern-enqueue.ts#L374), lines 374–376.

<a id="evidence-evidence-b4-execute-plan-retry"></a>
## evidence-b4-execute-plan-retry

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1293), lines 1293–1305.

<a id="evidence-evidence-b4-execute-deterministic-correction"></a>
## evidence-b4-execute-deterministic-correction

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1444), lines 1444–1444.

<a id="evidence-evidence-b4-execute-semantic-correction"></a>
## evidence-b4-execute-semantic-correction

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1628), lines 1628–1628.

<a id="evidence-evidence-b4-execute-safety-correction"></a>
## evidence-b4-execute-safety-correction

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1704), lines 1704–1705.

<a id="evidence-evidence-apps-api-services-pattern-execute-ts-2"></a>
## evidence-apps-api-services-pattern-execute-ts-2

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1284), lines 1284–1284.

<a id="evidence-evidence-apps-api-services-pattern-execute-ts-7"></a>
## evidence-apps-api-services-pattern-execute-ts-7

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1426), lines 1426–1426.

<a id="evidence-evidence-b4-execute-publication-proof"></a>
## evidence-b4-execute-publication-proof

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1678), lines 1678–1678.

<a id="evidence-evidence-b4-proof-verdict-read"></a>
## evidence-b4-proof-verdict-read

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L140), lines 140–143.

<a id="evidence-evidence-b4-proof-hash-recompute"></a>
## evidence-b4-proof-hash-recompute

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L153), lines 153–179.

<a id="evidence-evidence-b4-stage-publish-verdict-hash"></a>
## evidence-b4-stage-publish-verdict-hash

Current source — [apps/api/src/services/pattern\-stage\-protocol\.ts](../../../../../apps/api/src/services/pattern-stage-protocol.ts#L310), lines 310–310.

<a id="evidence-evidence-b4-projection-text-only"></a>
## evidence-b4-projection-text-only

Current source — [packages/pattern\-engine/src/projection\.ts](../../../../../packages/pattern-engine/src/projection.ts#L21), lines 21–21.

<a id="evidence-evidence-b4-proof-safety"></a>
## evidence-b4-proof-safety

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L203), lines 203–204.

<a id="evidence-evidence-b4-safety-failure-codes"></a>
## evidence-b4-safety-failure-codes

Current source — [apps/api/src/services/pattern\-publication\-safety\.ts](../../../../../apps/api/src/services/pattern-publication-safety.ts#L16), lines 16–23.

<a id="evidence-evidence-b4-proof-safety-refusal"></a>
## evidence-b4-proof-safety-refusal

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L211), lines 211–211.

<a id="evidence-evidence-b4-execute-authorization-guard"></a>
## evidence-b4-execute-authorization-guard

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1931), lines 1931–1931.

<a id="evidence-evidence-b4-proof-authorization-account"></a>
## evidence-b4-proof-authorization-account

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L302), lines 302–305.

<a id="evidence-evidence-b4-proof-authorization-consent-claim"></a>
## evidence-b4-proof-authorization-consent-claim

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L321), lines 321–338.

<a id="evidence-evidence-b4-execute-document-encryption"></a>
## evidence-b4-execute-document-encryption

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1807), lines 1807–1807.

<a id="evidence-evidence-apps-api-routes-pattern-ts"></a>
## evidence-apps-api-routes-pattern-ts

Current source — [apps/api/src/routes/pattern\.ts](../../../../../apps/api/src/routes/pattern.ts#L19), lines 19–19.

<a id="evidence-evidence-b4-state-decrypt-project"></a>
## evidence-b4-state-decrypt-project

Current source — [apps/api/src/services/pattern\-state\.ts](../../../../../apps/api/src/services/pattern-state.ts#L128), lines 128–129.

<a id="evidence-evidence-b4-read-recalled"></a>
## evidence-b4-read-recalled

Current source — [apps/api/src/routes/pattern\-ai\.ts](../../../../../apps/api/src/routes/pattern-ai.ts#L227), lines 227–227.

<a id="evidence-evidence-b4-read-claim-refusals"></a>
## evidence-b4-read-claim-refusals

Current source — [apps/api/src/routes/pattern\-ai\.ts](../../../../../apps/api/src/routes/pattern-ai.ts#L233), lines 233–240.

<a id="evidence-evidence-b4-read-failed-refusal"></a>
## evidence-b4-read-failed-refusal

Current source — [apps/api/src/routes/pattern\-ai\.ts](../../../../../apps/api/src/routes/pattern-ai.ts#L265), lines 265–265.

<a id="evidence-evidence-b4-claims-unique"></a>
## evidence-b4-claims-unique

Current source — [db/d1/0007\_ai\_generated\_pattern\.sql](../../../../../db/d1/0007_ai_generated_pattern.sql#L181), lines 181–181.

<a id="evidence-evidence-b4-claims-accept"></a>
## evidence-b4-claims-accept

Current source — [apps/api/src/db/pattern\-claim\-transitions\.ts](../../../../../apps/api/src/db/pattern-claim-transitions.ts#L142), lines 142–143.

<a id="evidence-evidence-b4-claims-terminal"></a>
## evidence-b4-claims-terminal

Current source — [apps/api/src/db/pattern\-claim\-transitions\.ts](../../../../../apps/api/src/db/pattern-claim-transitions.ts#L164), lines 164–164.

<a id="evidence-evidence-b4-delete-route"></a>
## evidence-b4-delete-route

Current source — [apps/api/src/routes/pattern\-ai\.ts](../../../../../apps/api/src/routes/pattern-ai.ts#L190), lines 190–190.

<a id="evidence-evidence-b4-delete-erasure"></a>
## evidence-b4-delete-erasure

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L147), lines 147–158.

<a id="evidence-evidence-b4-state-regeneration-eligibility"></a>
## evidence-b4-state-regeneration-eligibility

Current source — [apps/api/src/services/pattern\-state\.ts](../../../../../apps/api/src/services/pattern-state.ts#L244), lines 244–253.

<a id="evidence-evidence-b4-state-regeneration-in-flight"></a>
## evidence-b4-state-regeneration-in-flight

Current source — [apps/api/src/services/pattern\-state\.ts](../../../../../apps/api/src/services/pattern-state.ts#L276), lines 276–279.

<a id="evidence-evidence-b4-regenerate-confirm"></a>
## evidence-b4-regenerate-confirm

Current source — [apps/api/src/routes/pattern\-ai\.ts](../../../../../apps/api/src/routes/pattern-ai.ts#L110), lines 110–110.

<a id="evidence-evidence-b4-claims-pending-regeneration"></a>
## evidence-b4-claims-pending-regeneration

Current source — [apps/api/src/db/pattern\-claim\-transitions\.ts](../../../../../apps/api/src/db/pattern-claim-transitions.ts#L108), lines 108–108.

<a id="evidence-evidence-b4-web-regeneration-progress"></a>
## evidence-b4-web-regeneration-progress

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L116), lines 116–116.

<a id="evidence-evidence-b4-web-regeneration-gate"></a>
## evidence-b4-web-regeneration-gate

Current source — [apps/web/src/components/PatternExperience\.tsx](../../../../../apps/web/src/components/PatternExperience.tsx#L548), lines 548–548.

<a id="evidence-evidence-b4-builder-corpus-input"></a>
## evidence-b4-builder-corpus-input

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L121), lines 121–130.

<a id="evidence-evidence-b4-prepare-corpus-cli"></a>
## evidence-b4-prepare-corpus-cli

Current source — [apps/api/scripts/prepare\-ontology\-corpus\.ts](../../../../../apps/api/scripts/prepare-ontology-corpus.ts#L149), lines 149–149.

<a id="evidence-evidence-b4-builder-corpus-hash-copy"></a>
## evidence-b4-builder-corpus-hash-copy

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L187), lines 187–187.

<a id="evidence-evidence-b4-builder-contract"></a>
## evidence-b4-builder-contract

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L2), lines 2–3.

<a id="evidence-evidence-b4-builder-record-shape"></a>
## evidence-b4-builder-record-shape

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L145), lines 145–149.

<a id="evidence-evidence-b4-builder-origin"></a>
## evidence-b4-builder-origin

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L212), lines 212–212.

<a id="evidence-evidence-b4-builder-version"></a>
## evidence-b4-builder-version

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L28), lines 28–28.

<a id="evidence-evidence-b4-builder-yield"></a>
## evidence-b4-builder-yield

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L8), lines 8–13.

<a id="evidence-evidence-b4-builder-stellium"></a>
## evidence-b4-builder-stellium

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L72), lines 72–72.

<a id="evidence-evidence-b4-builder-exact-time"></a>
## evidence-b4-builder-exact-time

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L177), lines 177–178.

<a id="evidence-evidence-b4-builder-counter-marker"></a>
## evidence-b4-builder-counter-marker

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L97), lines 97–97.

<a id="evidence-evidence-b4-builder-compile-gate"></a>
## evidence-b4-builder-compile-gate

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L217), lines 217–223.

<a id="evidence-evidence-b4-builder-evaluation-fields"></a>
## evidence-b4-builder-evaluation-fields

Current source — [apps/api/scripts/build\-internal\-ontology\.ts](../../../../../apps/api/scripts/build-internal-ontology.ts#L204), lines 204–209.

<a id="evidence-evidence-b4-corpus-human-review"></a>
## evidence-b4-corpus-human-review

Current source — [pattern\-corpus/provenance\.json](../../../../../pattern-corpus/provenance.json#L49), lines 49–53.

<a id="evidence-evidence-b4-sign-origin"></a>
## evidence-b4-sign-origin

Current source — [apps/api/src/services/ontology\-signing\-client\.ts](../../../../../apps/api/src/services/ontology-signing-client.ts#L138), lines 138–138.

<a id="evidence-evidence-b4-sign-route-return"></a>
## evidence-b4-sign-route-return

Current source — [apps/api/src/routes/internal\-pattern\.ts](../../../../../apps/api/src/routes/internal-pattern.ts#L117), lines 117–117.

<a id="evidence-evidence-b4-internal-store"></a>
## evidence-b4-internal-store

Current source — [apps/api/src/routes/internal\-pattern\.ts](../../../../../apps/api/src/routes/internal-pattern.ts#L245), lines 245–250.

<a id="evidence-evidence-b4-ontology-pointer-update"></a>
## evidence-b4-ontology-pointer-update

Current source — [apps/api/src/db/pattern\-ontology\.ts](../../../../../apps/api/src/db/pattern-ontology.ts#L646), lines 646–647.

<a id="evidence-evidence-b4-ontology-internal-origin"></a>
## evidence-b4-ontology-internal-origin

Current source — [apps/api/src/db/pattern\-ontology\.ts](../../../../../apps/api/src/db/pattern-ontology.ts#L259), lines 259–259.

<a id="evidence-evidence-b4-sign-quality-limit"></a>
## evidence-b4-sign-quality-limit

Current source — [apps/api/src/services/ontology\-signing\-client\.ts](../../../../../apps/api/src/services/ontology-signing-client.ts#L128), lines 128–128.

<a id="evidence-evidence-b4-recorded-ontology-pointer-join"></a>
## evidence-b4-recorded-ontology-pointer-join

Recorded observation: 2026-09-06T18:49:35.205Z — [docs/reviews/artifacts/2026\-09\-06\-source\-register\-followup/production\-observation\.json](../../../../../docs/reviews/artifacts/2026-09-06-source-register-followup/production-observation.json#L148), lines 148–152.

<a id="evidence-evidence-b4-pipeline-registered-corpus"></a>
## evidence-b4-pipeline-registered-corpus

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L534), lines 534–537.

<a id="evidence-evidence-b4-pipeline-stage-graph"></a>
## evidence-b4-pipeline-stage-graph

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L3159), lines 3159–3183.

<a id="evidence-evidence-b4-pipeline-isolated-signer"></a>
## evidence-b4-pipeline-isolated-signer

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L2947), lines 2947–2947.

<a id="evidence-evidence-b4-pipeline-rollout-gate"></a>
## evidence-b4-pipeline-rollout-gate

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L3125), lines 3125–3125.

<a id="evidence-evidence-b4-pipeline-command-gate"></a>
## evidence-b4-pipeline-command-gate

Current source — [apps/api/src/services/ontology\-pipeline\-command\.ts](../../../../../apps/api/src/services/ontology-pipeline-command.ts#L204), lines 204–204.

<a id="evidence-evidence-apps-api-wrangler-toml"></a>
## evidence-apps-api-wrangler-toml

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L495), lines 495–496.

<a id="evidence-evidence-b4-pipeline-ingest-activate"></a>
## evidence-b4-pipeline-ingest-activate

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L3054), lines 3054–3055.

<a id="evidence-evidence-b4-ontology-supersede"></a>
## evidence-b4-ontology-supersede

Current source — [apps/api/src/db/pattern\-ontology\.ts](../../../../../apps/api/src/db/pattern-ontology.ts#L633), lines 633–633.

<a id="evidence-evidence-b4-lifecycle-recall-scope"></a>
## evidence-b4-lifecycle-recall-scope

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L437), lines 437–437.

<a id="evidence-evidence-b4-lifecycle-machine-recall"></a>
## evidence-b4-lifecycle-machine-recall

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L451), lines 451–455.

<a id="evidence-evidence-b4-lifecycle-withdraw-documents"></a>
## evidence-b4-lifecycle-withdraw-documents

Current source — [apps/api/src/services/pattern\-lifecycle\.ts](../../../../../apps/api/src/services/pattern-lifecycle.ts#L358), lines 358–358.

<a id="evidence-evidence-b4-ontology-machine-scope"></a>
## evidence-b4-ontology-machine-scope

Current source — [apps/api/src/db/pattern\-ontology\.ts](../../../../../apps/api/src/db/pattern-ontology.ts#L255), lines 255–255.

<a id="evidence-evidence-b4-ontology-licensed-excerpt"></a>
## evidence-b4-ontology-licensed-excerpt

Current source — [apps/api/src/db/pattern\-ontology\.ts](../../../../../apps/api/src/db/pattern-ontology.ts#L35), lines 35–36.

<a id="evidence-evidence-b4-enqueue-ontology-gate"></a>
## evidence-b4-enqueue-ontology-gate

Current source — [apps/api/src/services/pattern\-enqueue\.ts](../../../../../apps/api/src/services/pattern-enqueue.ts#L196), lines 196–196.

<a id="evidence-evidence-b4-enqueue-pause-gate"></a>
## evidence-b4-enqueue-pause-gate

Current source — [apps/api/src/services/pattern\-enqueue\.ts](../../../../../apps/api/src/services/pattern-enqueue.ts#L168), lines 168–168.

<a id="evidence-evidence-b4-validator-provenance"></a>
## evidence-b4-validator-provenance

Current source — [pattern\-corpus/validate\-fragments\.mjs](../../../../../pattern-corpus/validate-fragments.mjs#L58), lines 58–58.

<a id="evidence-evidence-b4-provenance-origin-check"></a>
## evidence-b4-provenance-origin-check

Current source — [pattern\-corpus/provenance\.mjs](../../../../../pattern-corpus/provenance.mjs#L25), lines 25–25.

<a id="evidence-evidence-b4-provenance-rights-hash"></a>
## evidence-b4-provenance-rights-hash

Current source — [pattern\-corpus/provenance\.mjs](../../../../../pattern-corpus/provenance.mjs#L28), lines 28–28.

<a id="evidence-evidence-b4-provenance-fragment-hash"></a>
## evidence-b4-provenance-fragment-hash

Current source — [pattern\-corpus/provenance\.mjs](../../../../../pattern-corpus/provenance.mjs#L49), lines 49–49.

<a id="evidence-evidence-b4-review-signature"></a>
## evidence-b4-review-signature

Current source — [pattern\-corpus/review\.mjs](../../../../../pattern-corpus/review.mjs#L127), lines 127–127.

<a id="evidence-evidence-b4-review-enrollment"></a>
## evidence-b4-review-enrollment

Current source — [pattern\-corpus/review\.mjs](../../../../../pattern-corpus/review.mjs#L89), lines 89–89.

<a id="evidence-evidence-pattern-corpus-readme-md"></a>
## evidence-pattern-corpus-readme-md

Current source — [pattern\-corpus/README\.md](../../../../../pattern-corpus/README.md#L3), lines 3–3.

<a id="evidence-evidence-b4-provenance-generation"></a>
## evidence-b4-provenance-generation

Current source — [pattern\-corpus/provenance\.json](../../../../../pattern-corpus/provenance.json#L16), lines 16–37.

<a id="evidence-evidence-pattern-corpus-reviewers-json"></a>
## evidence-pattern-corpus-reviewers-json

Current source — [pattern\-corpus/reviewers\.json](../../../../../pattern-corpus/reviewers.json#L3), lines 3–3.

<a id="evidence-evidence-b4-provenance-outstanding"></a>
## evidence-b4-provenance-outstanding

Current source — [pattern\-corpus/provenance\.json](../../../../../pattern-corpus/provenance.json#L56), lines 56–62.

<a id="evidence-evidence-b4-readme-rights-authorship"></a>
## evidence-b4-readme-rights-authorship

Current source — [pattern\-corpus/README\.md](../../../../../pattern-corpus/README.md#L4), lines 4–6.

<a id="evidence-evidence-b4-readme-no-activation"></a>
## evidence-b4-readme-no-activation

Current source — [pattern\-corpus/README\.md](../../../../../pattern-corpus/README.md#L33), lines 33–33.

<a id="evidence-evidence-b4-review-operator-attested"></a>
## evidence-b4-review-operator-attested

Current source — [pattern\-corpus/review\.mjs](../../../../../pattern-corpus/review.mjs#L222), lines 222–222.

<a id="evidence-evidence-b4-decision-source-supported"></a>
## evidence-b4-decision-source-supported

Current source — [pattern\-corpus/ONTOLOGY\_CORPUS\_LICENSE\_CLASS\_DECISION\.md](../../../../../pattern-corpus/ONTOLOGY_CORPUS_LICENSE_CLASS_DECISION.md#L76), lines 76–76.

<a id="evidence-evidence-b4-corpus-public-capable"></a>
## evidence-b4-corpus-public-capable

Current source — [apps/api/src/services/ontology\-corpus\.ts](../../../../../apps/api/src/services/ontology-corpus.ts#L170), lines 170–170.

<a id="evidence-evidence-b4-safety-source-supported"></a>
## evidence-b4-safety-source-supported

Current source — [apps/api/src/services/pattern\-publication\-safety\.ts](../../../../../apps/api/src/services/pattern-publication-safety.ts#L195), lines 195–196.

<a id="evidence-evidence-b4-execute-registered-fragments"></a>
## evidence-b4-execute-registered-fragments

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1669), lines 1669–1669.

<a id="evidence-evidence-b4-admin-mount"></a>
## evidence-b4-admin-mount

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L121), lines 121–121.

<a id="evidence-evidence-b4-admin-diagnostics-route"></a>
## evidence-b4-admin-diagnostics-route

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L102), lines 102–102.

<a id="evidence-evidence-b4-diagnostics-columns"></a>
## evidence-b4-diagnostics-columns

Current source — [apps/api/src/services/pattern\-diagnostics\.ts](../../../../../apps/api/src/services/pattern-diagnostics.ts#L22), lines 22–27.

<a id="evidence-evidence-b4-diagnostics-closed"></a>
## evidence-b4-diagnostics-closed

Current source — [apps/api/src/services/pattern\-diagnostics\.ts](../../../../../apps/api/src/services/pattern-diagnostics.ts#L44), lines 44–44.

<a id="evidence-evidence-b4-revalidation-route"></a>
## evidence-b4-revalidation-route

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L113), lines 113–113.

<a id="evidence-evidence-b4-revalidation-scope"></a>
## evidence-b4-revalidation-scope

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L91), lines 91–94.

<a id="evidence-evidence-b4-revalidation-plan-hash"></a>
## evidence-b4-revalidation-plan-hash

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L307), lines 307–307.

<a id="evidence-evidence-b4-revalidation-ontology"></a>
## evidence-b4-revalidation-ontology

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L311), lines 311–311.

<a id="evidence-evidence-b4-revalidation-request"></a>
## evidence-b4-revalidation-request

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L326), lines 326–326.

<a id="evidence-evidence-b4-revalidation-rerun"></a>
## evidence-b4-revalidation-rerun

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L347), lines 347–347.

<a id="evidence-evidence-b4-revalidation-result-hashes"></a>
## evidence-b4-revalidation-result-hashes

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L388), lines 388–388.

<a id="evidence-evidence-b4-revalidation-fixed-codes"></a>
## evidence-b4-revalidation-fixed-codes

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L240), lines 240–241.

<a id="evidence-evidence-b4-revalidation-final-recheck"></a>
## evidence-b4-revalidation-final-recheck

Current source — [apps/api/src/services/pattern\-candidate\-revalidation\.ts](../../../../../apps/api/src/services/pattern-candidate-revalidation.ts#L363), lines 363–363.

<a id="evidence-evidence-b4-revalidation-audit-first"></a>
## evidence-b4-revalidation-audit-first

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L130), lines 130–130.

<a id="evidence-evidence-b4-revalidation-audit-unavailable"></a>
## evidence-b4-revalidation-audit-unavailable

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L136), lines 136–136.

<a id="evidence-evidence-b4-revalidation-contract"></a>
## evidence-b4-revalidation-contract

Current source — [contracts/runtime\-health\-v1/pattern\-candidate\-revalidation\.schema\.json](../../../../../contracts/runtime-health-v1/pattern-candidate-revalidation.schema.json#L5), lines 5–5.

<a id="evidence-evidence-b5-portrait-chapter-count-gate"></a>
## evidence-b5-portrait-chapter-count-gate

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L71), lines 71–72.

<a id="evidence-evidence-b5-portrait-chapter-count-range"></a>
## evidence-b5-portrait-chapter-count-range

Current source — [packages/shared/src/portrait\-types\.ts](../../../../../packages/shared/src/portrait-types.ts#L135), lines 135–135.

<a id="evidence-evidence-b5-portrait-v1-four-chapters"></a>
## evidence-b5-portrait-v1-four-chapters

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L155), lines 155–155.

<a id="evidence-evidence-b5-web-portrait-protocol-v2"></a>
## evidence-b5-web-portrait-protocol-v2

Current source — [apps/web/src/lib/api\-client\.ts](../../../../../apps/web/src/lib/api-client.ts#L1406), lines 1406–1406.

<a id="evidence-evidence-b5-adaptive-admission-503"></a>
## evidence-b5-adaptive-admission-503

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L170), lines 170–170.

<a id="evidence-evidence-b5-adaptive-switch-exact"></a>
## evidence-b5-adaptive-switch-exact

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L50), lines 50–50.

<a id="evidence-evidence-b5-wrangler-adaptive-default"></a>
## evidence-b5-wrangler-adaptive-default

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L154), lines 154–155.

<a id="evidence-evidence-b5-wrangler-adaptive-production"></a>
## evidence-b5-wrangler-adaptive-production

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L324), lines 324–325.

<a id="evidence-evidence-b5-portrait-chapter-source-text"></a>
## evidence-b5-portrait-chapter-source-text

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L56), lines 56–56.

<a id="evidence-evidence-b5-portrait-prompt-source-material"></a>
## evidence-b5-portrait-prompt-source-material

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L204), lines 204–204.

<a id="evidence-evidence-b5-runner-passive-items"></a>
## evidence-b5-runner-passive-items

Current source — [apps/codex\-runner/src/portrait\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-invocation.ts#L75), lines 75–75.

<a id="evidence-evidence-b5-runner-image-items-only"></a>
## evidence-b5-runner-image-items-only

Current source — [apps/codex\-runner/src/portrait\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-invocation.ts#L188), lines 188–188.

<a id="evidence-evidence-b5-runner-single-image"></a>
## evidence-b5-runner-single-image

Current source — [apps/codex\-runner/src/portrait\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-invocation.ts#L192), lines 192–192.

<a id="evidence-evidence-b5-portrait-document-key"></a>
## evidence-b5-portrait-document-key

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L82), lines 82–82.

<a id="evidence-evidence-b5-portrait-image-encryption"></a>
## evidence-b5-portrait-image-encryption

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L280), lines 280–281.

<a id="evidence-evidence-b5-portrait-object-key"></a>
## evidence-b5-portrait-object-key

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L274), lines 274–274.

<a id="evidence-evidence-b5-portrait-row-matches"></a>
## evidence-b5-portrait-row-matches

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L95), lines 95–95.

<a id="evidence-evidence-b5-portrait-claim-source-hash"></a>
## evidence-b5-portrait-claim-source-hash

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L190), lines 190–190.

<a id="evidence-evidence-b5-portrait-completion-binding"></a>
## evidence-b5-portrait-completion-binding

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L299), lines 299–299.

<a id="evidence-evidence-b5-portrait-terminal-v2-binding"></a>
## evidence-b5-portrait-terminal-v2-binding

Current source — [apps/api/src/services/portrait\-protocol\.ts](../../../../../apps/api/src/services/portrait-protocol.ts#L26), lines 26–28.

<a id="evidence-evidence-b5-portrait-image-serving-query"></a>
## evidence-b5-portrait-image-serving-query

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L365), lines 365–365.

<a id="evidence-evidence-b5-portrait-plaintext-hash"></a>
## evidence-b5-portrait-plaintext-hash

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L269), lines 269–269.

<a id="evidence-evidence-b5-mesh-author-instructions"></a>
## evidence-b5-mesh-author-instructions

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L27), lines 27–27.

<a id="evidence-evidence-b5-mesh-program-schema"></a>
## evidence-b5-mesh-program-schema

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L67), lines 67–67.

<a id="evidence-evidence-apps-codex-runner-portrait-mesh-invocation-ts"></a>
## evidence-apps-codex-runner-portrait-mesh-invocation-ts

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L78), lines 78–78.

<a id="evidence-evidence-b5-mesh-four-previews"></a>
## evidence-b5-mesh-four-previews

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L80), lines 80–80.

<a id="evidence-evidence-b5-mesh-separate-audit"></a>
## evidence-b5-mesh-separate-audit

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L89), lines 89–89.

<a id="evidence-evidence-b5-mesh-audit-criteria"></a>
## evidence-b5-mesh-audit-criteria

Current source — [packages/shared/src/portrait\-mesh\-protocol\.ts](../../../../../packages/shared/src/portrait-mesh-protocol.ts#L145), lines 145–146.

<a id="evidence-evidence-b5-mesh-completion-glb-identity"></a>
## evidence-b5-mesh-completion-glb-identity

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L710), lines 710–713.

<a id="evidence-evidence-b5-mesh-serving-binding"></a>
## evidence-b5-mesh-serving-binding

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L890), lines 890–897.

<a id="evidence-evidence-b5-mesh-browser-v2-binding"></a>
## evidence-b5-mesh-browser-v2-binding

Current source — [apps/web/src/lib/account\-portrait\.ts](../../../../../apps/web/src/lib/account-portrait.ts#L77), lines 77–77.

<a id="evidence-evidence-b5-mesh-browser-glb-provenance"></a>
## evidence-b5-mesh-browser-glb-provenance

Current source — [apps/web/src/components/portrait\-explorer/scene\-utils\.ts](../../../../../apps/web/src/components/portrait-explorer/scene-utils.ts#L62), lines 62–62.

<a id="evidence-evidence-apps-web-components-accountportraitexplorer-tsx"></a>
## evidence-apps-web-components-accountportraitexplorer-tsx

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L124), lines 124–124.

<a id="evidence-evidence-b5-scene-glb-reverify"></a>
## evidence-b5-scene-glb-reverify

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L56), lines 56–56.

<a id="evidence-evidence-b5-explorer-download-models"></a>
## evidence-b5-explorer-download-models

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L1008), lines 1008–1009.

<a id="evidence-evidence-b5-explorer-download-bundle"></a>
## evidence-b5-explorer-download-bundle

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L1015), lines 1015–1016.

<a id="evidence-evidence-b5-mesh-routes-no-store"></a>
## evidence-b5-mesh-routes-no-store

Current source — [apps/api/src/routes/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/routes/pattern-portrait-mesh.ts#L65), lines 65–65.

<a id="evidence-evidence-b5-download-verified-before-save"></a>
## evidence-b5-download-verified-before-save

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L163), lines 163–163.

<a id="evidence-evidence-b5-download-reading-match"></a>
## evidence-b5-download-reading-match

Current source — [apps/web/src/lib/account\-portrait\.ts](../../../../../apps/web/src/lib/account-portrait.ts#L101), lines 101–101.

<a id="evidence-evidence-b5-download-image-hash"></a>
## evidence-b5-download-image-hash

Current source — [apps/web/src/lib/account\-portrait\.ts](../../../../../apps/web/src/lib/account-portrait.ts#L125), lines 125–125.

<a id="evidence-evidence-b5-download-model-hashes"></a>
## evidence-b5-download-model-hashes

Current source — [apps/web/src/lib/account\-portrait\.ts](../../../../../apps/web/src/lib/account-portrait.ts#L131), lines 131–133.

<a id="evidence-evidence-b5-0033-count-range"></a>
## evidence-b5-0033-count-range

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L67), lines 67–68.

<a id="evidence-evidence-b5-0033-protocol-check"></a>
## evidence-b5-0033-protocol-check

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L70), lines 70–71.

<a id="evidence-evidence-b5-0033-identity-immutable"></a>
## evidence-b5-0033-identity-immutable

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L285), lines 285–285.

<a id="evidence-evidence-b5-0033-image-index-trigger"></a>
## evidence-b5-0033-image-index-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L288), lines 288–293.

<a id="evidence-evidence-b5-0033-mesh-index-trigger"></a>
## evidence-b5-0033-mesh-index-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L308), lines 308–313.

<a id="evidence-evidence-b5-portrait-legacy-row-shape"></a>
## evidence-b5-portrait-legacy-row-shape

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L93), lines 93–94.

<a id="evidence-evidence-b5-adaptive-schema-probe"></a>
## evidence-b5-adaptive-schema-probe

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L134), lines 134–135.

<a id="evidence-evidence-b5-portrait-maintenance-stand-down"></a>
## evidence-b5-portrait-maintenance-stand-down

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L394), lines 394–394.

<a id="evidence-evidence-b5-mesh-migration-gate"></a>
## evidence-b5-mesh-migration-gate

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L124), lines 124–124.

<a id="evidence-evidence-b5-mesh-maintenance-stand-down"></a>
## evidence-b5-mesh-maintenance-stand-down

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L1024), lines 1024–1024.

<a id="evidence-evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx"></a>
## evidence-apps-web-components-portrait-explorer-portraitexplorer-tsx

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L149), lines 149–149.

<a id="evidence-evidence-b5-observatory-per-chapter"></a>
## evidence-b5-observatory-per-chapter

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L158), lines 158–158.

<a id="evidence-evidence-b5-observatory-stations"></a>
## evidence-b5-observatory-stations

Current source — [apps/web/src/components/portrait\-explorer/observatory\-world\.ts](../../../../../apps/web/src/components/portrait-explorer/observatory-world.ts#L244), lines 244–245.

<a id="evidence-evidence-b5-observatory-reading-desk"></a>
## evidence-b5-observatory-reading-desk

Current source — [apps/web/src/components/portrait\-explorer/observatory\-world\.ts](../../../../../apps/web/src/components/portrait-explorer/observatory-world.ts#L268), lines 268–268.

<a id="evidence-evidence-b5-observatory-look-closer"></a>
## evidence-b5-observatory-look-closer

Current source — [apps/web/src/components/portrait\-explorer/ObservatoryControls\.tsx](../../../../../apps/web/src/components/portrait-explorer/ObservatoryControls.tsx#L32), lines 32–32.

<a id="evidence-evidence-b5-observatory-compare"></a>
## evidence-b5-observatory-compare

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L450), lines 450–450.

<a id="evidence-evidence-b5-observatory-guided"></a>
## evidence-b5-observatory-guided

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L438), lines 438–438.

<a id="evidence-evidence-b5-observatory-zodiac"></a>
## evidence-b5-observatory-zodiac

Current source — [apps/web/src/components/portrait\-explorer/observatory\-world\.ts](../../../../../apps/web/src/components/portrait-explorer/observatory-world.ts#L120), lines 120–120.

<a id="evidence-evidence-b5-linked-chapter-closed"></a>
## evidence-b5-linked-chapter-closed

Current source — [apps/web/src/components/ConnectedPatternReading\.tsx](../../../../../apps/web/src/components/ConnectedPatternReading.tsx#L15), lines 15–15.

<a id="evidence-evidence-apps-web-components-portrait-explorer-portraitscene-tsx"></a>
## evidence-apps-web-components-portrait-explorer-portraitscene-tsx

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L745), lines 745–745.

<a id="evidence-evidence-b5-scene-folio-fallback"></a>
## evidence-b5-scene-folio-fallback

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L749), lines 749–750.

<a id="evidence-evidence-b5-controls-lighting"></a>
## evidence-b5-controls-lighting

Current source — [apps/web/src/components/portrait\-explorer/ObservatoryControls\.tsx](../../../../../apps/web/src/components/portrait-explorer/ObservatoryControls.tsx#L24), lines 24–24.

<a id="evidence-evidence-b5-controls-roof"></a>
## evidence-b5-controls-roof

Current source — [apps/web/src/components/portrait\-explorer/ObservatoryControls\.tsx](../../../../../apps/web/src/components/portrait-explorer/ObservatoryControls.tsx#L27), lines 27–27.

<a id="evidence-evidence-b5-controls-turn"></a>
## evidence-b5-controls-turn

Current source — [apps/web/src/components/portrait\-explorer/ObservatoryControls\.tsx](../../../../../apps/web/src/components/portrait-explorer/ObservatoryControls.tsx#L34), lines 34–34.

<a id="evidence-evidence-b5-controls-desk"></a>
## evidence-b5-controls-desk

Current source — [apps/web/src/components/portrait\-explorer/ObservatoryControls\.tsx](../../../../../apps/web/src/components/portrait-explorer/ObservatoryControls.tsx#L36), lines 36–36.

<a id="evidence-evidence-b5-scene-source-passage"></a>
## evidence-b5-scene-source-passage

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L793), lines 793–793.

<a id="evidence-evidence-b5-reader-show-passage"></a>
## evidence-b5-reader-show-passage

Current source — [apps/web/src/components/portrait\-explorer/ExplorerReader\.tsx](../../../../../apps/web/src/components/portrait-explorer/ExplorerReader.tsx#L103), lines 103–103.

<a id="evidence-evidence-b5-complete-chapter-perspectives"></a>
## evidence-b5-complete-chapter-perspectives

Current source — [apps/web/src/components/portrait\-explorer/ExplorerReader\.tsx](../../../../../apps/web/src/components/portrait-explorer/ExplorerReader.tsx#L114), lines 114–114.

<a id="evidence-evidence-b5-complete-reading-signatures"></a>
## evidence-b5-complete-reading-signatures

Current source — [apps/web/src/components/portrait\-explorer/ExplorerReader\.tsx](../../../../../apps/web/src/components/portrait-explorer/ExplorerReader.tsx#L124), lines 124–126.

<a id="evidence-evidence-b5-explorer-discard-not-ready"></a>
## evidence-b5-explorer-discard-not-ready

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L81), lines 81–81.

<a id="evidence-evidence-b5-explorer-verified-only"></a>
## evidence-b5-explorer-verified-only

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L196), lines 196–196.

<a id="evidence-evidence-b5-explorer-asset-failure-stations"></a>
## evidence-b5-explorer-asset-failure-stations

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L200), lines 200–200.

<a id="evidence-evidence-b5-scene-fallback-notice"></a>
## evidence-b5-scene-fallback-notice

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L420), lines 420–420.

<a id="evidence-evidence-b5-nav-memory-snapshot"></a>
## evidence-b5-nav-memory-snapshot

Current source — [apps/web/src/components/portrait\-explorer/use\-explorer\-navigation\.ts](../../../../../apps/web/src/components/portrait-explorer/use-explorer-navigation.ts#L79), lines 79–79.

<a id="evidence-evidence-b5-camera-bookmarks"></a>
## evidence-b5-camera-bookmarks

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L154), lines 154–154.

<a id="evidence-evidence-b5-motion-and-power-settings"></a>
## evidence-b5-motion-and-power-settings

Current source — [apps/web/src/components/portrait\-explorer/PortraitExplorer\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitExplorer.tsx#L428), lines 428–428.

<a id="evidence-evidence-b5-portrait-blob-credentials"></a>
## evidence-b5-portrait-blob-credentials

Current source — [apps/web/src/lib/api\-client\.ts](../../../../../apps/web/src/lib/api-client.ts#L1448), lines 1448–1448.

<a id="evidence-evidence-b5-explorer-image-verify"></a>
## evidence-b5-explorer-image-verify

Current source — [apps/web/src/components/AccountPortraitExplorer\.tsx](../../../../../apps/web/src/components/AccountPortraitExplorer.tsx#L120), lines 120–120.

<a id="evidence-evidence-b5-webgl-context-release"></a>
## evidence-b5-webgl-context-release

Current source — [apps/web/src/components/portrait\-explorer/PortraitScene\.tsx](../../../../../apps/web/src/components/portrait-explorer/PortraitScene.tsx#L696), lines 696–696.

<a id="evidence-evidence-b5-privacy-automation-control"></a>
## evidence-b5-privacy-automation-control

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L735), lines 735–736.

<a id="evidence-evidence-b5-automation-grant-table"></a>
## evidence-b5-automation-grant-table

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L77), lines 77–78.

<a id="evidence-evidence-b5-automation-checkbox"></a>
## evidence-b5-automation-checkbox

Current source — [apps/web/src/components/PortraitAutomationControl\.tsx](../../../../../apps/web/src/components/PortraitAutomationControl.tsx#L81), lines 81–81.

<a id="evidence-evidence-b5-automation-client-confirm"></a>
## evidence-b5-automation-client-confirm

Current source — [apps/web/src/components/PortraitAutomationControl\.tsx](../../../../../apps/web/src/components/PortraitAutomationControl.tsx#L58), lines 58–58.

<a id="evidence-evidence-b5-automation-confirm-strings"></a>
## evidence-b5-automation-confirm-strings

Current source — [apps/api/src/routes/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/routes/pattern-portrait-mesh.ts#L105), lines 105–108.

<a id="evidence-evidence-b5-automation-control-hidden"></a>
## evidence-b5-automation-control-hidden

Current source — [apps/web/src/components/PortraitAutomationControl\.tsx](../../../../../apps/web/src/components/PortraitAutomationControl.tsx#L75), lines 75–75.

<a id="evidence-evidence-b5-automation-read"></a>
## evidence-b5-automation-read

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L153), lines 153–159.

<a id="evidence-evidence-b5-automation-set-503"></a>
## evidence-b5-automation-set-503

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L168), lines 168–170.

<a id="evidence-evidence-b5-mesh-available"></a>
## evidence-b5-mesh-available

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L127), lines 127–127.

<a id="evidence-evidence-b5-automation-grant-protocol"></a>
## evidence-b5-automation-grant-protocol

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L323), lines 323–324.

<a id="evidence-evidence-b5-automation-v2-header"></a>
## evidence-b5-automation-v2-header

Current source — [apps/api/src/routes/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/routes/pattern-portrait-mesh.ts#L104), lines 104–104.

<a id="evidence-evidence-b5-automation-v2-switch"></a>
## evidence-b5-automation-v2-switch

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L183), lines 183–184.

<a id="evidence-evidence-b5-automation-legacy-cannot-replace"></a>
## evidence-b5-automation-legacy-cannot-replace

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L201), lines 201–201.

<a id="evidence-evidence-b5-automation-disable-other-policy"></a>
## evidence-b5-automation-disable-other-policy

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L204), lines 204–204.

<a id="evidence-evidence-b5-automation-legacy-controls"></a>
## evidence-b5-automation-legacy-controls

Current source — [apps/web/src/components/PortraitAutomationControl\.tsx](../../../../../apps/web/src/components/PortraitAutomationControl.tsx#L77), lines 77–79.

<a id="evidence-evidence-b5-automation-publish-trigger"></a>
## evidence-b5-automation-publish-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L226), lines 226–231.

<a id="evidence-evidence-b5-automation-enable-outbox"></a>
## evidence-b5-automation-enable-outbox

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L218), lines 218–218.

<a id="evidence-evidence-b5-mesh-claim-repair"></a>
## evidence-b5-mesh-claim-repair

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L443), lines 443–444.

<a id="evidence-evidence-b5-mesh-maintenance-repair"></a>
## evidence-b5-mesh-maintenance-repair

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L1025), lines 1025–1026.

<a id="evidence-evidence-b5-outbox-current-pattern"></a>
## evidence-b5-outbox-current-pattern

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L313), lines 313–314.

<a id="evidence-evidence-b5-mesh-job-enqueue"></a>
## evidence-b5-mesh-job-enqueue

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L407), lines 407–407.

<a id="evidence-evidence-b5-mesh-claim-context"></a>
## evidence-b5-mesh-claim-context

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L245), lines 245–254.

<a id="evidence-evidence-b5-automation-disable"></a>
## evidence-b5-automation-disable

Current source — [apps/api/src/services/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/services/pattern-portrait-mesh.ts#L177), lines 177–177.

<a id="evidence-evidence-b5-automation-withdraw-trigger"></a>
## evidence-b5-automation-withdraw-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L246), lines 246–251.

<a id="evidence-evidence-b5-automation-saved-message"></a>
## evidence-b5-automation-saved-message

Current source — [apps/web/src/components/PortraitAutomationControl\.tsx](../../../../../apps/web/src/components/PortraitAutomationControl.tsx#L95), lines 95–95.

<a id="evidence-evidence-b5-consent-withdraw-trigger"></a>
## evidence-b5-consent-withdraw-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L258), lines 258–258.

<a id="evidence-evidence-b5-document-erasure-trigger"></a>
## evidence-b5-document-erasure-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L191), lines 191–191.

<a id="evidence-evidence-b5-account-delete-trigger"></a>
## evidence-b5-account-delete-trigger

Current source — [db/d1/0033\_adaptive\_portrait\_artwork\.sql](../../../../../db/d1/0033_adaptive_portrait_artwork.sql#L263), lines 263–263.

<a id="evidence-evidence-b6-worker-entry-points"></a>
## evidence-b6-worker-entry-points

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L201), lines 201–205.

<a id="evidence-evidence-b6-hono-app"></a>
## evidence-b6-hono-app

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L47), lines 47–47.

<a id="evidence-evidence-production-web-assets"></a>
## evidence-production-web-assets

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L570), lines 570–571.

<a id="evidence-evidence-b6-web-react"></a>
## evidence-b6-web-react

Current source — [apps/web/package\.json](../../../../../apps/web/package.json#L22), lines 22–22.

<a id="evidence-evidence-apps-api-wrangler-toml-2"></a>
## evidence-apps-api-wrangler-toml-2

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L573), lines 573–573.

<a id="evidence-evidence-b6-spa-fallback"></a>
## evidence-b6-spa-fallback

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L572), lines 572–572.

<a id="evidence-evidence-b6-sw-registration"></a>
## evidence-b6-sw-registration

Current source — [apps/web/src/main\.tsx](../../../../../apps/web/src/main.tsx#L24), lines 24–24.

<a id="evidence-evidence-b6-sw-shell-precache"></a>
## evidence-b6-sw-shell-precache

Current source — [apps/web/public/sw\.js](../../../../../apps/web/public/sw.js#L2), lines 2–5.

<a id="evidence-evidence-apps-web-public-sw-js"></a>
## evidence-apps-web-public-sw-js

Current source — [apps/web/public/sw\.js](../../../../../apps/web/public/sw.js#L25), lines 25–25.

<a id="evidence-evidence-b6-queue-bindings"></a>
## evidence-b6-queue-bindings

Current source — [apps/api/src/env\.ts](../../../../../apps/api/src/env.ts#L99), lines 99–108.

<a id="evidence-evidence-b6-queue-message-shapes"></a>
## evidence-b6-queue-message-shapes

Current source — [apps/api/src/env\.ts](../../../../../apps/api/src/env.ts#L11), lines 11–41.

<a id="evidence-evidence-b6-daily-claim-duplicate"></a>
## evidence-b6-daily-claim-duplicate

Current source — [apps/api/src/queue\.ts](../../../../../apps/api/src/queue.ts#L317), lines 317–318.

<a id="evidence-evidence-b6-daily-attempt-budget"></a>
## evidence-b6-daily-attempt-budget

Current source — [apps/api/src/queue\.ts](../../../../../apps/api/src/queue.ts#L69), lines 69–69.

<a id="evidence-evidence-b6-pattern-cancellation-checks"></a>
## evidence-b6-pattern-cancellation-checks

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L834), lines 834–837.

<a id="evidence-evidence-b6-pattern-cancel-transition"></a>
## evidence-b6-pattern-cancel-transition

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1073), lines 1073–1078.

<a id="evidence-evidence-b6-production-crons"></a>
## evidence-b6-production-crons

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L312), lines 312–313.

<a id="evidence-evidence-b6-cron-lane-split"></a>
## evidence-b6-cron-lane-split

Current source — [apps/api/src/scheduled\.ts](../../../../../apps/api/src/scheduled.ts#L34), lines 34–34.

<a id="evidence-evidence-b6-incumbent-maintenance"></a>
## evidence-b6-incumbent-maintenance

Current source — [apps/api/src/scheduled\.ts](../../../../../apps/api/src/scheduled.ts#L47), lines 47–83.

<a id="evidence-evidence-b6-ontology-maintenance"></a>
## evidence-b6-ontology-maintenance

Current source — [apps/api/src/scheduled\.ts](../../../../../apps/api/src/scheduled.ts#L93), lines 93–119.

<a id="evidence-evidence-b6-ontology-outbox-rollout-gate"></a>
## evidence-b6-ontology-outbox-rollout-gate

Current source — [apps/api/src/services/ontology\-pipeline\-enqueue\.ts](../../../../../apps/api/src/services/ontology-pipeline-enqueue.ts#L316), lines 316–319.

<a id="evidence-evidence-b6-runner-startup-auth"></a>
## evidence-b6-runner-startup-auth

Current source — [apps/codex\-runner/src/index\.ts](../../../../../apps/codex-runner/src/index.ts#L28), lines 28–28.

<a id="evidence-evidence-b6-runner-chatgpt-login"></a>
## evidence-b6-runner-chatgpt-login

Current source — [apps/codex\-runner/src/codex\-cli\.ts](../../../../../apps/codex-runner/src/codex-cli.ts#L59), lines 59–59.

<a id="evidence-evidence-b6-runner-bearer"></a>
## evidence-b6-runner-bearer

Current source — [apps/codex\-runner/src/client\.ts](../../../../../apps/codex-runner/src/client.ts#L102), lines 102–102.

<a id="evidence-evidence-b6-runner-text-claim"></a>
## evidence-b6-runner-text-claim

Current source — [apps/codex\-runner/src/client\.ts](../../../../../apps/codex-runner/src/client.ts#L119), lines 119–119.

<a id="evidence-evidence-b6-provider-completion-parse"></a>
## evidence-b6-provider-completion-parse

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L421), lines 421–421.

<a id="evidence-evidence-b6-provider-routes"></a>
## evidence-b6-provider-routes

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L135), lines 135–137.

<a id="evidence-evidence-b6-runner-lanes"></a>
## evidence-b6-runner-lanes

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L244), lines 244–248.

<a id="evidence-evidence-b6-runner-lane-flags"></a>
## evidence-b6-runner-lane-flags

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L105), lines 105–106.

<a id="evidence-evidence-b6-runner-v2-portrait-protocol"></a>
## evidence-b6-runner-v2-portrait-protocol

Current source — [apps/codex\-runner/src/portrait\-client\.ts](../../../../../apps/codex-runner/src/portrait-client.ts#L76), lines 76–76.

<a id="evidence-evidence-b6-runner-v2-mesh-protocol"></a>
## evidence-b6-runner-v2-mesh-protocol

Current source — [apps/codex\-runner/src/portrait\-mesh\-client\.ts](../../../../../apps/codex-runner/src/portrait-mesh-client.ts#L40), lines 40–40.

<a id="evidence-evidence-b6-runner-single-concurrency"></a>
## evidence-b6-runner-single-concurrency

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L86), lines 86–92.

<a id="evidence-evidence-b6-runner-work-slots"></a>
## evidence-b6-runner-work-slots

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L21), lines 21–22.

<a id="evidence-evidence-b6-runner-cursor"></a>
## evidence-b6-runner-cursor

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L257), lines 257–257.

<a id="evidence-evidence-b6-runner-slot-skip"></a>
## evidence-b6-runner-slot-skip

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L259), lines 259–259.

<a id="evidence-evidence-b6-runner-cooldown"></a>
## evidence-b6-runner-cooldown

Current source — [apps/codex\-runner/src/runner\.ts](../../../../../apps/codex-runner/src/runner.ts#L270), lines 270–270.

<a id="evidence-evidence-b6-text-json-turn-fail-closed"></a>
## evidence-b6-text-json-turn-fail-closed

Current source — [apps/codex\-runner/src/codex\-cli\.ts](../../../../../apps/codex-runner/src/codex-cli.ts#L65), lines 65–77.

<a id="evidence-evidence-b6-mesh-json-turn"></a>
## evidence-b6-mesh-json-turn

Current source — [apps/codex\-runner/src/portrait\-mesh\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-mesh-invocation.ts#L66), lines 66–66.

<a id="evidence-evidence-b6-json-turn-isolation"></a>
## evidence-b6-json-turn-isolation

Current source — [apps/codex\-runner/src/isolated\-codex\-json\.ts](../../../../../apps/codex-runner/src/isolated-codex-json.ts#L129), lines 129–129.

<a id="evidence-evidence-b6-json-turn-cli-version"></a>
## evidence-b6-json-turn-cli-version

Current source — [apps/codex\-runner/src/isolated\-codex\-json\.ts](../../../../../apps/codex-runner/src/isolated-codex-json.ts#L63), lines 63–64.

<a id="evidence-evidence-b6-json-turn-config-check"></a>
## evidence-b6-json-turn-config-check

Current source — [apps/codex\-runner/src/isolated\-codex\-json\.ts](../../../../../apps/codex-runner/src/isolated-codex-json.ts#L122), lines 122–122.

<a id="evidence-evidence-b6-portrait-cli-pin"></a>
## evidence-b6-portrait-cli-pin

Current source — [apps/codex\-runner/src/portrait\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-invocation.ts#L13), lines 13–13.

<a id="evidence-evidence-b6-portrait-cli-check"></a>
## evidence-b6-portrait-cli-check

Current source — [apps/codex\-runner/src/portrait\-invocation\.ts](../../../../../apps/codex-runner/src/portrait-invocation.ts#L272), lines 272–272.

<a id="evidence-evidence-b6-reissue-reasons"></a>
## evidence-b6-reissue-reasons

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L38), lines 38–43.

<a id="evidence-evidence-b6-reissue-validation"></a>
## evidence-b6-reissue-validation

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L146), lines 146–146.

<a id="evidence-evidence-b6-reissue-live-predecessor"></a>
## evidence-b6-reissue-live-predecessor

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L177), lines 177–177.

<a id="evidence-evidence-b6-reissue-v1-builder"></a>
## evidence-b6-reissue-v1-builder

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L186), lines 186–188.

<a id="evidence-evidence-b6-v1-release-required"></a>
## evidence-b6-v1-release-required

Current source — [apps/api/src/services/generation\-command\.ts](../../../../../apps/api/src/services/generation-command.ts#L567), lines 567–567.

<a id="evidence-evidence-b6-invalidate-calculation-defect"></a>
## evidence-b6-invalidate-calculation-defect

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L194), lines 194–194.

<a id="evidence-evidence-b6-invalidation-revision-reason"></a>
## evidence-b6-invalidation-revision-reason

Current source — [apps/api/src/services/reading\-invalidation\.ts](../../../../../apps/api/src/services/reading-invalidation.ts#L245), lines 245–247.

<a id="evidence-evidence-b6-fact-repair-v2-builder"></a>
## evidence-b6-fact-repair-v2-builder

Current source — [apps/api/src/services/reading\-invalidation\.ts](../../../../../apps/api/src/services/reading-invalidation.ts#L441), lines 441–441.

<a id="evidence-evidence-b6-route-fact-repair"></a>
## evidence-b6-route-fact-repair

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L247), lines 247–247.

<a id="evidence-evidence-apps-api-services-run-reading-scheduler-ts-2"></a>
## evidence-apps-api-services-run-reading-scheduler-ts-2

Current source — [apps/api/src/services/run\-reading\-scheduler\.ts](../../../../../apps/api/src/services/run-reading-scheduler.ts#L289), lines 289–289.

<a id="evidence-evidence-b6-reason-vocabularies"></a>
## evidence-b6-reason-vocabularies

Current source — [apps/api/src/services/generation\-command\-v2\.ts](../../../../../apps/api/src/services/generation-command-v2.ts#L74), lines 74–88.

<a id="evidence-evidence-b6-v1-replacement-keeps-reason"></a>
## evidence-b6-v1-replacement-keeps-reason

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L370), lines 370–370.

<a id="evidence-evidence-apps-api-services-enqueue-ts"></a>
## evidence-apps-api-services-enqueue-ts

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L380), lines 380–380.

<a id="evidence-evidence-b6-reservation-reason-mapping"></a>
## evidence-b6-reservation-reason-mapping

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L382), lines 382–390.

<a id="evidence-evidence-b6-replace-actor"></a>
## evidence-b6-replace-actor

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L285), lines 285–285.

<a id="evidence-evidence-apps-api-wrangler-toml-4"></a>
## evidence-apps-api-wrangler-toml-4

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L577), lines 577–578.

<a id="evidence-evidence-b6-d1-users"></a>
## evidence-b6-d1-users

Current source — [db/d1/0001\_m0\_core\.sql](../../../../../db/d1/0001_m0_core.sql#L17), lines 17–17.

<a id="evidence-evidence-b6-d1-chart-snapshots"></a>
## evidence-b6-d1-chart-snapshots

Current source — [db/d1/0001\_m0\_core\.sql](../../../../../db/d1/0001_m0_core.sql#L179), lines 179–179.

<a id="evidence-evidence-b6-d1-daily-readings"></a>
## evidence-b6-d1-daily-readings

Current source — [db/d1/0001\_m0\_core\.sql](../../../../../db/d1/0001_m0_core.sql#L364), lines 364–364.

<a id="evidence-evidence-b6-d1-jobs"></a>
## evidence-b6-d1-jobs

Current source — [db/d1/0001\_m0\_core\.sql](../../../../../db/d1/0001_m0_core.sql#L471), lines 471–471.

<a id="evidence-evidence-production-artifacts"></a>
## evidence-production-artifacts

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L592), lines 592–593.

<a id="evidence-evidence-b6-release-bundle-put"></a>
## evidence-b6-release-bundle-put

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L350), lines 350–354.

<a id="evidence-evidence-b6-codex-artifact-seal-alg"></a>
## evidence-b6-codex-artifact-seal-alg

Current source — [apps/api/src/services/codex\-provider\-artifacts\.ts](../../../../../apps/api/src/services/codex-provider-artifacts.ts#L196), lines 196–196.

<a id="evidence-evidence-b6-codex-artifact-create-only"></a>
## evidence-b6-codex-artifact-create-only

Current source — [apps/api/src/services/codex\-provider\-artifacts\.ts](../../../../../apps/api/src/services/codex-provider-artifacts.ts#L406), lines 406–406.

<a id="evidence-evidence-apps-api-wrangler-toml-5"></a>
## evidence-apps-api-wrangler-toml-5

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L596), lines 596–597.

<a id="evidence-evidence-b6-replay-ledger-create-only"></a>
## evidence-b6-replay-ledger-create-only

Current source — [apps/api/src/services/pattern\-replay\-ledger\.ts](../../../../../apps/api/src/services/pattern-replay-ledger.ts#L611), lines 611–612.

<a id="evidence-evidence-b6-replay-ledger-signing-key"></a>
## evidence-b6-replay-ledger-signing-key

Current source — [apps/api/src/services/pattern\-replay\-ledger\.ts](../../../../../apps/api/src/services/pattern-replay-ledger.ts#L391), lines 391–395.

<a id="evidence-evidence-b6-signer-service-binding"></a>
## evidence-b6-signer-service-binding

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L599), lines 599–601.

<a id="evidence-evidence-b6-signer-env"></a>
## evidence-b6-signer-env

Current source — [apps/ontology\-signer/src/index\.ts](../../../../../apps/ontology-signer/src/index.ts#L68), lines 68–74.

<a id="evidence-evidence-production-daily-rollout"></a>
## evidence-production-daily-rollout

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L403), lines 403–403.

<a id="evidence-evidence-pattern-generation-switch"></a>
## evidence-pattern-generation-switch

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L464), lines 464–466.

<a id="evidence-evidence-b6-production-portrait-flags"></a>
## evidence-b6-production-portrait-flags

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L321), lines 321–324.

<a id="evidence-evidence-production-geocoder"></a>
## evidence-production-geocoder

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L332), lines 332–332.

<a id="evidence-evidence-b6-v1-four-chapters"></a>
## evidence-b6-v1-four-chapters

Current source — [apps/api/src/services/pattern\-portrait\.ts](../../../../../apps/api/src/services/pattern-portrait.ts#L155), lines 155–155.

<a id="evidence-evidence-b6-feedback-default-off"></a>
## evidence-b6-feedback-default-off

Current source — [apps/api/src/services/reading\-feedback\-policy\.ts](../../../../../apps/api/src/services/reading-feedback-policy.ts#L13), lines 13–15.

<a id="evidence-evidence-b6-daily-publisher-refusal"></a>
## evidence-b6-daily-publisher-refusal

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L586), lines 586–587.

<a id="evidence-evidence-b6-daily-model-pins-code"></a>
## evidence-b6-daily-model-pins-code

Current source — [apps/api/src/services/reading\-publisher\.ts](../../../../../apps/api/src/services/reading-publisher.ts#L61), lines 61–62.

<a id="evidence-evidence-b6-pattern-publisher-refusal"></a>
## evidence-b6-pattern-publisher-refusal

Current source — [apps/api/src/services/pattern\-publisher\.ts](../../../../../apps/api/src/services/pattern-publisher.ts#L251), lines 251–251.

<a id="evidence-evidence-b6-pattern-model-pins-code"></a>
## evidence-b6-pattern-model-pins-code

Current source — [apps/api/src/services/pattern\-publisher\.ts](../../../../../apps/api/src/services/pattern-publisher.ts#L43), lines 43–68.

<a id="evidence-evidence-b6-ontology-openai-branch"></a>
## evidence-b6-ontology-openai-branch

Current source — [apps/api/src/services/ontology\-pipeline\-execute\.ts](../../../../../apps/api/src/services/ontology-pipeline-execute.ts#L3173), lines 3173–3173.

<a id="evidence-evidence-b6-generate-route-v1"></a>
## evidence-b6-generate-route-v1

Current source — [apps/api/src/routes/internal\-generation\.ts](../../../../../apps/api/src/routes/internal-generation.ts#L111), lines 111–111.

<a id="evidence-evidence-b6-generate-v1-builder"></a>
## evidence-b6-generate-v1-builder

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L130), lines 130–133.

<a id="evidence-evidence-b6-daily-executor-by-version"></a>
## evidence-b6-daily-executor-by-version

Current source — [apps/api/src/services/generate\-daily\-reading\.ts](../../../../../apps/api/src/services/generate-daily-reading.ts#L254), lines 254–257.

<a id="evidence-evidence-b6-constrained-rollout-gate"></a>
## evidence-b6-constrained-rollout-gate

Current source — [apps/api/src/services/enqueue\.ts](../../../../../apps/api/src/services/enqueue.ts#L482), lines 482–483.

<a id="evidence-evidence-apps-api-wrangler-toml-6"></a>
## evidence-apps-api-wrangler-toml-6

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L318), lines 318–319.

<a id="evidence-evidence-b6-production-release-placeholder"></a>
## evidence-b6-production-release-placeholder

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L325), lines 325–327.

<a id="evidence-evidence-b6-release-placeholder-refused"></a>
## evidence-b6-release-placeholder-refused

Current source — [apps/api/src/services/release\-attestation\.ts](../../../../../apps/api/src/services/release-attestation.ts#L70), lines 70–71.

<a id="evidence-evidence-b6-secrets-outside-config"></a>
## evidence-b6-secrets-outside-config

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L702), lines 702–702.

<a id="evidence-evidence-b6-codex-pipelines"></a>
## evidence-b6-codex-pipelines

Current source — [apps/api/src/db/codex\-provider\-jobs\.ts](../../../../../apps/api/src/db/codex-provider-jobs.ts#L18), lines 18–18.

<a id="evidence-evidence-b6-codex-job-id-derivation"></a>
## evidence-b6-codex-job-id-derivation

Current source — [apps/api/src/db/codex\-provider\-jobs\.ts](../../../../../apps/api/src/db/codex-provider-jobs.ts#L345), lines 345–352.

<a id="evidence-evidence-b6-codex-job-insert-or-ignore"></a>
## evidence-b6-codex-job-insert-or-ignore

Current source — [apps/api/src/db/codex\-provider\-jobs\.ts](../../../../../apps/api/src/db/codex-provider-jobs.ts#L377), lines 377–377.

<a id="evidence-evidence-b6-codex-claim-filter"></a>
## evidence-b6-codex-claim-filter

Current source — [apps/api/src/db/codex\-provider\-jobs\.ts](../../../../../apps/api/src/db/codex-provider-jobs.ts#L435), lines 435–441.

<a id="evidence-evidence-b6-codex-lease"></a>
## evidence-b6-codex-lease

Current source — [apps/api/src/services/codex\-provider\-contract\.ts](../../../../../apps/api/src/services/codex-provider-contract.ts#L7), lines 7–7.

<a id="evidence-evidence-b6-completion-bound"></a>
## evidence-b6-completion-bound

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L415), lines 415–418.

<a id="evidence-evidence-b6-completion-response-artifact"></a>
## evidence-b6-completion-response-artifact

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L492), lines 492–492.

<a id="evidence-evidence-b6-completion-owner-recheck"></a>
## evidence-b6-completion-owner-recheck

Current source — [apps/api/src/routes/codex\-provider\.ts](../../../../../apps/api/src/routes/codex-provider.ts#L511), lines 511–512.

<a id="evidence-evidence-b6-daily-validate"></a>
## evidence-b6-daily-validate

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L723), lines 723–723.

<a id="evidence-evidence-b6-pattern-planner-pass"></a>
## evidence-b6-pattern-planner-pass

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1250), lines 1250–1250.

<a id="evidence-evidence-b6-pattern-verifier-pass"></a>
## evidence-b6-pattern-verifier-pass

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1553), lines 1553–1553.

<a id="evidence-evidence-apps-api-wrangler-toml-7"></a>
## evidence-apps-api-wrangler-toml-7

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L672), lines 672–673.

<a id="evidence-evidence-apps-api-wrangler-toml-8"></a>
## evidence-apps-api-wrangler-toml-8

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L676), lines 676–677.

<a id="evidence-evidence-apps-api-wrangler-toml-9"></a>
## evidence-apps-api-wrangler-toml-9

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L688), lines 688–689.

<a id="evidence-evidence-b6-health-fixed-ok"></a>
## evidence-b6-health-fixed-ok

Current source — [apps/api/src/routes/health\.ts](../../../../../apps/api/src/routes/health.ts#L11), lines 11–18.

<a id="evidence-evidence-b6-meta-release-identity"></a>
## evidence-b6-meta-release-identity

Current source — [apps/api/src/routes/health\.ts](../../../../../apps/api/src/routes/health.ts#L36), lines 36–37.

<a id="evidence-evidence-b6-release-identity-readers"></a>
## evidence-b6-release-identity-readers

Current source — [apps/api/src/services/release\-attestation\.ts](../../../../../apps/api/src/services/release-attestation.ts#L87), lines 87–96.

<a id="evidence-evidence-b6-runner-log-sink"></a>
## evidence-b6-runner-log-sink

Current source — [apps/codex\-runner/src/index\.ts](../../../../../apps/codex-runner/src/index.ts#L16), lines 16–16.

<a id="evidence-evidence-b6-runner-log-fields"></a>
## evidence-b6-runner-log-fields

Current source — [apps/codex\-runner/src/safe\-log\.ts](../../../../../apps/codex-runner/src/safe-log.ts#L17), lines 17–17.

<a id="evidence-evidence-b6-runner-log-rejected"></a>
## evidence-b6-runner-log-rejected

Current source — [apps/codex\-runner/src/safe\-log\.ts](../../../../../apps/codex-runner/src/safe-log.ts#L10), lines 10–10.

<a id="evidence-evidence-b6-runtime-health-route-purpose"></a>
## evidence-b6-runtime-health-route-purpose

Current source — [apps/api/src/routes/admin\-runtime\-health\.ts](../../../../../apps/api/src/routes/admin-runtime-health.ts#L7), lines 7–10.

<a id="evidence-evidence-b6-runtime-health-admin-mount"></a>
## evidence-b6-runtime-health-admin-mount

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L119), lines 119–119.

<a id="evidence-evidence-b6-runtime-health-work-tables"></a>
## evidence-b6-runtime-health-work-tables

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L17), lines 17–17.

<a id="evidence-evidence-b6-runtime-health-publication-failures"></a>
## evidence-b6-runtime-health-publication-failures

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L106), lines 106–106.

<a id="evidence-evidence-b6-runtime-health-sample-limit"></a>
## evidence-b6-runtime-health-sample-limit

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L4), lines 4–4.

<a id="evidence-evidence-b6-runtime-health-limit-check"></a>
## evidence-b6-runtime-health-limit-check

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L46), lines 46–46.

<a id="evidence-evidence-b6-runtime-health-day"></a>
## evidence-b6-runtime-health-day

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L5), lines 5–5.

<a id="evidence-evidence-b6-runtime-health-window"></a>
## evidence-b6-runtime-health-window

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L126), lines 126–126.

<a id="evidence-evidence-b6-runtime-health-latency"></a>
## evidence-b6-runtime-health-latency

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L83), lines 83–83.

<a id="evidence-evidence-b6-runtime-health-completed-at"></a>
## evidence-b6-runtime-health-completed-at

Current source — [db/d1/0032\_runtime\_health\.sql](../../../../../db/d1/0032_runtime_health.sql#L3), lines 3–4.

<a id="evidence-evidence-b6-runtime-health-audit-route"></a>
## evidence-b6-runtime-health-audit-route

Current source — [apps/api/src/routes/admin\-runtime\-health\.ts](../../../../../apps/api/src/routes/admin-runtime-health.ts#L13), lines 13–22.

<a id="evidence-evidence-b6-runtime-health-audit-failure"></a>
## evidence-b6-runtime-health-audit-failure

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L146), lines 146–146.

<a id="evidence-evidence-b6-runtime-health-audit-expiry"></a>
## evidence-b6-runtime-health-audit-expiry

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L139), lines 139–139.

<a id="evidence-evidence-b6-runtime-health-audit-purge"></a>
## evidence-b6-runtime-health-audit-purge

Current source — [apps/api/src/scheduled\.ts](../../../../../apps/api/src/scheduled.ts#L80), lines 80–80.

<a id="evidence-evidence-b6-runtime-health-runner-null"></a>
## evidence-b6-runtime-health-runner-null

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L29), lines 29–29.

<a id="evidence-evidence-apps-api-index-ts-6"></a>
## evidence-apps-api-index-ts-6

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L49), lines 49–49.

<a id="evidence-evidence-b7-meta-outside-config-guard"></a>
## evidence-b7-meta-outside-config-guard

Current source — [apps/api/src/routes/health\.ts](../../../../../apps/api/src/routes/health.ts#L21), lines 21–29.

<a id="evidence-evidence-apps-api-index-ts-7"></a>
## evidence-apps-api-index-ts-7

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L58), lines 58–58.

<a id="evidence-evidence-b7-session-id-token-verify"></a>
## evidence-b7-session-id-token-verify

Current source — [apps/api/src/routes/sessions\.ts](../../../../../apps/api/src/routes/sessions.ts#L59), lines 59–59.

<a id="evidence-evidence-apps-api-index-ts-8"></a>
## evidence-apps-api-index-ts-8

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L65), lines 65–65.

<a id="evidence-evidence-apps-api-routes-privacy-ts-2"></a>
## evidence-apps-api-routes-privacy-ts-2

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L368), lines 368–368.

<a id="evidence-evidence-b7-deletion-receipt-lookup"></a>
## evidence-b7-deletion-receipt-lookup

Current source — [apps/api/src/db/deletion\-jobs\.ts](../../../../../apps/api/src/db/deletion-jobs.ts#L332), lines 332–332.

<a id="evidence-evidence-b7-deletion-reservation-revocations"></a>
## evidence-b7-deletion-reservation-revocations

Current source — [apps/api/src/db/deletion\-jobs\.ts](../../../../../apps/api/src/db/deletion-jobs.ts#L276), lines 276–288.

<a id="evidence-evidence-apps-api-index-ts-2"></a>
## evidence-apps-api-index-ts-2

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L78), lines 78–78.

<a id="evidence-evidence-b7-api-authenticate-gate"></a>
## evidence-b7-api-authenticate-gate

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L79), lines 79–80.

<a id="evidence-evidence-b7-api-feedback-connection-mounts"></a>
## evidence-b7-api-feedback-connection-mounts

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L89), lines 89–90.

<a id="evidence-evidence-b7-api-private-no-store-paths"></a>
## evidence-b7-api-private-no-store-paths

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L74), lines 74–75.

<a id="evidence-evidence-apps-api-index-ts-9"></a>
## evidence-apps-api-index-ts-9

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L108), lines 108–108.

<a id="evidence-evidence-apps-api-index-ts-3"></a>
## evidence-apps-api-index-ts-3

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L118), lines 118–118.

<a id="evidence-evidence-apps-api-index-ts-10"></a>
## evidence-apps-api-index-ts-10

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L134), lines 134–134.

<a id="evidence-evidence-apps-api-index-ts-4"></a>
## evidence-apps-api-index-ts-4

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L147), lines 147–147.

<a id="evidence-evidence-apps-api-index-ts-5"></a>
## evidence-apps-api-index-ts-5

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L151), lines 151–151.

<a id="evidence-evidence-b7-admin-no-store-before-guard"></a>
## evidence-b7-admin-no-store-before-guard

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L116), lines 116–117.

<a id="evidence-evidence-b7-admin-route-order"></a>
## evidence-b7-admin-route-order

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L119), lines 119–120.

<a id="evidence-evidence-b7-authority-token-aliasing"></a>
## evidence-b7-authority-token-aliasing

Current source — [apps/api/src/middleware/config\-guard\.ts](../../../../../apps/api/src/middleware/config-guard.ts#L464), lines 464–482.

<a id="evidence-evidence-b7-admin-access-assertion"></a>
## evidence-b7-admin-access-assertion

Current source — [apps/api/src/middleware/admin\-auth\.ts](../../../../../apps/api/src/middleware/admin-auth.ts#L114), lines 114–114.

<a id="evidence-evidence-b7-admin-access-iss-aud"></a>
## evidence-b7-admin-access-iss-aud

Current source — [apps/api/src/services/admin\-access\.ts](../../../../../apps/api/src/services/admin-access.ts#L90), lines 90–91.

<a id="evidence-evidence-b7-admin-session-ttl"></a>
## evidence-b7-admin-session-ttl

Current source — [apps/api/src/middleware/admin\-auth\.ts](../../../../../apps/api/src/middleware/admin-auth.ts#L13), lines 13–13.

<a id="evidence-evidence-b7-admin-session-insert"></a>
## evidence-b7-admin-session-insert

Current source — [apps/api/src/middleware/admin\-auth\.ts](../../../../../apps/api/src/middleware/admin-auth.ts#L86), lines 86–87.

<a id="evidence-evidence-b7-admin-response-headers"></a>
## evidence-b7-admin-response-headers

Current source — [apps/api/src/middleware/admin\-auth\.ts](../../../../../apps/api/src/middleware/admin-auth.ts#L162), lines 162–166.

<a id="evidence-evidence-b7-admin-purposes"></a>
## evidence-b7-admin-purposes

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L17), lines 17–22.

<a id="evidence-evidence-apps-api-routes-admin-pattern-ts"></a>
## evidence-apps-api-routes-admin-pattern-ts

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L85), lines 85–85.

<a id="evidence-evidence-b7-admin-diagnostics-id-check"></a>
## evidence-b7-admin-diagnostics-id-check

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L102), lines 102–104.

<a id="evidence-evidence-apps-api-routes-admin-pattern-ts-2"></a>
## evidence-apps-api-routes-admin-pattern-ts-2

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L60), lines 60–60.

<a id="evidence-evidence-b7-admin-diagnostics-audit"></a>
## evidence-b7-admin-diagnostics-audit

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L108), lines 108–108.

<a id="evidence-evidence-b7-admin-artifact-audit-first"></a>
## evidence-b7-admin-artifact-audit-first

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L325), lines 325–325.

<a id="evidence-evidence-b7-ontology-release-lookup"></a>
## evidence-b7-ontology-release-lookup

Current source — [apps/api/src/routes/admin\-pattern\.ts](../../../../../apps/api/src/routes/admin-pattern.ts#L359), lines 359–359.

<a id="evidence-evidence-b7-deletion-clears-admin-target"></a>
## evidence-b7-deletion-clears-admin-target

Current source — [apps/api/src/services/deletion\-manifest\.ts](../../../../../apps/api/src/services/deletion-manifest.ts#L254), lines 254–254.

<a id="evidence-evidence-b7-runtime-health-incident-only"></a>
## evidence-b7-runtime-health-incident-only

Current source — [apps/api/src/routes/admin\-runtime\-health\.ts](../../../../../apps/api/src/routes/admin-runtime-health.ts#L10), lines 10–10.

<a id="evidence-evidence-b7-runtime-health-denial-audit"></a>
## evidence-b7-runtime-health-denial-audit

Current source — [apps/api/src/routes/admin\-runtime\-health\.ts](../../../../../apps/api/src/routes/admin-runtime-health.ts#L14), lines 14–14.

<a id="evidence-evidence-b7-runtime-health-audit-row"></a>
## evidence-b7-runtime-health-audit-row

Current source — [apps/api/src/services/runtime\-health\.ts](../../../../../apps/api/src/services/runtime-health.ts#L145), lines 145–145.

<a id="evidence-evidence-b7-oidc-claim-checks"></a>
## evidence-b7-oidc-claim-checks

Current source — [apps/api/src/services/identity\.ts](../../../../../apps/api/src/services/identity.ts#L120), lines 120–126.

<a id="evidence-evidence-b7-session-link-and-create"></a>
## evidence-b7-session-link-and-create

Current source — [apps/api/src/routes/sessions\.ts](../../../../../apps/api/src/routes/sessions.ts#L78), lines 78–79.

<a id="evidence-evidence-b7-session-hash-only"></a>
## evidence-b7-session-hash-only

Current source — [apps/api/src/db/sessions\.ts](../../../../../apps/api/src/db/sessions.ts#L38), lines 38–38.

<a id="evidence-evidence-b7-session-ttl"></a>
## evidence-b7-session-ttl

Current source — [apps/api/src/db/sessions\.ts](../../../../../apps/api/src/db/sessions.ts#L8), lines 8–11.

<a id="evidence-evidence-apps-api-routes-sessions-ts"></a>
## evidence-apps-api-routes-sessions-ts

Current source — [apps/api/src/routes/sessions\.ts](../../../../../apps/api/src/routes/sessions.ts#L84), lines 84–88.

<a id="evidence-evidence-b7-bearer-fallback"></a>
## evidence-b7-bearer-fallback

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L44), lines 44–44.

<a id="evidence-evidence-b7-committed-auth0-issuer"></a>
## evidence-b7-committed-auth0-issuer

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L359), lines 359–359.

<a id="evidence-evidence-b7-recovery-routes"></a>
## evidence-b7-recovery-routes

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L108), lines 108–113.

<a id="evidence-evidence-b7-account-state-lifecycle"></a>
## evidence-b7-account-state-lifecycle

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L124), lines 124–124.

<a id="evidence-evidence-b7-account-processing-required"></a>
## evidence-b7-account-processing-required

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L137), lines 137–138.

<a id="evidence-evidence-b7-withdrawal-freezes"></a>
## evidence-b7-withdrawal-freezes

Current source — [apps/api/src/db/account\-processing\-consents\.ts](../../../../../apps/api/src/db/account-processing-consents.ts#L578), lines 578–578.

<a id="evidence-evidence-b7-regrant-reactivates"></a>
## evidence-b7-regrant-reactivates

Current source — [apps/api/src/db/account\-processing\-consents\.ts](../../../../../apps/api/src/db/account-processing-consents.ts#L591), lines 591–591.

<a id="evidence-evidence-b7-logout-revokes"></a>
## evidence-b7-logout-revokes

Current source — [apps/api/src/routes/sessions\.ts](../../../../../apps/api/src/routes/sessions.ts#L99), lines 99–106.

<a id="evidence-evidence-b7-uniform-unauthorized"></a>
## evidence-b7-uniform-unauthorized

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L94), lines 94–96.

<a id="evidence-evidence-b7-auth-stub-header"></a>
## evidence-b7-auth-stub-header

Current source — [apps/api/src/middleware/auth\.ts](../../../../../apps/api/src/middleware/auth.ts#L66), lines 66–67.

<a id="evidence-evidence-b7-auth-stub-refused"></a>
## evidence-b7-auth-stub-refused

Current source — [apps/api/src/middleware/config\-guard\.ts](../../../../../apps/api/src/middleware/config-guard.ts#L570), lines 570–570.

<a id="evidence-evidence-b7-committed-auth-stub-off"></a>
## evidence-b7-committed-auth-stub-off

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L376), lines 376–376.

<a id="evidence-evidence-b7-account-processing-version-check"></a>
## evidence-b7-account-processing-version-check

Current source — [apps/api/src/routes/account\-processing\-consents\.ts](../../../../../apps/api/src/routes/account-processing-consents.ts#L73), lines 73–74.

<a id="evidence-evidence-b7-ai-synthesis-version-check"></a>
## evidence-b7-ai-synthesis-version-check

Current source — [apps/api/src/routes/consents\.ts](../../../../../apps/api/src/routes/consents.ts#L217), lines 217–221.

<a id="evidence-evidence-b7-geocoder-version-check"></a>
## evidence-b7-geocoder-version-check

Current source — [apps/api/src/routes/consents\.ts](../../../../../apps/api/src/routes/consents.ts#L115), lines 115–117.

<a id="evidence-evidence-b7-pattern-consent-version-check"></a>
## evidence-b7-pattern-consent-version-check

Current source — [apps/api/src/services/pattern\-enqueue\.ts](../../../../../apps/api/src/services/pattern-enqueue.ts#L133), lines 133–137.

<a id="evidence-evidence-b7-portrait-automation-policies"></a>
## evidence-b7-portrait-automation-policies

Current source — [apps/api/src/routes/pattern\-portrait\-mesh\.ts](../../../../../apps/api/src/routes/pattern-portrait-mesh.ts#L103), lines 103–103.

<a id="evidence-evidence-b7-privacy-consent-panels"></a>
## evidence-b7-privacy-consent-panels

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L804), lines 804–812.

<a id="evidence-evidence-b7-privacy-portrait-control"></a>
## evidence-b7-privacy-portrait-control

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L736), lines 736–738.

<a id="evidence-evidence-b7-privacy-source-controls"></a>
## evidence-b7-privacy-source-controls

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L854), lines 854–854.

<a id="evidence-evidence-b7-privacy-account-data-controls"></a>
## evidence-b7-privacy-account-data-controls

Current source — [apps/web/src/components/PrivacyView\.tsx](../../../../../apps/web/src/components/PrivacyView.tsx#L866), lines 866–866.

<a id="evidence-evidence-b7-daily-consent-reread"></a>
## evidence-b7-daily-consent-reread

Current source — [apps/api/src/services/generate\-daily\-reading\-v5\.ts](../../../../../apps/api/src/services/generate-daily-reading-v5.ts#L614), lines 614–616.

<a id="evidence-evidence-b7-pattern-publication-consent"></a>
## evidence-b7-pattern-publication-consent

Current source — [apps/api/src/services/pattern\-publication\-proof\.ts](../../../../../apps/api/src/services/pattern-publication-proof.ts#L321), lines 321–322.

<a id="evidence-evidence-b7-context-source-pair"></a>
## evidence-b7-context-source-pair

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L451), lines 451–451.

<a id="evidence-evidence-b7-context-source-uses"></a>
## evidence-b7-context-source-uses

Current source — [apps/api/src/db/context\-sources\.ts](../../../../../apps/api/src/db/context-sources.ts#L13), lines 13–16.

<a id="evidence-evidence-b7-topic-exclusion-grant"></a>
## evidence-b7-topic-exclusion-grant

Current source — [apps/api/src/db/topic\-exclusions\.ts](../../../../../apps/api/src/db/topic-exclusions.ts#L208), lines 208–208.

<a id="evidence-evidence-b7-feedback-first-party-grant"></a>
## evidence-b7-feedback-first-party-grant

Current source — [apps/api/src/db/feedback\.ts](../../../../../apps/api/src/db/feedback.ts#L216), lines 216–216.

<a id="evidence-evidence-b7-dek-minted-at-link"></a>
## evidence-b7-dek-minted-at-link

Current source — [apps/api/src/db/identities\.ts](../../../../../apps/api/src/db/identities.ts#L92), lines 92–92.

<a id="evidence-evidence-b7-dek-32-bytes"></a>
## evidence-b7-dek-32-bytes

Current source — [apps/api/src/crypto\.ts](../../../../../apps/api/src/crypto.ts#L111), lines 111–112.

<a id="evidence-evidence-b7-root-key-hkdf"></a>
## evidence-b7-root-key-hkdf

Current source — [apps/api/src/crypto\.ts](../../../../../apps/api/src/crypto.ts#L70), lines 70–72.

<a id="evidence-evidence-b7-dek-wrap-aad"></a>
## evidence-b7-dek-wrap-aad

Current source — [apps/api/src/crypto\.ts](../../../../../apps/api/src/crypto.ts#L174), lines 174–177.

<a id="evidence-evidence-b7-payload-aad"></a>
## evidence-b7-payload-aad

Current source — [apps/api/src/crypto\.ts](../../../../../apps/api/src/crypto.ts#L160), lines 160–165.

<a id="evidence-evidence-b7-content-key-wrap"></a>
## evidence-b7-content-key-wrap

Current source — [apps/api/src/services/pattern\-crypto\.ts](../../../../../apps/api/src/services/pattern-crypto.ts#L21), lines 21–21.

<a id="evidence-evidence-b7-artifact-aad"></a>
## evidence-b7-artifact-aad

Current source — [apps/api/src/services/pattern\-crypto\.ts](../../../../../apps/api/src/services/pattern-crypto.ts#L73), lines 73–73.

<a id="evidence-evidence-b7-owned-export-query"></a>
## evidence-b7-owned-export-query

Current source — [apps/api/src/db/privacy\-jobs\.ts](../../../../../apps/api/src/db/privacy-jobs.ts#L649), lines 649–649.

<a id="evidence-evidence-b7-reading-projection-contract"></a>
## evidence-b7-reading-projection-contract

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L32), lines 32–32.

<a id="evidence-evidence-b7-history-private-no-store"></a>
## evidence-b7-history-private-no-store

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L521), lines 521–522.

<a id="evidence-evidence-b7-reading-private-no-store"></a>
## evidence-b7-reading-private-no-store

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L543), lines 543–544.

<a id="evidence-evidence-b7-save-private-no-store"></a>
## evidence-b7-save-private-no-store

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L661), lines 661–662.

<a id="evidence-evidence-b7-today-route"></a>
## evidence-b7-today-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L434), lines 434–434.

<a id="evidence-evidence-b7-resonance-feedback-route"></a>
## evidence-b7-resonance-feedback-route

Current source — [apps/api/src/routes/readings\.ts](../../../../../apps/api/src/routes/readings.ts#L584), lines 584–584.

<a id="evidence-evidence-b7-safe-log-boundary"></a>
## evidence-b7-safe-log-boundary

Current source — [apps/api/src/services/safe\-log\.ts](../../../../../apps/api/src/services/safe-log.ts#L372), lines 372–376.

<a id="evidence-evidence-b7-safe-exception-class"></a>
## evidence-b7-safe-exception-class

Current source — [apps/api/src/services/safe\-log\.ts](../../../../../apps/api/src/services/safe-log.ts#L66), lines 66–67.

<a id="evidence-evidence-b7-scheduled-rethrow"></a>
## evidence-b7-scheduled-rethrow

Current source — [apps/api/src/scheduled\.ts](../../../../../apps/api/src/scheduled.ts#L75), lines 75–84.

<a id="evidence-evidence-b7-privacy-queue-no-catch"></a>
## evidence-b7-privacy-queue-no-catch

Current source — [apps/api/src/queue\.ts](../../../../../apps/api/src/queue.ts#L233), lines 233–248.

<a id="evidence-evidence-apps-api-routes-privacy-ts"></a>
## evidence-apps-api-routes-privacy-ts

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L87), lines 87–87.

<a id="evidence-evidence-b7-export-queue"></a>
## evidence-b7-export-queue

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L141), lines 141–141.

<a id="evidence-evidence-b7-export-random-key"></a>
## evidence-b7-export-random-key

Current source — [apps/api/src/services/export\-envelope\.ts](../../../../../apps/api/src/services/export-envelope.ts#L75), lines 75–75.

<a id="evidence-evidence-b7-export-key-wrap"></a>
## evidence-b7-export-key-wrap

Current source — [apps/api/src/services/export\-envelope\.ts](../../../../../apps/api/src/services/export-envelope.ts#L97), lines 97–100.

<a id="evidence-evidence-b7-export-seven-days"></a>
## evidence-b7-export-seven-days

Current source — [apps/api/src/services/privacy\-jobs\.ts](../../../../../apps/api/src/services/privacy-jobs.ts#L157), lines 157–157.

<a id="evidence-evidence-b7-export-expired-410"></a>
## evidence-b7-export-expired-410

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L205), lines 205–205.

<a id="evidence-evidence-b7-export-download-no-store"></a>
## evidence-b7-export-download-no-store

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L257), lines 257–257.

<a id="evidence-evidence-b7-delete-idempotency-key"></a>
## evidence-b7-delete-idempotency-key

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L289), lines 289–296.

<a id="evidence-evidence-b7-delete-confirm"></a>
## evidence-b7-delete-confirm

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L279), lines 279–279.

<a id="evidence-evidence-b7-deletion-pending"></a>
## evidence-b7-deletion-pending

Current source — [apps/api/src/db/deletion\-jobs\.ts](../../../../../apps/api/src/db/deletion-jobs.ts#L240), lines 240–240.

<a id="evidence-evidence-b7-deletion-receipt-cookie"></a>
## evidence-b7-deletion-receipt-cookie

Current source — [apps/api/src/routes/privacy\.ts](../../../../../apps/api/src/routes/privacy.ts#L344), lines 344–344.

<a id="evidence-evidence-b7-deletion-fence-exports"></a>
## evidence-b7-deletion-fence-exports

Current source — [apps/api/src/services/account\-deletion\.ts](../../../../../apps/api/src/services/account-deletion.ts#L300), lines 300–300.

<a id="evidence-evidence-b7-deletion-checkpoints"></a>
## evidence-b7-deletion-checkpoints

Current source — [apps/api/src/services/account\-deletion\.ts](../../../../../apps/api/src/services/account-deletion.ts#L312), lines 312–324.

<a id="evidence-evidence-b7-deletion-key-erasure"></a>
## evidence-b7-deletion-key-erasure

Current source — [apps/api/src/services/account\-deletion\.ts](../../../../../apps/api/src/services/account-deletion.ts#L162), lines 162–162.

<a id="evidence-evidence-b7-deletion-tombstone"></a>
## evidence-b7-deletion-tombstone

Current source — [apps/api/src/services/account\-deletion\.ts](../../../../../apps/api/src/services/account-deletion.ts#L226), lines 226–226.

<a id="evidence-evidence-b7-dek-rotation-confirm"></a>
## evidence-b7-dek-rotation-confirm

Current source — [apps/api/src/routes/internal\-crypto\.ts](../../../../../apps/api/src/routes/internal-crypto.ts#L131), lines 131–131.

<a id="evidence-evidence-b7-kek-rewrap-confirm"></a>
## evidence-b7-kek-rewrap-confirm

Current source — [apps/api/src/routes/internal\-crypto\.ts](../../../../../apps/api/src/routes/internal-crypto.ts#L174), lines 174–174.

<a id="evidence-evidence-b7-rotation-installs-fence"></a>
## evidence-b7-rotation-installs-fence

Current source — [apps/api/src/services/crypto\-operations\.ts](../../../../../apps/api/src/services/crypto-operations.ts#L250), lines 250–250.

<a id="evidence-evidence-b7-write-fence-predicate"></a>
## evidence-b7-write-fence-predicate

Current source — [apps/api/src/db/crypto\-write\-fence\.ts](../../../../../apps/api/src/db/crypto-write-fence.ts#L37), lines 37–40.

<a id="evidence-evidence-b7-check-in-write-fence"></a>
## evidence-b7-check-in-write-fence

Current source — [apps/api/src/db/check\-ins\.ts](../../../../../apps/api/src/db/check-ins.ts#L407), lines 407–409.

<a id="evidence-evidence-b7-pattern-publication-write-fence"></a>
## evidence-b7-pattern-publication-write-fence

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1926), lines 1926–1931.

<a id="evidence-evidence-b7-feedback-write-fence"></a>
## evidence-b7-feedback-write-fence

Current source — [apps/api/src/db/reading\-feedback\-events\.ts](../../../../../apps/api/src/db/reading-feedback-events.ts#L294), lines 294–294.

<a id="evidence-evidence-b7-feedback-retention-months"></a>
## evidence-b7-feedback-retention-months

Current source — [packages/shared/src/reading\-feedback\-types\.ts](../../../../../packages/shared/src/reading-feedback-types.ts#L4), lines 4–4.

<a id="evidence-evidence-b7-feedback-retention-purge"></a>
## evidence-b7-feedback-retention-purge

Current source — [apps/api/src/services/privacy\-maintenance\.ts](../../../../../apps/api/src/services/privacy-maintenance.ts#L127), lines 127–128.

<a id="evidence-evidence-b7-feedback-export-schema"></a>
## evidence-b7-feedback-export-schema

Current source — [packages/shared/src/reading\-feedback\-types\.ts](../../../../../packages/shared/src/reading-feedback-types.ts#L5), lines 5–5.

<a id="evidence-evidence-b7-feedback-export-new-jobs"></a>
## evidence-b7-feedback-export-new-jobs

Current source — [apps/api/src/db/privacy\-jobs\.ts](../../../../../apps/api/src/db/privacy-jobs.ts#L170), lines 170–170.

<a id="evidence-evidence-b7-feedback-export-included"></a>
## evidence-b7-feedback-export-included

Current source — [apps/api/src/services/account\-export\.ts](../../../../../apps/api/src/services/account-export.ts#L504), lines 504–504.

<a id="evidence-evidence-b7-deleted-user-tables-new"></a>
## evidence-b7-deleted-user-tables-new

Current source — [apps/api/src/services/deletion\-manifest\.ts](../../../../../apps/api/src/services/deletion-manifest.ts#L106), lines 106–108.

<a id="evidence-evidence-b7-rotation-feedback-events"></a>
## evidence-b7-rotation-feedback-events

Current source — [apps/api/src/db/users\.ts](../../../../../apps/api/src/db/users.ts#L310), lines 310–312.

<a id="evidence-evidence-b7-rotation-walks-columns"></a>
## evidence-b7-rotation-walks-columns

Current source — [apps/api/src/services/crypto\-operations\.ts](../../../../../apps/api/src/services/crypto-operations.ts#L392), lines 392–392.

<a id="evidence-evidence-b7-relationship-supports-non-portable"></a>
## evidence-b7-relationship-supports-non-portable

Current source — [apps/api/src/services/deletion\-manifest\.ts](../../../../../apps/api/src/services/deletion-manifest.ts#L185), lines 185–187.

<a id="evidence-evidence-b7-export-omits-relationship-supports"></a>
## evidence-b7-export-omits-relationship-supports

Current source — [apps/api/src/services/account\-export\.ts](../../../../../apps/api/src/services/account-export.ts#L424), lines 424–424.

<a id="evidence-evidence-b7-rotation-relationship-supports"></a>
## evidence-b7-rotation-relationship-supports

Current source — [apps/api/src/db/users\.ts](../../../../../apps/api/src/db/users.ts#L317), lines 317–319.

<a id="evidence-evidence-b8-m0-status-frozen"></a>
## evidence-b8-m0-status-frozen

Current source — [contracts/m0/SCHEMA\_MANIFEST\.json](../../../../../contracts/m0/SCHEMA_MANIFEST.json#L5), lines 5–5.

<a id="evidence-evidence-b8-contract-registry"></a>
## evidence-b8-contract-registry

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L455), lines 455–455.

<a id="evidence-evidence-b8-mesh-v1-shared-fixtures"></a>
## evidence-b8-mesh-v1-shared-fixtures

Current source — [packages/shared/src/portrait\-mesh\-protocol\.test\.ts](../../../../../packages/shared/src/portrait-mesh-protocol.test.ts#L61), lines 61–61.

<a id="evidence-evidence-b8-m0-own-validator"></a>
## evidence-b8-m0-own-validator

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L4006), lines 4006–4006.

<a id="evidence-evidence-b8-new-package-validation"></a>
## evidence-b8-new-package-validation

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L4105), lines 4105–4119.

<a id="evidence-evidence-b8-openapi-skip"></a>
## evidence-b8-openapi-skip

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L1580), lines 1580–1580.

<a id="evidence-evidence-b8-projection-yaml-guard"></a>
## evidence-b8-projection-yaml-guard

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L1919), lines 1919–1922.

<a id="evidence-evidence-b8-geocoder-yaml-import"></a>
## evidence-b8-geocoder-yaml-import

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L3953), lines 3953–3955.

<a id="evidence-evidence-b8-freeze-digest-check"></a>
## evidence-b8-freeze-digest-check

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L1673), lines 1673–1673.

<a id="evidence-evidence-b8-freeze-git-status"></a>
## evidence-b8-freeze-git-status

Current source — [contracts/validate\_schemas\.py](../../../../../contracts/validate_schemas.py#L1680), lines 1680–1680.

<a id="evidence-evidence-b8-geocoder-v2-pin"></a>
## evidence-b8-geocoder-v2-pin

Current source — [contracts/geocoder\-v2/SCHEMA\_MANIFEST\.json](../../../../../contracts/geocoder-v2/SCHEMA_MANIFEST.json#L8), lines 8–8.

<a id="evidence-evidence-b8-m3-v2-amendment"></a>
## evidence-b8-m3-v2-amendment

Current source — [contracts/m3/SCHEMA\_MANIFEST\.json](../../../../../contracts/m3/SCHEMA_MANIFEST.json#L33), lines 33–33.

<a id="evidence-evidence-b8-m4-repin"></a>
## evidence-b8-m4-repin

Current source — [contracts/m4/SCHEMA\_MANIFEST\.json](../../../../../contracts/m4/SCHEMA_MANIFEST.json#L19), lines 19–19.

<a id="evidence-evidence-b8-validators-roots"></a>
## evidence-b8-validators-roots

Current source — [apps/api/scripts/generate\-worker\-validators\.ts](../../../../../apps/api/scripts/generate-worker-validators.ts#L11), lines 11–12.

<a id="evidence-evidence-b8-validators-ontology-schemas"></a>
## evidence-b8-validators-ontology-schemas

Current source — [apps/api/scripts/generate\-worker\-validators\.ts](../../../../../apps/api/scripts/generate-worker-validators.ts#L122), lines 122–122.

<a id="evidence-evidence-b8-validators-stale-check"></a>
## evidence-b8-validators-stale-check

Current source — [apps/api/scripts/generate\-worker\-validators\.ts](../../../../../apps/api/scripts/generate-worker-validators.ts#L197), lines 197–197.

<a id="evidence-evidence-b8-api-check-validators-script"></a>
## evidence-b8-api-check-validators-script

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L10), lines 10–10.

<a id="evidence-evidence-b8-api-prebuild-check"></a>
## evidence-b8-api-prebuild-check

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L15), lines 15–15.

<a id="evidence-evidence-b8-api-pretest-check"></a>
## evidence-b8-api-pretest-check

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L30), lines 30–30.

<a id="evidence-evidence-b8-api-predeploy-check"></a>
## evidence-b8-api-predeploy-check

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L34), lines 34–34.

<a id="evidence-evidence-b8-disallow-eval-flag"></a>
## evidence-b8-disallow-eval-flag

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L6), lines 6–6.

<a id="evidence-evidence-b8-migration-0001-entry"></a>
## evidence-b8-migration-0001-entry

Current source — [db/d1/MIGRATIONS\.json](../../../../../db/d1/MIGRATIONS.json#L6), lines 6–6.

<a id="evidence-evidence-b8-migration-0034-entry"></a>
## evidence-b8-migration-0034-entry

Current source — [db/d1/MIGRATIONS\.json](../../../../../db/d1/MIGRATIONS.json#L171), lines 171–171.

<a id="evidence-evidence-b8-toplevel-migrations-dir"></a>
## evidence-b8-toplevel-migrations-dir

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L19), lines 19–20.

<a id="evidence-evidence-b8-production-migrations-dir"></a>
## evidence-b8-production-migrations-dir

Current source — [apps/api/wrangler\.toml](../../../../../apps/api/wrangler.toml#L580), lines 580–581.

<a id="evidence-evidence-b8-db-local-apply"></a>
## evidence-b8-db-local-apply

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L32), lines 32–32.

<a id="evidence-evidence-b8-smoke-numeric-order"></a>
## evidence-b8-smoke-numeric-order

Current source — [contracts/smoke\_check\.py](../../../../../contracts/smoke_check.py#L34), lines 34–34.

<a id="evidence-evidence-b8-ledger-0032-prep-note"></a>
## evidence-b8-ledger-0032-prep-note

Current source — [db/d1/MIGRATIONS\.json](../../../../../db/d1/MIGRATIONS.json#L216), lines 216–216.

<a id="evidence-evidence-b8-ledger-0033-apply-note"></a>
## evidence-b8-ledger-0033-apply-note

Current source — [db/d1/MIGRATIONS\.json](../../../../../db/d1/MIGRATIONS.json#L218), lines 218–218.

<a id="evidence-evidence-b8-ledger-correction"></a>
## evidence-b8-ledger-correction

Current source — [db/d1/MIGRATIONS\.json](../../../../../db/d1/MIGRATIONS.json#L219), lines 219–219.

<a id="evidence-evidence-b8-0034-production-apply"></a>
## evidence-b8-0034-production-apply

Recorded observation: 2026-09-13T22:29:40.000Z — [docs/reviews/2026\-09\-13\-migration\-0034\-apply\.md](../../../../../docs/reviews/2026-09-13-migration-0034-apply.md#L18), lines 18–18.

<a id="evidence-evidence-b8-content-release-route"></a>
## evidence-b8-content-release-route

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L132), lines 132–132.

<a id="evidence-evidence-b8-internal-service-auth"></a>
## evidence-b8-internal-service-auth

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L108), lines 108–109.

<a id="evidence-evidence-b8-internal-prefix"></a>
## evidence-b8-internal-prefix

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L125), lines 125–125.

<a id="evidence-evidence-b8-content-release-generated-validators"></a>
## evidence-b8-content-release-generated-validators

Current source — [apps/api/src/services/content\-release\.ts](../../../../../apps/api/src/services/content-release.ts#L402), lines 402–403.

<a id="evidence-evidence-b8-bundle-hash-check"></a>
## evidence-b8-bundle-hash-check

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L247), lines 247–247.

<a id="evidence-evidence-b8-signature-check"></a>
## evidence-b8-signature-check

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L258), lines 258–258.

<a id="evidence-evidence-b8-content-graph-check"></a>
## evidence-b8-content-graph-check

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L263), lines 263–263.

<a id="evidence-evidence-b8-object-hash-check"></a>
## evidence-b8-object-hash-check

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L266), lines 266–266.

<a id="evidence-evidence-b8-release-canonical-bytes"></a>
## evidence-b8-release-canonical-bytes

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L349), lines 349–349.

<a id="evidence-evidence-b8-release-r2-create-only"></a>
## evidence-b8-release-r2-create-only

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L354), lines 354–354.

<a id="evidence-evidence-b8-release-version-immutable"></a>
## evidence-b8-release-version-immutable

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L277), lines 277–277.

<a id="evidence-evidence-b8-release-bytes-reused"></a>
## evidence-b8-release-bytes-reused

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L293), lines 293–293.

<a id="evidence-evidence-apps-api-routes-content-releases-ts"></a>
## evidence-apps-api-routes-content-releases-ts

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L273), lines 273–273.

<a id="evidence-evidence-b8-pending-fixture-ids"></a>
## evidence-b8-pending-fixture-ids

Current source — [apps/api/src/services/content\-release\.ts](../../../../../apps/api/src/services/content-release.ts#L962), lines 962–962.

<a id="evidence-evidence-b8-fixture-hold-branch"></a>
## evidence-b8-fixture-hold-branch

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L423), lines 423–423.

<a id="evidence-evidence-b8-release-row-submitted"></a>
## evidence-b8-release-row-submitted

Current source — [apps/api/src/db/content\-releases\.ts](../../../../../apps/api/src/db/content-releases.ts#L244), lines 244–244.

<a id="evidence-evidence-b8-pending-response"></a>
## evidence-b8-pending-response

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L441), lines 441–441.

<a id="evidence-evidence-b8-pending-status"></a>
## evidence-b8-pending-status

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L44), lines 44–44.

<a id="evidence-evidence-b8-release-repost-duplicate"></a>
## evidence-b8-release-repost-duplicate

Current source — [apps/api/src/routes/content\-releases\.ts](../../../../../apps/api/src/routes/content-releases.ts#L323), lines 323–323.

<a id="evidence-evidence-b8-pattern-route-generated"></a>
## evidence-b8-pattern-route-generated

Current source — [apps/api/src/routes/pattern\.ts](../../../../../apps/api/src/routes/pattern.ts#L19), lines 19–20.

<a id="evidence-evidence-b8-candidate-boundary-test"></a>
## evidence-b8-candidate-boundary-test

Current source — [scripts/pattern\-release/build\.test\.mjs](../../../../../scripts/pattern-release/build.test.mjs#L280), lines 280–286.

<a id="evidence-evidence-legacy-stub-order"></a>
## evidence-legacy-stub-order

Current source — [apps/api/src/index\.ts](../../../../../apps/api/src/index.ts#L101), lines 101–101.

<a id="evidence-evidence-packages-reading-engine-index-ts"></a>
## evidence-packages-reading-engine-index-ts

Current source — [packages/reading\-engine/src/index\.ts](../../../../../packages/reading-engine/src/index.ts#L13), lines 13–13.

<a id="evidence-evidence-packages-pattern-engine-index-ts"></a>
## evidence-packages-pattern-engine-index-ts

Current source — [packages/pattern\-engine/src/index\.ts](../../../../../packages/pattern-engine/src/index.ts#L9), lines 9–9.

<a id="evidence-evidence-b8-reading-engine-runtime-deps"></a>
## evidence-b8-reading-engine-runtime-deps

Current source — [packages/reading\-engine/package\.json](../../../../../packages/reading-engine/package.json#L21), lines 21–23.

<a id="evidence-evidence-b8-pattern-engine-runtime-deps"></a>
## evidence-b8-pattern-engine-runtime-deps

Current source — [packages/pattern\-engine/package\.json](../../../../../packages/pattern-engine/package.json#L18), lines 18–20.

<a id="evidence-evidence-b8-calc-stub-imports-shared"></a>
## evidence-b8-calc-stub-imports-shared

Current source — [apps/calc\-stub/package\.json](../../../../../apps/calc-stub/package.json#L20), lines 20–20.

<a id="evidence-evidence-b8-api-imports-shared"></a>
## evidence-b8-api-imports-shared

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L42), lines 42–42.

<a id="evidence-evidence-b8-shared-canonical-json"></a>
## evidence-b8-shared-canonical-json

Current source — [packages/shared/src/index\.ts](../../../../../packages/shared/src/index.ts#L273), lines 273–273.

<a id="evidence-evidence-b8-shared-cycle-pass-id"></a>
## evidence-b8-shared-cycle-pass-id

Current source — [packages/shared/src/index\.ts](../../../../../packages/shared/src/index.ts#L243), lines 243–243.

<a id="evidence-evidence-b8-shared-mesh-claim-v2"></a>
## evidence-b8-shared-mesh-claim-v2

Current source — [packages/shared/src/portrait\-mesh\-protocol\.ts](../../../../../packages/shared/src/portrait-mesh-protocol.ts#L272), lines 272–272.

<a id="evidence-evidence-apps-calc-stub-package-json"></a>
## evidence-apps-calc-stub-package-json

Current source — [apps/calc\-stub/package\.json](../../../../../apps/calc-stub/package.json#L5), lines 5–5.

<a id="evidence-evidence-packages-shared-package-json"></a>
## evidence-packages-shared-package-json

Current source — [packages/shared/package\.json](../../../../../packages/shared/package.json#L6), lines 6–6.

<a id="evidence-evidence-b8-shared-license-pending"></a>
## evidence-b8-shared-license-pending

Current source — [packages/shared/package\.json](../../../../../packages/shared/package.json#L5), lines 5–5.

<a id="evidence-evidence-b8-engines-outside-shared"></a>
## evidence-b8-engines-outside-shared

Current source — [packages/reading\-engine/package\.json](../../../../../packages/reading-engine/package.json#L5), lines 5–5.

<a id="evidence-evidence-unresolved-license-boundary"></a>
## evidence-unresolved-license-boundary

Current source — [LICENSING\.md](../../../../../LICENSING.md#L35), lines 35–35.

<a id="evidence-evidence-shared-license-decision"></a>
## evidence-shared-license-decision

Current source — [docs/legal/SWISS\_EPHEMERIS\_LICENSE\_DECISION\.md](../../../../../docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md#L126), lines 126–126.

<a id="evidence-evidence-b8-canary-https-origin"></a>
## evidence-b8-canary-https-origin

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L35), lines 35–35.

<a id="evidence-evidence-b8-canary-native-fetch"></a>
## evidence-b8-canary-native-fetch

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L80), lines 80–80.

<a id="evidence-evidence-b8-canary-public-checks"></a>
## evidence-b8-canary-public-checks

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L82), lines 82–87.

<a id="evidence-evidence-b8-canary-place-search"></a>
## evidence-b8-canary-place-search

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L88), lines 88–88.

<a id="evidence-evidence-b8-canary-daily-readback"></a>
## evidence-b8-canary-daily-readback

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L93), lines 93–93.

<a id="evidence-evidence-b8-canary-usage-file"></a>
## evidence-b8-canary-usage-file

Current source — [scripts/pattern\-release/operational\-canary\.mjs](../../../../../scripts/pattern-release/operational-canary.mjs#L115), lines 115–115.

<a id="evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2"></a>
## evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-2

Current source — [scripts/pattern\-release/fresh\-reading\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-reading-evaluation.mjs#L67), lines 67–67.

<a id="evidence-evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs"></a>
## evidence-scripts-pattern-release-fresh-pattern-evaluation-mjs

Current source — [scripts/pattern\-release/fresh\-pattern\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-pattern-evaluation.mjs#L51), lines 51–51.

<a id="evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2"></a>
## evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-2

Current source — [scripts/pattern\-release/fresh\-pattern\-verifier\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-pattern-verifier-evaluation.mjs#L187), lines 187–187.

<a id="evidence-evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3"></a>
## evidence-scripts-pattern-release-fresh-reading-evaluation-mjs-3

Current source — [scripts/pattern\-release/fresh\-reading\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-reading-evaluation.mjs#L123), lines 123–123.

<a id="evidence-evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3"></a>
## evidence-scripts-pattern-release-fresh-pattern-verifier-evaluation-mjs-3

Current source — [scripts/pattern\-release/fresh\-pattern\-verifier\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-pattern-verifier-evaluation.mjs#L265), lines 265–265.

<a id="evidence-evidence-b8-full-packet-exact-profile"></a>
## evidence-b8-full-packet-exact-profile

Current source — [scripts/pattern\-release/full\-packet\-profiles\.mjs](../../../../../scripts/pattern-release/full-packet-profiles.mjs#L396), lines 396–396.

<a id="evidence-evidence-b8-full-packet-writes-fixture"></a>
## evidence-b8-full-packet-writes-fixture

Current source — [scripts/pattern\-release/full\-packet\-profiles\.mjs](../../../../../scripts/pattern-release/full-packet-profiles.mjs#L440), lines 440–440.

<a id="evidence-evidence-b8-corpus-full-packet-sizes"></a>
## evidence-b8-corpus-full-packet-sizes

Current source — [apps/api/test/fixtures/reading\-evaluation\-corpus\.json](../../../../../apps/api/test/fixtures/reading-evaluation-corpus.json#L10), lines 10–10.

<a id="evidence-evidence-b8-fresh-daily-case-per-profile"></a>
## evidence-b8-fresh-daily-case-per-profile

Current source — [scripts/pattern\-release/fresh\-reading\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-reading-evaluation.mjs#L29), lines 29–29.

<a id="evidence-evidence-b8-fresh-daily-eight-profiles"></a>
## evidence-b8-fresh-daily-eight-profiles

Current source — [scripts/pattern\-release/fresh\-reading\-evaluation\.mjs](../../../../../scripts/pattern-release/fresh-reading-evaluation.mjs#L131), lines 131–131.

<a id="evidence-evidence-b8-release-evidence-runs-gate"></a>
## evidence-b8-release-evidence-runs-gate

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L186), lines 186–186.

<a id="evidence-evidence-b8-release-evidence-receipt-fields"></a>
## evidence-b8-release-evidence-receipt-fields

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L203), lines 203–213.

<a id="evidence-evidence-b8-release-evidence-deployment-unverified"></a>
## evidence-b8-release-evidence-deployment-unverified

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L37), lines 37–37.

<a id="evidence-evidence-b8-release-evidence-current-source"></a>
## evidence-b8-release-evidence-current-source

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L173), lines 173–173.

<a id="evidence-evidence-b8-reconciliation-requires-verified-gate"></a>
## evidence-b8-reconciliation-requires-verified-gate

Current source — [scripts/pattern\-release/release\-reconciliation\.mjs](../../../../../scripts/pattern-release/release-reconciliation.mjs#L132), lines 132–132.

<a id="evidence-evidence-scripts-pattern-release-release-reconciliation-mjs"></a>
## evidence-scripts-pattern-release-release-reconciliation-mjs

Current source — [scripts/pattern\-release/release\-reconciliation\.mjs](../../../../../scripts/pattern-release/release-reconciliation.mjs#L2), lines 2–2.

<a id="evidence-evidence-b8-ci-local-success"></a>
## evidence-b8-ci-local-success

Current source — [scripts/ci\-local\.sh](../../../../../scripts/ci-local.sh#L163), lines 163–163.

<a id="evidence-evidence-b8-parse-ci-summary-em-dash"></a>
## evidence-b8-parse-ci-summary-em-dash

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L95), lines 95–107.

<a id="evidence-evidence-b8-gate-summary-incomplete"></a>
## evidence-b8-gate-summary-incomplete

Current source — [scripts/pattern\-release/release\-evidence\.mjs](../../../../../scripts/pattern-release/release-evidence.mjs#L162), lines 162–162.

<a id="evidence-evidence-package-json"></a>
## evidence-package-json

Current source — [package\.json](../../../../../package.json#L20), lines 20–20.

<a id="evidence-evidence-scripts-ci-local-sh"></a>
## evidence-scripts-ci-local-sh

Current source — [scripts/ci\-local\.sh](../../../../../scripts/ci-local.sh#L113), lines 113–113.

<a id="evidence-evidence-b8-test-contracts-script"></a>
## evidence-b8-test-contracts-script

Current source — [package\.json](../../../../../package.json#L18), lines 18–18.

<a id="evidence-evidence-b8-ci-local-install-and-ephemeris"></a>
## evidence-b8-ci-local-install-and-ephemeris

Current source — [scripts/ci\-local\.sh](../../../../../scripts/ci-local.sh#L116), lines 116–128.

<a id="evidence-evidence-b8-ci-local-monorepo-steps"></a>
## evidence-b8-ci-local-monorepo-steps

Current source — [scripts/ci\-local\.sh](../../../../../scripts/ci-local.sh#L133), lines 133–140.

<a id="evidence-evidence-b8-root-build"></a>
## evidence-b8-root-build

Current source — [package\.json](../../../../../package.json#L12), lines 12–12.

<a id="evidence-evidence-b8-api-build-dry-run"></a>
## evidence-b8-api-build-dry-run

Current source — [apps/api/package\.json](../../../../../apps/api/package.json#L17), lines 17–17.

<a id="evidence-evidence-b8-calc-stub-pretest-download"></a>
## evidence-b8-calc-stub-pretest-download

Current source — [apps/calc\-stub/package\.json](../../../../../apps/calc-stub/package.json#L13), lines 13–13.

<a id="evidence-evidence-b8-calc-stub-test-glob"></a>
## evidence-b8-calc-stub-test-glob

Current source — [apps/calc\-stub/package\.json](../../../../../apps/calc-stub/package.json#L15), lines 15–16.

<a id="evidence-evidence-b8-ci-local-extra-steps"></a>
## evidence-b8-ci-local-extra-steps

Current source — [scripts/ci\-local\.sh](../../../../../scripts/ci-local.sh#L147), lines 147–149.

<a id="evidence-evidence-agents-md-2"></a>
## evidence-agents-md-2

Current source — [AGENTS\.md](../../../../../AGENTS.md#L33), lines 33–33.

<a id="evidence-evidence-b8-agents-paste-summary"></a>
## evidence-b8-agents-paste-summary

Current source — [AGENTS\.md](../../../../../AGENTS.md#L33), lines 33–33.

<a id="evidence-evidence-b8-agents-actions-billing"></a>
## evidence-b8-agents-actions-billing

Current source — [AGENTS\.md](../../../../../AGENTS.md#L31), lines 31–31.

<a id="evidence-evidence-b8-agents-main-unprotected"></a>
## evidence-b8-agents-main-unprotected

Current source — [AGENTS\.md](../../../../../AGENTS.md#L31), lines 31–31.

<a id="evidence-evidence-b8-agents-workers-builds"></a>
## evidence-b8-agents-workers-builds

Current source — [AGENTS\.md](../../../../../AGENTS.md#L51), lines 51–51.

<a id="evidence-evidence-b8-claude-migration-before-push"></a>
## evidence-b8-claude-migration-before-push

Current source — [CLAUDE\.md](../../../../../CLAUDE.md#L62), lines 62–63.

<a id="evidence-evidence-b8-readme-release-path"></a>
## evidence-b8-readme-release-path

Current source — [README\.md](../../../../../README.md#L425), lines 425–427.

<a id="evidence-evidence-b8-release-runbook-not-applied"></a>
## evidence-b8-release-runbook-not-applied

Current source — [docs/deploy/release\-attestation\.md](../../../../../docs/deploy/release-attestation.md#L30), lines 30–31.

<a id="evidence-evidence-b8-root-workspaces"></a>
## evidence-b8-root-workspaces

Current source — [package\.json](../../../../../package.json#L6), lines 6–9.

<a id="evidence-evidence-b8-promptfoo-boundary"></a>
## evidence-b8-promptfoo-boundary

Current source — [evals/promptfoo/README\.md](../../../../../evals/promptfoo/README.md#L3), lines 3–8.

<a id="evidence-evidence-b8-promptfoo-echo-lane"></a>
## evidence-b8-promptfoo-echo-lane

Current source — [evals/promptfoo/promptfooconfig\.validators\.yaml](../../../../../evals/promptfoo/promptfooconfig.validators.yaml#L4), lines 4–4.

<a id="evidence-evidence-b8-promptfoo-daily-script"></a>
## evidence-b8-promptfoo-daily-script

Current source — [evals/promptfoo/package\.json](../../../../../evals/promptfoo/package.json#L14), lines 14–14.

<a id="evidence-evidence-b8-promptfoo-codex-transport"></a>
## evidence-b8-promptfoo-codex-transport

Current source — [evals/promptfoo/providers/codex\-isolated\.mjs](../../../../../evals/promptfoo/providers/codex-isolated.mjs#L65), lines 65–65.

<a id="evidence-evidence-b8-promptfoo-plan-source"></a>
## evidence-b8-promptfoo-plan-source

Current source — [evals/promptfoo/lib/daily\-plan\.mjs](../../../../../evals/promptfoo/lib/daily-plan.mjs#L45), lines 45–45.

<a id="evidence-evidence-b8-promptfoo-test-per-case"></a>
## evidence-b8-promptfoo-test-per-case

Current source — [evals/promptfoo/tests/daily\-profiles\.mjs](../../../../../evals/promptfoo/tests/daily-profiles.mjs#L12), lines 12–12.

<a id="evidence-evidence-b8-promptfoo-readme-six"></a>
## evidence-b8-promptfoo-readme-six

Current source — [evals/promptfoo/README\.md](../../../../../evals/promptfoo/README.md#L16), lines 16–16.

<a id="evidence-evidence-b8-promptfoo-exploration-evidence"></a>
## evidence-b8-promptfoo-exploration-evidence

Current source — [evals/promptfoo/README\.md](../../../../../evals/promptfoo/README.md#L31), lines 31–32.

<a id="evidence-evidence-b8-map-scripts"></a>
## evidence-b8-map-scripts

Current source — [package\.json](../../../../../package.json#L30), lines 30–32.

<a id="evidence-evidence-b8-root-test-lanes"></a>
## evidence-b8-root-test-lanes

Current source — [package\.json](../../../../../package.json#L14), lines 14–14.

<a id="evidence-evidence-b8-map-literal-anchors"></a>
## evidence-b8-map-literal-anchors

Current source — [scripts/source\-map/snapshot\.mjs](../../../../../scripts/source-map/snapshot.mjs#L88), lines 88–90.

<a id="evidence-evidence-b8-map-capture-refuses"></a>
## evidence-b8-map-capture-refuses

Current source — [scripts/source\-map/snapshot\.mjs](../../../../../scripts/source-map/snapshot.mjs#L138), lines 138–138.

<a id="evidence-evidence-b8-map-definition-and-snapshots"></a>
## evidence-b8-map-definition-and-snapshots

Current source — [scripts/source\-map/model\.mjs](../../../../../scripts/source-map/model.mjs#L2), lines 2–3.

<a id="evidence-evidence-b8-map-check-changes"></a>
## evidence-b8-map-check-changes

Current source — [scripts/source\-map/snapshot\.mjs](../../../../../scripts/source-map/snapshot.mjs#L195), lines 195–197.

<a id="evidence-evidence-b4-correction-history-guards"></a>
## evidence-b4-correction-history-guards

Current source — [apps/api/src/services/pattern\-packet\.ts](../../../../../apps/api/src/services/pattern-packet.ts#L746), lines 746–753.

<a id="evidence-evidence-b4-correction-history-projection"></a>
## evidence-b4-correction-history-projection

Current source — [apps/api/src/services/pattern\-packet\.ts](../../../../../apps/api/src/services/pattern-packet.ts#L760), lines 760–770.

<a id="evidence-evidence-b4-correction-history-deduplication"></a>
## evidence-b4-correction-history-deduplication

Current source — [apps/api/src/services/pattern\-packet\.ts](../../../../../apps/api/src/services/pattern-packet.ts#L800), lines 800–810.

<a id="evidence-evidence-b6-pattern-writer-grounding-policy"></a>
## evidence-b6-pattern-writer-grounding-policy

Current source — [apps/api/src/services/pattern\-prompt\.ts](../../../../../apps/api/src/services/pattern-prompt.ts#L383), lines 383–397.

<a id="evidence-evidence-b6-pattern-writer-historical-policies"></a>
## evidence-b6-pattern-writer-historical-policies

Current source — [apps/api/src/services/pattern\-prompt\.ts](../../../../../apps/api/src/services/pattern-prompt.ts#L512), lines 512–518.

<a id="evidence-evidence-b8-ci-summary-integration-test"></a>
## evidence-b8-ci-summary-integration-test

Current source — [scripts/pattern\-release/release\-evidence\.test\.mjs](../../../../../scripts/pattern-release/release-evidence.test.mjs#L122), lines 122–141.

<a id="evidence-evidence-b4-correction-history-reuse"></a>
## evidence-b4-correction-history-reuse

Current source — [apps/api/src/services/pattern\-execute\.ts](../../../../../apps/api/src/services/pattern-execute.ts#L1442), lines 1442–1449.
