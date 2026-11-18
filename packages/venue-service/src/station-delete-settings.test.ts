import { randomUUID } from "node:crypto";
import { eq, inArray, and, isNotNull, sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { createProduct } from "@waitron/menu";
import {
  CORE_MIGRATIONS,
  menus,
  departments,
  deviceProfiles,
  devices,
  kitchenStations,
  menuPeriods,
  routingCellPeriods,
  routingCells,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDevice,
  seedDeviceProfiles,
  seedVenue,
  seedZone,
  seedActivityActor,
} from "@waitron/db/testing/seed.js";
import * as module from "./index.js";
import {
  readDeviceKitchenScreens,
  readProfileKitchenScreens,
  setProfileKitchenScreens,
} from "./kitchen-screens.js";
import { routingAt, routingModel, stationStates } from "./routing-store.js";
import {
  setStationToday,
  stationDestinations,
  openStationForToday,
  closeStationForToday,
} from "./station-times.js";
import { stationServiceTimes } from "./station-service-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const sorted = <T extends { id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.id.localeCompare(b.id));
const at = new Date("2026-10-10T12:00:00Z");
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);
async function fixture(tx: Transaction) {
  await seedVenue(tx, {
    name: randomUUID(),
    invoiceLocales: ["en-GB"],
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  });
  const cfg = {};
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Deleted" },
      { ...cfg, name: "Default", isDefault: true },
      { ...cfg, name: "Survivor" },
    ])
    .returning();
  const zone = await seedZone(tx, { name: "Zone" });
  return {
    cfg,
    gone: stations[0]!.id,
    home: stations[1]!.id,
    other: stations[2]!.id,
    zone: zone!.id,
  };
}
async function profile(tx: Transaction, name: string, formFactor: "kds" | "till" = "kds") {
  const [row] = await seedDeviceProfiles(tx, { name, formFactor });
  return row!.id;
}
async function device(tx: Transaction, profileId: string, label: string, active = true) {
  const { deviceId } = await seedDevice(tx, { profileId, label });
  if (!active) await tx.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
  return deviceId;
}

it("counts base and child routing rows once and clears only their union", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const [department] = await tx
      .insert(departments)
      .values({ ...f.cfg, name: "Dining", tradingName: "Dining" })
      .returning();
    const [menu] = await tx.insert(menus).values({ name: "Menu" }).returning();
    const periods = await tx
      .insert(menuPeriods)
      .values(
        ["Lunch", "Dinner"].map((name) => ({
          departmentId: department!.id,
          menuId: menu!.id,
          name,
        })),
      )
      .returning();
    const bases = await tx
      .insert(routingCells)
      .values([
        { ...f.cfg, zoneId: f.zone, stationId: f.gone },
        { ...f.cfg, noCategory: true, stationId: f.other },
        { ...f.cfg, noCategory: true, zoneId: f.zone, noPreparation: true },
      ])
      .returning();
    const children = await tx
      .insert(routingCellPeriods)
      .values([
        { cellId: bases[0]!.id, periodId: periods[0]!.id, stationId: f.gone },
        { cellId: bases[0]!.id, periodId: periods[1]!.id, stationId: f.other },
        { cellId: bases[1]!.id, periodId: periods[0]!.id, stationId: f.gone },
        { cellId: bases[1]!.id, periodId: periods[1]!.id, noPreparation: true },
        { cellId: bases[2]!.id, periodId: periods[0]!.id, stationId: f.other },
      ])
      .returning();
    expect(await tx.select().from(routingCells)).toEqual(bases);
    expect(
      sorted(
        await tx
          .select()
          .from(routingCellPeriods)
          .where(
            inArray(
              routingCellPeriods.cellId,
              bases.map((row) => row.id),
            ),
          ),
      ),
    ).toEqual(sorted([...children]));
    expect(await module.readStationDeleteSettings(tx, f.gone)).toEqual({
      removes: [
        { key: "station_routing_cells", count: 1, targets: [] },
        { key: "station_routing_periods", count: 3, targets: [] },
      ],
      boundScreens: [],
    });
    await module.clearStationDeleteSettings(tx, f.gone);
    expect(await tx.select().from(routingCells)).toEqual(bases.slice(1));
    expect(
      sorted(
        await tx
          .select()
          .from(routingCellPeriods)
          .where(
            inArray(
              routingCellPeriods.cellId,
              bases.map((row) => row.id),
            ),
          ),
      ),
    ).toEqual(sorted(children.slice(3)));
    expect(await module.readStationDeleteSettings(tx, f.gone)).toEqual({
      removes: [],
      boundScreens: [],
    });
  });
});

