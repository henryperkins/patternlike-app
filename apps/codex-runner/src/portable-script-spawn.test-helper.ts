import childProcess from "node:child_process";
import { basename } from "node:path";
import { syncBuiltinESMExports } from "node:module";

let installed = false;

/** Windows cannot execute a shebang .mjs directly with shell:false; run only the test fake through this test process's Node binary. */
export function installPortableTestScriptSpawn(): void {
  if (installed || process.platform !== "win32") return;
  installed = true;
  const spawn = childProcess.spawn;
  childProcess.spawn = (function (...call: unknown[]) {
    const [command, args, options] = call;
    if (typeof command === "string" && basename(command) === "fake-codex.mjs" && Array.isArray(args)) {
      return Reflect.apply(spawn, childProcess, [process.execPath, [command, ...args], options]);
    }
    return Reflect.apply(spawn, childProcess, call);
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
}
