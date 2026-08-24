import { pathToFileURL } from "node:url";

import { CodexProviderClient } from "./client.js";
import {
  checkCodexAuthentication,
  runCodexInvocation,
} from "./codex-cli.js";
import {
  parseRunnerConfiguration,
  runCodexPollLoop,
  type RunnerLogEvent,
} from "./runner.js";

function log(event: RunnerLogEvent | { event: "codex_runner_started" | "codex_runner_stopped" | "codex_runner_fatal" }) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  })}\n`);
}

export async function main(): Promise<void> {
  let config;
  try {
    config = parseRunnerConfiguration(process.env);
  } catch {
    log({ event: "codex_runner_fatal" });
    process.exitCode = 1;
    return;
  }
  if (!await checkCodexAuthentication(config.codexBin)) {
    log({ event: "codex_runner_fatal" });
    process.exitCode = 1;
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const client = new CodexProviderClient({
    apiOrigin: config.apiOrigin,
    runnerToken: config.runnerToken,
  });
  log({ event: "codex_runner_started" });
  try {
    await runCodexPollLoop({
      client,
      pollMs: config.pollMs,
      signal: controller.signal,
      execute: (claim) => runCodexInvocation({
        claim,
        codexBin: config.codexBin,
      }),
      log,
    });
    log({ event: "codex_runner_stopped" });
  } catch {
    log({ event: "codex_runner_fatal" });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
