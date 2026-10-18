import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  joinedOutOfService,
  joinedTableApart,
  needsMoving,
  savedPart,
  stillJoinedPart,
} from "./joined-parts.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import {
  floorPlanPlacements,
  floorPlanSets,
  floorPlanTableParts,
  floorPlanTables,
  floorPlans,
  floorResetTableParts,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
} from "./schema/floor-plans.js";
import { floorZones } from "./schema/floor-zones.js";
import { parties, partyTables } from "./schema/parties.js";
import { locations } from "./schema/tenants.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";
const LONG = "cccccccc-0000-4000-8000-000000000001";
const COUNTER_3 = "cccccccc-0000-4000-8000-000000000003";
const COUNTER_4 = "cccccccc-0000-4000-8000-000000000004";
const COUNTER_5 = "cccccccc-0000-4000-8000-000000000005";
const PLAIN = "cccccccc-0000-4000-8000-000000000009";
const LONG_ROW = "dddddddd-0000-4000-8000-000000000001";
const COUNTER_3_ROW = "dddddddd-0000-4000-8000-000000000003";
const COUNTER_4_ROW = "dddddddd-0000-4000-8000-000000000004";
const COUNTER_5_ROW = "dddddddd-0000-4000-8000-000000000005";
const PLAIN_ROW = "dddddddd-0000-4000-8000-000000000009";
const WAITING_PART_ROW = "dddddddd-0000-4000-8000-000000000006";
const OPERATOR = "99999999-0000-4000-8000-000000000001";

type Db = ReturnType<typeof useVenueDb>["db"];

/** Long table joined from Counter 3, 4 and 5 in today's copy, beside a Plain table. */
async function seedJoinedToday(db: Db): Promise<void> {
  await seedTenant(db);
  await db.insert(locations).values({
    id: LOCATION,
    name: "Room",
    invoiceLocales: ["es"],
    operationDescription: "Hostelería",
  });
  await db.insert(floorZones).values({ id: ZONE, locationId: LOCATION, name: "Bar" });
  await db.insert(diningTables).values([
    { id: LONG, locationId: LOCATION, zoneId: ZONE, label: "Long table" },
    { id: COUNTER_3, locationId: LOCATION, zoneId: ZONE, label: "Counter 3" },
    { id: COUNTER_4, locationId: LOCATION, zoneId: ZONE, label: "Counter 4" },
    { id: COUNTER_5, locationId: LOCATION, zoneId: ZONE, label: "Counter 5" },
    { id: PLAIN, locationId: LOCATION, zoneId: ZONE, label: "Plain" },
  ]);
  await db.insert(floorResetTables).values([
    { id: LONG_ROW, zoneId: ZONE, tableId: LONG, label: "Long table", seats: 10 },
    { id: COUNTER_3_ROW, zoneId: ZONE, tableId: COUNTER_3, label: "Counter 3", seats: 2 },
    { id: COUNTER_4_ROW, zoneId: ZONE, tableId: COUNTER_4, label: "Counter 4", seats: 6 },
    { id: COUNTER_5_ROW, zoneId: ZONE, tableId: COUNTER_5, label: "Counter 5", seats: 4 },
    { id: PLAIN_ROW, zoneId: ZONE, tableId: PLAIN, label: "Plain", seats: 4 },
  ]);
  await db.insert(floorResetTableParts).values([
    { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_3_ROW },
    { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_4_ROW },
    { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_5_ROW },
  ]);
}

