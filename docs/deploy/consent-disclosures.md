# Consent and claim copy correction — 2026-09-06

The signed-out explanation reserves calculation provenance for chart positions
and identifies interpretations as generated reflection that can be mistaken.
Pattern's `checking_claims` stage is displayed as “Checking the draft.” This
names the operation without claiming exhaustive verification of every sentence.

Daily and Pattern terms remain shared between their generation gates and
Context & Privacy, through
[`AiConsent.tsx`](../../apps/web/src/components/AiConsent.tsx) and
[`PatternConsent.tsx`](../../apps/web/src/components/PatternConsent.tsx).
The Daily purpose statement describes Pattern/Like's purpose for sending the
enabled content. It no longer asserts that OpenAI uses it for nothing else.
The training-off requirement is identified as Pattern/Like's policy; granting
consent does not verify the actual provider-account setting. Provider retention
and data use depend on the applicable account/workspace agreement and controls.
Those account-specific observations remain open in the
[provider privacy evidence record](./codex-provider-privacy-evidence.md).

Pattern planning, writing, checking, and bounded retries involve multiple
provider requests for the same generation purpose. The input categories,
exclusions, uncertainty disclosure, and withdrawal/readability behavior stay
distinct from Daily synthesis, research, model training, and portrait consent.
Granting Pattern consent does not alter separate research or training settings.

## What application retention means

The disclosure follows
[`codex-provider-maintenance.ts`](../../apps/api/src/services/codex-provider-maintenance.ts)
and the 30-day `PATTERN_ARTIFACT_RETENTION_DAYS` constant in
[`pattern-publisher.ts`](../../apps/api/src/services/pattern-publisher.ts):

- A Daily provider job must be `completed`, `failed`, or `cancelled` with a
  `completed_at` value. Its encrypted exchange becomes eligible for routine
  cleanup only after no queued/running Daily owner with a pending reading still
  needs it. Provider completion alone does not make the response expendable.
- A Pattern provider job must be terminal with `completed_at` at least 30 days
  before the maintenance clock. This clock belongs to each provider request,
  including planner, writer, and verifier attempts. It is not 30 days after the
  overall Pattern was accepted, and no immediate deletion at overall completion
  is promised.
- Both paths also check that the provider owner is no longer current and that
  uncommitted response uploads do not remain. Maintenance is bounded to 50
  eligible candidates per pipeline per pass. Pending uploads, backlog, or a
  failed deletion can delay physical removal.
- Cleanup deletes the referenced objects, checks that they are absent, then
  removes the provider job row. A failure retains the inventory for retry.
  Account erasure includes provider requests, responses, and response uploads
  in [`deletion-manifest.ts`](../../apps/api/src/services/deletion-manifest.ts)
  and can remove these user-owned artifacts earlier; the 30 days describe routine
  retention, not a minimum erasure delay.

These are source-backed application rules. They do not prove that a production
cleanup pass ran or that an upstream provider removed its own copies.

## Consent policy assessment

Both existing `1.1.0` policy identifiers are retained for this correction.
No processor, purpose, data category, allowed use, provider route, retention
implementation, or authorization rule changes here. The inaccurate copy is
corrected to describe the existing path; no grant is rewritten, withdrawn,
silently expanded, or forced through a reset. The date and source revision of
this correction should travel with the eventual release evidence.

This records the engineering scope and does not attest that the previous copy
was accurate. A future change to permitted processing or categories requires
its own consent-policy assessment and any required fresh grant; current-account
privacy assertions still require the external evidence listed above.
