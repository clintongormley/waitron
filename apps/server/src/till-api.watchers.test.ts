import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  kitchenStations,
  locations,
  ticketItems,
  tills,
  watcherItemMarks,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin, persons } from "@waitron/identity";
import { createWatcher, removeWatcher } from "./watchers.js";
import { createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { inTx, orderForParty, seat, setupPartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const log = () => {};

async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const sessionDeviceId = await seedSessionDevice(suite.db, v.cfg);
  const [person] = await inTx(v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
  const session = await inTx(v, (tx) =>
    loginWithPin(tx, { deviceId: sessionDeviceId, personId: person!.id, pin: "1234" }),
  );
  const [profile] = await inTx(v, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({ name: "KDS", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id }),
  );
  const pass = await inTx(v, (tx) =>
    createWatcher(tx, v.cfg, {
      name: "Pass",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
      displayOrder: 2,
    }),
  );
  const runner = await inTx(v, (tx) =>
    createWatcher(tx, v.cfg, {
      name: "Runner",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: false,
      displayOrder: 1,
    }),
  );
  const device = async (name: string, watcherId: string) => {
    const joined = await enrolDeviceForTest(suite.db, v.cfg, {
      name,
      profileId: profile!.id,
      watcherId,
    });
    return { id: joined.deviceId, cookie: `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}` };
  };
  const a = await device("Pass A", pass.id);
  const b = await device("Pass B", pass.id);
  const c = await device("Runner", runner.id);
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es-ES",
    },
    log,
  );
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    log,
  );
  const sessionCookie = `${SESSION_COOKIE}=${session.token}`;
  return { v, app, person, profileId: profile!.id, pass, runner, a, b, c, sessionCookie };
}

function items(board: {
  orders: { groups: { items: { id: string }[] }[]; courses: { items: { id: string }[] }[] }[];
}): string[] {
  return board.orders.flatMap((order) =>
    [...order.groups, ...order.courses].flatMap((part) => part.items.map((item) => item.id)),
  );
}

