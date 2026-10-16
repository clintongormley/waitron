import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  drawerOpens,
  invoiceDeliveries,
  locations,
  nodes,
  saleSubstitutions,
  printJobs,
  receiptReprints,
  sales,
  tenderRefunds,
  tenders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
import { inTx, send, seatedWith } from "./testing/bill-venue.js";
import {
  billlessSale,
  collect,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { decodeTicket, opensDrawer, commandNames } from "./testing/decode-ticket.js";
import { readOrderDetail } from "./orders-list.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
  const id = await profile();
  await inTx(venue, async (tx) => {
    const [row] = await tx.select().from(deviceProfiles).where(eq(deviceProfiles.id, id));
    await tx
      .update(deviceProfiles)
      .set({ capabilities: [...(row!.capabilities as string[]), "print-receipt"] })
      .where(eq(deviceProfiles.id, id));
  });
});
async function profile() {
  return (await store.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!
    .deviceProfileId;
}
async function target(values: Partial<typeof tenderRefunds.$inferInsert> = {}, saleId?: string) {
  saleId ??= await billlessSale(venue);
  const [tender] = await store.db.select().from(tenders).where(eq(tenders.saleId, saleId));
  const [row] = await inTx(venue, (tx) =>
    tx
      .insert(tenderRefunds)
      .values({
        saleId,
        tenderId: tender!.id,
        submissionId: randomUUID(),
        fingerprint: randomUUID(),
        appliedAmount: 200,
        tipAmount: 30,
        reason: "Goodwill",
        authorizedBy: venue.supervisorId,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        nodeId: venue.cfg.nodeId,
        locationId: venue.cfg.locationId,
        method: "cash",
        state: "completed",
        createdAt: "2026-10-15T11:00:00.000Z",
        completedAt: "2026-10-16T10:00:00.000Z",
        ...values,
      })
      .returning(),
  );
  return row!;
}
const get = (id: string, cookie = venue.cookie) =>
  send(venue.app, cookie, "GET", `/api/tender-refunds/${id}/receipt`);
const print = (id: string, body: unknown = {}, cookie = venue.cookie) =>
  send(venue.app, cookie, "POST", `/api/tender-refunds/${id}/reprint`, body);
async function immutable() {
  return inTx(venue, async (tx) => ({
    sales: await tx.select().from(sales),
    tenders: await tx.select().from(tenders),
    refunds: await tx.select().from(tenderRefunds),
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
    drawers: await tx.select().from(drawerOpens),
    deliveries: await tx.select().from(invoiceDeliveries),
  }));
}
async function printed() {
  return {
    jobs: await store.db.select().from(printJobs),
    audits: await store.db.select().from(receiptReprints),
  };
}
it("reads a separate payment acknowledgment with the filed issuer and immutable refund facts", async () => {
  const row = await target();
  vi.spyOn(venue.backend, "filedReceiptFor").mockResolvedValue({
    verificationUrl: "https://fiscal.test/original",
    vatBreakdown: [],
    issuer: { legalName: "Filed issuer", taxId: "61000002T" },
  });
  const before = await immutable(),
    jobs = await printed();
  expect(await get(row.id)).toMatchObject({
    status: 200,
    json: {
      refund: {
        id: row.id,
        saleId: row.saleId,
        tenderId: row.tenderId,
        state: "completed",
        appliedAmount: "2.00",
        tipAmount: "0.30",
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      },
      invoiceNumber: "A/1",
      issuer: { venueName: "Filed issuer", nif: "61000002T" },
      customerName: null,
      method: "cash",
      last4: null,
    },
  });
  const result = (await get(row.id)).json;
  expect(Object.keys(result).sort()).toEqual([
    "customerName",
    "invoiceNumber",
    "issuer",
    "last4",
    "method",
    "refund",
  ]);
  expect(await immutable()).toEqual(before);
  expect(await printed()).toEqual(jobs);
});
it("retains only the returned capture's card suffix", async () => {
  const order = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, order, "3.00")).status).toBe(200);
  const [sale] = await store.db.select().from(sales).where(eq(sales.workingOrderId, order));
  const row = await target(
    { method: "card", provider: "fake", providerPaymentRef: "returned-capture" },
    sale!.id,
  );
  await inTx(venue, async (tx) => {
    await tx.insert(payments).values({
      saleId: row.saleId,
      workingOrderId: order,
      source: "device",
      deviceId: venue.deviceId,
      provider: "fake",
      paymentRef: "returned-capture",
      amount: 230,
      state: "refunded",
      cardLast4: "3210",
    });
    await tx.insert(payments).values({
      saleId: row.saleId,
      workingOrderId: order,
      source: "device",
      deviceId: venue.deviceId,
      provider: "fake",
      paymentRef: "other-capture",
      amount: 230,
      state: "captured",
      cardLast4: "0091",
    });
  });
  expect(await get(row.id)).toMatchObject({
    status: 200,
    json: { method: "card", last4: "3210", invoiceNumber: `A/${sale!.invoiceNumber}` },
  });
});
it.each(["pending", "failed"] as const)(
  "%s attempts remain status-only and cannot print",
  async (state) => {
    const row = await target({
      state,
      completedAt: null,
      ...(state === "failed" ? { failedAt: "2026-10-16T10:00:00.000Z" } : {}),
    });
    const before = await printed();
    expect(await get(row.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_unavailable" },
    });
    expect(await print(row.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_unavailable" },
    });
    expect(
      await send(venue.app, venue.cookie, "GET", `/api/tender-refunds/${row.id}`),
    ).toMatchObject({ status: 200, json: { state } });
    expect(await printed()).toEqual(before);
  },
);
it("prints one audited payment document without invoice delivery, fiscal QR or drawer effects", async () => {
  const row = await target(),
    before = await immutable(),
    existing = await printed();
  expect((await print(row.id)).status).toBe(200);
  const after = await printed();
  expect(after.jobs).toHaveLength(existing.jobs.length + 1);
  expect(after.audits).toHaveLength(1);
  const job = after.jobs.at(-1)!;
  expect(job).toMatchObject({ kind: "document", saleId: null, receiptCopy: null });
  expect(after.audits[0]).toMatchObject({
    saleId: row.saleId,
    printJobId: job.id,
    personId: venue.operatorId,
  });
  const text = decodeTicket(job.payload);
  expect(text).toContain("JUSTIFICANTE DE DEVOLUCIÓN");
  expect(text).toContain("La factura original no cambia");
  expect(text).toContain("A/1");
  expect(text).toContain(row.id);
  expect(text).toContain("2,30");
  expect(text).toContain("0,30");
  expect(opensDrawer(job.payload)).toBe(false);
  expect(commandNames(job.payload)).not.toContain("GS ( k");
  expect(await immutable()).toEqual(before);
  const detail = await inTx(venue, (tx) => readOrderDetail(tx, row.saleId, "all", false));
  expect(detail.reprints).toEqual([]);
});
it("prints the stored English language and offered Spanish without changing the invoice", async () => {
  venue.cfg.locale = "en-GB";
  venue.cfg.invoiceLocales = ["en-GB"];
  const row = await target(),
    before = await immutable();
  expect((await print(row.id, { language: "en-GB" })).status).toBe(200);
  const job = (await printed()).jobs.at(-1)!;
  expect(decodeTicket(job.payload)).toContain("REFUND ACKNOWLEDGMENT");
  expect(decodeTicket(job.payload)).toContain("The original invoice is unchanged");
  expect(decodeTicket(job.payload)).toContain("2.30");
  expect(decodeTicket(job.payload)).toContain("Money returned");
  expect(decodeTicket(job.payload)).toContain("Tip returned");
  expect((await print(row.id, { language: "es-ES" })).status).toBe(200);
  expect(decodeTicket((await printed()).jobs.at(-1)!.payload)).toContain(
    "JUSTIFICANTE DE DEVOLUCIÓN",
  );
  expect(await immutable()).toEqual(before);
});
it.each([null, 42, [], "", "xx-XX"])(
  "refuses unsupported print language %j before writing",
  async (language) => {
    const row = await target(),
      before = await printed();
    expect(await print(row.id, { language })).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "language" } },
    });
    expect(await printed()).toEqual(before);
  },
);
it("GET needs no payment or print capability while POST requires print-receipt", async () => {
  const row = await target();
  expect(await get(row.id, "")).toMatchObject({ status: 401, json: { code: "session.required" } });
  expect(await print(row.id, {}, "")).toMatchObject({
    status: 401,
    json: { code: "session.required" },
  });
  const id = await profile();
  await inTx(venue, (tx) =>
    tx.update(deviceProfiles).set({ capabilities: [] }).where(eq(deviceProfiles.id, id)),
  );
  expect((await get(row.id)).status).toBe(200);
  expect(await print(row.id)).toMatchObject({
    status: 403,
    json: { code: "device.forbidden_action", params: { action: "reprint" } },
  });
});
it("refuses a removed session or deactivated device on read and reprint", async () => {
  const row = await target();
  await inTx(venue, (tx) =>
    tx.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId)),
  );
  expect(await get(row.id)).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
  expect(await print(row.id)).toMatchObject({ status: 401, json: { code: "device.unauthorized" } });
});
it("checks every original source zone on read and reprint and admits the allowed case", async () => {
  const order = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, order, "3.00")).status).toBe(200);
  const [sale] = await store.db.select().from(sales).where(eq(sales.workingOrderId, order));
  const row = await target({}, sale!.id);
  expect((await get(row.id)).status).toBe(200);
  expect((await print(row.id)).status).toBe(200);
  const id = await profile();
  await inTx(venue, async (tx) => {
    const [policy] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.zoneId));
    await setProfileServiceAccess(tx, venue.cfg, id, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    });
  });
  for (const action of [get, print])
    expect(await action(row.id)).toMatchObject({
      status: 403,
      json: { code: "service_zone.not_allowed" },
    });
});
it("refuses unknown or malformed refund ids without a print", async () => {
  for (const id of ["bad", randomUUID()])
    for (const action of [get, print])
      expect(await action(id)).toMatchObject({
        status: 404,
        json: { code: "tender.refund_not_found" },
      });
  expect((await printed()).audits).toEqual([]);
});

