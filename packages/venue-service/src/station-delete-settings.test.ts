import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createProduct } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import * as module from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { stationDayStates } from "./schema/station-times.js";
import { menuPeriods } from "./schema/menus.js";
import { departments } from "./schema/service.js";
import {
  deviceKitchenScreenRemovals,
  deviceKitchenScreenStations,
  deviceKitchenScreenZones,
  deviceKitchenScreens,
  deviceProfileKitchenScreens,
} from "./schema/kitchen-screens.js";
import {
  readDeviceKitchenScreens,
  readProfileKitchenScreens,
  setDeviceKitchenScreens,
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
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
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
  const [venue] = await tx
    .insert(locations)
    .values({
      name: randomUUID(),
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(venue!.id) };
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Deleted" },
      { ...cfg, name: "Default", isDefault: true },
      { ...cfg, name: "Survivor" },
    ])
    .returning();
  const [zone] = await tx
    .insert(floorZones)
    .values({ ...cfg, name: "Zone" })
    .returning();
  return {
    cfg,
    gone: stations[0]!.id,
    home: stations[1]!.id,
    other: stations[2]!.id,
    zone: zone!.id,
  };
}
async function profile(tx: Transaction, name: string, formFactor: "kds" | "till" = "kds") {
  const [row] = await tx.insert(deviceProfiles).values({ name, formFactor }).returning();
  return row!.id;
}
async function device(
  tx: Transaction,
  f: Awaited<ReturnType<typeof fixture>>,
  profileId: string,
  label: string,
  active = true,
) {
  const [row] = await tx
    .insert(devices)
    .values({ ...f.cfg, deviceProfileId: profileId, label, active, tokenHash: "hash" })
    .returning();
  return row!.id;
}

it("counts base and child routing rows once and clears only their union", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const [department] = await tx
      .insert(departments)
      .values({ ...f.cfg, name: "Dining", tradingName: "Dining" })
      .returning();
    const [menu] = await tx.insert(catalogues).values({ name: "Menu" }).returning();
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
        {
          cellId: bases[0]!.id,
          periodId: periods[0]!.id,
          departmentId: department!.id,
          stationId: f.gone,
        },
        {
          cellId: bases[0]!.id,
          periodId: periods[1]!.id,
          departmentId: department!.id,
          stationId: f.other,
        },
        {
          cellId: bases[1]!.id,
          periodId: periods[0]!.id,
          departmentId: department!.id,
          stationId: f.gone,
        },
        {
          cellId: bases[1]!.id,
          periodId: periods[1]!.id,
          departmentId: department!.id,
          noPreparation: true,
        },
        {
          cellId: bases[2]!.id,
          periodId: periods[0]!.id,
          departmentId: department!.id,
          stationId: f.other,
        },
      ])
      .returning();
    expect(
      await tx.select().from(routingCells).where(eq(routingCells.locationId, f.cfg.locationId)),
    ).toEqual(bases);
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
    expect(await module.readStationDeleteSettings(tx, f.cfg, f.gone)).toEqual({
      removes: [
        { key: "station_routing_cells", count: 1, targets: [] },
        { key: "station_routing_periods", count: 3, targets: [] },
      ],
      boundScreens: [],
    });
    await module.clearStationDeleteSettings(tx, f.cfg, f.gone);
    expect(
      await tx.select().from(routingCells).where(eq(routingCells.locationId, f.cfg.locationId)),
    ).toEqual(bases.slice(1));
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
    expect(await module.readStationDeleteSettings(tx, f.cfg, f.gone)).toEqual({
      removes: [],
      boundScreens: [],
    });
  });
});

it("clears owned daily dates and incoming destinations without reopening their owners", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const [menu] = await tx.insert(catalogues).values({ name: "Daily menu" }).returning();
    const product = await createProduct(tx, {
      catalogueId: menu!.id,
      name: "Daily product",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
    });
    await tx.insert(routingCells).values({ ...f.cfg, noCategory: true, stationId: f.other });
    const rows = await tx
      .insert(stationDayStates)
      .values([
        { stationId: f.gone, businessDay: "2026-10-09", open: false },
        { stationId: f.gone, businessDay: "2026-10-10", open: false },
        { stationId: f.other, businessDay: "2026-10-09", open: false, sendsToStationId: f.gone },
        { stationId: f.other, businessDay: "2026-10-10", open: false, sendsToStationId: f.gone },
      ])
      .returning();
    expect((await module.readStationDeleteSettings(tx, f.cfg, f.gone)).removes).toEqual([
      { key: "station_daily_states", count: 2, targets: [] },
      { key: "station_daily_destinations", count: 1, targets: [{ id: f.other, name: "Survivor" }] },
    ]);
    await module.clearStationDeleteSettings(tx, f.cfg, f.gone);
    expect(
      await tx
        .select()
        .from(stationDayStates)
        .where(inArray(stationDayStates.stationId, [f.gone, f.other])),
    ).toEqual(rows.slice(2).map((row) => ({ ...row, sendsToStationId: null })));

    expect(
      (await (await routingAt(tx, f.cfg, at)).makers(null, [product!.id])).get(product!.id),
    ).toEqual({ kind: "made", route: { kind: "station", stationId: f.home } });
    expect(
      (await routingModel(tx, f.cfg, at)).stationTimes.find((row) => row.stationId === f.other),
    ).toMatchObject({ status: { open: false, why: "closed_by_hand" }, closedSendsTo: f.home });
  });
});

