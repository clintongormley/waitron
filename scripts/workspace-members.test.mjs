import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNPM_LS_SPAWN_TIMEOUT_MS, workspaceMembers } from "./workspace-members.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");

// The per-test bound for the one test that spawns the real `pnpm ls`: larger than the kernel-level
// kill, for a slow-but-completing cold CI runner (scripts/ci-workflow.test.mjs records the pair).
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

/** A fake `spawnSync` that records the options it was given and answers with `result`. */
const fakeSpawn = (result, seen = []) => {
  const spawn = (command, args, options) => {
    seen.push({ command, args, options });
    return { status: 0, stdout: "", stderr: "", ...result };
  };
  return spawn;
};

describe("workspaceMembers", () => {
  it("passes the spawn kill timeout, so a hung `pnpm ls` cannot stall the gate", () => {
    const seen = [];
    const spawn = fakeSpawn(
      { stdout: JSON.stringify([{ name: "@waitron/x", path: join(REPO_ROOT, "packages/x") }]) },
      seen,
    );
    // The parsed result as well as the timeout, so a broken parse cannot hide behind a passing
    // timeout check.
    expect(workspaceMembers(spawn)).toEqual([{ name: "@waitron/x", dir: "packages/x" }]);
    expect(seen).toEqual([
      {
        command: "pnpm",
        args: ["ls", "-r", "--depth", "-1", "--json"],
        options: expect.objectContaining({ cwd: REPO_ROOT, timeout: PNPM_LS_SPAWN_TIMEOUT_MS }),
      },
    ]);
  });

  it("throws, naming the kill timeout, when pnpm could not run", () => {
    const spawn = fakeSpawn({ error: new Error("spawn pnpm ETIMEDOUT"), status: null });
    expect(() => workspaceMembers(spawn)).toThrow(
      `\`pnpm ls -r --depth -1 --json\` failed to run (killed after ${PNPM_LS_SPAWN_TIMEOUT_MS}ms?): spawn pnpm ETIMEDOUT`,
    );
  });

  it("throws with pnpm's stderr when it exits non-zero", () => {
    const spawn = fakeSpawn({ status: 1, stderr: "ERR_PNPM_BOOM" });
    expect(() => workspaceMembers(spawn)).toThrow(
      "`pnpm ls -r --depth -1 --json` exited 1: ERR_PNPM_BOOM",
    );
  });

  it("throws rather than answering with no members when the listing cannot be parsed", () => {
    expect(() => workspaceMembers(fakeSpawn({ stdout: "" }))).toThrow(
      "`pnpm ls` returned no parsable workspace listing",
    );
  });

  it(
    "lists the real workspace's members",
    () => {
      const members = workspaceMembers();
      expect(members.map(({ name }) => name)).toContain("@waitron/db");
      expect(members).toContainEqual({ name: "@waitron/db", dir: "packages/db" });
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );
});
