import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { diskFullIn } from "@waitron/shared";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let productId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: "Soft drinks" });
      const created = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: category.id,
        name: "Lemonade",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      productId = created.id;
      await assignCatalogueToLocation(tx, venue.cfg.locationId, cat.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [productId] });
    });
  },
});

const DISK_FULL = { code: "storage.disk_full", params: {} };

function fillDatabase(): void {
  venue.db.all(sql.raw("create table if not exists ballast (id integer primary key, pad blob)"));
  const [{ page_count }] = venue.db.all<{ page_count: number }>(sql.raw("pragma page_count"));
  venue.db.all(sql.raw(`pragma max_page_count = ${page_count + 2}`));
  for (;;) {
    try {
      venue.db.all(sql.raw("insert into ballast (pad) values (zeroblob(16))"));
    } catch (error) {
      expect(diskFullIn(error)).toBe(true);
      return;
    }
  }
}

function liftLimit(): void {
  venue.db.all(sql.raw("pragma max_page_count = 4294967294"));
}

function lines(n: number) {
  return Array.from({ length: n }, () => ({
    menuItemId: counter.offerFor(productId),
    quantity: "1",
  }));
}

function cashSale(n: number) {
  return send(venue.app, venue.cookie, "POST", "/api/sales", {
    workingOrderId: randomUUID(),
    lines: lines(n),
    zoneId: counter.zoneId,
    tender: { method: "cash", amount: `${10 * n}.00` },
  });
}

function count(table: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return row!.n;
}

function counts() {
  return {
    sales: count("sales"),
    registros: count("registros_facturacion"),
    envios: count("envios"),
    workingOrders: count("working_orders"),
  };
}

describe("a full database", () => {
  it("refuses a cash sale on a full database with storage.disk_full and writes neither the sale nor its record", async () => {
    try {
      fillDatabase();
      const before = counts();
      // A one-line sale fitted into pages already allocated (plan, "Measured for this plan", E12); a
      // 20-line one did not.
      expect(await cashSale(20)).toEqual({ status: 507, json: DISK_FULL });
      expect(counts()).toEqual(before);
    } finally {
      liftLimit();
    }
  });

  it("sells again once the limit is lifted", async () => {
    try {
      fillDatabase();
      liftLimit();
      const before = counts();
      const answer = await cashSale(20);
      expect(answer.status).toBe(200);
      const after = counts();
      expect(after.sales).toBe(before.sales + 1);
      expect(after.registros).toBe(before.registros + 1);
      expect(after.envios).toBe(before.envios + 1);
    } finally {
      liftLimit();
    }
  });

  it("refuses parking a counter order on a full database", async () => {
    try {
      fillDatabase();
      const before = counts();
      const answer = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
        id: randomUUID(),
        lines: lines(20),
        zoneId: counter.zoneId,
      });
      expect(answer).toEqual({ status: 507, json: DISK_FULL });
      expect(counts()).toEqual(before);
    } finally {
      liftLimit();
    }
  });
});
