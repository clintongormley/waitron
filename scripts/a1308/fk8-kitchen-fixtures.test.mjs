import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { dropObsoleteFields } from "./fk8-kitchen-fixtures.mjs";

it("folds frozen snapshots and drops obsolete insert fields idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "fk8-fixtures-"));
  try {
    const path = join(directory, "kitchen.test.ts");
    writeFileSync(
      path,
      `import { ticketItemAllergies, ticketItems, routingCellPeriods } from "@waitron/db";
await db.insert(ticketItemAllergies).values({ ticketItemId: T, originalBlock: O, currentBlock: C });
await db.insert(ticketItems).values({ id: T, nodeId: N, workingOrderId: B, stationId: S });
await db.insert(routingCellPeriods).values([{ cellId: X, periodId: P, departmentId: D, stationId: S }]);
`,
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [resolve("scripts/a1308/fk8-kitchen-fixtures.mjs"), "--write", path],
        { encoding: "utf8" },
      );
    const first = run();
    expect({ status: first.status, error: first.stderr }).toEqual({ status: 0, error: "" });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("allergyOriginal: O, allergyCurrent: C, allergyFrozen: true");
    expect(text).not.toContain("nodeId:");
    expect(text).not.toContain("departmentId:");
    expect(text).toContain("stationId: S");
    expect(run().status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(text);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("drops only the obsolete keys from literal rows and preserves other insert shapes", () => {
  const source = `
await db.insert(ticketItems).values({ id: T, nodeId: N, note: "keep" });
await db.insert(routingCellPeriods).values([{ cellId: C, departmentId: D, periodId: P }, opaqueRow]);
await db.insert(otherTable).values({ nodeId: N, departmentId: D });
await db.insert(ticketItems).values(rows);
await somethingElse().values({ nodeId: N });
`;
  const result = dropObsoleteFields(source, "sample.test.ts");
  expect(result.reports).toEqual([]);
  expect(result.text).toContain('values({ id: T, note: "keep" })');
  expect(result.text).toContain("values([{ cellId: C, periodId: P }, opaqueRow])");
  expect(result.text).toContain("otherTable).values({ nodeId: N, departmentId: D })");
  expect(result.text).toContain("ticketItems).values(rows)");
  expect(result.text).toContain("somethingElse().values({ nodeId: N })");
  expect(dropObsoleteFields(result.text, "sample.test.ts")).toEqual(result);
});
