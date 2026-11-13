import { seedDeviceProfiles, attachStationPrinterForTest } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  devices,
  kitchenStations,
  printJobs,
  printers,
  ticketItems,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { PRINTER_UNPAIRED } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import {
  stationPrintersDown,
  passScreensDark,
  stationPrintersDownQuery,
  stationScreensDark,
  stationsWithWaitingDishes,
  waitingDishesQuery,
} from "./station-outputs-down.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { kitchenScreenDevice, profile } from "./testing/kitchen-screen-device.js";
import { waitingDish } from "./testing/waiting-dish.js";
import { offerProducts } from "./testing/zone-offers.js";
import { passScreenAlertSource, stationOutputAlertSource } from "./alert-sources.js";
import { VENUE_SERVICE } from "./modules.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const at = new Date("2026-10-02T18:06:00.000Z");

async function setup() {
  const venue = await setupVenue(suite.db);
  const grill = venue.defaultStationId;
  const bar = await withTransaction(suite.db, (tx) =>
    createStation(tx, { name: "Bar", isDefault: false }),
  );
  const printer = async (stationId: string, name: string) => {
    const [p] = await suite.db
      .insert(printers)
      .values({
        name,
        transport: "cloud_poll",
        pollId: randomUUID(),
      })
      .returning({ id: printers.id });
    await attachStationPrinterForTest(suite.db, stationId, p!.id);
    return p!.id;
  };
  return { venue, grill, bar: bar.id, printer };
}

/** A device row, given a station screen on `stationId` offered on its profile. */
async function stationScreenDevice(values: typeof devices.$inferInsert & { stationId: string }) {
  const { stationId, ...row } = values;
  return kitchenScreenDevice(suite.db, row, {
    kind: "station",
    stationIds: [stationId],
    zoneIds: null,
  });
}

