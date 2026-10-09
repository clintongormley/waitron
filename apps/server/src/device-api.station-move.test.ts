import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, ticketItemMoves, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { DeviceKitchenScreen } from "@waitron/module";
import { listStationNotices, setStationToday } from "@waitron/venue-service";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { loginWithPin } from "@waitron/identity";
import { createPairingMode } from "./pairing-mode.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createStation, deactivateStation } from "./kitchen.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";

let venue: BillVenue;
let app: Hono;
let bar: string;
let grill: string;
let off: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      bar = (await createStation(tx, venue.cfg, { name: "Bar", isDefault: true })).id;
      grill = (await createStation(tx, venue.cfg, { name: "Grill" })).id;
      off = (await createStation(tx, venue.cfg, { name: "Fryer" })).id;
      await deactivateStation(tx, venue.cfg, off);
    });
    app = new Hono();
    mountDeviceApi(
      app,
      { db, cfg: venue.cfg, secureCookies: false, pairingMode: createPairingMode() },
      () => {},
    );
  },
});

/** A device of `formFactor` running `screen`, whose profile lists `capabilities`. */
async function display(
  screen: DeviceKitchenScreen,
  capabilities: readonly string[] = ["take-orders", "prepare-orders"],
  formFactor: "kds" | "till" = "kds",
): Promise<{ id: string; cookie: string }> {
  const [profile] = await venue.db
    .insert(deviceProfiles)
    .values({ name: `Display ${randomUUID()}`, formFactor, capabilities: [...capabilities] })
    .returning({ id: deviceProfiles.id });
  const joined = await enrolDeviceForTest(venue.db, venue.cfg, {
    name: `Display ${randomUUID()}`,
    profileId: profile!.id,
    kitchenScreen: screen,
  });
  return { id: joined.deviceId, cookie: `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}` };
}

/** A till running a station screen at Bar, with the operator signed in on it. */
async function tillAtBar(): Promise<string> {
  const till = await display(stationScreen(bar), ["take-orders", "prepare-orders"], "till");
  const session = await inTx(venue, (tx) =>
    loginWithPin(tx, { deviceId: till.id, personId: venue.operatorId, pin: "5555" }),
  );
  return `${SESSION_COOKIE}=${session.token}; ${till.cookie}`;
}

const stationScreen = (...stationIds: string[]): DeviceKitchenScreen => ({
  kind: "station",
  stationIds,
  zoneIds: null,
});
const passScreen: DeviceKitchenScreen = { kind: "pass", stationIds: null, zoneIds: null };

/** A fresh table's Paella, fired to Bar. */
async function paella() {
  const { tabId } = await seatedWith(venue, "Paella");
  const [item] = await inTx(venue, (tx) =>
    tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
  );
  return { tabId, item: item! };
}

const movesOf = (lineId: string) =>
  inTx(venue, (tx) =>
    tx.select().from(ticketItemMoves).where(eq(ticketItemMoves.workingOrderLineId, lineId)),
  );

const move = (
  cookie: string,
  tabId: string,
  body: { submissionId?: string; lineIds?: unknown; stationId?: unknown },
) =>
  send(app, cookie, "POST", `/api/device/working-orders/${tabId}/lines/move-station`, {
    submissionId: randomUUID(),
    ...body,
  });

