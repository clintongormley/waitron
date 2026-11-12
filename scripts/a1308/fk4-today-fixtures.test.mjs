import { expect, it } from "vitest";
import { foldInserts } from "./lib/fold-inserts.mjs";
import { rules } from "./fk4-today-fixtures.mjs";

it.each([
  [
    "table",
    "db.insert(floorTodayTables).values({ id: I, tableId: T, seats: 4, x: null, takenOff: false });",
    "db.update(diningTables).set({ todaySeats: 4, todayX: null, takenOff: false, onFloor: true }).where(eq(diningTables.id, T));",
  ],
  [
    "zone",
    "db.insert(floorTodayZones).values({ zoneId: Z, businessDay: DAY, revision: 3, setId: S, layoutRevision: 2, occurrence: O });",
    "db.update(floorZones).set({ todayBusinessDay: DAY, todayRevision: 3, todaySetId: S, todayLayoutRevision: 2, todayOccurrence: O }).where(eq(floorZones.id, Z));",
  ],
])("fk4 folds %s and is idempotent", (_name, input, output) => {
  const imports =
    'import { eq } from "drizzle-orm";\nimport { diningTables, floorZones } from "@waitron/db";\n';
  const result = foldInserts(imports + input, "sample.test.ts", rules);
  expect(result).toEqual({ text: imports + output, reports: [] });
  expect(foldInserts(result.text, "sample.test.ts", rules)).toEqual(result);
});
