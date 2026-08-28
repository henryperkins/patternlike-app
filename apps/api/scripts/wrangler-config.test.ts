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

test("production parks the machine pipeline and configures Pattern for every account", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({
    config: configPath,
    env: "production",
  });

  assert.deepEqual(development.triggers.crons, [
    "*/15 * * * *",
    "7,22,37,52 * * * *",
  ]);
  // Both crons. `hybrid` makes the 15-minute lane the PRIMARY Daily entry
  // point, so declaring the mode without the trigger would leave every
  // scheduled reading to first-open repair -- readers who do not open the app
  // would simply never get one. The ontology-maintenance lane is unchanged, and
  // it also carries the Codex provider sweep.
  assert.deepEqual(production.triggers.crons, [
    "*/15 * * * *",
    "7,22,37,52 * * * *",
  ]);

  // Daily generation: scheduled first, first-open as the repair path, through
  // the durable Codex runner. The timeout is the runner's own deadline, not
  // what a synchronous Worker call could afford inside a five-minute lease.
  assert.equal(production.vars.READING_V5_ROLLOUT, "hybrid");
  assert.equal(production.vars.READING_PUBLISHER, "codex");
  assert.equal(production.vars.OPENAI_READING_TIMEOUT_MS, "900000");
  assert.equal(production.vars.OPENAI_READING_MODEL, "gpt-5.6-sol");
  assert.equal(production.vars.OPENAI_READING_REASONING, "high");
  assert.equal(production.vars.OPENAI_READING_PROMPT_VERSION, "1.0.1");
  assert.equal(production.vars.OPENAI_READING_MAX_OUTPUT_TOKENS, "4000");
  assert.equal(production.vars.READING_CONTEXT_MAX_BYTES, "98304");
  assert.equal(production.vars.READING_DAILY_PROVIDER_CALL_LIMIT, "10000");
  // No AI Gateway. Daily reaches its model through the runner, so a gateway
  // here would describe a route Daily does not take.
  assert.equal(production.vars.AI_GATEWAY_ACCOUNT_ID ?? "", "");
  assert.equal(production.vars.AI_GATEWAY_ID ?? "", "");
  // OPENAI_CREDENTIAL_SOURCE stays. It is the ontology pipeline's transport
  // selector and is unread while that pipeline is on Codex; Daily reads
  // neither it nor OPENAI_API_KEY, which reading-publisher.test.ts asserts
  // directly. Removing a deployed var and deleting the key it names are
  // separate production actions with their own verification, not a side effect
  // of this change.
  assert.equal(production.vars.OPENAI_CREDENTIAL_SOURCE, "worker");
  // The machine pipeline is parked. Its regression stage rehearsed thirty
  // Pattern generations per candidate -- about four hours and 130 provider
  // calls -- and never once passed in sixteen attempts. Ontologies come from
  // the signed internal path instead.
  assert.equal(production.vars.ONTOLOGY_PIPELINE_ROLLOUT, "off");
  assert.equal(production.vars.ONTOLOGY_PIPELINE_PUBLISHER, "codex");
  assert.equal(production.vars.OPENAI_ONTOLOGY_GENERATOR_TIMEOUT_MS, "900000");
  assert.equal(production.vars.OPENAI_ONTOLOGY_EVALUATOR_TIMEOUT_MS, "900000");
  // Pattern admission is not a variable. Absence is the contract: neither name
  // may come back, in either block, under any value -- an empty string would be
  // a switch someone could set.
  for (const block of [development, production]) {
    assert.equal("PATTERN_AI_ROLLOUT" in block.vars, false);
    assert.equal("PATTERN_INTERNAL_ACCOUNT_IDS" in block.vars, false);
  }

  // Both deployable blocks name the one deployable publisher.
  // `resolvePatternPublisherConfiguration` refuses anything else, and it
  // expects CODEX_PROVIDER_TIMEOUT_MS on every pass: the OpenAI 120000 values
  // fail the pin check rather than running long.
  for (const block of [development, production]) {
    assert.equal(block.vars.PATTERN_PUBLISHER, "codex");
    assert.equal(block.vars.OPENAI_PATTERN_PLANNER_TIMEOUT_MS, "900000");
    assert.equal(block.vars.OPENAI_PATTERN_WRITER_TIMEOUT_MS, "900000");
    assert.equal(block.vars.OPENAI_PATTERN_VERIFIER_TIMEOUT_MS, "900000");
  }

  // The Workers AI binding went with its adapter. A binding declared for a
  // publisher no code can select is a capability nothing accounts for.
  assert.equal(development.ai?.binding ?? null, null);
  assert.equal(production.ai?.binding ?? null, null);
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
    "/crypto-operator/*",
  ]);
});

test("geocoder ships disabled with the same bounded rate limiter in both environments", () => {
  const development = unstable_readConfig({ config: configPath });
  const production = unstable_readConfig({ config: configPath, env: "production" });

  for (const block of [development, production]) {
    assert.equal(block.vars.GEOCODER_ROLLOUT, "off");
    assert.deepEqual(block.ratelimits, [{
      name: "PLACE_SEARCH_RATE_LIMITER",
      namespace_id: "17001",
      simple: { limit: 30, period: 60 },
    }]);
  }
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
