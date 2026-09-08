import fs from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { compilePortraitMesh } from "../../../apps/codex-runner/src/portrait-mesh-compiler.ts";

const output = new URL("./", import.meta.url);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const source = await fs.readFile("apps/web/src/preview/native-image-study.ts", "utf8");
const document = JSON.parse(source.match(/export const nativePattern: PatternResponseV7 = ([\s\S]*?);/)[1]);
document.uncertainty = { text: "LOCAL REVIEW FIXTURE: fictional chapters and compiled test shapes; no account or generation service contacted." };
const priorHarness = await fs.readFile("/tmp/claude-1000/-home-henry-patternlike-app/afd49d89-a775-467c-a62d-33569e1a6d3b/scratchpad/h-account.mjs", "utf8");
const chart = vm.runInNewContext(priorHarness.slice(priorHarness.indexOf("const chart ="), priorHarness.indexOf("const revision =")) + "chart");
const revision = `${document.schema_version}:${document.pattern_id}:${document.generated_at}`;
const chapters = [], models = [];
for (let index = 0; index < 4; index++) {
  const c = document.core_chapters[index];
  const chapterId = `chapter-${index + 1}`;
  const text = JSON.stringify({ title: c.title, summary: c.summary, sections: c.sections.map(x => x.text), tensions: c.tensions.map(x => x.text), resources: c.resources.map(x => x.text), counterExpression: c.counter_expression.text });
  const png = await fs.readFile(`apps/web/src/preview/references/native-0${index + 1}.png`);
  const compiled = compilePortraitMesh({ version: "portrait-mesh-program/v1", materials: [{ id: "oak", color: "#ad8151", metalness: 0, roughness: 0.7 }], parts: [{ name: "review-test-shape", material: "oak", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], repeat: null, geometry: { kind: "box", size: [1, 1 + index * 0.2, 0.7], bevel: 0.04 } }] }, { chapterId, documentRevision: revision, sourceImageSha256: hash(png), sourceTextSha256: hash(text) });
  chapters.push({ chapter_id: chapterId, reference_id: `reference-${index + 1}`, label: `Compiled review shape ${index + 1}`, rationale: "Synthetic geometry used only for local workflow checks.", reference_sha256: hash(png), source_text: text });
  models.push({ chapter_id: chapterId, reference_id: `model-${index + 1}`, sha256: compiled.sha256, source_image_sha256: hash(png), source_text_sha256: hash(text), source_text: text, program_sha256: compiled.programSha256, compiler_version: compiled.compilerVersion, authoring: "codex-parametric/v1", document_revision: revision });
  await fs.writeFile(new URL(`model-${index + 1}.glb`, output), compiled.glb);
}
const graph = { engine_version: "constellation-v1", positions: [-1,-1,0, 1,-1,0, -1,1,0, 1,1,0], source_indices: [0,1,2,3], star_strengths: [1,1,1,1], connections: [[0,1],[1,2],[2,3]], color: [0.5,0.4,0.3], contributions: Array.from({length:4},(_,index)=>({index,aspect:1,coverage:0.5,opening_area:0,skew:0,stars:1,interior_lines:0})) };
const portrait = { schema_version: "pattern-portrait/v1", status: "ready", portrait_id: "portrait-review-fictional", chart_id: chart.id, pattern_id: document.pattern_id, generated_at: document.generated_at, document_revision: revision, sun_sign: "taurus", completed_chapters: 4, retryable: false, chapters, graph };
const explorer = { schema_version: "pattern-portrait-explorer/v1", status: "ready", portrait, completed_models: 4, retryable: false, models };
await fs.writeFile(new URL("fixture.json", output), JSON.stringify({ document, chart, explorer }, null, 2));
console.log(JSON.stringify({ fictional: true, compiledModels: models.length, hashes: models.map(m=>m.sha256) }));
