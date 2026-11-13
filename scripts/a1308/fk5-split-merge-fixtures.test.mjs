import { expect, it } from "vitest";
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
