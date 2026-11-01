import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
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
      const catalogue = await createCatalogue(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      productId = product.id;
      await assignCatalogueToVenue(tx, catalogue.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [productId] });
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
    sql`select next_number as next from invoice_series where id = ${venue.seriesId}`,
  );
  return {
    sales: count("sales"),
    registros: count("registros_facturacion"),
    nextNumber: series!.next,
  };
}

function cashSale(iso: string, workingOrderId: string) {
  return send(venue.appAt(clockAt(iso)), venue.cookie, "POST", "/api/sales", {
    workingOrderId,
    lines: [{ menuItemId: counter.offerFor(productId), quantity: "1" }],
    zoneId: counter.zoneId,
    tender: { method: "cash", amount: "10.00" },
  });
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

// No case in this file records a sale dated after this one: a later-dated record would trip the
// clock-behind stop (A798-B slice 8) rather than test the first issue date.
it("records the same sale at 00:00 local on 28-10-2024", async () => {
  const before = ledger();

  const answer = await cashSale("2024-10-27T23:00:00.000Z", randomUUID());

  expect(answer.status).toBe(200);
  expect(ledger().sales).toBe(before.sales + 1);
});
