import { randomUUID } from "node:crypto";
import { Hono } from "hono";
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
import { listOutstandingSales, recordCorrection } from "@waitron/core";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { createPinThrottle, hashPin, loginWithPin, persons } from "@waitron/identity";
import { captureAttempting } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import {
  decimal,
  negateDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { payWorkingOrderIntegrated } from "./till-sale.js";
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
let supervisorSessionId: string;

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
      // 0.55 at 21% is invoiced 0.45 + 0.10 by the catalogue's gross arithmetic and 2.10 is
      // 1.74 + 0.36, while those bases taxed at 21% are 0.09 and 0.37; Café with two 0.50 extras at
      // 10% matches both ways.
      const created = new Map<string, string>();
      for (const [name, price, vatClass] of [
        ["Mosto", "0.55", "general"],
        ["Zumo", "2.10", "general"],
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
    supervisorSessionId = session.id;
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
      (select group_concat(id || ':' || next_number, ',') from invoice_series) as series,
      (select group_concat(node_id || ':' || secuencia || ':' || coalesce(ultima_huella, ''), ',')
        from cadenas) as chain
  `)[0];
}

async function expectRefusedUnwritten(
  billId: string,
  answer: Promise<{ status: number; json: Record<string, unknown> }>,
  refusal: { status: number; code: string },
): Promise<void> {
  expectUnwritten(await observeRefusal(billId, answer), refusal);
}

// Observes a refusal without asserting, so a case holding a card at the reader can release it
// before any assertion fails.
async function observeRefusal(
  billId: string,
  answer: Promise<{ status: number; json: Record<string, unknown> }>,
) {
  const before = fiscalSnapshot();
  const { status, json } = await answer;
  return {
    answered: { status, code: json.code },
    before,
    after: fiscalSnapshot(),
    status: await statusOf(venue, billId),
    credits: await creditsOf((await invoiceOf(billId)).id),
  };
}

function expectUnwritten(
  observed: Awaited<ReturnType<typeof observeRefusal>>,
  refusal: { status: number; code: string },
): void {
  expect(observed.answered).toEqual(refusal);
  expect(observed.after).toEqual(observed.before);
  expect(observed.status).toBe("placed");
  expect(observed.credits).toEqual([]);
}

const negate = (amount: string) => negateDecimal(decimal(amount));

describe("cancelling a placed order whose invoice was issued", () => {
  it("credits the whole invoice in the rectificative series, settles it owing nothing, and abandons the order", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    expect(original.total).toBe(300);
    // The device's till is not the box's configured one, so the two cannot be confused below.
    expect(venue.deviceTillId).not.toBe(venue.cfg.tillId);
    expect(original.tillId).toBe(venue.deviceTillId);
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
      tillId: venue.deviceTillId,
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

  it("names, on each credit-note line, the invoice line with the same number that it reverses", async () => {
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

    expect((await cancel(id)).status).toBe(200);

    const [credit] = await creditsOf(original.id);
    const linksOf = (saleId: string) =>
      inTx(venue, (tx) =>
        tx
          .select({
            id: saleLines.id,
            lineNo: saleLines.lineNo,
            correctsLineId: saleLines.correctsLineId,
          })
          .from(saleLines)
          .where(eq(saleLines.saleId, saleId))
          .orderBy(saleLines.lineNo),
      );
    const invoiced = await linksOf(original.id);
    expect(invoiced).toHaveLength(3);
    expect((await linksOf(credit!.id)).map((line) => [line.lineNo, line.correctsLineId])).toEqual(
      invoiced.map((line) => [line.lineNo, line.id]),
    );
  });

  it("refuses an operator without sale.rectify and no override, writing nothing and using no invoice number", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);

    const answer = cancel(id, venue.cookie);
    await expectRefusedUnwritten(id, answer, {
      status: 403,
      code: "authorization.not_permitted",
    });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
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

  it("refuses an operator without sale.rectify before looking for a rectificative series, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const retired = await activeRectificative();
    await inTx(venue, (tx) =>
      tx
        .update(invoiceSeries)
        .set({ retiredAt: new Date() })
        .where(eq(invoiceSeries.id, retired!.id)),
    );
    try {
      await expectRefusedUnwritten(id, cancel(id, venue.cookie), {
        status: 403,
        code: "authorization.not_permitted",
      });
    } finally {
      await inTx(venue, (tx) =>
        insertNodeSeriesTx(tx, venue.cfg.nodeId, [
          { code: `R${randomUUID().slice(0, 4)}`, purpose: "rectificative" },
        ]),
      );
    }
  });

  it.each([
    ["Mosto", "-0.55", { rate: "21.00", base: "0.45", tax: "0.10" }],
    ["Zumo", "-2.10", { rate: "21.00", base: "1.74", tax: "0.36" }],
  ])(
    "credits %s for %s with the invoice's own VAT split negated, where its lines would tax another",
    async (name, total, invoiced) => {
      const id = await placed([{ name, quantity: "1" }]);
      const original = await invoiceOf(id);
      expect(original.vatBreakdown).toEqual([invoiced]);

      expect((await cancel(id)).status).toBe(200);

      const [credit] = await creditsOf(original.id);
      expect(credit!.total).toBe(-original.total);
      const negated = { rate: "21.00", base: negate(invoiced.base), tax: negate(invoiced.tax) };
      expect(credit!.vatBreakdown).toEqual([negated]);
      const filed = await registroOf(credit!.id);
      expect(filed).toMatchObject({
        tipoFactura: "R5",
        importeTotal: total,
        cuotaTotal: negated.tax,
      });
      const [rectified] = (await registroOf(original.id)).desglose;
      expect(filed.desglose).toEqual([
        {
          ...rectified,
          BaseImponibleOimporteNoSujeto: negated.base,
          CuotaRepercutida: negated.tax,
        },
      ]);
      expect(await statusOf(venue, id)).toBe("abandoned");
    },
  );

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
      const listed = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/bills/lookup?q=${original.invoiceNumber}`,
      );
      expect(listed.status).toBe(200);
      return (listed.json as { bills: { workingOrderId: string }[] }).bills.map(
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
  it("refuses an invoice already partly credited, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const series = await activeRectificative();
    // 0.83 at 21% is 1.00 of the Caña's 3.00, so a credit of the whole 3.00 would exceed it.
    await inTx(venue, (tx) =>
      recordCorrection(tx, venue.backend, {
        tillId: brandTillId(venue.deviceTillId),
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(original.id),
        total: "-1.00",
        lines: [
          {
            lineNo: 1,
            name: "Caña",
            descriptions: { [venue.cfg.locale]: "Caña de cerveza" },
            quantity: "-0.333",
            unitPrice: "2.48",
            vatRate: "21.00",
            lineTotal: "-0.83",
          },
        ],
        authz: { sessionId: supervisorSessionId },
        clock: venue.clock,
      }),
    );
    const partial = await creditsOf(original.id);
    expect(partial.map((credit) => credit.total)).toEqual([-100]);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "sale.correction_exceeds_total",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual(partial);
  });

  it("refuses an invoice already credited upwards, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const series = await activeRectificative();
    // 0.83 at 21% is 1.00 added to the Caña's 3.00, so a credit of 3.00 would leave it 1.00.
    await inTx(venue, (tx) =>
      recordCorrection(tx, venue.backend, {
        tillId: brandTillId(venue.deviceTillId),
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(original.id),
        total: "1.00",
        lines: [
          {
            lineNo: 1,
            name: "Caña",
            descriptions: { [venue.cfg.locale]: "Caña de cerveza" },
            quantity: "0.333",
            unitPrice: "2.48",
            vatRate: "21.00",
            lineTotal: "0.83",
          },
        ],
        authz: { sessionId: supervisorSessionId },
        clock: venue.clock,
      }),
    );
    const raised = await creditsOf(original.id);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "sale.correction_not_whole",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual(raised);
  });

  // The route sends only a reason; both refusals below come from the invoice as stored, so a
  // retry meets the same one.
  it("answers 409 when the invoice's stored lines disagree with its breakdown, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    await inTx(venue, (tx) =>
      tx.insert(saleLines).values({
        saleId: original.id,
        lineNo: 99,
        name: "Añadida",
        descriptions: { [venue.cfg.locale]: "Añadida" },
        quantity: 1000,
        unitPrice: 1,
        vatRate: 2100,
        lineTotal: 1,
      }),
    );

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "sale.correction_lines_mismatch",
    });
  });

  it("answers 409 when the invoice's stored breakdown does not sum to its total, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const [trigger] = venue.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'trigger' and name = 'sales_append_only_update'`,
    );
    venue.db.run(sql.raw(`drop trigger "sales_append_only_update"`));
    try {
      await inTx(venue, (tx) =>
        tx
          .update(sales)
          .set({ vatBreakdown: [{ rate: "21.00", base: "2.48", tax: "0.51" }] })
          .where(eq(sales.id, original.id)),
      );
    } finally {
      venue.db.run(sql.raw(trigger!.sql));
    }

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "sale.total_mismatch",
    });
  });

  // The cancel reverses every stored invoice line exactly, so these two reach the line checks with
  // a value stored as bytes: it reads back as a new byte array each time, so the cancel's copy and
  // the one `recordCorrection` reads are not the same value.
  it("answers 409 when a stored invoice line's product reads back unlike itself, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    await inTx(venue, (tx) =>
      tx.insert(saleLines).values({
        saleId: original.id,
        lineNo: 99,
        name: "Añadida",
        descriptions: { [venue.cfg.locale]: "Añadida" },
        quantity: 1000,
        unitPrice: 0,
        vatRate: 2100,
        lineTotal: 0,
        productId: sql`x'01'`,
      }),
    );

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "sale.correction_line_not_reversed",
    });
  });

  it("answers 409 when a stored invoice line's id reads back unlike itself, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    await inTx(venue, (tx) =>
      tx.insert(saleLines).values({
        id: sql`x'02'`,
        saleId: original.id,
        lineNo: 99,
        name: "Añadida",
        descriptions: { [venue.cfg.locale]: "Añadida" },
        quantity: 1000,
        unitPrice: 0,
        vatRate: 2100,
        lineTotal: 0,
      }),
    );

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "sale.correction_line_not_on_invoice",
    });
  });

  it("files one credit when two cancels of the order arrive together, refusing the second", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const series = await activeRectificative();

    const answers = await Promise.all([cancel(id), cancel(id)]);

    expect(answers.map((answer) => [answer.status, answer.json.code]).sort()).toEqual([
      [200, undefined],
      [409, "working_order.not_placed"],
    ]);
    expect(await creditsOf(original.id)).toHaveLength(1);
    expect(await activeRectificative()).toEqual({ id: series!.id, next: series!.next + 1 });
    expect(await amendmentsOf(id)).toHaveLength(2);
  });

  it("keeps none of the credit when a write after it fails", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    // The cancel's last write is its amendment, after the credit, its number, its record, the
    // chain's move and the invoice's settlement.
    venue.db.run(
      sql.raw(
        `create trigger refuse_cancel_amendment before insert on order_amendments
         when new.kind = 'order_cancelled' and new.working_order_id = '${id}'
         begin select raise(abort, 'refused by the test'); end`,
      ),
    );
    const before = fiscalSnapshot();
    let answer: Awaited<ReturnType<typeof cancel>>;
    try {
      answer = await cancel(id);
    } finally {
      venue.db.run(sql.raw("drop trigger refuse_cancel_amendment"));
    }

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 500,
      code: "server.internal",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual([]);
    const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
    expect(outstanding.map((sale) => sale.saleId)).toContain(original.id);
    // The control: with the refusal gone, the same cancel credits the invoice.
    expect((await cancel(id)).status).toBe(200);
    expect(await creditsOf(original.id)).toHaveLength(1);
  });
});

