import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { foldInserts } from "./lib/fold-inserts.mjs";
import { rules } from "./fk5-split-merge-fixtures.mjs";

it("folds merge members into their live rows and is idempotent", () => {
  const imports =
    'import { eq } from "drizzle-orm";\nimport { diningTables } from "@waitron/db";\n';
  const input =
    imports +
    "db.insert(floorTodayJoinTables).values({ id: I, tableId: T, joinId: M, beforeX: 1, beforeY: 2, beforeRotation: 30 });";
  const expected =
    imports +
    "db.update(diningTables).set({ mergeId: M, mergeBeforeX: 1, mergeBeforeY: 2, mergeBeforeRotation: 30 }).where(eq(diningTables.id, T));";
  const result = foldInserts(input, "sample.test.ts", rules);
  expect(result).toEqual({ text: expected, reports: [] });
  expect(foldInserts(result.text, "sample.test.ts", rules)).toEqual(result);
});

it("the command previews the fold, then writes the selected fixture", async () => {
  const root = mkdtempSync(join(tmpdir(), "fk5-fold-"));
  const path = join(root, "sample.test.ts");
  const input =
    'import { eq } from "drizzle-orm";\nimport { diningTables } from "@waitron/db";\ndb.insert(floorTodayJoinTables).values({ tableId: T, joinId: M });';
  const argv = process.argv;
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    writeFileSync(path, input);
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("./fk5-split-merge-fixtures.mjs", import.meta.url)),
      path,
    ];
    vi.resetModules();
    await import("./fk5-split-merge-fixtures.mjs");
    expect(readFileSync(path, "utf8")).toBe(input);
    expect(output).toHaveBeenCalledWith(`${path}: would rewrite`);
    process.argv.push("--write");
    vi.resetModules();
    await import("./fk5-split-merge-fixtures.mjs");
    expect(readFileSync(path, "utf8")).toBe(
      'import { eq } from "drizzle-orm";\nimport { diningTables } from "@waitron/db";\ndb.update(diningTables).set({ mergeId: M }).where(eq(diningTables.id, T));',
    );
    expect(output).toHaveBeenCalledWith(`${path}: rewritten`);
  } finally {
    process.argv = argv;
    output.mockRestore();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
