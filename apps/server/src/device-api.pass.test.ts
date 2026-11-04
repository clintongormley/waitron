import { testTradingAdmission } from "./testing/trading-admission.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { endSession, loginWithPin, persons } from "@waitron/identity";
import type { DeviceKitchenScreen, ScreenSlot } from "@waitron/module";
import type { PassBoard } from "./pass-card.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { boardCards, boardItems } from "./testing/pass-board-probe.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { mountDeviceApi } from "./device-api.js";
import { deleteDevice, disableDevice } from "./device-delete.js";
import { mountTillApi } from "./till-api.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { VENUE_SERVICE } from "./modules.js";
import { createStation } from "./kitchen.js";
import {
  advanceTicketItem,
  createOpenOrder,
  fireableLineColumns,
  fireLines,
  markServed,
} from "./working-order.js";
import { releasePassItems } from "./pass-release.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  orderForParty,
  seat,
  setupPartyVenue,
} from "./testing/party-venue.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { createPrinter } from "@waitron/printing";
import { attendanceOperationFacts } from "@waitron/workforce";
import { attachPrinterToStation } from "./station-printers.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { mountManagementApi } from "./management-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const log = () => {};

const EVERY_PASS: DeviceKitchenScreen = { kind: "pass", stationIds: null, zoneIds: null };

async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const profile = async (formFactor: "kds" | "till") => {
    const [row] = await inTx(v, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: `${formFactor} profile`, formFactor, capabilities: [] })
        .returning({ id: deviceProfiles.id }),
    );
    return row!.id;
  };
  const grill = (await inTx(v, (tx) => createStation(tx, v.cfg, { name: "Grill" }))).id;
  const kds = await profile("kds");
  const till = await profile("till");
  const device = async (
    name: string,
    profileId: string,
    choice: { kitchenScreen?: DeviceKitchenScreen; stationId?: string },
  ) => {
    const joined = await enrolDeviceForTest(suite.db, v.cfg, { name, profileId, ...choice });
    return { id: joined.deviceId, cookie: `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}` };
  };
  const a = await device("Pass A", kds, { kitchenScreen: EVERY_PASS });
  const b = await device("Pass B", kds, { kitchenScreen: EVERY_PASS });
  const app = new Hono();
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    log,
  );
  return { v, app, grill, kds, till, device, a, b };
}

type Board = { board: PassBoard; stations: ScreenSlot[]; zones: ScreenSlot[] | null };

/** The dishes the device's scope sees. */
function items(board: Board): string[] {
  return boardItems(board.board, { inView: true }).map((item) => item.id);
}

const done = (app: Hono, cookie: string, body: unknown) =>
  app.request("/api/device/pass-screen/done", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function read(app: Hono, cookie: string, path = "/api/device/pass-board") {
  const response = await app.request(path, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as Board;
}

async function burgerOrder(v: Awaited<ReturnType<typeof setupPartyVenue>>) {
  const seated = await seat(v, await v.table("Inside"));
  await orderForParty(v, seated.partyId, ["Burger"], seated.tabId);
  const [item] = await inTx(v, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, seated.tabId)),
  );
  return item!.id;
}

