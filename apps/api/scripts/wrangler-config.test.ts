import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { unstable_readConfig } from "wrangler";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(here, "../wrangler.toml");

test("production effectively disables the inheritable development cron", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  assert.deepEqual(development.triggers.crons, ["*/15 * * * *"]);
  assert.deepEqual(production.triggers.crons, []);
});