describe("cancelling an invoiced order on a supervisor's PIN", () => {
  type Override = { personId: unknown; pin: unknown } | string;

  function cancelWith(override: Override, cookie = venue.cookie, app = venue.app) {
    return (id: string) =>
      send(app, cookie, "POST", `/api/working-orders/${id}/cancel`, { reason: REASON, override });
  }

  /** The till routes with a wrong-PIN limit of their own, on a clock the case moves. */
  function throttledApp() {
    const clockAt = { now: 1_000_000 };
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: venue.cfg.locale,
        pool: venue.pool,
        pinThrottle: createPinThrottle({ now: () => clockAt.now }),
      },
      () => {},
    );
    return { app, clockAt };
  }

  it("credits the invoice for an operator without sale.rectify, naming the supervisor as authorising", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);

    const answer = await cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN })(id);

    expect(answer).toEqual({ status: 200, json: { body: "" } });
    const credits = await creditsOf(original.id);
    expect(credits).toEqual([
      expect.objectContaining({
        total: -300,
        tillId: venue.deviceTillId,
        authorizedBy: supervisorId,
      }),
    ]);
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
      { kind: "order_cancelled", actorId: venue.operatorId, reason: REASON },
    ]);
  });

  it("refuses a wrong supervisor PIN as pin.invalid, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);

    await expectRefusedUnwritten(id, cancelWith({ personId: supervisorId, pin: "0000" })(id), {
      status: 401,
      code: "pin.invalid",
    });
  });

  it("refuses the PIN of someone who does not hold sale.rectify, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const answer = cancelWith({ personId: venue.operatorId, pin: "5555" })(id);

    await expectRefusedUnwritten(id, answer, { status: 403, code: "authorization.not_permitted" });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
  });

  // Thunks, because the supervisor's id exists only once the suite's setup has run.
  it.each<[string, () => Override, { status: number; code: string }]>([
    [
      "an override that is not an object",
      () => SUPERVISOR_PIN,
      { status: 400, code: "management.request_invalid" },
    ],
    [
      "a person id that is not a UUID",
      () => ({ personId: "sofia", pin: SUPERVISOR_PIN }),
      { status: 401, code: "pin.invalid" },
    ],
    [
      "a PIN that is not text",
      () => ({ personId: supervisorId, pin: 7777 }),
      { status: 401, code: "pin.invalid" },
    ],
  ])("refuses %s, writing nothing", async (_, override, refusal) => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);

    await expectRefusedUnwritten(id, cancelWith(override())(id), refusal);
  });

  it("never checks an override sent by someone who holds sale.rectify, and credits on their own authority", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);

    const answer = await cancelWith(
      { personId: venue.operatorId, pin: "5555" },
      supervisorCookie,
    )(id);

    expect(answer.status).toBe(200);
    expect(await creditsOf(original.id)).toEqual([
      expect.objectContaining({ authorizedBy: supervisorId }),
    ]);
  });

  it("counts wrong PINs in the till's override bucket: after four even the right one is 429, the drawer too, until the wait is over", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const { app, clockAt } = throttledApp();
    const right = { personId: supervisorId, pin: SUPERVISOR_PIN };

    for (let i = 0; i < 4; i += 1) {
      const wrong = await cancelWith(
        { personId: supervisorId, pin: "0000" },
        venue.cookie,
        app,
      )(id);
      expect({ status: wrong.status, code: wrong.json.code }).toEqual({
        status: 401,
        code: "pin.invalid",
      });
    }
    const throttled = cancelWith(right, venue.cookie, app)(id);
    await expectRefusedUnwritten(id, throttled, { status: 429, code: "pin.throttled" });
    expect((await throttled).json.params).toEqual({ retryAfterSeconds: 2 });
    const drawer = await send(app, venue.cookie, "POST", "/api/drawer/open", { override: right });
    expect({ status: drawer.status, code: drawer.json.code }).toEqual({
      status: 429,
      code: "pin.throttled",
    });

    clockAt.now += 2_001;
    expect((await cancelWith(right, venue.cookie, app)(id)).status).toBe(200);
    expect(await creditsOf(original.id)).toEqual([
      expect.objectContaining({ authorizedBy: supervisorId }),
    ]);
  });

  function noInvoiceZone(name: string) {
    return inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name })
        .returning({ id: floorZones.id });
      return offerProducts(tx, venue.cfg, {
        zone: { zoneId: zone!.id },
        serviceMode: "ticket_then_pay",
      });
    });
  }

  it("never checks an override sent with an order that has no invoice, so a wrong PIN there does not count", async () => {
    const ticketFirst = await noInvoiceZone("Barra sin factura");
    const { app } = throttledApp();
    const wrong = cancelWith({ personId: supervisorId, pin: "0000" }, venue.cookie, app);

    for (let i = 0; i < 5; i += 1) {
      const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId);
      expect((await wrong(id)).status).toBe(200);
      expect(await statusOf(venue, id)).toBe("abandoned");
    }
    const invoiced = await placed([{ name: "Caña", quantity: "1" }]);
    const right = cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN }, venue.cookie, app);
    expect((await right(invoiced)).status).toBe(200);
  });

  it("refuses an override that is not an object even on an order with no invoice, writing nothing", async () => {
    const ticketFirst = await noInvoiceZone("Barra sin factura, mal formada");
    const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId);
    const before = fiscalSnapshot();

    const answer = await cancelWith(SUPERVISOR_PIN)(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 400,
      code: "management.request_invalid",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
    ]);
  });

  it("an override sent by someone who holds sale.rectify is never checked, so it neither counts nor clears", async () => {
    const { app } = throttledApp();
    const byStaff = (pin: string) => cancelWith({ personId: supervisorId, pin }, venue.cookie, app);
    const bySupervisor = (pin: string) =>
      cancelWith({ personId: supervisorId, pin }, supervisorCookie, app);
    const id = await placed([{ name: "Caña", quantity: "1" }]);

    for (let i = 0; i < 3; i += 1) {
      expect((await byStaff("0000")(id)).status).toBe(401);
    }
    expect(
      (await bySupervisor("0000")(await placed([{ name: "Caña", quantity: "1" }]))).status,
    ).toBe(200);
    expect(
      (await bySupervisor(SUPERVISOR_PIN)(await placed([{ name: "Caña", quantity: "1" }]))).status,
    ).toBe(200);
    // Had the supervisor's wrong PIN counted, this would already be 429; had their right PIN
    // cleared the count, the right PIN after it would be accepted.
    expect((await byStaff("0000")(id)).status).toBe(401);
    await expectRefusedUnwritten(id, byStaff(SUPERVISOR_PIN)(id), {
      status: 429,
      code: "pin.throttled",
    });
  });
});

