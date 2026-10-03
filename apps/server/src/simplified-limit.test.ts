import { randomUUID } from "node:crypto";
import { Hono } from "hono";
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
import { floorZones } from "@waitron/db";
import type { Logger } from "./logger.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { mountTillApi } from "./till-api.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

// The simplified-invoice limit is the fiscal regime's (`FiscalBackend.simplifiedInvoiceLimit`,
// 3,010.00 under Veri*Factu). Every till path that enters, grows or pays an order refuses one that
// would go over it, before money moves or anything is written. Driven over HTTP against a venue
// that files real Veri*Factu records. `limited` is the till API with the regime's limit, as boot
// mounts it; the fixture's own `venue.app` carries none, and stands in for an order that grew
// before the limit existed, so the paying paths have something over the limit to refuse.
let venue: BillVenue;
let limited: Hono;
let counter: ZoneOffers;
let invoiceFirst: ZoneOffers;
let tables: ZoneOffers;
const product = new Map<string, string>();

const REFUSED = { code: "sale.total_exceeds_simplified_limit" };
const quiet: Logger = () => {};

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Banquetes" });
      const category = await createCategory(tx, { name: "Eventos" });
      for (const [name, unitPrice] of [
        ["Lote", "3010.00"],
        ["Mitad", "1600.00"],
        ["Céntimo", "0.01"],
      ] as const) {
        const created = await createProduct(tx, {
          catalogueId: cat.id,
          categoryId: category.id,
          name,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        });
        product.set(name, created.id);
      }
      await assignCatalogueToLocation(tx, venue.cfg.locationId, cat.id);
      const productIds = [...product.values()];
      counter = await offerProducts(tx, venue.cfg, { productIds });
      tables = await offerProducts(tx, venue.cfg, { zone: "tables", productIds });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra factura primero" })
        .returning({ id: floorZones.id });
      invoiceFirst = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: zone!.id },
        serviceMode: "invoice_first",
        productIds,
      });
    });
    const cfg: TillConfig = {
      ...venue.cfg,
      simplifiedInvoiceLimit: venue.backend.simplifiedInvoiceLimit,
    };
    limited = new Hono();
    mountTillApi(
      limited,
      {
        db,
        backend: venue.backend,
        clock: venue.clock,
        cfg,
        secureCookies: false,
        venueLocale: "es-ES",
        pool: venue.pool,
      },
      quiet,
    );
  },
});

type Basket = Record<string, number>;

function linesOf(offers: ZoneOffers, basket: Basket) {
  return Object.entries(basket).map(([name, quantity]) => ({
    menuItemId: offers.offerFor(product.get(name)!),
    quantity: String(quantity),
  }));
}

