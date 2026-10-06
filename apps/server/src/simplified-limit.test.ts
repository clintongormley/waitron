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
        ["Gratis", "0.00"],
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
        serviceMode: "ticket_then_pay",
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

/** A party whose main bill holds `main` and whose second bill holds `second`, made through the
 * unlimited routes, since either or both may be over the limit. */
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

  it("does not file an explicit walk-up F1 request as F2", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: linesOf(counter, { Mitad: 1 }),
      zoneId: counter.zoneId,
      tender: { method: "cash", amount: "1600.00" },
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
  });

  it.each([
    ["/api/sales", false],
    ["/api/sales", true],
    ["/api/pay", false],
    ["/api/pay", true],
  ] as const)(
    "refuses zero-total F1 at %s with stored choice %s without filing or charging",
    async (path, stored) => {
      venue.db.run(
        sql`update tenants set taxpayer_domicile = 'Calle Mayor 1, 28013 Madrid, Madrid, España'`,
      );
      const id = stored ? await parked(venue.app, counter, { Gratis: 1 }) : randomUUID();
      const recipient = {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      };
      if (stored) {
        venue.db.run(sql`update working_orders set invoice_type = 'F1',
          recipient_tax_id = ${recipient.taxId}, recipient_legal_name = ${recipient.legalName},
          recipient_address = ${recipient.address}, recipient_country_code = ${recipient.countryCode}
          where id = ${id}`);
      }
      const before = written();
      const beforeOrder = venue.db.all(sql`select * from working_orders where id = ${id}`);
      const beforeSeries = venue.db.all(sql`select * from invoice_series order by id`);
      const beforeFiscal = venue.db.all(sql`select * from registros_facturacion order by id`);
      const beforeJobs = venue.db.all(sql`select * from print_jobs order by id`);

      const answer = await send(limited, venue.cookie, "POST", path, {
        ...(path === "/api/sales"
          ? { workingOrderId: id, tender: { method: "cash", amount: "0.00" } }
          : { id }),
        lines: stored ? [] : linesOf(counter, { Gratis: 1 }),
        zoneId: counter.zoneId,
        ...(stored ? {} : { invoiceType: "F1", recipient }),
      });

      expect(answer).toEqual({
        status: 409,
        json: { code: "sale.full_invoice_unavailable", params: {} },
      });
      expect(written()).toEqual(before);
      expect(venue.db.all(sql`select * from working_orders where id = ${id}`)).toEqual(beforeOrder);
      expect(venue.db.all(sql`select * from invoice_series order by id`)).toEqual(beforeSeries);
      expect(venue.db.all(sql`select * from registros_facturacion order by id`)).toEqual(
        beforeFiscal,
      );
      expect(venue.db.all(sql`select * from print_jobs order by id`)).toEqual(beforeJobs);
    },
  );

  it("replays a settled cash sale despite a later F1 request", async () => {
    const id = randomUUID();
    const first = await cashSale({ Mitad: 1 }, id);
    expect(first.status).toBe(200);
    const before = written();

    const replay = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "0.00" },
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });

    expect(replay).toEqual(first);
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("settled");
  });

  it("refuses a non-scalar walk-up invoice type before filing", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: linesOf(counter, { Mitad: 1 }),
      zoneId: counter.zoneId,
      tender: { method: "cash", amount: "1600.00" },
      invoiceType: ["F2"],
    });

    expect(answer).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "invoiceType" } },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
  });

  it("refuses a recipient on an explicit F2 walk-up sale", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: linesOf(counter, { Mitad: 1 }),
      zoneId: counter.zoneId,
      tender: { method: "cash", amount: "1600.00" },
      invoiceType: "F2",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });

    expect(answer).toEqual({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "recipient" } },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
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

  it("does not charge a stored F1 order as an F2 cash sale", async () => {
    const id = await parked(venue.app, counter, { Mitad: 1 });
    venue.db.run(sql`update working_orders set invoice_type = 'F1',
      recipient_tax_id = 'B12345674', recipient_legal_name = 'Cliente SL',
      recipient_address = 'Calle Mayor 2, 28013 Madrid', recipient_country_code = 'ES'
      where id = ${id}`);
    const before = written();

    const answer = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "1600.00" },
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("open");
  });
});