describe("who may approve a cancel and credit (GET /api/cancel-credit-authorizers)", () => {
  it("lists the active holders of sale.rectify, and no one else, by id and name only", async () => {
    const [suspended] = await inTx(venue, (tx) =>
      tx
        .insert(persons)
        .values({
          displayName: "Suspendida",
          pinHash: hashPin("5555"),
          role: "manager",
          status: "suspended",
        })
        .returning({ id: persons.id }),
    );

    const listed = await send(venue.app, venue.cookie, "GET", "/api/cancel-credit-authorizers");

    expect(listed.status).toBe(200);
    const people = listed.json as unknown as Record<string, unknown>[];
    const ids = people.map((person) => person.personId);
    expect(ids).toEqual(expect.arrayContaining([venue.adminId, supervisorId]));
    expect(ids).not.toContain(venue.operatorId);
    expect(ids).not.toContain(suspended!.id);
    for (const person of people) expect(Object.keys(person)).toEqual(["personId", "displayName"]);
  });

  it("refuses a caller with no session, as the drawer's list does", async () => {
    const credit = await send(venue.app, "", "GET", "/api/cancel-credit-authorizers");
    const drawer = await send(venue.app, "", "GET", "/api/drawer/authorizers");

    expect(credit).toMatchObject({ status: 401, json: { code: "session.required" } });
    expect(credit.json).toEqual(drawer.json);
  });

  it("answers a caller with a session but no device as the drawer's list does", async () => {
    const [sessionOnly] = venue.cookie.split("; ");
    const credit = await send(venue.app, sessionOnly!, "GET", "/api/cancel-credit-authorizers");
    const drawer = await send(venue.app, sessionOnly!, "GET", "/api/drawer/authorizers");

    expect(credit.status).toBe(drawer.status);
    if (drawer.status !== 200) expect(credit.json).toEqual(drawer.json);
  });
});

