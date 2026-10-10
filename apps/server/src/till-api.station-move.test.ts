import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  devices,
  ticketItemMoves,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { listStationQueues } from "./working-order.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createStation, deactivateStation } from "./kitchen.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { fireLines, fireableLineColumns } from "./working-order.js";
import { setStationToday } from "@waitron/venue-service";

let venue: BillVenue;
let bar: string;
let grill: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      bar = (await createStation(tx, venue.cfg, { name: "Bar", isDefault: true })).id;
      grill = (await createStation(tx, venue.cfg, { name: "Grill" })).id;
    });
  },
});

const call = (path: string, body: unknown, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", path, body);

describe("GET /api/stations", () => {
  it("reports the current open state of active stations", async () => {
    await inTx(venue, (tx) => setStationToday(tx, venue.cfg, grill, "closed", new Date()));
    const response = await send(venue.app, venue.cookie, "GET", "/api/stations");
    expect(response.status).toBe(200);
    expect(response.json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: bar, open: true }),
        expect.objectContaining({ id: grill, open: false }),
      ]),
    );
  });
});

describe("POST /api/working-orders/:id/lines/move-station", () => {
  it("records the session's device and person as the mover", async () => {
    const { tabId } = await seatedWith(venue, "Paella");
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    const answer = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [item!.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(200);
    const moves = await inTx(venue, (tx) =>
      tx
        .select()
        .from(ticketItemMoves)
        .where(eq(ticketItemMoves.workingOrderLineId, item!.workingOrderLineId)),
    );
    expect(moves).toEqual([
      expect.objectContaining({
        fromStationId: bar,
        toStationId: grill,
        movedByDeviceId: venue.deviceId,
        movedByPersonId: venue.operatorId,
      }),
    ]);
  });

  it("moves a queued dish and exposes its station and move eligibility", async () => {
    const { tabId } = await seatedWith(venue, "Paella");
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(item!.stationId).toBe(bar);
    const before = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${tabId}/lines`);
    expect(before.status).toBe(200);
    expect((before.json.lines as { stationId: string; movable: boolean }[])[0]).toMatchObject({
      stationId: bar,
      movable: true,
    });
    const answer = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [item!.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      stationId: grill,
      moved: [{ workingOrderLineId: item!.workingOrderLineId, fromStationId: bar }],
    });
    const after = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${tabId}/lines`);
    expect((after.json.lines as { stationId: string; movable: boolean }[])[0]).toMatchObject({
      stationId: grill,
      movable: true,
    });
    await inTx(venue, (tx) =>
      tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, item!.id)),
    );
    const started = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/working-orders/${tabId}/lines`,
    );
    expect((started.json.lines as { stationId: string; movable: boolean }[])[0]).toMatchObject({
      stationId: grill,
      movable: false,
    });
  });

  it("validates its body and requires a session", async () => {
    const id = randomUUID();
    const path = `/api/working-orders/${id}/lines/move-station`;
    expect(
      (await call(path, { submissionId: randomUUID(), lineIds: [], stationId: grill })).json,
    ).toMatchObject({ code: "management.request_invalid", params: { field: "lineIds" } });
    expect(
      (await call(path, { submissionId: randomUUID(), lineIds: ["bad"], stationId: grill })).status,
    ).toBe(404);
    expect(
      (await call(path, { submissionId: randomUUID(), lineIds: [randomUUID()], stationId: "bad" }))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          path,
          { submissionId: randomUUID(), lineIds: [randomUUID()], stationId: grill },
          "",
        )
      ).status,
    ).toBe(401);
  });

  it.each([
    ["preparing", "ticket.already_started"],
    ["ready", "ticket.already_started"],
    ["made here", "ticket.made_here"],
  ] as const)("maps %s to 409 %s", async (state, code) => {
    const { tabId } = await seatedWith(venue, "Paella");
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    await inTx(venue, (tx) =>
      tx
        .update(ticketItems)
        .set(state === "made here" ? { madeHere: true, state: "ready" } : { state })
        .where(eq(ticketItems.id, item!.id)),
    );
    const answer = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [item!.workingOrderLineId],
      stationId: grill,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code });
  });

  it("maps an unsent line to 409 ticket.not_sent", async () => {
    const tabId = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id: tabId,
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    const listed = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${tabId}/lines`);
    expect(
      (listed.json.lines as { stationId: string | null; movable: boolean }[])[0],
    ).toMatchObject({ stationId: null, movable: false });
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId)),
    );
    const answer = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [line!.id],
      stationId: grill,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "ticket.not_sent" });
  });

  it("maps unowned lines, unknown and inactive stations, and closed orders", async () => {
    const first = await seatedWith(venue, "Paella");
    const second = await seatedWith(venue, "Paella");
    const [firstItem] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, first.tabId)),
    );
    const [otherItem] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, second.tabId)),
    );
    const request = (lineId: string, stationId: string) =>
      call(`/api/working-orders/${first.tabId}/lines/move-station`, {
        submissionId: randomUUID(),
        lineIds: [lineId],
        stationId,
      });
    const wrongLine = await request(otherItem!.workingOrderLineId, grill);
    expect(wrongLine.status).toBe(404);
    expect(wrongLine.json).toMatchObject({ code: "tab.line_not_found" });
    const unknownStation = await request(firstItem!.workingOrderLineId, randomUUID());
    expect(unknownStation.status).toBe(404);
    expect(unknownStation.json).toMatchObject({ code: "station.not_found" });
    const inactive = await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: `Off ${randomUUID()}` });
      await deactivateStation(tx, venue.cfg, station.id);
      return station.id;
    });
    const off = await request(firstItem!.workingOrderLineId, inactive);
    expect(off.status).toBe(409);
    expect(off.json).toMatchObject({ code: "route.station_inactive" });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, first.tabId)),
    );
    const abandoned = await request(firstItem!.workingOrderLineId, grill);
    expect(abandoned.status).toBe(409);
    expect(abandoned.json).toMatchObject({ code: "working_order.not_open" });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ collectedAt: new Date().toISOString() })
        .where(eq(workingOrders.id, second.tabId)),
    );
    const collected = await call(`/api/working-orders/${second.tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [otherItem!.workingOrderLineId],
      stationId: grill,
    });
    expect(collected.status).toBe(409);
    expect(collected.json).toMatchObject({ code: "working_order.already_collected" });
  });

  it.each(["whole order", "one line"] as const)(
    "keeps moved make-at on added units through the %s route",
    async (path) => {
      const { tabId } = await seatedWith(venue, "Paella");
      const [item] = await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
      );
      const moved = await call(`/api/working-orders/${tabId}/lines/move-station`, {
        submissionId: randomUUID(),
        lineIds: [item!.workingOrderLineId],
        stationId: grill,
      });
      expect(moved.status).toBe(200);
      const revision = moved.json.revision as number;
      const edited =
        path === "whole order"
          ? await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${tabId}`, {
              revision,
              lines: [
                {
                  workingOrderLineId: item!.workingOrderLineId,
                  menuItemId: venue.offerFor("Paella"),
                  quantity: "2",
                  makeAt: null,
                },
              ],
            })
          : await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${tabId}/lines/1`, {
              revision,
              quantity: "2",
              makeAt: null,
            });
      expect(edited.status).toBe(200);
      const lines = await inTx(venue, (tx) =>
        tx
          .select({ id: workingOrderLines.id, makeAt: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId)),
      );
      const added = lines.find((line) => line.id !== item!.workingOrderLineId)!;
      expect(added.makeAt).toBe(grill);
      const [record] = await inTx(venue, (tx) =>
        tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, added.id)),
      );
      expect(record!.stationId).toBe(grill);
    },
  );

  it.each(["whole order", "one line"] as const)(
    "keeps added counter units at the moved station through %s",
    async (path) => {
      const tabId = randomUUID();
      const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
        id: tabId,
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
      });
      expect(parked.status).toBe(200);
      await inTx(venue, async (tx) => {
        const lines = await tx
          .select(fireableLineColumns)
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId));
        await fireLines(tx, venue.cfg, tabId, lines);
      });
      const [item] = await inTx(venue, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
      );
      expect(item!.stationId).toBe(bar);
      const moved = await call(`/api/working-orders/${tabId}/lines/move-station`, {
        submissionId: randomUUID(),
        lineIds: [item!.workingOrderLineId],
        stationId: grill,
      });
      expect(moved.status).toBe(200);
      const revision = moved.json.revision as number;
      const edited =
        path === "whole order"
          ? await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${tabId}`, {
              revision,
              lines: [
                {
                  workingOrderLineId: item!.workingOrderLineId,
                  menuItemId: venue.offerFor("Paella"),
                  quantity: "2",
                  makeAt: null,
                },
              ],
            })
          : await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${tabId}/lines/1`, {
              revision,
              quantity: "2",
              makeAt: null,
            });
      expect(edited.status).toBe(200);
      const lines = await inTx(venue, (tx) =>
        tx
          .select({ id: workingOrderLines.id, makeAt: workingOrderLines.makeAtStationId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId)),
      );
      const added = lines.find((line) => line.id !== item!.workingOrderLineId)!;
      expect(added.makeAt).toBe(grill);
      const [record] = await inTx(venue, (tx) =>
        tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, added.id)),
      );
      expect(record!.stationId).toBe(grill);
    },
  );

  it("sends added counter units to an explicit station after the original dish moved", async () => {
    const tabId = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id: tabId,
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
    });
    expect(parked.status).toBe(200);
    await inTx(venue, async (tx) => {
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));
      await fireLines(tx, venue.cfg, tabId, lines);
    });
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    const moved = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [item!.workingOrderLineId],
      stationId: grill,
    });
    expect(moved.status).toBe(200);
    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${tabId}/lines/1`,
      { revision: moved.json.revision, quantity: "2", makeAt: bar },
    );
    expect(edited.status).toBe(200);
    const records = await inTx(venue, (tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId, stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(records.find((row) => row.lineId === item!.workingOrderLineId)!.stationId).toBe(grill);
    expect(records.find((row) => row.lineId !== item!.workingOrderLineId)!.stationId).toBe(bar);
  });
});

