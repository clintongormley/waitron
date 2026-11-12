import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { isMainScript } from "./is-main-script.mjs";
import { writeBundledNpmNotices } from "./npm-bundle-notices.mjs";
import { readBuildHourRelease } from "./generate-hour-release.mjs";
import { readBuildBackupVerificationRuntime } from "./backup-verification-runtime.mjs";

/** sharp is a native addon: esbuild bundles it without complaint and the bundle then cannot load
 * (docs/developers/ci-and-gates.md, "sharp and the server bundle"). */
export const BUNDLE_EXTERNALS = ["sharp"];

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
    "--banner:js=import { createRequire as __waitronCreateRequire } from 'node:module'; const require = __waitronCreateRequire(import.meta.url);",
    `--metafile=${outfile}.meta.json`,
  ];
}

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Unset or empty, as `isUnset` reads a setting, is not a release. */
export function releaseDefine(env) {
  const value = env.WAITRON_RELEASE_VERSION;
  if (value === undefined || value === "") return "null";
  if (!RELEASE_VERSION.test(value)) throw new Error(`Not a release version: ${value}`);
  return JSON.stringify({ version: value });
}

export function parsePairs(argv) {
  if (argv.length === 0) throw new Error(USAGE);
  return argv.map((pair) => {
    const match = /^([^=]+)=([^=]+)$/.exec(pair);
    if (match === null) throw new Error(`Not an <entry>=<outfile> pair: ${pair}\n${USAGE}`);
    return { entry: match[1], outfile: match[2] };
  });
}

export function bundle(
  pairs,
  {
    run = execFileSync,
    writeNotices = noticeForBundle,
    release,
    backupVerificationRuntime,
    releaseVersion,
  } = {},
) {
  const releaseLiteral =
    releaseVersion === undefined
      ? undefined
      : releaseDefine({ WAITRON_RELEASE_VERSION: releaseVersion ?? undefined });
  for (const { entry, outfile } of pairs) {
    const args = esbuildArgs(entry, outfile);
    if (releaseLiteral !== undefined) {
      args.push("--define:__WAITRON_RELEASE__=__waitronRelease");
      const banner = args.findIndex((arg) => arg.startsWith("--banner:js="));
      args[banner] += `\nconst __waitronRelease = Object.freeze(${releaseLiteral});`;
    }
    if (release !== undefined) {
      const literal = JSON.stringify(release);
      args.push("--define:__WAITRON_HOUR_RELEASE__=__waitronHourReleaseProvenance");
      const banner = args.findIndex((arg) => arg.startsWith("--banner:js="));
      args[banner] += `\nconst __waitronHourReleaseProvenance = Object.freeze(${literal});`;
    }
    if (backupVerificationRuntime !== undefined) {
      args.push(
        "--define:__WAITRON_BACKUP_VERIFICATION_RUNTIME__=__waitronBackupVerificationRuntime",
      );
      const banner = args.findIndex((arg) => arg.startsWith("--banner:js="));
      args[banner] +=
        `\nconst __waitronBackupVerificationRuntime = Object.freeze(${JSON.stringify(backupVerificationRuntime)});`;
    }
    // Found on PATH: each caller keeps esbuild in its devDependencies and runs this via `pnpm run`.
    run("esbuild", args, { stdio: "inherit" });
    writeNotices(outfile);
  }
}

function noticeForBundle(outfile) {
  const metafile = `${outfile}.meta.json`;
  try {
    const { inputs } = JSON.parse(readFileSync(metafile, "utf8"));
    writeBundledNpmNotices(Object.keys(inputs), `${outfile}.NOTICES.txt`);
  } finally {
    rmSync(metafile, { force: true });
  }
}

// CLI assertions execute this block in child processes, outside the parent coverage collector.
/* v8 ignore start */
if (isMainScript(import.meta.url)) {
  try {
    const pairs = parsePairs(process.argv.slice(2));
    const release = readBuildHourRelease();
    bundle(pairs, {
      releaseVersion: process.env.WAITRON_RELEASE_VERSION ?? null,
      release,
      backupVerificationRuntime: readBuildBackupVerificationRuntime({ release }),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = typeof error.status === "number" ? error.status : 1;
  }
}
/* v8 ignore stop */