describe("the pass screen's device routes", () => {
  it("A773 waiter authority: Done and Undo cannot change kitchen work", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const before = await inTx(f.v, async (tx) => ({
      items: await tx.select().from(ticketItems),
    }));
    for (const cookie of [f.a.cookie, f.b.cookie, ""]) {
      for (const marked of [true, false]) {
        const response = await done(f.app, cookie, { ticketItemIds: [itemId], done: marked });
        expect(response.status).toBe(404);
        expect(
          await inTx(f.v, async (tx) => ({
            items: await tx.select().from(ticketItems),
          })),
        ).toEqual(before);
        expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
        expect(items(await read(f.app, f.b.cookie))).toEqual([itemId]);
      }
    }
  });

  it("answers a device with no pass screen device.unauthorized, and a pass screen's read names its stations", async () => {
    const f = await fixture();
    const station = await f.device("Grill screen", f.kds, { stationId: f.grill });
    for (const path of ["/api/device/pass-board", "/api/device/pass-monitor-board"]) {
      const refused = await f.app.request(path, { headers: { cookie: station.cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    }
    const refusedDone = await done(f.app, station.cookie, { ticketItemIds: [f.a.id], done: true });
    expect(refusedDone.status).toBe(404);
    const monitorOnPass = await f.app.request("/api/device/pass-monitor-board", {
      headers: { cookie: f.a.cookie },
    });
    expect(monitorOnPass.status).toBe(401);

    const board = await read(f.app, f.a.cookie);
    const [screen] = (
      await withTransaction(suite.db, (tx) => VENUE_SERVICE.readDeviceKitchenScreens(tx, f.a.id))
    ).filter((s) => s.kind === "pass");
    expect(board).toEqual({
      board: { held: [], toFire: [], inProgress: [], ready: [], overview: [] },
      stations: screen!.stations,
      zones: null,
      display: { showNonPassStations: true, nonPassStationsOverride: null },
    });
    expect(board.stations.map((s) => s.id)).toContain(f.grill);
  });

  it("Done and Undo are retired on both devices and leave both boards visible", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
    const marked = await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true });
    expect(marked.status).toBe(404);
    expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
    expect(items(await read(f.app, f.b.cookie))).toEqual([itemId]);
    expect((await done(f.app, f.b.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      404,
    );
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: false })).status).toBe(
      404,
    );
    expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
    expect(items(await read(f.app, f.b.cookie))).toEqual([itemId]);
  });

  it("on a till, still needs a signed-in session to read while Done is retired for everyone", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const till = await f.device("Till", f.till, { kitchenScreen: EVERY_PASS });
    const anonymousRead = await f.app.request("/api/device/pass-board", {
      headers: { cookie: till.cookie },
    });
    expect(anonymousRead.status).toBe(401);
    expect(await anonymousRead.json()).toMatchObject({ error: { code: "session.required" } });
    const anonymous = await done(f.app, till.cookie, { ticketItemIds: [itemId], done: true });
    expect(anonymous.status).toBe(404);

    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const session = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: till.id, personId: person!.id, pin: "1234" }),
    );
    const signedIn = `${till.cookie}; ${SESSION_COOKIE}=${session.token}`;
    expect(items(await read(f.app, signedIn))).toEqual([itemId]);
    expect((await done(f.app, signedIn, { ticketItemIds: [itemId], done: true })).status).toBe(404);
    expect(items(await read(f.app, signedIn))).toEqual([itemId]);
  });

  it("keeps station and zone read scope while Done is retired inside and outside that scope", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const grillOnly = await f.device("Pass Grill", f.kds, {
      kitchenScreen: { kind: "pass", stationIds: [f.grill], zoneIds: null },
    });
    const counterOnly = await f.device("Pass Counter", f.kds, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.counter.zoneId] },
    });
    const tablesOnly = await f.device("Pass Tables", f.kds, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.tables.zoneId] },
    });
    for (const outside of [grillOnly, counterOnly]) {
      expect(items(await read(f.app, outside.cookie))).toEqual([]);
      for (const marked of [true, false]) {
        const refused = await done(f.app, outside.cookie, {
          ticketItemIds: [itemId],
          done: marked,
        });
        expect(refused.status).toBe(404);
      }
    }
    expect(items(await read(f.app, tablesOnly.cookie))).toEqual([itemId]);
    expect(
      (await done(f.app, tablesOnly.cookie, { ticketItemIds: [itemId], done: true })).status,
    ).toBe(404);
  });

  it("lists a counter sale's dish on a pass screen limited to the counter's zone while Done stays retired", async () => {
    const f = await fixture();
    const tableItemId = await burgerOrder(f.v);
    const counterId = randomUUID();
    await inTx(f.v, async (tx) => {
      await createOpenOrder(
        tx,
        f.v.cfg,
        counterId,
        f.v.counter.toOfferLines([{ productId: f.v.productId("Burger"), quantity: "1" }]),
        null,
        { zoneId: f.v.counter.zoneId },
      );
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, counterId));
      await fireLines(tx, f.v.cfg, counterId, lines);
    });
    const [counterItem] = await inTx(f.v, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, counterId)),
    );
    const counterOnly = await f.device("Pass Counter", f.kds, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.counter.zoneId] },
    });
    expect(items(await read(f.app, counterOnly.cookie))).toEqual([counterItem!.id]);
    expect(
      (await done(f.app, counterOnly.cookie, { ticketItemIds: [counterItem!.id], done: true }))
        .status,
    ).toBe(404);
    expect(items(await read(f.app, counterOnly.cookie))).toEqual([counterItem!.id]);
    expect(items(await read(f.app, f.a.cookie)).sort()).toEqual(
      [tableItemId, counterItem!.id].sort(),
    );
  });

  it("answers a pass screen or pass monitor a narrowing took device.unauthorized, so the display boots to its notice", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const narrowed = await inTx(f.v, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: "Narrowed profile", formFactor: "kds", capabilities: [] })
        .returning({ id: deviceProfiles.id }),
    );
    const pass = await f.device("Pass", narrowed[0]!.id, { kitchenScreen: EVERY_PASS });
    const monitor = await f.device("Monitor", narrowed[0]!.id, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    expect(items(await read(f.app, pass.cookie))).toEqual([itemId]);
    expect(items(await read(f.app, monitor.cookie, "/api/device/pass-monitor-board"))).toEqual([
      itemId,
    ]);
    await inTx(f.v, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, narrowed[0]!.id, {
        station: { stationIds: null, zoneIds: null },
      }),
    );
    for (const [cookie, path] of [
      [pass.cookie, "/api/device/pass-board"],
      [monitor.cookie, "/api/device/pass-monitor-board"],
    ] as const) {
      const refused = await f.app.request(path, { headers: { cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    }
    const refusedDone = await done(f.app, pass.cookie, { ticketItemIds: [itemId], done: true });
    expect(refusedDone.status).toBe(404);
    const screens = await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readDeviceKitchenScreens(tx, pass.id),
    );
    expect(screens).toEqual([
      {
        kind: "pass",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        showNonPassStations: true,
        nonPassStationsOverride: null,
        stations: [],
        zones: null,
      },
    ]);
  });

  it("retires malformed Done and mixed local/foreign Done and Undo", async () => {
    const f = await fixture();
    const local = await burgerOrder(f.v);
    const badDone = await done(f.app, f.a.cookie, { ticketItemIds: [local], done: "true" });
    expect(badDone.status).toBe(404);
    for (const ticketItemIds of [[], ["not-a-uuid"], Array(201).fill(local)]) {
      const response = await done(f.app, f.a.cookie, { ticketItemIds, done: true });
      expect(response.status).toBe(404);
    }
    const [foreignLocation] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    const foreignNode = await seedNode(suite.db, brandLocationId(foreignLocation!.id));
    const [foreignStation] = await suite.db
      .insert(kitchenStations)
      .values({ locationId: foreignLocation!.id, name: "Other kitchen" })
      .returning({ id: kitchenStations.id });
    const [foreignOrder] = await suite.db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        deviceId: null,
        locationId: foreignLocation!.id,
        nodeId: foreignNode,
        orderNumber: 1,
        status: "open",
      })
      .returning({ id: workingOrders.id });
    const [foreignLine] = await suite.db
      .insert(workingOrderLines)
      .values({
        workingOrderId: foreignOrder!.id,
        lineNo: 1,
        name: "Foreign dish",
        descriptions: { "es-ES": "Foreign dish" },
        quantity: 1000,
        unitPriceGross: 100,
        vatClass: "general",
        lineTotal: 100,
      })
      .returning({ id: workingOrderLines.id });
    const [foreignItem] = await suite.db
      .insert(ticketItems)
      .values({
        nodeId: foreignNode,
        workingOrderId: foreignOrder!.id,
        workingOrderLineId: foreignLine!.id,
        stationId: foreignStation!.id,
      })
      .returning({ id: ticketItems.id });
    const mixed = await done(f.app, f.a.cookie, {
      ticketItemIds: [local, foreignItem!.id],
      done: true,
    });
    expect(mixed.status).toBe(404);
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [local], done: true })).status).toBe(
      404,
    );
    const mixedUndo = await done(f.app, f.a.cookie, {
      ticketItemIds: [local, foreignItem!.id],
      done: false,
    });
    expect(mixedUndo.status).toBe(404);
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [local], done: false })).status).toBe(
      404,
    );
  });
});

describe("the pass monitor's device route", () => {
  it("lists the pass queue, and offers no Done", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const monitor = await f.device("Pass monitor", f.kds, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const board = await read(f.app, monitor.cookie, "/api/device/pass-monitor-board");
    expect(items(board)).toEqual([itemId]);
    expect(board.stations.map((s) => s.id)).toContain(f.grill);
    expect(board.zones).toBeNull();
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      404,
    );
    expect(items(await read(f.app, monitor.cookie, "/api/device/pass-monitor-board"))).toEqual([
      itemId,
    ]);
    const monitorDone = await done(f.app, monitor.cookie, { ticketItemIds: [itemId], done: true });
    expect(monitorDone.status).toBe(404);
    const passOnMonitor = await f.app.request("/api/device/pass-board", {
      headers: { cookie: monitor.cookie },
    });
    expect(passOnMonitor.status).toBe(401);
  });
});

