import { run } from "./snapshot.mjs";
const args = process.argv.slice(2);
const validArguments = args.length === 2 || (args.length === 1 && args[0] === "check-current");
const outcome = run(validArguments ? args[0] : null, args[1]);
process.stdout.write(JSON.stringify(outcome.result) + "\n");
process.exitCode = outcome.exitCode;