describe("watcher routes", () => {
  it("reports watcher bindings to the screen and management, while a station screen cannot read a watcher", async () => {
    const f = await fixture();
    const me = await f.app.request("/api/device/me", { headers: { cookie: f.a.cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      deviceId: f.a.id,
      stationId: null,
      watcherId: f.pass.id,
    });
    const managed = await f.app.request("/management-api/devices");
    expect(managed.status).toBe(401);
    const ownStation = await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Grill" }));
    const joined = await enrolDeviceForTest(suite.db, f.v.cfg, {
      name: "Grill screen",
      profileId: f.profileId,
      stationId: ownStation.id,
    });
    const cookie = `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}`;
    const stationMe = await f.app.request("/api/device/me", { headers: { cookie } });
    expect(await stationMe.json()).toMatchObject({ stationId: ownStation.id, watcherId: null });
    const refused = await f.app.request("/api/device/watcher", { headers: { cookie } });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("refuses course and group Fire with only a watcher device cookie", async () => {
    const f = await fixture();
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
  it("lists active watchers in display order and reads a chosen queue", async () => {
    const f = await fixture();
    const list = await f.app.request("/api/watchers", { headers: { cookie: f.sessionCookie } });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([
      { id: f.runner.id, name: "Runner", runsPass: false },
      { id: f.pass.id, name: "Pass", runsPass: true },
    ]);
    const queue = await f.app.request(`/api/watchers/${f.pass.id}/queue`, {
      headers: { cookie: f.sessionCookie },
    });
    expect(queue.status).toBe(200);
    expect(await queue.json()).toEqual({
      watcher: { id: f.pass.id, name: "Pass", runsPass: true, active: true },
      orders: [],
    });
    const unknown = await f.app.request("/api/watchers/nope/queue", {
      headers: { cookie: f.sessionCookie },
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "watcher.not_found" } });
    const anonymous = await f.app.request("/api/watchers");
    expect(anonymous.status).toBe(401);
  });

  it("shares Done across one watcher's devices while leaving another watcher visible", async () => {
    const f = await fixture();
    const seated = await seat(f.v, await f.v.table("Inside"));
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const read = async (cookie: string) => {
      const response = await f.app.request("/api/device/watcher", { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json() as Promise<
        Awaited<ReturnType<typeof import("./watcher-board.js").listWatcherQueue>>
      >;
    };
    const [itemId] = items(await read(f.a.cookie));
    expect(itemId).toBeDefined();
    const done = await f.app.request("/api/device/watcher/done", {
      method: "POST",
      headers: { cookie: f.a.cookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [itemId], done: true }),
    });
    expect(done.status).toBe(204);
    expect(items(await read(f.b.cookie))).not.toContain(itemId);
    expect(items(await read(f.c.cookie))).toContain(itemId);
    const [mark] = await inTx(f.v, (tx) =>
      tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.ticketItemId, itemId!)),
    );
    expect(mark).toMatchObject({
      watcherId: f.pass.id,
      doneByDeviceId: f.a.id,
      doneByPersonId: null,
    });
    const undo = await f.app.request(`/api/watchers/${f.pass.id}/done`, {
      method: "POST",
      headers: { cookie: f.sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [itemId], done: false }),
    });
    expect(undo.status).toBe(204);
    expect(items(await read(f.b.cookie))).toContain(itemId);
    const tillDone = await f.app.request(`/api/watchers/${f.pass.id}/done`, {
      method: "POST",
      headers: { cookie: f.sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [itemId], done: true }),
    });
    expect(tillDone.status).toBe(204);
    const [personMark] = await inTx(f.v, (tx) =>
      tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.ticketItemId, itemId!)),
    );
    expect(personMark).toMatchObject({ doneByPersonId: f.person!.id, doneByDeviceId: null });
  });

  it("refuses foreign items atomically when Done also names a local item", async () => {
    const f = await fixture();
    const seated = await seat(f.v, await f.v.table("Inside"));
    await orderForParty(f.v, seated.partyId, ["Burger"], seated.tabId);
    const [local] = await inTx(f.v, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, seated.tabId)),
    );
    const [foreignLocation] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
      })
      .returning({ id: locations.id });
    const [foreignTill] = await suite.db
      .insert(tills)
      .values({ locationId: foreignLocation!.id, name: "Other till" })
      .returning({ id: tills.id });
    const foreignNode = await seedNode(suite.db, brandLocationId(foreignLocation!.id));
    const [foreignStation] = await suite.db
      .insert(kitchenStations)
      .values({ locationId: foreignLocation!.id, name: "Other kitchen" })
      .returning({ id: kitchenStations.id });
    const [foreignOrder] = await suite.db
      .insert(workingOrders)
      .values({ tillId: foreignTill!.id, nodeId: foreignNode, orderNumber: 1, status: "open" })
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
    for (const [path, cookie] of [
      [`/api/watchers/${f.pass.id}/done`, f.sessionCookie],
      ["/api/device/watcher/done", f.a.cookie],
    ]) {
      const response = await f.app.request(path!, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ ticketItemIds: [local!.id, foreignItem!.id], done: true }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "ticketItemIds" } },
      });
      expect(
        await inTx(f.v, (tx) =>
          tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.watcherId, f.pass.id)),
        ),
      ).toEqual([]);
    }
    const doneLocal = await f.app.request(`/api/watchers/${f.pass.id}/done`, {
      method: "POST",
      headers: { cookie: f.sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [local!.id], done: true }),
    });
    expect(doneLocal.status).toBe(204);
    const mixedUndo = await f.app.request("/api/device/watcher/done", {
      method: "POST",
      headers: { cookie: f.a.cookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [local!.id, foreignItem!.id], done: false }),
    });
    expect(mixedUndo.status).toBe(400);
    expect(
      await inTx(f.v, (tx) =>
        tx
          .select({ ticketItemId: watcherItemMarks.ticketItemId })
          .from(watcherItemMarks)
          .where(eq(watcherItemMarks.watcherId, f.pass.id)),
      ),
    ).toEqual([{ ticketItemId: local!.id }]);
    const undoLocal = await f.app.request("/api/device/watcher/done", {
      method: "POST",
      headers: { cookie: f.a.cookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [local!.id], done: false }),
    });
    expect(undoLocal.status).toBe(204);
    expect(
      await inTx(f.v, (tx) =>
        tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.watcherId, f.pass.id)),
      ),
    ).toEqual([]);
  });

  it("refuses malformed Done and returns a removed watcher's empty board to its device", async () => {
    const f = await fixture();
    for (const body of [
      { ticketItemIds: [], done: true },
      { ticketItemIds: ["not-a-uuid"], done: true },
      { ticketItemIds: Array(201).fill(f.pass.id), done: true },
    ]) {
      const response = await f.app.request(`/api/watchers/${f.pass.id}/done`, {
        method: "POST",
        headers: { cookie: f.sessionCookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "ticketItemIds" } },
      });
    }
    const badDone = await f.app.request("/api/device/watcher/done", {
      method: "POST",
      headers: { cookie: f.a.cookie, "content-type": "application/json" },
      body: JSON.stringify({ ticketItemIds: [f.pass.id], done: "true" }),
    });
    expect(badDone.status).toBe(400);
    expect(await badDone.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "done" } },
    });
    await inTx(f.v, (tx) => removeWatcher(tx, f.v.cfg, f.pass.id));
    const removed = await f.app.request("/api/device/watcher", { headers: { cookie: f.a.cookie } });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      watcher: { id: f.pass.id, name: "Pass", runsPass: true, active: false },
      orders: [],
    });
  });
});
