#!/usr/bin/env -S npx tsx
import { runRuntimeHealthRead } from "../../../packages/shared/src/runtime-health-tool.js";

const args = process.argv.slice(2);
const command: unknown = args.length === 1 && args[0] === "aggregate" ? { mode: "aggregate" }
  : args.length === 3 && args[0] === "pattern" ? { mode: "pattern", generation_id: args[1], purpose: args[2] } : null;
if (command === null) {
  process.stderr.write("Usage: npx tsx apps/api/scripts/runtime-health.ts aggregate | pattern <generation_id> <purpose>\nSet PATTERNLIKE_API_ORIGIN and CF_ACCESS_JWT_ASSERTION in the environment.\n");
  process.exitCode = 2;
} else {
  const result = await runRuntimeHealthRead(command, process.env.PATTERNLIKE_API_ORIGIN ?? "", process.env.CF_ACCESS_JWT_ASSERTION ?? "");
  process.stdout.write(`${result}\n`);
  if (result.includes(" unavailable: ")) process.exitCode = 1;
}