it("uses a full invoice's recorded customer and domicile without inventing another invoice", async () => {
  const source = await billlessSale(venue);
  const [sale] = await store.db.select().from(sales).where(eq(sales.id, source));
  const saleId = randomUUID();
  await inTx(venue, async (tx) => {
    await tx.insert(sales).values({
      ...sale!,
      id: saleId,
      invoiceNumber: 900001,
      workingOrderId: null,
      counterpartyTaxId: "B12345674",
      counterpartyLegalName: "Recorded customer",
      counterpartyAddress: "Recorded customer address",
      counterpartyCountryCode: "ES",
      taxpayerDomicile: "Recorded issuer domicile",
      fiscalState: "not_applicable",
    });
    await tx
      .insert(tenders)
      .values({ saleId, method: "cash", amount: 1210, settledAt: "2026-10-15T11:00:00.000Z" });
  });
  const row = await target({}, saleId),
    before = await immutable();
  expect(await get(row.id)).toMatchObject({
    status: 200,
    json: {
      invoiceNumber: "A/900001",
      customerName: "Recorded customer",
      issuer: { domicile: "Recorded issuer domicile" },
      refund: { saleId },
    },
  });
  expect((await print(row.id)).status).toBe(200);
  expect(await immutable()).toEqual(before);
});
it("does not print or audit when the device has no active receipt printer", async () => {
  const row = await target();
  await inTx(venue, (tx) =>
    tx.update(devices).set({ receiptPrinterId: null }).where(eq(devices.id, venue.deviceId)),
  );
  const before = await printed();
  expect((await print(row.id)).status).toBe(200);
  expect(await printed()).toEqual(before);
});
it("rolls the document job back when its audit cannot commit", async () => {
  const row = await target(),
    before = await printed();
  await store.db.execute(
    sql`create trigger refuse_refund_print_audit before insert on receipt_reprints begin select raise(abort,'audit refused'); end`,
  );
  try {
    expect((await print(row.id)).status).toBe(500);
    expect(await printed()).toEqual(before);
  } finally {
    await store.db.execute(sql`drop trigger refuse_refund_print_audit`);
  }
});

