import { describe, expect, it } from "vitest";

import {
  buildPatternResponsesRequest,
  PATTERN_SYSTEM_POLICY,
  PATTERN_WRITER_CORRECTION_POLICY,
} from "./pattern-prompt.js";
import type { PatternPublisherPin } from "./pattern-publisher.js";

const basePin: PatternPublisherPin = {
  publisher: "codex",
  planner_model: "gpt-5.6-sol",
  planner_reasoning: "xhigh",
  planner_prompt_version: "1.0.1",
  planner_max_output_tokens: 32000,
  writer_model: "gpt-5.6-sol",
  writer_reasoning: "xhigh",
  writer_prompt_version: "1.0.3",
  writer_max_output_tokens: 32000,
  verifier_model: "gpt-5.6-sol",
  verifier_reasoning: "xhigh",
  verifier_prompt_version: "1.0.0-verifier",
  verifier_max_output_tokens: 32000,
  input_max_bytes: 98_304,
  selection_policy_version: "1.0.0",
  validation_policy_version: "1.0.0",
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("offline Pattern writer 1.0.4", () => {
  it("binds the offline version to exact normal and correction instructions", async () => {
    const pin = { ...basePin, writer_prompt_version: "1.0.4" };
    expect(await sha256(buildPatternResponsesRequest("writer", {}, pin).instructions))
      .toBe("219e54e6e665375ba0cd57735f3138dbe4b3ff23fcb26382291f1cb5797ed232");
    expect(await sha256(buildPatternResponsesRequest("writer", {}, pin, { correction: true }).instructions))
      .toBe("c63a8246219ac41a1ac062f260d362f07f821e2c5898c121f8cbc07dffa30f76");
  });

  it.each([false, true])("selects new writer instructions only for an explicit pin (correction=%s)", (correction) => {
    const document = { facts: ["assigned-feature"], correction: "bounded fixture" };
    const current = buildPatternResponsesRequest("writer", document, basePin, { correction });
    const future = buildPatternResponsesRequest("writer", document, {
      ...basePin, writer_prompt_version: "1.0.4",
    }, { correction });
    expect(future.instructions).not.toBe(current.instructions);
    // Request assembly changes only instructions: input, schema, model, limits,
    // transport posture and all other fields retain their exact values.
    expect({ ...future, instructions: current.instructions }).toEqual(current);
    expect(future.instructions.startsWith(current.instructions)).toBe(true);
  });

  it("preserves the actual pre-change instruction bytes for current and historical pins", async () => {
    expect(await sha256(PATTERN_SYSTEM_POLICY.planner)).toBe("ebe5d9aed07231c6aca0bebefd4c0e1061696e35dffd906db4a7eb0dab5295d5");
    expect(await sha256(PATTERN_SYSTEM_POLICY.verifier)).toBe("1100b6f6f00cddb0c31c3912e75422fede9c9ecf9a99664ac06572d6f8e3522f");
    for (const writer_prompt_version of ["1.0.1", "1.0.2", "1.0.3"]) {
      const pin = { ...basePin, writer_prompt_version };
      const plain = buildPatternResponsesRequest("writer", {}, pin);
      const correction = buildPatternResponsesRequest("writer", {}, pin, { correction: true });
      expect(await sha256(plain.instructions)).toBe("d8abe9b7e6dd177c7a5be98d074527e74951337eb978757ba72114d153e7dc8b");
      expect(await sha256(correction.instructions)).toBe("61243674e4e40aeeec9413d8e771ad78df918dc5cabd1cd6b5a4af3c60dbe556");
      expect(correction.instructions).toBe(PATTERN_WRITER_CORRECTION_POLICY);
    }
  });

  it.each(["planner", "verifier"] as const)("keeps the %s pass unchanged when the future writer pin is present", (pass) => {
    for (const correction of [false, true]) {
      expect(buildPatternResponsesRequest(pass, {}, { ...basePin, writer_prompt_version: "1.0.4" }, { correction }))
        .toEqual(buildPatternResponsesRequest(pass, {}, basePin, { correction }));
    }
  });
});