it("clears owned daily dates and incoming destinations without reopening their owners", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    await tx.insert(menus).values({ name: "Daily menu" }).returning();
    const product = await createProduct(tx, {
      name: "Daily product",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
    });
    await tx.insert(routingCells).values({ ...f.cfg, noCategory: true, stationId: f.other });
    await tx
      .update(kitchenStations)
      .set({ closedOnDay: "2026-10-10" })
      .where(eq(kitchenStations.id, f.gone));
    await tx
      .update(kitchenStations)
      .set({ closedOnDay: "2026-10-10", closedSendsToStationId: f.gone })
      .where(eq(kitchenStations.id, f.other));
    const rows = await tx
      .select({
        id: kitchenStations.id,
        stationId: kitchenStations.id,
        businessDay: kitchenStations.closedOnDay,
        open: sql<boolean>`0`.mapWith(Boolean),
        sendsToStationId: kitchenStations.closedSendsToStationId,
      })
      .from(kitchenStations)
      .where(
        and(isNotNull(kitchenStations.closedOnDay), inArray(kitchenStations.id, [f.gone, f.other])),
      );
    expect((await module.readStationDeleteSettings(tx, f.gone)).removes).toEqual([
      { key: "station_daily_states", count: 1, targets: [] },
      { key: "station_daily_destinations", count: 1, targets: [{ id: f.other, name: "Survivor" }] },
    ]);
    await module.clearStationDeleteSettings(tx, f.gone);
    expect(
      await tx
        .select({
          id: kitchenStations.id,
          stationId: kitchenStations.id,
          businessDay: kitchenStations.closedOnDay,
          open: sql<boolean>`0`.mapWith(Boolean),
          sendsToStationId: kitchenStations.closedSendsToStationId,
        })
        .from(kitchenStations)
        .where(
          and(
            isNotNull(kitchenStations.closedOnDay),
            inArray(kitchenStations.id, [f.gone, f.other]),
          ),
        ),
    ).toEqual(
      rows
        .filter((row) => row.stationId === f.other)
        .map((row) => ({ ...row, sendsToStationId: null })),
    );

    expect((await (await routingAt(tx, at)).makers(null, [product!.id])).get(product!.id)).toEqual({
      kind: "made",
      route: { kind: "station", stationId: f.home },
    });
    expect(
      (await routingModel(tx, at)).stationTimes.find((row) => row.stationId === f.other),
    ).toMatchObject({ status: { open: false, why: "closed_by_hand" }, closedSendsTo: f.home });
  });
});

it("A1510 lists and clears the stations that send their dishes to it when closed, and its own choice", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    await tx
      .update(kitchenStations)
      .set({ whenClosedSendsToStationId: f.gone })
      .where(eq(kitchenStations.id, f.other));
    await tx
      .update(kitchenStations)
      .set({ whenClosedSendsToStationId: f.home })
      .where(eq(kitchenStations.id, f.gone));
    expect((await module.readStationDeleteSettings(tx, f.gone)).removes).toEqual([
      { key: "station_closed_defaults", count: 1, targets: [{ id: f.other, name: "Survivor" }] },
    ]);
    await module.clearStationDeleteSettings(tx, f.gone);
    expect(
      sorted(
        await tx
          .select({ id: kitchenStations.id, to: kitchenStations.whenClosedSendsToStationId })
          .from(kitchenStations)
          .where(inArray(kitchenStations.id, [f.gone, f.other, f.home])),
      ),
    ).toEqual(sorted([f.gone, f.other, f.home].map((id) => ({ id, to: null }))));
  });
});

