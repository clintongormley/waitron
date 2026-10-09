import { createZone } from "./testing/service-zone.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diningTables } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VENUE_SERVICE } from "./modules.js";
import { joinTables, moveGuests } from "./table-actions.js";

import { createOpenOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  commandFor,
  counterOrder,
  billRow,
  inTx,
  order,
  pay,
  placeByHand,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { orderWatchZones } from "./watch-zones.js";
import "./errors.js";

let v: PartyVenue;
let terrace: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    terrace = await inTx(v, async (tx) => {
      const zone = await createZone(tx, v.cfg, { name: "Terrace" });
      await offerProducts(tx, v.cfg, { zone: { zoneId: zone.id }, orderStart: "table" });
      return zone.id;
    });
  },
});

const partyBill = (id: string, partyId: string) => ({ id, partyId, deliveryTableId: null });
const counterBill = (id: string, deliveryTableId: string | null = null) => ({
  id,
  partyId: null,
  deliveryTableId,
});

describe("orderWatchZones", () => {
  it("gives a moved party's open and presented bills the new table's zone, and records it on the presented bill", async () => {
    const outside = await v.table("Watch outside", terrace);
    const inside = await v.table("Watch inside");
    const { partyId, tabId } = await seat(v, outside);
    const presented = randomUUID();
    await inTx(v, async (tx) => {
      await createOpenOrder(tx, v.cfg, presented, [], null, { partyId, zoneId: terrace });
    });
    await placeByHand(v, presented);
    const orders = [partyBill(tabId, partyId), partyBill(presented, partyId)];
    expect(await inTx(v, (tx) => orderWatchZones(tx, v.cfg, orders))).toEqual(
      new Map([
        [tabId, terrace],
        [presented, terrace],
      ]),
    );

    const sent = await commandFor(v, partyId);
    await inTx(v, async (tx) =>
      moveGuests(tx, v.cfg, partyId, inside, {
        ...sent,
        bills: "separate",
        otherPartyId: null,
      }),
    );
    expect(await inTx(v, (tx) => VENUE_SERVICE.findOrderZones(tx, v.cfg, [presented]))).toEqual(
      new Map([[presented, v.tables.zoneId]]),
    );
    expect(await inTx(v, (tx) => orderWatchZones(tx, v.cfg, orders))).toEqual(
      new Map([
        [tabId, v.tables.zoneId],
        [presented, v.tables.zoneId],
      ]),
    );
  });

  it("uses the surviving party's current table for a joined party's settled bill", async () => {
    const oldTable = await v.table("Watch joined old", terrace);
    const survivorTable = await v.table("Watch joined survivor", terrace);
    const indoorTable = await v.table("Watch joined indoor");
    const merged = await seat(v, oldTable);
    const survivor = await seat(v, survivorTable);
    await order(v, merged.tabId, "Burger");
    await pay(v, merged.tabId, "12.00");

    const sent = await commandFor(v, survivor.partyId);
    const other = await commandFor(v, merged.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, survivor.partyId, oldTable, {
        ...sent,
        bills: "separate",
        otherPartyId: merged.partyId,
        expectedOtherPartyRevision: other.expectedPartyRevision,
      }),
    );
    const moved = await commandFor(v, survivor.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, survivor.partyId, indoorTable, {
        ...moved,
        bills: "separate",
        otherPartyId: null,
      }),
    );

    const actualPartyId = (await billRow(v, merged.tabId)).partyId;
    expect(actualPartyId).toBe(merged.partyId);
    expect(await inTx(v, (tx) => VENUE_SERVICE.findOrderZones(tx, v.cfg, [merged.tabId]))).toEqual(
      new Map([[merged.tabId, terrace]]),
    );
    expect(
      await inTx(v, (tx) => orderWatchZones(tx, v.cfg, [partyBill(merged.tabId, actualPartyId!)])),
    ).toEqual(new Map([[merged.tabId, v.tables.zoneId]]));
  });

  it("uses delivery tables then recorded zones, and batches only unresolved orders", async () => {
    const outside = await v.table("Watch delivery", terrace);
    const delivered = randomUUID();
    await inTx(v, async (tx) => {
      await createOpenOrder(tx, v.cfg, delivered, [], null, { deliveryTableId: outside });
    });
    const recorded = await counterOrder(v, "Burger");
    const noZone = randomUUID();
    await inTx(v, async (tx) => {
      await createOpenOrder(tx, v.cfg, noZone, [], null);
    });
    const { partyId, tabId } = await seat(v, await v.table("Watch party"));
    const batch = vi.spyOn(VENUE_SERVICE, "findOrderZones");
    const orders = [
      partyBill(tabId, partyId),
      counterBill(delivered, outside),
      counterBill(recorded),
      counterBill(noZone),
    ];

    expect(await inTx(v, (tx) => orderWatchZones(tx, v.cfg, orders))).toEqual(
      new Map([
        [tabId, v.tables.zoneId],
        [delivered, terrace],
        [recorded, v.counter.zoneId],
        [noZone, null],
      ]),
    );
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[2]).toEqual([recorded, noZone]);
    batch.mockClear();
    expect(await inTx(v, (tx) => orderWatchZones(tx, v.cfg, [partyBill(tabId, partyId)]))).toEqual(
      new Map([[tabId, v.tables.zoneId]]),
    );
    expect(await inTx(v, (tx) => orderWatchZones(tx, v.cfg, []))).toEqual(new Map());
    expect(batch).not.toHaveBeenCalled();
    batch.mockRestore();

    await inTx(v, async (tx) => {
      await tx.update(diningTables).set({ zoneId: null }).where(eq(diningTables.id, outside));
    });
    expect(
      await inTx(v, (tx) => orderWatchZones(tx, v.cfg, [counterBill(delivered, outside)])),
    ).toEqual(new Map([[delivered, terrace]]));
  });
});