describe("a card on the integrated reader", () => {
  it("does not charge an existing open order that explicitly requests F1", async () => {
    const id = await parked(venue.app, counter, { Mitad: 1 });
    const before = written();

    const answer = await send(limited, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.payment_attempt_at).toBeNull();
  });

  it("does not ask the reader to file an explicit walk-up F1 request as F2", async () => {
    const before = written();
    const id = randomUUID();
    const answer = await send(limited, venue.cookie, "POST", "/api/pay", {
      id,
      lines: linesOf(counter, { Mitad: 1 }),
      zoneId: counter.zoneId,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)).toBeUndefined();
  });

  it("does not ask the reader for a stored F1 order while original delivery is unavailable", async () => {
    const id = await parked(venue.app, counter, { Mitad: 1 });
    venue.db.run(sql`update working_orders set invoice_type = 'F1',
      recipient_tax_id = 'B12345674', recipient_legal_name = 'Cliente SL',
      recipient_address = 'Calle Mayor 2, 28013 Madrid', recipient_country_code = 'ES'
      where id = ${id}`);
    const before = written();

    const answer = await send(limited, venue.cookie, "POST", "/api/pay", { id, lines: [] });

    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.payment_attempt_at).toBeNull();
  });

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
it("does not file a saved F1 choice while original delivery is unavailable", async () => {
    const id = await parked(venue.app, invoiceFirst, { Mitad: 1 });
    venue.db.run(sql`update working_orders set invoice_type = 'F1',
      recipient_tax_id = 'B12345674', recipient_legal_name = 'Cliente SL',
      recipient_address = 'Calle Mayor 2, 28013 Madrid', recipient_country_code = 'ES'
      where id = ${id}`);
    const before = written();

    const answer = await send(limited, venue.cookie, "POST", `/api/working-orders/${id}/place`, {});

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual({ code: "sale.full_invoice_unavailable", params: {} });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("open");
  });

  it("allows an order at the limit to be placed without filing or taking money", async () => {
    const id = await parked(venue.app, invoiceFirst, { Lote: 1 });
    const before = written();
    const answer = await send(limited, venue.cookie, "POST", `/api/working-orders/${id}/place`, {});
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ id, status: "placed" });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("placed");
  });

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

