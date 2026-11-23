import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  billPayments,
  deviceProfiles,
  floorZones,
  products,
  devices,
  drawerOpens,
  invoiceSeries,
  invoiceDeliveries,
  printAgents,
  printers,
  printJobs,
  receiptReprints,
  saleLines,
  sales,
  saleSettlements,
  saleSubstitutions,
  tenders,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { payments } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setProfileServiceAccess, writeKitchenNote } from "@waitron/venue-service";
import { inTx, send } from "./testing/bill-venue.js";
import {
  billlessSale,
  collect,
  credit,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import type { TillSaleResult } from "./till-sale.js";
import { listInvoicePrinter } from "./testing/invoice-printer.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { invoiceDeliveryAlertSource } from "./alert-sources.js";
import { createPageTestPages } from "./page-test-pages.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import {
  abandonInvoiceEmail,
  reserveInvoiceDelivery,
  settleInvoiceEmail,
  startInvoiceEmail,
} from "./invoice-delivery.js";
import {
  claimInvoicePrintJobs,
  reportInvoicePrintJob,
  resendInvoicePrintJob,
} from "./invoice-print.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { RECEIPT_OUT_OF_DATE, saleReceiptLayout } from "./receipt-print.js";
import * as receiptDocument from "./receipt-document.js";
const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
  const profileId = await profile();
  await inTx(venue, async (tx) => {
    const [row] = await tx.select().from(deviceProfiles).where(eq(deviceProfiles.id, profileId));
    await tx
      .update(deviceProfiles)
      .set({ capabilities: [...(row!.capabilities as string[]), "print-receipt"] })
      .where(eq(deviceProfiles.id, profileId));
  });
});
const get = (id: string, cookie = venue.cookie) =>
  send(venue.app, cookie, "GET", `/api/transactions/${id}/receipt`);
