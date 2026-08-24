import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { unstable_readConfig } from "wrangler";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(here, "../wrangler.toml");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
      ? [target]
      : [];
  }));
  return nested.flat();
}

test("Worker source and configuration contain no private ChatGPT transport", async () => {
  const files = [
    ...await sourceFiles(path.resolve(here, "../src")),
    path.resolve(here, "../wrangler.toml"),
    path.resolve(here, "../test/hermetic-bindings.ts"),
  ];
  const forbidden = [
    "chatgpt.com/backend-api/codex/responses",
    "chatgpt-account-id",
    "CODEX_AUTH_TOKEN",
    "CODEX_ACCOUNT_ID",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const literal of forbidden) {
      assert.equal(source.includes(literal), false, `${literal} remains in ${file}`);
    }
  }
});

test("production enables only ontology maintenance and not the incumbent scheduler", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  assert.deepEqual(development.triggers.crons, [
    "*/15 * * * *",
    "7,22,37,52 * * * *",
  ]);
  assert.deepEqual(production.triggers.crons, [
    "7,22,37,52 * * * *",
  ]);
  assert.equal(production.vars.ONTOLOGY_PIPELINE_ROLLOUT, "off");
  assert.equal(production.vars.PATTERN_AI_ROLLOUT, "off");
});

test("production sends every API namespace through the Worker before assets", () => {
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  assert.deepEqual(production.assets?.run_worker_first, [
    "/health",
    "/v1/*",
    "/internal/*",
    "/admin/*",
    "/codex-provider/*",
  ]);
});

test("ontology pipeline queues are distinct and fully redeclared", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  const assertQueue = (
    config: ReturnType<typeof unstable_readConfig>,
    queueName: string,
    deadLetterQueue: string,
  ) => {
    assert.deepEqual(
      config.queues.producers?.find((producer: { binding?: string }) =>
        producer.binding === "ONTOLOGY_PIPELINE_QUEUE"),
      {
        binding: "ONTOLOGY_PIPELINE_QUEUE",
        queue: queueName,
      },
    );
    assert.deepEqual(
      config.queues.consumers?.find((consumer: { queue?: string }) =>
        consumer.queue === queueName),
      {
        dead_letter_queue: deadLetterQueue,
        max_batch_size: 1,
        max_batch_timeout: 5,
        max_concurrency: 1,
        max_retries: 3,
        queue: queueName,
      },
    );
  };

  assertQueue(
    development,
    "patternlike-ontology-pipeline-dev",
    "patternlike-ontology-pipeline-dev-dlq",
  );
  assertQueue(
    production,
    "patternlike-ontology-pipeline",
    "patternlike-ontology-pipeline-dlq",
  );
  assert.notEqual(
    development.queues.producers?.find((producer: { binding?: string }) =>
      producer.binding === "ONTOLOGY_PIPELINE_QUEUE")?.queue,
    production.queues.producers?.find((producer: { binding?: string }) =>
      producer.binding === "ONTOLOGY_PIPELINE_QUEUE")?.queue,
  );
});

test("Pattern replay ledger has dedicated development and production buckets", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  assert.deepEqual(
    development.r2_buckets.find((bucket: { binding?: string }) =>
      bucket.binding === "PATTERN_REPLAY_LEDGER"),
    {
      binding: "PATTERN_REPLAY_LEDGER",
      bucket_name: "pattern-erasure-replay-dev",
    },
  );
  assert.deepEqual(
    production.r2_buckets.find((bucket: { binding?: string }) =>
      bucket.binding === "PATTERN_REPLAY_LEDGER"),
    {
      binding: "PATTERN_REPLAY_LEDGER",
      bucket_name: "pattern-erasure-replay",
    },
  );
});