describe("a pass monitor on a till", () => {
  it("needs a signed-in session, then lists its zones' dishes", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const monitorOn = async (name: string, zoneId: string) => {
      const till = await f.device(name, f.till, {
        kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: [zoneId] },
      });
      const [person] = await inTx(f.v, (tx) =>
        tx.select({ id: persons.id }).from(persons).limit(1),
      );
      const session = await inTx(f.v, (tx) =>
        loginWithPin(tx, { deviceId: till.id, personId: person!.id, pin: "1234" }),
      );
      return { ...till, signedIn: `${till.cookie}; ${SESSION_COOKIE}=${session.token}` };
    };
    const tables = await monitorOn("Tables till", f.v.tables.zoneId);
    const counter = await monitorOn("Counter till", f.v.counter.zoneId);

    const anonymous = await f.app.request("/api/device/pass-monitor-board", {
      headers: { cookie: tables.cookie },
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });

    const board = await read(f.app, tables.signedIn, "/api/device/pass-monitor-board");
    expect(items(board)).toEqual([itemId]);
    expect(board.zones?.map((zone) => zone.id)).toEqual([f.v.tables.zoneId]);
    expect(items(await read(f.app, counter.signedIn, "/api/device/pass-monitor-board"))).toEqual(
      [],
    );
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      404,
    );
    expect(items(await read(f.app, tables.signedIn, "/api/device/pass-monitor-board"))).toEqual([
      itemId,
    ]);
  });
});

describe("the till's watcher routes", () => {
  async function tillApp() {
    const f = await fixture();
    mountTillApi(
      f.app,
      {
        admission: testTradingAdmission(),
        db: suite.db,
        cfg: f.v.cfg,
        backend: f.v.backend,
        clock: f.v.clock,
        secureCookies: false,
        venueLocale: "es-ES",
      },
      log,
    );
    const sessionDeviceId = await seedSessionDevice(suite.db, f.v.cfg);
    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const session = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: sessionDeviceId, personId: person!.id, pin: "1234" }),
    );
    return { ...f, sessionCookie: `${SESSION_COOKIE}=${session.token}` };
  }

  it("are gone: listing, reading and marking a watcher answer 404 to a signed-in session", async () => {
    const f = await tillApp();
    const itemId = await burgerOrder(f.v);
    const watcherId = randomUUID();
    for (const [method, path] of [
      ["GET", "/api/watchers"],
      ["GET", `/api/watchers/${watcherId}/queue`],
      ["POST", `/api/watchers/${watcherId}/done`],
    ] as const) {
      const response = await f.app.request(path, {
        method,
        headers: { cookie: f.sessionCookie, "content-type": "application/json" },
        ...(method === "POST"
          ? { body: JSON.stringify({ ticketItemIds: [itemId], done: true }) }
          : {}),
      });
      expect(response.status, path).toBe(404);
    }
  });

  it("retires course Fire and still requires a session for waiter group Fire", async () => {
    const f = await tillApp();
    const seated = await seat(f.v, await f.v.table("Inside"));
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const before = await inTx(f.v, (tx) =>
      tx.select({ id: ticketItems.id, firedAt: ticketItems.firedAt }).from(ticketItems),
    );
    for (const [path, status] of [
      [`/api/orders/${seated.tabId}/courses/${randomUUID()}/fire`, 404],
      [`/api/parties/${seated.partyId}/groups/${randomUUID()}/fire`, 401],
    ] as const) {
      const response = await f.app.request(path, {
        method: "POST",
        headers: { cookie: f.a.cookie },
      });
      expect(response.status).toBe(status);
      if (status === 401)
        expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
    }
    expect(
      await inTx(f.v, (tx) =>
        tx.select({ id: ticketItems.id, firedAt: ticketItems.firedAt }).from(ticketItems),
      ),
    ).toEqual(before);
  });
});

describe("A773 pass board: routes", () => {
  type CardBoard = { board: PassBoard; stations: ScreenSlot[]; zones: ScreenSlot[] | null };

  /** Grill waits; the burger is routed there, so the waiter's Fire leaves it Requested. */
  async function requestedBurger(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
    await inTx(f.v, async (tx) => {
      await routeProductTo(tx, f.v.productId("Burger"), f.grill);
      await setStationsWaitForPass(tx, true, [f.grill]);
    });
    return burgerOrder(f.v);
  }

  async function cards(app: Hono, cookie: string, path: string): Promise<CardBoard> {
    const response = await app.request(path, { headers: { cookie } });
    expect(response.status).toBe(200);
    return (await response.json()) as CardBoard;
  }

  const signIn = async (
    f: Awaited<ReturnType<typeof fixture>>,
    device: { id: string; cookie: string },
  ) => {
    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const session = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: device.id, personId: person!.id, pin: "1234" }),
    );
    return `${device.cookie}; ${SESSION_COOKIE}=${session.token}`;
  };

  it("lists the Requested burger as one To fire card on the pass screen, with its item to release", async () => {
    const f = await fixture();
    const itemId = await requestedBurger(f);
    const read = await cards(f.app, f.a.cookie, "/api/device/pass-board");
    expect(read.board.toFire).toHaveLength(1);
    expect(read.board.toFire[0]!.releaseTicketItemIds).toEqual([itemId]);
    expect(read.board.toFire[0]!.releaseContext).toEqual(expect.any(String));
    expect([...read.board.held, ...read.board.inProgress, ...read.board.ready]).toEqual([]);
    const [screen] = (
      await withTransaction(suite.db, (tx) => VENUE_SERVICE.readDeviceKitchenScreens(tx, f.a.id))
    ).filter((s) => s.kind === "pass");
    expect(read.stations).toEqual(screen!.stations);
    expect(read.zones).toBeNull();
  });

  it("lists the same card on the pass monitor with nothing to release", async () => {
    const f = await fixture();
    const itemId = await requestedBurger(f);
    const monitor = await f.device("Pass monitor", f.kds, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const pass = await cards(f.app, f.a.cookie, "/api/device/pass-board");
    const read = await cards(f.app, monitor.cookie, "/api/device/pass-monitor-board");
    expect(pass.board.toFire[0]!.releaseTicketItemIds).toEqual([itemId]);
    expect(read.board).toEqual({
      ...pass.board,
      toFire: [{ ...pass.board.toFire[0]!, releaseTicketItemIds: [], releaseContext: null }],
    });
  });

  it("refuses a device with no pass screen, and a till's pass with nobody signed in", async () => {
    const f = await fixture();
    await requestedBurger(f);
    const station = await f.device("Grill screen", f.kds, { stationId: f.grill });
    for (const path of ["/api/device/pass-board", "/api/device/pass-monitor-board"]) {
      const refused = await f.app.request(path, { headers: { cookie: station.cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    }
    for (const [kind, path] of [
      ["pass", "/api/device/pass-board"],
      ["pass_monitor", "/api/device/pass-monitor-board"],
    ] as const) {
      const till = await f.device(`Till ${kind}`, f.till, {
        kitchenScreen: { kind, stationIds: null, zoneIds: null },
      });
      const anonymous = await f.app.request(path, { headers: { cookie: till.cookie } });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });
      expect((await cards(f.app, await signIn(f, till), path)).board.toFire).toHaveLength(1);
    }
  });
});

