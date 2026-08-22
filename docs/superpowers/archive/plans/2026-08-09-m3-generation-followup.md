# M3 Generation Follow-up Implementation Plan

> **ARCHIVED 2026-08-22 — complete.** D1 write batching, placeholder-grammar
> validation, canonicalization fixtures, and persistent queue backoff all
> shipped. The unticked boxes below were never ticked back; the behaviour is in
> `apps/api/src`. Do not execute. Index: [`../README.md`](../README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the safe, additive parts of the daily-reading follow-up on top of the already-merged PR #11 hardening, then ship the verified Worker release.

**Architecture:** Preserve PR #11's encrypted-command, consent, idempotency, and bounded-terminal-failure behavior. Add only compatible improvements at independent boundaries: D1 write batching, placeholder grammar validation, canonicalization fixtures, and persistent queue backoff.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers Queues and D1, Python jsonschema validation, npm workspaces.

## Global Constraints

- Use Node 20+ and Python 3.11+ from the repository root.
- Keep frozen M0 contracts unchanged; M3 fixtures must validate through `python contracts/validate_schemas.py`.
- Do not expose chart, context, or command data in Queue messages.
- Preserve the PR #11 claim CAS, retry budget, and terminal state-transition recovery.
- Stage an explicit file allowlist and verify the final immutable PR head before merge and deploy.

---

### Task 1: Strict timing-template placeholder grammar

**Files:**
- Modify: `apps/api/src/services/content-release.ts`
- Modify: `apps/api/src/services/content-release.test.ts`
- Modify: `contracts/validate_schemas.py`
- Modify: `contracts/m3/fixtures/generate_fixtures.py`
- Create: `contracts/m3/fixtures/invalid/content-release.timing-malformed-placeholder.json`

**Interfaces:**
- Consumes: timing template `template_text` and declared `placeholders`.
- Produces: `timing_undeclared_placeholder` for empty, non-lowercase-snake-case, or undeclared braced tokens.

- [x] **Step 1: Write failing runtime and fixture tests**

```ts
expect(validateIngestionRequest(wrap(draftBundle((bundle) => {
  bundle.objects.timing_templates[0]!.template_text = "Closest on {bad-token}.";
}))).error.class).toBe("timing_undeclared_placeholder");
```

- [x] **Step 2: Run the focused runtime test and schema validator; verify the malformed token is currently accepted.**

Run: `npm test -- apps/api/src/services/content-release.test.ts` and `python contracts/validate_schemas.py`

- [x] **Step 3: Implement the grammar at both runtime and fixture-policy boundaries**

```ts
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const PLACEHOLDER_TOKEN_RE = /^[a-z_]+$/;
```

- [x] **Step 4: Re-run both commands and verify they pass.**

### Task 2: Canonicalization fixture correction and bounded cycle persistence

**Files:**
- Modify: `apps/api/src/db/cycles.ts`
- Modify: `apps/api/src/db/cycles.test.ts`
- Modify: `contracts/m3/fixtures/canonicalization/cycle-derivation-golden-vectors.json`
- Modify: `contracts/m3/fixtures/generate_fixtures.py`
- Modify: `packages/shared/src/cycle-derivation.test.ts`
- Modify: `contracts/validate_schemas.py`

**Interfaces:**
- Consumes: scanned `NormalizedCycle[]` and canonical golden vectors.
- Produces: at-most-100-statement D1 batches and vectors where `rendered_id` is optional for hash-only identities.

- [x] **Step 1: Write/adjust a failing golden-vector assertion that permits the hash-only vector to omit `rendered_id`.**

```ts
assert.equal(vector("cycle-hash-retrograde").rendered_id, undefined);
```

- [x] **Step 2: Run the focused shared golden test; verify the old fixture exposes a synthetic rendered id.**

- [x] **Step 3: Make `rendered_id` optional and batch cycle persistence with a literal 100-statement upper bound.**

```ts
for (let start = 0; start < writes.length; start += 100) {
  await env.DB.batch(writes.slice(start, start + 100));
}
```

- [x] **Step 4: Run the shared golden test, contract validator, and cycles test; verify all pass.**

### Task 3: Durable retry scheduling for released generation claims

**Files:**
- Modify: `apps/api/src/db/generation.ts`
- Modify: `apps/api/src/queue.ts`
- Modify: `apps/api/src/services/generation.integration.test.ts`

**Interfaces:**
- Consumes: a running job id, claim token, and retry timestamp.
- Produces: a queued job with `available_at` set, excluded from the outbox sweeper until that timestamp, while preserving the existing terminal-attempt path.

- [x] **Step 1: Write a failing integration test for a retryable failure**

```ts
expect(job.status).toBe("queued");
expect(job.available_at).not.toBeNull();
expect(await findUndispatched(env, 50, new Date())).not.toContainEqual(
  expect.objectContaining({ job_id: job.id }),
);
```

- [x] **Step 2: Run the named integration test; verify the current `releaseClaim` makes it sweepable immediately.**

Run: `npm test -- apps/api/src/services/generation.integration.test.ts`

- [x] **Step 3: Replace the retry release with a claim-CAS update that records `available_at`, and retain the existing retry budget and `failClaimedJob` fallback.**

```ts
SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
    dispatched_at = NULL, available_at = ?
```

- [x] **Step 4: Re-run the integration test and the related D1 suite; verify both pass.**

### Task 4: Final release evidence

**Files:**
- Modify: only the allowlisted implementation, test, and fixture files above.

- [x] **Step 1: Run `git diff --check`, `npm run typecheck`, `npm test`, `npm run build`, and `python contracts/validate_schemas.py` on the final head.**
- [ ] **Step 2: Request an independent source review, remediate any confirmed issue, and re-run affected and final gates.**
- [ ] **Step 3: Push the reviewed branch, create/update the pull request, wait for required checks, then merge with the expected head SHA.**
- [ ] **Step 4: Deploy the merged main SHA and prove production traffic, `/health`, a protected negative request, and D1/R2 safety.**
