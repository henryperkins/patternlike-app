#!/usr/bin/env node
/**
 * Runs promptfoo with this directory's hygiene defaults.
 *
 *   node scripts/promptfoo.mjs eval daily        [extra promptfoo eval args]
 *   node scripts/promptfoo.mjs eval validators   [extra promptfoo eval args]
 *   node scripts/promptfoo.mjs view              [extra promptfoo view args]
 *
 * `eval` always adds `--no-cache` (a cached response is not fresh model
 * output), `--no-share` (results contain full prompts and outputs), and
 * `-j 1` (one Codex claim at a time), and writes results to
 * results/<lane>-<timestamp>.json, which is gitignored. Extra arguments that
 * would override those flags are refused rather than passed through, because
 * promptfoo's parser lets the later occurrence win; short options must be
 * written one per token, because that parser expands a cluster such as
 * `-wj2` into `--watch -j 2`. On a lane that spends model turns, `--repeat`
 * is capped and the unbounded modes (`--watch`, `--suggest-prompts`) are
 * refused.
 *
 * A first Ctrl+C reaches promptfoo directly and pauses the run: it aborts the
 * in-flight call, which terminates the Codex process, and prints a resume id.
 * This wrapper ignores that signal so it lives to return promptfoo's exit
 * code, and forwards a SIGTERM aimed at the wrapper alone as the same
 * graceful interrupt. Do not follow the printed resume hint: promptfoo
 * rebuilds a resumed or retried eval's prompts from the stored record, where
 * a `file://x.mjs:fn` prompt survives only as its own source text, so every
 * replayed case reaches the provider as that text and is refused as
 * `prompt_not_a_claim`. Both replay flags are refused here; start a fresh
 * run narrowed with --filter-pattern instead.
 *
 * Environment defaults, each applied only when the variable is unset:
 * telemetry, update checks, and sharing off, and promptfoo's disk cache and
 * local results database relocated into this directory instead of
 * ~/.promptfoo, so a cloud login stored there never applies to these runs.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// maxRepeat bounds --repeat where every repeat is one xhigh Codex turn per
// profile; null marks a lane that calls no model and is not capped. Raise a
// cap here, deliberately, not from the command line.
const LANES = {
  daily: { config: "promptfooconfig.daily.yaml", maxRepeat: 3 },
  validators: { config: "promptfooconfig.validators.yaml", maxRepeat: null },
};
// Flags this wrapper sets itself. A caller-supplied occurrence would win in
// promptfoo's parser, so it is refused rather than silently overriding.
const OWNED_FLAGS = ["--share", "--no-share", "--cache", "--no-cache", "-j", "--max-concurrency"];
// Modes that multiply a run without a stated bound; refused where turns are spent.
const UNBOUNDED_FLAGS = new Map([
  ["-w", "re-runs the lane on every config change"],
  ["--watch", "re-runs the lane on every config change"],
  ["--suggest-prompts", "appends model-generated prompts and runs every profile through each of them"],
]);
// Replays rebuild prompts from the stored eval record, which reduces this
// directory's prompt functions to their source text (see the header).
const REPLAY_FLAGS = ["--resume", "--retry-errors"];

function usage() {
  process.stderr.write(
    "usage: node scripts/promptfoo.mjs eval <daily|validators> [args]\n" +
      "       node scripts/promptfoo.mjs view [args]\n",
  );
  process.exit(2);
}

function refuse(message) {
  process.stderr.write(`promptfoo.mjs: ${message}\n`);
  process.exit(2);
}

/** Refuse overrides of owned flags, clustered short options, and unbounded spend. */
function checkExtraArgs(extra, laneName, lane) {
  const spendsTurns = lane.maxRepeat !== null;
  for (let i = 0; i < extra.length; i++) {
    const token = extra[i];
    // promptfoo's parser expands a short-option cluster (`-wj2` is `--watch
    // -j 2`) and accepts attached values (`-n1`); either can hide a flag this
    // wrapper owns, so a short option is one letter per token.
    if (/^-[^-]/.test(token) && token.length > 2) {
      refuse(
        `${token}: write short options one per token with the value in the next token (\`-n 1\`); ` +
          "clusters and attached values are refused because `-wj2` would reach promptfoo as `--watch -j 2`",
      );
    }
    const equals = token.startsWith("--") ? token.indexOf("=") : -1;
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (flag === "--no-write") {
      refuse(`${token} disables promptfoo's graceful interrupt handler; database writing must stay enabled so cancellation aborts the Codex turn`);
    }
    if (OWNED_FLAGS.includes(flag)) {
      refuse(`${token} is set by this wrapper (no sharing, no cache, one call at a time) and cannot be overridden`);
    }
    if (REPLAY_FLAGS.includes(flag)) {
      refuse(
        `${token}: promptfoo replays a stored eval with its prompt functions reduced to their own source text, so every case is refused as prompt_not_a_claim; ` +
          "start a fresh run, narrowed with --filter-pattern <profile> if only some profiles are wanted",
      );
    }
    if (spendsTurns && UNBOUNDED_FLAGS.has(flag)) {
      refuse(`${token} ${UNBOUNDED_FLAGS.get(flag)}, spending xhigh Codex turns without a stated bound; run the ${laneName} lane explicitly instead`);
    }
    if (flag !== "--repeat") continue;
    const raw = equals > 0 ? token.slice(equals + 1) : extra[++i];
    const repeat = Number(raw);
    if (!Number.isInteger(repeat) || repeat < 1) refuse(`--repeat needs a positive integer, got ${JSON.stringify(raw ?? "")}`);
    if (spendsTurns && repeat > lane.maxRepeat) {
      refuse(
        `--repeat ${repeat} exceeds the ${laneName} lane's ceiling of ${lane.maxRepeat}: every repeat spends one xhigh Codex turn per profile. ` +
          "Raise maxRepeat in scripts/promptfoo.mjs deliberately if that is intended.",
      );
    }
  }
}

