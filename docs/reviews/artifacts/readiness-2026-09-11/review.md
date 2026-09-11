# Independent review disposition — 2026-09-11

Separate AI reviewers inspected the metric implementation and the diagnostic/prose and UI changes against the approved plan. The metric author cross-reviewed diagnostics/prose and UI, which that reviewer did not author. Root inspected the metric correction. Reviews covered actual code and regression assertions, with concrete local reproductions; they are software reviews, not editorial or reader-outcome certification.

| Finding | Resolution and evidence |
| --- | --- |
| P2: valid failed/cancelled provider timestamps suppressed diagnostics | Validate terminal timestamp requirements for completed/failed/cancelled; only successful completion implies accepted output. Regression includes both failed terminal states. |
| P2: known aggregate accepted null measurements and unsupported complete coverage | Enforce measurement/coverage, window, queue/age/exhaustion and publication consistency before rendering. Valid existing fixtures still parse. |
| P2: normal concurrent reservations/completions appeared to be future timestamps | Shared final collection clock, final-window filtering, bounded consistent per-class reads. Real D1 interleavings reproduce the former failure and now pass; actual future times remain unavailable. |
| P2: Daily grant displayed withdrawal receipt | Place the receipt after successful withdrawal; paired grant/withdraw regressions. |
| P2: cancelled initial effect consumed the only Today preparation intent | Preserve the deliberate desired-state PUT intent until a live response settles it. StrictMode/preference cancellation can replay that intent; subsequent refresh/poll uses GET. |
| P2: delayed permission grant submitted a stale correction | Abort and scope the grant→submit→POST→GET chain, recheck observation freshness after grant, and fence chart adoption by request generation/account. Deferred grant, unmount, account change, late POST and late GET regressions preserve the newer chart. |

All six findings are resolved. Final UI re-review of `b1f3fae` found no remaining P0–P2 defect on the reviewed paths. Backend fixes are in `b66a16e` and `1010854`; offline guidance is in `3af7941`. The root's final merge gate still applies to the combined branch.

Focused evidence: diagnostics/policy/tool 18 tests; metric sampler 11 tests; admin/portrait integration 46 tests; Privacy 28 tests; App/Today/correction/client 171 tests. These overlap prior suites and are not an additive test total. Typechecks passed. Raw independent reports and reproduction logs remain under `/tmp/patternlike-*` on the implementation host. Final local CI and deployment outcomes belong in the integration PR.
