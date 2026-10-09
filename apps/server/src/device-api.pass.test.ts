import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  kitchenStations,
  locations,
  passItemMarks,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin, persons } from "@waitron/identity";
import type { DeviceKitchenScreen } from "@waitron/module";
import { mountDeviceApi } from "./device-api.js";
import { mountTillApi } from "./till-api.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { VENUE_SERVICE } from "./modules.js";
import { createStation } from "./kitchen.js";
import { inTx, orderForParty, seat, setupPartyVenue } from "./testing/party-venue.js";

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

type Board = {
  orders: { groups: { items: { id: string }[] }[]; courses: { items: { id: string }[] }[] }[];
  stations: { id: string; name: string; available: boolean }[];
  zones: { id: string; name: string; available: boolean }[] | null;
};

function items(board: Board): string[] {
  return board.orders.flatMap((order) =>
    [...order.groups, ...order.courses].flatMap((part) => part.items.map((item) => item.id)),
  );
}

const done = (app: Hono, cookie: string, body: unknown) =>
  app.request("/api/device/pass-screen/done", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function read(app: Hono, cookie: string, path = "/api/device/pass-screen") {
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
  it("answers a device with no pass screen device.unauthorized, and a pass screen's read names its stations", async () => {
    const f = await fixture();
    const station = await f.device("Grill screen", f.kds, { stationId: f.grill });
    for (const path of ["/api/device/pass-screen", "/api/device/pass-monitor"]) {
      const refused = await f.app.request(path, { headers: { cookie: station.cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    }
    const refusedDone = await done(f.app, station.cookie, { ticketItemIds: [f.a.id], done: true });
    expect(refusedDone.status).toBe(401);
    expect(await refusedDone.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    const monitorOnPass = await f.app.request("/api/device/pass-monitor", {
      headers: { cookie: f.a.cookie },
    });
    expect(monitorOnPass.status).toBe(401);

    const board = await read(f.app, f.a.cookie);
    const [screen] = (
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.readDeviceKitchenScreens(tx, f.v.cfg, f.a.id),
      )
    ).filter((s) => s.kind === "pass");
    expect(board).toEqual({ orders: [], stations: screen!.stations, zones: null });
    expect(board.stations.map((s) => s.id)).toContain(f.grill);
  });

  it("keeps Done per device: a kitchen display's mark records no person, and its undo restores only its own board", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
    const marked = await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true });
    expect(marked.status).toBe(204);
    expect(items(await read(f.app, f.a.cookie))).toEqual([]);
    expect(items(await read(f.app, f.b.cookie))).toEqual([itemId]);
    expect(
      await inTx(f.v, (tx) =>
        tx.select().from(passItemMarks).where(eq(passItemMarks.ticketItemId, itemId)),
      ),
    ).toMatchObject([{ deviceId: f.a.id, doneByPersonId: null }]);
    expect((await done(f.app, f.b.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      204,
    );
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: false })).status).toBe(
      204,
    );
    expect(items(await read(f.app, f.a.cookie))).toEqual([itemId]);
    expect(items(await read(f.app, f.b.cookie))).toEqual([]);
  });

  it("on a till, needs a signed-in session to read or mark, and the mark records the person", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const till = await f.device("Caja", f.till, { kitchenScreen: EVERY_PASS });
    const anonymousRead = await f.app.request("/api/device/pass-screen", {
      headers: { cookie: till.cookie },
    });
    expect(anonymousRead.status).toBe(401);
    expect(await anonymousRead.json()).toMatchObject({ error: { code: "session.required" } });
    const anonymous = await done(f.app, till.cookie, { ticketItemIds: [itemId], done: true });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });
    expect(await inTx(f.v, (tx) => tx.select().from(passItemMarks))).toEqual([]);

    const [person] = await inTx(f.v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
    const session = await inTx(f.v, (tx) =>
      loginWithPin(tx, { deviceId: till.id, personId: person!.id, pin: "1234" }),
    );
    const signedIn = `${till.cookie}; ${SESSION_COOKIE}=${session.token}`;
    expect(items(await read(f.app, signedIn))).toEqual([itemId]);
    expect((await done(f.app, signedIn, { ticketItemIds: [itemId], done: true })).status).toBe(204);
    expect(
      await inTx(f.v, (tx) =>
        tx.select().from(passItemMarks).where(eq(passItemMarks.deviceId, till.id)),
      ),
    ).toMatchObject([{ ticketItemId: itemId, doneByPersonId: person!.id }]);
    expect(items(await read(f.app, signedIn))).toEqual([]);
  });

  it("refuses Done on a dish outside the device's stations or zones, as its read leaves it out", async () => {
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
        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "ticketItemIds" } },
        });
      }
    }
    expect(await inTx(f.v, (tx) => tx.select().from(passItemMarks))).toEqual([]);
    expect(items(await read(f.app, tablesOnly.cookie))).toEqual([itemId]);
    expect(
      (await done(f.app, tablesOnly.cookie, { ticketItemIds: [itemId], done: true })).status,
    ).toBe(204);
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
    expect(items(await read(f.app, monitor.cookie, "/api/device/pass-monitor"))).toEqual([itemId]);
    await inTx(f.v, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, f.v.cfg, narrowed[0]!.id, {
        station: { stationIds: null, zoneIds: null },
      }),
    );
    for (const [cookie, path] of [
      [pass.cookie, "/api/device/pass-screen"],
      [monitor.cookie, "/api/device/pass-monitor"],
    ] as const) {
      const refused = await f.app.request(path, { headers: { cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    }
    const refusedDone = await done(f.app, pass.cookie, { ticketItemIds: [itemId], done: true });
    expect(refusedDone.status).toBe(401);
    expect(await refusedDone.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    expect(await inTx(f.v, (tx) => tx.select().from(passItemMarks))).toEqual([]);
    const screens = await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readDeviceKitchenScreens(tx, f.v.cfg, pass.id),
    );
    expect(screens).toEqual([{ kind: "pass", available: false, stations: [], zones: null }]);
  });

  it("refuses malformed Done, and foreign items atomically when Done also names a local item", async () => {
    const f = await fixture();
    const local = await burgerOrder(f.v);
    const badDone = await done(f.app, f.a.cookie, { ticketItemIds: [local], done: "true" });
    expect(badDone.status).toBe(400);
    expect(await badDone.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "done" } },
    });
    for (const ticketItemIds of [[], ["not-a-uuid"], Array(201).fill(local)]) {
      const response = await done(f.app, f.a.cookie, { ticketItemIds, done: true });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "ticketItemIds" } },
      });
    }
    const [foreignLocation] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
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
    const marks = () =>
      inTx(f.v, (tx) =>
        tx
          .select({ ticketItemId: passItemMarks.ticketItemId })
          .from(passItemMarks)
          .where(eq(passItemMarks.deviceId, f.a.id)),
      );
    const mixed = await done(f.app, f.a.cookie, {
      ticketItemIds: [local, foreignItem!.id],
      done: true,
    });
    expect(mixed.status).toBe(400);
    expect(await mixed.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "ticketItemIds" } },
    });
    expect(await marks()).toEqual([]);
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [local], done: true })).status).toBe(
      204,
    );
    const mixedUndo = await done(f.app, f.a.cookie, {
      ticketItemIds: [local, foreignItem!.id],
      done: false,
    });
    expect(mixedUndo.status).toBe(400);
    expect(await marks()).toEqual([{ ticketItemId: local }]);
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [local], done: false })).status).toBe(
      204,
    );
    expect(await marks()).toEqual([]);
  });
});

