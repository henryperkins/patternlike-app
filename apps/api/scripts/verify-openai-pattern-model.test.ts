import assert from "node:assert/strict";
import test from "node:test";

import { runPatternModelVerification } from "./verify-openai-pattern-model.js";

const MODEL = "gpt-5.6-sol";

test("looks up the pin, sends a strict pattern schema, and validates the output", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const probeResponse =
    '{"id":"resp_probe_success","status":"completed","output":[{"type":"reasoning"},{"type":"message","content":[{"type":"output_text","text":"{\\"k\\":\\"chapter_17\\"}"}]}]}';
  const responses = [
    new Response(JSON.stringify({ id: MODEL }), { status: 200 }),
    new Response(probeResponse, { status: 200 }),
  ];
  const fetchFn: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    requests.push({ url, init });
    const response = responses.shift();
    assert.ok(response, "unexpected provider request");
    return response;
  };

  const result = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
    now: () => new Date("2026-08-22T12:34:56.000Z"),
  });

  assert.deepEqual(result, {
    exitCode: 0,
    stdout: [
      `PASS  ${MODEL} model_lookup`,
      `PASS  ${MODEL} strict_pattern response_id=resp_probe_success response_sha256=sha256:8f7214280d2613511e4cbc5b6fbe74b105109d54f2b404bef2f2f3a20cc4e72e completed_at=2026-08-22T12:34:56.000Z`,
    ],
    stderr: [],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, `https://api.openai.com/v1/models/${MODEL}`);
  assert.deepEqual(requests[0]?.init?.headers, {
    authorization: "Bearer test-key",
  });
  assert.ok(requests[0]?.init?.signal instanceof AbortSignal);
  assert.equal(requests[1]?.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(requests[1]?.init?.headers, {
    authorization: "Bearer test-key",
    "content-type": "application/json",
  });
  assert.ok(requests[1]?.init?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    model: MODEL,
    store: false,
    instructions: "Return the requested object. Do not add fields.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: 'Return {"k":"chapter_17"}.',
          },
        ],
      },
    ],
    reasoning: { effort: "low" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "patternlike_pattern_keyword_probe",
        strict: true,
        schema: {
          type: "object",
          properties: {
            k: {
              type: "string",
              pattern: "^chapter_[0-9]{2}$",
            },
          },
          required: ["k"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: 256,
  });
});

test("classifies account authorization failures without exposing provider prose", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: "DO_NOT_PRINT_PROVIDER_PROSE" },
      }),
      { status: 403 },
    );

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [],
    stderr: [`FAIL  ${MODEL} — the key is not authorized for this account`],
  });
  assert.doesNotMatch(
    JSON.stringify(verification),
    /DO_NOT_PRINT_PROVIDER_PROSE/,
  );
});

test("does not echo a mismatched model override into operator evidence", async () => {
  const leakedOverride = "sk-do-not-print\nPASS  forged-evidence";

  const verification = await runPatternModelVerification({
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_PATTERN_WRITER_MODEL: leakedOverride,
    },
  });

  assert.deepEqual(verification, {
    exitCode: 2,
    stdout: [],
    stderr: [
      `FAIL  OPENAI_PATTERN_WRITER_MODEL differs from the compiled pin ${MODEL}`,
    ],
  });
  assert.doesNotMatch(JSON.stringify(verification), /sk-do-not-print|forged-evidence/);
});

test("turns malformed response content into a prose-free failure", async () => {
  const responses = [
    new Response(JSON.stringify({ id: MODEL }), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "resp_probe_malformed",
        status: "completed",
        output: [{ type: "message", content: [null] }],
      }),
      { status: 200 },
    ),
  ];
  const fetchFn: typeof fetch = async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected provider request");
    return response;
  };

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [`PASS  ${MODEL} model_lookup`],
    stderr: [
      `FAIL  ${MODEL} — the strict pattern probe did not return one pattern-conformant object`,
    ],
  });
});

test("times out a stalled provider request with a controlled failure", async () => {
  const fetchFn: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal, "verification requests must carry an abort signal");
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          const error = new Error("DO_NOT_PRINT_TIMEOUT_PROSE");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
    timeoutMs: 10,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [],
    stderr: [`FAIL  ${MODEL} — the model endpoint timed out`],
  });
  assert.doesNotMatch(JSON.stringify(verification), /DO_NOT_PRINT_TIMEOUT_PROSE/);
});

test("refuses an oversized streamed provider response", async () => {
  const oversizedProbe = JSON.stringify({
    id: "resp_probe_oversized",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ k: "chapter_17" }),
          },
        ],
      },
    ],
    padding: "DO_NOT_PRINT_OVERSIZED_PROSE".repeat(20),
  });
  const responses = [
    new Response(JSON.stringify({ id: MODEL }), { status: 200 }),
    new Response(oversizedProbe, { status: 200 }),
  ];
  const fetchFn: typeof fetch = async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected provider request");
    return response;
  };

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
    maxBodyBytes: 128,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [`PASS  ${MODEL} model_lookup`],
    stderr: [
      `FAIL  ${MODEL} — the strict pattern probe answer exceeded the safe size`,
    ],
  });
  assert.doesNotMatch(JSON.stringify(verification), /DO_NOT_PRINT_OVERSIZED_PROSE/);
});

test("fails when a successful response does not conform to the schema pattern", async () => {
  const responses = [
    new Response(JSON.stringify({ id: MODEL }), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "resp_probe_invalid",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ k: "DO_NOT_PRINT_PROVIDER_PROSE" }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    ),
  ];
  const fetchFn: typeof fetch = async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected provider request");
    return response;
  };

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [`PASS  ${MODEL} model_lookup`],
    stderr: [
      `FAIL  ${MODEL} — the strict pattern probe did not return one pattern-conformant object`,
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(verification),
    /DO_NOT_PRINT_PROVIDER_PROSE/,
  );
});

test("fails an incomplete response even when it carries a conformant fragment", async () => {
  const responses = [
    new Response(JSON.stringify({ id: MODEL }), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "resp_probe_incomplete",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ k: "chapter_17" }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    ),
  ];
  const fetchFn: typeof fetch = async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected provider request");
    return response;
  };

  const verification = await runPatternModelVerification({
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn,
  });

  assert.deepEqual(verification, {
    exitCode: 1,
    stdout: [`PASS  ${MODEL} model_lookup`],
    stderr: [
      `FAIL  ${MODEL} — the strict pattern probe did not complete with one pattern-conformant object`,
    ],
  });
});
