import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { and, eq, sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  activityLog,
  invoicePdfDownloads,
  invoiceSeries,
  sales,
  taxpayer,
  type Database,
} from "@waitron/db";
import { recordSale } from "@waitron/core";
import { hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  decimal,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { inTx } from "./testing/bill-venue.js";
import { clockAt } from "./testing/deferred-close-fixture.js";
import {
  parked,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";
import { mountTaxOfficeApi, type TaxOfficeApiDeps } from "./tax-office-api.js";
import { confineTo, sessionHolding } from "./testing/session-holding.js";
import type { SaleCopy } from "./orders-invoice-pdf.js";
import { TAX_OFFICE_EXPORT_WORDS } from "./i18n/tax-office-export.js";
import { renderTaxOfficeCsv, taxOfficeMonthEntries } from "./tax-office-export.js";
import type { TaxOfficeInvoice } from "./tax-office-list.js";

const TICKET_80MM = 226.77;
const A4 = 595.28;

let venue: OrderVenue;
let managerDashboard = "";
let seriesIds: { full: string; standard: string; fA: string; fUnderA: string };
const january: Record<string, string> = {};

function mount(extra: Partial<TaxOfficeApiDeps> = {}): Hono {
  const app = new Hono();
  mountTaxOfficeApi(
    app,
    {
      db: venue.db,
      cfg: { nodeId: venue.cfg.nodeId },
      backend: venue.backend,
      tradingContext: venue.cfg,
      venueLocale: "es-ES",
      ...extra,
    },
    () => {},
  );
  return app;
}

/** A sale issued at `iso` in `series`, naming a customer when it is a full invoice. */
async function issueAt(
  iso: string,
  series: string,
  opts: { customer?: boolean; lines?: { vatRate: string; lineTotal: string }[] } = {},
): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Caña");
  const lines = opts.lines ?? [{ vatRate: "10", lineTotal: "3.00" }];
  const total = lines
    .reduce((sum, line) => sum + Math.round(Number(line.lineTotal) * 100), 0)
    .toString();
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: [venue.cfg.locale],
      ...(opts.customer === true
        ? {
            counterparty: {
              taxId: "12345678Z",
              legalName: "=Cliente Mayorista SL",
              countryCode: "ES",
            },
            recipientAddress: "Calle Cliente 9, Madrid",
          }
        : {}),
      total: `${total.slice(0, -2) || "0"}.${total.slice(-2)}`,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        name: "Caña",
        descriptions: { [venue.cfg.locale]: "Caña de cerveza" },
        quantity: "1",
        unitPrice: line.lineTotal,
        vatRate: line.vatRate,
        lineTotal: line.lineTotal,
      })),
      clock: clockAt(Date.parse(iso)),
      settlement: { kind: "deferred" },
      operatorId: venue.operatorId,
    }),
  );
  return { billId, saleId };
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [manager] = await seedPersons(tx, {
        displayName: "Martha",
        pinHash: hashPin("4444"),
        role: "manager",
      });
      const session = await startManagementSession(tx, { personId: manager!.id });
      managerDashboard = `${MANAGEMENT_COOKIE}=${session.token}`;
      const seriesOf = async (purpose: "full" | "standard") =>
        (
          await tx
            .select({ id: invoiceSeries.id })
            .from(invoiceSeries)
            .where(
              and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, purpose)),
            )
        )[0]!.id;
      const made = await tx
        .insert(invoiceSeries)
        .values([
          { nodeId: venue.cfg.nodeId, code: "Q/R", purpose: "full" },
          { nodeId: venue.cfg.nodeId, code: "Q_R", purpose: "full" },
        ])
        .returning({ id: invoiceSeries.id, code: invoiceSeries.code });
      seriesIds = {
        full: await seriesOf("full"),
        standard: await seriesOf("standard"),
        fA: made.find((row) => row.code === "Q/R")!.id,
        fUnderA: made.find((row) => row.code === "Q_R")!.id,
      };
    });
    // Madrid is an hour ahead of UTC in January.
    january.twoRates = (
      await issueAt("2026-01-10T11:00:00.000Z", seriesIds.full, {
        customer: true,
        lines: [
          { vatRate: "10", lineTotal: "3.30" },
          { vatRate: "21", lineTotal: "12.10" },
        ],
      })
    ).saleId;
    january.ticket = (await issueAt("2026-01-12T11:00:00.000Z", seriesIds.standard)).saleId;
    const voided = await issueAt("2026-01-14T11:00:00.000Z", seriesIds.standard);
    january.voided = voided.saleId;
    await voidInvoice(venue, voided.billId);
    january.fA = (
      await issueAt("2026-01-20T11:00:00.000Z", seriesIds.fA, { customer: true })
    ).saleId;
    january.fUnderA = (
      await issueAt("2026-01-21T11:00:00.000Z", seriesIds.fUnderA, { customer: true })
    ).saleId;
    // 23:30 on 31 January in Madrid: in. 00:30 on 1 February in Madrid: out.
    january.lastEvening = (await issueAt("2026-01-31T22:30:00.000Z", seriesIds.standard)).saleId;
    january.february = (await issueAt("2026-01-31T23:30:00.000Z", seriesIds.standard)).saleId;
  },
});