it("finds explicitly bound KDS choices including switched-off devices and deduplicates affected settings owners", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const bounded = await profile(tx, "Bound");
    const every = await profile(tx, "Every");
    await setProfileKitchenScreens(tx, f.cfg, bounded, {
      station: { stationIds: [f.gone, f.other], zoneIds: null },
    });
    await setProfileKitchenScreens(tx, f.cfg, every, {
      station: { stationIds: null, zoneIds: null },
    });
    const explicit = await device(tx, f, every, "Á explicit");
    const boundEvery = await device(tx, f, bounded, "B bound");
    const bothEvery = await device(tx, f, every, "Every");
    const off = await device(tx, f, every, "Off", false);
    const removed = await device(tx, f, every, "Removed");
    const kindRemoved = await device(tx, f, every, "Kind removed");
    for (const id of [explicit, off, removed, kindRemoved])
      await setDeviceKitchenScreens(tx, f.cfg, {
        deviceId: id,
        profileId: every,
        screens: [{ kind: "station", stationIds: [f.gone, f.other], zoneIds: null }],
      });
    for (const [id, pid] of [
      [boundEvery, bounded],
      [bothEvery, every],
    ])
      await setDeviceKitchenScreens(tx, f.cfg, {
        deviceId: id!,
        profileId: pid!,
        screens: [{ kind: "station", stationIds: null, zoneIds: null }],
      });
    await tx.insert(deviceKitchenScreenRemovals).values([
      { deviceId: removed, screen: "station", stationId: f.gone },
      { deviceId: kindRemoved, screen: "station" },
    ]);
    const noticeOnly = await device(tx, f, every, "Notice only");
    await tx
      .insert(deviceKitchenScreenRemovals)
      .values({ deviceId: noticeOnly, screen: "pass", stationId: f.gone });
    const impact = await module.readStationDeleteSettings(tx, f.cfg, f.gone);
    expect(impact.boundScreens).toEqual([
      { id: explicit, name: "Á explicit" },
      { id: boundEvery, name: "B bound" },
      { id: off, name: "Off" },
    ]);
    expect(impact.removes).toEqual([
      {
        key: "station_device_screens",
        count: 5,
        targets: [
          { id: explicit, name: "Á explicit" },
          { id: kindRemoved, name: "Kind removed" },
          { id: noticeOnly, name: "Notice only" },
          { id: off, name: "Off" },
          { id: removed, name: "Removed" },
        ],
      },
      { key: "station_profile_screens", count: 1, targets: [{ id: bounded, name: "Bound" }] },
    ]);
    await module.clearStationDeleteSettings(tx, f.cfg, f.gone);
    expect(
      await tx
        .select()
        .from(deviceKitchenScreenStations)
        .where(
          inArray(deviceKitchenScreenStations.deviceId, [explicit, off, removed, kindRemoved]),
        ),
    ).toEqual(
      [explicit, off, removed, kindRemoved]
        .sort()
        .map((deviceId) => ({ deviceId, screen: "station", stationId: f.other })),
    );
    expect(
      await tx
        .select()
        .from(deviceKitchenScreenRemovals)
        .where(eq(deviceKitchenScreenRemovals.deviceId, kindRemoved)),
    ).toHaveLength(1);
    expect(
      await tx
        .select()
        .from(deviceKitchenScreenRemovals)
        .where(inArray(deviceKitchenScreenRemovals.deviceId, [removed, noticeOnly])),
    ).toEqual([]);
  });
});