const reprint = (id: string, body: unknown = {}, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/transactions/${id}/reprint`, body);
async function saleOf(orderId: string) {
  return (
    await inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.workingOrderId, orderId)))
  )[0]!;
}
async function snapshot() {
  return inTx(venue, async (tx) => ({
    sales: await tx.select().from(sales).orderBy(sales.id),
    billPayments: await tx.select().from(billPayments).orderBy(billPayments.id),
    providerPayments: await tx.select().from(payments).orderBy(payments.id),
    lines: await tx.select().from(saleLines).orderBy(saleLines.id),
    tenders: await tx.select().from(tenders).orderBy(tenders.id),
    settlements: await tx.select().from(saleSettlements).orderBy(saleSettlements.saleId),
    fiscal: (await tx.execute(sql`select * from verifactu_records order by id`)).rows,
    orders: await tx.select().from(workingOrders).orderBy(workingOrders.id),
    orderLines: await tx.select().from(workingOrderLines).orderBy(workingOrderLines.id),
  }));
}
async function profile() {
  return (
    await inTx(venue, (tx) =>
      tx
        .select({ id: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, venue.deviceId)),
    )
  )[0]!.id;
}
async function jobs() {
  return inTx(venue, async (tx) => ({
    prints: await tx.select().from(printJobs),
    reprints: await tx.select().from(receiptReprints),
    drawers: await tx.select().from(drawerOpens),
  }));
}
it("reads the filed invoice before collection without settling or enqueuing anything", async () => {
  const order = await placedIssuedBill(venue, "Croquettes");
  await inTx(venue, (tx) => writeKitchenNote(tx, { workingOrderId: order }, 0, "Train at 14:30"));
  const sale = await saleOf(order);
  await inTx(venue, (tx) =>
    tx.update(products).set({ customerName: { "es-ES": "Renamed after filing" } }),
  );
  const before = await snapshot(),
    printed = await jobs();
  const answer = await get(sale.id);
  expect(answer.status).toBe(200);
  const result = answer.json as unknown as TillSaleResult;
  expect(result).toMatchObject({
    invoiceNumber: `A/${sale.invoiceNumber}`,
    total: "10.00",
    tender: { method: "unpaid" },
    locale: sale.locale,
    namesLocale: sale.invoiceLocales[0],
    issuedAt: new Date(sale.issuedAt).toISOString(),
    lines: [{ descriptions: { "es-ES": "Croquetas de jamón" }, gross: "10.00" }],
  });
  expect(JSON.stringify(result.receiptPreview)).toContain("Croquetas de jamón");
  expect(JSON.stringify(result.receiptPreview)).not.toContain("Train at 14:30");
  expect(result.qr).not.toBe("");
  expect(result.issuer).toMatchObject({ venueName: "Tarjetas SL", nif: "61000002T" });
  expect(await snapshot()).toEqual(before);
  expect(await jobs()).toEqual(printed);
});
it("keeps the invoice available when its preview cannot be built", async () => {
  const id = await billlessSale(venue);
  const preview = vi.spyOn(receiptDocument, "buildReceiptDocument").mockImplementationOnce(() => {
    throw new Error("preview failed");
  });
  onTestFinished(() => preview.mockRestore());
  const answer = await get(id);
  expect(answer).toMatchObject({ status: 200, json: { invoiceNumber: "A/1", total: "12.10" } });
  expect(preview).toHaveBeenCalledOnce();
  expect(answer.json).not.toHaveProperty("receiptPreview");
});
it("reads paid and orderless original sales and a correction by their own identity", async () => {
  const order = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, order, "3.00")).status).toBe(200);
  const original = await saleOf(order);
  await credit(venue, order, "1.00", "-1.10");
  const correction = (
    await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, original.id)),
    )
  )[0]!.id;
  const loose = await billlessSale(venue);
  const before = await snapshot();
  for (const id of [original.id, correction, loose]) {
    const [sale] = await inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.id, id)));
    const [series] = await inTx(venue, (tx) =>
      tx.select().from(invoiceSeries).where(eq(invoiceSeries.id, sale!.seriesId)),
    );
    const answer = await get(id);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      invoiceNumber: `${series!.code}/${sale!.invoiceNumber}`,
      total: id === correction ? "-1.10" : id === loose ? "12.10" : "3.00",
      issuedAt: new Date(sale!.issuedAt).toISOString(),
      lines: [
        {
          descriptions: {
            "es-ES":
              id === correction ? "Descuento" : id === loose ? "Venta suelta" : "Caña de cerveza",
          },
          gross: id === correction ? "-1.10" : id === loose ? "12.10" : "3.00",
        },
      ],
    });
    expect((answer.json as unknown as TillSaleResult).lines).toHaveLength(1);
    const filed = await inTx(venue, (tx) =>
      venue.backend.filedReceiptFor(tx, id as Parameters<typeof venue.backend.filedReceiptFor>[1]),
    );
    expect((answer.json as unknown as TillSaleResult).qr).toBe(filed!.verificationUrl);
  }
  expect(await snapshot()).toEqual(before);
});
it("refuses malformed and missing sale IDs without side effects", async () => {
  await billlessSale(venue);
  const before = await jobs();
  for (const missing of ["bad", randomUUID()])
    expect(await get(missing)).toMatchObject({ status: 400, json: { code: "sale.not_found" } });
  expect(await jobs()).toEqual(before);
});
it("GET needs a session but no print action; POST requires print-receipt", async () => {
  const id = await billlessSale(venue);
  expect(await get(id, "")).toMatchObject({ status: 401, json: { code: "session.required" } });
  expect(await reprint(id, {}, "")).toMatchObject({
    status: 401,
    json: { code: "session.required" },
  });
  const profileId = await profile();
  await inTx(venue, (tx) =>
    tx.update(deviceProfiles).set({ capabilities: [] }).where(eq(deviceProfiles.id, profileId)),
  );
  expect((await get(id)).status).toBe(200);
  expect(await reprint(id)).toMatchObject({
    status: 403,
    json: { code: "device.forbidden_action", params: { action: "reprint" } },
  });
});
it("reprints a duplicate document with an audit row and no drawer or fiscal change", async () => {
  const id = await billlessSale(venue),
    before = await snapshot(),
    printed = await jobs();
  expect((await reprint(id)).status).toBe(200);
  const after = await jobs();
  expect(after.prints).toHaveLength(printed.prints.length + 1);
  expect(after.reprints).toHaveLength(printed.reprints.length + 1);
  expect(after.drawers).toEqual(printed.drawers);
  expect(after.prints.at(-1)).toMatchObject({ saleId: id, kind: "document" });
  expect(after.reprints.at(-1)).toMatchObject({ saleId: id, personId: venue.operatorId });
  expect(await snapshot()).toEqual(before);
});
it("shows the saved guests in the preview and on the paper copy", async () => {
  const id = await billlessSale(venue, {
    receipt: { guestCount: 5, departmentId: null, tradingName: "", printsTradingName: false },
  });
  const answer = await get(id);
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({
    receiptPreview: expect.arrayContaining([
      expect.objectContaining({ kind: "amount", caption: "5 comensales · por persona" }),
      expect.objectContaining({ kind: "text", text: "Tarjetas SL" }),
    ]),
  });
  const printed = (await jobs()).prints.length;
  expect((await reprint(id)).status).toBe(200);
  const { prints } = await jobs();
  expect(prints).toHaveLength(printed + 1);
  const { decodeTicket } = await import("./testing/decode-ticket.js");
  const copy = decodeTicket(prints.at(-1)!.payload);
  expect(copy).toContain("DUPLICADO");
  expect(copy).toContain("5 comensales · por persona");
});
it("marks a practice receipt twice without claiming a cash payment was simulated", async () => {
  const id = await billlessSale(venue);
  const app = venue.appWith({ practiceMode: true });
  const answer = await send(app, venue.cookie, "GET", `/api/transactions/${id}/receipt`);
  expect(answer.status).toBe(200);
  const { receiptPreview } = answer.json as unknown as TillSaleResult;
  const marks = receiptPreview?.filter(
    (element) => element.kind === "text" && /PRUEBA|COBRO REAL/.test(element.text),
  );
  expect(marks).toEqual([
    { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
    { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
  ]);
});
let projectionNumber = 900100;
async function projectionInvoice(
  patch: Partial<typeof sales.$inferInsert> = {},
  linePatch: Partial<typeof saleLines.$inferInsert> = {},
) {
  const id = randomUUID(),
    lineId = randomUUID();
  await inTx(venue, async (tx) => {
    await tx.insert(sales).values({
      id,
      source: "device",
      deviceId: venue.deviceId,
      seriesId: venue.seriesId,
      nodeId: venue.cfg.nodeId,
      invoiceNumber: ++projectionNumber,
      issuedAt: "2026-10-14T21:30:00Z",
      issuedOffsetMinutes: 120,
      total: 1210,
      vatBreakdown: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "verifactu",
      fiscalState: "not_applicable",
      ...patch,
    });
    await tx.insert(saleLines).values({
      id: lineId,
      saleId: id,
      lineNo: 1,
      name: "Staff name",
      descriptions: { "es-ES": "Nombre de cliente congelado" },
      quantity: 1000,
      unitPrice: 1000,
      vatRate: 2100,
      lineTotal: 1000,
      lineGross: 1210,
      ...linePatch,
    });
  });
  return { id, lineId };
}
it("offers the device's Invoice printer for an orderless historical full invoice without printing", async () => {
  const sale = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
  });
  const profileId = await profile();
  await inTx(venue, (tx) =>
    listInvoicePrinter(tx, { profileId, printerId: venue.printerId, isDefault: true }),
  );
  const before = await snapshot(),
    printed = await jobs();
  const answer = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/transactions/${sale.id}/deliveries`,
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  expect(answer.json).toMatchObject({
    originalCompleted: false,
    actions: {
      print: { designation: "original", printers: [{ id: venue.printerId, kind: "receipt" }] },
      email: null,
    },
  });
  expect(await snapshot()).toEqual(before);
  expect(await jobs()).toEqual(printed);
});
it("keeps the original Invoice destination through status, retry and handover", async () => {
  const sale = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Stored address",
  });
  const profileId = await profile();
  await inTx(venue, (tx) =>
    listInvoicePrinter(tx, { profileId, printerId: venue.printerId, isDefault: true }),
  );
  const before = await snapshot(),
    printed = await jobs();
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries`,
    {
      medium: "print",
      requestKey: randomUUID(),
      printerId: venue.printerId,
    },
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  expect(answer.json).toMatchObject({
    medium: "receipt",
    designation: "original",
    status: "queued",
  });
  const after = await jobs();
  expect(after.prints).toHaveLength(printed.prints.length + 1);
  expect(after.prints.at(-1)).toMatchObject({
    saleId: sale.id,
    printerId: venue.printerId,
    receiptCopy: false,
    kind: "document",
  });
  expect(after.drawers).toEqual(printed.drawers);
  expect(after.reprints).toEqual(printed.reprints);
  expect(await snapshot()).toEqual(before);
  const original = (await jobs()).prints.at(-1)!;
  await inTx(venue, (tx) =>
    tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, original.id)),
  );
  await inTx(venue, (tx) =>
    tx
      .update(invoiceDeliveries)
      .set({
        status: "failed",
        failureCode: "transport_failed",
        reportedAt: new Date().toISOString(),
      })
      .where(eq(invoiceDeliveries.printJobId, original.id)),
  );
  const status = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/transactions/${sale.id}/receipt-print`,
  );
  expect(status.status, JSON.stringify(status.json)).toBe(200);
  expect(status.json).toMatchObject({
    status: "failed",
    jobId: original.id,
    canRetry: true,
    printerId: venue.printerId,
    printerName: expect.any(String),
  });
  await inTx(venue, (tx) =>
    tx
      .update(deviceProfiles)
      .set({ printerLists: sql`json_remove(${deviceProfiles.printerLists}, '$.invoice')` })
      .where(eq(deviceProfiles.id, profileId)),
  );
  const withdrawn = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/transactions/${sale.id}/receipt-print`,
  );
  expect(withdrawn.json).toMatchObject({ printerWithdrawn: true, printerId: venue.printerId });
  const priorJobs = await jobs();
  expect(
    await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${sale.id}/receipt-print/retry`,
      {},
    ),
  ).toMatchObject({ status: 409, json: { code: "invoice_delivery.printer_invalid" } });
  expect(await jobs()).toEqual(priorJobs);
  await inTx(venue, (tx) =>
    listInvoicePrinter(tx, { profileId, printerId: venue.printerId, isDefault: true }),
  );
  const retry = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/receipt-print/retry`,
    {},
  );
  expect(retry.status, JSON.stringify(retry.json)).toBe(200);
  const resent = (await jobs()).prints.at(-1)!;
  expect(resent).toMatchObject({
    saleId: sale.id,
    printerId: original.printerId,
    receiptCopy: false,
    resendOf: original.id,
  });
  await inTx(venue, async (tx) => {
    await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, resent.id));
    await tx
      .update(invoiceDeliveries)
      .set({ status: "sent" })
      .where(eq(invoiceDeliveries.printJobId, resent.id));
  });
  const handover = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/receipt-print/handover`,
    {},
  );
  expect(handover.status, JSON.stringify(handover.json)).toBe(200);
  expect(handover.json).toMatchObject({ status: "done", handover: { personId: venue.operatorId } });
  const copy = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries`,
    {
      medium: "print",
      requestKey: randomUUID(),
      printerId: venue.printerId,
    },
  );
  expect(copy.status, JSON.stringify(copy.json)).toBe(200);
  expect(copy.json).toMatchObject({ designation: "duplicate", medium: "receipt" });
  const copyJobs = await jobs();
  expect(copyJobs.prints.at(-1)).toMatchObject({ saleId: sale.id, receiptCopy: true });
  expect(copyJobs.reprints).toEqual([
    expect.objectContaining({
      saleId: sale.id,
      personId: venue.operatorId,
      printJobId: copyJobs.prints.at(-1)!.id,
    }),
  ]);
  expect((await jobs()).drawers).toEqual([]);
  expect(await snapshot()).toEqual(before);
});
it("sends an orderless A4 original to its receipt destination instead", async () => {
  const sale = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Stored address",
  });
  const profileId = await profile();
  const officeId = await inTx(venue, async (tx) => {
    const [agent] = await tx
      .insert(printAgents)
      .values({ name: "Office agent", tokenHash: "scrypt$test" })
      .returning();
    const printerId = await insertA4Printer(tx, {
      name: "Office",
      host: "192.0.2.20",
      resolutionDpi: 600,
      agentId: agent!.id,
    });
    await listInvoicePrinter(tx, { profileId, pagePrinterId: printerId, isDefault: true });
    return printerId;
  });
  const before = await snapshot();
  const original = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries`,
    { medium: "print", requestKey: randomUUID(), printerId: officeId },
  );
  expect(original.status, JSON.stringify(original.json)).toBe(200);
  expect(original.json).toMatchObject({ medium: "a4", designation: "original" });
  const switched = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries/${(original.json as { id: string }).id}/to-receipt`,
    { requestKey: randomUUID() },
  );
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);
  expect(switched.json).toMatchObject({ medium: "receipt", designation: "original" });
  expect((await jobs()).prints.at(-1)).toMatchObject({
    saleId: sale.id,
    printerId: venue.printerId,
    receiptCopy: false,
  });
  expect((await jobs()).drawers).toEqual([]);
  expect(await snapshot()).toEqual(before);
});
it("the new delivery paths refuse order-linked sales and simplified invoices without effects", async () => {
  const linked = await saleOf(await placedIssuedBill(venue, "Croquettes"));
  const simplified = await billlessSale(venue);
  const before = await snapshot(),
    printed = await jobs();
  for (const [method, suffix] of [
    ["GET", "deliveries"],
    ["POST", "deliveries"],
    ["POST", `deliveries/${randomUUID()}/to-receipt`],
    ["GET", "receipt-print"],
    ["POST", "receipt-print/retry"],
    ["POST", "receipt-print/handover"],
  ] as const) {
    const body =
      method === "POST"
        ? { medium: "print", printerId: venue.printerId, requestKey: randomUUID() }
        : undefined;
    const denied = await send(
      venue.app,
      venue.cookie,
      method,
      `/api/transactions/${linked.id}/${suffix}`,
      body,
    );
    expect(denied.json, suffix).toMatchObject({ code: "sale.not_found" });
    const wrongDocument = await send(
      venue.app,
      venue.cookie,
      method,
      `/api/transactions/${simplified}/${suffix}`,
      body,
    );
    expect(wrongDocument.json, suffix).toMatchObject({
      code: "invoice_delivery.full_invoice_required",
    });
  }
  expect(await snapshot()).toEqual(before);
  expect(await jobs()).toEqual(printed);
});
it("orderless writes require device proof while reads and handover need no print capability", async () => {
  const id = (
    await projectionInvoice({ counterpartyTaxId: "B00000000", counterpartyLegalName: "Recipient" })
  ).id;
  const noProof = venue.cookie
    .split(";")
    .filter((part) => !part.trim().startsWith(`${DEVICE_COOKIE}=`))
    .join(";");
  const before = await jobs();
  for (const suffix of [
    "deliveries",
    `deliveries/${randomUUID()}/to-receipt`,
    "receipt-print/retry",
    "receipt-print/handover",
  ]) {
    expect(
      await send(venue.app, noProof, "POST", `/api/transactions/${id}/${suffix}`, {}),
      suffix,
    ).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
  }
  const profileId = await profile();
  await inTx(venue, (tx) =>
    tx.update(deviceProfiles).set({ capabilities: [] }).where(eq(deviceProfiles.id, profileId)),
  );
  expect(
    (await send(venue.app, venue.cookie, "GET", `/api/transactions/${id}/deliveries`)).status,
  ).toBe(200);
  expect(
    (await send(venue.app, venue.cookie, "GET", `/api/transactions/${id}/receipt-print`)).status,
  ).toBe(200);
  expect(
    await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${id}/receipt-print/handover`,
      {},
    ),
  ).toMatchObject({ status: 409, json: { code: "receipt.not_printed" } });
  expect(await jobs()).toEqual(before);
});
it("orderless delivery checks every source zone before any status or action", async () => {
  const firstSale = await saleOf(await placedIssuedBill(venue, "Croquettes"));
  const secondSale = await saleOf(await placedIssuedBill(venue, "Croquettes"));
  const own = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Address",
  });
  const sourceProfile = await profile();
  const firstOrderId = [firstSale.workingOrderId!, secondSale.workingOrderId!].sort()[0]!;
  await inTx(venue, async (tx) => {
    await tx
      .update(workingOrders)
      .set({ zoneId: venue.zoneId })
      .where(eq(workingOrders.id, firstOrderId));
    await tx.insert(saleSubstitutions).values(
      [firstSale, secondSale].map((sale) => ({
        substitutionSaleId: own.id,
        substitutedSaleId: sale.id,
      })),
    );
    const [zone] = await tx.select().from(floorZones).where(eq(floorZones.id, venue.zoneId));
    await setProfileServiceAccess(tx, sourceProfile, {
      departmentId: zone!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    });
  });
  const before = await jobs();
  for (const [method, suffix] of [
    ["GET", "deliveries"],
    ["POST", "deliveries"],
    ["POST", `deliveries/${randomUUID()}/to-receipt`],
    ["GET", "receipt-print"],
    ["POST", "receipt-print/retry"],
    ["POST", "receipt-print/handover"],
  ] as const) {
    const answer = await send(
      venue.app,
      venue.cookie,
      method,
      `/api/transactions/${own.id}/${suffix}`,
      method === "GET"
        ? undefined
        : { medium: "print", printerId: venue.printerId, requestKey: randomUUID() },
    );
    expect(answer, suffix).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
  }
  expect(await jobs()).toEqual(before);
  await inTx(venue, async (tx) => {
    const [zone] = await tx.select().from(floorZones).where(eq(floorZones.id, venue.zoneId));
    await setProfileServiceAccess(tx, sourceProfile, {
      departmentId: zone!.departmentId,
      allowedZoneIds: [venue.zoneId, venue.counterZone],
      startingZoneId: venue.zoneId,
    });
  });
  expect(
    await send(venue.app, venue.cookie, "GET", `/api/transactions/${own.id}/deliveries`),
  ).toMatchObject({ status: 200 });
  expect(await jobs()).toEqual(before);
});
it.each([false, true])(
  "a historical full invoice retains its own recipient, domicile and offset, paid=%s",
  async (paid) => {
    const sale = await projectionInvoice({
      counterpartyTaxId: "B00000000",
      counterpartyLegalName: "Stored recipient",
      counterpartyCountryCode: "ES",
      counterpartyAddress: "Frozen address",
      taxpayerDomicile: "Frozen issuer domicile",
    });
    if (paid)
      await inTx(venue, async (tx) => {
        await tx.insert(tenders).values({
          saleId: sale.id,
          method: "cash",
          amount: 1210,
          settledAt: "2026-10-15T00:00:00Z",
        });
        await tx
          .insert(saleSettlements)
          .values({ saleId: sale.id, settledAt: "2026-10-15T00:00:00Z" });
      });
    vi.spyOn(venue.backend, "filedReceiptFor").mockImplementation(async (_tx, id) => ({
      verificationUrl: `https://stored.test/${id}`,
      vatBreakdown: [],
      issuer: { legalName: "Frozen issuer", taxId: "61000002T" },
    }));
    const before = await snapshot();
    const answer = await get(sale.id);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      invoiceType: "F1",
      issuer: { venueName: "Frozen issuer", nif: "61000002T", domicile: "Frozen issuer domicile" },
      recipient: {
        taxId: "B00000000",
        legalName: "Stored recipient",
        countryCode: "ES",
        address: "Frozen address",
      },
      issuedOffsetMinutes: 120,
      total: "12.10",
      qr: `https://stored.test/${sale.id}`,
      lines: [{ descriptions: { "es-ES": "Nombre de cliente congelado" } }],
      tender: { method: paid ? "cash" : "unpaid" },
    });
    expect(await snapshot()).toEqual(before);
  },
);
it("a substitution uses its own receipt, and source-zone access checks all of its original bills", async () => {
  const order = await placedIssuedBill(venue, "Caña"),
    original = await saleOf(order);
  const substitute = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Substitution recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Substitution address",
  });
  await inTx(venue, (tx) =>
    tx
      .insert(saleSubstitutions)
      .values({ substitutionSaleId: substitute.id, substitutedSaleId: original.id }),
  );
  vi.spyOn(venue.backend, "filedReceiptFor").mockImplementation(async (_tx, id) => ({
    verificationUrl: `https://stored.test/${id}`,
    vatBreakdown: [],
    issuer: { legalName: "Stored issuer", taxId: "61000002T" },
  }));
  const answer = await get(substitute.id);
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({
    qr: `https://stored.test/${substitute.id}`,
    total: "12.10",
    recipient: { legalName: "Substitution recipient" },
    lines: [{ descriptions: { "es-ES": "Nombre de cliente congelado" } }],
  });
  const profileId = await profile();
  await inTx(venue, async (tx) => {
    const [policy] = await tx.select().from(floorZones).where(eq(floorZones.id, venue.counterZone));
    await setProfileServiceAccess(tx, profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    });
  });
  const before = await jobs();
  for (const id of [original.id, substitute.id]) {
    expect(await get(id)).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
    expect(await reprint(id)).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
  }
  expect(await jobs()).toEqual(before);
});
it.each(["xx-XX", "", null, 42, ["es-ES"]])(
  "refuses unsupported or nonstring print language %j without an audit or print",
  async (language) => {
    const id = await billlessSale(venue),
      before = await jobs();
    expect(await reprint(id, { language })).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "language" } },
    });
    expect(await jobs()).toEqual(before);
  },
);
it("accepts an invoice's own disabled language and prints frozen-name fallback as a duplicate", async () => {
  const own = await projectionInvoice({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
  const before = await snapshot();
  expect((await reprint(own.id, { language: "ca-ES" })).status).toBe(200);
  const rows = await jobs();
  expect(rows.reprints).toHaveLength(1);
  expect(rows.prints).toHaveLength(1);
  const { decodeTicket } = await import("./testing/decode-ticket.js");
  const text = decodeTicket(rows.prints[0]!.payload);
  expect(text).toContain("DUPLICAT");
  expect(text).toContain("Nombre de cliente congelado");
  expect(await snapshot()).toEqual(before);
});
it("a device with no receipt printer refuses with receipt.no_printer without adding an audit or drawer job", async () => {
  const id = await billlessSale(venue);
  await inTx(venue, (tx) =>
    tx.update(devices).set({ receiptPrinterId: null }).where(eq(devices.id, venue.deviceId)),
  );
  const before = await jobs();
  expect(await reprint(id)).toMatchObject({ status: 409, json: { code: "receipt.no_printer" } });
  expect(await jobs()).toEqual(before);
});
it("preserves frozen extras, option answers, unit quantities and F1 list prices", async () => {
  const option = {
    listName: { es: "Staff question" },
    listCustomerName: { es: "Punto" },
    listKitchenName: "Kitchen question",
    labelName: { es: "Staff answer" },
    labelCustomerName: { es: "Hecho" },
    labelKitchenName: "Kitchen answer",
  };
  const own = await projectionInvoice(
    {
      total: 1452,
      vatBreakdown: [{ rate: "21.00", base: "12.00", tax: "2.52" }],
      counterpartyTaxId: "B00000000",
      counterpartyLegalName: "Recipient",
      counterpartyCountryCode: "ES",
      counterpartyAddress: "Address",
    },
    { listGross: 1500, optionSnapshots: [option] },
  );
  await inTx(venue, (tx) =>
    tx.insert(saleLines).values({
      saleId: own.id,
      lineNo: 2,
      parentLineId: own.lineId,
      name: "Staff extra",
      descriptions: { "es-ES": "Extra congelado" },
      quantity: 250,
      priceQuantity: 1000,
      unitName: { es: "kg" },
      unitPrecision: 3,
      unitPrice: 800,
      vatRate: 2100,
      lineTotal: 200,
      lineGross: 242,
    }),
  );
  const before = await snapshot();
  const answer = await get(own.id);
  expect(answer.status).toBe(200);
  expect((answer.json as unknown as TillSaleResult).lines).toMatchObject([
    {
      descriptions: { "es-ES": "Nombre de cliente congelado" },
      quantity: "1",
      gross: "12.10",
      listGross: "15.00",
      optionSnapshots: [option],
      net: { unitPrice: "10.00", base: "10.00", rate: "21.00", tax: "2.10" },
    },
    {
      descriptions: { "es-ES": "Extra congelado" },
      parentLineNo: 1,
      quantity: "0.250",
      gross: "2.42",
      unitName: { es: "kg" },
      unitPrecision: 3,
    },
  ]);
  expect(await snapshot()).toEqual(before);
});
it("allows an orderless invoice even when the permitted-zone set is empty", async () => {
  const own = await billlessSale(venue),
    profileId = await profile();
  await inTx(venue, async (tx) => {
    const [policy] = await tx.select().from(floorZones).where(eq(floorZones.id, venue.counterZone));
    await setProfileServiceAccess(tx, profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.counterZone],
      startingZoneId: venue.counterZone,
    });
    await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.counterZone));
  });
  expect((await get(own)).status).toBe(200);
  expect((await reprint(own)).status).toBe(200);
});
it("prints in a currently offered language while keeping the invoice and frozen names", async () => {
  const own = await projectionInvoice({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
  const before = await snapshot();
  expect((await reprint(own.id, { language: "es-ES" })).status).toBe(200);
  const { decodeTicket } = await import("./testing/decode-ticket.js");
  const rows = await jobs();
  expect(decodeTicket(rows.prints[0]!.payload)).toContain("DUPLICADO");
  expect(decodeTicket(rows.prints[0]!.payload)).toContain("Nombre de cliente congelado");
  expect(await snapshot()).toEqual(before);
});
it("a revoked device is refused on both receipt paths", async () => {
  const id = await billlessSale(venue);
  await inTx(venue, (tx) =>
    tx.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId)),
  );
  expect(await get(id)).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
  expect(await reprint(id)).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
});
it("an F1 duplicate remains enrolled in receipt delivery through the shared printer helper", async () => {
  const own = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Address",
  });
  await inTx(venue, (tx) =>
    tx.insert(printJobs).values({
      printerId: venue.printerId,
      payload: new Uint8Array(),
      kind: "document",
      saleId: own.id,
      receiptCopy: false,
      status: "done",
    }),
  );
  expect((await reprint(own.id)).status).toBe(200);
  const rows = await jobs();
  const deliveries = await inTx(venue, (tx) =>
    tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.saleId, own.id)),
  );
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({
    saleId: own.id,
    printJobId: rows.prints.find((row) => row.receiptCopy === true)!.id,
    medium: "receipt",
  });
});
it.each([false, true])(
  "fills only absent line grosses from the saved VAT group and keeps its rounding, first gross frozen=%s",
  async (frozen) => {
    const own = await projectionInvoice(
      { total: 6, vatBreakdown: [{ rate: "21.00", base: "0.05", tax: "0.01" }] },
      { unitPrice: 1, lineTotal: 1, lineGross: frozen ? 2 : null },
    );
    await inTx(venue, async (tx) => {
      for (const [lineNo, base] of [
        [2, 1],
        [3, 3],
      ])
        await tx.insert(saleLines).values({
          saleId: own.id,
          lineNo: lineNo!,
          name: "Tiny row",
          descriptions: { "es-ES": `Tiny ${lineNo}` },
          quantity: 1000,
          unitPrice: base!,
          vatRate: 2100,
          lineTotal: base!,
          lineGross: null,
        });
    });
    const answer = await get(own.id);
    expect(answer.status).toBe(200);
    expect((answer.json as unknown as TillSaleResult).lines.map((line) => line.gross)).toEqual(
      frozen ? ["0.02", "0.01", "0.03"] : ["0.01", "0.01", "0.04"],
    );
    expect(answer.json.total).toBe("0.06");
  },
);
it("reads every pre-invoice payment in order without replaying settlement", async () => {
  const order = await parked(venue, "Caña");
  for (const amount of ["1.00", "2.00"])
    expect(
      (
        await send(venue.app, venue.cookie, "POST", `/api/working-orders/${order}/payments`, {
          submissionId: randomUUID(),
          kind: "contribution",
          method: "cash",
          amount,
          tendered: amount,
          applied: amount,
          addedTip: "0.00",
          tip: "0.00",
        })
      ).status,
    ).toBe(200);
  const sale = await saleOf(order),
    before = await snapshot();
  const answer = await get(sale.id);
  expect(answer.status).toBe(200);
  expect(answer.json.payments).toEqual([
    { method: "cash", amount: "1.00", tip: "0.00", tendered: "1.00", change: "0.00", refunds: [] },
    { method: "cash", amount: "2.00", tip: "0.00", tendered: "2.00", change: "0.00", refunds: [] },
  ]);
  expect(await snapshot()).toEqual(before);
});
it("a card bill payment's details reach the receipt", async () => {
  const order = await parked(venue, "Caña");
  for (const amount of ["1.00", "2.00"])
    expect(
      (
        await send(venue.app, venue.cookie, "POST", `/api/working-orders/${order}/payments`, {
          submissionId: randomUUID(),
          kind: "contribution",
          method: "card",
          entry: "manual",
          amount,
          applied: amount,
          tip: "0.00",
        })
      ).status,
    ).toBe(200);
  const [first] = await inTx(venue, (tx) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.workingOrderId, order))
      .orderBy(sql`${payments}.rowid`)
      .limit(1),
  );
  await liftPaymentGuard(venue.db, () =>
    venue.db.execute(
      sql`update payments set provider = 'sumup', card_scheme = 'VISA', card_last4 = '4034', card_entry_mode = 'chip', card_auth_code = null where id = ${first!.id}`,
    ),
  );
  const answer = await get((await saleOf(order)).id);
  expect(answer.status).toBe(200);
  expect(answer.json.payments).toEqual([
    {
      method: "card",
      amount: "1.00",
      tip: "0.00",
      reference: null,
      card: { scheme: "VISA", last4: "4034", entryMode: "chip", authCode: null },
      refunds: [],
    },
    { method: "card", amount: "2.00", tip: "0.00", reference: null, refunds: [] },
  ]);
});
it("a card bill payment names its card when charged, even if voided later, and not before", async () => {
  const order = await parked(venue, "Caña");
  for (const amount of ["1.00", "2.00"])
    expect(
      (
        await send(venue.app, venue.cookie, "POST", `/api/working-orders/${order}/payments`, {
          submissionId: randomUUID(),
          kind: "contribution",
          method: "card",
          entry: "manual",
          amount,
          applied: amount,
          tip: "0.00",
        })
      ).status,
    ).toBe(200);
  const [voided, unsettled] = await inTx(venue, (tx) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.workingOrderId, order))
      .orderBy(sql`${payments}.rowid`),
  );
  await liftPaymentGuard(venue.db, async () => {
    await venue.db.execute(
      sql`update payments set provider = 'sumup', state = 'voided', card_scheme = 'VISA', card_last4 = '4034', card_entry_mode = null, card_auth_code = '354739' where id = ${voided!.id}`,
    );
    await venue.db.execute(
      sql`update payments set provider = 'sumup', state = 'failed', settled_at = null, card_scheme = 'MASTERCARD', card_last4 = '1111', card_entry_mode = 'chip', card_auth_code = null where id = ${unsettled!.id}`,
    );
  });
  const answer = await get((await saleOf(order)).id);
  expect(answer.status).toBe(200);
  expect(answer.json.payments).toEqual([
    {
      method: "card",
      amount: "1.00",
      tip: "0.00",
      reference: null,
      card: { scheme: "VISA", last4: "4034", entryMode: "unknown", authCode: "354739" },
      refunds: [],
    },
    { method: "card", amount: "2.00", tip: "0.00", reference: null, refunds: [] },
  ]);
  expect(answer.json).toMatchObject({
    receiptPreview: expect.arrayContaining([
      expect.objectContaining({ kind: "amount", caption: "Visa ****4034" }),
      expect.objectContaining({ kind: "text", text: "Autorización 354739" }),
    ]),
  });
  expect(JSON.stringify(answer.json.receiptPreview)).not.toContain("****1111");
});
async function correctiveOf(
  originalId: string,
  replacesOriginal: boolean,
  patch: Partial<typeof sales.$inferInsert> = {},
) {
  const [series] = await inTx(venue, (tx) =>
    tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "corrective")),
      ),
  );
  return projectionInvoice({
    seriesId: series!.id,
    correctsSaleId: originalId,
    replacesOriginal,
    ...patch,
  });
}
it("prints a replacement corrective's first till print as its original and later ones as copies", async () => {
  const original = await projectionInvoice();
  const replacement = await correctiveOf(original.id, true);
  const before = await snapshot();
  const { decodeTicket } = await import("./testing/decode-ticket.js");
  expect((await reprint(replacement.id)).status).toBe(200);
  const first = await jobs();
  expect(first.prints).toEqual([
    expect.objectContaining({ saleId: replacement.id, kind: "document", receiptCopy: false }),
  ]);
  expect(decodeTicket(first.prints[0]!.payload)).not.toContain("DUPLICADO");
  expect(first.reprints).toEqual([]);
  expect(first.drawers).toEqual([]);
  expect((await reprint(replacement.id)).status).toBe(200);
  const second = await jobs();
  expect(second.prints).toHaveLength(2);
  const copy = second.prints.find((row) => row.id !== first.prints[0]!.id)!;
  expect(copy).toMatchObject({ saleId: replacement.id, receiptCopy: true });
  expect(decodeTicket(copy.payload)).toContain("DUPLICADO");
  expect(second.reprints).toEqual([
    expect.objectContaining({ saleId: replacement.id, printJobId: copy.id }),
  ]);
  expect(second.drawers).toEqual([]);
  expect(await snapshot()).toEqual(before);
});
it("prints a replacement's original in the language chosen at the till, and the print queue resends it in that language", async () => {
  const original = await projectionInvoice({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
  const replacement = await correctiveOf(original.id, true, {
    locale: "ca-ES",
    invoiceLocales: ["ca-ES"],
  });
  expect((await reprint(replacement.id, { language: "es-ES" })).status).toBe(200);
  const { prints } = await jobs();
  expect(prints).toEqual([expect.objectContaining({ saleId: replacement.id, receiptCopy: false })]);
  const { decodeTicket } = await import("./testing/decode-ticket.js");
  const text = decodeTicket(prints[0]!.payload);
  expect(text).toMatch(/Tipo +Base +IVA +Total/u);
  expect(text).not.toMatch(/Tipus +Base/u);
  expect(prints[0]!.pageLanguage).toBe("es-ES");

  await inTx(venue, (tx) =>
    tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, prints[0]!.id)),
  );
  const printQueue = new Hono();
  mountPrintApi(
    printQueue,
    {
      db: venue.db,
      cfg: venue.cfg,
      pairingMode: createPairingMode(),
      readMembership: async () => null,
      readInvoiceDocument: () => Promise.reject(new Error("No invoice is read here")),
      layOutSaleReceipt: saleReceiptLayout(venue.backend, venue.cfg),
      venueLocale: "es-ES",
    },
    () => {},
  );
  const retried = await printQueue.request(`/management-api/print-jobs/${prints[0]!.id}/resend`, {
    method: "POST",
    headers: { cookie: venue.adminDashboard, "content-type": "application/json" },
    body: "{}",
  });
  expect(retried.status).toBe(202);
  const { jobId } = (await retried.json()) as { jobId: string };
  const resent = (await jobs()).prints.find((row) => row.id === jobId)!;
  expect(resent).toMatchObject({ resendOf: prints[0]!.id, pageLanguage: "es-ES" });
  const again = decodeTicket(resent.payload);
  expect(again).toMatch(/Tipo +Base +IVA +Total/u);
  expect(again).not.toMatch(/Tipus +Base/u);
});
it("prints one original when two tills reprint a replacement at once", async () => {
  const original = await projectionInvoice();
  const replacement = await correctiveOf(original.id, true);
  const answers = await Promise.all([reprint(replacement.id), reprint(replacement.id)]);
  expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
  const { prints } = await jobs();
  expect(prints.map((row) => row.receiptCopy).sort()).toEqual([false, true]);
});
it("records every till print of a replacement emailed as its original as a reprint", async () => {
  const original = await projectionInvoice();
  const replacement = await correctiveOf(original.id, true);
  const email = await inTx(venue, (tx) =>
    reserveInvoiceDelivery(tx, replacement.id, {
      medium: "email",
      requestKey: randomUUID(),
      personId: venue.operatorId,
      recipient: "guest@example.test",
    }),
  );
  expect(email.designation).toBe("original");
  await inTx(venue, (tx) =>
    tx.update(invoiceDeliveries).set({ status: "sent" }).where(eq(invoiceDeliveries.id, email.id)),
  );
  expect((await reprint(replacement.id)).status).toBe(200);
  expect((await reprint(replacement.id)).status).toBe(200);
  const { prints, reprints } = await jobs();
  expect(prints).toEqual([
    expect.objectContaining({ saleId: replacement.id, kind: "document", receiptCopy: true }),
    expect.objectContaining({ saleId: replacement.id, kind: "document", receiptCopy: true }),
  ]);
  expect(reprints.map((row) => row.printJobId).sort()).toEqual(prints.map((row) => row.id).sort());
  expect(reprints).toEqual([
    expect.objectContaining({ saleId: replacement.id, personId: venue.operatorId }),
    expect.objectContaining({ saleId: replacement.id, personId: venue.operatorId }),
  ]);
});
it("still prints a refund corrective that never printed as a copy", async () => {
  const original = await projectionInvoice();
  const refund = await correctiveOf(original.id, false);
  expect((await reprint(refund.id)).status).toBe(200);
  const { prints, reprints } = await jobs();
  expect(prints).toEqual([expect.objectContaining({ saleId: refund.id, receiptCopy: true })]);
  expect(reprints).toEqual([expect.objectContaining({ saleId: refund.id })]);
});
it("raises no undelivered-invoice alert when a replacement of a full invoice's original print fails", async () => {
  const customer = {
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "2 Main Street, 28013 Madrid, Madrid",
  };
  const original = await projectionInvoice(customer);
  const [series] = await inTx(venue, (tx) =>
    tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "corrective")),
      ),
  );
  const replacement = await projectionInvoice({
    ...customer,
    seriesId: series!.id,
    correctsSaleId: original.id,
    replacesOriginal: true,
  });
  expect((await reprint(replacement.id)).status).toBe(200);
  const [printed] = (await jobs()).prints;
  expect(printed).toMatchObject({ saleId: replacement.id, receiptCopy: false });
  await inTx(venue, (tx) =>
    tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, printed!.id)),
  );
  const alerts = await inTx(venue, (tx) =>
    invoiceDeliveryAlertSource({ testPages: createPageTestPages() }).read({
      tx,
      now: new Date(),
    }),
  );
  expect(alerts).toEqual([]);
});
it("refuses to resend a full invoice's out-of-date original once an earlier email arrived late", async () => {
  const sale = await projectionInvoice({
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Stored address",
  });
  const profileId = await profile();
  await inTx(venue, (tx) =>
    listInvoicePrinter(tx, { profileId, printerId: venue.printerId, isDefault: true }),
  );
  const now = new Date();
  const email = await inTx(venue, async (tx) => {
    const delivery = await reserveInvoiceDelivery(tx, sale.id, {
      medium: "email",
      requestKey: randomUUID(),
      personId: venue.operatorId,
      recipient: "customer@example.test",
    });
    await startInvoiceEmail(tx, delivery.id);
    await abandonInvoiceEmail(tx, delivery.id, now);
    return delivery;
  });
  const printed = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries`,
    {
      medium: "print",
      requestKey: randomUUID(),
      printerId: venue.printerId,
    },
  );
  expect(printed.status, JSON.stringify(printed.json)).toBe(200);
  const job = (await jobs()).prints.at(-1)!;
  await inTx(venue, async (tx) => {
    await tx
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: RECEIPT_OUT_OF_DATE })
      .where(eq(printJobs.id, job.id));
    await settleInvoiceEmail(tx, email, 1, { status: "sent" }, now);
  });
  const deliveries = () =>
    inTx(venue, (tx) =>
      tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.saleId, sale.id)),
    );
  const before = { deliveries: await deliveries(), prints: (await jobs()).prints };
  expect(before.deliveries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: email.id, status: "sent", designation: "original" }),
      expect.objectContaining({ printJobId: job.id, status: "queued", designation: "original" }),
    ]),
  );

  await expect(
    inTx(venue, (tx) =>
      resendInvoicePrintJob(
        tx,
        saleReceiptLayout(venue.backend, venue.cfg),
        job.id,
        venue.operatorId,
      ),
    ),
  ).rejects.toMatchObject({ code: "print_job.not_resendable" });
  expect({ deliveries: await deliveries(), prints: (await jobs()).prints }).toEqual(before);
});

/**
 * A full invoice whose receipt original waits on the venue printer for a synthetic agent; with
 * `emailUnknown`, an earlier email of it was handed over and its outcome is unknown.
 */
async function waitingReceiptOriginal(emailUnknown: boolean) {
  const sale = await projectionInvoice({
    issuedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    counterpartyTaxId: "B00000000",
    counterpartyLegalName: "Stored recipient",
    counterpartyCountryCode: "ES",
    counterpartyAddress: "Stored address",
  });
  const profileId = await profile();
  const { agent, email } = await inTx(venue, async (tx) => {
    await listInvoicePrinter(tx, { profileId, printerId: venue.printerId, isDefault: true });
    await tx
      .update(printers)
      .set({ transport: "network_tcp", host: "receipt.test", pollId: null, hasCashDrawer: false })
      .where(eq(printers.id, venue.printerId));
    const [agent] = await tx
      .insert(printAgents)
      .values({ name: "Synthetic agent", tokenHash: "scrypt$fixture" })
      .returning();
    if (!emailUnknown) return { agent: agent!, email: undefined };
    const email = await reserveInvoiceDelivery(tx, sale.id, {
      medium: "email",
      requestKey: randomUUID(),
      personId: venue.operatorId,
      recipient: "customer@example.test",
    });
    await startInvoiceEmail(tx, email.id);
    await abandonInvoiceEmail(tx, email.id, new Date());
    return { agent: agent!, email };
  });
  const printed = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${sale.id}/deliveries`,
    { medium: "print", requestKey: randomUUID(), printerId: venue.printerId },
  );
  expect(printed.status, JSON.stringify(printed.json)).toBe(200);
  const job = (await jobs()).prints.find(
    (row) => row.saleId === sale.id && row.kind === "document",
  )!;
  const settleEmail = () =>
    inTx(venue, (tx) => settleInvoiceEmail(tx, email!, 1, { status: "sent" }, new Date()));
  const giveUp = () =>
    inTx(venue, (tx) =>
      tx
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: RECEIPT_OUT_OF_DATE })
        .where(eq(printJobs.id, job.id)),
    );
  /** Claims what the agent is given and reports each printed; answers what was printed. */
  const printAll = async () => {
    const claimed = await inTx(venue, (tx) =>
      claimInvoicePrintJobs(tx, agent.id, { visibleKeys: [], printerId: venue.printerId }),
    );
    for (const row of claimed) {
      await inTx(venue, (tx) =>
        reportInvoicePrintJob(tx, {
          agentId: agent.id,
          jobId: row.id,
          invoiceClaim: row.invoiceClaim,
          outcome: { status: "done" },
        }),
      );
    }
    return claimed.map((row) => ({
      id: row.id,
      duplicate: decodeTicket(row.payload).includes("DUPLICADO"),
    }));
  };
  const sentOriginals = async () =>
    (await venue.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.saleId, sale.id)))
      .filter((row) => row.status === "sent" && row.designation === "original")
      .map((row) => row.medium);
  return { sale, job, settleEmail, giveUp, printAll, sentOriginals };
}
it("prints no second original when an earlier email arrives after a resend and before the printer takes it", async () => {
  const waiting = await waitingReceiptOriginal(true);
  await waiting.giveUp();
  const resent = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${waiting.sale.id}/receipt-print/retry`,
    {},
  );
  expect(resent, JSON.stringify(resent.json)).toMatchObject({
    status: 409,
    json: { code: "print_job.not_resendable" },
  });
  expect((await jobs()).prints.filter((row) => row.saleId === waiting.sale.id)).toEqual([
    expect.objectContaining({ id: waiting.job.id, status: "failed" }),
  ]);
  await waiting.settleEmail();
  const printed = await waiting.printAll();

  expect(printed.filter((row) => !row.duplicate)).toEqual([]);
  expect(await waiting.sentOriginals()).toEqual(["email"]);
});
it("a resend of a receipt original given up as out of date carries its waiting delivery and prints once", async () => {
  const waiting = await waitingReceiptOriginal(false);
  await waiting.giveUp();
  const resent = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${waiting.sale.id}/receipt-print/retry`,
    {},
  );
  expect(resent.status, JSON.stringify(resent.json)).toBe(200);
  const jobId = resent.json.jobId as string;
  await expect(
    inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, waiting.sale.id, {
        medium: "email",
        requestKey: randomUUID(),
        personId: venue.operatorId,
        recipient: "customer@example.test",
      }),
    ),
  ).rejects.toMatchObject({ code: "invoice_delivery.active" });

  expect(await waiting.printAll()).toEqual([{ id: jobId, duplicate: false }]);
  expect(await waiting.printAll()).toEqual([]);
  expect(
    await venue.db
      .select({ printJobId: invoiceDeliveries.printJobId, status: invoiceDeliveries.status })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, waiting.sale.id)),
  ).toEqual([{ printJobId: jobId, status: "sent" }]);
  expect(await waiting.sentOriginals()).toEqual(["receipt"]);
});