const db = (): Database => suite.db;

function exportMonth(app: Hono, month: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie = managerDashboard, headers, ...rest } = init;
  return app.request(`/management-api/tax-office/months/${month}`, {
    method: "POST",
    headers: { cookie, ...(headers as Record<string, string> | undefined) },
    ...rest,
  });
}

async function unzipped(response: Response): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

async function pdfWidth(bytes: Uint8Array): Promise<number> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    return Math.round((await pdf.getPage(1)).view[2]! * 100) / 100;
  } finally {
    await loading.destroy();
  }
}

const csvLines = (files: Record<string, Uint8Array>) =>
  strFromU8(files["invoices.csv"]!)
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split("\r\n");

/** A render that counts its calls and answers a few bytes at once. */
function countingRender() {
  const calls: string[] = [];
  return {
    calls,
    render: (copy: SaleCopy) => {
      calls.push(copy.fileName);
      return Promise.resolve(new TextEncoder().encode("%PDF-stub"));
    },
  };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: () => boolean,
): Promise<void> {
  while (!done()) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("the stream ended before the condition held");
  }
}

/** Reads to the stream's end; answers the error that ended it, or null when it closed cleanly. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  try {
    for (;;) if ((await reader.read()).done) return null;
  } catch (error) {
    return error;
  }
}

const pdfDownloads = async () => (await db().select().from(invoicePdfDownloads)).length;
const monthEntries = () =>
  db().select().from(activityLog).where(eq(activityLog.kind, "tax_office.month_downloaded"));

describe("the month's export", () => {
  it("holds a README, a CSV and every invoice issued in the month in venue days, voided ones too", async () => {
    const downloadsBefore = await pdfDownloads();
    const entriesBefore = (await monthEntries()).length;
    const response = await exportMonth(mount(), "2026-01");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="invoices-2026-01.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const files = await unzipped(response);
    const names = Object.keys(files).sort();
    const numbers = await db()
      .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
      .from(sales)
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId));
    const pathOf = (saleId: string) => {
      const sale = numbers.find((row) => row.id === saleId)!;
      return `invoices/${sale.code.replace(/[^A-Za-z0-9_.-]/g, "_")}-${sale.number}.pdf`;
    };
    // Q/R-1 and Q_R-1 both make `Q_R-1.pdf`; the second takes `-2`.
    const expected = [
      "README.txt",
      "invoices.csv",
      pathOf(january.twoRates!),
      pathOf(january.ticket!),
      pathOf(january.voided!),
      pathOf(january.lastEvening!),
      "invoices/Q_R-1.pdf",
      "invoices/Q_R-1-2.pdf",
    ].sort();
    expect(names).toEqual(expected);
    expect(names).not.toContain(pathOf(january.february!));
    expect(await pdfWidth(files[pathOf(january.ticket!)]!)).toBe(TICKET_80MM);
    expect(await pdfWidth(files[pathOf(january.twoRates!)]!)).toBe(A4);
    expect(strFromU8(files["README.txt"]!)).toContain("2026-01");
    // One activity entry, and no per-invoice download rows.
    expect(await pdfDownloads()).toBe(downloadsBefore);
    const entries = await monthEntries();
    expect(entries).toHaveLength(entriesBefore + 1);
    expect(entries.at(-1)).toMatchObject({
      data: { month: "2026-01", invoices: 6 },
      personId: expect.any(String),
    });
  });

  it("writes one CSV row per VAT rate, money with a decimal point, in the venue's language by default", async () => {
    const lines = csvLines(await unzipped(await exportMonth(mount(), "2026-01")));
    expect(lines[0]).toContain('"Número de factura"');
    const twoRates = lines.filter((line) => line.includes("'=Cliente Mayorista SL"));
    const ofTwoRates = twoRates.filter((line) => line.includes('"F1"') && line.includes('"15.40"'));
    expect(ofTwoRates).toHaveLength(2);
    expect(ofTwoRates.some((line) => line.includes('"10","3.30","0.33"'))).toBe(true);
    expect(ofTwoRates.some((line) => line.includes('"21","12.10","2.54"'))).toBe(true);
    // Seven invoices less the one of February, plus one extra row for the second rate.
    expect(lines).toHaveLength(1 + 6 + 1);
    expect(lines.filter((line) => /"\d{4}-\d{2}-\d{2}"$/.test(line))).toHaveLength(1);
  });

  it("writes the header in the person's language", async () => {
    const lines = csvLines(
      await unzipped(
        await exportMonth(mount(), "2026-01", { headers: { "Accept-Language": "en-GB" } }),
      ),
    );
    expect(lines[0]).toContain('"Invoice number"');
  });

  it("gives a README and a header-only CSV for a month with no invoices", async () => {
    const files = await unzipped(await exportMonth(mount(), "2025-06"));
    expect(Object.keys(files).sort()).toEqual(["README.txt", "invoices.csv"]);
    expect(csvLines(files)).toHaveLength(1);
  });

  it("refuses a malformed month and a person without invoice.inspect", async () => {
    const bad = await exportMonth(mount(), "2026-13");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "month" } },
    });
    const reporter = await sessionHolding(db(), ["report.view", "report.export"]);
    const refused = await exportMonth(mount(), "2026-01", { cookie: reporter.cookie });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("renders no further PDF once the request is aborted", async () => {
    const counter = countingRender();
    const aborted = new AbortController();
    const response = await exportMonth(mount({ render: counter.render }), "2026-01", {
      signal: aborted.signal,
    });
    const reader = response.body!.getReader();
    await readUntil(reader, () => counter.calls.length >= 1);
    const rendered = counter.calls.length;
    aborted.abort();
    const ended = await drain(reader);
    expect(counter.calls).toHaveLength(rendered);
    expect(ended).toMatchObject({ name: "AbortError" });
  });

  it("stops when a handover closes the gate", async () => {
    const counter = countingRender();
    const gate = new AbortController();
    const response = await exportMonth(
      mount({ render: counter.render, closed: gate.signal }),
      "2026-01",
    );
    const reader = response.body!.getReader();
    await readUntil(reader, () => counter.calls.length >= 1);
    const rendered = counter.calls.length;
    gate.abort();
    expect(await drain(reader)).toMatchObject({ code: "handover.stepping_down" });
    expect(counter.calls).toHaveLength(rendered);
  });

  it("errors the stream when the person loses invoice.inspect before the end", async () => {
    const counter = countingRender();
    const inspector = await sessionHolding(db(), ["invoice.inspect"]);
    const response = await exportMonth(mount({ render: counter.render }), "2026-01", {
      cookie: inspector.cookie,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await readUntil(reader, () => counter.calls.length >= 1);
    await confineTo(db(), inspector.personId, ["report.view"]);
    expect(await drain(reader)).toMatchObject({ code: "authorization.not_permitted" });
    expect(counter.calls).toHaveLength(6);
  });

  it("refuses a second export while one runs, and serves the next once it ends", async () => {
    const counter = countingRender();
    const app = mount({ render: counter.render });
    const first = (await exportMonth(app, "2026-01")).body!.getReader();
    await readUntil(first, () => counter.calls.length >= 1);
    const second = await exportMonth(app, "2026-01");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "tax_office.export_running" } });
    await first.cancel();
    const third = await exportMonth(app, "2026-01");
    expect(third.status).toBe(200);
    expect(Object.keys(await unzipped(third))).toHaveLength(8);
  });

  it("frees the export for the next once one errors or finishes", async () => {
    const app = mount({
      render: () => Promise.reject(new Error("render failed")),
    });
    const failed = (await exportMonth(app, "2026-01")).body!.getReader();
    expect(await drain(failed)).toMatchObject({ message: "render failed" });
    const idle = await exportMonth(app, "2025-06");
    expect(idle.status).toBe(200);
    // A body nobody has read yet holds the export until it is cancelled.
    expect((await exportMonth(app, "2025-06")).status).toBe(409);
    await idle.body!.cancel();
    const finished = await exportMonth(app, "2025-06");
    expect(Object.keys(await unzipped(finished))).toHaveLength(2);
    expect((await exportMonth(app, "2025-06")).status).toBe(200);
  });

  it("reads a month longer than one page whole, each invoice once", async () => {
    for (let day = 0; day < 51; day++)
      await issueAt(
        new Date(Date.UTC(2025, 2, 1, 9) + day * 600_000).toISOString(),
        seriesIds.standard,
      );
    const counter = countingRender();
    const files = await unzipped(await exportMonth(mount({ render: counter.render }), "2025-03"));
    expect(counter.calls).toHaveLength(51);
    expect(new Set(counter.calls).size).toBe(51);
    expect(Object.keys(files)).toHaveLength(2 + 51);
    expect(csvLines(files)).toHaveLength(1 + 51);
  });

  it("frees the export when its first turn fails", async () => {
    const app = mount();
    db().run(sql`create temp trigger refuse_month_entry before insert on activity_log
      when new.kind = 'tax_office.month_downloaded'
      begin select raise(abort, 'refused for the test'); end`);
    try {
      expect((await exportMonth(app, "2025-06")).status).toBe(500);
    } finally {
      db().run(sql`drop trigger refuse_month_entry`);
    }
    expect(Object.keys(await unzipped(await exportMonth(app, "2025-06")))).toHaveLength(2);
  });
});

it("errors when the last turn's authority names a different person from the first's", async () => {
  const entries = taxOfficeMonthEntries(
    {
      db: db(),
      backend: venue.backend,
      tradingContext: venue.cfg,
      render: () => Promise.reject(new Error("no invoice to render")),
      stopIfAsked: () => {},
    },
    {
      month: "2025-06",
      issued: { from: "2025-06-01", to: "2025-06-30", timeZone: "Europe/Madrid" },
      language: "en",
      venue: null,
      authorizedBy: "00000000-0000-4000-8000-000000000002",
      sessionId: managerDashboard.slice(`${MANAGEMENT_COOKIE}=`.length),
      at: new Date(),
    },
  );
  const names: string[] = [];
  await expect(
    (async () => {
      for await (const entry of entries) names.push(entry.name);
    })(),
  ).rejects.toThrow("tax office authorisation named a different person after building");
  expect(names).toEqual(["README.txt", "invoices.csv"]);
});

describe("the month's CSV and README", () => {
  const row: TaxOfficeInvoice = {
    id: "00000000-0000-4000-8000-000000000001",
    number: "A/1",
    kind: "F2",
    issuedAt: "2026-01-12T11:00:00.000Z",
    issueDate: "2026-01-12",
    operationDate: "2026-01-11",
    customerName: null,
    customerTaxId: null,
    vat: [],
    total: decimal("3.00"),
    corrects: ["A/0", "B/0"],
    cancelledAt: null,
  };

  it("gives an invoice with no VAT breakdown one row with the rate cells empty", () => {
    const [, line] = new TextDecoder()
      .decode(renderTaxOfficeCsv([row], "en", "Europe/Madrid"))
      .split("\r\n");
    expect(line).toBe(
      '"A/1","F2","2026-01-12","12:00:00","2026-01-11","","","","","","3.00","A/0 B/0",""',
    );
  });

  it("guards a rate cell that is not a plain decimal against spreadsheet formulas", () => {
    const odd = { ...row, vat: [{ rate: "=1+1", base: "-1.00", tax: "-0.10" }] };
    const [, line] = new TextDecoder()
      .decode(renderTaxOfficeCsv([odd], "en", "Europe/Madrid"))
      .split("\r\n");
    expect(line).toContain('"\'=1+1","-1.00","-0.10"');
  });

  it("leaves the venue's name out of the README when there is none", () => {
    const args = { venue: null, month: "2026-01", timeZone: "Europe/Madrid", date: "2026-02-01" };
    expect(TAX_OFFICE_EXPORT_WORDS.en.readme(args)).toMatch(/^Invoices issued in 2026-01,/);
    expect(TAX_OFFICE_EXPORT_WORDS.es.readme(args)).toMatch(/^Facturas expedidas en 2026-01,/);
  });
});
