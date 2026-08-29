# Personable Daily Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Daily readings warmer, emotionally resonant, and demonstrably specific to calculated personal facts and consented context without expanding the provider packet or weakening validation.

**Architecture:** Extend the immutable Daily system policy with a bounded voice and personalization contract while preserving its existing fact, context, privacy, and safety instructions. Version the changed prompt at every compiled and deployed boundary, then re-pin and run the existing offline evaluation corpus with a more personable clean exemplar.

**Tech Stack:** TypeScript, Vitest, JSON fixtures, Cloudflare Wrangler configuration, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-29-personable-daily-reading-design.md`

## Global Constraints

- Do not change `ReadingGenerationRequest`, the M5 output schema, database migrations, UI, provider, model, selection policy, validation policy, or publication behavior.
- Personal calculated facts remain primary; consented context may shape only a compatible `allowed_use` and never becomes astrological evidence.
- Collective-only facts must remain explicitly collective and must not be presented as uniquely personal.
- Do not add names, birth data, account identifiers, behavioral ranking, or new context sources to the provider packet.
- Keep qualitative personalization findings non-blocking.
- Set the current Daily prompt and corpus versions to exactly `1.0.2`.
- Preserve historical `1.0.1` contract fixtures and documentation that describe the prior prompt.
- Do not commit, push, merge, or deploy.

---

### Task 1: Pin the voice and personalization contract

**Files:**
- Modify: `apps/api/src/services/reading-prompt.test.ts`
- Modify: `apps/api/src/services/reading-prompt.ts`
- Modify: `apps/api/src/services/reading-publisher.ts`

**Interfaces:**
- Consumes: the existing `READING_SYSTEM_POLICY` top-level instruction string and `READING_PROMPT_VERSION` configuration pin.
- Produces: `READING_SYSTEM_POLICY` with approved voice guidance and `READING_PROMPT_VERSION === "1.0.2"`; the request shape and provider conversion remain unchanged.

- [x] **Step 1: Write failing prompt-contract tests**

Update the revision expectation and add two tests whose failures identify the missing behavior:

```ts
it("identifies the personable Daily prompt revision", () => {
  expect(READING_PROMPT_VERSION).toBe("1.0.2");
});

it("asks for emotional warmth without pretending to know the reader's feelings", () => {
  for (const guidance of [
    "warm, perceptive person",
    "possible lived or emotional experience",
    "Pair challenge with compassion",
    "Never claim to know exactly what the reader feels",
  ]) {
    expect(READING_SYSTEM_POLICY, guidance).toContain(guidance);
  }
});

it("makes eligible personal material specific without manufacturing intimacy", () => {
  for (const guidance of [
    "If a line could fit most readers",
    "one safe, concrete detail or constraint",
    "Prior readings are for continuity",
    "do not manufacture intimacy",
  ]) {
    expect(READING_SYSTEM_POLICY, guidance).toContain(guidance);
  }
});
```

The production regressions these tests catch are removal of the approved emotional boundary, removal of the specificity requirement, or an unversioned policy change.

- [x] **Step 2: Run the prompt test and verify RED**

Run:

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-prompt.test.ts
```

Expected: FAIL because the compiled version is `1.0.1` and the approved voice/specificity clauses are absent.

- [x] **Step 3: Implement the minimal policy and version change**

In `reading-prompt.ts`, preserve every existing mechanical rule and add guidance equivalent to:

```ts
"Sound like a warm, perceptive person speaking directly to the reader—not a report, a horoscope app, or a performance.",
"When the supplied material supports it, begin with one or two sentences naming a possible lived or emotional experience before introducing technical astrology.",
"Treat emotion as a possibility, not a fact about the reader. Never claim to know exactly what the reader feels, never diagnose them, and never manufacture familiarity or false intimacy.",
"Pair challenge with compassion and agency. Use natural cadence and direct second person; gentle wit is welcome when it fits.",
"If a line could fit most readers, rewrite it around a supplied personal fact or eligible context. If neither supports specificity, stay honest and do not manufacture intimacy.",
"When context can be used naturally in its permitted lane, use one safe, concrete detail or constraint in an eligible prose unit and let it shape the reading's throughline. Context remains context, never astrological evidence.",
"Prior readings are for continuity and repetition control only, never current evidence.",
"Make suggestions and the reflection question concrete and low-stakes. Avoid generic affirmations, report-like prose, mystical theatrics, purple prose, canned reassurance, hype, therapy-speak, and rigid formula labels.",
```

Update the policy comment so it distinguishes deterministically enforced rules from bounded generation guidance. In `reading-publisher.ts`, set:

```ts
export const READING_PROMPT_VERSION = "1.0.2";
```

- [x] **Step 4: Run the prompt test and verify GREEN**

Run the command from Step 2. Expected: all `reading-prompt.test.ts` tests pass, including packet isolation and Codex conversion.

### Task 2: Align every current deployment pin