describe("growing a bill with a saved full-invoice choice", () => {
  const recipient = {
    taxId: "B12345674",
    legalName: "Cliente SL",
    address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
    countryCode: "ES",
  };

  async function chooseFull(id: string) {
    const saved = await send(
      limited,
      venue.cookie,
      "PUT",
      `/api/working-orders/${id}/invoice-choice`,
      {
        revision: orderRow(id)!.revision,
        invoiceType: "F1",
        recipient,
      },
    );
    expect(saved.status).toBe(200);
  }

  function savedChoice(id: string) {
    return venue.db.all(sql`select invoice_type, recipient_tax_id, recipient_legal_name,
      recipient_address, recipient_country_code from working_orders where id = ${id}`)[0];
  }

  it("saves a held F1 basket above the simplified ceiling without issuing it", async () => {
    const id = await parked(limited, counter, { Mitad: 1 });
    await chooseFull(id);
    const before = written();
    const choice = savedChoice(id);
    const revision = orderRow(id)!.revision;

    const updated = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Mitad: 2 }),
      revision,
    });

    expect(updated.json.code).toBeUndefined();
    expect(updated.status).toBe(200);
    expect(storedLines(id)).toEqual(["2:2000"]);
    expect(orderRow(id)!.revision).toBe(revision + 1);
    expect(savedChoice(id)).toEqual(choice);
    expect(written()).toEqual(before);

    const paid = await send(limited, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "3200.00" },
    });
    expect(paid).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    const card = await send(limited, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    expect(card).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(written()).toEqual(before);
    expect(orderRow(id)!.status).toBe("open");
  });

  it("raises a saved F1 table line above the simplified ceiling without taking money", async () => {
    const { tabId } = await seated(limited, { Mitad: 1 });
    await chooseFull(tabId);
    const before = written();
    const choice = savedChoice(tabId);

    const updated = await send(
      limited,
      venue.cookie,
      "PUT",
      `/api/working-orders/${tabId}/lines/1`,
      {
        quantity: "2",
        revision: orderRow(tabId)!.revision,
      },
    );

    expect(updated.json.code).toBeUndefined();
    expect(updated.status).toBe(200);
    const quantities = venue.db.all<{
      quantity: number;
    }>(sql`select quantity from working_order_lines
      where working_order_id = ${tabId}`);
    expect(quantities.reduce((sum, row) => sum + row.quantity, 0)).toBe(2000);
    expect(savedChoice(tabId)).toEqual(choice);
    expect(written()).toEqual(before);
  });

  it("adds a table round above the simplified ceiling to its saved F1 bill", async () => {
    const { partyId, tabId } = await seated(limited, { Lote: 1 });
    await chooseFull(tabId);
    const before = written();
    const choice = savedChoice(tabId);

    const added = await send(limited, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: partyRevision(partyId),
      groups: [{ lines: linesOf(tables, { Céntimo: 1 }), release: "fire" }],
    });

    expect(added.json.code).toBeUndefined();
    expect(added.status).toBe(200);
    expect(storedLines(tabId)).toEqual(["1:1000", "2:1000"]);
    expect(savedChoice(tabId)).toEqual(choice);
    expect(written()).toEqual(before);
  });

  it("merges into the destination's saved F1 choice above the simplified ceiling", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Mitad: 1 }, { Lote: 1 });
    await chooseFull(mainBill);
    const before = written();
    const choice = savedChoice(mainBill);

    const merged = await send(limited, venue.cookie, "POST", `/api/bills/${mainBill}/merge`, {
      fromBillId: secondBill,
      expectedPartyRevision: partyRevision(partyId),
    });

    expect(merged.json.code).toBeUndefined();
    expect(merged.status).toBe(204);
    expect(storedLines(mainBill)).toEqual(["1:1000", "2:1000"]);
    expect(storedLines(secondBill)).toEqual([]);
    expect(savedChoice(mainBill)).toEqual(choice);
    expect(written()).toEqual(before);
  });

  it.each([undefined, "1"])(
    "transfers a line quantity %s into a saved F1 destination above the ceiling",
    async (quantity) => {
      const { partyId, mainBill, secondBill } = await twoBills(
        { Céntimo: 1 },
        { Lote: quantity === undefined ? 1 : 2 },
      );
      await chooseFull(mainBill);
      const before = written();
      const choice = savedChoice(mainBill);

      const transferred = await send(
        limited,
        venue.cookie,
        "POST",
        `/api/bills/${secondBill}/transfer`,
        {
          toBillId: mainBill,
          transfers: [{ lineNo: 1, ...(quantity === undefined ? {} : { quantity }) }],
          expectedPartyRevision: partyRevision(partyId),
        },
      );

      expect(transferred.json.code).toBeUndefined();
      expect(transferred.status).toBe(204);
      expect(storedLines(mainBill)).toEqual(["1:1000", "2:1000"]);
      expect(storedLines(secondBill)).toEqual(quantity === undefined ? [] : ["1:1000"]);
      expect(savedChoice(mainBill)).toEqual(choice);
      expect(written()).toEqual(before);
    },
  );
  it("keeps the F2 destination ceiling when the source selected F1", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Céntimo: 1 }, { Lote: 1 });
    await chooseFull(secondBill);
    const before = written();
    const choice = savedChoice(secondBill);
    const transferred = await send(
      limited,
      venue.cookie,
      "POST",
      `/api/bills/${secondBill}/transfer`,
      {
        toBillId: mainBill,
        transfers: [{ lineNo: 1 }],
        expectedPartyRevision: partyRevision(partyId),
      },
    );

    expect(transferred.status).toBe(409);
    expect(transferred.json.code).toBe(REFUSED.code);
    expect(storedLines(mainBill)).toEqual(["1:1000"]);
    expect(storedLines(secondBill)).toEqual(["1:1000"]);
    expect(savedChoice(secondBill)).toEqual(choice);
    expect(written()).toEqual(before);
  });
});