describe("A773 pass display policy", () => {
  type ShownBoard = Board & {
    display: { showNonPassStations: boolean; nonPassStationsOverride: boolean | null };
  };

  /** A burger at Grill and a paella at Cold on one card; Grill waits when `grillWaits`. */
  async function burgerAndPaella(
    f: Awaited<ReturnType<typeof fixture>>,
    grillWaits: boolean,
  ): Promise<{ burger: string; paella: string }> {
    const cold = (await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Cold" }))).id;
    await inTx(f.v, async (tx) => {
      await routeProductTo(tx, f.v.productId("Burger"), f.grill);
      await routeProductTo(tx, f.v.productId("Paella"), cold);
      if (grillWaits) await setStationsWaitForPass(tx, true, [f.grill]);
    });
    const seated = await seat(f.v, await f.v.table("Inside"));
    await orderForParty(f.v, seated.partyId, ["Burger", "Paella"], seated.tabId);
    const rows = await inTx(f.v, (tx) =>
      tx
        .select({ id: ticketItems.id, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, seated.tabId)),
    );
    return {
      burger: rows.find((row) => row.stationId === f.grill)!.id,
      paella: rows.find((row) => row.stationId === cold)!.id,
    };
  }

  const shown = async (f: Awaited<ReturnType<typeof fixture>>, cookie: string, path: string) =>
    (await read(f.app, cookie, path)) as ShownBoard;

  const choose = (deviceId: string, kind: "pass" | "pass_monitor", value: boolean | null) =>
    withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.setDeviceKitchenScreenDisplay(tx, deviceId, kind, value),
    );

  /** The dishes Hide keeps on their cards without drawing them. */
  const hiddenIds = (board: PassBoard) =>
    boardCards(board)
      .flatMap((card) => card.hiddenItems ?? [])
      .map((item) => item.id);

  /** What the setting must never change on a card (B3 D46). */
  const facts = (board: PassBoard) =>
    boardCards(board).map((card) => ({
      key: card.key,
      column: (["held", "toFire", "inProgress", "ready"] as const).find((column) =>
        board[column].includes(card),
      ),
      allReady: card.allReady,
      releaseTicketItemIds: card.releaseTicketItemIds,
      releaseContext: card.releaseContext,
    }));

  it("moves a pass's dimmed dishes to their card's hidden dishes and drops their overview facts when its device hides them, leaving every card's column and release as shown", async () => {
    const f = await fixture();
    const { burger, paella } = await burgerAndPaella(f, true);
    /** The board shown, then hidden, by the device's own choice. */
    const both = async () => {
      await choose(f.a.id, "pass", true);
      const before = await shown(f, f.a.cookie, "/api/device/pass-board");
      await choose(f.a.id, "pass", false);
      return { before, after: await shown(f, f.a.cookie, "/api/device/pass-board") };
    };

    const requestedPair = await both();
    expect(
      boardItems(requestedPair.before.board).map((item) => [item.id, item.informational]),
    ).toEqual(
      expect.arrayContaining([
        [burger, false],
        [paella, true],
      ]),
    );
    expect(requestedPair.before.board.overview.map((fact) => fact.informational)).toContain(true);
    expect(boardItems(requestedPair.after.board).map((item) => item.id)).toEqual([burger]);
    expect(hiddenIds(requestedPair.before.board)).toEqual([]);
    expect(hiddenIds(requestedPair.after.board)).toEqual([paella]);
    expect(requestedPair.after.board.overview.map((fact) => fact.informational)).toEqual([false]);
    expect(facts(requestedPair.after.board)).toEqual(facts(requestedPair.before.board));
    expect(requestedPair.after.display).toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: false,
    });

    await inTx(f.v, (tx) =>
      tx
        .update(deviceProfiles)
        .set({ capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"] })
        .where(eq(deviceProfiles.id, f.kds)),
    );
    const [toFire] = requestedPair.before.board.toFire;
    await inTx(f.v, async (tx) => {
      await releasePassItems(
        tx,
        f.v.cfg,
        { deviceId: f.a.id, personId: null },
        {
          submissionId: randomUUID(),
          target: toFire!.target,
          ticketItemIds: toFire!.releaseTicketItemIds,
          expectedContext: toFire!.releaseContext,
        },
      );
      await advanceTicketItem(tx, f.v.cfg, burger, "preparing");
      await advanceTicketItem(tx, f.v.cfg, burger, "ready");
    });
    const readyPair = await both();
    expect(readyPair.before.board.inProgress).toHaveLength(1);
    expect(readyPair.before.board.inProgress[0]!.allReady).toBe(false);
    expect(boardItems(readyPair.after.board).map((item) => item.id)).toEqual([burger]);
    expect(hiddenIds(readyPair.after.board)).toEqual([paella]);
    expect(facts(readyPair.after.board)).toEqual(facts(readyPair.before.board));
  });

  it("hides nothing in view while no station in view waits", async () => {
    const f = await fixture();
    const { burger, paella } = await burgerAndPaella(f, false);
    await choose(f.a.id, "pass", false);
    const read = await shown(f, f.a.cookie, "/api/device/pass-board");
    expect(items(read).sort()).toEqual([burger, paella].sort());
    expect(hiddenIds(read.board)).toEqual([]);
    expect(boardCards(read.board).length).toBeGreaterThan(0);
    for (const card of boardCards(read.board)) expect(card).not.toHaveProperty("hiddenItems");
    expect(read.display).toEqual({ showNonPassStations: false, nonPassStationsOverride: false });
  });

  it("applies a pass monitor's own choice and still names nothing to release", async () => {
    const f = await fixture();
    const { burger, paella } = await burgerAndPaella(f, true);
    const monitor = await f.device("Pass monitor", f.kds, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    await choose(f.a.id, "pass", false);
    const before = await shown(f, monitor.cookie, "/api/device/pass-monitor-board");
    expect(boardItems(before.board)).toHaveLength(2);
    expect(before.display).toEqual({ showNonPassStations: true, nonPassStationsOverride: null });

    await choose(monitor.id, "pass_monitor", false);
    const after = await shown(f, monitor.cookie, "/api/device/pass-monitor-board");
    expect(boardItems(after.board).map((item) => item.id)).toEqual([burger]);
    expect(hiddenIds(after.board)).toEqual([paella]);
    expect(facts(after.board)).toEqual(facts(before.board));
    for (const card of boardCards(after.board)) {
      expect(card.releaseTicketItemIds).toEqual([]);
      expect(card.releaseContext).toBeNull();
    }
    expect(after.display).toEqual({ showNonPassStations: false, nonPassStationsOverride: false });
  });

  it("hides by the profile's choice when the device's own is cleared", async () => {
    const f = await fixture();
    const { burger, paella } = await burgerAndPaella(f, true);
    await inTx(f.v, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, f.kds, {
        pass: { stationIds: null, zoneIds: null, showNonPassStations: false },
      }),
    );
    await choose(f.a.id, "pass", null);
    const read = await shown(f, f.a.cookie, "/api/device/pass-board");
    expect(boardItems(read.board).map((item) => item.id)).toEqual([burger]);
    expect(hiddenIds(read.board)).toEqual([paella]);
    expect(read.display).toEqual({ showNonPassStations: false, nonPassStationsOverride: null });
  });

  it("answers the device's own choice, and the profile's once the device clears it", async () => {
    const f = await fixture();
    await choose(f.a.id, "pass", true);
    expect((await shown(f, f.a.cookie, "/api/device/pass-board")).display).toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: true,
    });
    await choose(f.a.id, "pass", null);
    expect((await shown(f, f.a.cookie, "/api/device/pass-board")).display).toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: null,
    });
  });
});