describe("station queue move attribution", () => {
  it("reads the latest move at its receiving station for a till and a dashboard actor", async () => {
    const { tabId } = await seatedWith(venue, "Paella");
    const [item] = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tabId)),
    );
    const before = await send(venue.app, venue.cookie, "GET", `/api/stations/${bar}/queue`);
    const group = (body: unknown) =>
      (body as { items: { orderId: string; items: { lastMove?: unknown }[] }[] }).items.find(
        (g) => g.orderId === tabId,
      )!;
    expect(group(before.json).items[0]).not.toHaveProperty("lastMove");
    const moved = await call(`/api/working-orders/${tabId}/lines/move-station`, {
      submissionId: randomUUID(),
      lineIds: [item!.workingOrderLineId],
      stationId: grill,
    });
    expect(moved.status).toBe(200);
    await inTx(venue, async (tx) => {
      await tx.update(persons).set({ displayName: "Luis" }).where(eq(persons.id, venue.operatorId));
      await tx.update(devices).set({ label: "Till 2" }).where(eq(devices.id, venue.deviceId));
      await tx
        .update(ticketItemMoves)
        .set({ movedAt: "2026-10-10T18:12:00.000Z" })
        .where(eq(ticketItemMoves.workingOrderLineId, item!.workingOrderLineId));
    });
    const receiving = await send(venue.app, venue.cookie, "GET", `/api/stations/${grill}/queue`);
    expect(receiving.status).toBe(200);
    expect(group(receiving.json).items[0]!.lastMove).toEqual({
      fromStationName: "Bar",
      personName: "Luis",
      deviceName: "Till 2",
      movedAt: "2026-10-10T18:12:00.000Z",
    });
    await inTx(venue, async (tx) => {
      await tx.insert(ticketItemMoves).values({
        workingOrderLineId: item!.workingOrderLineId,
        fromStationId: grill,
        toStationId: bar,
        movedByPersonId: venue.operatorId,
        movedByDeviceId: null,
        movedAt: "2026-10-10T18:12:00.000Z",
      });
      await tx.update(ticketItems).set({ stationId: bar }).where(eq(ticketItems.id, item!.id));
    });
    const queues = await inTx(venue, (tx) => listStationQueues(tx, [bar, grill]));
    expect(queues.get(bar)!.find((g) => g.orderId === tabId)!.items[0]).toHaveProperty("lastMove", {
      fromStationName: "Grill",
      personName: "Luis",
      deviceName: null,
      movedAt: "2026-10-10T18:12:00.000Z",
    });
    expect(queues.get(grill)!.find((g) => g.orderId === tabId)).toBeUndefined();
    await inTx(venue, (tx) =>
      tx
        .update(ticketItemMoves)
        .set({ movedAt: "2026-10-10T18:11:00.000Z" })
        .where(
          and(
            eq(ticketItemMoves.workingOrderLineId, item!.workingOrderLineId),
            eq(ticketItemMoves.toStationId, bar),
          ),
        ),
    );
    const clockWentBack = await send(venue.app, venue.cookie, "GET", `/api/stations/${bar}/queue`);
    expect(group(clockWentBack.json).items[0]!.lastMove).toEqual({
      fromStationName: "Grill",
      personName: "Luis",
      deviceName: null,
      movedAt: "2026-10-10T18:11:00.000Z",
    });
    await inTx(venue, (tx) =>
      tx.update(ticketItems).set({ stationId: grill }).where(eq(ticketItems.id, item!.id)),
    );
    const rerouted = await send(venue.app, venue.cookie, "GET", `/api/stations/${grill}/queue`);
    expect(group(rerouted.json).items[0]).not.toHaveProperty("lastMove");
  });
});
