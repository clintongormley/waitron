import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `scripts/main-tag-guard.sh` decides whether this commit may move the `:main` image tag, and the
// publish job in ci.yml asks it before adding that tag. Two pushes to `main` run at the same time
// (the workflow's concurrency block gives every push a group of its own), so the run that finishes
// LAST is not necessarily the run carrying the newest commit — and a mutable tag is last-write-wins.
// Without this the older run retags `:main`, and every box following that tag is pulled backwards.
//
// The script is run for real here. What is faked is only the world outside it: `docker` and `gh`
// are shell stubs on PATH that print a fixture and record their arguments, so each case asserts the
// script's own decision rather than a model of it.

const script = join(import.meta.dirname, "main-tag-guard.sh");
const IMAGE = "ghcr.io/example/waitron:main";
const REPOSITORY = "example/waitron";
const SHA = "1c57940203777e2a408258d34e363718c3d89181";
const OLDER = "d0e0923c5da1b576505e45e39e195906681e2ebc";

/**
 * The published image's environment, as `docker buildx imagetools inspect` prints it under the
 * script's Go template — one `NAME=value` per line. The image records the commit it was built from
 * in `WAITRON_BUILD_ID` (deploy/Dockerfile), which is the only thing the registry can tell us about
 * which commit `:main` currently points at.
 */
function imageEnv(buildId) {
  const env = ["PATH=/usr/local/bin", ...(buildId === null ? [] : [`WAITRON_BUILD_ID=${buildId}`])];
  return `${env.join("\n")}\n`;
}

/**
 * Runs the real script with `docker` and `gh` stubbed. Each stub writes its arguments to a file so
 * a case can assert what the script asked for — including asking nothing at all.
 */
function runGuard({ docker, gh }) {
  const dir = mkdtempSync(join(tmpdir(), "main-tag-guard-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);

  for (const [name, { stdout = "", stderr = "", status = 0 }] of Object.entries({ docker, gh })) {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/usr/bin/env sh\nprintf '%s\\n' "$*" >> ${join(dir, `${name}.args`)}\n` +
        `printf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${status}\n`,
    );
    chmodSync(path, 0o755);
  }

  const result = spawnSync("sh", [script, IMAGE, REPOSITORY, SHA], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const argsOf = (name) =>
    existsSync(join(dir, `${name}.args`)) ? readFileSync(join(dir, `${name}.args`), "utf8") : "";

  return { ...result, dockerArgs: argsOf("docker"), ghArgs: argsOf("gh") };
}

/** `gh` is never reached in these cases; if the script calls it anyway, the case fails loudly. */
const ghMustNotRun = { stdout: "", stderr: "gh should not have been called", status: 3 };

describe("main-tag-guard.sh", () => {
  it("moves the tag when nothing is published under it yet", () => {
    const result = runGuard({
      docker: { stdout: "", stderr: "ERROR: ghcr.io/example/waitron:main: not found", status: 1 },
      gh: ghMustNotRun,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("move");
  });

  it("moves the tag when the published image is an OLDER commit", () => {
    const result = runGuard({
      docker: { stdout: imageEnv(OLDER) },
      gh: { stdout: "ahead\n" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("move");
    // The comparison must be published-commit FIRST: GitHub reports the status of the second
    // commit relative to the first, so the operands reversed would invert every answer.
    expect(result.ghArgs).toContain(`repos/${REPOSITORY}/compare/${OLDER}...${SHA}`);
  });

  it("holds the tag when the published image is a NEWER commit", () => {
    const result = runGuard({
      docker: { stdout: imageEnv("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") },
      gh: { stdout: "behind\n" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("hold");
  });

  it("moves the tag, asking nothing, when the published image is this very commit", () => {
    const result = runGuard({ docker: { stdout: imageEnv(SHA) }, gh: ghMustNotRun });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("move");
    expect(result.ghArgs).toBe("");
  });

  // The three cases where the script cannot know the answer. It fails rather than guessing: a
  // publish that stops is recoverable by the next merge, a `:main` moved the wrong way is not
  // noticed at all.
  it("fails when the registry read fails for any reason other than a missing tag", () => {
    const result = runGuard({
      docker: { stdout: "", stderr: "unauthorized: authentication required", status: 1 },
      gh: ghMustNotRun,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
    expect(result.stderr).toContain("unauthorized");
  });

  it("fails when the published image carries no build id to compare against", () => {
    const result = runGuard({ docker: { stdout: imageEnv(null) }, gh: ghMustNotRun });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
  });

  it("fails when the comparison answers something it does not understand", () => {
    const result = runGuard({ docker: { stdout: imageEnv(OLDER) }, gh: { stdout: "\n" } });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
  });

  it("refuses to run without its three arguments", () => {
    const result = spawnSync("sh", [script, IMAGE], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
  });
});
