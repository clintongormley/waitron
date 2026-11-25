import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { unzipSync } from "fflate";
import { row, sheetNamed, worksheetRows } from "./testing/xlsx-rows.js";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readOrderRevision } from "./working-order-context.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import { credit } from "./testing/order-venue.js";
import {
  RECIPIENT,
  clockAt,
  deferredCloseVenue,
  type DeferredCloseKit,
} from "./testing/deferred-close-fixture.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { mountReportApi } from "./report-api.js";
import { DEFERRED_PAYMENT_EXPORT_WORDS } from "./i18n/deferred-payment-export.js";
import { listDeferredPaymentInvoices } from "./deferred-payment-export.js";
import "./errors.js";

let t: DeferredCloseKit;
let managerCookie = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
    managerCookie = await withTransaction(db, async (tx) => {
      const [person] = await seedPersons(tx, {
        displayName: "The manager",
        pinHash: hashPin("1234"),
        role: "manager",
      });
      const session = await startManagementSession(tx, {
        method: "password",
        personId: person!.id,
      });
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    });
  },
});

const HOUR = 3_600_000;
const days: { issued?: string; closedLater?: string; closedNow?: string } = {};
let laterBill = "";

function list(from: string, to: string) {
  return inTx(t.venue, (tx) => listDeferredPaymentInvoices(tx, { from, to }));
}

function closedDay(billId: string): string {
  const [row] = t.venue.db.all<{ day: string }>(
    sql`select business_day as day from deferred_closures where working_order_id = ${billId}`,
  );
  return row!.day;
}

