import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("ports membership and kept-size fixtures and leaves a second run unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "fk3-fixtures-"));
  try {
    const path = join(directory, "floor.test.ts");
    writeFileSync(
      path,
      `import { floorPlanPlacements, floorPlanTableSizes, floorPlanTableParts, floorResetTableParts } from "@waitron/db";
await db.insert(floorPlanTableParts).values({ joinedTableId: G, partTableId: P });
await db.insert(floorResetTableParts).values({ joinedResetTableId: R, partResetTableId: S });
await db.insert(floorPlanTableSizes).values({ planId: L, planTableId: P, width: 2, height: 3 });
`,
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [resolve("scripts/a1308/fk3-floor-fixtures.mjs"), "--write", path],
        { encoding: "utf8" },
      );
    const first = run();
    expect({ status: first.status, error: first.stderr }).toEqual({ status: 0, error: "" });
    const text = readFileSync(path, "utf8");
    expect(text).toContain(
      "db.update(floorPlanTables).set({ partOfTableId: G }).where(eq(floorPlanTables.id, P))",
    );
    expect(text).toContain(
      "db.update(floorResetTables).set({ partOfResetTableId: R }).where(eq(floorResetTables.id, S))",
    );
    expect(text).toContain(
      "db.insert(floorPlanPlacements).values({ planId: L, planTableId: P, width: 2, height: 3 })",
    );
    expect(text.match(/\bfloorPlanPlacements\b/g)).toHaveLength(2);
    expect(run().status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(text);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
