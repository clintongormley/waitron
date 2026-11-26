import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { saleLines, saleSettlements, workingOrderLines } from "@waitron/db";
import { listOutstandingSales } from "@waitron/core";
import { filedInvoiceOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { deviceId as brandDeviceId, type SaleId } from "@waitron/shared";
import { creditWholeInvoice, readOrderInvoice, reversedLines } from "./cancel-credit.js";
import { inTx, send, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/cancel-invoice-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

type Row = typeof saleLines.$inferSelect;

function row(overrides: Partial<Row>): Row {
  return {
    id: "line",
    saleId: "rest-sale",
    lineNo: 1,
    name: "Steak",
    descriptions: { "es-ES": "Ribeye steak" },
    variantName: null,
    variantDescriptions: null,
    variantKitchenName: null,
    kitchenName: null,
    optionSnapshots: [],
    unitName: null,
    unitPrecision: null,
    quantity: 1000,
    priceQuantity: 1000,
    unitPrice: 6612,
    vatRate: 2100,
    lineTotal: 6612,
    category: null,
    parentLineId: null,
    productId: null,
    parentProductId: null,
    menuId: null,
    menuVersionId: null,
    lineGross: 8000,
    listGross: null,
    listUnitPriceGross: null,
    classification: null,
    correctsLineId: null,
    advanceRole: null,
    deductsSaleId: null,
    setMenuRole: null,
    setMenuPart: null,
    ...overrides,
  };
}

describe("reversedLines", () => {
  it("a whole credit of a rest's invoice reverses its deduction line, role and sale included", () => {
    const [dish, deduction] = reversedLines([
      row({ id: "dish-line" }),
      row({
        id: "deduction-line",
        lineNo: 2,
        name: "Advance",
        quantity: -1000,
        unitPrice: 4545,
        vatRate: 1000,
        lineTotal: -4545,
        lineGross: -5000,
        advanceRole: "deduction",
        deductsSaleId: "advance-sale",
      }),
    ]);
    expect(dish).toMatchObject({ advanceRole: null, deductsSaleId: null });
    expect(deduction).toMatchObject({
      correctsLineId: "deduction-line",
      quantity: "1.000",
      lineTotal: "45.45",
      lineGross: "50.00",
      advanceRole: "deduction",
      deductsSaleId: "advance-sale",
    });
  });

  it("a whole credit reverses each line's set-menu part, and keeps an absent one null", () => {
    const [setMenu, dish, plain] = reversedLines([
      row({ id: "menu-line", setMenuRole: "set_menu", setMenuPart: -1400 }),
      row({ id: "dish-line", lineNo: 2, setMenuRole: "dish", setMenuPart: 358 }),
      row({ id: "plain-line", lineNo: 3 }),
    ]);
    expect(setMenu).toMatchObject({ setMenuPart: "14.00" });
    expect(dish).toMatchObject({ setMenuPart: "-3.58" });
    expect(plain).toMatchObject({ setMenuPart: null });
  });
});

// The whole-invoice corrective (R5) a cancel files for a bill it cannot cancel outright, and that
// Reopen bill files too, checked at `creditWholeInvoice` against a venue that files real
// Veri*Factu records.
let cv: fixture.CancelInvoiceVenue;
let venue: BillVenue;
let ticketThenPayZone: string;
let offerOf: (name: string) => string;
let productIdOf: (name: string) => string;
let extraListId: string;
let portionListId: string;
let supervisorId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    cv = await fixture.provisionCancelInvoiceVenue(db);
    ({ venue, ticketThenPayZone, offerOf, productIdOf, extraListId, portionListId, supervisorId } =
      cv);
  },
});

function placed(
  lines: Parameters<typeof fixture.placed>[1],
  zoneId = ticketThenPayZone,
  issued = true,
  dining: "eat_in" | "takeaway" = "eat_in",
): Promise<string> {
  return fixture.placed(cv, lines, zoneId, issued, dining);
}

const invoiceOf = (billId: string) => fixture.invoiceOf(venue, billId);
const creditsOf = (saleId: string) => fixture.creditsOf(venue, saleId);
const filedOf = (saleId: string) => filedInvoiceOf(venue.db, saleId);
const linesOf = (saleId: string) => fixture.linesOf(venue, saleId);
const activeCorrective = () => fixture.activeCorrective(venue);
const negate = fixture.negate;

/** Credits the bill's invoice whole on the first till's device, authorised by the supervisor. */
function creditInvoice(billId: string): Promise<SaleId> {
  return inTx(venue, async (tx) =>
    creditWholeInvoice(
      tx,
      { backend: venue.backend, clock: venue.clock, admission: testTradingAdmission() },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      (await readOrderInvoice(tx, billId))!,
      { sessionId: cv.supervisorSessionId },
    ),
  );
}