it("retains empty explicit device and profile parents and all unrelated zones", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Till", "till");
    await setProfileKitchenScreens(tx, f.cfg, pid, {
      pass: { stationIds: [f.gone], zoneIds: [f.zone] },
      station: { stationIds: [f.other], zoneIds: null },
    });
    const explicit = await device(tx, f, pid, "Explicit");
    const every = await device(tx, f, pid, "Every");
    await setDeviceKitchenScreens(tx, f.cfg, {
      deviceId: explicit,
      profileId: pid,
      screens: [{ kind: "pass", stationIds: [f.gone], zoneIds: [f.zone] }],
    });
    await setDeviceKitchenScreens(tx, f.cfg, {
      deviceId: every,
      profileId: pid,
      screens: [{ kind: "pass", stationIds: null, zoneIds: null }],
    });
    const parents = await tx
      .select()
      .from(deviceKitchenScreens)
      .where(inArray(deviceKitchenScreens.deviceId, [explicit, every]));
    const profileParents = await tx
      .select()
      .from(deviceProfileKitchenScreens)
      .where(eq(deviceProfileKitchenScreens.deviceProfileId, pid));
    const zones = await tx
      .select()
      .from(deviceKitchenScreenZones)
      .where(eq(deviceKitchenScreenZones.deviceId, explicit));
    await module.clearStationDeleteSettings(tx, f.cfg, f.gone);
    expect(
      await tx
        .select()
        .from(deviceKitchenScreens)
        .where(inArray(deviceKitchenScreens.deviceId, [explicit, every])),
    ).toEqual(parents);
    expect(
      await tx
        .select()
        .from(deviceProfileKitchenScreens)
        .where(eq(deviceProfileKitchenScreens.deviceProfileId, pid)),
    ).toEqual(profileParents);
    expect(
      await tx
        .select()
        .from(deviceKitchenScreenZones)
        .where(eq(deviceKitchenScreenZones.deviceId, explicit)),
    ).toEqual(zones);
    expect(
      (await readProfileKitchenScreens(tx, f.cfg)).find((row) => row.profileId === pid)?.screens,
    ).toEqual({
      pass: { stationIds: [], zoneIds: [f.zone] },
      station: { stationIds: [f.other], zoneIds: null },
    });
    expect(await readDeviceKitchenScreens(tx, f.cfg, explicit)).toEqual([]);
    expect((await readDeviceKitchenScreens(tx, f.cfg, every))[0]?.stations).toEqual([]);
  });
});

it("omits deleted stations from public routing and screen offerings while retaining fallback rules", async () => {
  await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "History");
    const did = await device(tx, f, pid, "History");
    await setProfileKitchenScreens(tx, f.cfg, pid, {
      station: { stationIds: [f.gone, f.other], zoneIds: null },
    });
    await setDeviceKitchenScreens(tx, f.cfg, {
      deviceId: did,
      profileId: pid,
      screens: [{ kind: "station", stationIds: [f.gone, f.other], zoneIds: null }],
    });
    await setStationToday(tx, f.cfg, f.gone, "closed", at, f.home);
    await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.gone));
    expect((await routingModel(tx, f.cfg, at)).stations.map((row) => row.id)).toEqual([
      f.home,
      f.other,
    ]);
    expect((await routingModel(tx, f.cfg, at)).stationTimes.map((row) => row.stationId)).toEqual([
      f.home,
      f.other,
    ]);
    expect([...(await stationStates(tx, f.cfg, at)).keys()]).toEqual([f.home, f.other]);
    expect(
      (await readDeviceKitchenScreens(tx, f.cfg, did))[0]?.stations.map((row) => row.id),
    ).toEqual([f.other]);
    expect((await (await routingAt(tx, f.cfg, at)).stations()).get(f.gone)).toMatchObject({
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
      set: (tx) => setStationToday(tx, f.cfg, f.gone, null, at),
      destinations: (tx) => stationDestinations(tx, f.cfg, f.gone, at),
      open: (tx) => openStationForToday(tx, f.cfg, f.gone, at),
      close: (tx) => closeStationForToday(tx, f.cfg, f.gone, f.home, at),
      service: (tx) => stationServiceTimes(tx, f.cfg, f.gone, "2026-10-10", "2026-10-10"),
      "read settings": (tx) => module.readStationDeleteSettings(tx, f.cfg, f.gone),
      "clear settings": (tx) => module.clearStationDeleteSettings(tx, f.cfg, f.gone),
    };
    await expect(run(actions[kind]!)).rejects.toMatchObject({ code: "station.not_found" });
  },
);

it("refuses dropping an emptied profile bound instead of making a till unrestricted", async () => {
  const f = await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Emptied", "till");
    await setProfileKitchenScreens(tx, f.cfg, pid, {
      station: { stationIds: [f.gone], zoneIds: null },
    });
    await module.clearStationDeleteSettings(tx, f.cfg, f.gone);
    return { ...f, pid };
  });
  await expect(run((tx) => setProfileKitchenScreens(tx, f.cfg, f.pid, {}))).rejects.toMatchObject({
    code: "device_profile.access_invalid",
    params: { field: "stationScreenStations", reason: "empty" },
  });
  await expect(
    run((tx) =>
      setProfileKitchenScreens(tx, f.cfg, f.pid, { station: { stationIds: [], zoneIds: null } }),
    ),
  ).rejects.toMatchObject({ code: "device_profile.access_invalid", params: { reason: "empty" } });
  await run((tx) =>
    setProfileKitchenScreens(tx, f.cfg, f.pid, {
      station: { stationIds: [f.other], zoneIds: null },
    }),
  );
  expect(
    (await run((tx) => readProfileKitchenScreens(tx, f.cfg))).find((row) => row.profileId === f.pid)
      ?.screens,
  ).toEqual({ station: { stationIds: [f.other], zoneIds: null } });
});

