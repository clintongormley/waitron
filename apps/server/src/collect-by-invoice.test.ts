import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { saleSettlements, sales } from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { collectOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Collecting a presented bill follows its issuance history, not its zone's service mode (spec §9).
// Each case retargets its placed bill's zone directly, and opens its own bill.
let venue: BillVenue;
let invoiceFirstZone: string;
let issueAtPaymentZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    invoiceFirstZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
      )
    ).zoneId;
    issueAtPaymentZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "tables", serviceMode: "prepay" }),
      )
    ).zoneId;
  },
});

async function placedTarta(zoneId: string): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  return id;
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function retarget(billId: string, zoneId: string): Promise<void> {
  await inTx(venue, (tx) => VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, billId, zoneId));
  const context = await inTx(venue, (tx) => VENUE_SERVICE.findOrderContext(tx, venue.cfg, billId));
  expect(context?.zoneId).toBe(zoneId);
}

function collectCash(billId: string) {
  return collectOrder(
    { db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { id: billId, lines: [], tender: { method: "cash", amount: "20.00" } },
    venue.operatorId,
  );
}

describe("collecting a presented bill follows its invoice, not its zone (spec §9)", () => {
  it("settles the invoice issued at placing, even once the bill's zone says to issue at payment", async () => {
    const id = await placedTarta(invoiceFirstZone);
    const issued = await salesOf(id);
    expect(issued).toEqual([{ id: expect.any(String), total: 1800, settledAt: null }]);
    await retarget(id, issueAtPaymentZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(issued[0]!.id);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("issues the invoice at payment for a bill placed without one, even once its zone says invoice first", async () => {
    const id = await placedTarta(issueAtPaymentZone);
    expect(await salesOf(id)).toEqual([]);
    await retarget(id, invoiceFirstZone);

    await collectCash(id);

    const after = await salesOf(id);
    expect(after).toHaveLength(1);
    expect(after[0]!.total).toBe(1800);
    expect(after[0]!.settledAt).not.toBeNull();
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });
});
