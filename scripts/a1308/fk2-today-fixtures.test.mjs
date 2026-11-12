import { expect, it } from "vitest";
import { foldInserts } from "./lib/fold-inserts.mjs";
import { rules } from "./fk2-today-fixtures.mjs";

it.each([
  [
    "zone",
    "db.insert(zoneExtensions).values({ id: I, zoneId: Z, businessDay: DAY, startsAt: FROM, endsAt: UNTIL });",
    "db.update(floorZones).set({ keptOpenDay: DAY, keptOpenFrom: FROM, keptOpenUntil: UNTIL }).where(eq(floorZones.id, Z));",
  ],
  [
    "station",
    "db.insert(stationDayStates).values({ stationId: S, businessDay: DAY, open: false, sendsToStationId: D });",
    "db.update(kitchenStations).set({ closedOnDay: DAY, closedSendsToStationId: D }).where(eq(kitchenStations.id, S));",
  ],
])("fk2 folds %s and is idempotent", (_name, input, output) => {
  const imports =
    'import { eq } from "drizzle-orm";\nimport { floorZones, kitchenStations } from "@waitron/db";\n';
  const result = foldInserts(imports + input, "sample.test.ts", rules);
  expect(result).toEqual({ text: imports + output, reports: [] });
  expect(foldInserts(result.text, "sample.test.ts", rules)).toEqual(result);
});
