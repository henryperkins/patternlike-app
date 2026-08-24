import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "../../test/helpers.js";
import {
  CodexProviderArtifactError,
  putCodexProviderArtifact,
  readCodexProviderArtifact,
  type CodexProviderArtifactCoordinate,
} from "./codex-provider-artifacts.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const TEST_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

const coordinate: CodexProviderArtifactCoordinate = {
  jobId: `cpjob_${"ab".repeat(16)}`,
  pipeline: "ontology",
  ownerId: "oprun_codex_artifact_fixture",
  pass: "generator",
  stageGeneration: 2,
  stageAttempt: 0,
  role: "request",
};

describe("Codex provider encrypted artifacts", () => {
  beforeEach(async () => {
    await resetDb();
    env.CODEX_PROVIDER_ARTIFACT_KEYRING = JSON.stringify({
      version: 1,
      keys: { "codex-test-key": TEST_KEY },
    });
  });

  it("stores encrypted bytes and reads them only at the authenticated coordinate", async () => {
    const plaintext = textEncoder.encode(
      '{"schema_version":"codex-provider-invocation/v1","prompt":"private","output_schema":{"type":"object"}}',
    );
    const written = await putCodexProviderArtifact(env, coordinate, plaintext);

    expect(written.status).toBe("created");
    expect(written.artifact.objectKey).toBe(
      `codex-provider-jobs/${coordinate.jobId}/request.json.enc`,
    );
    expect(written.artifact.plaintextHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(written.artifact.ciphertextHash).not.toBe(
      written.artifact.plaintextHash,
    );

    const stored = await env.ARTIFACTS!.get(written.artifact.objectKey);
    expect(stored).not.toBeNull();
    expect(await stored!.text()).not.toContain("private");

    const read = await readCodexProviderArtifact(
      env,
      coordinate,
      written.artifact,
    );
    expect(textDecoder.decode(read)).toBe(textDecoder.decode(plaintext));

    await expect(
      readCodexProviderArtifact(
        env,
        { ...coordinate, pass: "evaluator" },
        written.artifact,
      ),
    ).rejects.toMatchObject({
      code: "codex_provider_artifact_integrity_failed",
    });
  });

  it("adopts identical plaintext and rejects conflicting bytes", async () => {
    const plaintext = textEncoder.encode('{"answer":"first"}');
    const first = await putCodexProviderArtifact(env, coordinate, plaintext);
    const replay = await putCodexProviderArtifact(env, coordinate, plaintext);

    expect(replay).toEqual({ status: "adopted", artifact: first.artifact });
    await expect(
      putCodexProviderArtifact(
        env,
        coordinate,
        textEncoder.encode('{"answer":"different"}'),
      ),
    ).rejects.toMatchObject({ code: "codex_provider_artifact_conflict" });
  });

  it("keeps responses from different lease fences at distinct object keys", async () => {
    const first = await putCodexProviderArtifact(
      env,
      { ...coordinate, role: "response", storageDiscriminator: "1".repeat(64) },
      textEncoder.encode('{"answer":"first"}'),
    );
    const second = await putCodexProviderArtifact(
      env,
      { ...coordinate, role: "response", storageDiscriminator: "2".repeat(64) },
      textEncoder.encode('{"answer":"second"}'),
    );

    expect(first.artifact.objectKey).not.toBe(second.artifact.objectKey);
    expect(textDecoder.decode(await readCodexProviderArtifact(
      env,
      { ...coordinate, role: "response" },
      second.artifact,
    ))).toBe('{"answer":"second"}');
  });

  it("fails closed on tampering and an unavailable keyring", async () => {
    const written = await putCodexProviderArtifact(
      env,
      coordinate,
      textEncoder.encode("{}"),
    );
    await env.ARTIFACTS!.put(
      written.artifact.objectKey,
      textEncoder.encode("{}"),
    );
    await expect(
      readCodexProviderArtifact(env, coordinate, written.artifact),
    ).rejects.toBeInstanceOf(CodexProviderArtifactError);

    env.CODEX_PROVIDER_ARTIFACT_KEYRING = "";
    await expect(
      putCodexProviderArtifact(
        env,
        { ...coordinate, jobId: `cpjob_${"cd".repeat(16)}` },
        textEncoder.encode("{}"),
      ),
    ).rejects.toMatchObject({
      code: "codex_provider_artifact_keyring_invalid",
    });
  });
});
