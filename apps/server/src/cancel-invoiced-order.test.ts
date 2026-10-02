import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  floorZones,
  insertNodeSeriesTx,
  invoiceSeries,
  orderAmendments,
  saleLines,
  saleSettlements,
  sales,
  unpaidDepartures,
} from "@waitron/db";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import { listOutstandingSales } from "@waitron/core";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import { cancelPlacedOrder } from "./working-order.js";
import "./errors.js";

// Cancelling a placed order whose invoice was issued credits the whole invoice (an R5 corrective
// invoice) and settles the original owing nothing, in the cancel's one transaction (owner decision
// 2026-10-02). Driven over HTTP against a venue that files real Veri*Factu records.
let venue: BillVenue;
let invoiceFirstZone: string;
/** Menu-item id of each product by its staff name, offered in the invoice-first counter zone. */
let offerOf: (name: string) => string;
let productIdOf: (name: string) => string;
/** Café's extras list, offering Leche at 0.50. */
let extraListId: string;
let supervisorId: string;
/** The supervisor's own session on the first till's device: holds `sale.rectify`. */
let supervisorCookie: string;

const SUPERVISOR_PIN = "7777";
const REASON = "Pedido equivocado";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const productIds = await inTx(venue, async (tx) => {
      const [catalogue] = db.all<{ id: string }>(
        sql`select id from catalogues where name = 'Carta'`,
      );
      const [category] = db.all<{ id: string }>(
        sql`select id from categories where name = 'Platos'`,
      );
      // 0.55 at 21% files 0.45 + 0.10 by the catalogue's gross arithmetic, while the same base
      // taxed by `deriveVatBreakdown` is 0.09; Café with two 0.50 extras at 10% matches both ways.
      const created = new Map<string, string>();
      for (const [name, price, vatClass] of [
        ["Mosto", "0.55", "general"],
        ["Café", "3.00", "reduced"],
        ["Leche", "1.00", "reduced"],
      ] as const) {
        const product = await createProduct(tx, {
          catalogueId: catalogue!.id,
          categoryId: category!.id,
          name,
          customerName: { [venue.cfg.locale]: `${name} de la casa` },
          kitchenName: name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: price,
          vatClass,
        });
        created.set(name, product.id);
      }
      const extras = await createExtraList(
        tx,
        {
          name: "Añadidos",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 2,
          active: true,
          items: [
            { productId: created.get("Leche"), maxQuantity: 2, preselected: false, price: "0.50" },
          ],
        },
        venue.cfg.locale,
      );
      extraListId = extras.id;
      await writeProductModifiers(tx, created.get("Café")!, [{ kind: "extras", id: extras.id }]);
      return new Map(
        db
          .all<{ id: string; name: string }>(sql`select id, name from products`)
          .map((row) => [row.name, row.id]),
      );
    });
    const offers = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
    );
    invoiceFirstZone = offers.zoneId;
    productIdOf = (name) => productIds.get(name)!;
    offerOf = (name) => offers.offerFor(productIdOf(name));
    const session = await inTx(venue, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Sofía", pinHash: hashPin(SUPERVISOR_PIN), role: "supervisor" })
        .returning({ id: persons.id });
      supervisorId = person!.id;
      return loginWithPin(tx, {
        tillId: venue.cfg.tillId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      });
    });
    const [, ...device] = venue.cookie.split("; ");
    supervisorCookie = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");
  },
});

