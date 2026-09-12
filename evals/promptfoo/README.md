# promptfoo lanes for Daily readings

Operator-side evaluation of Daily reading generation with [promptfoo](https://www.promptfoo.dev).
This directory is deliberately **outside the npm workspaces**: it has its own
`package.json` and lockfile, the root `npm ci` does not install it, no root
script runs it, and nothing in `apps/` or `packages/` imports from it. It is
never part of `npm run ci:local`, `.github/workflows/ci.yml`, or
`npm run test:content`.

## What it measures, and what it does not

Every lane reuses the repository's own definitions rather than restating them:

| Concern | Where it comes from |
| --- | --- |
| The six synthetic profiles and their prepared inputs | `apps/api/test/fixtures/reading-evaluation-corpus.json` via `prepareProfile()` |
| The exact provider claim (instructions, packet, schema, model, effort, timeout) | `prepareFreshReadingEvaluation()` in `scripts/pattern-release/fresh-reading-evaluation.mjs` |
| The transport | `runCodexInvocation()` in `apps/codex-runner/src/codex-cli.ts`, the production isolated Codex path |
| The output schema check | `validateReadingOutput` from `apps/api/src/generated/reading-validators.js`, the Worker's precompiled validator |
| The hard gate | `hardGateFindings()` → `validateReadingCandidate()` under the compiled validation policy |
| Quality heuristics | `qualitativeFindings()`, reported as named scores, never as pass criteria |

A passing Daily run means: fresh output for each profile was accepted by the
production validator. It does **not** establish interpretive quality,
usefulness, psychological truth, editorial approval, or a production success
rate. Human adjudication of those stays where the repository puts it, in the
interpretation-quality baseline and the reader-feedback surfaces.

promptfoo does not bind a source snapshot the way the fresh-evaluation harness
does. Its test metadata records the commit and a dirty flag, and that is all.
Treat a promptfoo run as exploration evidence for choosing a change, not as
release evidence and not as merge approval.

## Prerequisites

- Node from the repository's `.nvmrc` (22). promptfoo 0.123.0 requires 22.22 or newer.
- The repository root's `npm ci` has run: the glue imports API services and
  the runner through workspace symlinks.
- `npm install` in this directory. It pulls promptfoo's full dependency tree
  (about 2.6 GB with optional platform packages); set
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to skip the optional browser download.
- For the Daily lane only: the Codex CLI on `PATH` or at `CODEX_BIN`, logged in
  with ChatGPT. The transport refuses API keys, nonempty Codex instruction
  files in `CODEX_HOME`, and enabled MCP servers, exactly as production does.

## Lanes

| Lane | Provider | Calls | Purpose |
| --- | --- | --- | --- |
| `validators` | `echo` | none | The 31 authored corpus candidates, checked against their corpus labels. Runs offline in seconds; smoke-tests the promptfoo wiring and shows validator false rejections per case. |
| `daily` | `providers/codex-isolated.mjs` | 6 per run, times `--repeat` (at most 3) | Fresh output for the six profiles through the production transport, scored by the hard gate. Each call is one `xhigh` turn and takes minutes. |

## Commands

```bash
npm run check             # offline self-check: prompt functions, generators, assertions; no provider, no promptfoo
npm run eval:validators   # promptfoo, echo provider, no model calls
npm run eval:daily        # six Codex turns; add -- --repeat 2 (the wrapper refuses more than 3) or -- --filter-pattern unknown_time
npm run view              # local viewer over this directory's results database
```

`scripts/promptfoo.mjs` is the only entry point. It always passes `--no-cache`
(a cached response is not fresh model output), `--no-share`, and `-j 1` (one
claim at a time against one login), writes results to
`results/<lane>-<timestamp>.json`, and sets these defaults when unset:
`PROMPTFOO_DISABLE_TELEMETRY=1`, `PROMPTFOO_DISABLE_UPDATE=1`,
`PROMPTFOO_DISABLE_SHARING=1`, and a cache and results database under this
directory rather than `~/.promptfoo`. The relocated config directory also
means a promptfoo cloud login stored in `~/.promptfoo` never applies to these
runs. It refuses a caller-supplied `--share`, `--cache`, or
`-j`/`--max-concurrency` (promptfoo's parser would let the later flag win),
and any short option written as a cluster or with an attached value, because
`-wj2` reaches promptfoo as `--watch -j 2`: write `-n 1`, not `-n1`. On the
Daily lane it also refuses `--repeat` above 3, which is already 18 `xhigh`
turns per run, and the unbounded modes `--watch` and `--suggest-prompts`;
raise `maxRepeat` in the script deliberately if a larger sample is ever
wanted. `--resume` and `--retry-errors` are refused on every lane (see
cancellation under Reading a result). `--no-write` is also refused because
disabling database writing removes promptfoo's graceful interrupt handler
and prevents cancellation from reaching the Codex turn. Run `npm run check` before spending
turns.

## Reading a result

Each Daily test carries two assertions. `schema` runs the Worker's own
precompiled validator for the frozen m5 output schema, which the provider
receives verbatim, so a failure there is a transport or model defect.
(promptfoo's built-in `is-json` is not used: its Ajv does not know the
contract's draft 2020-12 metaschema and errors on every test.) `hard_gate` is
the production validator; its reason lists every `code.detail_code` and
nothing else. Named scores `schema`, `hard_gate`, and `qualitative_clean` are
0 or 1 per test; the qualitative finding names appear in the reason of an
accepted test.

Cancellation reaches the model: the provider forwards promptfoo's abort
signal to the transport, which terminates the Codex process, and the result
then reads `aborted` rather than a transport failure code. promptfoo raises
that signal on the first Ctrl+C (its eval command installs the handler
whenever result writing is on, as it is here): the run pauses, the in-flight
call is aborted, and it prints a resume id; a second Ctrl+C force-exits.
Ignore the printed resume hint. `--resume` and `--retry-errors` rebuild the
prompts from the stored eval record, where this directory's prompt functions
survive only as their own source text, so every replayed case reaches the
provider as that text and is refused as `prompt_not_a_claim`: no turn is
spent, but junk rows land in the paused run's results file. The wrapper
refuses both flags; start a fresh run, narrowed with
`-- --filter-pattern <profile>` to the profiles that did not complete. The
wrapper ignores the interrupt itself so the shell gets promptfoo's exit code,
and turns a `kill` aimed at the wrapper into the same interrupt. Do not
`kill` promptfoo's own process: it has no SIGTERM handler, so it dies at once
and the Codex turn runs on until the transport's ceiling. The same abort
signal also fires from promptfoo's own timeouts, `PROMPTFOO_EVAL_TIMEOUT_MS`
per test and `PROMPTFOO_MAX_EVAL_TIME_MS` per run, neither set here. The
transport's own ceiling, the claim's `timeout_ms`, remains the production
timeout and reads `publisher_unavailable/request_timeout`.

Keep rejected samples. A rejection can be an unsupported model claim or a
validator false rejection, and the automatic result alone does not say which.
The same is true in the validators lane: a corpus disagreement is either a
widened gate or a false rejection of authored acceptable prose.

## Hygiene

- Only synthetic inputs ever reach a model. Never point a lane at account data,
  a real chart, or a retained production reading.
- `results/`, `.cache/`, and `.promptfoo/` are gitignored because they hold
  full prompts and model outputs. To retain a run as evidence, copy the file
  deliberately to a dated directory under `output/`, `docs/reviews/`, or
  `docs/superpowers/`, the destinations the repository already allows, and
  summarize it content-free.
- Never run `promptfoo share`. It uploads prompts and outputs.
- Changing a prompt is a version bump. Explore wording here, then land the
  winner as a new prompt version selected by pin.

## Extending

Pattern lanes belong beside these, one per pass, fed by the thirty authored
chains under `contracts/m7/fixtures/corpus/` and scored by
`validatePatternPlan`, `validatePatternCandidate`, and
`evaluatePatternPublicationSafety`. A model or effort comparison can use
promptfoo's built-in `openai:codex-app-server` provider, but label it as a
different transport: it spawns the same app-server without the production
isolation checks.
