// Copies each package's `drizzle/` folder in beside the bundle: every *_MIGRATIONS descriptor
// computes its folder from its own import.meta.url, and esbuild collapses them all onto dist/. Reads
// the same manifest `@waitron/migrations` reads, so the two cannot disagree about names.
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

// The ESM bundle carries its own module type, so a `dist/` copied out alone does not depend on
// finding apps/server/package.json above it or on Node's syntax detection.
await writeFile(join(distDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
process.stdout.write("wrote dist/package.json\n");
