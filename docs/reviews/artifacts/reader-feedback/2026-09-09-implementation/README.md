# Reader feedback: local implementation evidence

Date: 2026-09-09. Worktree: `codex/source-map-maintenance`. Scope: Slice 5A existing resonance on Today and Slice 5B categorical feedback client. [Implementation plan](../../../../superpowers/plans/2026-09-09-reader-feedback-implementation.md). [Unfilled human-review worksheet](human-review-worksheet.md).

These captures show the actual React application at `http://127.0.0.1:5173`, using fictional, contract-shaped responses intercepted at the browser API boundary. Every `/v1/` request, including feedback, check-in, Today preparation, and device-preference writes, was fulfilled by the temporary browser fixture. The request logs record those simulated requests; they are not evidence of real storage, granted permission, encryption, publication, or generation. The birth-correction check opens the existing form and returns without submitting it. No live account, provider call, production migration, deployment, participant contact, human quality score, or comprehension result is represented here.

## Observed browser behavior

Both runs used Chromium at 1440 × 1000 and 390 × 844 with reduced motion requested. Browser plugin was unavailable, so the existing temporary Playwright installation, Chromium, libraries, and Fontconfig configuration under `/tmp/patternlike-reader-journey-qa` were reused. No browser dependency, package command, verification gate, or mandatory tooling was added.

| Evidence | Observed behavior |
| --- | --- |
| [5A results](5a-resonance-browser-results.json) | Today feedback and check-in are independent; keyboard selection and an optional note produce the correct reading-specific request; submitting either form leaves the reading unchanged; History reloads the same edition's resonance receipt. |
| [5B results](5b-categorical-browser-results.json) | Categorical feedback submits the server-provided edition/hash and explicit grant precondition without a fabricated resonance value; check-in submits separately; History reloads the same categorical receipt; the birth-details link opens the existing correction form and browser Back returns to History without a correction or grant write. |

Both viewports passed page identity, nonblank content, no framework overlay, target interactions, and horizontal-overflow checks. The recorded application error, warning, and unexpected-route lists are empty. Axe WCAG A/AA checks found no violations in the final History detail states, before navigating to birth correction. These checks cover the recorded states, not the whole application, physical devices, assistive-technology use, or human comprehension.

The 5B desktop fixture says `grant_action: create` and `generation_effects_active: false`; the mobile fixture says `grant_action: renew` and `generation_effects_active: true`. Their different copy intentionally exercises both cases. The mobile screenshot does not establish that the production compiler is enabled or that a response affected a generated reading. Both submissions use the fictional note “A fictional QA note.”

## Selected captures

| State | Desktop | Mobile |
| --- | --- | --- |
| 5A existing feedback beside check-in | [Forms](5a-forms-desktop.png) | [Forms](5a-forms-mobile.png) |
| 5A separate receipts | [Receipts](5a-receipts-desktop.png) | [Receipts](5a-receipts-mobile.png) |
| 5B categorical options and permission explanation | [Options](5b-forms-desktop.png) | [Options](5b-forms-mobile.png) |
| 5B categorical receipt and separate check-in | [Receipts](5b-receipts-desktop.png) | [Receipts](5b-receipts-mobile.png) |
| 5B same edition reopened in History | [History](5b-history-desktop.png) | [History](5b-history-mobile.png) |
| Existing birth-correction form, unsubmitted | [Correction](5b-correction-desktop.png) | [Correction](5b-correction-mobile.png) |

The screenshots include the separately implemented check-in clarification: 24-hour freshness, storage for up to 13 months, and no guaranteed selection for a later reading. The 5A captures precede the categorical client; the 5B captures represent its subsequent local implementation. The [connected reader journey evidence](../../reader-journey/2026-09-09-authorized-implementation/README.md) remains a separate record of Today → explanation → exact Pattern → Timing → saved Daily navigation.

## Focused verification record

The 5A run passed **80 tests in six existing web files**. The final 5A/5B run passed **96 tests in seven files**, including 15 categorical-client tests and the application birth-correction navigation test. Web typecheck and `git diff --check` passed. The 96 includes the affected earlier suites; it is not an additional 96 independent cases on top of 80.

The focused component coverage includes exact edition/paragraph targeting and receipt rejection, create/reuse/renew permission explanations, a changed-grant `409` that refreshes options without automatic resubmission, original-payload/idempotency-key retry, another response reloading current permission, expired effects versus retained storage, source-change aborts, authentication handoff, legacy compatibility, unchanged reading/check-in independence, receipt focus, and focus on refreshed options. Backend persistence, cryptography, authorization, lifecycle, and compiler verification belong to their owning API suites, not these browser results.

Executed from the repository root with Node 22.23.2:

```sh
npm test --workspace=@patternlike/web -- src/components/ReadingArticle.test.tsx src/components/ReadingFeedbackCard.test.tsx src/components/ReadingConnections.test.tsx src/components/DailyCheckInCard.test.tsx src/components/HistoryView.test.tsx src/App.test.tsx

npm test --workspace=@patternlike/web -- src/components/ReadingResponseCard.test.tsx src/components/ReadingArticle.test.tsx src/components/ReadingFeedbackCard.test.tsx src/components/ReadingConnections.test.tsx src/components/DailyCheckInCard.test.tsx src/components/HistoryView.test.tsx src/App.test.tsx

npm run typecheck --workspace=@patternlike/web
git diff --check
```

The [5A browser script](5a-resonance-browser-check.mjs) and [5B browser script](5b-categorical-browser-check.mjs) are unchanged copies of the temporary scripts used for the observations. Their import resolution and local paths belong to that temporary environment; they are retained as execution evidence, not installed repository test commands. The original invocations were:

```sh
FONTCONFIG_FILE=/tmp/patternlike-reader-journey-qa/fonts.conf \
LD_LIBRARY_PATH=/tmp/patternlike-reader-journey-qa/libs/extracted/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/patternlike-reader-journey-qa/browsers \
PATH=/home/henry/.nvm/versions/node/v22.23.2/bin:$PATH \
node /tmp/patternlike-reader-journey-qa/feedback-check.mjs

FONTCONFIG_FILE=/tmp/patternlike-reader-journey-qa/fonts.conf \
LD_LIBRARY_PATH=/tmp/patternlike-reader-journey-qa/libs/extracted/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/patternlike-reader-journey-qa/browsers \
PATH=/home/henry/.nvm/versions/node/v22.23.2/bin:$PATH \
node /tmp/patternlike-reader-journey-qa/categories-check.mjs
```

The first browser launch attempts lacked the temporary library and font configuration, causing a Chromium startup/font failure. The completed observations above used both settings. Visual inspection found no new clipping or overlap in the selected desktop/mobile states. The design detector reported only advisory 13px typography differences from the documented ramp; 13px was preserved to match the existing feedback/check-in interface.

Saving this evidence and preparing the worksheet ran no application tests or browser session again. No human adjudication, reader-benefit conclusion, or recruitment is implied.
