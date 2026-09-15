import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, USER_A } from "../../test/helpers.js";
import { REVALIDATION_GENERATION_ID, REVALIDATION_NOW, seedPatternRevalidationFixture } from "../../test/pattern-revalidation-fixture.js";
import { loadPatternCandidateRevalidationTarget, revalidatePatternCandidate } from "./pattern-candidate-revalidation.js";

async function replay() {
  const target = await loadPatternCandidateRevalidationTarget(env, REVALIDATION_GENERATION_ID, REVALIDATION_NOW);
  if (!target) throw new Error("target missing");
  return revalidatePatternCandidate(env, target, REVALIDATION_NOW);
}

describe("audited final Pattern candidate revalidation", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("replays the exact completed final candidate and returns a numeric path without prose", async () => {
    const fixture = await seedPatternRevalidationFixture();
    const target = await loadPatternCandidateRevalidationTarget(env, REVALIDATION_GENERATION_ID, REVALIDATION_NOW);
    expect(target).toMatchObject({ providerJobId: fixture.providerJobId, stageGeneration: 3, stageAttempt: 2 });
    if (!target) throw new Error("target missing");
    const before = (await env.DB.prepare("SELECT * FROM pattern_generation_jobs").all()).results;
    const result = await revalidatePatternCandidate(env, target, REVALIDATION_NOW);
    expect(result).toMatchObject({ schema_version: "pattern-candidate-revalidation/v1", ok: false,
      validation_policy_version: "1.0.0", hashes: { provider_response: fixture.responseHash },
      failures: expect.arrayContaining([{ code: "paragraph_too_long", path: "/chapters/0/sections/0/text" }]) });
    expect(JSON.stringify(result)).not.toContain("privateword");
    expect(JSON.stringify(result)).not.toContain(fixture.writer.chapters[0]!.chapter_key);
    expect((await env.DB.prepare("SELECT * FROM pattern_generation_jobs").all()).results).toEqual(before);
  });

  it("returns a passing replay for a structurally valid retained candidate", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true });
    expect(await replay()).toMatchObject({ ok: true, failures: [] });
  });

  it("replays a historical candidate under its frozen input byte limit", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true, inputMaxBytes: 98_305 });
    expect(await replay()).toMatchObject({ ok: true, failures: [] });
  });

  it("uses retained unknown-time uncertainty even without any mutable chart row", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true, missingUncertainty: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM chart_snapshots").first()).toEqual({ n: 0 });
    expect((await replay()).failures).toContainEqual({ code: "missing_uncertainty_note", path: "/uncertainty_note" });
  });

  it("never substitutes an earlier completed provider attempt", async () => {
    const fixture = await seedPatternRevalidationFixture();
    await env.DB.prepare("UPDATE codex_provider_jobs SET stage_generation = 1,stage_attempt = 0 WHERE id = ?")
      .bind(fixture.providerJobId).run();
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it.each(["validated_plan", "fact_packet", "writer_request"])("rejects expired retained %s", async (artifactClass) => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare("UPDATE pattern_generation_artifacts SET expires_at = ? WHERE artifact_class = ?")
      .bind(REVALIDATION_NOW, artifactClass).run();
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it("rejects deleted inventory instead of reading the remaining ciphertext", async () => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare("UPDATE pattern_generation_artifacts SET deleted_at = ? WHERE artifact_class = 'fact_packet'")
      .bind(REVALIDATION_NOW).run();
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it("rejects erased generation keys while provider ciphertext still exists", async () => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare(`UPDATE pattern_generation_artifact_keys SET erased_at = ?,
      wrapped_key_enc = NULL,wrapped_key_version = NULL,wrapped_key_nonce = NULL`).bind(REVALIDATION_NOW).run();
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it("rejects accounts pending erasure", async () => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare("UPDATE users SET status = 'pending_deletion' WHERE id = ?").bind(USER_A).run();
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it("rejects unsupported frozen validation policy instead of substituting current policy", async () => {
    await seedPatternRevalidationFixture({ validationPolicy: "future-private-policy" });
    await expect(replay()).rejects.toMatchObject({ code: "unsupported_validation_policy" });
  });

  it("rejects a retained plan whose authenticated bytes disagree with the parent hash", async () => {
    const fixture = await seedPatternRevalidationFixture();
    fixture.plan.chapters[0]!.purpose = "changed frozen meaning";
    await fixture.storeArtifact("validated_plan", fixture.plan);
    await expect(replay()).rejects.toMatchObject({ code: "integrity_conflict" });
  });

  it("rejects changed fact bytes even when their inventory hashes and encryption verify", async () => {
    const fixture = await seedPatternRevalidationFixture();
    fixture.packet.effective_accuracy = "exact";
    await fixture.storeArtifact("fact_packet", fixture.packet);
    await expect(replay()).rejects.toMatchObject({ code: "integrity_conflict" });
  });

  it("classifies a Pattern artifact identity mismatch as an integrity conflict", async () => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare(`UPDATE pattern_generation_artifacts SET byte_length = byte_length + 1
      WHERE artifact_class = 'validated_plan'`).run();
    await expect(replay()).rejects.toMatchObject({ code: "integrity_conflict" });
  });

  it.each(["request_hash", "response_hash"])("rejects a changed provider %s integrity pointer", async (field) => {
    await seedPatternRevalidationFixture();
    await env.DB.prepare(`UPDATE codex_provider_jobs SET ${field} = ?`).bind(`sha256:${"f".repeat(64)}`).run();
    await expect(replay()).rejects.toMatchObject({ code: "integrity_conflict" });
  });

  it("rejects a missing provider response object", async () => {
    await seedPatternRevalidationFixture();
    const row = await env.DB.prepare("SELECT response_object_key FROM codex_provider_jobs")
      .first<{ response_object_key: string }>();
    await env.ARTIFACTS!.delete(row!.response_object_key);
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });

  it("reports malformed candidate structure without exposing its values", async () => {
    await seedPatternRevalidationFixture({ response: { title: "private invalid candidate" } });
    expect((await replay()).failures).toEqual([{ code: "schema_invalid", path: "" }]);
  });

  it("redacts attacker-controlled keys and aliases into fixed numeric paths", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true, mutateWriter(writer) {
      writer.chapters[0]!.sections[0]!.section_key = "private/section~key:with:colons";
      writer.chapters[0]!.sections[0]!.feature_aliases = ["private/alias~value"];
    } });
    const result = await replay();
    expect(result.failures).toContainEqual({ code: "unassigned_alias", path: "/chapters/0/sections/0/feature_aliases/0" });
    expect(JSON.stringify(result)).not.toContain("private");
    for (const failure of result.failures) {
      expect(failure.path).toMatch(/^(\/(?:plan|chapters|additional_signatures|uncertainty_note|title|schema_version|sections|tensions|resources|counter_expression|feature_aliases|ontology_rule_ids|text|[0-9]+))*$/);
    }
  });

  it("reports only numeric word counts from a short chapter", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true, mutateWriter(writer) {
      const chapter = writer.chapters[0]!;
      chapter.summary = "private";
      chapter.sections.forEach((unit) => { unit.text = "private"; });
      chapter.tensions.forEach((unit) => { unit.text = "private"; });
      chapter.resources.forEach((unit) => { unit.text = "private"; });
      chapter.counter_expression.text = "private";
    } });
    const failure = (await replay()).failures.find((entry) => entry.code === "chapter_word_count");
    expect(failure).toMatchObject({ path: "/chapters/0", actual_count: expect.any(Number) });
    expect(failure!.actual_count).toBeGreaterThan(0);
    expect(failure!.actual_count).toBeLessThan(20);
  });

  it("locates a missing planned alias in the frozen plan without returning the alias", async () => {
    let missing = "";
    const fixture = await seedPatternRevalidationFixture({ validCandidate: true, mutateWriter(writer) {
      const chapter = writer.chapters[0]!;
      missing = chapter.sections[0]!.feature_aliases[0]!;
      for (const unit of [...chapter.sections, ...chapter.tensions, ...chapter.resources, chapter.counter_expression]) {
        unit.feature_aliases = unit.feature_aliases.filter((alias) => alias !== missing);
      }
    } });
    const index = fixture.plan.chapters[0]!.feature_aliases.indexOf(missing);
    expect(index).toBeGreaterThanOrEqual(0);
    expect((await replay()).failures).toContainEqual({ code: "missing_planned_alias", path: `/plan/chapters/0/feature_aliases/${index}` });
  });

  it("preserves the core schema_version failure for an otherwise shaped candidate", async () => {
    const fixture = await seedPatternRevalidationFixture();
    // A separate fixture supplies fully authenticated malformed version bytes.
    await resetDb();
    await seedPatternRevalidationFixture({ response: { ...fixture.writer, schema_version: "private-version" } });
    const failures = (await replay()).failures;
    expect(failures).toContainEqual({ code: "schema_version", path: "/schema_version" });
    expect(failures).toContainEqual({ code: "paragraph_too_long", path: "/chapters/0/sections/0/text" });
  });

  it("replays an earlier correction retained through a provider retry", async () => {
    await seedPatternRevalidationFixture({ validCandidate: true, correctionAttempt: 1 });
    expect(await replay()).toMatchObject({ ok: true, failures: [] });
  });

  it.each([
    ["account deletion", "UPDATE users SET status = 'pending_deletion'"],
    ["packet deletion", "UPDATE pattern_generation_artifacts SET deleted_at = '2030-08-24T00:00:00.000Z' WHERE artifact_class = 'fact_packet'"],
    ["plan expiry", "UPDATE pattern_generation_artifacts SET expires_at = '2030-08-24T00:00:00.000Z' WHERE artifact_class = 'validated_plan'"],
    ["command erasure", "UPDATE jobs SET payload_enc = NULL,payload_key_version = NULL,payload_nonce = NULL"],
  ])("withholds a replay when %s starts during the final provider read", async (_name, mutation) => {
    await seedPatternRevalidationFixture({ validCandidate: true });
    const row = await env.DB.prepare("SELECT response_object_key FROM codex_provider_jobs")
      .first<{ response_object_key: string }>();
    const originalGet = env.ARTIFACTS!.get.bind(env.ARTIFACTS!);
    vi.spyOn(env.ARTIFACTS!, "get").mockImplementation(async (key: string) => {
      const value = await originalGet(key);
      if (key === row!.response_object_key) await env.DB.prepare(mutation).run();
      return value;
    });
    await expect(replay()).rejects.toMatchObject({ code: "artifact_unavailable" });
  });
});
