import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GENERATOR = "scripts/generate-hour-release.mjs:v1";
const GENERATOR_SHA256 = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");
const SHA = /^[a-f0-9]{40}$/;
const environment = () =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

export function generateHourRelease({
  cwd = ROOT,
  source,
  fetchSource = false,
  run = execFileSync,
} = {}) {
  if (typeof source !== "string" || !SHA.test(source))
    throw new Error("A full pinned source commit is required");
  let scratch;
  const git = (args) =>
    run("git", args, {
      cwd,
      env: environment(),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 65_536,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    if (fetchSource) {
      scratch = mkdtempSync(join(tmpdir(), "waitron-release-source-"));
      cwd = scratch;
      git(["init", "-q"]);
      git([
        "fetch",
        "--quiet",
        "--depth=1",
        "https://github.com/clintongormley/waitron.git",
        source,
      ]);
    }
    const resolved = git(["rev-parse", "--verify", "--end-of-options", `${source}^{commit}`]);
    const seconds = git(["show", "-s", "--format=%ct", resolved]);
    if (resolved !== source || !SHA.test(resolved) || !/^\d+$/.test(seconds))
      throw new Error("Invalid source commit metadata");
    const instantMs = Number(seconds) * 1000;
    if (!Number.isSafeInteger(instantMs) || !Number.isFinite(new Date(instantMs).getTime()))
      throw new Error("Invalid source commit time");
    return {
      sourceCommit: resolved,
      committedAt: new Date(instantMs).toISOString(),
      instantMs,
      generator: GENERATOR,
      generatorSha256: GENERATOR_SHA256,
    };
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  }
}

export function readBuildHourRelease({ cwd = ROOT } = {}) {
  if (existsSync(join(cwd, ".git"))) {
    const source = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd,
      env: environment(),
      encoding: "utf8",
      timeout: 20_000,
    }).trim();
    return generateHourRelease({ cwd, source });
  }
  const path = join(cwd, "build/hour-release.json");
  if (!existsSync(path)) return null;
  const stamp = JSON.parse(readFileSync(path, "utf8"));
  if (stamp === null) return null;
  if (
    !SHA.test(stamp.sourceCommit) ||
    !Number.isSafeInteger(stamp.instantMs) ||
    !Number.isFinite(new Date(stamp.instantMs).getTime()) ||
    new Date(stamp.instantMs).toISOString() !== stamp.committedAt ||
    stamp.generator !== GENERATOR ||
    stamp.generatorSha256 !== GENERATOR_SHA256
  )
    throw new Error("Invalid generated release stamp");
  return stamp;
}

/* v8 ignore start -- CLI is exercised in child processes. */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (
      args[0] !== "--source" ||
      (args.length !== 2 && !(args.length === 3 && args[2] === "--fetch-source"))
    )
      throw new Error(
        "Usage: generate-hour-release.mjs --source <full-commit-sha> [--fetch-source]",
      );
    console.log(
      JSON.stringify(
        generateHourRelease({ source: args[1], fetchSource: args[2] === "--fetch-source" }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
/* v8 ignore stop */