it("does not reveal or print an orderless invoice from another location", async () => {
  const original = await billlessSale(venue);
  const [sale] = await store.db.select().from(sales).where(eq(sales.id, original));
  const id = randomUUID();
  await inTx(venue, async (tx) => {
    const [current] = await tx
      .select()
      .from(locations)
      .where(eq(locations.id, venue.cfg.locationId));
    const [other] = await tx
      .insert(locations)
      .values({ ...current!, id: randomUUID(), name: "Other venue room" })
      .returning();
    const [node] = await tx
      .insert(nodes)
      .values({ name: "Other", locationId: other!.id })
      .returning();
    await tx.insert(sales).values({
      ...sale!,
      id,
      nodeId: node!.id,
      invoiceNumber: 900001,
      fiscalState: "not_applicable",
    });
    await tx
      .insert(tenders)
      .values({ saleId: id, method: "cash", amount: 1210, settledAt: "2026-10-15T11:00:00.000Z" });
  });
  const row = await target({}, id),
    before = await printed();
  expect(await get(row.id)).toMatchObject({ status: 404, json: { code: "sale.not_found" } });
  expect(await print(row.id)).toMatchObject({ status: 404, json: { code: "sale.not_found" } });
  expect(await printed()).toEqual(before);
});
it("requires every substituted original order's zone before exposing an acknowledgment", async () => {
  const first = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, first, "3.00")).status).toBe(200);
  const [sale] = await store.db.select().from(sales).where(eq(sales.workingOrderId, first));
  const party = await seatedWith(venue, "Tarta");
  const second = randomUUID(),
    replacement = await billlessSale(venue);
  await inTx(venue, async (tx) => {
    await tx.insert(sales).values({
      ...sale!,
      id: second,
      workingOrderId: party.tabId,
      invoiceNumber: 900001,
      fiscalState: "not_applicable",
    });
    await tx.insert(saleSubstitutions).values([
      { substitutionSaleId: replacement, substitutedSaleId: sale!.id },
      { substitutionSaleId: replacement, substitutedSaleId: second },
    ]);
  });
  const row = await target({}, replacement);
  expect((await get(row.id)).status).toBe(200);
  const id = await profile();
  await inTx(venue, async (tx) => {
    const [policy] = await tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counterZone));
    await setProfileServiceAccess(tx, venue.cfg, id, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    });
  });
  const before = await printed();
  expect(await get(row.id)).toMatchObject({
    status: 403,
    json: { code: "service_zone.not_allowed" },
  });
  expect(await print(row.id)).toMatchObject({
    status: 403,
    json: { code: "service_zone.not_allowed" },
  });
  expect(await printed()).toEqual(before);
});
