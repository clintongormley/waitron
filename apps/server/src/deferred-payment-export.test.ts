import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { activityLog, withTransaction } from "@waitron/db";
import { hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { decimal } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readOrderRevision } from "./working-order.js";
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
import { DEFERRED_PAYMENT_EXPORT_WORDS } from "./i18n/deferred-payment-export.js";
import { mountReportApi } from "./report-api.js";
import {
  listDeferredPaymentInvoices,
  renderDeferredPaymentCsv,
  type DeferredPaymentInvoice,
} from "./deferred-payment-export.js";
import "./errors.js";

let t: DeferredCloseKit;
let manager = { id: "", cookie: "" };
let supervisorCookie = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
    const sessions = await withTransaction(db, async (tx) => {
      const sessionFor = async (role: "manager" | "supervisor") => {
        const [person] = await seedPersons(tx, {
          displayName: `The ${role}`,
          pinHash: hashPin("1234"),
          role,
        });
        const session = await startManagementSession(tx, { personId: person!.id });
        return { id: person!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
      };
      return { manager: await sessionFor("manager"), supervisor: await sessionFor("supervisor") };
    });
    manager = sessions.manager;
    supervisorCookie = sessions.supervisor.cookie;
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
        base: "14.88",
        vat: "3.12",
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
    await credit(t.venue, laterBill, "1.00", "-1.21");

    expect(await list(days.closedLater!, days.closedLater!)).toEqual([
      expect.objectContaining({
        invoiceNumber: "A/1",
        base: "14.88",
        vat: "3.12",
        total: "18.00",
        correctedBy: ["R/1"],
        correctionsTotal: "-1.21",
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
  });
});

const F2_ROW: DeferredPaymentInvoice = {
  invoiceNumber: "A/41",
  invoiceType: "F2",
  issueDate: "2026-11-03",
  closedOn: "2026-11-04",
  recipientName: null,
  recipientTaxId: null,
  base: decimal("14.88"),
  vat: decimal("3.12"),
  total: decimal("18.00"),
  correctedBy: ["R/1", "R/2"],
  correctionsTotal: decimal("-1.21"),
  replacedBy: null,
};
const F1_ROW: DeferredPaymentInvoice = {
  invoiceNumber: "F/7",
  invoiceType: "F1",
  issueDate: "2026-11-05",
  closedOn: "2026-11-05",
  recipientName: '=HYPERLINK("x")',
  recipientTaxId: "B12345674",
  base: decimal("80.00"),
  vat: decimal("16.80"),
  total: decimal("96.80"),
  correctedBy: [],
  correctionsTotal: decimal("0.00"),
  replacedBy: null,
};
const HEADER_KEYS = [
  "invoiceNumber",
  "invoiceType",
  "issueDate",
  "closedOn",
  "recipientName",
  "recipientTaxId",
  "base",
  "vat",
  "total",
  "correctedBy",
  "correctionsTotal",
  "replacedBy",
] as const;
const EN_HEADER =
  '"Invoice number","Type","Issue date","Closed on","Customer","Customer tax number","Base (EUR)","VAT (EUR)","Total (EUR)","Corrected by","Corrections total (EUR)","Replaced by"';
const ES_HEADER = HEADER_KEYS.map((key) => `"${DEFERRED_PAYMENT_EXPORT_WORDS.es[key]}"`).join(",");

function text(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

describe("renderDeferredPaymentCsv", () => {
  it("writes a header and one quoted line per invoice, guarded against formulas", () => {
    expect(text(renderDeferredPaymentCsv([F2_ROW, F1_ROW], "en"))).toBe(
      `\uFEFF${EN_HEADER}\r\n` +
        '"A/41","F2","03/11/2026","04/11/2026","","","14.88","3.12","18.00","R/1 R/2","-1.21",""\r\n' +
        '"F/7","F1","05/11/2026","05/11/2026","\'=HYPERLINK(""x"")","B12345674","80.00","16.80","96.80","","0.00",""\r\n',
    );
    expect(text(renderDeferredPaymentCsv([], "en"))).toBe(`\uFEFF${EN_HEADER}\r\n`);
  });

  it("writes a replaced invoice's replacement in the last column", () => {
    const lines = text(renderDeferredPaymentCsv([{ ...F2_ROW, replacedBy: "R/3" }], "en")).split(
      "\r\n",
    );
    expect(lines[1]).toMatch(/,"-1\.21","R\/3"$/);
  });

  it("writes Spanish words and decimal commas for a Spanish venue", () => {
    expect(text(renderDeferredPaymentCsv([F2_ROW], "es"))).toBe(
      `\uFEFF${ES_HEADER}\r\n` +
        '"A/41","F2","03/11/2026","04/11/2026","","","14,88","3,12","18,00","R/1 R/2","-1,21",""\r\n',
    );
  });
});

describe("POST /management-api/reports/deferred-payment-export", () => {
  const app = new Hono();
  const mounted = () => {
    if (app.routes.length === 0)
      mountReportApi(
        app,
        { db: t.venue.db, cfg: { nodeId: t.venue.cfg.nodeId }, venueLocale: "es-ES" },
        () => {},
      );
    return app;
  };
  const send = (cookie: string, day: string, method = "POST") =>
    mounted().request(`/management-api/reports/deferred-payment-export?from=${day}&to=${day}`, {
      method,
      headers: { cookie },
    });
  const downloads = () =>
    t.venue.db
      .select({
        personId: activityLog.personId,
        subjectKind: activityLog.subjectKind,
        data: activityLog.data,
      })
      .from(activityLog)
      .where(eq(activityLog.kind, "deferred_payment_export.downloaded"));

  it("answers a manager with the venue-language file and records the download", async () => {
    const day = days.closedLater!;
    const res = await send(manager.cookie, day);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="deferred-payments-${day}-${day}.csv"`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(renderDeferredPaymentCsv(await list(day, day), "es"));
    const lines = text(body).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^"A\/1",.*"R\/1","-1,21",""$/);
    expect(await downloads()).toEqual([
      {
        personId: manager.id,
        subjectKind: "report",
        data: { from: day, to: day, rows: 1 },
      },
    ]);
  });

  it("refuses a supervisor, who may view reports but not export them", async () => {
    const res = await send(supervisorCookie, days.closedLater!);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await downloads()).toHaveLength(1);
  });

  it("serves no file to a GET or HEAD, which a page on another port can make the browser send", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await send(manager.cookie, days.closedLater!, method);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toContain("text/csv");
    }
    expect(await downloads()).toHaveLength(1);
  });

  it("gives no file when the download cannot be recorded", async () => {
    await t.venue.db.execute(
      sql.raw(
        `create trigger test_download_refused before insert on activity_log when new.kind = 'deferred_payment_export.downloaded'
         begin select raise(abort, 'test: download record refused'); end`,
      ),
    );
    let res: Response;
    try {
      res = await send(manager.cookie, days.closedLater!);
    } finally {
      await t.venue.db.execute(sql.raw("drop trigger test_download_refused"));
    }

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).not.toContain("text/csv");
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    expect(await downloads()).toHaveLength(1);
  });
});
