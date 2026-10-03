import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { kitchenStations, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { takeBillPayment } from "./bill-payments.js";
import {
  billRow,
  inTx,
  OPERATOR,
  orderForParty,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { listExpoQueue, listStationQueue, markCollected } from "./working-order.js";
import { createWatcher } from "./watchers.js";
import { listWatcherQueue, markWatcherItems } from "./watcher-board.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function cocina(v: PartyVenue): Promise<string> {
  const [station] = await inTx(v, (tx) =>
    tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Cocina")),
  );
  return station!.id;
}

async function onStationQueue(v: PartyVenue, stationId: string, billId: string): Promise<boolean> {
  const groups = await inTx(v, (tx) => listStationQueue(tx, stationId));
  return groups.some((group) => group.orderId === billId);
}

async function onPass(v: PartyVenue, billId: string): Promise<boolean> {
  const orders = await inTx(v, (tx) => listExpoQueue(tx, v.cfg));
  return orders.some((order) => order.orderId === billId);
}

async function onWatcher(v: PartyVenue, watcherId: string, billId: string): Promise<boolean> {
  const board = await inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId));
  return board.orders.some((order) => order.orderId === billId);
}

describe("what takes a paid table bill's dishes off today's kitchen screens", () => {
  it("leaves a table bill paid at the till on the station queue and pass until collection", async () => {
    const v = await setupPartyVenue(suite.db);
    const stationId = await cocina(v);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: true,
          })
        ).id,
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 1"));
    await orderForParty(v, partyId, ["Burger"], tabId);
    await pay(v, tabId, "12.00");

    expect(await billRow(v, tabId)).toMatchObject({ status: "settled", collectedAt: null });
    expect(await onStationQueue(v, stationId, tabId)).toBe(true);
    expect(await onPass(v, tabId)).toBe(true);
    expect(await onWatcher(v, watcherId, tabId)).toBe(true);

    const [item] = await inTx(v, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, watcherId, [item!.id], true, { personId: OPERATOR }, new Date()),
    );
    expect(await onWatcher(v, watcherId, tabId)).toBe(false);
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, watcherId, [item!.id], false, { personId: OPERATOR }, new Date()),
    );
    expect(await onWatcher(v, watcherId, tabId)).toBe(true);

    await markCollected({ db: v.db }, v.cfg, tabId);
    expect(await onStationQueue(v, stationId, tabId)).toBe(false);
    expect(await onPass(v, tabId)).toBe(false);
    expect(await onWatcher(v, watcherId, tabId)).toBe(false);
  });

  it("leaves a table bill paid through a full bill payment on both until collection", async () => {
    const v = await setupPartyVenue(suite.db);
    const stationId = await cocina(v);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: true,
          })
        ).id,
    );
    const { partyId, tabId } = await seat(v, await v.table("Mesa 2"));
    await orderForParty(v, partyId, ["Burger"], tabId);
    await takeBillPayment(
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      tabId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "12.00",
        method: "cash",
        tendered: "12.00",
        applied: "12.00",
        tip: "0.00",
      },
      OPERATOR,
    );

    expect(await billRow(v, tabId)).toMatchObject({ status: "settled", collectedAt: null });
    expect(await onStationQueue(v, stationId, tabId)).toBe(true);
    expect(await onPass(v, tabId)).toBe(true);
    expect(await onWatcher(v, watcherId, tabId)).toBe(true);

    await markCollected({ db: v.db }, v.cfg, tabId);
    expect(await onStationQueue(v, stationId, tabId)).toBe(false);
    expect(await onPass(v, tabId)).toBe(false);
    expect(await onWatcher(v, watcherId, tabId)).toBe(false);
  });
});
