import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { workspacePackages } from "./changed-packages.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");
const PNPM_LS_ARGS = ["ls", "-r", "--depth", "-1", "--json"];

/**
 * The kernel-level kill for the `pnpm ls` child. Vitest's test timer cannot interrupt a blocked
 * `spawnSync`, so without it a hung child outlives the suite; callers pair it with a larger per-test
 * bound for a slow-but-completing cold CI runner (scripts/ci-workflow.test.mjs records the pair).
 */
export const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;

/**
 * @typedef {(
 *   command: string,
 *   args: string[],
 *   options: { cwd: string; encoding: "utf8"; timeout: number },
 * ) => { error?: Error; status: number | null; stdout: string; stderr: string }} Spawn
 */

/**
 * Every workspace member as `{name, dir}`, `dir` relative to the repository root, as
 * `pnpm ls -r --depth -1 --json` lists them and `workspacePackages` (scripts/changed-packages.mjs)
 * reads them — the same source the pre-push hook and CI scope from, so a new workspace root in
 * pnpm-workspace.yaml reaches every root guard that calls this without an edit.
 *
 * Throws when pnpm could not run, exited non-zero, or printed nothing `workspacePackages` can read.
 * A listing that parses but is empty comes back as `[]`, so each caller checks it is non-empty.
 *
 * @param {Spawn} [spawn] injected only so a test can assert the kill timeout and each failure.
 * @returns {{ name: string; dir: string }[]}
 */
export function workspaceMembers(spawn = spawnSync) {
  const command = `\`pnpm ${PNPM_LS_ARGS.join(" ")}\``;
  const result = spawn("pnpm", PNPM_LS_ARGS, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: PNPM_LS_SPAWN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw new Error(
      `${command} failed to run (killed after ${PNPM_LS_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${result.stderr}`);
  }
  const members = workspacePackages(result.stdout, REPO_ROOT);
  if (members === null) throw new Error("`pnpm ls` returned no parsable workspace listing");
  return members;
}