/** An order parked in `zoneId` with these lines and placed, both through the till's routes. */
async function placed(
  lines: { name: string; quantity: string; extras?: unknown[] }[],
  zoneId = invoiceFirstZone,
): Promise<string> {
  const id = randomUUID();
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    id,
    zoneId,
    lines: lines.map(({ name, ...line }) => ({ menuItemId: offerOf(name), ...line })),
  });
  expect(parked.status).toBe(200);
  const place = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`);
  expect(place.status).toBe(200);
  return id;
}

function cancel(id: string, cookie = supervisorCookie) {
  return send(venue.app, cookie, "POST", `/api/working-orders/${id}/cancel`, { reason: REASON });
}

/** The bill's own invoice: the sale its order filed. */
async function invoiceOf(billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

function creditsOf(saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

async function registroOf(saleId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(registrosFacturacion).where(eq(registrosFacturacion.saleId, saleId)),
  );
  return row as typeof row & {
    desglose: {
      BaseImponibleOimporteNoSujeto: string;
      TipoImpositivo: string;
      CuotaRepercutida: string;
    }[];
    facturasRectificadas: { IDFacturaRectificada: Record<string, string>[] } | null;
  };
}

async function linesOf(saleId: string) {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({
        id: saleLines.id,
        parentLineId: saleLines.parentLineId,
        line: {
          lineNo: saleLines.lineNo,
          name: saleLines.name,
          descriptions: saleLines.descriptions,
          kitchenName: saleLines.kitchenName,
          quantity: saleLines.quantity,
          unitPrice: saleLines.unitPrice,
          vatRate: saleLines.vatRate,
          lineTotal: saleLines.lineTotal,
          lineGross: saleLines.lineGross,
          productId: saleLines.productId,
        },
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo),
  );
  const lineNoOf = new Map(rows.map((row) => [row.id, row.line.lineNo]));
  return rows.map((row) => ({
    ...row.line,
    parentLineNo: row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
  }));
}

function amendmentsOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        kind: orderAmendments.kind,
        actorId: orderAmendments.actorId,
        reason: orderAmendments.reason,
      })
      .from(orderAmendments)
      .where(eq(orderAmendments.workingOrderId, billId))
      .orderBy(orderAmendments.sequenceNo),
  );
}

async function activeRectificative() {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: invoiceSeries.id, next: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(
        and(
          eq(invoiceSeries.nodeId, venue.cfg.nodeId),
          eq(invoiceSeries.purpose, "rectificative"),
          isNull(invoiceSeries.retiredAt),
        ),
      ),
  );
  return row;
}

/** Everything a credit would write, so a refusal can be shown to have written none of it. */
function fiscalSnapshot() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from sale_lines) as saleLines,
      (select count(*) from sale_settlements) as settlements,
      (select count(*) from registros_facturacion) as registros,
      (select count(*) from order_amendments) as amendments,
      (select group_concat(id || ':' || next_number, ',') from invoice_series) as series
  `)[0];
}

async function expectRefusedUnwritten(
  billId: string,
  answer: Promise<{ status: number; json: Record<string, unknown> }>,
  refusal: { status: number; code: string },
): Promise<void> {
  const before = fiscalSnapshot();
  const { status, json } = await answer;
  expect({ status, code: json.code }).toEqual(refusal);
  expect(fiscalSnapshot()).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
  expect(await creditsOf((await invoiceOf(billId)).id)).toEqual([]);
}

const negate = (amount: string) => (amount.startsWith("-") ? amount.slice(1) : `-${amount}`);