describe("still joined part", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedJoinedToday(suite.db);
  });

  async function read() {
    const rows = await suite.db.all<{ id: string; joined: number | null }>(
      sql`select dt.id, ${stillJoinedPart(sql`dt.id`)} as joined from dining_tables dt order by dt.id`,
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.joined]));
  }

  it("names each applied part of a joined table with a live table, and nothing else", async () => {
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [PLAIN]: 0,
    });
  });

  it("names no part whose reset row still waits to be applied", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ pending: true, placed: false })
      .where(eq(floorResetTables.id, COUNTER_3_ROW));
    expect((await read())[COUNTER_3]).toBe(0);
  });

  it("names a part whose reset row waits only for its name, already placed", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ pending: true, placed: true })
      .where(eq(floorResetTables.id, COUNTER_3_ROW));
    expect((await read())[COUNTER_3]).toBe(1);
  });

  it("reads a part reset row with no live table as naming nothing", async () => {
    await suite.db.insert(floorResetTables).values({
      id: WAITING_PART_ROW,
      zoneId: ZONE,
      tableId: null,
      label: "Counter 6",
      seats: 2,
    });
    await suite.db
      .insert(floorResetTableParts)
      .values({ joinedResetTableId: LONG_ROW, partResetTableId: WAITING_PART_ROW });
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [PLAIN]: 0,
    });
  });

  it("names no part while the joined table's reset row has no live table", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ tableId: null, pending: true })
      .where(eq(floorResetTables.id, LONG_ROW));
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 0,
      [COUNTER_4]: 0,
      [COUNTER_5]: 0,
      [PLAIN]: 0,
    });
  });

  it("names no part a party holds, and names it once the party has left it", async () => {
    const [party] = await suite.db
      .insert(parties)
      .values({ openedBy: OPERATOR })
      .returning({ id: parties.id });
    const [held] = await suite.db
      .insert(partyTables)
      .values({ partyId: party!.id, tableId: COUNTER_4 })
      .returning({ id: partyTables.id });
    expect((await read())[COUNTER_4]).toBe(0);
    expect((await read())[COUNTER_3]).toBe(1);

    await suite.db
      .update(partyTables)
      .set({ leftAt: "2026-10-12T12:00:00.000Z" })
      .where(eq(partyTables.id, held!.id));
    expect((await read())[COUNTER_4]).toBe(1);
  });

  it("names no part in one of today's merges, and names it once the merge has ended", async () => {
    const [join] = await suite.db
      .insert(floorTodayJoins)
      .values({ zoneId: ZONE, seats: 8 })
      .returning({ id: floorTodayJoins.id });
    await suite.db.insert(floorTodayJoinTables).values([
      { joinId: join!.id, tableId: COUNTER_5, beforeX: 0, beforeY: 0, beforeRotation: 0 },
      { joinId: join!.id, tableId: PLAIN, beforeX: 10, beforeY: 0, beforeRotation: 0 },
    ]);
    expect((await read())[COUNTER_5]).toBe(0);
    expect((await read())[COUNTER_3]).toBe(1);

    await suite.db.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, join!.id));
    expect((await read())[COUNTER_5]).toBe(1);
  });

  it("names no part split off today", async () => {
    await suite.db
      .insert(floorTodaySplitParts)
      .values({ joinedTableId: LONG, partTableId: COUNTER_4 });
    const joined = await read();
    expect(joined[COUNTER_4]).toBe(0);
    expect(joined[COUNTER_3]).toBe(1);
    expect(joined[COUNTER_5]).toBe(1);
  });
});