/** The dark-screen alerts' keys, every station open and the grill the default. */
async function darkScreenAlertKeys(f: Awaited<ReturnType<typeof setup>>): Promise<string[]> {
  const source = stationOutputAlertSource({
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

async function job(printerId: string, values: Partial<typeof printJobs.$inferInsert> = {}) {
  await suite.db.insert(printJobs).values({
    printerId,
    payload: Uint8Array.of(1),
    createdAt: "2026-10-02T18:00:00.000Z",
    status: "failed",
    attempts: 5,
    ...values,
  });
}

function waitingItem(
  venue: Awaited<ReturnType<typeof setup>>["venue"],
  stationId: string,
  firedAt: string,
) {
  return waitingDish(suite.db, venue, stationId, firedAt, at);
}

describe("station output status", () => {
  it("uses the printer pull and recent waiting-dish indexes in its SQL plans", async () => {
    const f = await setup();
    const plans = await withTransaction(suite.db, async (tx) => {
      const printer = stationPrintersDownQuery(tx, at, [f.grill]);
      const waiting = waitingDishesQuery(tx, at, [f.grill]);
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
    await job(p);
    await job(p, {
      kind: "drawer",
      status: "done",
      createdAt: "2026-10-02T18:05:00.000Z",
    });
    const down = await withTransaction(suite.db, (tx) => stationPrintersDown(tx, at));
    expect(down).toEqual([
      {
        stationId: f.grill,
        stationName: "Cocina",
        printerId: p,
        printerName: "Epson",
        since: "2026-10-02T18:00:00.000Z",
      },
    ]);
    await job(p, { status: "done", createdAt: "2026-10-02T18:05:01.000Z" });
    expect(await withTransaction(suite.db, (tx) => stationPrintersDown(tx, at))).toEqual([]);
  });

  it("scopes printer trouble to the requested station and excludes Unpair", async () => {
    const f = await setup();
    const one = await f.printer(f.grill, "Grill printer");
    const two = await f.printer(f.bar, "Bar printer");
    await job(one);
    await job(two);
    expect(
      await withTransaction(suite.db, (tx) => stationPrintersDown(tx, at, [f.grill])),
    ).toMatchObject([{ printerId: one }]);
    await suite.db
      .update(printJobs)
      .set({ lastError: PRINTER_UNPAIRED })
      .where(eq(printJobs.printerId, one));
    expect(await withTransaction(suite.db, (tx) => stationPrintersDown(tx, at, [f.grill]))).toEqual(
      [],
    );
  });

  it("keeps a given-up ticket down overnight and ignores a young queued ticket", async () => {
    const f = await setup();
    const p = await f.printer(f.grill, "Epson");
    await job(p, {
      status: "queued",
      attempts: 0,
      createdAt: "2026-10-02T18:05:00.000Z",
    });
    expect(await withTransaction(suite.db, (tx) => stationPrintersDown(tx, at))).toEqual([]);
    await job(p);
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toHaveLength(1);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, p));
    expect(
      await withTransaction(suite.db, (tx) =>
        stationPrintersDown(tx, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toEqual([]);
  });

  it("reports a dark screen only with recently fired work still waiting, including at a closed station", async () => {
    const f = await setup();
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS test",
      formFactor: "kds",
      capabilities: [],
    });
    await stationScreenDevice({
      stationId: f.bar,
      deviceProfileId: profile!.id,
      label: "Screen",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    const orderId = await waitingItem(f.venue, f.bar, "2026-10-02T17:50:00.000Z");
    expect(
      await withTransaction(suite.db, (tx) =>
        stationScreensDark(tx, new Date("2026-10-02T18:02:00Z")),
      ),
    ).toEqual([]);
    await suite.db
      .update(kitchenStations)
      .set({ closedOnDay: "2026-10-02" })
      .where(eq(kitchenStations.id, f.bar));
    expect(
      (await withTransaction(suite.db, (tx) => VENUE_SERVICE.stationStates(tx, at))).get(f.bar)
        ?.open,
    ).toBe(false);
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([
      { stationId: f.bar, stationName: "Bar", lastSeenAt: "2026-10-02T18:00:00.000Z" },
    ]);
    expect([
      ...(await withTransaction(suite.db, (tx) =>
        stationsWithWaitingDishes(tx, at, [f.bar, f.grill]),
      )),
    ]).toEqual([f.bar]);
    await suite.db
      .update(ticketItems)
      .set({ state: "ready" })
      .where(eq(ticketItems.workingOrderId, orderId));
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
  });

  it("does not call a station with no screen dark, and a second live screen clears a dark one", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS test",
      formFactor: "kds",
      capabilities: [],
    });
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Never seen",
      tokenHash: "hash",
    });
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: null },
    ]);
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Live",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:05:00.000Z",
    });
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
  });

  it("does not count a pass screen on Grill as Grill's own screen", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS",
      formFactor: "kds",
      capabilities: [],
    });
    const pass = await kitchenScreenDevice(
      suite.db,
      {
        deviceProfileId: profile!.id,
        label: "Dark pass",
        tokenHash: "hash",
        lastSeenAt: "2026-10-02T17:55:00.000Z",
      },
      { kind: "pass", stationIds: [f.grill], zoneIds: null },
    );
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
    await stationScreenDevice({
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
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: "2026-10-02T17:55:00.000Z" },
    ]);
  });

  it("ignores old waiting dishes and revoked screens", async () => {
    const f = await setup();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:05:00.000Z");
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS test",
      formFactor: "kds",
      capabilities: [],
    });
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Revoked",
      tokenHash: "hash",
      active: false,
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    expect(await withTransaction(suite.db, (tx) => stationsWithWaitingDishes(tx, at))).toEqual(
      new Set(),
    );
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
  });

  it("keeps a dark screen listed while its untapped dish is part-served, and drops it once the dish is fully served", async () => {
    const f = await setup();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: await profile(suite.db, "kds"),
      label: "Dark",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    await suite.db
      .update(workingOrderLines)
      .set({ servedQuantity: 500, servedAt: "2026-10-02T18:01:00.000Z" })
      .where(eq(workingOrderLines.workingOrderId, orderId));
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: "2026-10-02T18:00:00.000Z" },
    ]);
    await suite.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000 })
      .where(eq(workingOrderLines.workingOrderId, orderId));
    const [item] = await suite.db
      .select({ state: ticketItems.state })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, orderId));
    expect(item!.state).toBe("queued");
    expect(
      await withTransaction(suite.db, (tx) => stationsWithWaitingDishes(tx, at, [f.grill])),
    ).toEqual(new Set());
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
  });

  it.each([
    ["a voided", sql`status = 'abandoned'`],
    ["a collected", sql`collected_at = '2026-10-02T18:01:00.000Z'`],
  ])("does not keep a dark screen listed for the untapped dish of %s order", async (_, change) => {
    const f = await setup();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: await profile(suite.db, "kds"),
      label: "Dark",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([
      { stationId: f.grill, stationName: "Cocina", lastSeenAt: "2026-10-02T18:00:00.000Z" },
    ]);
    await suite.db.execute(sql`update working_orders set ${change} where id = ${orderId}`);
    const [item] = await suite.db
      .select({ state: ticketItems.state })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, orderId));
    expect(item!.state).toBe("queued");
    expect(
      await withTransaction(suite.db, (tx) => stationsWithWaitingDishes(tx, at, [f.grill])),
    ).toEqual(new Set());
    expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
  });

  it("alerts a closed station with waiting dishes about both its printer and dark screens", async () => {
    const f = await setup();
    const p = await f.printer(f.bar, "Bar printer");
    await job(p);
    await waitingItem(f.venue, f.bar, "2026-10-02T17:50:00.000Z");
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS test",
      formFactor: "kds",
      capabilities: [],
    });
    await stationScreenDevice({
      stationId: f.bar,
      deviceProfileId: profile!.id,
      label: "Dark",
      tokenHash: "hash",
      lastSeenAt: "2026-10-02T18:00:00.000Z",
    });
    const source = stationOutputAlertSource({
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
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "KDS test",
      formFactor: "kds",
      capabilities: [],
    });
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: profile!.id,
      label: "Never seen",
      tokenHash: "hash",
    });
    const source = stationOutputAlertSource({
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
      suite.db,
      {
        deviceProfileId: await profile(suite.db, "kds"),
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
      expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });

    it("raises nothing when the only kitchen displays run pass screens and monitors, all silent", async () => {
      const f = await setup();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      for (const kind of ["pass", "pass_monitor"] as const) {
        await kitchenScreenDevice(
          suite.db,
          {
            deviceProfileId: await profile(suite.db, "kds"),
            label: kind,
            tokenHash: "hash",
          },
          { kind, stationIds: null, zoneIds: null },
        );
      }
      expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });

    it("raises nothing for a till whose station choice covers the station and which has been silent an hour", async () => {
      const f = await setup();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      await kitchenScreenDevice(
        suite.db,
        {
          deviceProfileId: await profile(suite.db, "till"),
          label: "Till",
          tokenHash: "hash",
          lastSeenAt: "2026-10-02T17:05:00.000Z",
        },
        { kind: "station", stationIds: [f.grill], zoneIds: null },
      );
      expect(await withTransaction(suite.db, (tx) => stationScreensDark(tx, at))).toEqual([]);
      expect(await darkScreenAlertKeys(f)).toEqual([]);
    });
  });
});

