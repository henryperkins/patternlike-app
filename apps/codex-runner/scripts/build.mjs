import { build } from "esbuild";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(runnerRoot, "dist");
const externalPackages = ["sharp", "three"];

/** Bundle workspace sources; preserve native Sharp and Three addon resolution. */
export async function buildRunner(output = defaultOutput) {
  const outdir = resolve(output);
  const manifest = JSON.parse(
    await readFile(resolve(runnerRoot, "package.json"), "utf8"),
  );
  const dependencies = Object.fromEntries(
    externalPackages.map((name) => {
      const version = manifest.dependencies[name];
      if (!/^\d+\.\d+\.\d+$/.test(version))
        throw new Error(`Runtime dependency must be pinned: ${name}`);
      return [name, version];
    }),
  );
  if (outdir === defaultOutput) {
    // Never ship stale tsc output that still imports private workspace packages.
    await rm(outdir, { recursive: true, force: true });
  } else {
    await mkdir(outdir, { recursive: true });
    if ((await readdir(outdir)).length !== 0)
      throw new Error("Custom build output must be an empty directory");
  }
  const result = await build({
    absWorkingDir: runnerRoot,
    entryPoints: {
      index: "src/index.ts",
      "portrait-mesh-canary": "src/portrait-mesh-canary.ts",
    },
    outdir,
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "node",
    target: "node22",
    external: externalPackages,
    metafile: true,
    legalComments: "inline",
    write: false,
    logLevel: "warning",
  });
  for (const file of Object.values(result.metafile.outputs)) {
    for (const dependency of file.imports) {
      if (!dependency.external) continue;
      if (dependency.path.startsWith("node:")) continue;
      if (
        externalPackages.some(
          (name) =>
            dependency.path === name || dependency.path.startsWith(`${name}/`),
        )
      )
        continue;
      throw new Error(`Unpackaged runtime dependency: ${dependency.path}`);
    }
  }
  await mkdir(outdir, { recursive: true });
  for (const file of result.outputFiles)
    await writeFile(file.path, file.contents);
  await writeFile(
    resolve(outdir, "package.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        private: true,
        license: manifest.license,
        type: "module",
        engines: { node: ">=22" },
        main: "index.js",
        scripts: { start: "node index.js" },
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    "Built standalone runner and portrait mesh canary (Node 22 ESM).\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: { outdir: { type: "string" } },
    strict: true,
  });
  await buildRunner(values.outdir);
}
