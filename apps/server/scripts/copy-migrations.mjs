// Copies each package's `drizzle/` folder in beside the bundle, because the bundle cannot resolve
// them: every *_MIGRATIONS descriptor computes its folder from its own import.meta.url, and esbuild
// collapses all five onto dist/. Reads the SAME manifest `@waitron/migrations` reads, so the two
// cannot disagree about names.
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

// `dist/server.js` is ESM (`esbuild --format=esm`). A bare `.js` file's module system is normally
// decided by walking UP for the nearest `package.json` and reading its "type" field — today that
// walk finds apps/server/package.json's "type": "module" purely because dist/ happens to live two
// directories under it, not because the bundle carries that fact itself. Copy just `dist/` out on
// its own (a Dockerfile doing exactly that is a fair reading of this package's README, which calls
// the bundle self-contained) and that walk finds nothing.
//
// On a Node build where ES-module SYNTAX DETECTION is unavailable or disabled
// (`--no-experimental-detect-module`; confirmed empirically against the Node 26 this repo's own
// `engines` field requires — the flag is real and the failure below reproduces with it set) that
// walk finding nothing means CommonJS by default, and `node dist/server.js` fails immediately with
// "Cannot use import statement outside a module" — never reaching this process's own config
// validation at all. Where syntax detection IS enabled (this repo's supported Node range's actual
// default), Node already recovers from the missing package.json by sniffing the file's own
// `import` syntax — so this write is not fixing an observed failure on this repo's own baseline
// today, but making the module type an explicit, declared fact carried WITH the bundle rather than
// one inferred from source syntax by whichever Node happens to run it, matching how every other
// package.json in this repo declares "type" rather than relying on sniffing. Chosen over renaming
// the bundle to `dist/server.mjs` (which forces the same fact through the file's extension
// instead, unconditionally) because a rename also touches `package.json`'s `bin` field, the CI
// gate's smoke-test paths, and every `node dist/server.js` example in the README, for a difference
// that only shows up off this repo's own tested Node baseline.
await writeFile(join(distDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
process.stdout.write("wrote dist/package.json\n");
