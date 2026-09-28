# Adaptive portrait admission (2026-09-28)

This record covers step 6 of the
[adaptive artwork rollout](../deploy/adaptive-portrait-artwork.md): committed
`[env.production.vars]` sets `PATTERN_ADAPTIVE_PORTRAITS_ENABLED = "1"`. The
default block keeps `"0"`. The owner approved the change on 2026-09-28, after
the reader-facing line "Optional artwork is unavailable. Your complete reading
remains available." was traced to this switch.

## Why readers saw the unavailable line

- The web client sends `X-Patternlike-Portrait-Protocol: v2` on every artwork
  read (`apps/web/src/lib/api-client.ts`, `portraitRequestHeaders`).
- For a Pattern with no portrait row, `readPortraitContent` answers
  `unavailable` while adaptive admission is off, instead of `not_started`,
  because a create action would fail with `503 adaptive_portrait_unavailable`
  (`apps/api/src/services/pattern-portrait.ts`).
- `readPortraitExplorer` passes that on as `status: "unavailable"`, and
  `AccountPortraitExplorer` renders the line for that status. This held for
  every Pattern without an existing reservation, including four-chapter ones,
  because the browser no longer speaks v1.

## Preconditions (read-only, 2026-09-28 UTC)

| Check | Observation |
| --- | --- |
| Live Worker before the change | Version `861b3924-1ac6-4ddb-990b-21707b0ef8bc` at 100%, created 11:29:19 UTC, `RELEASE_GIT_SHA` `ee8794d…`. Bindings: `PATTERN_PORTRAIT_ENABLED "1"`, `PATTERN_PORTRAIT_MESH_ENABLED "1"`, `PATTERN_ADAPTIVE_PORTRAITS_ENABLED "0"`, `ARTIFACTS` bound. |
| Migration ledger | `d1_migrations` holds 34 rows; the latest is `0034_daily_reading_quality_observations.sql`. `0033_adaptive_portrait_artwork.sql` was applied at `2026-09-11 19:59:19`. |
| Runner capability negotiation | A production `wrangler tail` from 12:47:36 to 12:49:04 UTC, filtered to `/codex-provider/` paths, keeping only method, path, status and the protocol header. Every `POST /codex-provider/v1/portraits/claim` and `POST /codex-provider/v1/portrait-meshes/claim` carried `X-Patternlike-Portrait-Protocol: v2` and answered `204`. `POST /codex-provider/v1/jobs/claim` (text) polled every cycle and answered `204`. |
| Runner artifact | Not verified. The runner host is separate from the host that ran these checks, so the installed artifact hash and `codex --version` are not recorded here. Advertising v2 is protocol-capability evidence, not proof of a particular build. |
| Artwork state (aggregate counts only) | Two Pattern documents exist, and neither has a portrait row. Existing portraits: one v1 (4 chapters) and one v2 (6 chapters), both `cancelled`. All 10 image jobs and all 10 mesh jobs are `cancelled`. Automation grants: one `2.0.0` enabled, one `1.1.0` enabled, two `1.1.0` disabled. Start outbox: one `pending`, one `unsupported`, four `cancelled`. |

## Expected effect when the new Worker serves traffic

- Both current Patterns move from `unavailable` to `not_started`, or to
  `generating` where an automation grant applies. `not_started` offers the
  explicit policy `2.0.0` create action to a reader with live grants.
- The one `pending` start entry belongs to the enabled `2.0.0` automation grant
  and points at an existing current Pattern with no portrait row. The runner's
  next empty mesh claim, or the `*/15` maintenance lane, retries it and now
  reserves a v2 portrait: one image job per chapter, then one mesh job per
  chapter. That reader opted in explicitly, and this is the consented
  end-to-end canary the rollout requires. While admission was off, the entry
  stayed pending because `adaptive_portrait_unavailable` is not one of the
  errors that cancel an outbox entry.

## Rollback

Set the production value back to `"0"` and merge; a push to `main` deploys.
Turning admission off stops only new v2 reservations. Reserved v2 work keeps
completing, and reads, downloads and cleanup continue. It does not revoke any
reader's consent, and it erases no assets.