it("a deleted kitchen display does not block deleting a station", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Every");
    await setProfileKitchenScreens(tx, pid, {
      station: { stationIds: null, zoneIds: null },
    });
    const deleted = await device(tx, pid, "Deleted display", false);
    await device(tx, pid, "Off display", false);
    await tx
      .update(devices)
      .set({ deletedAt: at.toISOString(), tokenHash: "" })
      .where(eq(devices.id, deleted));
    expect((await module.readStationDeleteSettings(tx, f.gone)).boundScreens).toEqual([]);
  });
});

it("finds active displays bound by their profile and clears only that profile's station membership", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const bounded = await profile(tx, "Bound");
    const every = await profile(tx, "Every");
    await setProfileKitchenScreens(tx, bounded, {
      station: { stationIds: [f.gone, f.other], zoneIds: null },
    });
    await setProfileKitchenScreens(tx, every, { station: { stationIds: null, zoneIds: null } });
    const active = await device(tx, bounded, "Bound display");
    await device(tx, bounded, "Off", false);
    await device(tx, every, "Every");
    const impact = await module.readStationDeleteSettings(tx, f.gone);
    expect(impact.boundScreens).toEqual([{ id: active, name: "Bound display" }]);
    expect(impact.removes).toEqual([
      { key: "station_profile_screens", count: 1, targets: [{ id: bounded, name: "Bound" }] },
    ]);
    await module.clearStationDeleteSettings(tx, f.gone);
    expect((await readDeviceKitchenScreens(tx, active))[0]?.stations.map((row) => row.id)).toEqual([
      f.other,
    ]);
    expect(
      (await readProfileKitchenScreens(tx)).find((row) => row.profileId === every)?.screens,
    ).toEqual({ station: { stationIds: null, zoneIds: null } });
  });
});

it("retains an empty explicit profile parent and its unrelated zones for every device", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Till", "till");
    await setProfileKitchenScreens(tx, pid, { pass: { stationIds: [f.gone], zoneIds: [f.zone] } });
    const first = await device(tx, pid, "First");
    const second = await device(tx, pid, "Second");
    const stored = () =>
      tx
        .select({ views: deviceProfiles.kitchenViews })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, pid));
    const [before] = await stored();
    await module.clearStationDeleteSettings(tx, f.gone);
    expect(await stored()).toEqual([
      { views: { pass: { ...before!.views.pass!, stationIds: [] } } },
    ]);
    expect(
      (await readProfileKitchenScreens(tx)).find((row) => row.profileId === pid)?.screens,
    ).toEqual({
      pass: { stationIds: [], zoneIds: [f.zone], showNonPassStations: true },
    });
    for (const did of [first, second]) {
      const [screen] = await readDeviceKitchenScreens(tx, did);
      expect(screen!.stations).toEqual([]);
      expect(screen!.zones?.map((row) => row.id)).toEqual([f.zone]);
    }
  });
});

it("omits deleted stations from public routing and screen offerings while retaining fallback rules", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "History");
    const did = await device(tx, pid, "History");
    await setProfileKitchenScreens(tx, pid, {
      station: { stationIds: [f.gone, f.other], zoneIds: null },
    });
    await setStationToday(tx, f.gone, "closed", at, await seedActivityActor(tx), f.home);
    await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.gone));
    expect((await routingModel(tx, at)).stations.map((row) => row.id)).toEqual([f.home, f.other]);
    expect((await routingModel(tx, at)).stationTimes.map((row) => row.stationId)).toEqual([
      f.home,
      f.other,
    ]);
    expect([...(await stationStates(tx, at)).keys()]).toEqual([f.home, f.other]);
    expect((await readDeviceKitchenScreens(tx, did))[0]?.stations.map((row) => row.id)).toEqual([
      f.other,
    ]);
    expect((await (await routingAt(tx, at)).stations()).get(f.gone)).toMatchObject({
      active: false,
      byHand: "closed",
    });
  });
});

