import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  billPayments,
  deviceProfiles,
  floorZones,
  products,
  devices,
  drawerOpens,
  invoiceSeries,
  invoiceDeliveries,
  locations,
  nodes,
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
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
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
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
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
  const order = await placedIssuedBill(venue, "Croquetas");
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
  expect(result.qr).not.toBe("");
  expect(result.issuer).toMatchObject({ venueName: "Tarjetas SL", nif: "61000002T" });
  expect(await snapshot()).toEqual(before);
  expect(await jobs()).toEqual(printed);
});
it("reads paid and orderless original sales and a correction by their own identity", async () => {
  const order = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, order, "3.00")).status).toBe(200);
  const original = await saleOf(order);
  await credit(venue, order, "1.00", "-1.21");
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
      total: id === correction ? "-1.21" : id === loose ? "12.10" : "3.00",
      issuedAt: new Date(sale!.issuedAt).toISOString(),
      lines: [
        {
          descriptions: {
            "es-ES":
              id === correction ? "Descuento" : id === loose ? "Venta suelta" : "Caña de cerveza",
          },
          gross: id === correction ? "-1.21" : id === loose ? "12.10" : "3.00",
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
it("refuses malformed, missing and another-location sale IDs without side effects", async () => {
  const id = await billlessSale(venue);
  const before = await jobs();
  for (const missing of ["bad", randomUUID()])
    expect(await get(missing)).toMatchObject({ status: 400, json: { code: "sale.not_found" } });
  const otherNode = randomUUID(),
    otherLocation = randomUUID();
  await inTx(venue, async (tx) => {
    const [location] = await tx
      .select()
      .from(locations)
      .where(eq(locations.id, venue.cfg.locationId));
    await tx.insert(locations).values({ ...location!, id: otherLocation, name: "Elsewhere" });
    await tx.insert(nodes).values({ id: otherNode, locationId: otherLocation, name: "Other" });
  });
  const original = (await inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.id, id))))[0]!;
  const foreign = randomUUID();
  await inTx(venue, (tx) =>
    tx.insert(sales).values({
      ...original,
      id: foreign,
      nodeId: otherNode,
      invoiceNumber: 900001,
      workingOrderId: null,
      fiscalState: "not_applicable",
    }),
  );
  expect(await get(foreign)).toMatchObject({ status: 400, json: { code: "sale.not_found" } });
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
it.each([false, true])(
  "a historical full invoice retains its own recipient, domicile and offset, paid=%s",
  async (paid) => {
    const sale = await projectionInvoice({
      counterpartyTaxId: "B00000000",
      counterpartyLegalName: "Stored recipient",
      counterpartyCountryCode: "ES",
      counterpartyAddress: "Frozen address",
      taxpayerDomicile: "Frozen issuer domicile",
      operationDate: "2026-10-01",
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
      operationDate: "2026-10-01",
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
    const [policy] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counterZone));
    await setProfileServiceAccess(tx, venue.cfg, profileId, {
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
it("a device with no receipt printer answers without adding an audit or drawer job", async () => {
  const id = await billlessSale(venue);
  await inTx(venue, (tx) =>
    tx.update(devices).set({ receiptPrinterId: null }).where(eq(devices.id, venue.deviceId)),
  );
  const before = await jobs();
  expect((await reprint(id)).status).toBe(200);
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
    const [policy] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counterZone));
    await setProfileServiceAccess(tx, venue.cfg, profileId, {
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
      locationId: venue.cfg.locationId,
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
