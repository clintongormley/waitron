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
} from "@waitron/menu";
import type { TrustedClock } from "@waitron/fiscal";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";

// Every case reads NOW, the latest record's time, and builds each clock from it, because each sale
// moves NOW for the cases after it.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const dish = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      dishId = dish.id;
      await assignCatalogueToVenue(tx, catalogue.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId] });
    });
    const first = await cashSale(venue.app, randomUUID());
    if (first.status !== 200) throw new Error(`setup sale answered ${first.status}`);
  },
});

const MINUTE = 60_000;

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const dish = () => [{ menuItemId: counter.offerFor(dishId), quantity: "1" }];

function cardSale(app: BillVenue["app"], id: string) {
  return send(app, venue.cookie, "POST", "/api/pay", { id, lines: dish(), zoneId: counter.zoneId });
}

function payStored(app: BillVenue["app"], id: string) {
  return send(app, venue.cookie, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId });
}

function cashSale(app: BillVenue["app"], id: string) {
  return send(app, venue.cookie, "POST", "/api/sales", {
    workingOrderId: id,
    zoneId: counter.zoneId,
    lines: dish(),
    tender: { method: "cash", amount: "10.00" },
  });
}

const collects = () => venue.card.collectCalls.length;

it("answers a replay of a settled order", async () => {
  const id = randomUUID();
  const first = await cardSale(venue.appAt(clockAt(nowMs())), id);
  expect(first.status).toBe(200);
  const behind = nowMs() - 10 * MINUTE;
  const before = collects();

  const replay = await payStored(venue.appAt(clockAt(behind)), id);

  expect(replay.status).toBe(200);
  expect(replay.json.outcome).toBe("captured");
  expect(replay.json.ticket).toEqual(first.json.ticket);
  expect(collects()).toBe(before);
});

it("sells again once the clock passes the record", async () => {
  const later = nowMs() + MINUTE;
  const before = collects();

  const sold = await cardSale(venue.appAt(clockAt(later)), randomUUID());

  expect(sold.status).toBe(200);
  expect(sold.json.outcome).toBe("captured");
  expect(collects()).toBe(before + 1);
  expect(latest().at.getTime()).toBe(later);
});
