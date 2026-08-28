import assert from "node:assert/strict";
import test from "node:test";

import { executeCommand, parseArguments } from "./crypto-operations.mjs";

const ORIGIN = "https://api.example.test";
const TOKEN = "crypto_0123456789abcdefghijklmnopqrstuvwxyz";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parses only the supported commands and never accepts root secrets", () => {
  assert.deepEqual(
    parseArguments(["dek-rotate", "--user-id", "usr_example_0001", "--reason", "scheduled"]),
    { command: "dek-rotate", userId: "usr_example_0001", reason: "scheduled" },
  );
  assert.deepEqual(
    parseArguments(["resume", "--campaign-id", `ckc_${"a".repeat(32)}`]),
    { command: "resume", campaignId: `ckc_${"a".repeat(32)}` },
  );
  assert.throws(
    () => parseArguments(["kek-campaign", "--target-root-key", "next", "--root-secret", "secret"]),
    /unknown option/,
  );
});

test("starts and drains one DEK step at a time with content-free output", async () => {
  const calls = [];
  const persisted = [];
  const output = [];
  const operationId = `cop_${"b".repeat(32)}`;
  const replies = [
    response({
      schema_version: "crypto-operations/v1",
      operation_id: operationId,
      stage: "quiescing",
      reencrypted_count: 0,
      not_before: "2026-08-28T00:00:00.000Z",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
      completed_at: null,
      error_class: null,
      candidate_wrapped_dek: "must-not-print",
    }, 202),
    response({
      schema_version: "crypto-operations/v1",
      operation_id: operationId,
      stage: "succeeded",
      reencrypted_count: 3,
      not_before: "2026-08-28T00:00:00.000Z",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:05:01.000Z",
      completed_at: "2026-08-28T00:05:01.000Z",
      error_class: null,
    }),
  ];

  const result = await executeCommand(
    parseArguments(["dek-rotate", "--user-id", "usr_example_0001", "--reason", "scheduled"]),
    {
      origin: ORIGIN,
      token: TOKEN,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return replies.shift();
      },
      persist: async (value) => persisted.push(value),
      sleep: async () => {},
      write: (line) => output.push(line),
      now: () => new Date("2026-08-28T00:06:00.000Z"),
    },
  );

  assert.equal(result.stage, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${ORIGIN}/crypto-operator/dek-rotations`);
  assert.equal(calls[1].url, `${ORIGIN}/crypto-operator/dek-rotations/${operationId}/step`);
  assert.equal(persisted[0].operationId, operationId);
  assert.equal(output.join("\n").includes("must-not-print"), false);
  assert.match(output.at(-1), /"stage":"succeeded"/);
});
