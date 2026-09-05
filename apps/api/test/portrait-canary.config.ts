/** Opt-in local canary. Never part of the ordinary or CI test include. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CodexPortraitCompletion } from "@patternlike/shared";
import { createPortraitGraph } from "../../../packages/shared/src/portrait-graph.js";
import { defineConfig } from "vitest/config";
import base from "../vitest.config.js";

const directory = process.env.PORTRAIT_CANARY_DIR;
if (!directory) throw new Error("PORTRAIT_CANARY_DIR must name the task-owned native fixture directory");
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(directory,file),"utf8"));
const completions = [1,2,3,4].map((index)=>read(`chapter-${index}-completion.json`) as CodexPortraitCompletion);
const graph = createPortraitGraph(completions.map((completion)=>({width:completion.pixels.width,height:completion.pixels.height,data:new Uint8ClampedArray(Buffer.from(completion.pixels.rgba_base64,"base64"))})),"aries");
const graphSha256 = createHash("sha256").update(JSON.stringify(graph)).digest("hex");
writeFileSync(path.join(directory,"api-canary-expected-graph.json"),JSON.stringify(graph));
writeFileSync(path.join(directory,"api-canary-expected-receipt.json"),JSON.stringify({graph_sha256:graphSha256,stars:graph.source_indices.length,connections:graph.connections.length,hashes:completions.map((completion,index)=>({chapter:index+1,source_sha256:completion.source_sha256,original_sha256:completion.original_sha256,image_sha256:createHash("sha256").update(Buffer.from(completion.image_base64,"base64")).digest("hex")}))},null,2));
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test/portrait-canary.ts"],
    silent: false,
    provide: { portraitCanary: { chapters:read("../chapters.json"), completions, graphSha256 } },
  },
});