/**
 * A reader provider that commits its `attempting` row before the card is asked, as the Stripe and
 * SumUp providers do, holds the card at the reader until `release`, then captures it.
 */
class CardAtTheReader extends FakePaymentProvider {
  readonly entered: Promise<void>;
  release!: () => void;
  private signal!: () => void;
  private readonly gate: Promise<void>;

  constructor() {
    super(venue.db);
    this.entered = new Promise((resolve) => (this.signal = resolve));
    this.gate = new Promise((resolve) => (this.release = resolve));
  }

  override async collect(params: Parameters<FakePaymentProvider["collect"]>[0]) {
    this.stallNextCollect();
    const asked = await super.collect(params);
    this.signal();
    await this.gate;
    const settledAt = new Date();
    await inTx(venue, (tx) =>
      captureAttempting(tx, {
        provider: this.provider,
        paymentRef: asked.paymentRef,
        settledAt,
        externalRef: `charge-${asked.paymentRef}`,
      }),
    );
    return { ...asked, state: "captured" as const, settledAt };
  }
}

describe("cancelling an invoiced order while a card is paying it", () => {
  it("refuses while the card is at the reader, writing nothing, and the card then settles the invoice", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const provider = new CardAtTheReader();
    const paying = payWorkingOrderIntegrated(
      { db: venue.db, backend: venue.backend, clock: venue.clock, provider },
      venue.cfg,
      { id, lines: [] },
    );
    await provider.entered;

    const refused = await observeRefusal(id, cancel(id));
    provider.release();
    const paid = await paying;

    expectUnwritten(refused, { status: 409, code: "order.payment_in_flight" });
    expect(paid.outcome).toBe("captured");
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await creditsOf(original.id)).toEqual([]);
  });

  it("refuses while a card captured for the invoice has not settled it, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    venue.card.crashNextCollect("captured");
    const lost = await send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    expect(lost.status).toBe(500);

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "order.payment_in_flight",
    });

    // Pay again settles the invoice from the captured payment, charging nothing more.
    const calls = venue.card.collectCalls.length;
    const recovered = await send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    expect(recovered.status).toBe(200);
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("refuses while the card is at a reader that has written no payment yet, and the card then settles the invoice", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const paymentsWhileHeld = paymentsOf(id);

    const refused = await observeRefusal(id, cancel(id));
    const outstandingWhileHeld = await outstandingIds();
    release();
    const paid = await paying;

    expect(paymentsWhileHeld).toEqual([]);
    expectUnwritten(refused, { status: 409, code: "order.payment_in_flight" });
    expect(outstandingWhileHeld).toContain(original.id);
    expect(paid.status).toBe(200);
    expect(paid.json.outcome).toBe("captured");
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await outstandingIds()).not.toContain(original.id);
    expect(tendersOf(original.id)).toEqual([{ method: "card", amount: 300 }]);
    expect(paymentsOf(id)).toEqual([{ state: "captured", saleId: original.id }]);
    expect(await creditsOf(original.id)).toEqual([]);
  });

  it("refuses while either of two cards paying the order at once is at its reader", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const first = new FakePaymentProvider(venue.db);
    const second = new FakePaymentProvider(venue.db);
    const releaseFirst = first.holdNextCollect();
    first.failNextCollect();
    const releaseSecond = second.holdNextCollect();
    const pay = (provider: FakePaymentProvider) =>
      payWorkingOrderIntegrated(
        { db: venue.db, backend: venue.backend, clock: venue.clock, provider },
        venue.cfg,
        { id, lines: [] },
      );
    const firstPaying = pay(first);
    await expect.poll(() => first.collectCalls.length).toBe(1);
    const secondPaying = pay(second);
    await expect.poll(() => second.collectCalls.length).toBe(1);

    releaseFirst();
    const firstPaid = await firstPaying;
    const refused = await observeRefusal(id, cancel(id));
    releaseSecond();
    const secondPaid = await secondPaying;

    expect(firstPaid.outcome).toBe("declined");
    expectUnwritten(refused, { status: 409, code: "order.payment_in_flight" });
    expect(secondPaid.outcome).toBe("captured");
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await creditsOf(original.id)).toEqual([]);
  });

  it("credits the invoice once a declined card has left the reader", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    venue.card.failNextCollect();
    const paying = send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const refused = await cancel(id);
    release();
    const declined = await paying;

    expect(refused.status).toBe(409);
    expect(declined.status).toBe(200);
    expect(declined.json.outcome).toBe("declined");

    expect(await cancel(id)).toEqual({ status: 200, json: { body: "" } });
    expect(await creditsOf(original.id)).toHaveLength(1);
    expect(await statusOf(venue, id)).toBe("abandoned");
  });

  it("refuses a card for an order cancelled before it reached the reader, asking no reader", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    expect((await cancel(id)).status).toBe(200);
    const calls = venue.card.collectCalls.length;

    const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });

    expect({ status: paid.status, code: paid.json.code }).toEqual({
      status: 409,
      code: "working_order.not_open",
    });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(paymentsOf(id)).toEqual([]);
  });
});

