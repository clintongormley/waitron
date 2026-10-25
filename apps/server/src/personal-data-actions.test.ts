import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  billPaymentRefunds,
  billPayments,
  CORE_MIGRATIONS,
  drawerOpens,
  invoiceSeries,
  locations,
  printers,
  sales,
  saleVoids,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { formatInvoiceNumber } from "@waitron/core";
import type { PersonalDataPart, PersonalDataSubject } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { ACTIONS_FILES, actionsPersonalData } from "./personal-data-actions.js";

const MARTA = "cccccccc-0000-4000-8000-0000000000a1";
const LUIS = "cccccccc-0000-4000-8000-0000000000b2";
const NOBODY = "cccccccc-0000-4000-8000-0000000000c3";

interface Place {
  locationId: string;
  nodeId: string;
  deviceId: string;
  printerId: string;
  series: Record<string, string>;
}

let place: Place;

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  resetPerTest: false,
  setup: async (db) => {
    place = await seedPlace(db);
    await seedActions(db, place);
  },
});

async function seedPlace(db: Database): Promise<Place> {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Actions", invoiceLocales: ["en"], operationDescription: "Meals" })
    .returning();
  const locationId = brandLocationId(location!.id);
  const nodeId = await seedNode(db, locationId);
  const { deviceId } = await seedDevice(db, { locationId });
  const series: Record<string, string> = {};
  for (const code of ["TA", "TB"]) {
    const [row] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code, purpose: "standard" })
      .returning();
    series[code] = row!.id;
  }
  const [printer] = await db
    .insert(printers)
    .values({ locationId, name: "Bar printer", transport: "network_tcp", host: "10.0.0.1" })
    .returning();
  return { locationId, nodeId, deviceId, printerId: printer!.id, series };
}

async function seedSale(
  db: Transaction,
  at: Place,
  sale: {
    code: string;
    number: number;
    total: number;
    method: "cash" | "card";
    workingOrderId?: string;
  },
): Promise<{ saleId: string; tenderId: string }> {
  const [row] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId: at.deviceId,
      nodeId: at.nodeId,
      seriesId: at.series[sale.code]!,
      invoiceNumber: sale.number,
      issuedAt: "2026-10-20T08:00:00.000Z",
      issuedOffsetMinutes: 0,
      total: sale.total,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
      ...(sale.workingOrderId === undefined ? {} : { workingOrderId: sale.workingOrderId }),
    })
    .returning();
  const [tender] = await db
    .insert(tenders)
    .values({
      saleId: row!.id,
      method: sale.method,
      amount: sale.total,
      settledAt: "2026-10-20T08:00:00.000Z",
    })
    .returning();
  return { saleId: row!.id, tenderId: tender!.id };
}

async function seedVoid(
  db: Transaction,
  saleId: string,
  row: { id: string; voidedBy: string; voidedAt: string },
): Promise<void> {
  await db.insert(saleVoids).values({ ...row, saleId, reason: `void reason ${row.id}` });
}

async function seedTenderRefund(
  db: Database,
  at: Place,
  sale: { saleId: string; tenderId: string },
  row: {
    id: string;
    appliedAmount: number;
    tipAmount: number;
    requestedBy: string;
    authorizedBy: string;
    attestedBy?: string;
    method: "cash" | "card";
    manual?: boolean;
    state: "pending" | "completed";
    createdAt: string;
  },
): Promise<void> {
  await db.insert(tenderRefunds).values({
    ...row,
    saleId: sale.saleId,
    tenderId: sale.tenderId,
    submissionId: randomUUID(),
    fingerprint: `refund ${row.id}`,
    reason: `refund reason ${row.id}`,
    source: "device",
    deviceId: at.deviceId,
    nodeId: at.nodeId,
    locationId: at.locationId,
    manual: row.manual ?? false,
    ...(row.method === "card" && row.manual !== true
      ? { provider: "sumup", providerPaymentRef: `ref-${row.id}` }
      : {}),
    ...(row.attestedBy === undefined ? {} : { attestationNote: `note ${row.id}` }),
    ...(row.state === "completed" ? { completedAt: row.createdAt } : {}),
  });
}

