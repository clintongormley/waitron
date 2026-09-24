import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** sharp is a native addon: esbuild bundles it without complaint and the bundle then cannot load
 * (docs/developers/ci-and-gates.md, "sharp and the server bundle"). */
export const BUNDLE_EXTERNALS = ["sharp"];

// Probe for PR #593: never merged.
const USAGE = "Usage: node scripts/bundle-node.mjs <entry>=<outfile> [<entry>=<outfile>...]";

export function esbuildArgs(entry, outfile) {
  return [
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node24",
    ...BUNDLE_EXTERNALS.map((name) => `--external:${name}`),
    `--outfile=${outfile}`,
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  ];
}

export function parsePairs(argv) {
  if (argv.length === 0) throw new Error(USAGE);
  return argv.map((pair) => {
    const match = /^([^=]+)=([^=]+)$/.exec(pair);
    if (match === null) throw new Error(`Not an <entry>=<outfile> pair: ${pair}\n${USAGE}`);
    return { entry: match[1], outfile: match[2] };
  });
}

export function bundle(pairs, { run = execFileSync } = {}) {
  for (const { entry, outfile } of pairs) {
    // Found on PATH: each caller keeps esbuild in its devDependencies and runs this via `pnpm run`.
    run("esbuild", esbuildArgs(entry, outfile), { stdio: "inherit" });
  }
}

// CLI assertions execute this block in child processes, outside the parent coverage collector.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    bundle(parsePairs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = typeof error.status === "number" ? error.status : 1;
  }
}
/* v8 ignore stop */
