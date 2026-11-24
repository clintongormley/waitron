import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { products, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining, DiningPolicy } from "@waitron/shared";
import {
  clearRoutingCell,
  departments,
  setDepartmentSalePolicyField,
  setRoutingCell,
} from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";

// The till's order reads say how the order sells (its own stored way, whatever its department now
// says) and whether staff may still switch it (A1522, Decision 10).
let venue: BillVenue;
let counterZoneId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      await seedTakeawayProducts(tx);
      counterZoneId = (await offerProducts(tx)).zoneId;
      await offerProducts(tx, { zone: "tables" });
    });
  },
});

async function departmentsSell(dining: DiningPolicy, startsAs: Dining = "eat_in"): Promise<void> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
      await setDepartmentSalePolicyField(tx, id, "diningStartsAs", startsAs);
    }
  });
}

beforeEach(() => departmentsSell("eat_in"));

async function parked(dining?: Dining): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
    zoneId: counterZoneId,
    operatorId: venue.operatorId,
    ...(dining === undefined ? {} : { dining }),
  });
  return id;
}

async function heldRead(id: string): Promise<Record<string, unknown>> {
  const read = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
  expect(read.status).toBe(200);
  return read.json;
}

async function billRead(tabId: string): Promise<Record<string, unknown>> {
  const [order] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId)),
  );
  const read = await send(venue.app, venue.cookie, "GET", `/api/parties/${order!.partyId}/bills`);
  expect(read.status).toBe(200);
  const bills = read.json as unknown as Record<string, unknown>[];
  return bills.find((bill) => bill.workingOrderId === tabId)!;
}

describe("the till's order reads", () => {
  it("offers no switch on an order in a department fixed one way", async () => {
    const id = await parked();
    expect(await heldRead(id)).toMatchObject({ dining: "eat_in", diningChoice: "none" });
  });

  it("offers the switch on an unsent order in a till-choice department", async () => {
    await departmentsSell("till_choice", "takeaway");
    const id = await parked();
    expect(await heldRead(id)).toMatchObject({ dining: "takeaway", diningChoice: "open" });
  });

  it("offers no switch in a region without takeaway VAT, whatever the department says", async () => {
    await departmentsSell("till_choice");
    const id = await parked();
    const [taxpayer] = venue.db.all<{ country: string }>(sql`select country from taxpayer`);
    venue.db.run(sql`update taxpayer set country = 'GB'`);
    try {
      expect(await heldRead(id)).toMatchObject({ dining: "eat_in", diningChoice: "none" });
    } finally {
      venue.db.run(sql`update taxpayer set country = ${taxpayer!.country}`);
    }
  });

  it("locks the switch on a table bill once its dishes are sent", async () => {
    await departmentsSell("till_choice");
    // Handed over with no kitchen ticket, so nothing is sent until the send stamps it. The venue is
    // shared by the whole file, so the routing goes back after the case.
    const octopus = await inTx(venue, async (tx) => {
      const [row] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Octopus"));
      const address = { row: { kind: "product" as const, productId: row!.id }, zoneId: null };
      await setRoutingCell(tx, address, { kind: "no_preparation" });
      return address;
    });
    try {
      const tabId = await tabWith(venue, "Octopus");
      expect(await heldRead(tabId)).toMatchObject({ dining: "eat_in", diningChoice: "open" });
      expect(await billRead(tabId)).toMatchObject({ dining: "eat_in", diningChoice: "open" });
      const sent = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${tabId}/lines/send`,
        { lineNos: [1], expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)) },
      );
      expect(sent.status).toBe(200);
      expect(await billRead(tabId)).toMatchObject({ dining: "eat_in", diningChoice: "locked" });
    } finally {
      await inTx(venue, (tx) => clearRoutingCell(tx, octopus));
    }
  });

  it("reads a placed counter order's way as locked", async () => {
    await departmentsSell("till_choice", "takeaway");
    const id = await parked();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const read = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}/placed`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ dining: "takeaway", diningChoice: "locked" });
  });

  it("keeps a takeaway counter order's way when its department turns eaten here", async () => {
    await departmentsSell("till_choice", "takeaway");
    const id = await parked("takeaway");
    await departmentsSell("eat_in");
    expect(await heldRead(id)).toMatchObject({ dining: "takeaway", diningChoice: "none" });
  });

  it("keeps an open table bill eaten here when its department turns takeaway", async () => {
    const tabId = await tabWith(venue, "Croquettes");
    await departmentsSell("takeaway");
    expect(await heldRead(tabId)).toMatchObject({ dining: "eat_in", diningChoice: "none" });
    expect(await billRead(tabId)).toMatchObject({ dining: "eat_in", diningChoice: "none" });
  });
});
