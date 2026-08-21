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