describe("an edit that does not raise an order already over the limit", () => {
  it("a held order's update that shrinks it is saved while still over, and again down to the limit", async () => {
    const id = await parked(venue.app, counter, { Mitad: 3 });
    const shrunk = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Mitad: 2 }),
      revision: orderRow(id)!.revision,
    });
    expect(shrunk.status).toBe(200);
    expect(storedLines(id).map((entry) => entry.split(":")[1])).toEqual(["2000"]);

    const atLimit = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Lote: 1 }),
      revision: orderRow(id)!.revision,
    });
    expect(atLimit.status).toBe(200);
  });

  it("a held order's update that raises it further is refused, and the stored lines stay", async () => {
    const id = await parked(venue.app, counter, { Mitad: 2 });
    const revision = orderRow(id)!.revision;
    const answer = await send(limited, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: linesOf(counter, { Mitad: 2, Céntimo: 1 }),
      revision,
    });
    expect(answer).toEqual({
      status: 409,
      json: { ...REFUSED, params: { total: "3200.01", limit: "3010.00" } },
    });
    expect(storedLines(id)).toEqual(["1:2000"]);
    expect(orderRow(id)!.revision).toBe(revision);
  });

  it("a quantity lowered on one line is saved while the bill stays over", async () => {
    const { tabId } = await seated(venue.app, { Mitad: 3 });
    const answer = await send(
      limited,
      venue.cookie,
      "PUT",
      `/api/working-orders/${tabId}/lines/1`,
      { quantity: "2", revision: orderRow(tabId)!.revision },
    );
    expect(answer.status).toBe(200);
    expect(storedLines(tabId)).toEqual(["1:2000"]);
  });

  it("a quantity raised on one line of a bill already over is refused, and the quantity stays", async () => {
    const { tabId } = await seated(venue.app, { Mitad: 2 });
    const answer = await send(
      limited,
      venue.cookie,
      "PUT",
      `/api/working-orders/${tabId}/lines/1`,
      { quantity: "3", revision: orderRow(tabId)!.revision },
    );
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe(REFUSED.code);
    expect(storedLines(tabId)).toEqual(["1:2000"]);
  });

  it("a round of a free dish on a bill already over is sent", async () => {
    const { partyId, tabId } = await seated(venue.app, { Mitad: 2 });
    const answer = await send(limited, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: partyRevision(partyId),
      groups: [{ lines: linesOf(tables, { Gratis: 1 }), release: "fire" }],
    });
    expect(answer.status).toBe(200);
    expect(storedLines(tabId)).toEqual(["1:2000", "2:1000"]);
  });

  it("moving a free whole line onto a bill already over is done", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Mitad: 2 }, { Gratis: 1 });
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${secondBill}/transfer`, {
      toBillId: mainBill,
      transfers: [{ lineNo: 1 }],
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(204);
    expect(storedLines(mainBill)).toEqual(["1:2000", "2:1000"]);
    expect(storedLines(secondBill)).toEqual([]);
  });

  it("moving part of a free line onto a bill already over is done", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Mitad: 2 }, { Gratis: 2 });
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${secondBill}/transfer`, {
      toBillId: mainBill,
      transfers: [{ lineNo: 1, quantity: "1" }],
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(204);
    expect(storedLines(mainBill)).toEqual(["1:2000", "2:1000"]);
    expect(storedLines(secondBill)).toEqual(["1:1000"]);
  });

  it("moving part of a line off a bill over the limit is done, the bill it leaves staying over", async () => {
    const { partyId, mainBill, secondBill } = await twoBills({ Céntimo: 1 }, { Mitad: 3 });
    const answer = await send(limited, venue.cookie, "POST", `/api/bills/${secondBill}/transfer`, {
      toBillId: mainBill,
      transfers: [{ lineNo: 1, quantity: "1" }],
      expectedPartyRevision: partyRevision(partyId),
    });
    expect(answer.status).toBe(204);
    expect(storedLines(mainBill)).toEqual(["1:1000", "2:1000"]);
    expect(storedLines(secondBill)).toEqual(["1:2000"]);
  });
});
