import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { seedZone } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { todayColumns, todaySet, OFF_FLOOR } from "./floor-today-columns.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
it("maps every today field and clears a placed table back off the floor", async () => {
  const zone = await seedZone(suite.db, { name: "Today" });
  await suite.db
    .insert(diningTables)
    .values({ id: "today-table", label: "Today 1", zoneId: zone.id });
  const values = {
    seats: 6,
    fixed: true,
    x: 10,
    y: 20,
    width: 3,
    height: 4,
    shape: "rect" as const,
    rotation: 90,
    takenOff: true,
    name: "Party",
  };
  await suite.db
    .update(diningTables)
    .set(todaySet(values))
    .where(eq(diningTables.id, "today-table"));
  expect(await suite.db.select(todayColumns).from(diningTables)).toEqual([
    { tableId: "today-table", ...values },
  ]);
  expect((await suite.db.select().from(diningTables))[0]!.onFloor).toBe(true);
  await suite.db.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, "today-table"));
  expect(await suite.db.select(todayColumns).from(diningTables)).toEqual([
    {
      tableId: "today-table",
      seats: null,
      fixed: false,
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
      takenOff: false,
      name: null,
    },
  ]);
  expect((await suite.db.select().from(diningTables))[0]!.onFloor).toBe(false);
});

it("copies today's values without changing either table's identity", async () => {
  const zone = await seedZone(suite.db, { name: "Copy" });
  await suite.db.insert(diningTables).values([
    { id: "first", label: "First", zoneId: zone.id, onFloor: true, todaySeats: 4 },
    { id: "second", label: "Second", zoneId: zone.id },
  ]);
  const [source] = await suite.db
    .select(todayColumns)
    .from(diningTables)
    .where(eq(diningTables.id, "first"));
  await suite.db.update(diningTables).set(todaySet(source!)).where(eq(diningTables.id, "second"));
  expect(
    await suite.db
      .select({ id: diningTables.id, seats: diningTables.todaySeats })
      .from(diningTables)
      .orderBy(diningTables.id),
  ).toEqual([
    { id: "first", seats: 4 },
    { id: "second", seats: 4 },
  ]);
});
