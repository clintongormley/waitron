import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { floorZones, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining, DiningPolicy } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import {
  inTx,
  provisionBillVenue,
  send,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { observedMoveBillBody, takeIntoParty } from "./testing/move-bill-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";

// A bill moved within its own department keeps its way of selling; one that takes a department for
// the first time takes that department's way (A1522, Decision 6).
let venue: BillVenue;
let counterZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counterZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", paidWhen: "prepay" }),
      )
    ).zoneId;
  },
});

async function departmentsSell(dining: DiningPolicy): Promise<void> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments))
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
  });
}

beforeEach(() => departmentsSell("till_choice"));

function diningOf(id: string): Dining {
  return venue.db.all<{ dining: Dining }>(
    sql`select dining from working_orders where id = ${id}`,
  )[0]!.dining;
}

function setDining(id: string, dining: Dining): void {
  venue.db.run(sql`update working_orders set dining = ${dining} where id = ${id}`);
}

function revisionOf(partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

function ticketItemCount(billId: string): number {
  return venue.db.all<{ n: number }>(
    sql`select count(*) as n from ticket_items where working_order_line_id in
        (select id from working_order_lines where working_order_id = ${billId})`,
  )[0]!.n;
}

async function post(path: string, body: unknown) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    path,
    await observedMoveBillBody(venue.db, path, body),
  );
}

function moveTo(billId: string, tableId: string) {
  const own = venue.db.all<{ party_id: string | null }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
  const holder = venue.db.all<{ party_id: string }>(
    sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
  )[0]?.party_id;
  return post(`/api/bills/${billId}/move`, {
    to: { tableId },
    ...(own === null ? {} : { expectedPartyRevision: revisionOf(own) }),
    ...(holder === undefined
      ? {}
      : { otherPartyId: holder, expectedOtherPartyRevision: revisionOf(holder) }),
  });
}

async function departmentOf(zoneId: string): Promise<string> {
  const [zone] = await inTx(venue, (tx) =>
    tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId)),
  );
  return zone!.departmentId!;
}

describe("a bill moved within its own department keeps its way", () => {
  it("keeps a pay-first takeaway counter order takeaway when it moves to a seated table, which sends it", async () => {
    expect(await departmentOf(counterZone)).toBe(await departmentOf(venue.zoneId));
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
      dining: "takeaway",
    });
    const seated = await seatedWith(venue, "Caña");

    const moved = await moveTo(id, seated.tableId);

    expect(moved.status).toBe(200);
    expect(diningOf(id)).toBe("takeaway");
    expect(ticketItemCount(id)).toBeGreaterThan(0);
    const read = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ dining: "takeaway", diningChoice: "locked" });
  });

  it("keeps a takeaway bill takeaway when the whole bill moves to another table", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "takeaway");
    const table = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, {
        label: `Table ${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      }),
    );

    const moved = await moveTo(seated.tabId, table.id);

    expect(moved.status).toBe(200);
    expect(diningOf(seated.tabId)).toBe("takeaway");
  });

  it("keeps an unsent takeaway bill takeaway at the counter of its department, now selling eaten here", async () => {
    const seated = await seatedWith(venue);
    setDining(seated.tabId, "takeaway");
    await departmentsSell("eat_in");

    const moved = await post(`/api/bills/${seated.tabId}/move`, {
      to: { counter: { zoneId: counterZone } },
      partyId: seated.partyId,
      expectedPartyRevision: revisionOf(seated.partyId),
    });

    expect(moved.status).toBe(200);
    expect(diningOf(seated.tabId)).toBe("takeaway");
  });
});

describe("a bill that takes a department for the first time", () => {
  it("takes the way of a department fixed one way", async () => {
    const seated = await seatedWith(venue);
    await departmentsSell("takeaway");
    const order = await inTx(venue, (tx) =>
      seedWorkingOrder(tx, { orderNumber: 900_000 + Math.floor(Math.random() * 99_999) }),
    );
    expect(order.dining).toBe("eat_in");

    await inTx(venue, (tx) => takeIntoParty(tx, venue.cfg, order.id, seated.partyId, venue.zoneId));

    expect(diningOf(order.id)).toBe("takeaway");
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, order.id)),
    );
    expect(row).toEqual({ partyId: seated.partyId });
  });
});
