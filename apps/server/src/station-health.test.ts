import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  devices,
  deviceProfiles,
  kitchenStations,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { createStation } from "./kitchen.js";
import { setKitchenTimingDefaults } from "./kitchen-timing.js";
import { mountManagementApi } from "./management-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { inTx, order, seat, setupPartyVenue } from "./testing/party-venue.js";
import { routeProductTo } from "./testing/zone-offers.js";
import {
  readStationHealth,
  stationHealthItemsQuery,
  type StationHealthSnapshot,
} from "./station-health.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const now = new Date("2026-10-05T18:00:00.000Z");
afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const v = await setupPartyVenue(suite.db);
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: v.cfg.nodeId },
      venueCfg: v.cfg,
      credentialKeyRing: TOTP_KEY_RING,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  const login = async (email = "owner@example.test", password = "dashPass123") => {
    const response = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  const cookie = await login();
  const read = async (session = cookie): Promise<StationHealthSnapshot> => {
    const response = await app.request("/management-api/stations/health", {
      headers: { cookie: session },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const [station] = await suite.db.select().from(kitchenStations);
  const screen = async (stationId = station!.id, active = true) => {
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: randomUUID(),
        formFactor: "kds",
        capabilities: [],
      })
      .returning();
    const [device] = await suite.db
      .insert(devices)
      .values({
        locationId: v.cfg.locationId,
        stationId,
        deviceProfileId: profile!.id,
        label: randomUUID(),
        tokenHash: randomUUID(),
        active,
        lastSeenAt: "2026-10-05T17:50:00.000Z",
      })
      .returning();
    return device!.id;
  };
  return { v, app, login, read, station: station!, screen };
}

describe("station health", () => {
  it("counts dish rows across states, reports remaining quantities, bands and oldest-first kitchen drilldowns", async () => {
    const f = await setup();
    const { tabId } = await seat(f.v, await f.v.table("Mesa 9"));
    await order(f.v, tabId, "Burger", "Vino", "Agua");
    await f.screen();
    await inTx(f.v, async (tx) => {
      await setKitchenTimingDefaults(tx, f.v.cfg, {
        warmAfterMinutes: 2,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      const lines = await tx.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
      for (const [i, state] of ["queued", "preparing", "ready"].entries()) {
        await tx
          .update(ticketItems)
          .set({
            state: state as "queued" | "preparing" | "ready",
            queuedAt: new Date(now.getTime() - (i + 1) * 2 * 60_000).toISOString(),
          })
          .where(eq(ticketItems.workingOrderLineId, lines[i]!.id));
      }
      await tx
        .update(workingOrderLines)
        .set({ quantity: 3000, servedQuantity: 1000 })
        .where(eq(workingOrderLines.id, lines[0]!.id));
    });
    const snapshot = await f.read();
    expect(snapshot.capturedAt).toBe(now.toISOString());
    const station = snapshot.stations.find((s) => s.id === f.station.id)!;
    expect({ ...station, items: undefined }).toEqual({
      id: f.station.id,
      name: f.station.name,
      hasScreen: true,
      waiting: 1,
      preparing: 1,
      ready: 1,
      late: { warm: 1, overdue: 1, forgotten: 1 },
      oldestMinutes: 6,
      items: undefined,
    });
    expect(
      station.items.map(({ name, state, remainingQuantity, band, orderId, tableNames }) => ({
        name,
        state,
        remainingQuantity,
        band,
        orderId,
        tableNames,
      })),
    ).toEqual([
      {
        name: "AGUA",
        state: "ready",
        remainingQuantity: "1.000",
        band: "forgotten",
        orderId: tabId,
        tableNames: ["Mesa 9"],
      },
      {
        name: "TINTO",
        state: "preparing",
        remainingQuantity: "1.000",
        band: "overdue",
        orderId: tabId,
        tableNames: ["Mesa 9"],
      },
      {
        name: "BURG",
        state: "queued",
        remainingQuantity: "2.000",
        band: "warm",
        orderId: tabId,
        tableNames: ["Mesa 9"],
      },
    ]);
    expect(snapshot.outputsDown.screensDark).toEqual([
      {
        stationId: f.station.id,
        stationName: f.station.name,
        lastSeenAt: "2026-10-05T17:50:00.000Z",
      },
    ]);
  });

  it("folds all unserved states into Waiting without a selected active screen and reticks without a write", async () => {
    const f = await setup();
    const bar = await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Bar" }));
    await f.screen(bar.id);
    const disabled = await f.screen(f.station.id, false);
    const { tabId } = await seat(f.v, await f.v.table("No screen"));
    await order(f.v, tabId, "Burger", "Vino");
    const items = await suite.db.select().from(ticketItems);
    await suite.db
      .update(ticketItems)
      .set({ state: "preparing", queuedAt: new Date(now.getTime() - 4 * 60_000).toISOString() })
      .where(eq(ticketItems.id, items[0]!.id));
    await suite.db
      .update(ticketItems)
      .set({ state: "ready", queuedAt: new Date(now.getTime() - 9 * 60_000).toISOString() })
      .where(eq(ticketItems.id, items[1]!.id));
    const read = async () => (await f.read()).stations.find((s) => s.id === f.station.id)!;
    expect(await read()).toMatchObject({
      hasScreen: false,
      waiting: 2,
      preparing: null,
      ready: null,
      late: { warm: 1, overdue: 0, forgotten: 0 },
      oldestMinutes: 9,
    });
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    expect(await read()).toMatchObject({
      late: { warm: 1, overdue: 1, forgotten: 0 },
      oldestMinutes: 10,
    });
    await suite.db.update(devices).set({ active: true }).where(eq(devices.id, disabled));
    expect(await read()).toMatchObject({ hasScreen: true, waiting: 0, preparing: 1, ready: 1 });
    expect((await f.read()).stations.find((s) => s.id === bar.id)).toMatchObject({
      waiting: 0,
      preparing: 0,
      ready: 0,
      oldestMinutes: null,
      items: [],
    });
  });

  it("excludes held, made-here, fully served, abandoned and collected dishes while an undelivered ticket keeps ageing", async () => {
    const f = await setup();
    const bills: string[] = [];
    for (const name of ["Held", "Made here", "Served", "Abandoned", "Collected", "Jammed"]) {
      const { tabId } = await seat(f.v, await f.v.table(name));
      await order(f.v, tabId, "Burger");
      bills.push(tabId);
    }
    await suite.db
      .update(ticketItems)
      .set({ firedAt: null })
      .where(eq(ticketItems.workingOrderId, bills[0]!));
    await suite.db
      .update(ticketItems)
      .set({ madeHere: true })
      .where(eq(ticketItems.workingOrderId, bills[1]!));
    await suite.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000, servedAt: now.toISOString() })
      .where(eq(workingOrderLines.workingOrderId, bills[2]!));
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, bills[3]!));
    await suite.db
      .update(workingOrders)
      .set({ collectedAt: now.toISOString() })
      .where(eq(workingOrders.id, bills[4]!));
    await suite.db
      .update(ticketItems)
      .set({ queuedAt: new Date(now.getTime() - 20 * 60_000).toISOString() })
      .where(eq(ticketItems.workingOrderId, bills[5]!));
    const [printer] = await suite.db
      .insert(printers)
      .values({
        locationId: f.v.cfg.locationId,
        name: "Jammed",
        transport: "cloud_poll",
        pollId: randomUUID(),
      })
      .returning();
    await suite.db
      .insert(stationPrinters)
      .values({ stationId: f.station.id, printerId: printer!.id });
    await suite.db.insert(printJobs).values({
      locationId: f.v.cfg.locationId,
      printerId: printer!.id,
      status: "failed",
      payload: Uint8Array.of(1),
      createdAt: "2026-10-05T17:40:00.000Z",
      attempts: 5,
    });
    const snapshot = await f.read();
    const station = snapshot.stations.find((s) => s.id === f.station.id)!;
    expect(station.waiting).toBe(1);
    expect(station.late).toEqual({ warm: 0, overdue: 0, forgotten: 1 });
    expect(station.items.map((i) => i.orderId)).toEqual([bills[5]]);
    expect(snapshot.outputsDown.printersDown).toEqual([
      {
        stationId: f.station.id,
        stationName: f.station.name,
        printerId: printer!.id,
        printerName: "Jammed",
        since: "2026-10-05T17:40:00.000Z",
      },
    ]);
  });

  it("scopes dishes to their station and preserves disabled-station work", async () => {
    const f = await setup();
    const bar = await inTx(f.v, async (tx) => {
      await setKitchenTimingDefaults(tx, f.v.cfg, {
        warmAfterMinutes: 2,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      const station = await createStation(tx, f.v.cfg, {
        name: "Bar",
        thresholds: { warmAfterMinutes: 3, overdueAfterMinutes: 8, forgottenAfterMinutes: 12 },
      });
      await routeProductTo(tx, f.v.cfg, f.v.productId("Caña"), station.id);
      return station;
    });
    const { tabId } = await seat(f.v, await f.v.table("Two stations"));
    await order(f.v, tabId, "Burger", "Caña");
    await suite.db
      .update(ticketItems)
      .set({ queuedAt: new Date(now.getTime() - 5 * 60_000).toISOString() });
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, bar.id));
    const snapshot = await f.read();
    expect(snapshot.stations.find((s) => s.id === f.station.id)!.items.map((i) => i.name)).toEqual([
      "BURG",
    ]);
    expect(snapshot.stations.find((s) => s.id === bar.id)!.items.map((i) => i.name)).toEqual([
      "CANA",
    ]);
    expect(snapshot.stations.find((s) => s.id === f.station.id)!.items[0]!.band).toBe("overdue");
    expect(snapshot.stations.find((s) => s.id === bar.id)!.items[0]!.band).toBe("warm");
  });

  it("does not double-count extras, including when their parent is partially or fully served", async () => {
    const f = await setup();
    const { tabId } = await seat(f.v, await f.v.table("Extras"));
    await order(f.v, tabId, "Burger", "Agua");
    const lines = await suite.db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    await suite.db
      .update(workingOrderLines)
      .set({ parentLineId: lines[0]!.id })
      .where(eq(workingOrderLines.id, lines[1]!.id));
    await suite.db
      .update(workingOrderLines)
      .set({ quantity: 3000, servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, lines[0]!.id));
    const read = async () => (await f.read()).stations.find((s) => s.id === f.station.id)!;
    expect(
      (await read()).items.map((i) => ({ name: i.name, remainingQuantity: i.remainingQuantity })),
    ).toEqual([{ name: "BURG", remainingQuantity: "2.000" }]);
    await suite.db
      .update(workingOrderLines)
      .set({ servedQuantity: 3000, servedAt: now.toISOString() })
      .where(eq(workingOrderLines.id, lines[0]!.id));
    expect(await read()).toMatchObject({
      waiting: 0,
      late: { warm: 0, overdue: 0, forgotten: 0 },
      oldestMinutes: null,
      items: [],
    });
  });

  it("keeps the scoped query executable and returns no other venue's stations or dishes", async () => {
    const f = await setup();
    const { tabId } = await seat(f.v, await f.v.table("Scoped"));
    await order(f.v, tabId, "Burger");
    await inTx(f.v, async (tx) => {
      const query = stationHealthItemsQuery(tx, f.v.cfg.locationId);
      expect((await query).map((row) => row.orderId)).toEqual([tabId]);
      expect(await stationHealthItemsQuery(tx, "another-venue")).toEqual([]);
      const snapshot = await readStationHealth(
        tx,
        { locationId: "another-venue" as typeof f.v.cfg.locationId },
        now,
      );
      expect(snapshot).toEqual({
        capturedAt: now.toISOString(),
        stations: [],
        outputsDown: { printersDown: [], screensDark: [] },
      });
    });
  });

  it("grants venue.view reads only and refuses staff and unauthenticated readers", async () => {
    const f = await setup();
    for (const role of ["supervisor", "staff"] as const) {
      await suite.db.insert(persons).values({
        displayName: role,
        email: `${role}@example.test`,
        role,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("Password123"),
      });
      const cookie = await f.login(`${role}@example.test`, "Password123");
      const response = await f.app.request("/management-api/stations/health", {
        headers: { cookie },
      });
      expect(response.status).toBe(role === "supervisor" ? 200 : 403);
      if (role === "supervisor") {
        const denied = await f.app.request(`/management-api/stations/${f.station.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Denied" }),
        });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({
          error: { code: "authorization.not_permitted" },
        });
      } else
        expect(await response.json()).toMatchObject({
          error: { code: "authorization.not_permitted" },
        });
    }
    const response = await f.app.request("/management-api/stations/health");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "management_session.required" } });
  });
});

it("lets supervisors load station metadata without granting station writes", async () => {
  const f = await setup();
  await suite.db.insert(persons).values({
    displayName: "Supervisor",
    email: "overview@example.test",
    role: "supervisor",
    pinHash: hashPin("1234"),
    passwordHash: hashPassword("Password123"),
  });
  const cookie = await f.login("overview@example.test", "Password123");
  const response = await f.app.request("/management-api/stations?includeDisabled=true", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    expect.objectContaining({
      id: f.station.id,
      name: f.station.name,
      active: true,
      isDefault: true,
    }),
  ]);
  const write = await f.app.request(`/management-api/stations/${f.station.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Denied" }),
  });
  expect(write.status).toBe(403);
  expect(await write.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect((await f.app.request("/management-api/stations")).status).toBe(401);
});