describe("cancelling a placed order whose invoice was issued", () => {
  it("credits the whole invoice in the rectificative series, settles it owing nothing, and abandons the order", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    expect(original.total).toBe(300);
    const series = await activeRectificative();

    const answer = await cancel(id);

    expect(answer).toEqual({ status: 200, json: { body: "" } });
    const credits = await creditsOf(original.id);
    expect(credits).toHaveLength(1);
    const credit = credits[0]!;
    expect(credit).toMatchObject({
      total: -300,
      seriesId: series!.id,
      invoiceNumber: series!.next,
      nodeId: venue.cfg.nodeId,
      tillId: venue.cfg.tillId,
      authorizedBy: supervisorId,
      workingOrderId: null,
    });
    expect(credit.vatBreakdown).toEqual(
      original.vatBreakdown.map((group) => ({
        rate: group.rate,
        base: negate(group.base),
        tax: negate(group.tax),
      })),
    );
    expect(await linesOf(credit.id)).toEqual(
      (await linesOf(original.id)).map((line) => ({
        ...line,
        quantity: -line.quantity,
        lineTotal: -line.lineTotal,
        lineGross: -line.lineGross!,
      })),
    );

    const filed = await registroOf(credit.id);
    const rectified = await registroOf(original.id);
    expect(filed).toMatchObject({
      tipoRegistro: "alta",
      tipoFactura: "R5",
      tipoRectificativa: "I",
      importeTotal: negate(rectified.importeTotal!),
      cuotaTotal: negate(rectified.cuotaTotal!),
    });
    expect(filed.desglose).toEqual(
      rectified.desglose.map((group) => ({
        ...group,
        BaseImponibleOimporteNoSujeto: negate(group.BaseImponibleOimporteNoSujeto),
        CuotaRepercutida: negate(group.CuotaRepercutida),
      })),
    );
    expect(filed.facturasRectificadas?.IDFacturaRectificada).toEqual([
      expect.objectContaining({
        IDEmisorFactura: rectified.idEmisorFactura,
        NumSerieFactura: rectified.numSerieFactura,
      }),
    ]);

    const settled = await inTx(venue, (tx) =>
      tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, original.id)),
    );
    expect(settled).toHaveLength(1);
    const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
    expect(outstanding.map((sale) => sale.saleId)).not.toContain(original.id);
    expect(await activeRectificative()).toEqual({ id: series!.id, next: series!.next + 1 });

    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
      { kind: "order_cancelled", actorId: supervisorId, reason: REASON },
    ]);
  });

  it("credits a two-rate invoice line by line, an extras pick under its dish, each rate the exact negative of the invoice's", async () => {
    const id = await placed([
      { name: "Caña", quantity: "2" },
      {
        name: "Café",
        quantity: "1",
        extras: [
          { listId: extraListId, picks: [{ productId: productIdOf("Leche"), quantity: 2 }] },
        ],
      },
    ]);
    const original = await invoiceOf(id);
    expect(original.vatBreakdown).toHaveLength(2);

    expect((await cancel(id)).status).toBe(200);

    const [credit] = await creditsOf(original.id);
    expect(credit!.total).toBe(-original.total);
    expect(credit!.vatBreakdown).toEqual(
      original.vatBreakdown.map((group) => ({
        rate: group.rate,
        base: negate(group.base),
        tax: negate(group.tax),
      })),
    );
    const invoiced = await linesOf(original.id);
    expect(invoiced.map((line) => [line.name, line.quantity, line.parentLineNo])).toEqual([
      ["Caña", 2000, null],
      ["Café", 1000, null],
      ["Leche", 2000, 2],
    ]);
    expect(await linesOf(credit!.id)).toEqual(
      invoiced.map((line) => ({
        ...line,
        quantity: -line.quantity,
        lineTotal: -line.lineTotal,
        lineGross: -line.lineGross!,
      })),
    );
  });

  it("refuses an operator without sale.rectify, writing nothing and using no invoice number", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);

    await expectRefusedUnwritten(id, cancel(id, venue.cookie), {
      status: 403,
      code: "authorization.not_permitted",
    });
  });

  it("refuses a bill holding a payment, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    // The one insert into `bill_payments` (`bill-payments.ts`) first requires an open bill
    // (`requireOpenBill`), so a placed bill's payment row is written here.
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: id,
        submissionId: randomUUID(),
        fingerprint: "test",
        kind: "contribution",
        method: "cash",
        applied: 100,
        tendered: 100,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: venue.operatorId,
        tillId: venue.cfg.tillId,
      }),
    );

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "bill.payments_received",
    });
  });

  it("refuses a second cancel, leaving exactly one credit note", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    expect((await cancel(id)).status).toBe(200);
    const original = await invoiceOf(id);

    const again = await cancel(id);

    expect({ status: again.status, code: again.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    expect(await creditsOf(original.id)).toHaveLength(1);
  });

  it("refuses when the node has no live rectificative series, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const retired = await activeRectificative();
    await inTx(venue, (tx) =>
      tx
        .update(invoiceSeries)
        .set({ retiredAt: new Date() })
        .where(eq(invoiceSeries.id, retired!.id)),
    );
    try {
      await expectRefusedUnwritten(id, cancel(id), {
        status: 409,
        code: "series.no_rectificative_for_node",
      });
    } finally {
      await inTx(venue, (tx) =>
        insertNodeSeriesTx(tx, venue.cfg.nodeId, [
          { code: `R${randomUUID().slice(0, 4)}`, purpose: "rectificative" },
        ]),
      );
    }
  });

  it("refuses an invoice whose VAT breakdown a credit of its lines cannot mirror, writing nothing", async () => {
    const id = await placed([{ name: "Mosto", quantity: "1" }]);
    expect((await invoiceOf(id)).vatBreakdown).toEqual([
      { rate: "21.00", base: "0.45", tax: "0.10" },
    ]);

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "sale.correction_breakdown_mismatch",
    });
  });

  it("credits and abandons a bill its party left without paying, leaving the departure as recorded", async () => {
    const party = await seatedWith(venue, "Caña");
    const departed = await send(
      venue.app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      { expectedPartyRevision: party.revision, reason: "Se marcharon sin pagar" },
    );
    expect(departed.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    const readDeparture = () =>
      inTx(venue, (tx) =>
        tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.workingOrderId, party.tabId)),
      );
    const departure = await readDeparture();
    expect(departure).toHaveLength(1);
    const original = await invoiceOf(party.tabId);
    const listedBills = async () => {
      const listed = await send(venue.app, venue.cookie, "GET", "/api/unpaid-departures");
      expect(listed.status).toBe(200);
      return (listed.json as unknown as { workingOrderId: string }[]).map(
        (row) => row.workingOrderId,
      );
    };
    expect(await listedBills()).toContain(party.tabId);

    const answer = await cancel(party.tabId);

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    const credits = await creditsOf(original.id);
    expect(credits.map((credit) => credit.total)).toEqual([-original.total]);
    expect(await readDeparture()).toEqual(departure);
    expect(await listedBills()).not.toContain(party.tabId);
  });

  it("refuses an invoiced order cancelled with no session to authorise the credit, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const before = fiscalSnapshot();

    await expect(
      cancelPlacedOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        id,
        REASON,
        venue.operatorId,
      ),
    ).rejects.toMatchObject({ code: "session.required" });

    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
  });

  it("fails loudly when the node has two live rectificative series, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const code = `R${randomUUID().slice(0, 4)}`;
    await inTx(venue, (tx) =>
      insertNodeSeriesTx(tx, venue.cfg.nodeId, [{ code, purpose: "rectificative" }]),
    );
    try {
      const before = fiscalSnapshot();
      const answer = await cancel(id);
      expect({ status: answer.status, code: answer.json.code }).toEqual({
        status: 500,
        code: "server.internal",
      });
      expect(fiscalSnapshot()).toEqual(before);
      expect(await statusOf(venue, id)).toBe("placed");
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(invoiceSeries)
          .set({ retiredAt: new Date() })
          .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.code, code))),
      );
    }
  });
});

describe("cancelling a placed order with no invoice", () => {
  it("abandons it with its reasoned amendment and files nothing", async () => {
    const ticketFirst = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra ticket" })
        .returning({ id: floorZones.id });
      return offerProducts(tx, venue.cfg, {
        zone: { zoneId: zone!.id },
        serviceMode: "ticket_then_pay",
      });
    });
    const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId);
    const before = fiscalSnapshot() as Record<string, unknown>;

    expect((await cancel(id, venue.cookie)).status).toBe(200);

    expect(fiscalSnapshot()).toEqual({ ...before, amendments: Number(before.amendments) + 1 });
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
      { kind: "order_cancelled", actorId: venue.operatorId, reason: REASON },
    ]);
  });
});
