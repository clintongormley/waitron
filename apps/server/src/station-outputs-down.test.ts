import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  devices,
  deviceProfiles,
  kitchenStations,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { PRINTER_UNPAIRED } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import {
  stationPrintersDown,
  stationPrintersDownQuery,
  stationScreensDark,
  stationsWithWaitingDishes,
  waitingDishesQuery,
} from "./station-outputs-down.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { deploymentEnvironment } from "./config.js";
import { stationOutputAlertSource } from "./alert-sources.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { VENUE_SERVICE } from "./modules.js";
import type { DeviceKitchenScreen } from "@waitron/module";
import { locationId } from "@waitron/shared";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const at = new Date("2026-10-02T18:06:00.000Z");

async function setup() {
  const venue = await setupVenue(suite.db);
  const grill = venue.defaultStationId;
  const bar = await withTransaction(suite.db, (tx) =>
    createStation(tx, venue.cfg, { name: "Bar", isDefault: false }),
  );
  const printer = async (stationId: string, name: string) => {
    const [p] = await suite.db
      .insert(printers)
      .values({
        locationId: venue.cfg.locationId,
        name,
        transport: "cloud_poll",
        pollId: randomUUID(),
      })
      .returning({ id: printers.id });
    await suite.db.insert(stationPrinters).values({ stationId, printerId: p!.id });
    return p!.id;
  };
  return { venue, grill, bar: bar.id, printer };
}

/** A device row, given a station screen on `stationId` offered on its profile. */
async function stationScreenDevice(values: typeof devices.$inferInsert & { stationId: string }) {
  const { stationId, ...row } = values;
  return kitchenScreenDevice(row, { kind: "station", stationIds: [stationId], zoneIds: null });
}

/** A device row, given `screen` offered on its profile. */
async function kitchenScreenDevice(row: typeof devices.$inferInsert, screen: DeviceKitchenScreen) {
  const [device] = await suite.db.insert(devices).values(row).returning({ id: devices.id });
  const cfg = { locationId: locationId(row.locationId) };
  await withTransaction(suite.db, async (tx) => {
    await VENUE_SERVICE.addProfileKitchenScreen(tx, cfg, row.deviceProfileId, screen);
    await VENUE_SERVICE.setDeviceKitchenScreens(tx, cfg, {
      deviceId: device!.id,
      profileId: row.deviceProfileId,
      screens: [screen],
    });
  });
  return device!.id;
}

async function profile(formFactor: "kds" | "till"): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: randomUUID(), formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** The dark-screen alerts' keys, every station open and the grill the default. */
async function darkScreenAlertKeys(f: Awaited<ReturnType<typeof setup>>): Promise<string[]> {
  const source = stationOutputAlertSource({
    locationId: f.venue.cfg.locationId,
    stationStates: async () =>
      new Map([
        [f.grill, { open: true, isDefault: true, active: true, name: "Cocina" }],
        [f.bar, { open: true, isDefault: false, active: true, name: "Bar" }],
      ]),
  });
  return (await withTransaction(suite.db, (tx) => source.read({ tx, now: at })))
    .map((alert) => alert.key)
    .filter((key) => key.startsWith("station.screens_dark:"));
}

async function job(
  locationId: string,
  printerId: string,
  values: Partial<typeof printJobs.$inferInsert> = {},
) {
  await suite.db.insert(printJobs).values({
    locationId,
    printerId,
    payload: Uint8Array.of(1),
    createdAt: "2026-10-02T18:00:00.000Z",
    status: "failed",
    attempts: 5,
    ...values,
  });
}

async function waitingItem(
  venue: Awaited<ReturnType<typeof setup>>["venue"],
  stationId: string,
  firedAt: string,
) {
  const orderId = randomUUID();
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
    label: "Mesa 7",
  });
  const clock = {
    now: () => ({
      instant: at,
      offsetMinutes: 0,
      confident: true,
      confidence: "anchored" as const,
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("unused");
    },
    currentAnchor: () => null,
  };
  const backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("unused")),
  });
  await placeOrder(
    { db: suite.db, backend, clock },
    await deviceRequestCfg(suite.db, venue.cfg),
    orderId,
    randomUUID(),
  );
  await suite.db.execute(
    sql`update ticket_items set station_id = ${stationId}, fired_at = ${firedAt} where working_order_id = ${orderId}`,
  );
  return orderId;
}

