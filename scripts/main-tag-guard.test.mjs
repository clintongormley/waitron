import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The script is run for real, by its own path so the executable bit and the shebang are exercised
// the way ci.yml invokes it. Only `docker` and `gh` are faked: stubs on PATH that print a fixture and
// record their arguments.
//
// Where a fixture was taken from the real registry, the command is named beside it: a stub whose
// shape is wrong makes every case here pass against a script that fails in CI.

const script = join(import.meta.dirname, "main-tag-guard.sh");
const IMAGE = "ghcr.io/example/waitron:main";
const REPOSITORY = "example/waitron";
const SHA = "1c57940203777e2a408258d34e363718c3d89181";
const OLDER = "d0e0923c5da1b576505e45e39e195906681e2ebc";

// Vitest's own timer cannot interrupt a `spawnSync` (it blocks the event loop), so this kill is the
// only bound on a stub that will not exit.
const SPAWN_TIMEOUT_MS = 30_000;
// Vitest fails a healthy run that outlasts its per-test timeout, whose default is 5s. Each case here
// makes one `runGuard()` call, so a per-test bound above the spawn timeout covers it. The script performs no
// wait of its own — no sleep, no retry loop — so a healthy child's duration is its stubs' duration.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS + 10_000 });

const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * The published image's environment, one `NAME=value` per line, as
 * `docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main --format
 * '{{range .Image.Config.Env}}{{println .}}{{end}}'` prints it. `WAITRON_BUILD_ID` is the only
 * thing this image records about its commit; the print-agent image records nothing at all, which is
 * why the guard reads the app image.
 */
function imageEnv(buildId) {
  const env = ["PATH=/usr/local/bin", ...(buildId === null ? [] : [`WAITRON_BUILD_ID=${buildId}`])];
  return `${env.join("\n")}\n`;
}

// The two stubs are written ONCE for the whole file, because executing a freshly written file is
// much slower on macOS than executing it again. What each case varies travels in the environment.
const STUB_BIN = mkdtempSync(join(tmpdir(), "main-tag-guard-bin-"));
temporaryDirectories.push(STUB_BIN);
for (const name of ["docker", "gh"]) {
  const upper = name.toUpperCase();
  const path = join(STUB_BIN, name);
  writeFileSync(
    path,
    `#!/usr/bin/env sh\n` +
      `printf '%s\\n' "$*" >> "$WT_ARGS_DIR/${name}.args"\n` +
      `printf '%s' "$WT_${upper}_STDOUT"\n` +
      `printf '%s' "$WT_${upper}_STDERR" >&2\n` +
      `exit "\${WT_${upper}_STATUS:-0}"\n`,
  );
  chmodSync(path, 0o755);
}

function runGuard({ docker, gh, argv = [IMAGE, REPOSITORY, SHA] }) {
  const dir = mkdtempSync(join(tmpdir(), "main-tag-guard-"));
  temporaryDirectories.push(dir);

  const outputs = {};
  for (const [name, { stdout = "", stderr = "", status = 0 }] of Object.entries({ docker, gh })) {
    const upper = name.toUpperCase();
    outputs[`WT_${upper}_STDOUT`] = stdout;
    outputs[`WT_${upper}_STDERR`] = stderr;
    outputs[`WT_${upper}_STATUS`] = String(status);
  }

  const result = spawnSync(script, argv, {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      WT_ARGS_DIR: dir,
      ...outputs,
    },
  });

  const argsOf = (name) =>
    existsSync(join(dir, `${name}.args`)) ? readFileSync(join(dir, `${name}.args`), "utf8") : "";

  return { ...result, dockerArgs: argsOf("docker"), ghArgs: argsOf("gh") };
}

/** `gh` is never reached in these cases; if the script calls it anyway, the case fails loudly. */
const ghMustNotRun = { stdout: "", stderr: "gh should not have been called", status: 3 };

describe("main-tag-guard.sh", () => {
  it("moves the tag when nothing is published under it yet", () => {
    // Verbatim from `docker buildx imagetools inspect ghcr.io/clintongormley/waitron:no-such-tag-xyz`.
    const result = runGuard({
      docker: { stdout: "", stderr: `ERROR: ${IMAGE}: not found`, status: 1 },
      gh: ghMustNotRun,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("move");
    // A wrong ref or a dropped template would still have produced a decision here.
    expect(result.dockerArgs).toContain(IMAGE);
    expect(result.dockerArgs).toContain("{{range .Image.Config.Env}}{{println .}}{{end}}");
  });

  it("moves the tag when the published image is an OLDER commit", () => {
    const result = runGuard({ docker: { stdout: imageEnv(OLDER) }, gh: { stdout: "ahead\n" } });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("move");
    // The comparison must be published-commit FIRST: GitHub reports the status of the second commit
    // relative to the first, so the operands reversed would invert every answer.
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

  // The cases where the script cannot know the answer. It fails rather than guessing: a publish that
  // stops is repaired by the next merge, a `:main` moved the wrong way is noticed by nobody.
  it("fails when the registry refuses the read", () => {
    // Verbatim from an inspect of a package that does not exist, which is how GHCR answers rather
    // than with `not found` — so the first publish into a brand-new package stops here.
    const stderr =
      "ERROR: failed to authorize: failed to fetch anonymous token: unexpected status " +
      "from GET request to https://ghcr.io/token: 403 Forbidden";
    const result = runGuard({ docker: { stdout: "", stderr, status: 1 }, gh: ghMustNotRun });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
    expect(result.stderr).toContain("403 Forbidden");
  });

  // The narrowing that matters most. `not found` appears in errors that are NOT a missing tag — a
  // credential helper that is not installed, a proxy's 404 page, a missing `docker` binary. Reading
  // any of them as "no tag yet" would publish the backwards tag this script exists to prevent.
  it("fails when `not found` refers to something other than the image", () => {
    const result = runGuard({
      docker: {
        stdout: "",
        stderr: "error getting credentials: docker-credential-osxkeychain not found",
        status: 1,
      },
      gh: ghMustNotRun,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
  });

  it("fails when the published image carries no build id to compare against", () => {
    const result = runGuard({ docker: { stdout: imageEnv(null) }, gh: ghMustNotRun });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
    expect(result.stderr).toContain("WAITRON_BUILD_ID");
    expect(result.ghArgs).toBe("");
  });

  it("fails when the comparison cannot be made at all", () => {
    const result = runGuard({
      docker: { stdout: imageEnv(OLDER) },
      gh: { stdout: "", stderr: "gh: Not Found (HTTP 404)", status: 1 },
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
    expect(result.stderr).toContain("404");
  });

  it("fails when the comparison answers something it does not understand", () => {
    const result = runGuard({ docker: { stdout: imageEnv(OLDER) }, gh: { stdout: "\n" } });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("move");
  });

  it("refuses to run without its three arguments, reaching nothing", () => {
    const result = runGuard({ docker: ghMustNotRun, gh: ghMustNotRun, argv: [IMAGE] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
    expect(result.dockerArgs).toBe("");
  });
});