let orderNumber = 0;

async function seedBillPayment(
  db: Database,
  at: Place,
  bill: { method: "cash" | "card"; applied: number },
): Promise<{ workingOrderId: string; billPaymentId: string }> {
  orderNumber += 1;
  const [order] = await db
    .insert(workingOrders)
    .values({
      source: "dashboard",
      locationId: at.locationId,
      nodeId: at.nodeId,
      orderNumber,
    })
    .returning();
  const [payment] = await db
    .insert(billPayments)
    .values({
      workingOrderId: order!.id,
      submissionId: randomUUID(),
      fingerprint: `bill ${orderNumber}`,
      kind: "contribution",
      method: bill.method,
      applied: bill.applied,
      ...(bill.method === "cash" ? { tendered: bill.applied } : {}),
      state: "received",
      receivedAt: "2026-10-20T08:00:00.000Z",
      requestedBy: MARTA,
      source: "device",
      deviceId: at.deviceId,
    })
    .returning();
  return { workingOrderId: order!.id, billPaymentId: payment!.id };
}

async function seedBillRefund(
  db: Database,
  at: Place,
  billPaymentId: string,
  row: {
    id: string;
    appliedAmount: number;
    tipAmount: number;
    requestedBy: string;
    authorizedBy: string;
    attestedBy?: string;
    createdAt: string;
  },
): Promise<void> {
  await db.insert(billPaymentRefunds).values({
    ...row,
    billPaymentId,
    submissionId: randomUUID(),
    fingerprint: `bill refund ${row.id}`,
    reason: `bill refund reason ${row.id}`,
    source: "device",
    deviceId: at.deviceId,
    state: "completed",
    completedAt: row.createdAt,
    ...(row.attestedBy === undefined ? {} : { attestationNote: `bill note ${row.id}` }),
  });
}

async function seedDrawerOpen(
  db: Database,
  at: Place,
  row: {
    id: string;
    reason: "cash_sale" | "manual" | "calibration" | "bill_payment" | "card_slip" | "tender_refund";
    personId: string;
    authorizedBy?: string;
    openedAt: string;
    saleId?: string;
    billPaymentId?: string;
    tenderRefundId?: string;
    viaOverride?: boolean;
  },
): Promise<void> {
  await db.insert(drawerOpens).values({
    ...row,
    openedAt: new Date(row.openedAt),
    ...(row.reason === "calibration" ? { printerId: at.printerId } : { deviceId: at.deviceId }),
  });
}

