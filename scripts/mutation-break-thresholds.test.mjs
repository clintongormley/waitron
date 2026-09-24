// Every package that can be mutation-tested declares the score it FAILS at. `packages/db` carries
// its bar in the `mutation-db-aggregate` job rather than its own `stryker.config.json`, because CI
// splits its run across shards and a `thresholds.break` there would gate each shard's slice.
//
// Weaker than its name in one way worth stating: it reads the workflow as TEXT for db's bar, so a
// step that reached the same command through a variable would be invisible to it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNPM_LS_SPAWN_TIMEOUT_MS, workspaceMembers } from "./workspace-members.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BAR = 90;

/**
 * Members come from `pnpm ls` rather than a listing of `packages/`, so a `mutation` script added
 * under any workspace root reaches this guard without an edit.
 */
function mutationPackages() {
  return workspaceMembers()
    .filter(({ dir }) => {
      try {
        return (
          JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).scripts?.mutation !==
          undefined
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

describe("every mutation-tested package declares the bar it fails at", () => {
  it(
    "finds the packages that run mutation testing",
    { timeout: PNPM_LS_SPAWN_TIMEOUT_MS * 2 },
    () => {
      // An empty list would make every case below vacuous.
      expect(mutationPackages().length).toBeGreaterThan(0);
    },
  );

  it(
    "every package but db breaks at 90 in its own stryker config",
    { timeout: PNPM_LS_SPAWN_TIMEOUT_MS * 2 },
    () => {
      // One case over the whole list rather than `it.each`, which would have to build the list
      // while the file is being COLLECTED, where no per-test bound applies and a throw fails the
      // whole file as a collection error rather than as an assertion.
      const bars = mutationPackages()
        .filter(({ dir }) => dir !== "packages/db")
        .map(({ dir }) => ({
          dir,
          bar: JSON.parse(readFileSync(join(root, dir, "stryker.config.json"), "utf8")).thresholds
            ?.break,
        }));

      expect(bars.length).toBeGreaterThan(0);
      expect(bars.filter(({ bar }) => !(bar >= BAR)).map(({ dir }) => dir)).toEqual([]);
    },
  );

  it("packages/db breaks at 90 on the merged score of its shards", () => {
    const config = JSON.parse(
      readFileSync(join(root, "packages", "db", "stryker.config.json"), "utf8"),
    );
    expect(config.thresholds).toBeUndefined();

    // Matched as a whole `run:` line, not as a substring: `run: echo node scripts/…` contains the
    // command and executes nothing.
    const workflow = readFileSync(join(root, ".github", "workflows", "mutation.yml"), "utf8");
    const runs = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("run: "));
    expect(runs).toContain(
      `run: node scripts/mutation-aggregate.mjs mutation-reports --shards 10 --break ${BAR}`,
    );
  });
});