describe("station output status", () => {
  it("uses the printer pull and recent waiting-dish indexes in its SQL plans", async () => {
    const f = await setup();
    const plans = await withTransaction(suite.db, async (tx) => {
      const printer = stationPrintersDownQuery(tx, f.venue.cfg.locationId, at, [f.grill]);
      const waiting = waitingDishesQuery(tx, f.venue.cfg.locationId, at, [f.grill]);
      expect(printer.toSQL().sql).toContain("print_jobs");
      expect(waiting.toSQL().sql).toContain("ticket_items");
      const p = await tx.execute<{ detail: string }>(sql`explain query plan ${printer.getSQL()}`);
      const w = await tx.execute<{ detail: string }>(sql`explain query plan ${waiting.getSQL()}`);
      return { printer: p.rows.map((r) => r.detail), waiting: w.rows.map((r) => r.detail) };
    });
    expect(
      plans.printer.some((s) => s.includes("SEARCH print_jobs USING INDEX print_jobs_pull_idx")),
    ).toBe(true);
    expect(
      plans.printer.some(
        (s) => s.includes("SEARCH d USING INDEX print_jobs_pull_idx") && s.includes("rowid>?"),
      ),
    ).toBe(true);
    expect(plans.waiting.some((s) => s.includes("ticket_items_waiting_idx"))).toBe(true);
  });

  it("keeps a printer down through a drawer pulse, then clears it after a document prints", async () => {
    const f = await setup();
    const p = await f.printer(f.grill, "Epson");
    await job(f.venue.cfg.locationId, p);
    await job(f.venue.cfg.locationId, p, {
      kind: "drawer",
      status: "done",
      createdAt: "2026-10-02T18:05:00.000Z",
    });
    const down = await withTransaction(suite.db, (tx) =>
      stationPrintersDown(tx, f.venue.cfg.locationId, at),
    );
    expect(down).toEqual([
      {
        stationId: f.grill,
        stationName: "Cocina",
        printerId: p,
        printerName: "Epson",
        since: "2026-10-02T18:00:00.000Z",
      },
    ]);
    await job(f.venue.cfg.locationId, p, { status: "done", createdAt: "2026-10-02T18:05:01.000Z" });
    expect(
      await withTransaction(suite.db, (tx) => stationPrintersDown(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
  });

  it("scopes printer trouble to the requested station and excludes Unpair", async () => {
    const f = await setup();
    const one = await f.printer(f.grill, "Grill printer");
    const two = await f.printer(f.bar, "Bar printer");
    await job(f.venue.cfg.locationId, one);
    await job(f.venue.cfg.locationId, two);
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, f.venue.cfg.locationId, at, [f.grill]),
      ),
    ).toMatchObject([{ printerId: one }]);
    await suite.db
      .update(printJobs)
      .set({ lastError: PRINTER_UNPAIRED })
      .where(eq(printJobs.printerId, one));
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, f.venue.cfg.locationId, at, [f.grill]),
      ),
    ).toEqual([]);
  });

  it("keeps a given-up ticket down overnight and ignores a young queued ticket", async () => {
    const f = await setup();
    const p = await f.printer(f.grill, "Epson");
    await job(f.venue.cfg.locationId, p, {
      status: "queued",
      attempts: 0,
      createdAt: "2026-10-02T18:05:00.000Z",
    });
    expect(
      await withTransaction(suite.db, (tx) => stationPrintersDown(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
    await job(f.venue.cfg.locationId, p);
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, f.venue.cfg.locationId, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toHaveLength(1);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, p));
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, f.venue.cfg.locationId, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toEqual([]);
  });

  it("reports a dark screen only with recently fired work still waiting, including at a closed station", async () => {
    const f = await setup();
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS test", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Screen",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    expect(
      await withTransaction(suite.db, (tx) =>
        stationScreensDark(tx, f.venue.cfg.locationId, new Date("2026-10-02T18:02:00Z")),
      ),
    ).toEqual([]);
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, f.grill));
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: "2026-10-02T18:00:00.000Z" },
    ]);
    expect([
      ...(await withTransaction(suite.db, (tx) =>
        stationsWithWaitingDishes(tx, f.venue.cfg.locationId, at, [f.grill, f.bar]),
      )),
    ]).toEqual([f.grill]);
    await suite.db
      .update(ticketItems)
      .set({ state: "ready" })
      .where(eq(ticketItems.workingOrderId, orderId));
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
  });

  it("does not call a station with no screen dark, and a second live screen clears a dark one", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS test", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Never seen",
      tokenHash: "hash",
    });
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([{ stationId: f.grill, stationName: "Cocina", lastSeenAt: null }]);
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Live",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:05:00.000Z",
    });
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
  });

  it("does not count a pass screen on Grill as Grill's own screen", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    const pass = await kitchenScreenDevice(
      {
        locationId: f.venue.cfg.locationId,
        deviceProfileId: profile!.id,
        label: "Dark pass",
        tokenHash: "hash",
        lastSeenAt: "2026-10-02T17:55:00.000Z",
      },
      { kind: "pass", stationIds: [f.grill], zoneIds: null },
    );
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Dark Grill",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T17:55:00.000Z",
    });
    await suite.db
      .update(devices)
      .set({ lastSeenAt: "2026-10-02T18:05:00.000Z" })
      .where(eq(devices.id, pass));
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: "2026-10-02T17:55:00.000Z" },
    ]);
  });

  it("ignores old waiting dishes and revoked screens", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:05:00.000Z");
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS test", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Revoked",
      tokenHash: "hash",
      active: false,
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        stationsWithWaitingDishes(tx, f.venue.cfg.locationId, at),
      ),
    ).toEqual(new Set());
    expect(
      await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
    ).toEqual([]);
  });

  it("alerts a closed station with waiting dishes about both its printer and dark screens", async () => {
    const f = await setup();
    const p = await f.printer(f.bar, "Bar printer");
    await job(f.venue.cfg.locationId, p);
    await waitingItem(f.venue, f.bar, "2026-10-02T17:50:00.000Z");
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS test", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.bar,
      deviceProfileId: profile!.id,
      label: "Dark",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    const source = stationOutputAlertSource({
      locationId: f.venue.cfg.locationId,
      stationStates: async () =>
        new Map([[f.bar, { open: false, isDefault: false, active: true, name: "Bar" }]]),
    });
    const alerts = await withTransaction(suite.db, (tx) => source.read({ tx, now: at }));
    expect(alerts).toMatchObject([
      {
        key: `station.printer_down:${f.bar}:${p}`,
        code: "station.printer_down",
        severity: "error",
        screen: "prep-stations",
      },
      {
        key: `station.screens_dark:${f.bar}`,
        code: "station.screens_dark",
        severity: "warning",
        screen: "prep-stations",
      },
    ]);
  });

  it("alerts an open default station whose never-seen screen is dark", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "KDS test", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    await stationScreenDevice({
      locationId: f.venue.cfg.locationId,
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Never seen",
      tokenHash: "hash",
    });
    const source = stationOutputAlertSource({
      locationId: f.venue.cfg.locationId,
      stationStates: async () =>
        new Map([[f.grill, { open: true, isDefault: true, active: true, name: "Cocina" }]]),
    });
    expect(await withTransaction(suite.db, (tx) => source.read({ tx, now: at }))).toEqual([
      {
        key: `station.screens_dark:${f.grill}`,
        code: "station.default_screens_dark",
        params: { station: "Cocina" },
        severity: "warning",
        since: at.toISOString(),
        screen: "prep-stations",
      },
    ]);
  });
  it("alerts a dark station screen for each of its stations", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await waitingItem(f.venue, f.bar, "2026-10-02T17:50:00.000Z");
    await kitchenScreenDevice(
      {
        locationId: f.venue.cfg.locationId,
        deviceProfileId: await profile("kds"),
        label: "Dark line",
        tokenHash: "hash",
        lastSeenAt: "2026-10-02T17:55:00.000Z",
      },
      { kind: "station", stationIds: [f.grill, f.bar], zoneIds: null },
    );
    expect((await darkScreenAlertKeys(f)).sort()).toEqual(
      [`station.screens_dark:${f.grill}`, `station.screens_dark:${f.bar}`].sort(),
    );
  });

  describe("no screen is normal", () => {
    it("raises nothing in a venue with no kitchen display", async () => {
      const f = await setup();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      await waitingItem(f.venue, f.bar, "2026-10-02T17:50:00.000Z");
      expect(
        await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
      ).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });

    it("raises nothing when the only kitchen displays run pass screens and monitors, all silent", async () => {
      const f = await setup();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      for (const kind of ["pass", "pass_monitor"] as const) {
        await kitchenScreenDevice(
          {
            locationId: f.venue.cfg.locationId,
            deviceProfileId: await profile("kds"),
            label: kind,
            tokenHash: "hash",
          },
          { kind, stationIds: null, zoneIds: null },
        );
      }
      expect(
        await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
      ).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });

    it("raises nothing for a till whose station choice covers the station and which has been silent an hour", async () => {
      const f = await setup();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      await kitchenScreenDevice(
        {
          locationId: f.venue.cfg.locationId,
          deviceProfileId: await profile("till"),
          label: "Till",
          tokenHash: "hash",
          lastSeenAt: "2026-10-02T17:05:00.000Z",
        },
        { kind: "station", stationIds: [f.grill], zoneIds: null },
      );
      expect(
        await withTransaction(suite.db, (tx) => stationScreensDark(tx, f.venue.cfg.locationId, at)),
      ).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });
  });
});