describe("A773 pass display policy: the device's own route", () => {
  const put = (app: Hono, cookie: string | null, body: unknown) =>
    app.request("/api/device/kitchen-screen-display", {
      method: "PUT",
      headers: { ...(cookie === null ? {} : { cookie }), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  /** Every device's kitchen-screen rows, their stations and zones, and the narrowings' removals. */
  const stored = async () => {
    const rows = async (query: ReturnType<typeof sql>) =>
      (await suite.db.execute<Record<string, unknown>>(query)).rows;
    return {
      screens: await rows(
        sql`select device_id, screen, every_station, every_zone, show_non_pass_stations from device_kitchen_screens order by device_id, screen`,
      ),
      stations: await rows(
        sql`select device_id, screen, station_id from device_kitchen_screen_stations order by device_id, screen, station_id`,
      ),
      zones: await rows(
        sql`select device_id, screen, zone_id from device_kitchen_screen_zones order by device_id, screen, zone_id`,
      ),
      removals: await rows(
        sql`select id, device_id, screen, station_id, zone_id from device_kitchen_screen_removals order by id`,
      ),
    };
  };

  const valueOf = async (deviceId: string) =>
    (
      await suite.db.execute<{ screen: string; value: number | null }>(
        sql`select screen, show_non_pass_stations as value from device_kitchen_screens where device_id = ${deviceId}`,
      )
    ).rows.map((row) => [row.screen, row.value === null ? null : Boolean(row.value)]);

  async function refused(
    send: () => Response | Promise<Response>,
    status: number,
    error: Record<string, unknown>,
  ) {
    const before = await stored();
    const answer = await send();
    expect({ status: answer.status, body: await answer.json() }).toEqual({
      status,
      body: { error },
    });
    expect(await stored()).toEqual(before);
  }

  const display = async (f: Awaited<ReturnType<typeof fixture>>, cookie: string, path: string) =>
    ((await read(f.app, cookie, path)) as Board & { display: unknown }).display;

  it("sets and clears a kitchen display's own choice, read back on its next board, touching no other device and no narrowing's removal", async () => {
    const f = await fixture();
    const cold = (await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Cold" }))).id;
    await suite.db.execute(
      sql`insert into device_kitchen_screen_removals (id, device_id, screen, station_id, removed_at) values (${randomUUID()}, ${f.a.id}, 'pass', ${cold}, ${new Date().toISOString()})`,
    );
    const before = await stored();

    expect(
      (await put(f.app, f.a.cookie, { kind: "pass", showNonPassStations: false })).status,
    ).toBe(204);
    expect(await display(f, f.a.cookie, "/api/device/pass-board")).toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: false,
    });
    expect(await valueOf(f.a.id)).toEqual([["pass", false]]);
    expect(await valueOf(f.b.id)).toEqual([["pass", null]]);

    expect((await put(f.app, f.a.cookie, { kind: "pass", showNonPassStations: true })).status).toBe(
      204,
    );
    expect(await valueOf(f.a.id)).toEqual([["pass", true]]);
    expect((await put(f.app, f.a.cookie, { kind: "pass", showNonPassStations: null })).status).toBe(
      204,
    );
    expect(await display(f, f.a.cookie, "/api/device/pass-board")).toEqual({
      showNonPassStations: true,
      nonPassStationsOverride: null,
    });
    expect(await stored()).toEqual(before);
  });

  it("sets a pass monitor's own choice", async () => {
    const f = await fixture();
    const monitor = await f.device("Pass monitor", f.kds, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const answer = await put(f.app, monitor.cookie, {
      kind: "pass_monitor",
      showNonPassStations: false,
    });
    expect(answer.status).toBe(204);
    expect(await display(f, monitor.cookie, "/api/device/pass-monitor-board")).toEqual({
      showNonPassStations: false,
      nonPassStationsOverride: false,
    });
  });

  it("succeeds on a profile without prepare-orders: choosing what the pass shows is no cooking action", async () => {
    const f = await fixture();
    await inTx(f.v, (tx) =>
      tx
        .update(deviceProfiles)
        .set({ capabilities: ["act-as-kds", "run-the-pass"] })
        .where(eq(deviceProfiles.id, f.kds)),
    );
    expect(
      (await put(f.app, f.a.cookie, { kind: "pass", showNonPassStations: false })).status,
    ).toBe(204);
    expect(await valueOf(f.a.id)).toEqual([["pass", false]]);
  });

  it("on a till, refuses with nobody signed in and sets it for the person signed in", async () => {
    const f = await fixture();
    const till = await f.device("Till pass", f.till, { kitchenScreen: EVERY_PASS });
    await refused(
      () => put(f.app, till.cookie, { kind: "pass", showNonPassStations: false }),
      401,
      {
        code: "session.required",
        params: {},
      },
    );
    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const { token } = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: till.id, personId: person!.id, pin: "1234" }),
    );
    const signedIn = `${till.cookie}; ${SESSION_COOKIE}=${token}`;
    expect((await put(f.app, signedIn, { kind: "pass", showNonPassStations: false })).status).toBe(
      204,
    );
    expect(await valueOf(till.id)).toEqual([["pass", false]]);
  });

  it("refuses a till with no pass screen and nobody signed in device.unauthorized, as its board read does", async () => {
    const f = await fixture();
    const till = await f.device("Till", f.till, {});
    const board = await f.app.request("/api/device/pass-board", {
      headers: { cookie: till.cookie },
    });
    expect({ status: board.status, body: await board.json() }).toEqual({
      status: 401,
      body: { error: { code: "device.unauthorized", params: {} } },
    });
    await refused(
      () => put(f.app, till.cookie, { kind: "pass", showNonPassStations: false }),
      401,
      { code: "device.unauthorized", params: {} },
    );
  });

  it("refuses a device without a screen of the kind it names device.unauthorized", async () => {
    const f = await fixture();
    const station = await f.device("Grill screen", f.kds, { stationId: f.grill });
    await refused(
      () => put(f.app, f.a.cookie, { kind: "pass_monitor", showNonPassStations: false }),
      401,
      {
        code: "device.unauthorized",
        params: {},
      },
    );
    await refused(
      () => put(f.app, station.cookie, { kind: "pass", showNonPassStations: false }),
      401,
      {
        code: "device.unauthorized",
        params: {},
      },
    );
  });

  it("refuses without device proof, and a device disabled or deleted, as the release route does", async () => {
    const f = await fixture();
    const ask = { kind: "pass", showNonPassStations: false };
    await refused(() => put(f.app, null, ask), 401, { code: "device.unauthorized", params: {} });
    await refused(() => put(f.app, `${f.a.cookie}x`, ask), 401, {
      code: "device.unauthorized",
      params: {},
    });
    await inTx(f.v, (tx) => disableDevice(tx, f.a.id));
    await refused(() => put(f.app, f.a.cookie, ask), 401, {
      code: "device.unauthorized",
      params: {},
    });
    await inTx(f.v, (tx) => deleteDevice(tx, f.v.cfg, f.b.id));
    await refused(() => put(f.app, f.b.cookie, ask), 401, {
      code: "device.unauthorized",
      params: {},
    });
  });

  it("refuses a display disabled after its proof was checked, writing nothing", async () => {
    const f = await fixture();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let send!: () => void;
    const sent = new Promise<void>((resolve) => {
      send = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          reading();
          await sent;
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ kind: "pass", showNonPassStations: false })),
          );
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    await refused(
      async () => {
        const answer = Promise.resolve(
          f.app.request("/api/device/kitchen-screen-display", {
            method: "PUT",
            headers: { cookie: f.a.cookie, "content-type": "application/json" },
            body,
            duplex: "half",
          } as RequestInit),
        );
        const first = await Promise.race([
          started.then(() => "reading"),
          answer.then(() => "answered"),
        ]);
        expect(first, "the route answered before reading the body").toBe("reading");
        await inTx(f.v, (tx) =>
          tx.update(devices).set({ active: false }).where(eq(devices.id, f.a.id)),
        );
        send();
        return answer;
      },
      401,
      { code: "device.unauthorized", params: {} },
    );
  });

  it("refuses a station kind, an unknown kind and a value of another type, writing nothing", async () => {
    const f = await fixture();
    const station = await f.device("Grill screen", f.kds, { stationId: f.grill });
    for (const [cookie, body, field] of [
      [station.cookie, { kind: "station", showNonPassStations: false }, "kind"],
      [f.a.cookie, { kind: "elsewhere", showNonPassStations: false }, "kind"],
      [f.a.cookie, { showNonPassStations: false }, "kind"],
      [f.a.cookie, { kind: "pass", showNonPassStations: "no" }, "showNonPassStations"],
      [f.a.cookie, { kind: "pass" }, "showNonPassStations"],
      [f.a.cookie, [], "kind"],
    ] as const)
      await refused(() => put(f.app, cookie, body), 400, {
        code: "management.request_invalid",
        params: { field },
      });
  });
});