async function outstandingIds(): Promise<string[]> {
  const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
  return outstanding.map((sale) => sale.saleId);
}

function tendersOf(saleId: string) {
  return venue.db.all<{ method: string; amount: number }>(
    sql`select method, amount from tenders where sale_id = ${saleId}`,
  );
}

function paymentsOf(workingOrderId: string) {
  return venue.db.all<{ state: string; saleId: string | null }>(
    sql`select state, sale_id as saleId from payments where working_order_id = ${workingOrderId}`,
  );
}

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

  it("refuses while a card is at the reader for it, and the card then files its sale", async () => {
    const ticketFirst = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra tarjeta" })
        .returning({ id: floorZones.id });
      return offerProducts(tx, venue.cfg, {
        zone: { zoneId: zone!.id },
        serviceMode: "ticket_then_pay",
      });
    });
    const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [] });
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const before = fiscalSnapshot();

    const refused = await cancel(id, venue.cookie);
    const afterRefusal = fiscalSnapshot();
    const statusWhileHeld = await statusOf(venue, id);
    release();
    const paid = await paying;

    expect({ status: refused.status, code: refused.json.code }).toEqual({
      status: 409,
      code: "order.payment_in_flight",
    });
    expect(afterRefusal).toEqual(before);
    expect(statusWhileHeld).toBe("placed");
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, id)).toBe("settled");
    const sale = await invoiceOf(id);
    expect(paymentsOf(id)).toEqual([{ state: "captured", saleId: sale.id }]);
  });
});