describe("passScreensDark", () => {
  const dark = "2026-10-02T18:02:00.000Z";

  async function passFixture() {
    const f = await setup();
    const counter = await withTransaction(suite.db, (tx) => offerProducts(tx, f.venue.cfg));
    const tables = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, f.venue.cfg, { zone: "tables" }),
    );
    return { ...f, counterZone: counter.zoneId, tablesZone: tables.zoneId };
  }

  async function passDevice(
    f: Awaited<ReturnType<typeof passFixture>>,
    kind: "pass" | "pass_monitor",
    options: {
      lastSeenAt?: string | null;
      formFactor?: "kds" | "till";
      zoneIds?: string[] | null;
      label?: string;
    } = {},
  ) {
    return kitchenScreenDevice(
      suite.db,
      {
        deviceProfileId: await profile(suite.db, options.formFactor ?? "kds"),
        label: options.label ?? kind,
        tokenHash: "hash",
        lastSeenAt: options.lastSeenAt === undefined ? dark : options.lastSeenAt,
      },
      { kind, stationIds: null, zoneIds: options.zoneIds ?? [f.counterZone] },
    );
  }

  const read = () => withTransaction(suite.db, (tx) => passScreensDark(tx, at));

  it("lists a pass screen unseen for four minutes with a dish waiting in its zone", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const pass = await passDevice(f, "pass", { label: "Pass" });
    expect(await read()).toEqual([
      { deviceId: pass, deviceName: "Pass", kind: "pass", lastSeenAt: dark },
    ]);
  });

  it("does not list a pass screen seen two minutes ago", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await passDevice(f, "pass", { lastSeenAt: "2026-10-02T18:04:00.000Z" });
    expect(await read()).toEqual([]);
  });

  it("lists a pass screen never seen", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const pass = await passDevice(f, "pass", { lastSeenAt: null });
    expect(await read()).toEqual([
      { deviceId: pass, deviceName: "pass", kind: "pass", lastSeenAt: null },
    ]);
  });

  it("lists a pass monitor with kind pass_monitor", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const monitor = await passDevice(f, "pass_monitor", { label: "Monitor" });
    expect(await read()).toEqual([
      { deviceId: monitor, deviceName: "Monitor", kind: "pass_monitor", lastSeenAt: dark },
    ]);
  });

  it("does not count a dish in another zone", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await passDevice(f, "pass", { zoneIds: [f.tablesZone] });
    expect(await read()).toEqual([]);
  });

  it("does not count a dish fired over an hour ago", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:05:00.000Z");
    await passDevice(f, "pass");
    expect(await read()).toEqual([]);
  });

  it("does not count a held dish", async () => {
    const f = await passFixture();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await suite.db
      .update(ticketItems)
      .set({ firedAt: null, requestedAt: null })
      .where(eq(ticketItems.workingOrderId, orderId));
    await passDevice(f, "pass");
    expect(await read()).toEqual([]);
  });

  it("does not count a dish made at the till", async () => {
    const f = await passFixture();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await suite.db
      .update(ticketItems)
      .set({ madeHere: true })
      .where(eq(ticketItems.workingOrderId, orderId));
    await passDevice(f, "pass");
    expect(await read()).toEqual([]);
  });

  it.each([
    ["an abandoned", sql`status = 'abandoned'`],
    ["a collected", sql`collected_at = '2026-10-02T18:00:00.000Z'`],
  ])("does not count a dish of %s order", async (_, change) => {
    const f = await passFixture();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await suite.db.execute(sql`update working_orders set ${change} where id = ${orderId}`);
    await passDevice(f, "pass");
    expect(await read()).toEqual([]);
  });

  it("A773 no dispatch state: a dark pass is listed while its waiting dish is unserved, and not once it is fully served", async () => {
    const f = await passFixture();
    const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const pass = await passDevice(f, "pass", { label: "Pass" });
    await passDevice(f, "pass", { label: "Other", lastSeenAt: at.toISOString() });
    expect((await read()).map((row) => row.deviceId)).toEqual([pass]);
    await suite.db.execute(
      sql`update working_order_lines set served_quantity = 1000, served_at = '2026-10-02T18:00:00.000Z' where working_order_id = ${orderId}`,
    );
    expect(await read()).toEqual([]);
  });

  it.each(["pass", "pass_monitor"] as const)(
    "A773 no dispatch state: a dark %s still has work after partial serving, until the last portion is served",
    async (kind) => {
      const f = await passFixture();
      const orderId = await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      const deviceId = await passDevice(f, kind);
      await suite.db
        .update(ticketItems)
        .set({ state: "ready" })
        .where(eq(ticketItems.workingOrderId, orderId));
      await suite.db
        .update(workingOrderLines)
        .set({ servedQuantity: 500, servedAt: "2026-10-02T18:00:00.000Z" })
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(await read()).toEqual([{ deviceId, deviceName: kind, kind, lastSeenAt: dark }]);
      await suite.db
        .update(workingOrderLines)
        .set({ servedQuantity: 1000 })
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(await read()).toEqual([]);
    },
  );

  it("never lists a till with a pass screen", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await passDevice(f, "pass", { formFactor: "till" });
    expect(await read()).toEqual([]);
  });

  it("does not list a switched-off device", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const pass = await passDevice(f, "pass");
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, pass));
    expect(await read()).toEqual([]);
  });

  it("does not list a kitchen display running a station screen", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    await stationScreenDevice({
      stationId: f.grill,
      deviceProfileId: await profile(suite.db, "kds"),
      label: "Grill screen",
      tokenHash: "hash",
      lastSeenAt: dark,
    });
    expect(await read()).toEqual([]);
  });

  it("does not list a pass a narrowing took", async () => {
    const f = await passFixture();
    await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
    const pass = await passDevice(f, "pass");
    const bare = await profile(suite.db, "kds");
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.narrowDeviceKitchenScreens(tx, pass, bare),
    );
    await suite.db.update(devices).set({ deviceProfileId: bare }).where(eq(devices.id, pass));
    expect(
      await withTransaction(suite.db, (tx) => VENUE_SERVICE.readDeviceKitchenScreens(tx, pass)),
    ).toMatchObject([{ kind: "pass", available: false }]);
    expect(await read()).toEqual([]);
  });

  describe("passScreenAlertSource", () => {
    const alerts = () => {
      const source = passScreenAlertSource();
      return withTransaction(suite.db, (tx) => source.read({ tx, now: at }));
    };

    it("is a kitchen alert for venue.configure", async () => {
      await passFixture();
      const source = passScreenAlertSource();
      expect([source.area, source.permission]).toEqual(["kitchen", "venue.configure"]);
    });

    it("raises one warning for a dark pass screen with a dish waiting", async () => {
      const f = await passFixture();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      const pass = await passDevice(f, "pass", { label: "Pass" });
      expect(await alerts()).toEqual([
        {
          key: `kitchen_screen.pass_dark:${pass}`,
          code: "kitchen_screen.pass_dark",
          params: { device: "Pass" },
          severity: "warning",
          since: dark,
          screen: "devices",
        },
      ]);
    });

    it("raises pass_monitor_dark for a monitor, since now when it was never seen", async () => {
      const f = await passFixture();
      await waitingItem(f.venue, f.grill, "2026-10-02T17:50:00.000Z");
      const monitor = await passDevice(f, "pass_monitor", { label: "Monitor", lastSeenAt: null });
      expect(await alerts()).toEqual([
        {
          key: `kitchen_screen.pass_dark:${monitor}`,
          code: "kitchen_screen.pass_monitor_dark",
          params: { device: "Monitor" },
          severity: "warning",
          since: at.toISOString(),
          screen: "devices",
        },
      ]);
    });
  });
});