// Each refund's id sorts opposite to its time, so a list ordered by id alone comes out reversed.
async function seedActions(db: Database, at: Place): Promise<void> {
  const martaVoided = await seedSale(db, at, {
    code: "TA",
    number: 7,
    total: 1234,
    method: "cash",
  });
  const martaCash = await seedSale(db, at, { code: "TB", number: 31, total: 5678, method: "cash" });
  const martaCard = await seedSale(db, at, { code: "TA", number: 9, total: 4321, method: "card" });
  const luisVoided = await seedSale(db, at, { code: "TA", number: 8, total: 9876, method: "cash" });
  const luisRefunded = await seedSale(db, at, {
    code: "TB",
    number: 32,
    total: 6543,
    method: "cash",
  });
  const martaVoidedEarlier = await seedSale(db, at, {
    code: "TA",
    number: 11,
    total: 2468,
    method: "cash",
  });
  const martaAuthorized = await seedSale(db, at, {
    code: "TB",
    number: 33,
    total: 8642,
    method: "cash",
  });
  const martaAttested = await seedSale(db, at, {
    code: "TA",
    number: 10,
    total: 7531,
    method: "card",
  });
  const luisAttested = await seedSale(db, at, {
    code: "TB",
    number: 34,
    total: 9753,
    method: "card",
  });

  await seedVoid(db, martaVoided.saleId, {
    id: "00000000-0000-4000-8000-00000000f001",
    voidedBy: MARTA,
    voidedAt: "2026-10-20T09:15:00.000Z",
  });
  await seedVoid(db, luisVoided.saleId, {
    id: "00000000-0000-4000-8000-00000000f002",
    voidedBy: LUIS,
    voidedAt: "2026-10-20T09:20:00.000Z",
  });
  await seedTenderRefund(db, at, martaCard, {
    id: "00000000-0000-4000-8000-00000000a001",
    appliedAmount: 1111,
    tipAmount: 0,
    requestedBy: MARTA,
    authorizedBy: MARTA,
    method: "card",
    state: "pending",
    createdAt: "2026-10-20T11:45:00.000Z",
  });
  await seedTenderRefund(db, at, martaCash, {
    id: "00000000-0000-4000-8000-00000000a002",
    appliedAmount: 2345,
    tipAmount: 150,
    requestedBy: MARTA,
    authorizedBy: LUIS,
    method: "cash",
    state: "completed",
    createdAt: "2026-10-20T10:30:00.000Z",
  });
  await seedTenderRefund(db, at, luisRefunded, {
    id: "00000000-0000-4000-8000-00000000a003",
    appliedAmount: 3456,
    tipAmount: 25,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    method: "cash",
    state: "completed",
    createdAt: "2026-10-20T10:40:00.000Z",
  });
  // Dated before her first void but given a later id, so the voids too must be sorted by time.
  await seedVoid(db, martaVoidedEarlier.saleId, {
    id: "00000000-0000-4000-8000-00000000f003",
    voidedBy: MARTA,
    voidedAt: "2026-10-20T09:05:00.000Z",
  });
  await seedTenderRefund(db, at, martaAuthorized, {
    id: "00000000-0000-4000-8000-00000000a005",
    appliedAmount: 3210,
    tipAmount: 45,
    requestedBy: LUIS,
    authorizedBy: MARTA,
    method: "cash",
    state: "completed",
    createdAt: "2026-10-20T10:50:00.000Z",
  });
  await seedTenderRefund(db, at, martaAttested, {
    id: "00000000-0000-4000-8000-00000000a004",
    appliedAmount: 5432,
    tipAmount: 99,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    attestedBy: MARTA,
    method: "card",
    manual: true,
    state: "completed",
    createdAt: "2026-10-20T11:10:00.000Z",
  });
  await seedTenderRefund(db, at, luisAttested, {
    id: "00000000-0000-4000-8000-00000000a006",
    appliedAmount: 6789,
    tipAmount: 12,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    attestedBy: LUIS,
    method: "card",
    manual: true,
    state: "completed",
    createdAt: "2026-10-20T11:20:00.000Z",
  });

  const martaInvoicedCard = await seedBillPayment(db, at, { method: "card", applied: 6000 });
  await seedSale(db, at, {
    code: "TB",
    number: 41,
    total: 6000,
    method: "card",
    workingOrderId: martaInvoicedCard.workingOrderId,
  });
  const martaOpenBill = await seedBillPayment(db, at, { method: "cash", applied: 2000 });
  const luisBill = await seedBillPayment(db, at, { method: "cash", applied: 9000 });
  await seedSale(db, at, {
    code: "TB",
    number: 42,
    total: 9000,
    method: "cash",
    workingOrderId: luisBill.workingOrderId,
  });
  const martaInvoicedCash = await seedBillPayment(db, at, { method: "cash", applied: 3000 });
  await seedSale(db, at, {
    code: "TA",
    number: 44,
    total: 3000,
    method: "cash",
    workingOrderId: martaInvoicedCash.workingOrderId,
  });

  // Dated between her tender refunds of 10:30 and 11:45, so the refunds must be merged by time; it
  // shares its time with her 11:10 tender refund and has the higher id.
  await seedBillRefund(db, at, martaInvoicedCard.billPaymentId, {
    id: "00000000-0000-4000-8000-00000000b001",
    appliedAmount: 4567,
    tipAmount: 89,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    attestedBy: MARTA,
    createdAt: "2026-10-20T11:10:00.000Z",
  });
  // Shares its time with her 10:30 tender refund and has the lower id, so a tie is broken by id.
  await seedBillRefund(db, at, martaOpenBill.billPaymentId, {
    id: "00000000-0000-4000-8000-000000009002",
    appliedAmount: 1357,
    tipAmount: 20,
    requestedBy: MARTA,
    authorizedBy: LUIS,
    createdAt: "2026-10-20T10:30:00.000Z",
  });
  await seedBillRefund(db, at, luisBill.billPaymentId, {
    id: "00000000-0000-4000-8000-000000009003",
    appliedAmount: 8765,
    tipAmount: 55,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    createdAt: "2026-10-20T10:45:00.000Z",
  });

  // Each opening's id sorts opposite to its time.
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d001",
    reason: "calibration",
    personId: MARTA,
    authorizedBy: MARTA,
    openedAt: "2026-10-20T12:20:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d002",
    reason: "manual",
    personId: LUIS,
    authorizedBy: MARTA,
    viaOverride: true,
    openedAt: "2026-10-20T12:10:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d003",
    reason: "card_slip",
    personId: MARTA,
    billPaymentId: martaInvoicedCard.billPaymentId,
    openedAt: "2026-10-20T09:40:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d004",
    reason: "tender_refund",
    personId: MARTA,
    authorizedBy: LUIS,
    saleId: martaCash.saleId,
    tenderRefundId: "00000000-0000-4000-8000-00000000a002",
    openedAt: "2026-10-20T10:31:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d005",
    reason: "bill_payment",
    personId: MARTA,
    billPaymentId: martaInvoicedCash.billPaymentId,
    openedAt: "2026-10-20T08:40:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d006",
    reason: "cash_sale",
    personId: MARTA,
    saleId: martaCash.saleId,
    openedAt: "2026-10-20T08:30:00.000Z",
  });
  await seedDrawerOpen(db, at, {
    id: "00000000-0000-4000-8000-00000000d007",
    reason: "cash_sale",
    personId: LUIS,
    saleId: luisRefunded.saleId,
    openedAt: "2026-10-20T12:15:00.000Z",
  });
}

