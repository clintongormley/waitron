import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { expect, it, vi } from "vitest";
import { renameMerges } from "./fk5-rename-merges.mjs";

it("renames only the merge table and its declared names, once", () => {
  const input =
    "floor_today_joins floorTodayJoins floor_today_joins_zone_idx floor_today_joins_seats_ck floor_today_joins_zone_fk floor_today_join_tables xfloor_today_joins floorTodayJoinsExtra";
  const expected =
    "table_merges tableMerges table_merges_zone_idx table_merges_seats_ck table_merges_zone_fk floor_today_join_tables xfloor_today_joins floorTodayJoinsExtra";
  expect(renameMerges(input)).toBe(expected);
  expect(renameMerges(expected)).toBe(expected);
});

it("preserves the frozen Madrid adapter and captures while renaming current code", async () => {
  const root = mkdtempSync(join(tmpdir(), "fk5-rename-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const originalCwd = process.cwd();
  const originalArgv = process.argv;
  const paths = [
    "apps/current.ts",
    "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts",
    "packages/country-es/test-fixtures/demo/madrid-before-move.en.json",
  ];
  try {
    execFileSync("git", ["init", "-q", root], { env });
    for (const path of paths) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "floor_today_joins");
    }
    execFileSync("git", ["-C", root, "add", "."], { env });
    const script = fileURLToPath(new URL("./fk5-rename-merges.mjs", import.meta.url));
    for (const key of Object.keys(process.env).filter((key) => key.startsWith("GIT_")))
      vi.stubEnv(key, undefined);
    process.chdir(root);
    process.argv = [process.execPath, script];
    vi.resetModules();
    await import("./fk5-rename-merges.mjs");
    expect(readFileSync(join(root, paths[0]), "utf8")).toBe("table_merges");
    for (const path of paths.slice(1))
      expect(readFileSync(join(root, path), "utf8")).toBe("floor_today_joins");
    writeFileSync(join(root, paths[0]), "floor_today_joins");
    expect(execFileSync(process.execPath, [script], { cwd: root, env, encoding: "utf8" })).toBe(
      "apps/current.ts\n",
    );
    expect(readFileSync(join(root, paths[0]), "utf8")).toBe("table_merges");
    for (const path of paths.slice(1))
      expect(readFileSync(join(root, path), "utf8")).toBe("floor_today_joins");
    expect(execFileSync(process.execPath, [script], { cwd: root, env, encoding: "utf8" })).toBe("");
  } finally {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
