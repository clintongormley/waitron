import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  activityLog,
  kitchenStations,
  persons,
  withTransaction,
  withFoldedPersonKeys,
} from "@waitron/db";
import { seedDevice, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createMenu } from "@waitron/menu";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { setStationToday } from "./station-times.js";
import { routingModel } from "./routing-store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const at = new Date("2026-11-12T22:00:00Z");
async function fixture() {
  return withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, { timeZone: "Europe/Madrid", dayCutover: "06:00:00" });
    await tx.insert(persons).values(
      withFoldedPersonKeys([
        { id: "staff", displayName: "Staff" },
        { id: "manager", displayName: "Manager" },
      ]),
    );
    const { deviceId } = await seedDevice(tx);
    const actor = { personId: "staff", deviceId, authorizedBy: "manager" };
    const zone = await seedZone(tx, { name: "Terrace" });
    const menu = await createMenu(tx, { name: "Dinner" });
    const period = await saveMenuPeriod(tx, zone.departmentId, {
      name: "Dinner",
      menuId: menu.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      zone.departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: period.id, startsAt: "21:00", endsAt: "03:00" }],
      })),
      at,
      1,
    );
    await tx.insert(kitchenStations).values([
      { id: "grill", name: "Grill" },
      { id: "bar", name: "Bar", isDefault: true },
    ]);
    return actor;
  });
}
const history = () =>
  suite.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.personId, "staff"))
    .orderBy(activityLog.at, sql`${activityLog}.rowid`);

describe("today's choices history", () => {
  it("records closure and reopening with the former destination", async () => {
    const actor = await fixture();
    await withTransaction(suite.db, (tx) =>
      setStationToday(tx, "grill", "closed", at, actor, "bar"),
    );
    expect(
      (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, "grill")))[0],
    ).toMatchObject({ closedOnDay: "2026-11-12", closedSendsToStationId: "bar" });
    await suite.db.insert(kitchenStations).values({ id: "fry", name: "Fry" });
    await withTransaction(suite.db, (tx) =>
      setStationToday(tx, "grill", "closed", at, actor, "fry"),
    );
    await withTransaction(suite.db, (tx) => setStationToday(tx, "grill", null, at, actor));
    expect(
      (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, "grill")))[0],
    ).toMatchObject({ closedOnDay: null, closedSendsToStationId: null });
    expect(await history()).toEqual([
      expect.objectContaining({
        kind: "station.closed_for_day",
        subjectKind: "station",
        subjectId: "grill",
        personId: "staff",
        deviceId: actor.deviceId,
        at,
        data: { businessDay: "2026-11-12", sendsTo: "bar", authorizedBy: "manager" },
      }),
      expect.objectContaining({
        kind: "station.closed_for_day",
        data: { businessDay: "2026-11-12", sendsTo: "fry", authorizedBy: "manager" },
      }),
      expect.objectContaining({
        kind: "station.reopened",
        data: { businessDay: "2026-11-12", sendsTo: "fry", authorizedBy: "manager" },
      }),
    ]);
  });
  it("adds no history when the current choice does not change", async () => {
    const actor = await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(kitchenStations)
        .set({ closedOnDay: "2026-11-11", closedSendsToStationId: "bar" })
        .where(eq(kitchenStations.id, "grill"));
      await setStationToday(tx, "grill", null, at, actor);
    });
    expect(await history()).toEqual([]);
    await withTransaction(suite.db, async (tx) => {
      await setStationToday(tx, "grill", "closed", at, actor, "bar");
      await setStationToday(tx, "grill", "closed", at, actor, "bar");
    });
    expect((await history()).map((row) => row.kind)).toEqual(["station.closed_for_day"]);
  });
  it.each([
    ["2026-11-11", true],
    ["2026-11-12", false],
  ])("reads station choices stamped %s only on their business day", async (day, open) => {
    await fixture();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(kitchenStations)
        .set({ closedOnDay: day, closedSendsToStationId: "bar" })
        .where(eq(kitchenStations.id, "grill"));
      expect(
        (await routingModel(tx, at)).stationTimes.find((row) => row.stationId === "grill")?.status,
      ).toMatchObject({ open });
    });
  });
});