describe("joined table apart", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedJoinedToday(suite.db);
  });

  async function read(predicate: (tableId: SQL) => SQL) {
    const rows = await suite.db.all<{ id: string; named: number | null }>(
      sql`select dt.id, ${predicate(sql`dt.id`)} as named from dining_tables dt order by dt.id`,
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.named]));
  }

  async function splitOff(...partTableIds: string[]) {
    await suite.db
      .insert(floorTodaySplitParts)
      .values(partTableIds.map((partTableId) => ({ joinedTableId: LONG, partTableId })));
  }

  async function seatParty(...tableIds: string[]) {
    const [party] = await suite.db
      .insert(parties)
      .values({ openedBy: OPERATOR })
      .returning({ id: parties.id });
    await suite.db
      .insert(partyTables)
      .values(tableIds.map((tableId) => ({ partyId: party!.id, tableId })));
  }

  it("names no joined table while two or more of its parts are still joined", async () => {
    expect((await read(joinedTableApart))[LONG]).toBe(0);
    await splitOff(COUNTER_5);
    expect((await read(joinedTableApart))[LONG]).toBe(0);
  });

  it("names the joined table once fewer than two parts are still joined", async () => {
    await splitOff(COUNTER_4, COUNTER_5);
    expect(await read(joinedTableApart)).toEqual({
      [LONG]: 1,
      [COUNTER_3]: 0,
      [COUNTER_4]: 0,
      [COUNTER_5]: 0,
      [PLAIN]: 0,
    });
  });

  it("counts a part a party holds as not joined", async () => {
    await seatParty(COUNTER_3);
    await seatParty(COUNTER_4);
    expect((await read(joinedTableApart))[LONG]).toBe(1);
  });

  it("names no joined table a party holds, or one in today's merges", async () => {
    await splitOff(COUNTER_4, COUNTER_5);
    await seatParty(LONG);
    expect((await read(joinedTableApart))[LONG]).toBe(0);

    await suite.db.delete(partyTables);
    const [join] = await suite.db
      .insert(floorTodayJoins)
      .values({ zoneId: ZONE, seats: 14 })
      .returning({ id: floorTodayJoins.id });
    await suite.db.insert(floorTodayJoinTables).values([
      { joinId: join!.id, tableId: LONG, beforeX: 0, beforeY: 0, beforeRotation: 0 },
      { joinId: join!.id, tableId: PLAIN, beforeX: 10, beforeY: 0, beforeRotation: 0 },
    ]);
    expect((await read(joinedTableApart))[LONG]).toBe(0);
  });

  it("puts still-joined parts and a joined table come apart out of service, and nothing else", async () => {
    expect(await read(joinedOutOfService)).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [PLAIN]: 0,
    });
    await splitOff(COUNTER_4, COUNTER_5);
    expect(await read(joinedOutOfService)).toEqual({
      [LONG]: 1,
      [COUNTER_3]: 1,
      [COUNTER_4]: 0,
      [COUNTER_5]: 0,
      [PLAIN]: 0,
    });
  });
});

const PLAN = "eeeeeeee-0000-4000-8000-000000000001";
const LONG_MASTER = "ffffffff-0000-4000-8000-000000000001";
const COUNTER_3_MASTER = "ffffffff-0000-4000-8000-000000000003";
const COUNTER_4_MASTER = "ffffffff-0000-4000-8000-000000000004";
const COUNTER_5_MASTER = "ffffffff-0000-4000-8000-000000000005";
const NO_MASTER = "cccccccc-0000-4000-8000-000000000008";
const PLAN_SET = "cccccccc-0000-4000-8000-0000000000aa";

describe("saved part", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(floorZones).values({ id: ZONE, locationId: LOCATION, name: "Bar" });
    await suite.db.insert(floorPlanSets).values({ id: PLAN_SET, locationId: LOCATION });
    await suite.db
      .insert(floorPlans)
      .values({ id: PLAN, zoneId: ZONE, setId: PLAN_SET, savedAt: "2026-10-10T12:00:00.000Z" });
    await suite.db.insert(floorPlanTables).values([
      { id: LONG_MASTER, zoneId: ZONE, label: "Long table", seats: 10 },
      { id: COUNTER_3_MASTER, zoneId: ZONE, label: "Counter 3", seats: 2 },
      { id: COUNTER_4_MASTER, zoneId: ZONE, label: "Counter 4", seats: 6 },
      { id: COUNTER_5_MASTER, zoneId: ZONE, label: "Counter 5", seats: 4 },
    ]);
    await suite.db.insert(floorPlanTableParts).values([
      { joinedTableId: LONG_MASTER, partTableId: COUNTER_3_MASTER },
      { joinedTableId: LONG_MASTER, partTableId: COUNTER_4_MASTER },
      { joinedTableId: LONG_MASTER, partTableId: COUNTER_5_MASTER },
    ]);
    await suite.db.insert(diningTables).values([
      {
        id: LONG,
        locationId: LOCATION,
        zoneId: ZONE,
        label: "Long table",
        planTableId: LONG_MASTER,
      },
      {
        id: COUNTER_3,
        locationId: LOCATION,
        zoneId: ZONE,
        label: "Counter 3",
        planTableId: COUNTER_3_MASTER,
      },
      {
        id: COUNTER_4,
        locationId: LOCATION,
        zoneId: ZONE,
        label: "Counter 4",
        planTableId: COUNTER_4_MASTER,
      },
      {
        id: COUNTER_5,
        locationId: LOCATION,
        zoneId: ZONE,
        label: "Counter 5",
        planTableId: COUNTER_5_MASTER,
      },
      { id: NO_MASTER, locationId: LOCATION, zoneId: ZONE, label: "Loose" },
    ]);
  });

  it("names the live tables following a saved joined table's parts, and nothing else", async () => {
    const rows = await suite.db.all<{ id: string; part: number }>(
      sql`select dt.id, ${savedPart(sql`dt.id`, null)} as part from dining_tables dt`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.part]))).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [NO_MASTER]: 0,
    });
  });
});

