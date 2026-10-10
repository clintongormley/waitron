import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  kitchenStations,
  parties,
  ticketItems,
  ticketItemMoves,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, stationDayStates } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { mountManagementApi } from "./management-api.js";
import {
  inTx,
  OPERATOR,
  orderForParty,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { createOpenOrder, carveOffLines } from "./working-order.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveDishesToStation } from "./station-move.js";
import { placeGroups, fireGroup } from "./order-groups.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let app: Hono;
let cookie: string;
let grill: string;
let bar: string;
let pastry: string;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  ({ grill, bar, pastry } = await inTx(v, async (tx) => {
    const [defaultStation] = await tx
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.isDefault, true));
    await tx
      .update(kitchenStations)
      .set({ name: "Bar" })
      .where(eq(kitchenStations.id, defaultStation!.id));
    return {
      bar: defaultStation!.id,
      grill: (await createStation(tx, v.cfg, { name: "Grill" })).id,
      pastry: (await createStation(tx, v.cfg, { name: "Pastry" })).id,
    };
  }));
  app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: v.cfg,
      venueCfg: v.cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
function request(
  method: string,
  suffix = "",
  body?: unknown,
  session: string | undefined = cookie,
) {
  return app.request(`/management-api/stations/${grill}${suffix}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session === undefined ? {} : { cookie: session }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function dish(station = grill) {
  await inTx(v, (tx) =>
    setRoutingCell(
      tx,
      v.cfg,
      { row: { kind: "product", productId: v.productId("Burger") }, zoneId: null },
      { kind: "station", stationId: station },
    ),
  );
  const group = await seat(v, await v.table(`Dish ${randomUUID()}`));
  await orderForParty(v, group.partyId, ["Burger"], group.tabId);
  const [item] = await suite.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, group.tabId));
  expect(item!.stationId).toBe(station);
  return item!;
}
async function active() {
  return (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0]!
    .active;
}
it.each(["queued", "preparing", "ready", "held"] as const)(
  "Disable preflight counts unfinished %s work",
  async (state) => {
    const item = await dish();
    await suite.db
      .update(ticketItems)
      .set(state === "held" ? { firedAt: null } : { state })
      .where(eq(ticketItems.id, item.id));
    const answer = await request("GET", "/closing");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      openDishCount: 1,
      destinations: [
        { id: bar, name: "Bar", isDefault: true },
        { id: pastry, name: "Pastry", isDefault: false },
      ],
    });
    expect(await active()).toBe(true);
  },
);
it.each(["away", "served", "collected", "abandoned", "made_here", "another_station"] as const)(
  "Disable preflight excludes %s work",
  async (kind) => {
    const item = await dish(kind === "another_station" ? pastry : grill);
    const at = new Date().toISOString();
    if (kind === "away")
      await suite.db.update(ticketItems).set({ awayAt: at }).where(eq(ticketItems.id, item.id));
    if (kind === "made_here")
      await suite.db.update(ticketItems).set({ madeHere: true }).where(eq(ticketItems.id, item.id));
    if (kind === "served")
      await suite.db
        .update(workingOrderLines)
        .set({ servedQuantity: 1000 })
        .where(eq(workingOrderLines.id, item.workingOrderLineId));
    if (kind === "collected" || kind === "abandoned")
      await suite.db
        .update(workingOrders)
        .set(kind === "collected" ? { collectedAt: at } : { status: "abandoned" })
        .where(eq(workingOrders.id, item.workingOrderId));
    const answer = await request("GET", "/closing");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ openDishCount: 0 });
  },
);
it("Disable refuses an unread arriving dish without a disposition", async () => {
  const preflight = await request("GET", "/closing");
  expect(preflight.status).toBe(200);
  expect(await preflight.json()).toMatchObject({ openDishCount: 0 });
  const item = await dish();
  const answer = await request("DELETE");
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "openDishes" } },
  });
  expect(await active()).toBe(true);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it.each([null, [], "", true, "discard"])(
  "Disable rejects invalid disposition %j",
  async (openDishes) => {
    const answer = await request("DELETE", "", { openDishes });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "openDishes" } },
    });
    expect(await active()).toBe(true);
  },
);
it.each(["queued", "held"] as const)(
  "Disable sends %s work to the selected station without closing for today",
  async (state) => {
    const item = await dish();
    if (state === "held")
      await suite.db.update(ticketItems).set({ firedAt: null }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
    expect(answer.status).toBe(204);
    expect(await active()).toBe(false);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({
      stationId: pastry,
      state: "queued",
      firedAt: state === "held" ? null : item.firedAt,
    });
    expect(await suite.db.select().from(stationDayStates)).toEqual([]);
    const [owner] = await suite.db
      .select()
      .from(persons)
      .where(eq(persons.email, "owner@example.test"));
    expect(await suite.db.select().from(ticketItemMoves)).toEqual([
      expect.objectContaining({
        workingOrderLineId: item.workingOrderLineId,
        fromStationId: grill,
        toStationId: pastry,
        movedByDeviceId: null,
        movedByPersonId: owner!.id,
      }),
    ]);
  },
);
it.each(["queued", "preparing", "ready"] as const)(
  "Disable leaves %s work at the station to finish",
  async (state) => {
    const item = await dish();
    await suite.db.update(ticketItems).set({ state }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "leave" });
    expect(answer.status).toBe(204);
    expect(await active()).toBe(false);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({ stationId: grill, state, firedAt: item.firedAt });
  },
);
it("Disable refuses a closed destination and leaves station and work unchanged", async () => {
  const item = await dish();
  await suite.db
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, pastry));
  const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "sendsToStationId" } },
  });
  expect(await active()).toBe(true);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it("Disable with no work retains the bodyless confirmation", async () => {
  expect((await request("DELETE")).status).toBe(204);
  expect(await active()).toBe(false);
});
it.each(["GET", "DELETE"])("Disable %s refuses an absent session", async (method) => {
  const answer = await request(method, method === "GET" ? "/closing" : "", undefined, "");
  expect(answer.status).toBe(401);
  expect(await answer.json()).toMatchObject({ error: { code: "management_session.required" } });
  expect(await active()).toBe(true);
});

it.each(["staff", "supervisor"] as const)(
  "Disable preflight and write refuse %s without configuration rights",
  async (role) => {
    const { persons } = await import("@waitron/identity");
    await suite.db.update(persons).set({ role }).where(eq(persons.email, "owner@example.test"));
    for (const [method, suffix] of [
      ["GET", "/closing"],
      ["DELETE", ""],
    ]) {
      const answer = await request(method!, suffix!);
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
    expect(await active()).toBe(true);
  },
);
it.each([undefined, null, "", [], true])(
  "Disable send refuses destination %j",
  async (sendsToStationId) => {
    const item = await dish();
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "sendsToStationId" } },
    });
    expect(await active()).toBe(true);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
    ).toBe(grill);
  },
);
it.each(["preparing", "ready", "partly_served"] as const)(
  "Disable send leaves %s source work untouched",
  async (kind) => {
    const item = await dish();
    if (kind === "partly_served")
      await suite.db
        .update(workingOrderLines)
        .set({ servedQuantity: 500 })
        .where(eq(workingOrderLines.id, item.workingOrderLineId));
    else await suite.db.update(ticketItems).set({ state: kind }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
    expect(answer.status).toBe(204);
    expect(await active()).toBe(false);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({ stationId: grill, state: kind === "partly_served" ? "queued" : kind });
  },
);
it("Disable sends only the source station's unfinished work", async () => {
  const item = await dish();
  const other = await dish(bar);
  expect(
    (await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry })).status,
  ).toBe(204);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(pastry);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, other.id)))[0]!.stationId,
  ).toBe(bar);
});
it("Disable keeps the configured routing cell and sends new work to the default", async () => {
  await dish();
  expect((await request("DELETE", "", { openDishes: "leave" })).status).toBe(204);
  const group = await seat(v, await v.table(`New ${randomUUID()}`));
  await orderForParty(v, group.partyId, ["Burger"], group.tabId);
  expect(
    (
      await suite.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, group.tabId))
    )[0]!.stationId,
  ).toBe(bar);
  const { routingCells } = await import("@waitron/venue-service");
  expect(
    (
      await suite.db
        .select()
        .from(routingCells)
        .where(eq(routingCells.productId, v.productId("Burger")))
    )[0]!.stationId,
  ).toBe(grill);
});

it("PATCH active=false cannot bypass the unread-dish choice or partly rename the station", async () => {
  const item = await dish();
  const answer = await request("PATCH", "", { active: false, name: "Unexpected rename" });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "openDishes" } },
  });
  expect(
    (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0],
  ).toMatchObject({ active: true, name: "Grill" });
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it("PATCH active=false sends waiting work and applies the remaining station edit together", async () => {
  const item = await dish();
  const answer = await request("PATCH", "", {
    active: false,
    name: "Renamed Grill",
    openDishes: "send",
    sendsToStationId: pastry,
  });
  expect(answer.status).toBe(204);
  expect(
    (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0],
  ).toMatchObject({ active: false, name: "Renamed Grill" });
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(pastry);
});

it.each(["leave", "send", "move", "split"] as const)(
  "Disable %s preserves the chosen station when a held group is fired",
  async (openDishes) => {
    await inTx(v, (tx) =>
      setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Burger") }, zoneId: null },
        { kind: "station", stationId: grill },
      ),
    );
    const seated = await seat(v, await v.table(`Held disable ${randomUUID()}`));
    const submitted = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, seated.partyId, {
        groups: [
          {
            release: "hold",
            lines: [{ menuItemId: v.item("Burger"), quantity: openDishes === "split" ? "2" : "1" }],
          },
        ],
        operatorId: OPERATOR,
        billId: seated.tabId,
      }),
    );
    const [item] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, seated.tabId));
    expect(item).toMatchObject({
      stationId: grill,
      firedAt: null,
      state: "queued",
      stationChosenAt: null,
      stationRetainedAtRelease: false,
    });
    expect(
      (
        await request("DELETE", "", {
          openDishes: openDishes === "send" ? "send" : "leave",
          ...(openDishes === "send" ? { sendsToStationId: pastry } : {}),
        })
      ).status,
    ).toBe(204);
    expect(await active()).toBe(false);
    const destination = openDishes === "send" ? pastry : grill;
    const [retained] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.id, item!.id));
    expect(retained).toMatchObject({
      stationId: destination,
      firedAt: null,
      state: "queued",
      stationChosenAt: expect.any(String),
      stationRetainedAtRelease: openDishes !== "send",
    });
    const billIds = [seated.tabId];
    if (openDishes === "split") {
      const otherBill = randomUUID();
      billIds.push(otherBill);
      await inTx(v, async (tx) => {
        await createOpenOrder(tx, v.cfg, otherBill, [], null, { partyId: seated.partyId });
        await VENUE_SERVICE.copyOrderContext(tx, v.cfg, seated.tabId, otherBill);
        await carveOffLines(tx, v.cfg, seated.tabId, otherBill, [{ lineNo: 1, quantity: "1" }], {
          refuseHeld: false,
        });
      });
      const split = await suite.db
        .select()
        .from(ticketItems)
        .where(inArray(ticketItems.workingOrderId, billIds));
      expect(split).toHaveLength(2);
      for (const row of split)
        expect(row).toMatchObject({
          stationId: grill,
          stationRetainedAtRelease: true,
          stationChosenAt: retained!.stationChosenAt,
          firedAt: null,
        });
    }
    if (openDishes === "move") {
      await inTx(v, (tx) =>
        moveDishesToStation(
          tx,
          v.cfg,
          seated.tabId,
          {
            submissionId: randomUUID(),
            lineIds: [item!.workingOrderLineId],
            stationId: pastry,
          },
          { deviceId: v.cfg.origin.deviceId, personId: OPERATOR },
        ),
      );
      const [moved] = await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item!.id));
      expect(moved).toMatchObject({ stationId: pastry, stationRetainedAtRelease: false });
      await suite.db
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, pastry));
    }
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, seated.partyId));
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, seated.partyId, submitted.groups[0]!.id, {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        operatorId: OPERATOR,
      }),
    );
    const [after] = await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item!.id));
    expect(after).toMatchObject({
      stationId: openDishes === "move" ? bar : destination,
      state: "queued",
    });
    if (openDishes !== "move") expect(after!.stationChosenAt).toBe(retained!.stationChosenAt);
    expect(after!.firedAt).not.toBeNull();
    if (openDishes === "split") {
      const split = await suite.db
        .select()
        .from(ticketItems)
        .where(inArray(ticketItems.workingOrderId, billIds));
      expect(split).toHaveLength(2);
      for (const row of split) {
        expect(row).toMatchObject({ stationId: grill, stationRetainedAtRelease: true });
        expect(row.firedAt).not.toBeNull();
      }
    }
  },
);
