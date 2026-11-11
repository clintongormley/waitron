import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { deviceId as brandDeviceId } from "@waitron/shared";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorZones,
  insertNodeSeriesTx,
  invoiceSeries,
  orderAmendments,
  saleLines,
  saleSettlements,
  sales,
  workingOrderLines,
} from "@waitron/db";
import { createExtraList, createProduct, units, writeProductModifiers } from "@waitron/catalogue";
import { listOutstandingSales, recordCorrection, withIssuanceTransaction } from "@waitron/core";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  decimal,
  negateDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
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
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

let venue: BillVenue;
let ticketThenPayZone: string;
/** Menu-item id of each product by its staff name, offered in the invoice-first counter zone. */
let offerOf: (name: string) => string;
let productIdOf: (name: string) => string;
/** Café's extras list, offering Leche at 0.50. */
let extraListId: string;
let portionListId: string;
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
      const [kg] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          seedKey: "credit-test-kg",
          name: { "es-ES": "kilogramo" },
          abbreviation: { "es-ES": "kg" },
          precision: 3,
          hardwareUnit: "kg",
        })
        .returning({ id: units.id });
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
      const ham = await createProduct(tx, {
        catalogueId: catalogue!.id,
        categoryId: category!.id,
        name: "Jamón",
        unitId: kg!.id,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const portions = await createExtraList(
        tx,
        {
          name: "Porciones",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: ham.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        venue.cfg.locale,
      );
      portionListId = portions.id;
      await writeProductModifiers(tx, created.get("Café")!, [{ kind: "extras", id: extras.id }]);
      await writeProductModifiers(tx, created.get("Mosto")!, [{ kind: "extras", id: portions.id }]);
      return new Map(
        db
          .all<{ id: string; name: string }>(sql`select id, name from products`)
          .map((row) => [row.name, row.id]),
      );
    });
    const offers = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    ticketThenPayZone = offers.zoneId;
    productIdOf = (name) => productIds.get(name)!;
    offerOf = (name) => offers.offerFor(productIdOf(name));
    const session = await inTx(venue, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Sofía", pinHash: hashPin(SUPERVISOR_PIN), role: "supervisor" })
        .returning({ id: persons.id });
      supervisorId = person!.id;
      return loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      });
    });
    supervisorSessionId = session.id;
    const [, ...device] = venue.cookie.split("; ");
    supervisorCookie = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");
  },
});