// The distinct sales Marta's rows name (voids TA/11 and TA/7; tender refunds TB/31, TB/33, TA/10 and
// TA/9; her cash-sale and tender-refund openings name TB/31 again), and the distinct bill payments
// (her two bill refunds' payments; her card-slip opening names the first again; her bill-payment
// opening names a third).
const MARTA_SALE_IDS = 6;
const MARTA_BILL_PAYMENT_IDS = 3;

function subject(personId: string): PersonalDataSubject {
  return {
    personId,
    language: "en",
    at: new Date("2026-10-25T12:00:00.000Z"),
    timeZone: "UTC",
    locationId: place.locationId,
  };
}

function onlyPart(parts: PersonalDataPart[]): PersonalDataPart {
  expect(parts).toHaveLength(1);
  return parts[0]!;
}

// As `sendPersonalData` does: prepare inside the snapshot turn, build outside it.
async function download(
  personId: string,
  part = onlyPart(actionsPersonalData(suite.db)),
  db: Database = suite.db,
) {
  const build = await db.withWriteLock(() => part.part.prepare(db, subject(personId)));
  return build();
}

async function text(personId: string): Promise<string> {
  const files = await download(personId);
  expect(files.map((f) => f.name)).toEqual(["actions.json"]);
  return files[0]!.content as string;
}

// Every statement the handle prepares, `$count` and `query.*` included, is prepared here
// (`packages/store/src/node-sqlite-adapter.ts`, `adaptNodeSqlite`); `session.client` is drizzle's
// own field for it.
function statementEntry(db: Database): { prepare: (query: string) => unknown } {
  return (db as unknown as { session: { client: { prepare: (query: string) => unknown } } }).session
    .client;
}

