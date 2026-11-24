import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import type { TrustedClock } from "@waitron/fiscal";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let productId = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const menu = await createMenu(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      productId = product.id;
      await assignMenuToVenue(tx, menu.id);
      counter = await offerProducts(tx, { productIds: [productId] });
    });
  },
});

function clockAt(iso: string): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(iso), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

function count(table: string): number {
  const [row] = venue.db.all<{ n: number }>(sql`select count(*) as n from ${sql.raw(table)}`);
  return row!.n;
}

function ledger() {
  const [series] = venue.db.all<{ next: number }>(
    sql`select (select coalesce(max(sales.invoice_number), 0) + 1 from sales where sales.series_id = invoice_series.id) as next from invoice_series where id = ${venue.seriesId}`,
  );
  return {
    sales: count("sales"),
    registros: count("verifactu_records"),
    nextNumber: series!.next,
  };
}

function cashSale(iso: string, workingOrderId: string) {
  return send(
    venue.appAt(clockAt(iso)),
    venue.cookie,
    "POST",
    `/api/working-orders/${workingOrderId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "10.00",
      dining: "eat_in",
      basket: {
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(productId), quantity: "1" }],
      },
    },
  );
}

it("refuses a cash sale under a clock in 2001 by name, and records no sale, fiscal record, invoice number or order", async () => {
  const id = randomUUID();
  const before = ledger();

  const answer = await cashSale("2001-01-01T11:00:00.000Z", id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({
    code: "clock.unusable",
    params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
  });
  expect(ledger()).toEqual(before);
  expect(venue.db.all(sql`select id from working_orders where id = ${id}`)).toEqual([]);
});

it("records the same sale at 00:00 local on 28-10-2024", async () => {
  const before = ledger();

  const answer = await cashSale("2024-10-27T23:00:00.000Z", randomUUID());

  expect(answer.status).toBe(200);
  expect(ledger().sales).toBe(before.sales + 1);
});