it.each(["set", "destinations", "open", "close", "service", "read settings", "clear settings"])(
  "refuses %s on a deleted station",
  async (kind) => {
    const f = await run(async (tx) => {
      const f = await fixture(tx);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.gone));
      return f;
    });
    const actions: Record<string, (tx: Transaction) => Promise<unknown>> = {
      set: async (tx) => setStationToday(tx, f.gone, null, at, await seedActivityActor(tx)),
      destinations: (tx) => stationDestinations(tx, f.gone, at),
      open: async (tx) => openStationForToday(tx, f.gone, at, await seedActivityActor(tx)),
      close: async (tx) =>
        closeStationForToday(tx, f.gone, f.home, at, await seedActivityActor(tx)),
      service: (tx) => stationServiceTimes(tx, f.gone, "2026-10-10", "2026-10-10"),
      "read settings": (tx) => module.readStationDeleteSettings(tx, f.gone),
      "clear settings": (tx) => module.clearStationDeleteSettings(tx, f.gone),
    };
    await expect(run(actions[kind]!)).rejects.toMatchObject({ code: "station.not_found" });
  },
);

it("dropping an emptied profile screen removes it instead of making a till unrestricted", async () => {
  const f = await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Emptied", "till");
    await setProfileKitchenScreens(tx, pid, {
      station: { stationIds: [f.gone], zoneIds: null },
    });
    await module.clearStationDeleteSettings(tx, f.gone);
    return { ...f, pid };
  });
  await expect(run((tx) => setProfileKitchenScreens(tx, f.pid, {}))).resolves.toBeUndefined();
  expect(
    (await run((tx) => readProfileKitchenScreens(tx))).find((row) => row.profileId === f.pid)
      ?.screens,
  ).toEqual({});
  await expect(
    run((tx) =>
      setProfileKitchenScreens(tx, f.pid, { station: { stationIds: [], zoneIds: null } }),
    ),
  ).rejects.toMatchObject({ code: "device_profile.access_invalid", params: { reason: "empty" } });
  await run((tx) =>
    setProfileKitchenScreens(tx, f.pid, {
      station: { stationIds: [f.other], zoneIds: null },
    }),
  );
  expect(
    (await run((tx) => readProfileKitchenScreens(tx))).find((row) => row.profileId === f.pid)
      ?.screens,
  ).toEqual({ station: { stationIds: [f.other], zoneIds: null } });
});

it("rejects a stale profile write retaining a deleted station, without widening its devices", async () => {
  const f = await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Stale");
    const did = await device(tx, pid, "Stale");
    await setProfileKitchenScreens(tx, pid, { station: { stationIds: [f.gone], zoneIds: null } });
    await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.gone));
    return { ...f, pid, did };
  });
  await expect(
    run((tx) =>
      setProfileKitchenScreens(tx, f.pid, { station: { stationIds: [f.gone], zoneIds: null } }),
    ),
  ).rejects.toMatchObject({
    code: "device_profile.access_invalid",
    params: { reason: "not_found" },
  });
  expect((await run((tx) => readDeviceKitchenScreens(tx, f.did)))[0]?.stations).toEqual([]);
});

it.each(["pass", "pass_monitor"] as const)(
  "finds explicit KDS %s profile bindings while excluding Every and ordering devices",
  async (kind) => {
    await run(async (tx) => {
      const f = await fixture(tx);
      const bounded = await profile(tx, "Bound pass");
      const every = await profile(tx, "Every pass");
      const till = await profile(tx, "Till pass", "till");
      for (const pid of [bounded, till])
        await setProfileKitchenScreens(tx, pid, {
          [kind]: { stationIds: [f.gone, f.other], zoneIds: null },
        });
      await setProfileKitchenScreens(tx, every, { [kind]: { stationIds: null, zoneIds: null } });
      const first = await device(tx, bounded, "A explicit");
      const second = await device(tx, bounded, "B bound");
      await device(tx, every, "Every");
      await device(tx, bounded, "Off", false);
      await device(tx, till, "Till explicit");
      expect((await module.readStationDeleteSettings(tx, f.gone)).boundScreens).toEqual([
        { id: first, name: "A explicit" },
        { id: second, name: "B bound" },
      ]);
    });
  },
);
