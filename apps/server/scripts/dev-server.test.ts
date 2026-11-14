import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("dev-server", () => {
  let workDir: string;
  let stubBin: string;
  let stateDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-server-"));
    // A `tsx` first on PATH that prints the arguments it was started with, one per line.
    stubBin = join(workDir, "bin");
    mkdirSync(stubBin);
    writeFileSync(join(stubBin, "tsx"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 0\n");
    chmodSync(join(stubBin, "tsx"), 0o755);
    stateDir = join(workDir, "state");
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, "secrets.env"), "WAITRON_TEST_SECRET=1\n");
    writeFileSync(join(stateDir, "trading.env"), "WAITRON_TEST_TRADING=1\n");
  });

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** The launcher's environment never inherits the runner's own state folder or settings file. */
  function launch(overrides: Record<string, string>, cwd = pkgRoot) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.WAITRON_STATE_DIR;
    delete env.WAITRON_DEV_ENV_FILE;
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./dev-server.mjs", import.meta.url))],
      {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...env,
          PATH: `${stubBin}${delimiter}${process.env.PATH ?? ""}`,
          // Any set value skips the migration copy.
          WAITRON_MIGRATIONS_DIR: join(workDir, "migrations"),
          ...overrides,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const args = result.stdout.split("\n").filter((line) => line !== "");
    return { args, envFileFlags: args.filter((arg) => arg.startsWith("--env-file")) };
  }

  function settingsFile(name: string, body: string): string {
    const path = join(workDir, name);
    writeFileSync(path, body);
    return path;
  }

  const stateFlags = (dir: string) => [
    `--env-file-if-exists=${join(dir, "secrets.env")}`,
    `--env-file-if-exists=${join(dir, "trading.env")}`,
  ];

  // The missing-file refusal exits before copying migrations or starting the server.
  it("refuses a missing WAITRON_DEV_ENV_FILE and names that path", () => {
    const missing = join(workDir, "missing.env");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./dev-server.mjs", import.meta.url))],
      {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, WAITRON_DEV_ENV_FILE: missing },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missing);
    expect(result.stderr).toContain("wa-wt reset own demo <worktree-name>");
    expect(result.stdout).toBe("");
  });

  it("starts the server with the WAITRON_DEV_ENV_FILE settings file as its first --env-file", () => {
    const file = settingsFile("first.env", "WAITRON_ENV=dev\n");
    const { args, envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file });
    expect(args[0]).toBe("watch");
    expect(args.at(-1)).toBe("src/bin.ts");
    expect(envFileFlags[0]).toBe(`--env-file=${file}`);
  });

  it("loads the state folder's files from the process's WAITRON_STATE_DIR when the settings file names none", () => {
    const file = settingsFile("no-state.env", "WAITRON_ENV=dev\n");
    const { envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file, WAITRON_STATE_DIR: stateDir });
    expect(envFileFlags).toEqual([`--env-file=${file}`, ...stateFlags(stateDir)]);
  });

  it("prefers the process's WAITRON_STATE_DIR over the one the settings file names, as the server does", () => {
    const file = settingsFile(
      "other-state.env",
      `WAITRON_ENV=dev\nWAITRON_STATE_DIR=${join(workDir, "elsewhere")}\n`,
    );
    const { envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file, WAITRON_STATE_DIR: stateDir });
    expect(envFileFlags).toEqual([`--env-file=${file}`, ...stateFlags(stateDir)]);
  });

  it("resolves a relative process WAITRON_STATE_DIR from apps/server, not the launcher's cwd", () => {
    const file = settingsFile("relative.env", "WAITRON_ENV=dev\n");
    // A name with no `..`: one that climbs to the root resolves the same from any deep cwd.
    const { envFileFlags } = launch(
      { WAITRON_DEV_ENV_FILE: file, WAITRON_STATE_DIR: "relative-state" },
      workDir,
    );
    expect(envFileFlags).toEqual([
      `--env-file=${file}`,
      ...stateFlags(join(pkgRoot, "relative-state")),
    ]);
  });

  // Setup writes `trading.env` after the launcher starts, and a `tsx watch` rerun keeps the flags.
  it("names the state folder's files even when they do not exist yet", () => {
    const emptyState = join(workDir, "empty-state");
    const file = settingsFile(
      "empty-state.env",
      `WAITRON_ENV=dev\nWAITRON_STATE_DIR=${emptyState}\n`,
    );
    const { envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file });
    expect(envFileFlags).toEqual([`--env-file=${file}`, ...stateFlags(emptyState)]);
  });

  it("takes the settings file's WAITRON_STATE_DIR when the process sets none", () => {
    const file = settingsFile(
      "named-state.env",
      `WAITRON_ENV=dev\nWAITRON_STATE_DIR=${stateDir}\n`,
    );
    const { envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file });
    expect(envFileFlags).toEqual([`--env-file=${file}`, ...stateFlags(stateDir)]);
  });

  // Node keeps an empty process value over `--env-file`'s, and `config.ts` reads empty as unset.
  it("treats an empty process WAITRON_STATE_DIR as the default, not the settings file's folder", () => {
    const file = settingsFile(
      "empty-process.env",
      `WAITRON_ENV=dev\nWAITRON_STATE_DIR=${stateDir}\n`,
    );
    const { envFileFlags } = launch({ WAITRON_DEV_ENV_FILE: file, WAITRON_STATE_DIR: "" });
    expect(envFileFlags).toEqual([
      `--env-file=${file}`,
      ...stateFlags(join(pkgRoot, "src", "state")),
    ]);
  });
});