describe("creditWholeInvoice", () => {
  it("credits the whole invoice in the corrective series and settles it owing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    expect(original.total).toBe(300);
    // The requesting device is not the configuration's own, so the two cannot be confused below.
    expect(venue.deviceId).not.toBe(venue.cfg.origin.deviceId);
    expect(original).toMatchObject({ source: "device", deviceId: venue.deviceId });
    const series = await activeCorrective();

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

    const filed = filedOf(credit.id);
    const rectified = filedOf(original.id);
    expect(filed).toMatchObject({
      kind: "R5",
      correctionKind: "I",
      total: negate(rectified.total),
      vatTotal: negate(rectified.vatTotal),
    });
    expect(filed.breakdown).toEqual(
      rectified.breakdown.map((group) => ({
        ...group,
        base: negate(group.base),
        vat: negate(group.vat!),
      })),
    );
    expect(filed.corrects).toEqual([
      expect.objectContaining({
        issuerTaxId: rectified.issuerTaxId,
        number: rectified.number,
      }),
    ]);

    const settled = await inTx(venue, (tx) =>
      tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, original.id)),
    );
    expect(settled).toHaveLength(1);
    const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
    expect(outstanding.map((sale) => sale.saleId)).not.toContain(original.id);
    expect(await activeCorrective()).toEqual({ id: series!.id, next: series!.next + 1 });
  });

  it("copies each line's unit price before any discount onto the credit unnegated, and its list total negated", async () => {
    const id = randomUUID();
    const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
      dining: "eat_in",
      id,
      zoneId: ticketThenPayZone,
      lines: [
        { menuItemId: offerOf("Small beer"), quantity: "1" },
        { menuItemId: offerOf("Small beer"), quantity: "2" },
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

  it("credits a two-rate invoice line by line, an extras pick under its dish, each rate the exact negative of the invoice's, each line naming the invoice line it reverses", async () => {
    const id = await placed(
      [
        { name: "Small beer", quantity: "2" },
        {
          name: "Coffee",
          quantity: "1",
          extras: [
            { listId: extraListId, picks: [{ productId: productIdOf("Leche"), quantity: 2 }] },
          ],
        },
      ],
      ticketThenPayZone,
      true,
      "takeaway",
    );
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
      ["Small beer", 2000, null],
      ["Coffee", 1000, null],
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
    const invoicedLinks = await linksOf(original.id);
    expect(invoicedLinks).toHaveLength(3);
    expect((await linksOf(credit!.id)).map((line) => [line.lineNo, line.correctsLineId])).toEqual(
      invoicedLinks.map((line) => [line.lineNo, line.id]),
    );
  });

  it("credits a three-pick physical extra with its frozen price basis and exact line total", async () => {
    const id = await placed(
      [
        {
          name: "Mosto",
          quantity: "1",
          extras: [
            { listId: portionListId, picks: [{ productId: productIdOf("Ham"), quantity: 3 }] },
          ],
        },
      ],
      ticketThenPayZone,
      true,
      "takeaway",
    );
    const original = await invoiceOf(id);
    const invoiced = await linesOf(original.id);
    expect(invoiced[1]).toMatchObject({
      name: "Ham",
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

  it.each([
    ["Mosto", "-0.55", { rate: "21.00", base: "0.45", tax: "0.10" }],
    ["Zumo", "-2.10", { rate: "21.00", base: "1.74", tax: "0.36" }],
  ])(
    "credits %s for %s with the invoice's own VAT split negated, where its lines would tax another",
    async (name, total, invoiced) => {
      const id = await placed([{ name, quantity: "1" }], ticketThenPayZone, true, "takeaway");
      const original = await invoiceOf(id);
      expect(original.vatBreakdown).toEqual([invoiced]);

      await creditInvoice(id);

      const [credit] = await creditsOf(original.id);
      expect(credit!.total).toBe(-original.total);
      const negated = { rate: "21.00", base: negate(invoiced.base), tax: negate(invoiced.tax) };
      expect(credit!.vatBreakdown).toEqual([negated]);
      const filed = filedOf(credit!.id);
      expect(filed).toMatchObject({
        kind: "R5",
        total,
        vatTotal: negated.tax,
      });
      const [rectified] = filedOf(original.id).breakdown;
      expect(filed.breakdown).toEqual([
        {
          ...rectified,
          base: negated.base,
          vat: negated.tax,
        },
      ]);
    },
  );
});