/** Park and place through the routes, optionally seeding an issued invoice between them. */
async function placed(
  lines: { name: string; quantity: string; extras?: unknown[] }[],
  zoneId = ticketThenPayZone,
  issued = true,
): Promise<string> {
  const id = randomUUID();
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    id,
    zoneId,
    lines: lines.map(({ name, ...line }) => ({ menuItemId: offerOf(name), ...line })),
  });
  expect(parked.status).toBe(200);
  if (issued) {
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      id,
      venue.operatorId,
    );
  }
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
          priceQuantity: saleLines.priceQuantity,
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
  action: () => Promise<void>,
  refusal: { code: string },
): Promise<void> {
  const before = fiscalSnapshot();
  await expect(action()).rejects.toMatchObject(refusal);
  expect(fiscalSnapshot()).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
  expect(await creditsOf((await invoiceOf(billId)).id)).toEqual([]);
}
async function creditInvoice(id: string, actor: "supervisor" | "staff" = "supervisor") {
  const sessionId =
    actor === "supervisor"
      ? supervisorSessionId
      : venue.db.all<{ id: string }>(
          sql`select id from sessions where person_id = ${venue.operatorId} and device_id = ${venue.deviceId} and ended_at is null`,
        )[0]!.id;
  await withIssuanceTransaction(venue.db, async (tx) => {
    const invoice = await readOrderInvoice(tx, id);
    await creditWholeInvoice(
      tx,
      { ...venue, admission: testTradingAdmission() },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      invoice!,
      { sessionId },
    );
  });
}
const negate = (amount: string) => negateDecimal(decimal(amount));
describe("creditWholeInvoice", () => {
  it("credits the whole invoice in the rectificative series and settles it owing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const original = await invoiceOf(id);
    expect(original.total).toBe(300);
    // The requesting device is not the configuration's own, so the two cannot be confused below.
    expect(venue.deviceId).not.toBe(venue.cfg.origin.deviceId);
    expect(original).toMatchObject({ source: "device", deviceId: venue.deviceId });
    const series = await activeRectificative();

    await creditInvoice(id);
    const credits = await creditsOf(original.id);
    expect(credits).toHaveLength(1);
    const credit = credits[0]!;
    expect(credit).toMatchObject({
      total: -300,
      seriesId: series!.id,
      invoiceNumber: series!.next,
      nodeId: venue.cfg.nodeId,
      source: "device",
      deviceId: venue.deviceId,
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
  });

  it("copies each line's unit price before any discount onto the credit unnegated, and its list total negated", async () => {
    const id = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      id,
      zoneId: ticketThenPayZone,
      lines: [
        { menuItemId: offerOf("Caña"), quantity: "1" },
        { menuItemId: offerOf("Caña"), quantity: "2" },
      ],
    });
    expect(parked.status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ listUnitPriceGross: 400 })
        .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 1))),
    );
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      id,
      venue.operatorId,
    );
    expect(
      (await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`)).status,
    ).toBe(200);
    const original = await invoiceOf(id);

    await creditInvoice(id);

    const [credit] = await creditsOf(original.id);
    const listPrices = (saleId: string) =>
      inTx(venue, (tx) =>
        tx
          .select({
            listGross: saleLines.listGross,
            listUnitPriceGross: saleLines.listUnitPriceGross,
          })
          .from(saleLines)
          .where(eq(saleLines.saleId, saleId))
          .orderBy(saleLines.lineNo),
      );
    expect(await listPrices(original.id)).toEqual([
      { listGross: 400, listUnitPriceGross: 400 },
      { listGross: null, listUnitPriceGross: null },
    ]);
    expect(await listPrices(credit!.id)).toEqual([
      { listGross: -400, listUnitPriceGross: 400 },
      { listGross: null, listUnitPriceGross: null },
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

    await creditInvoice(id);

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

  it("credits a three-pick physical extra with its frozen price basis and exact line total", async () => {
    const id = await placed([
      {
        name: "Mosto",
        quantity: "1",
        extras: [
          { listId: portionListId, picks: [{ productId: productIdOf("Jamón"), quantity: 3 }] },
        ],
      },
    ]);
    const original = await invoiceOf(id);
    const invoiced = await linesOf(original.id);
    expect(invoiced[1]).toMatchObject({
      name: "Jamón",
      quantity: 150,
      priceQuantity: 50,
      unitPrice: 1,
      lineGross: 3,
      lineTotal: 2,
    });

    await creditInvoice(id);

    const [credit] = await creditsOf(original.id);
    expect(credit!.total).toBe(-original.total);
    expect(await linesOf(credit!.id)).toEqual(
      invoiced.map((line) => ({
        ...line,
        quantity: -line.quantity,
        lineTotal: -line.lineTotal,
        lineGross: -line.lineGross!,
      })),
    );
  });

  it("files the published 0.055 kg portion exactly after unit precision falls", async () => {
    await inTx(venue, async (tx) => {
      await tx.execute(
        sql`update extra_list_items set portion = 55 where list_id = ${portionListId}`,
      );
      await tx.execute(sql`update units set precision = 2 where seed_key = 'credit-test-kg'`);
    });
    try {
      const oldId = await placed([
        {
          name: "Mosto",
          quantity: "1",
          extras: [
            { listId: portionListId, picks: [{ productId: productIdOf("Jamón"), quantity: 3 }] },
          ],
        },
      ]);
      expect((await linesOf((await invoiceOf(oldId)).id))[1]).toMatchObject({
        quantity: 150,
        priceQuantity: 50,
        lineGross: 3,
      });

      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
      const newId = await placed([
        {
          name: "Mosto",
          quantity: "1",
          extras: [
            { listId: portionListId, picks: [{ productId: productIdOf("Jamón"), quantity: 3 }] },
          ],
        },
      ]);
      const newSale = await invoiceOf(newId);
      expect((await linesOf(newSale.id))[1]).toMatchObject({
        quantity: 165,
        priceQuantity: 55,
        lineGross: 3,
      });
      const [child] = await inTx(venue, (tx) =>
        tx
          .select({ unitPrecision: saleLines.unitPrecision })
          .from(saleLines)
          .where(
            and(eq(saleLines.saleId, newSale.id), eq(saleLines.productId, productIdOf("Jamón"))),
          ),
      );
      expect(child?.unitPrecision).toBe(2);
    } finally {
      await inTx(venue, async (tx) => {
        await tx.execute(
          sql`update extra_list_items set portion = 50 where list_id = ${portionListId}`,
        );
        await tx.execute(sql`update units set precision = 3 where seed_key = 'credit-test-kg'`);
        await offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" });
      });
    }
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

    await creditInvoice(id);

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

    const answer = () => creditInvoice(id, "staff");
    await expectRefusedUnwritten(id, answer, {
      code: "authorization.not_permitted",
    });
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
      await expectRefusedUnwritten(id, () => creditInvoice(id), {
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

  it.each([
    ["Mosto", "-0.55", { rate: "21.00", base: "0.45", tax: "0.10" }],
    ["Zumo", "-2.10", { rate: "21.00", base: "1.74", tax: "0.36" }],
  ])(
    "credits %s for %s with the invoice's own VAT split negated, where its lines would tax another",
    async (name, total, invoiced) => {
      const id = await placed([{ name, quantity: "1" }]);
      const original = await invoiceOf(id);
      expect(original.vatBreakdown).toEqual([invoiced]);

      await creditInvoice(id);

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
      expect(await statusOf(venue, id)).toBe("placed");
    },
  );

  it("fails loudly when the node has two live rectificative series, writing nothing", async () => {
    const id = await placed([{ name: "Caña", quantity: "1" }]);
    const code = `R${randomUUID().slice(0, 4)}`;
    await inTx(venue, (tx) =>
      insertNodeSeriesTx(tx, venue.cfg.nodeId, [{ code, purpose: "rectificative" }]),
    );
    try {
      const before = fiscalSnapshot();
      await expect(creditInvoice(id)).rejects.toThrow("has more than one rectificative series");
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
        origin: venue.cfg.origin,
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

    const answer = creditInvoice(id);

    await expect(answer).rejects.toMatchObject({ code: "sale.correction_exceeds_total" });
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
        origin: venue.cfg.origin,
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

    const answer = creditInvoice(id);

    await expect(answer).rejects.toMatchObject({ code: "sale.correction_not_whole" });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual(raised);
  });

  it("refuses when the invoice's stored lines disagree with its breakdown, writing nothing", async () => {
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

    await expectRefusedUnwritten(id, () => creditInvoice(id), {
      code: "sale.correction_lines_mismatch",
    });
  });

  it("refuses when the invoice's stored breakdown does not sum to its total, writing nothing", async () => {
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

    await expectRefusedUnwritten(id, () => creditInvoice(id), {
      code: "sale.total_mismatch",
    });
  });

  // The cancel reverses every stored invoice line exactly, so these two reach the line checks with
  // a value stored as bytes: it reads back as a new byte array each time, so the cancel's copy and
  // the one `recordCorrection` reads are not the same value.
  it("refuses when a stored invoice line's product reads back unlike itself, writing nothing", async () => {
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

    await expectRefusedUnwritten(id, () => creditInvoice(id), {
      code: "sale.correction_line_not_reversed",
    });
  });

  it("refuses when a stored invoice line's id reads back unlike itself, writing nothing", async () => {
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

    await expectRefusedUnwritten(id, () => creditInvoice(id), {
      code: "sale.correction_line_not_on_invoice",
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
        orderStart: "counter",
      });
    });
    const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId, false);
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
        orderStart: "counter",
      });
    });
    const id = await placed([{ name: "Caña", quantity: "1" }], ticketFirst.zoneId, false);
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

  it("names a credit note recorded against the invoice", async () => {
    const party = await invoicedPartyBill();
    const original = await invoiceOf(party.tabId);
    await creditInvoice(party.tabId);
    const credits = await creditsOf(original.id);
    expect(credits).toHaveLength(1);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill.status).toBe("placed");
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
      { expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)) },
    );
    expect(place.status).toBe(200);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill).toMatchObject({ status: "placed", receiptAvailable: false });
    expect(bill).not.toHaveProperty("invoiceNumber");
    expect(bill).not.toHaveProperty("creditNotes");
  });
});