const INSIDE = "bbbbbbbb-0000-4000-8000-000000000002";
const T4 = "cccccccc-0000-4000-8000-000000000044";
const T5 = "cccccccc-0000-4000-8000-000000000055";
const T45 = "cccccccc-0000-4000-8000-000000000045";
const M4 = "ffffffff-0000-4000-8000-000000000044";
const M5 = "ffffffff-0000-4000-8000-000000000055";
const M45 = "ffffffff-0000-4000-8000-000000000045";
const R4 = "dddddddd-0000-4000-8000-000000000044";
const R5 = "dddddddd-0000-4000-8000-000000000055";
const R45 = "dddddddd-0000-4000-8000-000000000045";
const STANDARD = "abababab-0000-4000-8000-000000000001";
const DINNER = "abababab-0000-4000-8000-000000000002";
const ALL_OFF = "abababab-0000-4000-8000-000000000003";
const TODAY = "2026-10-10";
const YESTERDAY = "2026-10-09";
const AT = { width: 8, height: 8, shape: "rect" as const, rotation: 0 };

describe("a layout that stands a joined table's tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  /**
   * Zone Inside with 4, 5 and 4+5 made of them. Standard places 4 and 5 and leaves 4+5 off,
   * Dinner places 4+5 and leaves 4 and 5 off, All off places none of the three.
   */
  beforeEach(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(floorZones).values({ id: INSIDE, locationId: LOCATION, name: "Inside" });
    await suite.db
      .insert(floorPlanSets)
      .values([STANDARD, DINNER, ALL_OFF].map((id) => ({ id, locationId: LOCATION })));
    const plan = (setId: string) => `9${setId.slice(1)}`;
    await suite.db.insert(floorPlans).values(
      [STANDARD, DINNER, ALL_OFF].map((setId) => ({
        id: plan(setId),
        zoneId: INSIDE,
        setId,
        savedAt: "2026-10-01T12:00:00.000Z",
      })),
    );
    await suite.db.insert(floorPlanTables).values([
      { id: M4, zoneId: INSIDE, label: "4", seats: 4 },
      { id: M5, zoneId: INSIDE, label: "5", seats: 4 },
      { id: M45, zoneId: INSIDE, label: "4+5", seats: 8 },
    ]);
    await suite.db.insert(floorPlanTableParts).values([
      { joinedTableId: M45, partTableId: M4 },
      { joinedTableId: M45, partTableId: M5 },
    ]);
    await suite.db.insert(floorPlanPlacements).values([
      { planId: plan(STANDARD), planTableId: M4, x: 0, y: 0, ...AT },
      { planId: plan(STANDARD), planTableId: M5, x: 20, y: 0, ...AT },
      { planId: plan(DINNER), planTableId: M45, x: 0, y: 0, ...AT },
    ]);
    await suite.db.insert(diningTables).values([
      { id: T4, locationId: LOCATION, zoneId: INSIDE, label: "4", planTableId: M4 },
      { id: T5, locationId: LOCATION, zoneId: INSIDE, label: "5", planTableId: M5 },
      { id: T45, locationId: LOCATION, zoneId: INSIDE, label: "4+5", planTableId: M45 },
    ]);
    await suite.db.insert(floorResetTables).values([
      { id: R4, zoneId: INSIDE, tableId: T4, label: "4", seats: 4, planTableId: M4 },
      { id: R5, zoneId: INSIDE, tableId: T5, label: "5", seats: 4, planTableId: M5 },
      { id: R45, zoneId: INSIDE, tableId: T45, label: "4+5", seats: 8, planTableId: M45 },
    ]);
    await suite.db.insert(floorResetTableParts).values([
      { joinedResetTableId: R45, partResetTableId: R4 },
      { joinedResetTableId: R45, partResetTableId: R5 },
    ]);
  });

  /** Today's rows as a reset onto `setId` leaves them, `drawn` on the map and the rest spares. */
  async function today(setId: string, drawn: string[], businessDay = TODAY): Promise<void> {
    await suite.db.insert(floorTodayZones).values({ zoneId: INSIDE, businessDay, setId });
    await suite.db
      .insert(floorTodayTables)
      .values(
        [T4, T5, T45].map((tableId, index) =>
          drawn.includes(tableId) ? { tableId, x: index * 20, y: 0, ...AT } : { tableId },
        ),
      );
  }

  async function read(predicate: (tableId: SQL) => SQL) {
    const rows = await suite.db.all<{ id: string; named: number | null }>(
      sql`select dt.id, ${predicate(sql`dt.id`)} as named from dining_tables dt order by dt.id`,
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.named]));
  }

  it("under Standard 4 and 5 are free and 4+5 has come apart", async () => {
    await today(STANDARD, [T4, T5]);
    expect(await read(stillJoinedPart)).toEqual({ [T4]: 0, [T5]: 0, [T45]: 0 });
    expect((await read(joinedTableApart))[T45]).toBe(1);
  });

  it("under Dinner 4 and 5 are still joined", async () => {
    await today(DINNER, [T45]);
    expect(await read(stillJoinedPart)).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
    expect((await read(joinedTableApart))[T45]).toBe(0);
  });

  it("a part whose row still waits is joined while its joined table is drawn", async () => {
    await today(DINNER, [T45]);
    await suite.db
      .update(floorResetTables)
      .set({ pending: true, placed: false })
      .where(eq(floorResetTables.id, R4));
    expect((await read(stillJoinedPart))[T4]).toBe(1);

    await suite.db
      .update(floorTodayTables)
      .set({ takenOff: true })
      .where(eq(floorTodayTables.tableId, T45));
    expect((await read(stillJoinedPart))[T4]).toBe(0);
  });

  it("with all three off, 4+5 is a spare and 4 and 5 are still joined", async () => {
    await today(ALL_OFF, []);
    expect(await read(stillJoinedPart)).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
    expect((await read(joinedTableApart))[T45]).toBe(0);
  });

  it("a part split off today does not count as standing", async () => {
    await today(DINNER, [T45, T4]);
    await suite.db.insert(floorTodaySplitParts).values({ joinedTableId: T45, partTableId: T4 });
    expect((await read(stillJoinedPart))[T5]).toBe(1);
  });

  it("a part split off today and drawn leaves the others joined while their joined table is off the map", async () => {
    await today(ALL_OFF, [T4]);
    expect((await read(stillJoinedPart))[T5]).toBe(0);

    await suite.db.insert(floorTodaySplitParts).values({ joinedTableId: T45, partTableId: T4 });
    expect((await read(stillJoinedPart))[T5]).toBe(1);
  });

  it("under Standard, 4 and 5 taken off for today are still joined until one is put back", async () => {
    await today(STANDARD, [T4, T5]);
    await suite.db
      .update(floorTodayTables)
      .set({ takenOff: true })
      .where(inArray(floorTodayTables.tableId, [T4, T5]));
    expect(await read(stillJoinedPart)).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
    expect((await read(joinedTableApart))[T45]).toBe(0);

    await suite.db
      .update(floorTodayTables)
      .set({ takenOff: false })
      .where(eq(floorTodayTables.tableId, T4));
    expect(await read(stillJoinedPart)).toEqual({ [T4]: 0, [T5]: 0, [T45]: 0 });
    expect((await read(joinedTableApart))[T45]).toBe(1);
  });

  const savedOn = (day: string | null) => (tableId: SQL) => savedPart(tableId, day);

  it("counts 4 a saved part by the layout recorded for the day asked about", async () => {
    await today(STANDARD, [T4, T5]);
    expect((await read(savedOn(TODAY)))[T4]).toBe(0);
    expect((await read(savedOn(YESTERDAY)))[T4]).toBe(1);
    expect((await read(savedOn(null)))[T4]).toBe(1);

    await suite.db
      .update(floorTodayZones)
      .set({ setId: DINNER })
      .where(eq(floorTodayZones.zoneId, INSIDE));
    expect((await read(savedOn(TODAY)))[T4]).toBe(1);

    await suite.db
      .update(floorTodayZones)
      .set({ setId: null })
      .where(eq(floorTodayZones.zoneId, INSIDE));
    expect(await read(savedOn(TODAY))).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
  });

  it("counts 4 a saved part, and 4+5 not, under Standard recorded for yesterday", async () => {
    await today(STANDARD, [T4, T5], YESTERDAY);
    expect(await read(savedOn(TODAY))).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
  });

  it("counts 4+5 a saved part when the recorded layout stands its tables and leaves it off", async () => {
    await today(STANDARD, [T4, T5]);
    expect(await read(savedOn(TODAY))).toEqual({ [T4]: 0, [T5]: 0, [T45]: 1 });

    await suite.db
      .update(floorTodayZones)
      .set({ setId: DINNER })
      .where(eq(floorTodayZones.zoneId, INSIDE));
    expect(await read(savedOn(TODAY))).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });

    await suite.db
      .update(floorTodayZones)
      .set({ setId: ALL_OFF })
      .where(eq(floorTodayZones.zoneId, INSIDE));
    expect(await read(savedOn(TODAY))).toEqual({ [T4]: 1, [T5]: 1, [T45]: 0 });
  });
});

