# Gate 6 output-budget and collective-scope remediation

> **ARCHIVED 2026-08-22 — code complete; one rollout action still outstanding.**
> The 4,000-token ceiling, the `1.0.1` corpus and prompt identity, and the
> `max_output_tokens_exhausted` classification are all in `apps/api/src`. The
> live 6/6 Gate 6 rerun this plan explicitly defers is a rollout action tracked
> in `docs/deploy/openai-daily-reading-rollout.md`, not unfinished plan work.
> Do not execute. Index: [`../README.md`](../README.md).

**Goal:** Remove the two demonstrated Gate 6 failure modes without weakening validation: nondeterministic Responses API truncation at the 1,800-token ceiling and possessive personalization of collective-only facts.

**Scope boundary:** This plan changes code, tests, fixtures, corpus pins, and rollout documentation only. It does not call OpenAI, approve Gate 5 spend, rerun the live corpus, commit, push, deploy, or unblock rollout.

## 1. Pin the candidate ceiling and evaluation identity

- Add failing configuration, request-shape, command, and corpus tests for `max_output_tokens: 4000`.
- Add the reasoning effort and response-token ceiling to the corpus gates so a run cannot silently use different cost/quality settings.
- Bump the corpus and prompt identity to `1.0.1`, then update generated M5 fixtures and production environment pins.

## 2. Classify cap exhaustion explicitly

- Add a mock Responses API envelope with `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, and truncated output.
- Add a publisher regression test proving this maps to a dedicated safe detail code rather than `invalid_json`.
- Introduce a small shared Responses-envelope parser and use it in both the Worker adapter and Gate 6 runner.
- Report `usage.output_tokens_details.reasoning_tokens` per profile and in totals; report cap exhaustion as its own Gate 6 finding.

## 3. Prevent collective possessive framing

- Add a prompt contract test requiring positive collective phrasing and explicit rejection of possessive placements for collective-only evidence.
- Strengthen the system policy while leaving the validator and its existing `collective_scope.possessive_placement` rejection unchanged.

## 4. Reconcile operational records

- Update the rollout/design documentation to say that the 4,000-token response ceiling includes reasoning and visible output.
- Record that the higher ceiling changes Gate 5 worst-case spend and still needs operator approval.
- Record the failed 3/6 corpus run and make the next live 6/6 Gate 6 rerun an explicit remaining boundary.

## 5. Verify offline

- Run the focused red/green tests after each behavior change.
- Run API typechecking and the affected API/contract lanes.
- Run the full repository test suite, inspect the exact diff, and leave the branch uncommitted for review.
