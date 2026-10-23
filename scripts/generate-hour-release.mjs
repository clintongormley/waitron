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
  sourceMetadata,
  fetchSource = false,
  run = execFileSync,
} = {}) {
  if (typeof source !== "string" || !SHA.test(source))
    throw new Error("A full pinned source commit is required");
  let scratch;
  const git = (args, options = {}) =>
    run("git", args, {
      cwd,
      env: environment(),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 65_536,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  try {
    if (fetchSource && sourceMetadata === undefined) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
        scratch = mkdtempSync(join(tmpdir(), "waitron-release-source-"));
        cwd = scratch;
        git(["init", "-q"]);
        try {
          git(
            [
              "fetch",
              "--quiet",
              "--depth=1",
              "https://github.com/clintongormley/waitron.git",
              source,
            ],
            {
              env: {
                ...environment(),
                GIT_HTTP_LOW_SPEED_LIMIT: "1000",
                GIT_HTTP_LOW_SPEED_TIME: "10",
              },
              killSignal: "SIGKILL",
            },
          );
          break;
        } catch (error) {
          console.error(`Release source fetch attempt ${attempt} of 2 failed: ${error.message}`);
          if (attempt === 2) throw error;
        }
      }
    }
    let resolved = source;
    let seconds;
    if (sourceMetadata === undefined) {
      resolved = git(["rev-parse", "--verify", "--end-of-options", `${source}^{commit}`]);
      seconds = git(["show", "-s", "--format=%ct", resolved]);
    } else {
      const metadata =
        typeof sourceMetadata === "string" && /^([a-f0-9]{40}):(\d+)$/.exec(sourceMetadata);
      if (!metadata || metadata[1] !== source) throw new Error("Invalid source commit metadata");
      seconds = metadata[2];
    }
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
      (args.length !== 2 &&
        !(args.length === 3 && args[2] === "--fetch-source") &&
        !(args.length === 4 && args[2] === "--source-metadata"))
    )
      throw new Error(
        "Usage: generate-hour-release.mjs --source <full-commit-sha> [--fetch-source | --source-metadata <sha:seconds>]",
      );
    console.log(
      JSON.stringify(
        generateHourRelease({
          source: args[1],
          fetchSource: args[2] === "--fetch-source",
          sourceMetadata: args[2] === "--source-metadata" ? args[3] : undefined,
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
/* v8 ignore stop */