describe("listDeferredPaymentInvoices", () => {
  it("filters by the day the bill was closed, not the day it was issued", async () => {
    laterBill = await t.counterOrder("placed", true);
    // 30 hours ahead, so the close lands on a later business day even before the 05:00 cutover.
    await t.close(
      await t.requestFor(laterBill, "18.00", null),
      t.depsWith({ clock: clockAt(Date.now() + 30 * HOUR) }),
    );
    const [sale] = t.venue.db.all<{ at: string; offset: number }>(
      sql`select issued_at as at, issued_offset_minutes as offset from sales where working_order_id = ${laterBill}`,
    );
    days.issued = new Date(Date.parse(sale!.at) + sale!.offset * 60_000).toISOString().slice(0, 10);
    days.closedLater = closedDay(laterBill);
    expect(days.closedLater > days.issued).toBe(true);

    expect(await list(days.closedLater, days.closedLater)).toEqual([
      {
        invoiceNumber: "A/1",
        invoiceType: "F2",
        issueDate: days.issued,
        closedOn: days.closedLater,
        recipientName: null,
        recipientTaxId: null,
        base: "16.36",
        vat: "1.64",
        total: "18.00",
        correctedBy: [],
        correctionsTotal: "0.00",
        replacedBy: null,
      },
    ]);
    expect(await list(days.issued, days.issued)).toEqual([]);
  });

  it("names a full invoice's customer", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await t.close(await t.requestFor(party.tabId, "12.00", party.partyId));
    days.closedNow = closedDay(party.tabId);

    expect(await list(days.closedNow, days.closedNow)).toEqual([
      expect.objectContaining({
        invoiceType: "F1",
        recipientName: RECIPIENT.legalName,
        recipientTaxId: RECIPIENT.taxId,
        total: "12.00",
      }),
    ]);
  });

  it("names and totals a later credit without netting it off the invoice", async () => {
    await credit(t.venue, laterBill, "1.00", "-1.10");

    expect(await list(days.closedLater!, days.closedLater!)).toEqual([
      expect.objectContaining({
        invoiceNumber: "A/1",
        base: "16.36",
        vat: "1.64",
        total: "18.00",
        correctedBy: ["R/1"],
        correctionsTotal: "-1.10",
      }),
    ]);
  });

  it("orders the rows by the day each bill was closed", async () => {
    const rows = await list(days.closedNow!, days.closedLater!);

    expect(rows.map((row) => [row.invoiceType, row.closedOn])).toEqual([
      ["F1", days.closedNow],
      ["F2", days.closedLater],
    ]);
  });

  it("dates the invoice by the venue's local day, not the UTC one", async () => {
    const year = new Date(Math.max(Date.now(), t.latestRecordMs())).getUTCFullYear() + 1;
    const clock = t.venue.clock;
    t.venue.clock = clockAt(Date.parse(`${year}-01-01T23:30:00.000Z`));
    let bill: string;
    try {
      bill = await t.counterOrder("placed", true);
      await t.close(await t.requestFor(bill, "18.00", null));
    } finally {
      t.venue.clock = clock;
    }
    const [sale] = t.venue.db.all<{ at: string; offset: number }>(
      sql`select issued_at as at, issued_offset_minutes as offset from sales where working_order_id = ${bill}`,
    );
    expect(sale).toEqual({ at: `${year}-01-01T23:30:00.000Z`, offset: 60 });

    expect(await list(`${year}-01-01`, `${year}-01-02`)).toEqual([
      expect.objectContaining({ issueDate: `${year}-01-02`, closedOn: `${year}-01-01` }),
    ]);
    const sheet = await deferredSheet(await accountantDownload(`${year}-01-01`));
    expect(row(sheet, 3).slice(2, 4)).toEqual([`${year}-01-02`, `${year}-01-01`]);
    expect(row(sheet, 4)).toEqual([]);
  });
  it("names a replaced invoice's replacement apart, and totals only the corrections of the two", async () => {
    const bill = await t.counterOrder("placed", true);
    await t.close(await t.requestFor(bill, "18.00", null));
    const numberOf = (id: string) =>
      t.venue.db.all<{ number: string }>(
        sql`select sr.code || '/' || s.invoice_number as number from sales s
          join invoice_series sr on sr.id = s.series_id where s.id = ${id}`,
      )[0]!.number;
    const [sale] = t.venue.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${bill}`,
    );
    const replacement = await inTx(t.venue, (tx) =>
      insertCorrective(tx, sale!.id, { replaces: true }),
    );
    const refund = await inTx(t.venue, (tx) =>
      insertCorrective(tx, replacement, { total: "-1.21" }),
    );

    const day = closedDay(bill);
    expect(
      (await list(day, day)).find((row) => row.invoiceNumber === numberOf(sale!.id)),
    ).toMatchObject({
      total: "18.00",
      correctedBy: [numberOf(refund)],
      correctionsTotal: "-1.21",
      replacedBy: numberOf(replacement),
    });
    const sheet = await deferredSheet(await accountantDownload(day));
    const original = worksheetRows(sheet).find(([number]) => number === numberOf(sale!.id));
    expect(original?.slice(9)).toEqual([numberOf(refund), "-1.21", numberOf(replacement)]);
  });
});

function accountantDownload(from: string, to = from) {
  const app = new Hono();
  mountReportApi(
    app,
    { db: t.venue.db, cfg: { nodeId: t.venue.cfg.nodeId }, venueLocale: "es-ES" },
    () => {},
  );
  return app.request(`/management-api/reports/accountant-export?from=${from}&to=${to}`, {
    method: "POST",
    headers: { cookie: managerCookie },
  });
}

async function deferredSheet(response: Response) {
  expect(response.status).toBe(200);
  const sheet = sheetNamed(
    unzipSync(new Uint8Array(await response.arrayBuffer())),
    DEFERRED_PAYMENT_EXPORT_WORDS.es.sheet,
  );
  expect(sheet).toBeDefined();
  return sheet!;
}

it("uses the complete range and keeps full invoice customer details", async () => {
  const sheet = await deferredSheet(await accountantDownload(days.closedNow!, days.closedLater!));
  const rows = worksheetRows(sheet);
  const full = rows.find((cells) => cells[1] === "F1");
  expect(full?.slice(3, 6)).toEqual([days.closedNow, RECIPIENT.legalName, RECIPIENT.taxId]);
  const ticket = rows.find(([number]) => number === "A/1");
  expect(ticket?.slice(1, 6)).toEqual(["F2", days.issued, days.closedLater, "", ""]);
});

it("includes signed credit amounts as numbers in the accountant attachment", async () => {
  const day = days.closedLater!;
  const response = await accountantDownload(day);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="accountant-${day}-${day}.xlsx"`,
  );
  const sheet = await deferredSheet(response);
  expect(row(sheet, 3)).toEqual([
    "A/1",
    "F2",
    days.issued,
    day,
    "",
    "",
    "16.36",
    "1.64",
    "18.00",
    "R/1",
    "-1.10",
    "",
  ]);
  expect(sheet).toContain('<c r="K3" t="n" s="1"><v>-1.10</v></c>');
  expect(row(sheet, 4)).toEqual([]);
});
