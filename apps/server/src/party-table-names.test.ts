import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { partyTables } from "@waitron/db";
import { finishTable } from "./parties.js";
import { joinTables } from "./table-actions.js";
import { listOrders, type OrderListFilter } from "./orders-list.js";
import { readReceiptOrder } from "./receipt-order.js";
import { updateTable } from "./tables.js";
import {
  commandFor,
  inTx,
  join,
  order,
  partyRow,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function finish(partyId: string): Promise<void> {
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
}

async function membershipRows(partyId: string) {
  return inTx(v, (tx) => tx.select().from(partyTables).where(eq(partyTables.partyId, partyId)));
}

async function listed(filter: Partial<OrderListFilter>): Promise<string[]> {
  const page = await inTx(v, (tx) =>
    listOrders(tx, {
      status: "all",
      dates: "any",
      credited: false,
      limit: 200,
      scope: "all",
      ...filter,
    }),
  );
  return page.rows.map((row) => row.id);
}

describe("a closing party keeps its table names", () => {
  it("copies the names of every table the party held, in order, and lets go of the tables", async () => {
    const t4 = await v.table("Terrace 4");
    const t5 = await v.table("Terrace 5");
    const { partyId } = await seat(v, t4);
    await join(v, partyId, t5);
    await finish(partyId);
    expect((await partyRow(v, partyId)).tableNames).toEqual(["Terrace 4", "Terrace 5"]);
    expect(await membershipRows(partyId)).toEqual([]);
  });

  it("keeps the old name on the closed party, its listed bill and its reprinted receipt after the table is renamed", async () => {
    const table = await v.table("Porch 4");
    const { partyId, tabId } = await seat(v, table);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    await finish(partyId);
    await inTx(v, (tx) => updateTable(tx, v.cfg, table, { label: "Patio 4" }));

    expect((await partyRow(v, partyId)).tableNames).toEqual(["Porch 4"]);
    const page = await inTx(v, (tx) =>
      listOrders(tx, {
        status: "all",
        dates: "any",
        credited: false,
        limit: 1,
        scope: "all",
        only: tabId,
      }),
    );
    expect(page.rows[0]!.tables).toEqual(["Porch 4"]);
    const receipt = await inTx(v, (tx) => readReceiptOrder(tx, v.cfg, tabId));
    expect(receipt.orderLabel).toContain("Porch 4");
  });

  it("copies the names of a party merged into another when the merge closes it", async () => {
    const t1 = await v.table("Merge 1");
    const t2 = await v.table("Merge 2");
    const a = await seat(v, t1);
    const b = await seat(v, t2);
    const sent = await commandFor(v, a.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, t2, {
        ...sent,
        bills: "separate",
        otherPartyId: b.partyId,
        expectedOtherPartyRevision: b.revision,
      }),
    );
    const closed = await partyRow(v, b.partyId);
    expect(closed.state).toBe("closed");
    expect(closed.tableNames).toEqual(["Merge 2"]);
    expect(await membershipRows(b.partyId)).toEqual([]);
  });

  it("finds a closed party in the order list by an old table name and filters by it", async () => {
    const table = await v.table("Garden 7");
    const { partyId, tabId } = await seat(v, table);
    await order(v, tabId, "Agua");
    await pay(v, tabId, "2.00");
    await finish(partyId);
    await inTx(v, (tx) => updateTable(tx, v.cfg, table, { label: "Lawn 7" }));

    expect(await listed({ search: "Garden" })).toContain(tabId);
    expect(await listed({ table: "garden 7" })).toContain(tabId);
    expect(await listed({ search: "Lawn" })).not.toContain(tabId);
    expect(await listed({ table: "Lawn 7" })).not.toContain(tabId);
  });

  it("still finds an open party by its live table name", async () => {
    const table = await v.table("Balcony 3");
    const { tabId } = await seat(v, table);
    await order(v, tabId, "Agua");
    expect(await listed({ search: "Balcony" })).toContain(tabId);
    expect(await listed({ table: "Balcony 3" })).toContain(tabId);
  });
});