describe("A773 the old pass reads are gone", () => {
  it.each([
    ["pass", "/api/device/pass-screen", "/api/device/pass-board"],
    ["pass_monitor", "/api/device/pass-monitor", "/api/device/pass-monitor-board"],
  ] as const)(
    "a %s device's GET %s answers 404, while its board shows the order",
    async (kind, path, boardPath) => {
      const f = await fixture();
      const itemId = await burgerOrder(f.v);
      const display = await f.device(`Old ${kind}`, f.kds, {
        kitchenScreen: { kind, stationIds: null, zoneIds: null },
      });
      const answer = await f.app.request(path, { headers: { cookie: display.cookie } });
      expect(answer.status).toBe(404);
      expect(await answer.text()).toBe("404 Not Found");
      expect(items(await read(f.app, display.cookie, boardPath))).toEqual([itemId]);
    },
  );

  it("keeps the release route that shares the old read's path", async () => {
    const f = await fixture();
    const answer = await f.app.request("/api/device/pass-screen/release", {
      method: "POST",
      headers: { cookie: f.a.cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(answer.status).not.toBe(404);
    // The fixture's profile carries no prepare-orders, so the live route refuses it.
    expect(await answer.json()).toMatchObject({ error: { code: "device.forbidden_action" } });
  });
});

describe("A773 pass release: route", () => {
  type CardBoard = { board: PassBoard };
  const FULL = ["act-as-kds", "prepare-orders", "run-the-pass"];

  /** Grill waits and prints to its own printer; a manager's session on the management API. */
  async function releaseFixture(deps: { attendance?: boolean } = {}) {
    const f = await fixture();
    const printerId = await inTx(f.v, async (tx) => {
      await routeProductTo(tx, f.v.productId("Burger"), f.grill);
      await setStationsWaitForPass(tx, true, [f.grill]);
      const printer = await createPrinter(tx, {
        name: "Grill paper",
        transport: "cloud_poll",
        pollId: randomUUID(),
      });
      await attachPrinterToStation(tx, {
        stationId: f.grill,
        printerId: printer.id,
      });
      return printer.id;
    });
    const app = new Hono();
    mountDeviceApi(
      app,
      {
        db: suite.db,
        cfg: f.v.cfg,
        secureCookies: false,
        pairingMode: createPairingMode(),
        ...(deps.attendance === true
          ? { attendance: recordAttendanceFact, attendanceClock: f.v.clock }
          : {}),
      },
      log,
    );
    const management = new Hono();
    mountManagementApi(
      management,
      {
        db: suite.db,
        cfg: { nodeId: f.v.cfg.nodeId },
        venueCfg: f.v.cfg,
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
        credentialKeyRing: TOTP_KEY_RING,
      },
      log,
    );
    const signedIn = await management.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
    });
    expect(signedIn.status).toBe(200);
    const manager = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    /** A kitchen-display profile saved through the management route. */
    const savedProfile = async (capabilities: string[]) => {
      const created = await management.request("/management-api/device-profiles", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: manager },
        body: JSON.stringify({ name: `Pass ${randomUUID()}`, formFactor: "kds", capabilities }),
      });
      expect(created.status).toBe(201);
      return ((await created.json()) as { id: string }).id;
    };
    const jobs = async () =>
      (
        await inTx(f.v, (tx) =>
          tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, printerId)),
        )
      ).length;
    return { ...f, app, printerId, savedProfile, jobs };
  }

  type ReleaseFixture = Awaited<ReturnType<typeof releaseFixture>>;

  /** A fresh party's Requested burgers, sent as one Fire now group. */
  async function requested(f: ReleaseFixture, burgers = 1) {
    const seated = await seat(f.v, await f.v.table(`Inside ${randomUUID()}`));
    await orderForParty(f.v, seated.partyId, Array<string>(burgers).fill("Burger"), seated.tabId);
    return seated;
  }

  async function card(app: Hono, cookie: string) {
    const response = await app.request("/api/device/pass-board", { headers: { cookie } });
    expect(response.status).toBe(200);
    return ((await response.json()) as CardBoard).board.toFire;
  }

  const askOf = (toFire: PassBoard["toFire"][number]) => ({
    submissionId: randomUUID(),
    target: toFire.target,
    ticketItemIds: toFire.releaseTicketItemIds,
    expectedContext: toFire.releaseContext,
  });

  const release = (app: Hono, cookie: string, body: unknown) =>
    app.request("/api/device/pass-screen/release", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  async function refused(
    f: ReleaseFixture,
    send: () => Response | Promise<Response>,
    status: number,
    error: Record<string, unknown>,
  ) {
    const before = await inTx(f.v, (tx) => tx.select().from(ticketItems));
    const jobs = await f.jobs();
    const answer = await send();
    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status,
      body: { error },
    });
    expect(await inTx(f.v, (tx) => tx.select().from(ticketItems))).toEqual(before);
    expect(await f.jobs()).toBe(jobs);
  }

  const kdsOn = async (f: ReleaseFixture, profileId: string, name = "Pass display") =>
    f.device(name, profileId, { kitchenScreen: EVERY_PASS });

  it("releases a card's burger from a kitchen display whose profile the management route saved", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    await requested(f);
    const [toFire] = await card(f.app, display.cookie);
    const answer = await release(f.app, display.cookie, askOf(toFire!));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ releasedTicketItemIds: toFire!.releaseTicketItemIds });
    expect(await f.jobs()).toBe(1);
  });

  it("refuses a profile without prepare-orders or run-the-pass, and a device with no pass screen", async () => {
    const f = await releaseFixture();
    await requested(f);
    const full = await kdsOn(f, await f.savedProfile(FULL), "Full pass");
    const ask = askOf((await card(f.app, full.cookie))[0]!);
    for (const [capabilities, action] of [
      [["act-as-kds", "run-the-pass"], "prepare-orders"],
      [["act-as-kds", "prepare-orders"], "run-the-pass"],
    ] as const) {
      const display = await kdsOn(f, await f.savedProfile([...capabilities]), `No ${action}`);
      await refused(f, () => release(f.app, display.cookie, ask), 403, {
        code: "device.forbidden_action",
        params: { action },
      });
    }
    const station = await f.device("Grill screen", await f.savedProfile(FULL), {
      stationId: f.grill,
    });
    await refused(f, () => release(f.app, station.cookie, ask), 401, {
      code: "device.unauthorized",
    });
  });

  it("releases from a till pass only for the person signed in on it, recording their kitchen work, and refuses another person's or an out-of-zone retry", async () => {
    const f = await releaseFixture({ attendance: true });
    const [profile] = await inTx(f.v, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: "Till pass profile", formFactor: "till", capabilities: FULL })
        .returning({ id: deviceProfiles.id }),
    );
    const till = await f.device("Till pass", profile!.id, { kitchenScreen: EVERY_PASS });
    const other = await f.device("Other till", profile!.id, { kitchenScreen: EVERY_PASS });
    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const tokenOn = async (deviceId: string) =>
      (await inTx(f.v, (tx) => loginWithPin(tx, { deviceId, personId: person!.id, pin: "1234" })))
        .token;
    const signedIn = `${till.cookie}; ${SESSION_COOKIE}=${await tokenOn(till.id)}`;
    const seated = await requested(f);
    const ask = askOf((await card(f.app, signedIn))[0]!);

    await refused(f, () => release(f.app, till.cookie, ask), 401, { code: "session.required" });
    const elsewhere = `${till.cookie}; ${SESSION_COOKIE}=${await tokenOn(other.id)}`;
    await refused(f, () => release(f.app, elsewhere, ask), 401, { code: "device.unauthorized" });

    const answer = await release(f.app, signedIn, ask);
    expect(answer.status).toBe(200);
    const facts = (await inTx(f.v, (tx) => tx.select().from(attendanceOperationFacts))).filter(
      (fact) => fact.key.endsWith(`:${ask.submissionId}`),
    );
    expect(facts.map((fact) => [fact.key, fact.personId, fact.kind, fact.outcome])).toEqual([
      [`service:${seated.tabId}:${ask.submissionId}`, person!.id, "order", "qualifying"],
    ]);

    const [cook] = await inTx(f.v, (tx) =>
      tx
        .insert(persons)
        .values({ displayName: "Second cook", pinHash: fixturePinHash("2468"), role: "staff" })
        .returning({ id: persons.id }),
    );
    const cookToken = (
      await inTx(f.v, (tx) =>
        loginWithPin(tx, { deviceId: till.id, personId: cook!.id, pin: "2468" }),
      )
    ).token;
    await refused(
      f,
      () => release(f.app, `${till.cookie}; ${SESSION_COOKIE}=${cookToken}`, ask),
      409,
      { code: "submission.id_reused", params: { submissionId: ask.submissionId } },
    );

    await inTx(f.v, async (tx) => {
      const deli = await createDepartment(tx, f.v.cfg, { name: "Deli", orderStart: "counter" });
      const zone = await createServiceZone(tx, f.v.cfg, {
        name: "Deli counter",
        departmentId: deli.id,
      });
      await setProfileServiceAccess(tx, profile!.id, {
        departmentId: deli.id,
        allowedZoneIds: null,
        startingZoneId: zone.id,
      });
    });
    const again = `${till.cookie}; ${SESSION_COOKIE}=${await tokenOn(till.id)}`;
    await refused(f, () => release(f.app, again, ask), 403, {
      code: "service_zone.not_allowed",
    });
  });

  it("answers a retry with its first result, even after the burger is served, and refuses a changed one", async () => {
    const f = await releaseFixture();
    const profileId = await f.savedProfile(FULL);
    const display = await kdsOn(f, profileId);
    const seated = await requested(f);
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const [first, second] = await card(f.app, display.cookie);
    const ask = askOf(first!);
    const answers = [];
    for (let i = 0; i < 2; i++) {
      const answer = await release(f.app, display.cookie, ask);
      answers.push({ status: answer.status, body: await answer.json() });
    }
    const released = { status: 200, body: { releasedTicketItemIds: ask.ticketItemIds } };
    expect(answers).toEqual([released, released]);
    expect(await f.jobs()).toBe(1);

    const [line] = await inTx(f.v, (tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.id, ask.ticketItemIds[0]!)),
    );
    const command = await commandFor(f.v, seated.partyId);
    await inTx(f.v, (tx) =>
      markServed(tx, f.v.cfg, seated.partyId, [{ lineId: line!.lineId, quantity: "1" }], {
        ...command,
        submissionId: randomUUID(),
      }),
    );
    const again = await release(f.app, display.cookie, ask);
    expect({ status: again.status, body: await again.json() }).toEqual(released);
    expect(await f.jobs()).toBe(1);

    const otherDisplay = await kdsOn(f, profileId, "Another pass");
    for (const [cookie, body] of [
      [display.cookie, { ...ask, ticketItemIds: second!.releaseTicketItemIds }],
      [display.cookie, { ...ask, target: second!.target }],
      [display.cookie, { ...ask, expectedContext: "1".repeat(64) }],
      [otherDisplay.cookie, ask],
    ] as const)
      await refused(f, () => release(f.app, cookie, body), 409, {
        code: "submission.id_reused",
        params: { submissionId: ask.submissionId },
      });

    await inTx(f.v, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, profileId, {
        station: { stationIds: null, zoneIds: null },
      }),
    );
    await refused(f, () => release(f.app, display.cookie, ask), 401, {
      code: "device.unauthorized",
    });
  });

  it("releases ids sent in any order, and answers their retry in the card's order with the first result", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    await requested(f, 2);
    const [toFire] = await card(f.app, display.cookie);
    const ask = askOf(toFire!);
    expect(ask.ticketItemIds).toHaveLength(2);
    expect(ask.ticketItemIds).toEqual([...ask.ticketItemIds].sort());
    const released = { status: 200, body: { releasedTicketItemIds: ask.ticketItemIds } };
    for (const ticketItemIds of [[...ask.ticketItemIds].reverse(), ask.ticketItemIds]) {
      const answer = await release(f.app, display.cookie, { ...ask, ticketItemIds });
      expect({ status: answer.status, body: await answer.json() }).toEqual(released);
    }
    expect(await f.jobs()).toBe(1);
  });

  it("refuses a card read before a partial serve as changed", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    const seated = await requested(f, 2);
    const [toFire] = await card(f.app, display.cookie);
    const ask = askOf(toFire!);
    const [line] = await inTx(f.v, (tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.id, ask.ticketItemIds[0]!)),
    );
    const command = await commandFor(f.v, seated.partyId);
    await inTx(f.v, (tx) =>
      markServed(tx, f.v.cfg, seated.partyId, [{ lineId: line!.lineId, quantity: "1" }], {
        ...command,
        submissionId: randomUUID(),
      }),
    );
    await refused(f, () => release(f.app, display.cookie, ask), 409, {
      code: "ticket.pass_context_changed",
    });
  });

  it("refuses a new release of a party merged into another, and replays one completed before the merge", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    const seated = await requested(f);
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const [first, second] = await card(f.app, display.cookie);
    const done = askOf(first!);
    const released = { status: 200, body: { releasedTicketItemIds: done.ticketItemIds } };
    const answer = await release(f.app, display.cookie, done);
    expect({ status: answer.status, body: await answer.json() }).toEqual(released);
    expect(await f.jobs()).toBe(1);

    const other = await seat(f.v, await f.v.table(`Other ${randomUUID()}`));
    await inTx(f.v, (tx) =>
      combineParties(tx, f.v.cfg, {
        from: seated.partyId,
        into: other.partyId,
        tables: "join",
        operatorId: OPERATOR,
      }),
    );

    await refused(f, () => release(f.app, display.cookie, askOf(second!)), 409, {
      code: "party.not_open",
    });
    const before = await inTx(f.v, (tx) => tx.select().from(ticketItems));
    const again = await release(f.app, display.cookie, done);
    expect({ status: again.status, body: await again.json() }).toEqual(released);
    expect(await inTx(f.v, (tx) => tx.select().from(ticketItems))).toEqual(before);
    expect(await f.jobs()).toBe(1);
  });

  it("refuses an empty id list as a malformed request", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    await requested(f);
    const [toFire] = await card(f.app, display.cookie);
    await refused(
      f,
      () => release(f.app, display.cookie, { ...askOf(toFire!), ticketItemIds: [] }),
      400,
      {
        code: "management.request_invalid",
        params: { field: "ticketItemIds" },
      },
    );
  });

  /**
   * Sends the release with a body held back until `between` has committed: the route has passed
   * its checks before the transaction once it starts reading the body.
   */
  async function releaseAfter(
    f: ReleaseFixture,
    cookie: string,
    body: unknown,
    between: () => Promise<unknown>,
  ): Promise<Response> {
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let send!: () => void;
    const sent = new Promise<void>((resolve) => {
      send = resolve;
    });
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          reading();
          await sent;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const answer = Promise.resolve(
      f.app.request("/api/device/pass-screen/release", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    const first = await Promise.race([
      started.then(() => "reading"),
      answer.then(() => "answered"),
    ]);
    expect(first, "the route answered before reading the body").toBe("reading");
    await between();
    send();
    return answer;
  }

  it("refuses a display revoked after its proof was checked, writing nothing", async () => {
    const f = await releaseFixture();
    const display = await kdsOn(f, await f.savedProfile(FULL));
    await requested(f);
    const ask = askOf((await card(f.app, display.cookie))[0]!);
    await refused(
      f,
      () =>
        releaseAfter(f, display.cookie, ask, () =>
          inTx(f.v, (tx) =>
            tx.update(devices).set({ active: false }).where(eq(devices.id, display.id)),
          ),
        ),
      401,
      { code: "device.unauthorized" },
    );
  });

  it("refuses a till pass signed out after its session was checked, writing nothing", async () => {
    const f = await releaseFixture();
    const [profile] = await inTx(f.v, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: "Till pass profile", formFactor: "till", capabilities: FULL })
        .returning({ id: deviceProfiles.id }),
    );
    const till = await f.device("Till pass", profile!.id, { kitchenScreen: EVERY_PASS });
    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const { token } = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: till.id, personId: person!.id, pin: "1234" }),
    );
    const signedIn = `${till.cookie}; ${SESSION_COOKIE}=${token}`;
    await requested(f);
    const ask = askOf((await card(f.app, signedIn))[0]!);
    await refused(
      f,
      () => releaseAfter(f, signedIn, ask, () => inTx(f.v, (tx) => endSession(tx, token))),
      401,
      { code: "session.required" },
    );
  });
});