describe("POST /api/device/working-orders/:id/lines/move-station", () => {
  it("moves a queued dish at the screen's station to another active station", async () => {
    const screen = await display(stationScreen(bar));
    const { tabId, item } = await paella();
    const answer = await move(screen.cookie, tabId, {
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      stationId: grill,
      moved: [{ workingOrderLineId: item.workingOrderLineId, fromStationId: bar }],
    });
    expect(await movesOf(item.workingOrderLineId)).toEqual([
      expect.objectContaining({
        fromStationId: bar,
        toStationId: grill,
        movedByDeviceId: screen.id,
        movedByPersonId: null,
      }),
    ]);
    const notices = await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, bar));
    expect(notices.at(-1)).toMatchObject({
      kind: "rerouted",
      reroutedTo: "Grill",
      workingOrderId: tabId,
    });
  });

  it("refuses a dish at a station the screen does not work, and moves nothing", async () => {
    const screen = await display(stationScreen(grill));
    const { tabId, item } = await paella();
    const answer = await move(screen.cookie, tabId, {
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({
      code: "device.forbidden_station",
      params: { stationId: bar },
    });
    const [after] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
    );
    expect(after!.stationId).toBe(bar);
    expect(await movesOf(item.workingOrderLineId)).toEqual([]);
  });

  it("refuses a display whose profile does not take orders", async () => {
    const screen = await display(stationScreen(bar), ["prepare-orders"]);
    const { tabId, item } = await paella();
    const answer = await move(screen.cookie, tabId, {
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({
      code: "device.forbidden_action",
      params: { action: "take-orders" },
    });
  });

  it("refuses a till with a session and a station screen, and a display with only a pass screen", async () => {
    const { tabId, item } = await paella();
    const pass = await display(passScreen);
    for (const cookie of [await tillAtBar(), pass.cookie]) {
      const answer = await move(cookie, tabId, {
        lineIds: [item.workingOrderLineId],
        stationId: grill,
      });
      expect({ status: answer.status, code: answer.json.code }).toEqual({
        status: 401,
        code: "device.unauthorized",
      });
    }
    expect(await movesOf(item.workingOrderLineId)).toEqual([]);
  });

  it("answers a started dish and a switched-off destination as the till does", async () => {
    const screen = await display(stationScreen(bar));
    const { tabId, item } = await paella();
    const inactive = await move(screen.cookie, tabId, {
      lineIds: [item.workingOrderLineId],
      stationId: off,
    });
    expect(inactive.status).toBe(409);
    expect(inactive.json).toMatchObject({ code: "route.station_inactive" });
    await inTx(venue, (tx) =>
      tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, item.id)),
    );
    const started = await move(screen.cookie, tabId, {
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    });
    expect(started.status).toBe(409);
    expect(started.json).toMatchObject({ code: "ticket.already_started" });
  });

  it("validates its order id and body as the till's route does", async () => {
    const screen = await display(stationScreen(bar));
    const { tabId, item } = await paella();
    const lineId = item.workingOrderLineId;
    const badOrder = await move(screen.cookie, "not-a-uuid", {
      lineIds: [lineId],
      stationId: grill,
    });
    expect(badOrder.status).toBe(404);
    expect(badOrder.json).toMatchObject({ code: "working_order.not_found" });
    const noLines = await move(screen.cookie, tabId, { lineIds: [], stationId: grill });
    expect(noLines.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "lineIds" },
    });
    const badLine = await move(screen.cookie, tabId, { lineIds: ["bad"], stationId: grill });
    expect(badLine.json).toMatchObject({ code: "tab.line_not_found" });
    const badStation = await move(screen.cookie, tabId, { lineIds: [lineId], stationId: "bad" });
    expect(badStation.json).toMatchObject({ code: "station.not_found" });
    const noSubmission = await send(
      app,
      screen.cookie,
      "POST",
      `/api/device/working-orders/${tabId}/lines/move-station`,
      { lineIds: [lineId], stationId: grill },
    );
    expect(noSubmission.status).toBe(400);
  });

  it("replays a retried submission without a second move", async () => {
    const screen = await display(stationScreen(bar, grill));
    const { tabId, item } = await paella();
    const request = { submissionId: randomUUID(), lineIds: [item.workingOrderLineId] };
    const first = await move(screen.cookie, tabId, { ...request, stationId: grill });
    const again = await move(screen.cookie, tabId, { ...request, stationId: grill });
    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    expect(await movesOf(item.workingOrderLineId)).toHaveLength(1);
  });

  it("replays the first answer even once the dish sits at a station the screen does not work", async () => {
    const screen = await display(stationScreen(bar));
    const { tabId, item } = await paella();
    const request = {
      submissionId: randomUUID(),
      lineIds: [item.workingOrderLineId],
      stationId: grill,
    };
    const first = await move(screen.cookie, tabId, request);
    expect(first.status).toBe(200);
    const retry = await move(screen.cookie, tabId, request);
    expect(retry).toEqual(first);
    expect(await movesOf(item.workingOrderLineId)).toHaveLength(1);
  });
});

describe("GET /api/device/stations", () => {
  it("lists every active station with whether it is open today", async () => {
    const screen = await display(stationScreen(bar));
    await inTx(venue, (tx) => setStationToday(tx, venue.cfg, grill, "closed", new Date()));
    try {
      const answer = await send(app, screen.cookie, "GET", "/api/device/stations");
      expect(answer.status).toBe(200);
      const listed = answer.json as unknown as { id: string; open: boolean }[];
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: bar, name: "Bar", open: true }),
          expect.objectContaining({ id: grill, name: "Grill", open: false }),
        ]),
      );
      expect(listed.map((station) => station.id)).not.toContain(off);
    } finally {
      await inTx(venue, (tx) => setStationToday(tx, venue.cfg, grill, null, new Date()));
    }
  });

  it("refuses a till with a station screen and a display with only a pass screen", async () => {
    const pass = await display(passScreen);
    for (const cookie of [await tillAtBar(), pass.cookie]) {
      const answer = await send(app, cookie, "GET", "/api/device/stations");
      expect({ status: answer.status, code: answer.json.code }).toEqual({
        status: 401,
        code: "device.unauthorized",
      });
    }
  });
});