function promptfooBin() {
  // promptfoo's `exports` map hides its package.json from require.resolve, and
  // it is a direct dependency of this directory, so read the manifest by path.
  const packagePath = resolve(ROOT, "node_modules/promptfoo/package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    throw new Error("promptfoo is not installed here; run `npm install` in evals/promptfoo first");
  }
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.promptfoo;
  if (typeof entry !== "string") throw new Error("promptfoo package.json declares no bin");
  return resolve(dirname(packagePath), entry);
}

const [command, laneName, ...rest] = process.argv.slice(2);
let args;
if (command === "eval") {
  const lane = LANES[laneName];
  if (!lane) usage();
  checkExtraArgs(rest, laneName, lane);
  mkdirSync(resolve(ROOT, "results"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  args = ["eval", "-c", lane.config, "--no-cache", "--no-share", "-j", "1", "-o", `results/${laneName}-${stamp}.json`, ...rest];
} else if (command === "view") {
  args = ["view", ...(laneName ? [laneName] : []), ...rest];
} else {
  usage();
}

const env = {
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  // Sharing uploads prompts and outputs. Off here, and the relocated config
  // directory below also keeps any promptfoo cloud login in ~/.promptfoo out
  // of these runs.
  PROMPTFOO_DISABLE_SHARING: "1",
  PROMPTFOO_CACHE_PATH: resolve(ROOT, ".cache"),
  PROMPTFOO_CONFIG_DIR: resolve(ROOT, ".promptfoo"),
  ...process.env,
};

const child = spawn(process.execPath, [promptfooBin(), ...args], { cwd: ROOT, env, stdio: "inherit" });
// Ctrl+C reaches promptfoo through the terminal's process group and pauses
// the run. Outlive that signal to return promptfoo's exit code, and turn a
// SIGTERM aimed at this wrapper alone into the same graceful interrupt;
// promptfoo itself has no SIGTERM handler and would die with the turn running.
process.on("SIGINT", () => undefined);
process.on("SIGTERM", () => child.kill("SIGINT"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
