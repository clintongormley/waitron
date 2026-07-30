// Copies each package's `drizzle/` folder in beside the bundle, because the bundle cannot resolve
// them: every *_MIGRATIONS descriptor computes its folder from its own import.meta.url, and esbuild
// collapses all five onto dist/. Reads the SAME manifest `@waitron/migrations` reads, so the two
// cannot disagree about names.
//
// A copy of `apps/server/scripts/copy-migrations.mjs`, differing only in which package's `dist/` it
// writes to. Both exist because both ship a bundle that migrates: the server at boot, this tool in
// `instance`. The duplication is two lines of path arithmetic; the alternative — a shared script
// parameterised by output directory — would put a build-time dependency between two packages that
// otherwise share only `@waitron/migrations`.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const manifestUrl = import.meta.resolve("@waitron/migrations/migrations.manifest.json");
const manifestPath = fileURLToPath(manifestUrl);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestRoot = dirname(manifestPath);
const distDir = join(packageRoot, "dist");
const target = join(distDir, "drizzle");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const set of manifest) {
  await cp(resolve(manifestRoot, set.from), join(target, set.name), { recursive: true });
  process.stdout.write(`copied ${set.name} migrations\n`);
}

// `dist/bin.js` is ESM (`esbuild --format=esm`). A bare `.js` file's module system is normally
// decided by walking UP for the nearest `package.json` and reading its "type" field — today that
// walk finds packages/provisioning/package.json's "type": "module" purely because dist/ happens to
// live two directories under it, not because the bundle carries that fact itself. Copy just `dist/`
// out on its own and that walk finds nothing.
//
// Where Node's ES-module SYNTAX DETECTION is enabled (this repo's supported Node range's default)
// Node recovers by sniffing the file's own `import` syntax, so this write is not fixing a failure
// observed on this repo's baseline. It makes the module type an explicit fact carried WITH the
// bundle rather than one inferred by whichever Node happens to run it — the same reasoning, and the
// same line, as `apps/server/scripts/copy-migrations.mjs`, which states it at length.
await writeFile(join(distDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
process.stdout.write("wrote dist/package.json\n");