it("A725 down printers and dark station screens use station and printer names", async () => {
  const f = await setup();
  await suite.db
    .update(kitchenStations)
    .set({ name: "Ásador" })
    .where(eq(kitchenStations.id, f.bar));
  const z = await f.printer(f.bar, "Zulu printer");
  const a = await f.printer(f.bar, "Alpha printer");
  const k = await f.printer(f.grill, "Kitchen printer");
  for (const id of [z, a, k]) await job(id);
  expect(
    (await stationPrintersDown(suite.db, at)).map(({ stationName, printerName }) => [
      stationName,
      printerName,
    ]),
  ).toEqual([
    ["Ásador", "Alpha printer"],
    ["Ásador", "Zulu printer"],
    ["Cocina", "Kitchen printer"],
  ]);
  const profileId = await profile(suite.db, "kds");
  for (const stationId of [f.grill, f.bar]) {
    await waitingItem(f.venue, stationId, "2026-10-02T17:50:00.000Z");
    await stationScreenDevice({
      label: randomUUID(),
      deviceProfileId: profileId,
      stationId,
      tokenHash: randomUUID(),
      lastSeenAt: null,
    });
  }
  expect((await stationScreensDark(suite.db, at)).map(({ stationName }) => stationName)).toEqual([
    "Ásador",
    "Cocina",
  ]);
});
