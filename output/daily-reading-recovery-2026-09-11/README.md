# Daily recovery and WSL runner — 2026-09-11

This evidence records the production recovery and local runner installation. The
recovery source is included in this commit; the production replacements were
executed against the Worker release that was live at the time and are separate
from the source release.

## Prepared changes

- V2 terminal `execution_error` jobs enter bounded scheduler/first-open replacement using the existing `publisher_unavailable` reason. Predecessor failure records and frozen contracts are preserved.
- Scheduler candidate and queue exceptions emit closed error categories without raw exception text, stacks, or private content.
- Text/mesh JSON execution accepts released Codex CLI versions and retains effective authentication, configuration, and protocol checks. Mesh diagnostic receipts record the observed version. Portrait image provenance contracts are unchanged; image/mesh polling is disabled on this text service.
- Regenerated the Pattern source fingerprint from canonical LF Git source bytes because the shared text transport changed. The fingerprint generator hashes raw bytes; this Windows CRLF checkout still differs from a Linux Git checkout.

## Installed service

- WSL distribution: Ubuntu-26.04; service: `patternlike-codex-runner.service`.
- Service account: `patternlike-codex`; home: `/var/lib/patternlike-codex-runner`.
- Node 22.23.2; Codex installed using `@openai/codex@latest`, observed version 0.154.0.
- Executables: `/opt/patternlike-codex-runner/bin/node` and `/opt/patternlike-codex-runner/bin/codex`.
- Bundle: `/opt/patternlike-codex-runner/dist`; release: `/opt/patternlike-codex-runner/releases/2026-09-11-latest-codex`.
- Service enabled and active. Windows scheduled task `PatternlikeCodexRunnerWSL` keeps WSL active and starts at this user's logon. Generation requires this machine to remain awake and WSL running.
- Dedicated ChatGPT login completed by the user. No authentication stores were inspected or copied.
- Production `SERVICE_AUTH_TOKEN` rotated and stored in ignored `apps/api/.dev.vars`.
- A separate `CODEX_RUNNER_TOKEN` was generated and provisioned to Cloudflare and `/etc/patternlike-codex-runner.env` (root:root, 0600). Tokens are not included in this report.

## Validation

- Final focused API lane: 182/182 tests passed across five suites; API typecheck passed.
- WSL runner suite: 180/180 tests passed on Node 22. After the review correction to mesh receipt provenance, the affected canary regression passed and the runner typecheck/build passed again.
- Actual authenticated Codex 0.154.0 content-free invocation passed through the complete isolated helper with gpt-5.6-sol, xhigh, priority, JSON schema, and provider-reported usage.
- Standalone installed bundle imports passed; service unit validation passed.
- The full Windows `ci:local` gate failed. Its API run started before the final recovery implementation and overlapped edits, so the three API failures are not final-source evidence; the later focused lane passed. Other failures included Windows executable/URL handling, renderer/content hash mismatches, two web timeouts, and the Pattern fingerprint build check. Do not use this run as merge approval. The committed summary above is the durable record; raw logs remain ignored local files.

## Production replacements

- `rdg_26cef2693230fc247f986ff7d17e352a`: operator replacement job `job_20b4f89395d4c4ff12b9dce53cdb3438`; generation 2 published at 2026-09-11T21:04:42.061Z, one job attempt.
- `rdg_8e544ee742bd0140977fcd8e006c740c`: operator replacement job `job_42abd616ca5050e2c2e2a52e7419c7f6`; generation 2 failed `publisher_output_invalid` after two completed provider attempts. The remaining supported generation was submitted with reason `publisher_output_invalid`, producing `job_2178d22b207b72b25016dd178a77a5eb`. Final state is recorded in `production-status.json`.

These outcomes are separate from the undeployed preventive API recovery/logging changes.
## Final production outcome

Verified after 2026-09-11T21:12:13Z: the first named reading is published. The second named reading remains failed at command generation 3: final job `job_2178d22b207b72b25016dd178a77a5eb` ended with `publisher_output_invalid`, attempts 2, at 2026-09-11T21:12:13.227Z. Its last provider call completed successfully, but the Worker logged `grounding / unsupported_uncertainty_disclosure`. See `validation-rejections.json` for the content-free event. The existing generation cap was preserved. This is a separate content-validation failure; it is not evidence that the Ajv crash or installed runner failure remains.

The runner remained active with zero restarts. The production Worker still reports release SHA `f9ad1a025a596428da74778b4c5933c8a8a3c270`; the preventive API patch was not deployed. Resolving the second reading now requires investigating the rejected uncertainty disclosure and an explicit recovery strategy after the cap, rather than another identical replacement request.

Installed bundle SHA-256 values:
- `index.js`: `088ccbd2f1ba1cefbf41782809440d37192c85811d274660238ce389a2e07b17`
- `portrait-mesh-canary.js`: `9a54d010f99545bf3f898309cf5d0faa745ece966a6960f9821ff179eccb7690`
