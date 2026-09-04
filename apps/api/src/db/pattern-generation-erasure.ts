import type { Env } from "../env.js";

/**
 * Erase what could still decrypt one Pattern generation: its content keys,
 * its artifact inventory rows, and the frozen command payload on its job.
 *
 * Live source-update publication and regeneration replay both apply exactly
 * these statements. The replay convergence probe asserts the same end state,
 * so a second hand-copied version would make production replays fail the day
 * the two drifted. Callers keep the statements inside their own batch.
 */
export function eraseGenerationStatements(
  env: Pick<Env, "DB">,
  input: { userId: string; generationId: string; at: string },
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE pattern_generation_artifact_keys
       SET wrapped_key_enc = NULL, wrapped_key_version = NULL,
           wrapped_key_nonce = NULL, erased_at = COALESCE(erased_at, ?)
       WHERE user_id = ? AND generation_id = ?`,
    ).bind(input.at, input.userId, input.generationId),
    env.DB.prepare(
      `UPDATE pattern_generation_artifacts
       SET deleted_at = COALESCE(deleted_at, ?)
       WHERE user_id = ? AND generation_id = ?`,
    ).bind(input.at, input.userId, input.generationId),
    env.DB.prepare(
      `UPDATE jobs
       SET payload_enc = NULL, payload_key_version = NULL, payload_nonce = NULL
       WHERE user_id = ? AND id = (
         SELECT job_id FROM pattern_generation_jobs
         WHERE generation_id = ? AND user_id = ?
       )`,
    ).bind(input.userId, input.generationId, input.userId),
  ];
}

/** Delete every R2 object stored under one generation's prefix. */
export async function deleteGenerationObjects(
  env: Pick<Env, "ARTIFACTS">,
  generationId: string,
): Promise<void> {
  if (!env.ARTIFACTS) return;
  let cursor: string | undefined;
  do {
    const page = await env.ARTIFACTS.list({
      prefix: `pattern-generations/${generationId}/`,
      cursor,
    });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) await env.ARTIFACTS.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
