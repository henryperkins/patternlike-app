import { pathToFileURL } from "node:url";
import { serializeRunnerLogEvent } from "./safe-log.js";

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
  process.stdout.write(`${serializeRunnerLogEvent(event)}\n`);
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
    const portraitModules = config.portraitsEnabled ? await Promise.all([
      import("./portrait-client.js"), import("./portrait-invocation.js"),
    ]) : null;
    const meshModules = config.meshesEnabled ? await Promise.all([
      import("./portrait-mesh-client.js"), import("./portrait-mesh-invocation.js"),
    ]) : null;
    await runCodexPollLoop({
      client,
      pollMs: config.pollMs,
      signal: controller.signal,
      execute: (claim) => runCodexInvocation({
        claim,
        codexBin: config.codexBin,
        signal: controller.signal,
      }),
      ...(portraitModules ? { portraits: {
        client: new portraitModules[0].CodexPortraitClient({ apiOrigin: config.apiOrigin, runnerToken: config.runnerToken }),
        execute: (claim: import("@patternlike/shared").CodexPortraitClaim) => portraitModules[1].runPortraitInvocation({
          claim, codexBin: config.codexBin, signal: controller.signal,
        }),
      } } : {}),
      ...(meshModules ? { meshes: {
        client: new meshModules[0].CodexPortraitMeshClient({ apiOrigin: config.apiOrigin, runnerToken: config.runnerToken }),
        execute: (claim: import("@patternlike/shared").CodexPortraitMeshClaim) => meshModules[1].runPortraitMeshInvocation({
          claim, codexBin: config.codexBin, signal: controller.signal,
        }),
      } } : {}),
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
