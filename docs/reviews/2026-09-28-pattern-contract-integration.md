# Pattern and architecture integration — September 28, 2026

## Scope and preservation

The user approved reconciliation of the unmerged work found in the Git audit.
Main was `21f75aee56f1f6c945e55930f31e4d5dd44008c7`; both existing worktrees
were clean and there were no stashes. PR #68 at
`f62296acf0ae3b4cb9ae79fe6279cccab3cbc536` and PR #70 at
`0857d3086815b8a23666d67e721749214b1be1a8` held the remaining branch work.
The branches for PRs #67 and #69 were already merged.

An isolated integration branch retains both PR histories. Before integration,
all Git refs were saved in a verified `before.bundle` with SHA-256, exact remote
tips, worktree and status inventories under the host-local recovery directory
`~/.local/state/patternlike-app/git-reconciliation/2026-09-28T104408Z-integrate-68-70/`.
Historical source-map snapshots and gate receipts are preserved unchanged.

## Integration decisions and review

- Use the shared private/no-store response policy from #70 and remove obsolete
  route-local helper calls left by the automatic merge.
- Retain #68's generation, language, deletion and stale-observation behavior
  while honoring #70's typed artwork state and allowed actions. A stale permission
  reread locks the control, is cancelled on chart/account change, and never
  treats unknown or disallowed state as permission to write.
- Retain the canonical sixteen-lane gate producer/parser and regenerate the
  Pattern creation source fingerprint from the combined inputs.
- Reconcile the maintained map, validate every selector and claim reference,
  and select a new immutable snapshot with clean consumed inputs.

An independent reviewer examined `21f75ae..d67032d` and reported three important
findings, with no critical findings. All three were fixed in `4cf3027`:

| Finding | Fix and regression coverage |
| --- | --- |
| Quiet refresh retained an accepted private reading after a definitive refusal | Process 403/404/409/410 before the temporary-failure fallback; clear document, state, observation and portrait session. Tests cover all four statuses and retain the reading for network/503 failures. |
| A permission write could report the requested value when a concurrent change returned the opposite value | Render the returned state and request a new review of the choice. Tests cover enable returning disabled, disable returning enabled, and disable returning an active legacy grant. |
| Missing birthplace could be labeled as unknown birth time | Use the actual suppression reason in chart anchors. An exact-time missing-place regression distinguishes it from unknown time. |

Eight new regression cases failed against the pre-fix implementation. The focused
component suite then passed **68 tests in four files**, and web typechecking passed.
The ten added cases include two passing temporary-failure retention controls.
Initial test-fixture message expectations were corrected to the API client's
actual public error text. Browser inspection additionally removed duplicate
language guidance and restored shared form styling for the embedded language form.

## Rendered verification

[Browser results](artifacts/2026-09-28-pattern-contract-integration/browser-results.json)
record six passing scenarios using the real React components, stylesheet and API
client with controlled local network responses. Desktop was 1100×820; mobile
was 390×844. The browser plugin was unavailable; installed Playwright drove
headless Chromium with software WebGL.

1. A stale enabled artwork grant can be withdrawn while generation is unavailable.
2. Unknown permission presents a read-only retry and no checkbox or write.
3. A stale enable choice that refreshes to unknown permission issues no write.
4. Language confirmation stays on the Pattern route; generation remains available
   after the observation ages; submission keeps its label and reaches progress.
5. Desktop reading remains mounted through a held quiet refresh; deletion focuses
   its confirmation field, accepts normalized text, and sends the canonical phrase.
6. The same reading and deletion behavior passes at mobile width.

All scenarios had meaningful content, no framework overlay, no horizontal overflow,
and no console/page errors. Desktop software WebGL emitted performance warnings
about screenshot readback. Screenshots were visually inspected, including the
embedded language layout, generation progress, and desktop/mobile deletion forms.
An initial browser fixture used the wrong generation-stage token and button label;
those fixtures were corrected before the complete passing run. Its unavailable
artwork fixture was also corrected to the closed protocol shape.

| Surface | Evidence |
| --- | --- |
| Withdrawal with creation disabled | [Desktop](artifacts/2026-09-28-pattern-contract-integration/withdrawal-desktop.png) |
| Unknown permission | [Mobile](artifacts/2026-09-28-pattern-contract-integration/unknown-mobile.png) |
| Inline language confirmation | [Mobile](artifacts/2026-09-28-pattern-contract-integration/language-mobile.png) |
| Generation progress | [Mobile](artifacts/2026-09-28-pattern-contract-integration/generation-mobile.png) |
| Reading and focused deletion form | [Desktop](artifacts/2026-09-28-pattern-contract-integration/reading-desktop.png), [Mobile](artifacts/2026-09-28-pattern-contract-integration/reading-mobile.png) |

These checks do not establish authenticated end-to-end, real mobile-device,
provider-output, installed-runner, or production behavior. This integration changes
no D1 migration or calculation-service source. The runner admission changes are
source-tested; installed runner rollout is separate evidence.

## Full local merge gate

The final gate receipt and exact summary will be recorded here before merging.