describe("actionsPersonalData", () => {
  it("is one server part declaring actions.json", () => {
    const { owner, part } = onlyPart(actionsPersonalData(suite.db));
    expect(owner).toBe("server");
    expect(part.files).toEqual(["actions.json"]);
    expect(ACTIONS_FILES).toEqual(["actions.json"]);
  });

  it("writes the person's sale voids, refunds and drawer openings, and nobody else's", async () => {
    expect(JSON.parse(await text(MARTA))).toEqual({
      counts: { voids: 2, refunds: 6, drawerOpenings: 6 },
      voids: [
        { sale: formatInvoiceNumber("TA", 11), amount: "24.68", at: "2026-10-20T09:05:00.000Z" },
        { sale: formatInvoiceNumber("TA", 7), amount: "12.34", at: "2026-10-20T09:15:00.000Z" },
      ],
      refunds: [
        {
          kind: "bill_payment",
          sale: null,
          amount: "13.57",
          tip: "0.20",
          method: "cash",
          state: "completed",
          at: "2026-10-20T10:30:00.000Z",
          yourPart: ["requested"],
        },
        {
          kind: "sale",
          sale: formatInvoiceNumber("TB", 31),
          amount: "23.45",
          tip: "1.50",
          method: "cash",
          state: "completed",
          at: "2026-10-20T10:30:00.000Z",
          yourPart: ["requested"],
        },
        {
          kind: "sale",
          sale: formatInvoiceNumber("TB", 33),
          amount: "32.10",
          tip: "0.45",
          method: "cash",
          state: "completed",
          at: "2026-10-20T10:50:00.000Z",
          yourPart: ["authorized"],
        },
        {
          kind: "sale",
          sale: formatInvoiceNumber("TA", 10),
          amount: "54.32",
          tip: "0.99",
          method: "card",
          state: "completed",
          at: "2026-10-20T11:10:00.000Z",
          yourPart: ["attested"],
        },
        {
          kind: "bill_payment",
          sale: formatInvoiceNumber("TB", 41),
          amount: "45.67",
          tip: "0.89",
          method: "card",
          state: "completed",
          at: "2026-10-20T11:10:00.000Z",
          yourPart: ["attested"],
        },
        {
          kind: "sale",
          sale: formatInvoiceNumber("TA", 9),
          amount: "11.11",
          tip: "0.00",
          method: "card",
          state: "pending",
          at: "2026-10-20T11:45:00.000Z",
          yourPart: ["requested", "authorized"],
        },
      ],
      drawerOpenings: [
        {
          reason: "cash_sale",
          sale: formatInvoiceNumber("TB", 31),
          at: "2026-10-20T08:30:00.000Z",
          viaOverride: false,
          yourPart: ["opened"],
        },
        {
          reason: "bill_payment",
          sale: formatInvoiceNumber("TA", 44),
          at: "2026-10-20T08:40:00.000Z",
          viaOverride: false,
          yourPart: ["opened"],
        },
        {
          reason: "card_slip",
          sale: formatInvoiceNumber("TB", 41),
          at: "2026-10-20T09:40:00.000Z",
          viaOverride: false,
          yourPart: ["opened"],
        },
        {
          reason: "tender_refund",
          sale: formatInvoiceNumber("TB", 31),
          at: "2026-10-20T10:31:00.000Z",
          viaOverride: false,
          yourPart: ["opened"],
        },
        {
          reason: "manual",
          sale: null,
          at: "2026-10-20T12:10:00.000Z",
          viaOverride: true,
          yourPart: ["authorized"],
        },
        {
          reason: "calibration",
          sale: null,
          at: "2026-10-20T12:20:00.000Z",
          viaOverride: false,
          yourPart: ["opened", "authorized"],
        },
      ],
    });
  });

  it("writes each entry's keys in the plan's order", async () => {
    const file = JSON.parse(await text(MARTA));
    expect(JSON.stringify(Object.keys(file))).toBe(
      JSON.stringify(["counts", "voids", "refunds", "drawerOpenings"]),
    );
    expect(JSON.stringify(file.counts)).toBe(
      JSON.stringify({ voids: 2, refunds: 6, drawerOpenings: 6 }),
    );
    expect(JSON.stringify(file.voids[0])).toBe(
      JSON.stringify({
        sale: formatInvoiceNumber("TA", 11),
        amount: "24.68",
        at: "2026-10-20T09:05:00.000Z",
      }),
    );
    for (const entry of [file.refunds[0], file.refunds[1]])
      expect(JSON.stringify(Object.keys(entry))).toBe(
        JSON.stringify(["kind", "sale", "amount", "tip", "method", "state", "at", "yourPart"]),
      );
    expect(JSON.stringify(file.refunds[1])).toBe(
      JSON.stringify({
        kind: "sale",
        sale: formatInvoiceNumber("TB", 31),
        amount: "23.45",
        tip: "1.50",
        method: "cash",
        state: "completed",
        at: "2026-10-20T10:30:00.000Z",
        yourPart: ["requested"],
      }),
    );
    expect(JSON.stringify(file.drawerOpenings[0])).toBe(
      JSON.stringify({
        reason: "cash_sale",
        sale: formatInvoiceNumber("TB", 31),
        at: "2026-10-20T08:30:00.000Z",
        viaOverride: false,
        yourPart: ["opened"],
      }),
    );
  });

  it("names none of a colleague's sales or amounts", async () => {
    const content = await text(MARTA);
    expect(content).toContain(formatInvoiceNumber("TB", 31));
    for (const value of [
      formatInvoiceNumber("TA", 8),
      formatInvoiceNumber("TB", 32),
      formatInvoiceNumber("TB", 34),
      formatInvoiceNumber("TB", 42),
      "98.76",
      "34.56",
      "0.25",
      "67.89",
      "0.12",
      "87.65",
      "0.55",
    ])
      expect(content).not.toContain(value);
  });

  it("names no person, the colleague who acted with her nor herself", async () => {
    const content = await text(MARTA);
    expect(content).toContain(formatInvoiceNumber("TA", 9));
    expect(content).not.toContain(LUIS);
    expect(content).not.toContain(MARTA);
  });

  it("holds no reason or note anybody typed", async () => {
    const content = await text(MARTA);
    const typed = [
      ...(await suite.db.select({ text: saleVoids.reason }).from(saleVoids)),
      ...(await suite.db.select({ text: tenderRefunds.reason }).from(tenderRefunds)),
      ...(await suite.db.select({ text: tenderRefunds.attestationNote }).from(tenderRefunds)),
      ...(await suite.db.select({ text: billPaymentRefunds.reason }).from(billPaymentRefunds)),
      ...(await suite.db
        .select({ text: billPaymentRefunds.attestationNote })
        .from(billPaymentRefunds)),
    ]
      .map((row) => row.text)
      .filter((value): value is string => value !== null);
    expect(new Set(typed).size).toBe(typed.length);
    expect(typed.length).toBe(15);
    for (const value of typed) expect(content).not.toContain(value);
  });

  it("builds the same file in bounded turns, one per row read and one per chunk of ids", async () => {
    const expected = await download(MARTA);
    const { part } = onlyPart(actionsPersonalData(suite.db, { chunk: 2 }));
    const build = await suite.db.withWriteLock(() => part.prepare(suite.db, subject(MARTA)));
    const lock = vi.spyOn(suite.db, "withWriteLock");
    try {
      const files = await build();
      expect(lock.mock.calls.length).toBe(
        2 + Math.ceil(MARTA_SALE_IDS / 2) + Math.ceil(MARTA_BILL_PAYMENT_IDS / 2),
      );
      expect(files.map((f) => f.name)).toEqual(["actions.json"]);
      expect(files[0]!.content).toBe(expected[0]!.content);
    } finally {
      lock.mockRestore();
    }
  });

  it("looks up a sale or bill payment named twice only once", async () => {
    const { part } = onlyPart(actionsPersonalData(suite.db, { chunk: 1 }));
    const build = await suite.db.withWriteLock(() => part.prepare(suite.db, subject(MARTA)));
    const lock = vi.spyOn(suite.db, "withWriteLock");
    try {
      await build();
      expect(lock.mock.calls.length).toBe(2 + MARTA_SALE_IDS + MARTA_BILL_PAYMENT_IDS);
    } finally {
      lock.mockRestore();
    }
  });

  it("refuses a chunk that is not a positive whole number", () => {
    for (const chunk of [0, -1, 1.5, Number.NaN])
      expect(() => actionsPersonalData(suite.db, { chunk })).toThrow(
        `personal-data actions chunk must be a positive whole number, not ${chunk}`,
      );
  });

  it("builds the same file one sale at a time", async () => {
    const files = await download(MARTA);
    expect(await download(MARTA, onlyPart(actionsPersonalData(suite.db, { chunk: 1 })))).toEqual(
      files,
    );
  });

  it("builds no file for a person with no action", async () => {
    expect(await download(NOBODY)).toEqual([]);
  });

  it("reads nothing in the snapshot turn, and takes its own turns only after it", async () => {
    const { part } = onlyPart(actionsPersonalData(suite.db));
    const throwingTx = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`prepare touched tx.${String(property)}`);
        },
      },
    ) as Transaction;
    const lock = vi.spyOn(suite.db, "withWriteLock");
    const reads = [
      ...(["select", "all", "get", "run", "execute"] as const).map((name) =>
        vi.spyOn(suite.db, name),
      ),
      vi.spyOn(statementEntry(suite.db), "prepare"),
    ];
    try {
      let locksDuringPrepare = -1;
      const build = await suite.db.withWriteLock(async () => {
        const returned = await part.prepare(throwingTx, subject(MARTA));
        locksDuringPrepare = lock.mock.calls.length;
        return returned;
      });
      const readsDuringPrepare = reads.map((spy) => spy.mock.calls.length);
      for (const spy of reads) spy.mockRestore();
      expect(locksDuringPrepare).toBe(1);
      expect(readsDuringPrepare).toEqual([0, 0, 0, 0, 0, 0]);
      expect(lock.mock.calls.length).toBe(1);
      const files = await build();
      expect(lock.mock.calls.length).toBeGreaterThan(1);
      expect(files.map((f) => f.name)).toEqual(["actions.json"]);
    } finally {
      for (const spy of reads) spy.mockRestore();
      lock.mockRestore();
    }
  });
});

