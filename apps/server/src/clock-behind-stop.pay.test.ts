import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import type { TrustedClock } from "@waitron/fiscal";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import { parkOrder } from "./working-order.js";
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
      await assignCatalogueToLocation(tx, venue.cfg.locationId, catalogue.id);
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
    order by fecha_hora_huso_gen_registro desc
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

/** Starts at `ms` and reads `stepMs` later at every reading after. */
function tickingClock(ms: number, stepMs: number): TrustedClock {
  const base = systemClock();
  let readings = 0;
  return {
    ...base,
    now: () => ({
      ...base.now(),
      instant: new Date(ms + stepMs * readings++),
      offsetMinutes: 60,
    }),
  };
}

function behindChain(clockMs: number) {
  const record = latest();
  return {
    code: "clock.behind_chain",
    params: {
      clockAt: new Date(clockMs).toISOString(),
      offsetMinutes: 60,
      lastRecordAt: record.at.toISOString(),
      lastRecordOffsetMinutes: record.offsetMinutes,
    },
  };
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

function rows(table: string, column: string, id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`,
  );
  return row!.n;
}

function tendersOfOrder(id: string): number {
  const [row] = venue.db.all<{ n: number }>(sql`
    select count(*) as n from tenders t join sales s on s.id = t.sale_id
    where s.working_order_id = ${id}
  `);
  return row!.n;
}

function orderRow(id: string): { status: string; attemptAt: string | null } {
  const [row] = venue.db.all<{ status: string; attemptAt: string | null }>(
    sql`select status, payment_attempt_at as attemptAt from working_orders where id = ${id}`,
  );
  return row!;
}

async function placedIssuedOrder(clock: TrustedClock): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: dish(),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  await placeOrder(deps, venue.cfg, id, venue.operatorId);
  return id;
}

it("refuses a counter card sale with no saved order before the reader", async () => {
  const behind = nowMs() - 10 * MINUTE;
  const id = randomUUID();
  const before = collects();

  const answer = await cardSale(venue.appAt(clockAt(behind)), id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(rows("working_orders", "id", id)).toBe(0);
  expect(rows("payments", "working_order_id", id)).toBe(0);
});

it("refuses a card payment of an order whose invoice was filed before the reader", async () => {
  const now = nowMs();
  const id = await placedIssuedOrder(clockAt(now));
  const behind = nowMs() - 10 * MINUTE;
  const records = registroCount(venue, id);
  const before = collects();

  const answer = await payStored(venue.appAt(clockAt(behind)), id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(orderRow(id)).toEqual({ status: "placed", attemptAt: null });
  expect(rows("payments", "working_order_id", id)).toBe(0);
  expect(registroCount(venue, id)).toBe(records);
});

it("refuses a stored open order before the reader and leaves no attempt mark", async () => {
  const behind = nowMs() - 10 * MINUTE;
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, { id, lines: dish(), zoneId: counter.zoneId });
  const before = collects();

  const answer = await payStored(venue.appAt(clockAt(behind)), id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(orderRow(id)).toEqual({ status: "open", attemptAt: null });
  expect(rows("payments", "working_order_id", id)).toBe(0);
  expect(registroCount(venue, id)).toBe(0);
});

it("refuses a cash collection of a filed order and writes no settlement", async () => {
  const id = await placedIssuedOrder(clockAt(nowMs()));
  const behind = nowMs() - 10 * MINUTE;
  const records = registroCount(venue, id);
  const before = collects();

  const answer = await send(
    venue.appAt(clockAt(behind)),
    venue.cookie,
    "POST",
    `/api/working-orders/${id}/collect`,
    { tender: { method: "cash", amount: "10.00" } },
  );

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(tendersOfOrder(id)).toBe(0);
  expect(orderRow(id).status).toBe("placed");
  expect(registroCount(venue, id)).toBe(records);
});

it("refuses a cash sale on /api/sales and writes nothing", async () => {
  const behind = nowMs() - 10 * MINUTE;
  const id = randomUUID();
  const before = collects();

  const answer = await cashSale(venue.appAt(clockAt(behind)), id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(rows("working_orders", "id", id)).toBe(0);
  expect(rows("sales", "working_order_id", id)).toBe(0);
});

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

it("takes a card a minute inside the margin", async () => {
  const now = nowMs();
  const before = collects();

  const sold = await cardSale(venue.appAt(clockAt(now - MINUTE)), randomUUID());

  expect(sold.status).toBe(200);
  expect(sold.json.outcome).toBe("captured");
  expect(collects()).toBe(before + 1);

  const id = randomUUID();
  const refused = await cardSale(venue.appAt(clockAt(now - MINUTE - 1000)), id);

  expect(refused.status).toBe(409);
  expect(refused.json).toEqual(behindChain(now - MINUTE - 1000));
  expect(collects()).toBe(before + 1);
  expect(rows("working_orders", "id", id)).toBe(0);
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

it("judges the request's first reading", async () => {
  const first = nowMs() - MINUTE - 1000;
  const card = randomUUID();
  const before = collects();

  const refused = await cardSale(venue.appAt(tickingClock(first, 2 * MINUTE)), card);

  expect(refused.status).toBe(409);
  expect(refused.json).toEqual(behindChain(first));
  expect(collects()).toBe(before);
  expect(rows("working_orders", "id", card)).toBe(0);
  expect(rows("payments", "working_order_id", card)).toBe(0);

  const cash = randomUUID();
  const refusedCash = await cashSale(venue.appAt(tickingClock(first, 2 * MINUTE)), cash);

  expect(refusedCash.status).toBe(409);
  expect(refusedCash.json).toEqual(behindChain(first));
  expect(rows("working_orders", "id", cash)).toBe(0);
  expect(rows("sales", "working_order_id", cash)).toBe(0);
});