function count(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)} where ${where}`,
  );
  return row!.n;
}

function orderRow(id: string) {
  return venue.db.all<{ status: string; revision: number; payment_attempt_at: string | null }>(
    sql`select status, revision, payment_attempt_at from working_orders where id = ${id}`,
  )[0];
}

/** The order's stored lines, as `lineNo:quantity` in thousandths. */
function storedLines(id: string): string[] {
  return venue.db
    .all<{ line_no: number; quantity: number }>(
      sql`select line_no, quantity from working_order_lines where working_order_id = ${id} order by line_no`,
    )
    .map((row) => `${row.line_no}:${row.quantity}`);
}

/** Everything a refused path must leave alone, venue-wide. */
function written() {
  return {
    sales: count("sales"),
    billPayments: count("bill_payments"),
    payments: count("payments"),
    collects: venue.card.collectCalls.length,
  };
}

/** A party seated at a fresh table through `app`, with `basket` sent to the kitchen on its main
 * bill. */
async function seated(app: Hono, basket: Basket) {
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `M-${randomUUID().slice(0, 8)}`, zoneId: tables.zoneId }),
  );
  const seat = await send(app, venue.cookie, "POST", `/api/tables/${table.id}/seat`, {});
  expect(seat.status).toBe(200);
  const partyId = seat.json.partyId as string;
  const tabId = seat.json.tabId as string;
  if (Object.keys(basket).length > 0) {
    const ordered = await send(app, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: seat.json.revision,
      groups: [{ lines: linesOf(tables, basket), release: "fire" }],
    });
    expect(ordered.status).toBe(200);
  }
  return { partyId, tabId };
}

function partyRevision(partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

/** A counter order parked through `app`. */
async function parked(app: Hono, offers: ZoneOffers, basket: Basket): Promise<string> {
  const id = randomUUID();
  const answer = await send(app, venue.cookie, "POST", "/api/working-orders", {
    id,
    lines: linesOf(offers, basket),
    zoneId: offers.zoneId,
  });
  expect(answer.status).toBe(200);
  return id;
}

describe("a counter sale", () => {
  function cashSale(basket: Basket, id = randomUUID()) {
    return send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: linesOf(counter, basket),
      zoneId: counter.zoneId,
      tender: { method: "cash", amount: "4000.00" },
    });
  }

  it("is filed at exactly the limit", async () => {
    const answer = await cashSale({ Lote: 1 });
    expect(answer.status).toBe(200);
    expect(answer.json.total).toBe("3010.00");
  });

  it("is refused a cent over the limit, with no sale and no order written", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await cashSale({ Lote: 1, Céntimo: 1 }, id);
    expect(answer).toEqual({
      status: 409,
      json: { ...REFUSED, params: { total: "3010.01", limit: "3010.00" } },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
  });

  it("paid in cash from a stored order over the limit is refused, filing nothing", async () => {
    const id = await parked(venue.app, counter, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "4000.00" },
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("open");
  });
});

describe("a card on the integrated reader", () => {
  it("is refused for a walk-up basket over the limit before the reader is asked", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/pay", {
      id,
      lines: linesOf(counter, { Lote: 1, Céntimo: 1 }),
      zoneId: counter.zoneId,
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
  });

  it("is refused for an open bill over the limit before the reader is asked, leaving no mark", async () => {
    const { tabId } = await seated(venue.app, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(limited, venue.cookie, "POST", "/api/pay", { id: tabId, lines: [] });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
    expect(orderRow(tabId)!.payment_attempt_at).toBeNull();
  });
});

describe("a bill payment", () => {
  it("in cash is refused on a bill over the limit, writing no payment", async () => {
    const { tabId } = await seated(venue.app, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(
      limited,
      venue.cookie,
      "POST",
      `/api/working-orders/${tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "10.00",
        applied: "10.00",
        tip: "0.00",
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
  });

  it("on the reader is refused on a bill over the limit before the reader is asked", async () => {
    const { tabId } = await seated(venue.app, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(
      limited,
      venue.cookie,
      "POST",
      `/api/working-orders/${tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "card",
        entry: "reader",
        applied: "10.00",
        tip: "0.00",
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
  });
});

describe("placing a counter order that is invoiced when placed", () => {
  it("is refused over the limit, filing no invoice and leaving the order open", async () => {
    const id = await parked(venue.app, invoiceFirst, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(limited, venue.cookie, "POST", `/api/working-orders/${id}/place`, {});
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("open");
  });
});

describe("an unpaid departure", () => {
  it("is refused when a bill it would invoice is over the limit, leaving the party open", async () => {
    const { partyId, tabId } = await seated(venue.app, { Lote: 1, Céntimo: 1 });
    const before = written();
    const answer = await send(
      limited,
      venue.cookie,
      "POST",
      `/api/parties/${partyId}/unpaid-departure`,
      {
        expectedPartyRevision: partyRevision(partyId),
        reason: "Se marcharon",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(written()).toEqual(before);
    expect(orderRow(tabId)!.status).toBe("open");
    expect(count("unpaid_departures")).toBe(0);
  });
});

describe("an edit that grows an order", () => {
  it("parking a basket over the limit is refused, writing no order", async () => {
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/working-orders", {
      id,
      lines: linesOf(counter, { Lote: 1, Céntimo: 1 }),
      zoneId: counter.zoneId,
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(orderRow(id)).toBeUndefined();
  });

  it("a held order's update over the limit is refused and the stored lines stay; up to it is saved", async () => {
    const id = await parked(limited, counter, { Mitad: 1 });
    const revision = orderRow(id)!.revision;
    const over = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Mitad: 1, Lote: 1 }),
      revision,
    });
    expect(over.status).toBe(409);
    expect(over.json.code).toBe(REFUSED.code);
    expect(storedLines(id)).toEqual(["1:1000"]);
    expect(orderRow(id)!.revision).toBe(revision);

    const atLimit = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Lote: 1 }),
      revision,
    });
    expect(atLimit.status).toBe(200);
  });

  it("a quantity raised over the limit on one line is refused, and the quantity stays", async () => {
    const { tabId } = await seated(limited, { Mitad: 1 });
    const answer = await send(
      limited,
      venue.cookie,
      "PUT",
      `/api/working-orders/${tabId}/lines/1`,
      {
        quantity: "2",
        revision: orderRow(tabId)!.revision,
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(tabId)).toEqual(["1:1000"]);
  });

  it("a round taking a table's bill over the limit is refused, and the bill keeps its lines", async () => {
    const { partyId, tabId } = await seated(limited, { Lote: 1 });
    const answer = await send(limited, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: partyRevision(partyId),
      groups: [{ lines: linesOf(tables, { Céntimo: 1 }), release: "fire" }],
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(tabId)).toEqual(["1:1000"]);
  });

  /** A party whose main bill holds `main` and whose second bill holds `second`, made through the
   * unlimited routes, since the two together may be over the limit. */
  async function twoBills(main: Basket, second: Basket) {
    const { partyId, tabId } = await seated(venue.app, { ...main, ...second });
    const secondLines = storedLines(tabId)
      .slice(Object.keys(main).length)
      .map((entry) => ({ lineNo: Number(entry.split(":")[0]) }));
    const split = await send(venue.app, venue.cookie, "POST", `/api/bills/${tabId}/split`, {
      transfers: secondLines,
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(split.status).toBe(200);
    return { partyId, mainBill: tabId, secondBill: split.json.billId as string };
  }

  it("merging two bills into one over the limit is refused, and both keep their lines", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Mitad: 1 }, { Lote: 1 });
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${mainBill}/merge`, {
      fromBillId: secondBill,
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(mainBill)).toHaveLength(1);
    expect(storedLines(secondBill)).toHaveLength(1);
  });

  it("moving a whole line onto a bill that would go over the limit is refused", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Céntimo: 1 }, { Lote: 1 });
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${secondBill}/transfer`, {
      toBillId: mainBill,
      transfers: [{ lineNo: 1 }],
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(mainBill)).toHaveLength(1);
    expect(storedLines(secondBill)).toHaveLength(1);
  });

  it("moving part of a line onto a bill that would go over the limit is refused", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Céntimo: 1 }, { Lote: 1 });
    // The second bill's one line grows to two, as an order that grew before the limit existed,
    // so a part of it can move.
    venue.db.run(
      sql`update working_order_lines set quantity = 2000, line_total = 602000 where working_order_id = ${secondBill}`,
    );
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${secondBill}/transfer`, {
      toBillId: mainBill,
      transfers: [{ lineNo: 1, quantity: "1" }],
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(mainBill)).toEqual(["1:1000"]);
    expect(storedLines(secondBill)).toEqual(["1:2000"]);
  });
});
