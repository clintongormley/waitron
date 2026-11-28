import {
  CORE_MIGRATIONS,
  kitchenStations,
  menuPeriods,
  type Transaction,
  withTransaction,
} from "@waitron/db";
import { seedActivityActor } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { readBusinessDayScheduleRevision } from "./business-day-schedule.js";
import { lastOrderDishes } from "./last-orders.js";
import { replaceMenuWeek, resolveDepartmentService, updateMenuPeriod } from "./menu-timetable.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import { resolveZoneContext } from "./operations.js";
import { routingAt, setRoutingCell } from "./routing-store.js";
import { closeStationForToday } from "./station-times.js";
import { setMenuFixture } from "./testing/set-menu-fixtures.js";
import { assertZoneTakesNewOrders, replaceZoneClosedWeek } from "./zone-closed-times.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const week = <T>(entry: T) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, ...entry }));

async function mealtimes(tx: Transaction) {
  const venue = await setMenuFixture(tx);
  await venue.place(venue.dinner);
  await venue.publish(venue.dinner);
  await venue.publish();
  const { departmentId } = await resolveZoneContext(tx, venue.zoneId);
  const periods = await tx
    .select()
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId));
  const lunch = periods.find(({ menuId }) => menuId === venue.lunch)!.id;
  const dinner = periods.find(({ menuId }) => menuId === venue.dinner)!.id;
  const [kitchen, bar] = await tx
    .insert(kitchenStations)
    .values([{ name: "Kitchen" }, { name: "Bar", isDefault: true }])
    .returning({ id: kitchenStations.id });
  const address = {
    row: { kind: "product" as const, productId: venue.sirloin },
    zoneId: venue.zoneId,
  };
  await setRoutingCell(tx, address, { kind: "station", stationId: bar!.id }, [
    { periodId: lunch, target: { kind: "station", stationId: kitchen!.id } },
  ]);
  return {
    ...venue,
    departmentId,
    address,
    lunch,
    dinner,
    kitchen: kitchen!.id,
    bar: bar!.id,
    async open(slots: MenuSlot[]) {
      await replaceMenuWeek(
        tx,
        departmentId,
        week({ slots }),
        venue.midday,
        await readBusinessDayScheduleRevision(tx),
      );
    },
    async decide(at: Date, stationId?: string) {
      const service = await resolveDepartmentService(tx, departmentId, at);
      const dish = { key: "sirloin", menuId: venue.lunch, productId: venue.sirloin, stationId };
      return (
        await lastOrderDishes(service.lastOrders, venue.zoneId, [dish], () => routingAt(tx, at))
      ).get("sirloin");
    },
  };
}

it("hands a dish to the contiguous period that offers it only in its set menu", async () =>
  withTransaction(suite.db, async (tx) => {
    const v = await mealtimes(tx);
    await updateMenuPeriod(tx, v.lunch, {
      lastOrders: [
        { kind: "station", stationId: v.kitchen, minutes: -15 },
        { kind: "station", stationId: v.bar, minutes: -30 },
      ],
    });
    await v.open([
      { periodId: v.lunch, startsAt: "12:00", endsAt: "15:00" },
      { periodId: v.dinner, startsAt: "15:00", endsAt: "18:00" },
    ]);
    for (const time of ["14:50", "15:00"]) {
      const at = new Date(`2026-10-05T${time}:00+02:00`);
      expect(await v.decide(at), time).toMatchObject({
        stopped: false,
        route: { kind: "station", stationId: v.bar },
      });
      expect(await v.decide(at, v.kitchen), time).toMatchObject({
        stopped: false,
        route: { kind: "station", stationId: v.kitchen },
      });
    }
  }));

it("checks another ended period that sold the same dish", async () =>
  withTransaction(suite.db, async (tx) => {
    const v = await mealtimes(tx);
    await updateMenuPeriod(tx, v.lunch, {
      lastOrders: [{ kind: "station", stationId: v.kitchen, minutes: -15 }],
    });
    await updateMenuPeriod(tx, v.dinner, {
      lastOrders: [{ kind: "station", stationId: v.bar, minutes: 60 }],
    });
    await v.open([
      { periodId: v.lunch, startsAt: "12:00", endsAt: "15:00" },
      { periodId: v.dinner, startsAt: "15:00", endsAt: "16:00" },
    ]);
    expect(await v.decide(new Date("2026-10-05T16:10:00+02:00"))).toMatchObject({
      stopped: false,
      route: { kind: "station", stationId: v.bar },
    });
  }));

it("an unconfigured stand-in keeps taking orders until the period ends", async () =>
  withTransaction(suite.db, async (tx) => {
    const v = await mealtimes(tx);
    await updateMenuPeriod(tx, v.lunch, {
      lastOrders: [{ kind: "station", stationId: v.kitchen, minutes: -15 }],
    });
    const at = new Date("2026-10-05T14:50:00+02:00");
    await closeStationForToday(tx, v.kitchen, v.bar, at, await seedActivityActor(tx));
    expect(await v.decide(at)).toMatchObject({
      stopped: false,
      route: { kind: "station", stationId: v.bar },
    });
    expect(await v.decide(new Date("2026-10-05T15:00:00+02:00"))).toMatchObject({
      stopped: true,
      route: { kind: "station", stationId: v.bar },
    });
  }));

it("uses last orders at a period ending at changeover while the zone is closed", async () =>
  withTransaction(suite.db, async (tx) => {
    const v = await mealtimes(tx);
    await v.open([{ periodId: v.lunch, startsAt: "20:00", endsAt: "06:00" }]);
    await updateMenuPeriod(tx, v.lunch, {
      lastOrders: [
        { kind: "station", stationId: v.kitchen, minutes: -15 },
        { kind: "station", stationId: v.bar, minutes: -15 },
      ],
    });
    await replaceZoneClosedWeek(
      tx,
      v.zoneId,
      week({ ranges: [{ startsAt: "05:30", endsAt: "06:00" }] }),
      await readBusinessDayScheduleRevision(tx),
    );
    const at = new Date("2026-10-06T05:45:00+02:00");
    await expect(assertZoneTakesNewOrders(tx, v.zoneId, at)).rejects.toMatchObject({
      code: "service_zone.closed",
    });
    expect(await v.decide(at)).toMatchObject({
      stopped: true,
      route: { kind: "station", stationId: v.kitchen },
    });
  }));

it("No preparation stops at its own cutoff", () =>
  withTransaction(suite.db, async (tx) => {
    const v = await mealtimes(tx);
    const route = { kind: "no_preparation" } as const;
    await setRoutingCell(tx, v.address, route, []);
    await updateMenuPeriod(tx, v.lunch, { lastOrders: [{ ...route, minutes: -15 }] });
    const at = new Date("2026-10-05T14:45:00+02:00");
    expect(await v.decide(at)).toMatchObject({ stopped: true, route });
  }));
