import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  kitchenStations,
  parties,
  ticketItems,
  ticketItemMoves,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
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
async function request(
  method: string,
  suffix = "",
  body?: unknown,
  session: string | undefined = cookie,
) {
  const guarded =
    method === "DELETE" ||
    (method === "PATCH" &&
      typeof body === "object" &&
      body !== null &&
      Object.hasOwn(body, "active"));
  const before = guarded ? await snapshot() : undefined;
  const answer = await app.request(`/management-api/stations/${grill}${suffix}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session === undefined ? {} : { cookie: session }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (guarded && answer.status >= 400) expect(await snapshot()).toEqual(before);
  return answer;
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
  const tableName = `Dish ${randomUUID()}`;
  const group = await seat(v, await v.table(tableName));
  await orderForParty(v, group.partyId, ["Burger"], group.tabId);
  const [item] = await suite.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, group.tabId));
  expect(item!.stationId).toBe(station);
  return { ...item!, tableName };
}
async function snapshot() {
  return inTx(v, async (tx) => {
    const result: Record<string, unknown> = {};
    for (const name of [
      "kitchen_stations",
      "kitchen_station_timing",
      "station_printers",
      "device_made_here_stations",
      "routing_cells",
      "routing_cell_periods",
      "station_day_states",
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screen_removals",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "ticket_item_moves",
      "order_drafts",
      "order_draft_lines",
      "order_draft_events",
      "print_jobs",
      "kitchen_print_jobs",
      "kitchen_print_job_lines",
      "kitchen_notices",
    ]) {
      result[name] = (
        await tx.execute(sql`select * from ${sql.identifier(name)} order by rowid`)
      ).rows;
    }
    return result;
  });
}
async function active() {
  return (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0]!
    .active;
}
it.each(["queued", "preparing", "ready", "held"] as const)(
  "Delete impact distinguishes preparation from ready %s work",
  async (state) => {
    const item = await dish();
    await suite.db
      .update(ticketItems)
      .set(state === "held" ? { firedAt: null } : { state })
      .where(eq(ticketItems.id, item.id));
    const answer = await request("GET", "/delete-impact");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      target: { id: grill, name: "Grill" },
      refusals:
        state === "ready"
          ? []
          : [
              {
                code: "station.work_in_progress",
                params: { stationId: grill, count: 1 },
                targets: [{ id: item.workingOrderId, name: item.tableName }],
              },
            ],
      ends: [],
      removes: [{ key: "station_routing_cells", count: 1, targets: [] }],
    });
    expect(await active()).toBe(true);
  },
);
it.each(["away", "served", "collected", "abandoned", "made_here", "another_station"] as const)(
  "Delete impact excludes %s work",
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
    const answer = await request("GET", "/delete-impact");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      target: { id: grill, name: "Grill" },
      refusals: [],
      ends: [],
      removes:
        kind === "another_station" ? [] : [{ key: "station_routing_cells", count: 1, targets: [] }],
    });
  },
);
it("Delete refuses an unread arriving dish without changing it", async () => {
  const preflight = await request("GET", "/delete-impact");
  expect(preflight.status).toBe(200);
  expect(await preflight.json()).toEqual({
    target: { id: grill, name: "Grill" },
    refusals: [],
    ends: [],
    removes: [],
  });
  const item = await dish();
  const answer = await request("DELETE");
  expect(answer.status).toBe(409);
  expect(await answer.json()).toMatchObject({
    error: { code: "station.work_in_progress", params: { stationId: grill, count: 1 } },
  });
  expect(await active()).toBe(true);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it.each([null, [], "", true, "discard"])(
  "Delete rejects legacy disposition %j",
  async (openDishes) => {
    const answer = await request("DELETE", "", { openDishes });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await active()).toBe(true);
  },
);
it.each(["queued", "held"] as const)(
  "Delete rejects Send for %s work without moving or closing it",
  async (state) => {
    const item = await dish();
    if (state === "held")
      await suite.db.update(ticketItems).set({ firedAt: null }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await active()).toBe(true);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({
      stationId: grill,
      state: "queued",
      firedAt: state === "held" ? null : item.firedAt,
    });
    expect(await suite.db.select().from(stationDayStates)).toEqual([]);
    expect(await suite.db.select().from(ticketItemMoves)).toEqual([]);
  },
);
it.each(["queued", "preparing", "ready"] as const)(
  "Delete rejects Leave for %s work without changing food",
  async (state) => {
    const item = await dish();
    await suite.db.update(ticketItems).set({ state }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "leave" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await active()).toBe(true);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({ stationId: grill, state, firedAt: item.firedAt });
  },
);
it("Delete rejects legacy Send to a deleted destination and leaves work unchanged", async () => {
  const item = await dish();
  await suite.db
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, pastry));
  const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "body" } },
  });
  expect(await active()).toBe(true);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it("Delete with no work returns the full impact", async () => {
  const answer = await request("DELETE");
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({
    target: { id: grill, name: "Grill" },
    refusals: [],
    ends: [],
    removes: [],
  });
  expect(await active()).toBe(false);
});
it.each(["GET", "DELETE"])("Delete %s refuses an absent session", async (method) => {
  const answer = await request(method, method === "GET" ? "/delete-impact" : "", undefined, "");
  expect(answer.status).toBe(401);
  expect(await answer.json()).toMatchObject({ error: { code: "management_session.required" } });
  expect(await active()).toBe(true);
});

it.each(["staff", "supervisor"] as const)(
  "Delete impact and write refuse %s without configuration rights",
  async (role) => {
    const { persons } = await import("@waitron/identity");
    await suite.db.update(persons).set({ role }).where(eq(persons.email, "owner@example.test"));
    for (const [method, suffix] of [
      ["GET", "/delete-impact"],
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
  "Delete refuses legacy Send with destination %j",
  async (sendsToStationId) => {
    const item = await dish();
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await active()).toBe(true);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
    ).toBe(grill);
  },
);
it.each(["preparing", "ready", "partly_served"] as const)(
  "Rejected Delete Send leaves %s source work untouched",
  async (kind) => {
    const item = await dish();
    if (kind === "partly_served")
      await suite.db
        .update(workingOrderLines)
        .set({ servedQuantity: 500 })
        .where(eq(workingOrderLines.id, item.workingOrderLineId));
    else await suite.db.update(ticketItems).set({ state: kind }).where(eq(ticketItems.id, item.id));
    const answer = await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
    expect(await active()).toBe(true);
    expect(
      (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
    ).toMatchObject({ stationId: grill, state: kind === "partly_served" ? "queued" : kind });
  },
);
it("Rejected Delete Send changes neither source nor other station work", async () => {
  const item = await dish();
  const other = await dish(bar);
  expect(
    (await request("DELETE", "", { openDishes: "send", sendsToStationId: pastry })).status,
  ).toBe(400);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, other.id)))[0]!.stationId,
  ).toBe(bar);
});
it("Permitted Delete removes routing cell and sends new work to the default", async () => {
  const item = await dish();
  await suite.db.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.id, item.id));
  const answer = await request("DELETE");
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({
    target: { id: grill, name: "Grill" },
    refusals: [],
    ends: [],
    removes: [{ key: "station_routing_cells", count: 1, targets: [] }],
  });
  const group = await seat(v, await v.table(`New ${randomUUID()}`));
  await orderForParty(v, group.partyId, ["Burger"], group.tabId);
  expect(
    (
      await suite.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, group.tabId))
    )[0]!.stationId,
  ).toBe(bar);
  const { routingCells } = await import("@waitron/venue-service");
  expect(
    await suite.db
      .select()
      .from(routingCells)
      .where(eq(routingCells.productId, v.productId("Burger"))),
  ).toEqual([]);
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
  ).toMatchObject({ stationId: grill, state: "ready", firedAt: item.firedAt });
});

it("PATCH active=false cannot delete or partly rename the station", async () => {
  const item = await dish();
  const answer = await request("PATCH", "", { active: false, name: "Unexpected rename" });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "active" } },
  });
  expect(
    (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0],
  ).toMatchObject({ active: true, name: "Grill" });
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});
it("PATCH active=false rejects Send and keeps the remaining edit and food unchanged", async () => {
  const item = await dish();
  const answer = await request("PATCH", "", {
    active: false,
    name: "Renamed Grill",
    openDishes: "send",
    sendsToStationId: pastry,
  });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "active" } },
  });
  expect(
    (await suite.db.select().from(kitchenStations).where(eq(kitchenStations.id, grill)))[0],
  ).toMatchObject({ active: true, name: "Grill" });
  expect(
    (await suite.db.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!.stationId,
  ).toBe(grill);
});

it.each(["leave", "send", "move", "split"] as const)(
  "Rejected Delete %s preserves held work through firing and later split or move",
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
    ).toBe(400);
    expect(await active()).toBe(true);
    const destination = grill;
    const [retained] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.id, item!.id));
    expect(retained).toMatchObject({
      stationId: destination,
      firedAt: null,
      state: "queued",
      stationChosenAt: null,
      stationRetainedAtRelease: false,
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
          stationRetainedAtRelease: false,
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
      stationId: destination,
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
        expect(row).toMatchObject({ stationId: grill, stationRetainedAtRelease: false });
        expect(row.firedAt).not.toBeNull();
      }
    }
  },
);
