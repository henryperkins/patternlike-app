# Readiness evidence — 2026-09-11

These captures use real application components and fictional API fixtures on a local Vite server. Browser plugin tools were unavailable; cached Playwright/Chromium supplied the browser. All tests used reduced motion and temporary local fonts/libraries. No real account, provider generation, correction, consent change or deletion occurred.

- [Pattern matrix](readiness-report.json): 3–6 long chapters at 1440×1000 and 390×844. Optional artwork failure does not hide accepted text. Failed replacement plus contradictory retry eligibility offers no write; failed status reload uses GET and retains the reading DOM. No overflow, page errors or unexpected API routes.
- [Today/History and correction](categories-report.json): keyboard response plus independent check-in, exact-edition receipt, History Axe A/AA, and final correction consequences. Advancing the browser clock by 61 seconds disables correction; a GET refresh restores known consequences while retaining entered date/time, consent choice and form DOM. No correction request was submitted. The fixture deliberately shows both effects-off and effects-eligible receipt wording; it does not describe deployed flag state.
- [Diagnostic simulation](diagnostic-simulation.json): real monotonic timings for two in-memory GET fixture inspections and scripted successful follow-up responses. No repair was performed; parser/render turnaround is not human diagnosis, provider latency or production incident recovery.

Representative screenshots:

| Desktop | Mobile |
| --- | --- |
| [Retained complete reading](pattern-1440-4-ready.png) | [Unavailable update refresh](pattern-390-6-unavailable.png) |
| [Correction consequences](correction-1440-consequences.png) | [Correction consequences](correction-390-consequences.png) |

Local harnesses and raw logs are in `/tmp/patternlike-readiness-browser/`. Early harness attempts needed a correct final-step checkbox interaction and the existing geocoder-consent GET fixture; those fixture/selector changes are distinct from product fixes. The Pattern harness asserts GET-only status refresh separately from the application's initial device preference writes.

Physical-device behavior, arbitrary browser engines, production authentication and empirical reader comprehension remain unmeasured. The existing web suite separately covers WebGL recovery and source-bound navigation. See the [results](../../2026-09-11-readiness-metrics-results.md) for implementation, review and deployment boundaries.