it("rejects stale profile and device writes retaining a deleted station", async () => {
  const f = await run(async (tx) => {
    const f = await fixture(tx);
    const pid = await profile(tx, "Stale");
    const did = await device(tx, f, pid, "Stale");
    await setProfileKitchenScreens(tx, f.cfg, pid, {
      station: { stationIds: [f.gone], zoneIds: null },
    });
    await setDeviceKitchenScreens(tx, f.cfg, {
      deviceId: did,
      profileId: pid,
      screens: [{ kind: "station", stationIds: [f.gone], zoneIds: null }],
    });
    await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.gone));
    return { ...f, pid, did };
  });
  await expect(
    run((tx) =>
      setProfileKitchenScreens(tx, f.cfg, f.pid, {
        station: { stationIds: [f.gone], zoneIds: null },
      }),
    ),
  ).rejects.toMatchObject({
    code: "device_profile.access_invalid",
    params: { reason: "not_found" },
  });
  await expect(
    run((tx) =>
      setDeviceKitchenScreens(tx, f.cfg, {
        deviceId: f.did,
        profileId: f.pid,
        screens: [{ kind: "station", stationIds: [f.gone], zoneIds: null }],
      }),
    ),
  ).rejects.toMatchObject({ code: "kitchen_screen.invalid", params: { reason: "not_found" } });
});

it.each(["read", "clear"])("refuses %s settings for another location", async (kind) => {
  const f = await run(async (tx) => ({ here: await fixture(tx), other: await fixture(tx) }));
  await expect(
    run<unknown>((tx) =>
      kind === "read"
        ? module.readStationDeleteSettings(tx, f.here.cfg, f.other.gone)
        : module.clearStationDeleteSettings(tx, f.here.cfg, f.other.gone),
    ),
  ).rejects.toMatchObject({ code: "station.not_found" });
});

it.each(["pass", "pass_monitor"] as const)(
  "finds explicit KDS %s bindings while excluding Every and removed choices",
  async (kind) => {
    await run(async (tx) => {
      const f = await fixture(tx);
      const bounded = await profile(tx, "Bound pass");
      const every = await profile(tx, "Every pass");
      const till = await profile(tx, "Till pass", "till");
      await setProfileKitchenScreens(tx, f.cfg, bounded, {
        [kind]: { stationIds: [f.gone, f.other], zoneIds: null },
      });
      for (const pid of [every, till])
        await setProfileKitchenScreens(tx, f.cfg, pid, {
          [kind]: { stationIds: null, zoneIds: null },
        });
      const explicit = await device(tx, f, every, "A explicit");
      const boundEvery = await device(tx, f, bounded, "B bound");
      const bothEvery = await device(tx, f, every, "Every");
      const off = await device(tx, f, every, "Off", false);
      const removed = await device(tx, f, every, "Removed");
      const kindRemoved = await device(tx, f, every, "Kind removed");
      const tillExplicit = await device(tx, f, till, "Till explicit");
      for (const [did, pid] of [
        [explicit, every],
        [off, every],
        [removed, every],
        [kindRemoved, every],
        [tillExplicit, till],
      ])
        await setDeviceKitchenScreens(tx, f.cfg, {
          deviceId: did!,
          profileId: pid!,
          screens: [{ kind, stationIds: [f.gone, f.other], zoneIds: null }],
        });
      for (const [did, pid] of [
        [boundEvery, bounded],
        [bothEvery, every],
      ])
        await setDeviceKitchenScreens(tx, f.cfg, {
          deviceId: did!,
          profileId: pid!,
          screens: [{ kind, stationIds: null, zoneIds: null }],
        });
      await tx.insert(deviceKitchenScreenRemovals).values([
        { deviceId: removed, screen: kind, stationId: f.gone },
        { deviceId: kindRemoved, screen: kind },
      ]);
      expect((await module.readStationDeleteSettings(tx, f.cfg, f.gone)).boundScreens).toEqual([
        { id: explicit, name: "A explicit" },
        { id: boundEvery, name: "B bound" },
        { id: off, name: "Off" },
      ]);
    });
  },
);