**Files:**
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/services/reading-publisher.test.ts`
- Modify: `apps/api/src/services/generate-daily-reading-v5.test.ts`
- Modify: `apps/api/scripts/wrangler-config.test.ts`
- Modify: `apps/api/wrangler.toml`

**Interfaces:**
- Consumes: compiled `READING_PROMPT_VERSION === "1.0.2"`.
- Produces: configuration guards, frozen generation-command expectations, and production Wrangler variables that agree on `1.0.2`.

- [x] **Step 1: Update current-version test inputs and expectations**

Change only Daily-current literals from `1.0.1` to `1.0.2` in the listed tests. Leave Pattern prompt pins and deliberately historical database/evidence fixtures unchanged. In `wrangler-config.test.ts`, expect:

```ts
assert.equal(production.vars.OPENAI_READING_PROMPT_VERSION, "1.0.2");
```

- [x] **Step 2: Run configuration tests and verify RED**

Run:

```bash
npm exec -w @patternlike/api -- vitest run src/config.test.ts src/services/reading-publisher.test.ts src/services/generate-daily-reading-v5.test.ts
npm run test:wrangler-config -w @patternlike/api
```

Expected: the Vitest files accept the new compiled pin, while `test:wrangler-config` fails because production `wrangler.toml` still declares `1.0.1`.

- [x] **Step 3: Update the production Wrangler pin**

Set only the Daily variable:

```toml
OPENAI_READING_PROMPT_VERSION = "1.0.2"
```

- [x] **Step 4: Run configuration tests and verify GREEN**

Run both commands from Step 2. Expected: all tests pass.

### Task 3: Re-pin the offline evaluation corpus

**Files:**
- Modify: `apps/api/src/services/reading-evaluation.test.ts`
- Modify: `apps/api/test/fixtures/reading-evaluation-corpus.json`

**Interfaces:**
- Consumes: prompt `1.0.2`, unchanged selection/validation/evaluation policies, and the real constrained-input compiler.
- Produces: corpus `1.0.2`, gated against prompt `1.0.2`, with an emotionally specific clean candidate that remains valid under existing hard and qualitative checks.

- [x] **Step 1: Update corpus-version expectations and verify RED**

Change the two literal expectations in `reading-evaluation.test.ts`:

```ts
expect(corpus.corpus_version).toBe("1.0.2");
expect(corpus.base.prompt_version).toBe("1.0.2");
```

Run:

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-evaluation.test.ts
```

Expected: FAIL because the corpus, gate, and base request still pin `1.0.1`.

- [x] **Step 2: Update and exercise the synthetic corpus**

Set `corpus_version`, `gates.prompt_version`, and `base.prompt_version` to `1.0.2`. Replace only the `quality.clean` candidate's prose with this synthetic exemplar while preserving its fact/context references:

```json
{
  "headline": "Make room for the plan you can keep",
  "lead": {
    "text": "You may feel the week tightening around you as Saturn squares your Sun. With the deadline moved up, the kinder move may be to choose one promise you can actually keep."
  },
  "paragraphs": [
    {
      "role": "supporting_theme",
      "text": "It is frustrating to steady a plan while the timing keeps changing. You do not have to rescue every version of it; protect the next honest step and let the rest wait."
    }
  ],
  "reflection_prompt": {
    "text": "What is the smallest part of this plan you would still feel proud to keep?"
  }
}
```

- [x] **Step 3: Run the evaluation test and verify GREEN**

Run the command from Step 1. Expected: all profile, privacy, hard-gate, and qualitative cases pass.

### Task 4: Verify the complete change

**Files:**
- Verify only; do not create or modify additional source files.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: source-, focused-test-, typecheck-, build-, and local-CI-backed evidence for handoff.

- [x] **Step 1: Review the isolated diff**

Run:

```bash
git status --short
git diff --check
git diff -- apps/api/src/services/reading-prompt.ts apps/api/src/services/reading-publisher.ts apps/api/wrangler.toml apps/api/src apps/api/scripts apps/api/test/fixtures/reading-evaluation-corpus.json docs/superpowers/specs/2026-08-29-personable-daily-reading-design.md docs/superpowers/plans/2026-08-29-personable-daily-reading.md
```

Expected: only the approved implementation, tests, spec, and plan appear; `git diff --check` prints nothing and exits zero.

- [x] **Step 2: Run all focused Daily lanes**

Run:

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-prompt.test.ts src/services/reading-publisher.test.ts src/services/generate-daily-reading-v5.test.ts src/services/reading-evaluation.test.ts src/config.test.ts
npm run test:wrangler-config -w @patternlike/api
```

Expected: every test passes.

- [x] **Step 3: Run static and build verification**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit zero.

- [x] **Step 4: Run the repository merge gate**

Run:

```bash
npm run ci:local
```

Expected: every reported lane passes and the script emits its paste-ready summary. The script must select this worktree's real `.venv/bin/python`.

- [x] **Step 5: Report without integrating**

Report the worktree path, branch, exact files changed, focused results, typecheck/build results, and the full `ci:local` summary. State explicitly that the change is not committed, pushed, merged, or deployed.
