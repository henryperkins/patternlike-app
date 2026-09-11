import { run } from "./snapshot.mjs";
const args = process.argv.slice(2);
const outcome = run(args.length === 2 ? args[0] : null, args[1]);
process.stdout.write(JSON.stringify(outcome.result) + "\n");
process.exitCode = outcome.exitCode;
