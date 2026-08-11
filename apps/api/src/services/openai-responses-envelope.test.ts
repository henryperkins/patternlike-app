import { describe, expect, it } from "vitest";

import {
  readOpenAiIncompleteReason,
  readOpenAiResponseUsage,
} from "./openai-responses-envelope.js";

describe("OpenAI Responses envelope", () => {
  it("recognizes an output-ceiling stop before parsing truncated text", () => {
    expect(
      readOpenAiIncompleteReason({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "message", content: [{ type: "output_text", text: "{" }] }],
      }),
    ).toBe("max_output_tokens");
  });

  it("does not treat stale details on a completed response as an incomplete result", () => {
    expect(
      readOpenAiIncompleteReason({
        status: "completed",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    ).toBeNull();
  });

  it("reads reasoning tokens separately from the inclusive output count", () => {
    expect(
      readOpenAiResponseUsage({
        usage: {
          input_tokens: 1946,
          output_tokens: 4000,
          output_tokens_details: { reasoning_tokens: 2875 },
        },
      }),
    ).toEqual({
      input_tokens: 1946,
      output_tokens: 4000,
      reasoning_tokens: 2875,
    });
  });

  it("marks missing or malformed token counts as unavailable", () => {
    expect(
      readOpenAiResponseUsage({
        usage: {
          input_tokens: -1,
          output_tokens: 1.5,
          output_tokens_details: {},
        },
      }),
    ).toEqual({
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
    });
  });
});
