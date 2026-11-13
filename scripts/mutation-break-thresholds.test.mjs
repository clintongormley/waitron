// Weaker than its name: reads the local mutation template and literal caller inputs as text,
// never a running workflow or a Stryker report. Shared CI wiring is checked in ci-workflow.test.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mutationCallers } from "./mutation-workflow.mjs";
import { PNPM_LS_SPAWN_TIMEOUT_MS, workspaceMembers } from "./workspace-members.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BAR = 90;
const CALLERS = mutationCallers(readFileSync(join(root, ".github/workflows/mutation.yml"), "utf8"));
const SHARDED = new Set(CALLERS.map((caller) => "packages/" + caller.package));
const common = readFileSync(join(root, ".github/workflows/mutation-sharded.yml"), "utf8");

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
  it("keeps shared's local floor while its CI shards emit reports for the combined floor", async () => {
    const local = JSON.parse(
      readFileSync(join(root, "packages/shared/stryker.config.json"), "utf8"),
    );
    const { default: shard } = await import("../packages/shared/stryker.ci.config.mjs");
    expect(local.thresholds.break).toBe(90);
    expect(shard.mutate).toEqual(local.mutate);
    expect(shard.thresholds.break).toBe(0);
    expect(shard.incremental).toBe(false);
    expect(shard.reporters).toContain("json");
    expect(shard.jsonReporter.fileName).toBe("reports/mutation/mutation.json");
  });

  it(
    "finds the packages that run mutation testing",
    { timeout: PNPM_LS_SPAWN_TIMEOUT_MS * 2 },
    () => {
      // An empty list would make every case below vacuous.
      expect(mutationPackages().length).toBeGreaterThan(0);
    },
  );

  it(
    "every package but db, ui and ui-core breaks at 90 in its own stryker config",
    { timeout: PNPM_LS_SPAWN_TIMEOUT_MS * 2 },
    () => {
      // One case over the whole list rather than `it.each`, which would have to build the list
      // while the file is being COLLECTED, where no per-test bound applies and a throw fails the
      // whole file as a collection error rather than as an assertion.
      const bars = mutationPackages()
        .filter(({ dir }) => !SHARDED.has(dir))
        .map(({ dir }) => ({
          dir,
          bar: JSON.parse(readFileSync(join(root, dir, "stryker.config.json"), "utf8")).thresholds
            ?.break,
        }));

      expect(bars.length).toBeGreaterThan(0);
      expect(bars.filter(({ bar }) => !(bar >= BAR)).map(({ dir }) => dir)).toEqual([]);
    },
  );

  it("the sharded packages break at 90 only on their combined score", () => {
    expect(SHARDED.size).toBeGreaterThan(0);
    const commands = common.split("\n").map((line) => line.trim());
    expect(commands).toContain(
      'node scripts/mutation-aggregate.mjs mutation-reports --package "$PACKAGE" --shards "$TOTAL" --break 90',
    );
    for (const dir of SHARDED) {
      const config = JSON.parse(readFileSync(join(root, dir, "stryker.config.json"), "utf8"));
      expect(config.thresholds?.break).toBeUndefined();
    }
  });

  it("every sharded package writes a json report inside the directory its shards upload", () => {
    const lines = common.split("\n").map((line) => line.trim());
    const at = lines.findIndex((line) =>
      line.startsWith("name: mutation-report-${{ inputs.package }}-shard-"),
    );
    expect(at).toBeGreaterThan(-1);
    const path = lines
      .slice(at + 1, at + 4)
      .find((line) => line.startsWith("path: "))
      ?.slice(6)
      .replace(/\/$/, "");
    expect(path).toBeDefined();
    const problems = [...SHARDED].sort().flatMap((dir) => {
      const config = JSON.parse(readFileSync(join(root, dir, "stryker.config.json"), "utf8"));
      const uploaded = path.replace("${{ inputs.package }}", dir.split("/").pop());
      const written = config.jsonReporter?.fileName
        ? join(dir, config.jsonReporter.fileName)
        : undefined;
      const found = [];
      if (!config.reporters?.includes("json")) found.push(`${dir}: no "json" reporter`);
      if (!written?.startsWith(`${uploaded}/`))
        found.push(`${dir}: jsonReporter.fileName ${written} is not under ${uploaded}/`);
      return found;
    });
    expect(problems).toEqual([]);
  });
});