describe("the pass monitor's device route", () => {
  it("lists the pass queue with no marks, and offers no Done", async () => {
    const f = await fixture();
    const itemId = await burgerOrder(f.v);
    const monitor = await f.device("Monitor Pase", f.kds, {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const board = await read(f.app, monitor.cookie, "/api/device/pass-monitor");
    expect(items(board)).toEqual([itemId]);
    expect(board.stations.map((s) => s.id)).toContain(f.grill);
    expect(board.zones).toBeNull();
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      204,
    );
    expect(items(await read(f.app, monitor.cookie, "/api/device/pass-monitor"))).toEqual([itemId]);
    const monitorDone = await done(f.app, monitor.cookie, { ticketItemIds: [itemId], done: true });
    expect(monitorDone.status).toBe(401);
    expect(await monitorDone.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    const passOnMonitor = await f.app.request("/api/device/pass-screen", {
      headers: { cookie: monitor.cookie },
    });
    expect(passOnMonitor.status).toBe(401);
  });
});

describe("a pass monitor on a till", () => {
  it("needs a signed-in session, then lists its zones' dishes with no marks", async () => {
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
    const tables = await monitorOn("Caja Mesas", f.v.tables.zoneId);
    const counter = await monitorOn("Caja Barra", f.v.counter.zoneId);

    const anonymous = await f.app.request("/api/device/pass-monitor", {
      headers: { cookie: tables.cookie },
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });

    const board = await read(f.app, tables.signedIn, "/api/device/pass-monitor");
    expect(items(board)).toEqual([itemId]);
    expect(board.zones?.map((zone) => zone.id)).toEqual([f.v.tables.zoneId]);
    expect(items(await read(f.app, counter.signedIn, "/api/device/pass-monitor"))).toEqual([]);
    expect((await done(f.app, f.a.cookie, { ticketItemIds: [itemId], done: true })).status).toBe(
      204,
    );
    expect(items(await read(f.app, tables.signedIn, "/api/device/pass-monitor"))).toEqual([itemId]);
  });
});

describe("the till's watcher routes", () => {
  async function tillApp() {
    const f = await fixture();
    mountTillApi(
      f.app,
      {
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

  it("refuses course and group Fire with only a pass screen's device cookie", async () => {
    const f = await tillApp();
    const seated = await seat(f.v, await f.v.table("Inside"));
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const before = await inTx(f.v, (tx) =>
      tx.select({ id: ticketItems.id, firedAt: ticketItems.firedAt }).from(ticketItems),
    );
    for (const path of [
      `/api/orders/${seated.tabId}/courses/${randomUUID()}/fire`,
      `/api/parties/${seated.partyId}/groups/${randomUUID()}/fire`,
    ]) {
      const response = await f.app.request(path, {
        method: "POST",
        headers: { cookie: f.a.cookie },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
    }
    expect(
      await inTx(f.v, (tx) =>
        tx.select({ id: ticketItems.id, firedAt: ticketItems.firedAt }).from(ticketItems),
      ),
    ).toEqual(before);
  });
});
