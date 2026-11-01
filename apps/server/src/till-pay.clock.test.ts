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
import { parkOrder } from "./working-order.js";
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

const dish = () => [{ menuItemId: counter.offerFor(productId), quantity: "1" }];

function cardSale(iso: string, id: string) {
  return send(venue.appAt(clockAt(iso)), venue.cookie, "POST", "/api/pay", {
    id,
    lines: dish(),
    zoneId: counter.zoneId,
  });
}

function payStored(iso: string, id: string) {
  return send(venue.appAt(clockAt(iso)), venue.cookie, "POST", "/api/pay", {
    id,
    lines: [],
    zoneId: counter.zoneId,
  });
}

const collects = () => venue.card.collectCalls.length;

function rows(table: string, column: string, id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`,
  );
  return row!.n;
}

it("refuses a walk-up card sale under a clock in 2001, naming the clock, before the reader", async () => {
  const id = randomUUID();
  const before = collects();

  const answer = await cardSale("2001-01-01T11:00:00.000Z", id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({
    code: "clock.unusable",
    params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
  });
  expect(collects()).toBe(before);
  expect(rows("working_orders", "id", id)).toBe(0);
  expect(rows("payments", "working_order_id", id)).toBe(0);
});

it("refuses a stored open order under a clock in 2001 before the reader, and leaves no attempt mark", async () => {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, { id, lines: dish(), zoneId: counter.zoneId });
  const before = collects();

  const answer = await payStored("2001-01-01T11:00:00.000Z", id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({
    code: "clock.unusable",
    params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
  });
  expect(collects()).toBe(before);
  expect(
    venue.db.all(
      sql`select status, payment_attempt_at as attemptAt from working_orders where id = ${id}`,
    ),
  ).toEqual([{ status: "open", attemptAt: null }]);
});

// Cases recording a later-dated sale run after this one: such a record would trip the clock-behind
// stop (A798-B slice 8) rather than test the first issue date.
it("refuses at 23:59:59.999 local on 27-10-2024, and asks the reader at 00:00 local on 28-10-2024", async () => {
  const before = collects();

  const refused = await cardSale("2024-10-27T22:59:59.999Z", randomUUID());

  expect(refused.status).toBe(409);
  expect(refused.json).toEqual({
    code: "clock.unusable",
    params: { clockAt: "2024-10-27T22:59:59.999Z", offsetMinutes: 60 },
  });
  expect(collects()).toBe(before);

  const sold = await cardSale("2024-10-27T23:00:00.000Z", randomUUID());

  expect(sold.status).toBe(200);
  expect(sold.json.outcome).toBe("captured");
  expect(collects()).toBe(before + 1);
});

// Runs after the 28-10-2024 control on purpose: it records a sale dated after it.
it("replays a settled card sale under a clock in 2001 without asking the reader", async () => {
  const id = randomUUID();
  const first = await cardSale("2024-10-28T10:00:00.000Z", id);
  expect(first.status).toBe(200);
  const before = collects();

  const replay = await payStored("2001-01-01T11:00:00.000Z", id);

  expect(replay.status).toBe(200);
  expect(replay.json.outcome).toBe("captured");
  expect(collects()).toBe(before);
});
