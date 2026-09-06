import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PORTRAIT_MESH_COMPILER_VERSION, type CodexPortraitMeshClaim } from "@patternlike/shared";
import { preparePortraitImage, PORTRAIT_CODEX_CLI_VERSION } from "./portrait-invocation.js";
import { runPortraitMeshInvocation } from "./portrait-mesh-invocation.js";

/** Explicit local provider probe. Never called by the queue, test suite, or account routes. */
export async function runPortraitMeshCanary(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, strict: true, options: {
    fictional: { type: "boolean" }, image: { type: "string" }, source: { type: "string" }, out: { type: "string" },
    "codex-bin": { type: "string" }, model: { type: "string", default: "gpt-5.6-sol" },
  } });
  if (!values.fictional || !values.image || !values.source || !values.out) throw new Error("Required: --fictional --image PNG --source TEXT --out NEW_DIRECTORY [--codex-bin PATH]");
  const source = await readFile(resolve(values.source), "utf8");
  if (!source.trim() || source.length > 65536) throw new Error("Fictional source is empty or too large");
  const prepared = await preparePortraitImage(await readFile(resolve(values.image)));
  const image = Buffer.from(prepared.image_base64, "base64");
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const output = resolve(values.out);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // Refuse overwriting another probe's evidence.
  const writeJson = (name: string, value: unknown) => writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(output, "source.txt"), source, { mode: 0o600 });
  await writeFile(join(output, "reference.png"), image, { mode: 0o600 });
  const claim: CodexPortraitMeshClaim = { schema_version: "codex-portrait-mesh-claim/v1", job_id: `ppmesh_${hash(source).slice(0, 32)}`, portrait_id: `ppor_${hash(image).slice(0, 32)}`,
    chapter_index: 0, chapter_id: "chapter-1", lease_token: randomUUID(), model: values.model!, reasoning_effort: "xhigh", prompt_version: "portrait-mesh/v1", timeout_ms: 900000,
    source_text: source, source_text_sha256: hash(source), source_image_sha256: hash(image), document_revision: "fictional-canary/v1", image_base64: prepared.image_base64, compiler_version: PORTRAIT_MESH_COMPILER_VERSION };
  const started = Date.now();
  let compiledReceipt: object | null = null;
  const outcome = await runPortraitMeshInvocation({ claim, codexBin: values["codex-bin"] ?? process.env.CODEX_BIN ?? "codex",
    onAuthored: async (program, providerRequestId) => writeJson("authored-program.json", { program, provider_request_id: providerRequestId }),
    onInspection: async ({ program, compiled, previews }) => {
      await writeJson("program.json", program);
      await writeFile(join(output, "model.glb"), compiled.glb, { mode: 0o600 });
      for (const view of previews) await writeFile(join(output, `view-${view.label}.png`), view.png, { mode: 0o600 });
      compiledReceipt = { program_sha256: compiled.programSha256, glb_sha256: compiled.sha256, glb_bytes: compiled.glb.byteLength, triangles: compiled.triangles, bounds: compiled.bounds, compiler_version: compiled.compilerVersion,
        views: previews.map((view) => ({ label: view.label, sha256: hash(view.png), bytes: view.png.length })) };
    },
    onVisualCheck: async (audit, providerRequestId) => writeJson("visual-check.json", { audit, provider_request_id: providerRequestId }),
  });
  const receipt = { schema_version: "portrait-mesh-canary/v1", fictional: true, automatic_authoring: true, manual_model_edits: false,
    codex_cli_version: PORTRAIT_CODEX_CLI_VERSION, configured_model: claim.model, reasoning_effort: claim.reasoning_effort,
    source_text_sha256: claim.source_text_sha256, source_image_sha256: claim.source_image_sha256, document_revision: claim.document_revision,
    elapsed_ms: Date.now() - started, compiled: compiledReceipt,
    result: outcome.ok ? { ok: true, audit: outcome.completion.audit, provider_request_id: outcome.completion.provider_request_id, audit_request_id: outcome.completion.audit_request_id }
      : outcome };
  await writeJson("receipt.json", receipt);
  process.stdout.write(`${JSON.stringify({ event: "portrait_mesh_canary_completed", ok: outcome.ok, elapsed_ms: receipt.elapsed_ms })}\n`);
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runPortraitMeshCanary(process.argv.slice(2)); }
  catch { process.stderr.write("Portrait mesh canary failed before completion. Check required arguments and local inputs.\n"); process.exitCode = 1; }
}