describe("a party's bills name the invoice and its credit notes (GET /api/parties/:id/bills)", () => {
  async function billOf(partyId: string, billId: string) {
    const listed = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
    expect(listed.status).toBe(200);
    return (listed.json as unknown as Record<string, unknown>[]).find(
      (bill) => bill.workingOrderId === billId,
    )!;
  }

  async function numberOf(sale: { seriesId: string; invoiceNumber: number }) {
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, sale.seriesId)),
    );
    return `${series!.code}/${sale.invoiceNumber}`;
  }

  /** A party's main bill, placed with its invoice issued by the party leaving without paying. */
  async function invoicedPartyBill() {
    const party = await seatedWith(venue, "Caña");
    const departed = await send(
      venue.app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      { expectedPartyRevision: party.revision, reason: "Se marcharon sin pagar" },
    );
    expect(departed.status).toBe(200);
    return party;
  }

  it("names the invoice of a placed bill whose invoice was issued, with no credit notes", async () => {
    const party = await invoicedPartyBill();
    const original = await invoiceOf(party.tabId);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill).toMatchObject({ status: "placed", receiptAvailable: true });
    expect(bill.invoiceNumber).toBe(await numberOf(original));
    expect(bill.creditNotes).toEqual([]);
  });

  it("names the credit note a cancel filed against the invoice", async () => {
    const party = await invoicedPartyBill();
    const original = await invoiceOf(party.tabId);
    expect((await cancel(party.tabId)).status).toBe(200);
    const credits = await creditsOf(original.id);
    expect(credits).toHaveLength(1);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill.status).toBe("abandoned");
    expect(bill.invoiceNumber).toBe(await numberOf(original));
    expect(bill.creditNotes).toEqual([await numberOf(credits[0]!)]);
  });

  it("names neither on a placed bill with no invoice", async () => {
    const party = await seatedWith(venue, "Caña");
    const place = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/place`,
    );
    expect(place.status).toBe(200);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill).toMatchObject({ status: "placed", receiptAvailable: false });
    expect(bill).not.toHaveProperty("invoiceNumber");
    expect(bill).not.toHaveProperty("creditNotes");
  });
});

describe("cancelling an invoiced counter order from the counter's waiting list", () => {
  async function waitingRow(id: string): Promise<Record<string, unknown> | undefined> {
    const answer = await send(venue.app, venue.cookie, "GET", "/api/orders/counter-waiting");
    expect(answer.status).toBe(200);
    return (answer.json as unknown as Record<string, unknown>[]).find((row) => row.id === id);
  }

  async function formattedNumberOf(sale: { seriesId: string; invoiceNumber: number }) {
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, sale.seriesId)),
    );
    return `${series!.code}/${sale.invoiceNumber}`;
  }

  async function reversedLineIdsOf(saleId: string) {
    const rows = await inTx(venue, (tx) =>
      tx
        .select({ correctsLineId: saleLines.correctsLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, saleId))
        .orderBy(saleLines.lineNo),
    );
    return rows.map((row) => row.correctsLineId);
  }

  it("lists it with its invoice, and once cancelled one credit note reverses each invoice line and it leaves the list", async () => {
    const id = await placed([
      { name: "Mosto", quantity: "1" },
      { name: "Zumo", quantity: "2" },
    ]);
    const original = await invoiceOf(id);
    expect(await waitingRow(id)).toMatchObject({
      status: "placed",
      serviceMode: "invoice_first",
      invoiceNumber: await formattedNumberOf(original),
    });

    expect(await cancel(id)).toEqual({ status: 200, json: { body: "" } });

    const credits = await creditsOf(original.id);
    expect(credits).toHaveLength(1);
    const invoiceLineIds = (
      await inTx(venue, (tx) =>
        tx
          .select({ id: saleLines.id })
          .from(saleLines)
          .where(eq(saleLines.saleId, original.id))
          .orderBy(saleLines.lineNo),
      )
    ).map((row) => row.id);
    expect(invoiceLineIds).toHaveLength(2);
    expect(await reversedLineIdsOf(credits[0]!.id)).toEqual(invoiceLineIds);
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await waitingRow(id)).toBeUndefined();
  });

  it("refuses a counter order already paid, writing nothing (working_order.not_placed)", async () => {
    const id = await placed([{ name: "Mosto", quantity: "1" }]);
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "0.55" },
    });
    expect(paid.status).toBe(200);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await creditsOf((await invoiceOf(id)).id)).toEqual([]);
  });
});