describe("needs moving", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const place = { x: 10, y: 10, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

  beforeEach(async () => {
    await seedJoinedToday(suite.db);
    await suite.db
      .update(floorResetTables)
      .set({ ...place, pending: true, readyToMove: true })
      .where(eq(floorResetTables.id, PLAIN_ROW));
    await suite.db.insert(floorTodayTables).values({ tableId: PLAIN, seats: 4, ...place });
  });

  async function plain(): Promise<number | null> {
    const rows = await suite.db.all<{ moving: number | null }>(
      sql`select ${needsMoving(sql`dt.id`)} as moving from dining_tables dt where dt.id = ${PLAIN}`,
    );
    return rows[0]!.moving;
  }

  const target = (values: Partial<typeof floorResetTables.$inferInsert>) =>
    suite.db.update(floorResetTables).set(values).where(eq(floorResetTables.id, PLAIN_ROW));
  const today = (values: Partial<typeof floorTodayTables.$inferInsert>) =>
    suite.db.update(floorTodayTables).set(values).where(eq(floorTodayTables.tableId, PLAIN));

  it("is false for a marked table standing exactly at its row's place", async () => {
    expect(await plain()).toBe(0);
  });

  it.each([
    ["x", { x: 11 }],
    ["y", { y: 11 }],
    ["width", { width: 9 }],
    ["height", { height: 9 }],
    ["shape", { shape: "round" as const }],
    ["rotation", { rotation: 15 }],
    ["into store", { x: null, y: null, width: null, height: null, shape: null, rotation: null }],
  ])("is true when the row's %s differs", async (_, values) => {
    await target(values);
    expect(await plain()).toBe(1);
  });

  it("is true in a merge and split off", async () => {
    const [join] = await suite.db
      .insert(floorTodayJoins)
      .values({ zoneId: ZONE, seats: 8 })
      .returning({ id: floorTodayJoins.id });
    await suite.db
      .insert(floorTodayJoinTables)
      .values({ joinId: join!.id, tableId: PLAIN, beforeX: 0, beforeY: 0, beforeRotation: 0 });
    expect(await plain()).toBe(1);
    await suite.db.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.tableId, PLAIN));
    expect(await plain()).toBe(0);
    await suite.db.insert(floorTodaySplitParts).values({ joinedTableId: LONG, partTableId: PLAIN });
    expect(await plain()).toBe(1);
  });

  it("is false when the row is not marked, the table is taken off, or not drawn", async () => {
    await target({ x: 11 });
    expect(await plain()).toBe(1);
    await target({ readyToMove: false });
    expect(await plain()).toBe(0);
    await target({ readyToMove: true });
    await today({ takenOff: true });
    expect(await plain()).toBe(0);
    await today({
      takenOff: false,
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
    expect(await plain()).toBe(0);
  });
});