describe("actionsPersonalData after the snapshot turn", () => {
  let later: Place;
  const laterSuite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: async (db) => {
      later = await seedPlace(db);
      await seedActions(db, later);
    },
  });

  it("holds an action committed after the snapshot turn closed", async () => {
    const db = laterSuite.db;
    const { part } = onlyPart(actionsPersonalData(db));
    const build = await db.withWriteLock(() => part.prepare(db, subject(MARTA)));
    const sale = await withTransaction(db, (tx) =>
      seedSale(tx, later, { code: "TA", number: 12, total: 3579, method: "cash" }),
    );
    await withTransaction(db, (tx) =>
      seedVoid(tx, sale.saleId, {
        id: "00000000-0000-4000-8000-00000000f004",
        voidedBy: MARTA,
        voidedAt: "2026-10-20T09:25:00.000Z",
      }),
    );
    const files = await build();
    expect(JSON.parse(files[0]!.content as string).voids).toEqual([
      { sale: formatInvoiceNumber("TA", 11), amount: "24.68", at: "2026-10-20T09:05:00.000Z" },
      { sale: formatInvoiceNumber("TA", 7), amount: "12.34", at: "2026-10-20T09:15:00.000Z" },
      { sale: formatInvoiceNumber("TA", 12), amount: "35.79", at: "2026-10-20T09:25:00.000Z" },
    ]);
  });
});
