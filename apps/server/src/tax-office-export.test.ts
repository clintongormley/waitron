import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mkdtempSync, rmSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Hono } from "hono";
import { afterAll, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  activityLog,
  devices,
  invoicePdfDownloads,
  invoiceSeries,
  sales,
  taxpayer,
  type Database,
} from "@waitron/db";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import { endManagementSession, hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import {
  decimal,
  type DeviceOrigin,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { createPrinter } from "@waitron/printing";
import * as receiptPrint from "./receipt-print.js";
import { inTx } from "./testing/bill-venue.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { clockAt } from "./testing/deferred-close-fixture.js";
import {
  parked,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";
import { mountTaxOfficeApi, taxOfficeMonthSource } from "./tax-office-api.js";
import {
  createTaxOfficeMonthBuilds,
  TAX_OFFICE_ROOM_BYTES,
  type TaxOfficeMonthBuilds,
} from "./tax-office-month-builds.js";
import { SPACE_LOW_BYTES } from "./free-space-watch.js";
import { ZIP_LIMITS, zipStream } from "./download-archive.js";
import { confineTo, sessionHolding } from "./testing/session-holding.js";
import { invoicePdfFileName, type SaleCopy } from "./orders-invoice-pdf.js";
import { TAX_OFFICE_EXPORT_WORDS } from "./i18n/tax-office-export.js";
import { renderTaxOfficeCsv } from "./tax-office-export.js";
import type { TaxOfficeInvoice } from "./tax-office-list.js";

const files = vi.hoisted(() => ({
  opened: [] as FileHandle[],
  /** Runs once, on the handle the next `open` gives out, before it is returned. */
  whileOpening: null as ((handle: FileHandle) => void) | null,
}));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    open: vi.fn(async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      files.opened.push(handle);
      const whileOpening = files.whileOpening;
      files.whileOpening = null;
      whileOpening?.(handle);
      return handle;
    }),
  };
});
/** The handles in `files.opened` that are still open. */
const stillOpen = () => files.opened.filter((handle) => handle.fd !== -1);

vi.mock("./receipt-print.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./receipt-print.js")>();
  return { ...actual, resolveReceiptPrinter: vi.fn(actual.resolveReceiptPrinter) };
});
// The real entry limit would need a month of over 65,000 invoices.
vi.mock("./download-archive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./download-archive.js")>();
  return { ...actual, zipStream: vi.fn(actual.zipStream) };
});

const TICKET_58MM = 164.41;
const TICKET_80MM = 226.77;
const A4 = 595.28;

let venue: OrderVenue;
let managerDashboard = "";
let seriesIds: { full: string; standard: string; fA: string; fUnderA: string };
const january: Record<string, string> = {};

const DOWNLOADS = join(mkdtempSync(join(tmpdir(), "tax-office-export-")), "tax-office");
afterAll(() => rmSync(dirname(DOWNLOADS), { recursive: true, force: true }));
const buildsOf = new WeakMap<Hono, TaxOfficeMonthBuilds>();

function mount(
  extra: {
    render?: (copy: SaleCopy) => Promise<Uint8Array>;
    freeBytes?: () => Promise<number | null>;
  } = {},
  log: Logger = () => {},
): Hono {
  const app = new Hono();
  const builds = createTaxOfficeMonthBuilds({
    dir: DOWNLOADS,
    now: () => new Date(),
    entries: taxOfficeMonthSource({
      db: venue.db,
      backend: venue.backend,
      tradingContext: venue.cfg,
      log,
      ...(extra.render === undefined ? {} : { render: extra.render }),
    }),
    changed: () => {},
    wake: () => {},
    log,
    freeBytes: extra.freeBytes ?? (() => Promise.resolve(null)),
  });
  buildsOf.set(app, builds);
  mountTaxOfficeApi(
    app,
    {
      db: venue.db,
      cfg: { nodeId: venue.cfg.nodeId },
      backend: venue.backend,
      tradingContext: venue.cfg,
      venueLocale: "es-ES",
      builds,
      freeBytes: extra.freeBytes ?? (() => Promise.resolve(null)),
    },
    log,
  );
  return app;
}

/** One pass of the builds' job, as the job runner would run it once woken. */
function runBuild(app: Hono, signal: AbortSignal = new AbortController().signal) {
  return buildsOf.get(app)!.job().pass({ now: new Date(), signal });
}

/** A sale issued at `iso` in `series`, naming a customer when it is a full invoice. */
async function issueAt(
  iso: string,
  series: string,
  opts: {
    customer?: boolean;
    lines?: { vatRate: string; lineTotal: string }[];
    origin?: DeviceOrigin;
  } = {},
): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Croquettes");
  const lines = opts.lines ?? [{ vatRate: "10", lineTotal: "3.00" }];
  const total = lines
    .reduce((sum, line) => sum + Math.round(Number(line.lineTotal) * 100), 0)
    .toString();
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: opts.origin ?? venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: [venue.cfg.locale],
      ...(opts.customer === true
        ? {
            counterparty: {
              taxId: "12345678Z",
              legalName: "=Wholesale Customer Ltd",
              countryCode: "ES",
            },
            recipientAddress: "9 Customer Street, Madrid",
          }
        : {}),
      total: `${total.slice(0, -2) || "0"}.${total.slice(-2)}`,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        name: "Beer",
        descriptions: { [venue.cfg.locale]: "Glass of beer" },
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
      const session = await startManagementSession(tx, {
        method: "password",
        personId: manager!.id,
      });
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

/** A sale's invoice number as the export writes it. */
async function numberOf(saleId: string): Promise<string> {
  const [sale] = await db()
    .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, saleId));
  return formatInvoiceNumber(sale!.code, sale!.number);
}

const copyNumber = (copy: SaleCopy) => formatInvoiceNumber(copy.code, copy.number);
const STUB_PDF = new TextEncoder().encode("%PDF-stub");

function requestMonth(app: Hono, month: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie = managerDashboard, headers, ...rest } = init;
  return app.request(`/management-api/tax-office/months/${month}`, {
    method: "POST",
    headers: { cookie, ...(headers as Record<string, string> | undefined) },
    ...rest,
  });
}

const monthStatus = (app: Hono, cookie = managerDashboard) =>
  app.request("/management-api/tax-office/month-download", { headers: { cookie } });

/** An id no build holds. */
const NO_BUILD = "00000000-0000-4000-8000-00000000f11e";

/** The id the person's status shows, or `NO_BUILD` when it shows none. */
async function currentId(app: Hono, cookie = managerDashboard): Promise<string> {
  const view = (await (await monthStatus(app, cookie)).json()) as { id?: string };
  return view.id ?? NO_BUILD;
}

/** The file under `id`, by default the id the person's status shows. */
const monthFile = async (app: Hono, init: RequestInit & { cookie?: string; id?: string } = {}) => {
  const { cookie = managerDashboard, id, headers, ...rest } = init;
  const path = `/management-api/tax-office/month-download/${id ?? (await currentId(app, cookie))}/file`;
  return app.request(path, {
    headers: { cookie, ...(headers as Record<string, string> | undefined) },
    ...rest,
  });
};

/** Asks for the month, runs the build and fetches the file; a refused request answers as refused. */
async function exportMonth(app: Hono, month: string, init: RequestInit & { cookie?: string } = {}) {
  const asked = await requestMonth(app, month, init);
  if (asked.status !== 202) return asked;
  await runBuild(app);
  return monthFile(app, { ...(init.cookie === undefined ? {} : { cookie: init.cookie }) });
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
      calls.push(invoicePdfFileName(copy.code, copy.number));
      return Promise.resolve(new TextEncoder().encode("%PDF-stub"));
    },
  };
}

const pdfDownloads = async () => (await db().select().from(invoicePdfDownloads)).length;
const monthEntries = () =>
  db().select().from(activityLog).where(eq(activityLog.kind, "tax_office.month_requested"));

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
    expect(strFromU8(files["README.txt"]!)).toMatch(/\r\nPreparado el \d{4}-\d{2}-\d{2}\.\r\n$/);
    // One activity entry, and no per-invoice download rows.
    expect(await pdfDownloads()).toBe(downloadsBefore);
    const entries = await monthEntries();
    expect(entries).toHaveLength(entriesBefore + 1);
    expect(entries.at(-1)).toMatchObject({
      data: { month: "2026-01", invoices: 6 },
      personId: expect.any(String),
    });
  });

  it("writes one CSV row per VAT rate, money with a decimal comma, in the venue's language by default", async () => {
    const lines = csvLines(await unzipped(await exportMonth(mount(), "2026-01")));
    expect(lines[0]).toContain(`"${TAX_OFFICE_EXPORT_WORDS.es.columns.number}"`);
    const twoRates = lines.filter((line) => line.includes("'=Wholesale Customer Ltd"));
    const ofTwoRates = twoRates.filter((line) => line.includes('"F1"') && line.includes('"15,40"'));
    expect(ofTwoRates).toHaveLength(2);
    expect(ofTwoRates.some((line) => line.includes('"10","3,30","0,33"'))).toBe(true);
    expect(ofTwoRates.some((line) => line.includes('"21","12,10","2,54"'))).toBe(true);
    // Seven invoices less the one of February, plus one extra row for the second rate.
    expect(lines).toHaveLength(1 + 6 + 1);
    expect(lines.filter((line) => /"\d{4}-\d{2}-\d{2}"$/.test(line))).toHaveLength(1);
  });

  it("writes the header and the amounts in the person's language", async () => {
    const lines = csvLines(
      await unzipped(
        await exportMonth(mount(), "2026-01", { headers: { "Accept-Language": "en-GB" } }),
      ),
    );
    expect(lines[0]).toContain('"Invoice number"');
    const ofTwoRates = lines.filter((line) => line.includes("'=Wholesale Customer Ltd"));
    expect(ofTwoRates.some((line) => line.includes('"21","12.10","2.54","15.40"'))).toBe(true);
  });

  it("takes an invoice's issue date and time from the offset filed with it", async () => {
    // 00:00 on 1 October in Madrid; the fixture's clock files an offset of one hour, so the record
    // says 23:00 on 30 September, and the venue's zone puts the sale in October.
    await issueAt("2026-09-30T22:00:00.000Z", seriesIds.standard);
    const lines = csvLines(
      await unzipped(await exportMonth(mount({ render: countingRender().render }), "2026-10")),
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"2026-09-30","23:00:00"');
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

  it("renders no further PDF once the build's job is stopped, and leaves nothing to save", async () => {
    const counter = countingRender();
    const stop = new AbortController();
    const app = mount({
      render: (copy) => {
        const bytes = counter.render(copy);
        stop.abort();
        return bytes;
      },
    });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app, stop.signal);
    expect(counter.calls).toHaveLength(1);
    expect(await (await monthStatus(app)).json()).toEqual({ status: "none" });
    expect((await monthFile(app)).status).toBe(404);
  });

  it("stops when the build's job is stopped after the last copy is drawn", async () => {
    const stop = new AbortController();
    const drawn: string[] = [];
    const app = mount({
      render: (copy) => {
        drawn.push(copyNumber(copy));
        if (drawn.length === 6) stop.abort();
        return Promise.resolve(STUB_PDF);
      },
    });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app, stop.signal);
    expect(drawn).toHaveLength(6);
    expect(await (await monthStatus(app)).json()).toEqual({ status: "none" });
  });

  it("refuses a second build while one runs, and serves the next once it ends", async () => {
    const counter = countingRender();
    const app = mount({ render: counter.render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    const inspector = await sessionHolding(db(), ["invoice.inspect"]);
    for (const second of [
      await requestMonth(app, "2026-01", { cookie: inspector.cookie }),
      await requestMonth(app, "2025-06"),
    ]) {
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: { code: "tax_office.export_running" } });
    }
    await runBuild(app);
    const third = await exportMonth(app, "2025-06", { cookie: inspector.cookie });
    expect(third.status).toBe(200);
    expect(Object.keys(await unzipped(third))).toHaveLength(2);
  });

  it("logs once and frees the build for the next when the ZIP refuses another entry", async () => {
    const { zipStream: realZipStream } =
      await vi.importActual<typeof import("./download-archive.js")>("./download-archive.js");
    vi.mocked(zipStream).mockImplementationOnce((entries, at) =>
      realZipStream(entries, at, { ...ZIP_LIMITS, entries: 3 }),
    );
    const logged: { event: string; fields?: Record<string, unknown> }[] = [];
    const counter = countingRender();
    const app = mount({ render: counter.render }, (_level, event, fields) =>
      logged.push({ event, ...(fields ? { fields } : {}) }),
    );
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    expect(logged).toEqual([
      {
        event: "tax_office.build_failed",
        fields: { errorCode: "unknown", errorClass: "Error", errno: null },
      },
    ]);
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "failed" });
    expect((await monthFile(app)).status).toBe(404);
    expect(Object.keys(await unzipped(await exportMonth(app, "2026-01")))).toHaveLength(8);
  });

  it("leaves out a copy that cannot be drawn, names it in failed.txt and logs it", async () => {
    const ticket = await numberOf(january.ticket!);
    const logged: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
    const drawn: string[] = [];
    const app = mount(
      {
        render: (copy) => {
          drawn.push(copyNumber(copy));
          return copyNumber(copy) === ticket
            ? Promise.reject(new Error("cannot draw"))
            : Promise.resolve(STUB_PDF);
        },
      },
      (level, event, fields) => logged.push({ level, event, ...(fields ? { fields } : {}) }),
    );
    const response = await exportMonth(app, "2026-01", {
      headers: { "Accept-Language": "en-GB" },
    });
    const files = await unzipped(response);
    expect(drawn).toHaveLength(6);
    const pdfs = Object.keys(files).filter((name) => name.endsWith(".pdf"));
    expect(pdfs).toHaveLength(5);
    expect(Object.keys(files)).toContain("failed.txt");
    expect(strFromU8(files["failed.txt"]!)).toBe(TAX_OFFICE_EXPORT_WORDS.en.failed([ticket]));
    expect(csvLines(files)).toHaveLength(1 + 6 + 1);
    expect(logged).toEqual([
      {
        level: "error",
        event: "tax_office.copy_failed",
        fields: {
          saleId: january.ticket,
          invoiceNumber: ticket,
          errorCode: "unknown",
          errorClass: "Error",
        },
      },
    ]);
  });

  it("still stops when the build's job is stopped while a copy fails", async () => {
    const stop = new AbortController();
    const logged: string[] = [];
    const drawn: string[] = [];
    const app = mount(
      {
        render: (copy) => {
          drawn.push(copyNumber(copy));
          stop.abort();
          return Promise.reject(new Error("cannot draw"));
        },
      },
      (_level, event) => logged.push(event),
    );
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app, stop.signal);
    expect(drawn).toHaveLength(1);
    expect(logged).toEqual([]);
    expect(await (await monthStatus(app)).json()).toEqual({ status: "none" });
  });

  it("draws every copy outside the write lock, oldest first, with a turn of the event loop between", async () => {
    const database = db();
    const original = database.withWriteLock.bind(database);
    let held = false;
    let lockTurns = 0;
    const lock = vi.spyOn(database, "withWriteLock").mockImplementation(((
      body: () => Promise<unknown>,
    ) =>
      original(async () => {
        held = true;
        lockTurns++;
        try {
          return await body();
        } finally {
          held = false;
        }
      })) as typeof database.withWriteLock);
    const drawnUnderLock: boolean[] = [];
    const turnBefore: boolean[] = [];
    const drawn: string[] = [];
    let queued: { ran: boolean } | null = null;
    try {
      await unzipped(
        await exportMonth(
          mount({
            render: (copy) => {
              drawn.push(copyNumber(copy));
              drawnUnderLock.push(held);
              if (queued !== null) turnBefore.push(queued.ran);
              const mark = { ran: false };
              queued = mark;
              setImmediate(() => {
                mark.ran = true;
              });
              return Promise.resolve(STUB_PDF);
            },
          }),
          "2026-01",
        ),
      );
    } finally {
      lock.mockRestore();
    }
    // The month's pages and each copy's read took the lock.
    expect(lockTurns).toBeGreaterThan(6);
    expect(drawnUnderLock).toEqual([false, false, false, false, false, false]);
    expect(turnBefore).toEqual([true, true, true, true, true]);
    expect(drawn).toEqual(
      await Promise.all(
        [
          january.twoRates!,
          january.ticket!,
          january.voided!,
          january.fA!,
          january.fUnderA!,
          january.lastEvening!,
        ].map(numberOf),
      ),
    );
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

  it("looks up each selling device's receipt printer once per export", async () => {
    const other = (await deviceRequestCfg(db(), venue.cfg)).origin;
    const narrow = await inTx(venue, (tx) =>
      createPrinter(tx, {
        name: "Narrow receipts",
        transport: "cloud_poll",
        pollId: "poll-narrow-receipts",
        paperWidth: "58mm",
      }),
    );
    await db()
      .update(devices)
      .set({ receiptPrinterId: narrow.id })
      .where(eq(devices.id, other.deviceId));
    const mine: string[] = [];
    for (const hour of [9, 10, 11])
      mine.push(
        (await issueAt(new Date(Date.UTC(2025, 8, 3, hour)).toISOString(), seriesIds.standard))
          .saleId,
      );
    const theirs = (
      await issueAt("2025-09-03T12:00:00.000Z", seriesIds.standard, { origin: other })
    ).saleId;
    const lookups = vi.mocked(receiptPrint.resolveReceiptPrinter);
    lookups.mockClear();
    const files = await unzipped(await exportMonth(mount(), "2025-09"));
    const asked = lookups.mock.calls.map(([, origin]) =>
      origin.source === "device" ? origin.deviceId : origin.source,
    );
    expect(asked.sort()).toEqual([venue.cfg.origin.deviceId, other.deviceId].sort());
    const widthOf = async (saleId: string) => {
      const [sale] = await db()
        .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.id, saleId));
      return pdfWidth(files[`invoices/${invoicePdfFileName(sale!.code, sale!.number)}`]!);
    };
    for (const saleId of mine) expect(await widthOf(saleId)).toBe(TICKET_80MM);
    expect(await widthOf(theirs)).toBe(TICKET_58MM);
  });

  it("frees the export when its first turn fails", async () => {
    const app = mount();
    db().run(sql`create temp trigger refuse_month_entry before insert on activity_log
      when new.kind = 'tax_office.month_requested'
      begin select raise(abort, 'refused for the test'); end`);
    try {
      expect((await exportMonth(app, "2025-06")).status).toBe(500);
    } finally {
      db().run(sql`drop trigger refuse_month_entry`);
    }
    expect(Object.keys(await unzipped(await exportMonth(app, "2025-06")))).toHaveLength(2);
  });
});

const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);

describe("asking for the month's file and saving it", () => {
  it("answers a request with the build's view and one activity entry, and a repeat with the same build", async () => {
    const app = mount({ render: countingRender().render });
    const inspector = await sessionHolding(db(), ["invoice.inspect"]);
    const entriesBefore = (await monthEntries()).length;
    const asked = await requestMonth(app, "2025-06", { cookie: inspector.cookie });
    expect(asked.status).toBe(202);
    const view = (await asked.json()) as { id: string };
    expect(view).toEqual({ status: "building", id: expect.any(String), month: "2025-06" });
    const again = await requestMonth(app, "2025-06", { cookie: inspector.cookie });
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(view);
    const entries = await monthEntries();
    expect(entries).toHaveLength(entriesBefore + 1);
    expect(entries.at(-1)).toMatchObject({
      personId: inspector.personId,
      data: { month: "2025-06", invoices: 0 },
    });
    expect(await (await monthStatus(app, inspector.cookie)).json()).toEqual(view);
    await runBuild(app);
    expect(await (await monthStatus(app, inspector.cookie)).json()).toEqual({
      status: "ready",
      id: view.id,
      month: "2025-06",
      bytes: expect.any(Number),
      expiresAt: expect.any(String),
    });
  });

  it("refuses the status to a person without invoice.inspect", async () => {
    const reporter = await sessionHolding(db(), ["report.view", "report.export"]);
    const refused = await monthStatus(mount(), reporter.cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });

  it("serves the file once, in full, to a browser's plain download by the person who asked", async () => {
    const app = mount({ render: countingRender().render });
    const asker = await sessionHolding(db(), ["invoice.inspect"]);
    const other = await sessionHolding(db(), ["invoice.inspect"]);
    expect((await requestMonth(app, "2026-01", { cookie: asker.cookie })).status).toBe(202);
    await runBuild(app);
    const ready = (await (await monthStatus(app, asker.cookie)).json()) as {
      id: string;
      bytes: number;
    };
    const notTheirs = await monthFile(app, { cookie: other.cookie, id: ready.id });
    expect(notTheirs.status).toBe(404);
    expect(await notTheirs.json()).toMatchObject({
      error: { code: "tax_office.download_missing" },
    });
    // What a browser's navigation sends: the cookie, and no custom or JSON headers.
    const saved = await monthFile(app, {
      cookie: asker.cookie,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-type")).toBe("application/zip");
    expect(saved.headers.get("content-disposition")).toBe(
      'attachment; filename="invoices-2026-01.zip"',
    );
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(saved.headers.get("x-content-type-options")).toBe("nosniff");
    expect(saved.headers.get("content-length")).toBe(String(ready.bytes));
    const bytes = new Uint8Array(await saved.arrayBuffer());
    expect(bytes.byteLength).toBe(ready.bytes);
    expect(Object.keys(unzipSync(bytes))).toHaveLength(8);
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app, asker.cookie)).json()).toEqual({ status: "none" });
    const twice = await monthFile(app, { cookie: asker.cookie, id: ready.id });
    expect(twice.status).toBe(404);
    expect(await twice.json()).toMatchObject({ error: { code: "tax_office.download_missing" } });
  });

  it("keeps the file for another try when a download is aborted part-way", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    const aborted = new AbortController();
    const partial = await monthFile(app, { signal: aborted.signal });
    expect(partial.status).toBe(200);
    const reader = partial.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    aborted.abort();
    await reader.cancel();
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
    const retried = await monthFile(app);
    expect(retried.status).toBe(200);
    expect(Object.keys(await unzipped(retried))).toHaveLength(8);
  });

  it("answers a HEAD for the file with its headers, leaves no file open and keeps the file", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    const ready = (await (await monthStatus(app)).json()) as { bytes: number };
    files.opened.length = 0;
    const head = await monthFile(app, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("application/zip");
    expect(head.headers.get("content-length")).toBe(String(ready.bytes));
    expect(head.body).toBeNull();
    // Failing case: Hono drops a HEAD's body unread and uncancelled, and an opened file is then
    // collected open, which ends the process.
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
    expect(Object.keys(await unzipped(await monthFile(app)))).toHaveLength(8);
  });

  it("closes the file when the download ends while the file is being opened", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    const aborted = new AbortController();
    const partial = await monthFile(app, { signal: aborted.signal });
    expect(partial.status).toBe(200);
    files.opened.length = 0;
    files.whileOpening = () => aborted.abort();
    await expect(partial.body!.getReader().read()).rejects.toThrow();
    expect(files.opened).toHaveLength(1);
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
  });

  it("closes the file and keeps it for another try when reading it fails", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    files.opened.length = 0;
    files.whileOpening = (handle) =>
      void vi.spyOn(handle, "read").mockRejectedValueOnce(new Error("read failed"));
    const failing = await monthFile(app);
    expect(failing.status).toBe(200);
    await expect(failing.body!.getReader().read()).rejects.toThrow("read failed");
    expect(files.opened).toHaveLength(1);
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
  });

  it("closes the file and keeps it for another try when the reader cancels part-way", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    files.opened.length = 0;
    const reader = (await monthFile(app)).body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect(files.opened).toHaveLength(1);
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
  });

  it("keeps the file when the connection ends during the last read", async () => {
    const app = mount({ render: countingRender().render });
    expect((await requestMonth(app, "2026-01")).status).toBe(202);
    await runBuild(app);
    const aborted = new AbortController();
    files.opened.length = 0;
    files.whileOpening = (handle) => {
      const read = handle.read.bind(handle) as (
        ...args: unknown[]
      ) => Promise<{ bytesRead: number; buffer: Uint8Array }>;
      vi.spyOn(handle, "read").mockImplementation((async (...args: unknown[]) => {
        const result = await read(...args);
        if (result.bytesRead === 0) aborted.abort();
        return result;
      }) as FileHandle["read"]);
    };
    const response = await monthFile(app, { signal: aborted.signal });
    const reader = response.body!.getReader();
    while (!(await reader.read()).done);
    expect(aborted.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
    expect(await (await monthStatus(app)).json()).toMatchObject({ status: "ready" });
  });

  it("refuses the file to the person who asked once they no longer hold invoice.inspect", async () => {
    const app = mount({ render: countingRender().render });
    const asker = await sessionHolding(db(), ["invoice.inspect"]);
    expect((await requestMonth(app, "2025-06", { cookie: asker.cookie })).status).toBe(202);
    await runBuild(app);
    await confineTo(db(), asker.personId, ["report.view"]);
    const refused = await monthFile(app, { cookie: asker.cookie });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });

  it("refuses a request that would take the disk within the room of the low-space line", async () => {
    const needed = SPACE_LOW_BYTES + TAX_OFFICE_ROOM_BYTES;
    let free = needed - 1;
    const app = mount({ freeBytes: () => Promise.resolve(free) });
    const entriesBefore = (await monthEntries()).length;
    const refused = await requestMonth(app, "2025-06");
    expect(refused.status).toBe(507);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "tax_office.space_low",
        params: { freeBytes: needed - 1, neededBytes: needed },
      },
    });
    expect(await monthEntries()).toHaveLength(entriesBefore);
    expect(await (await monthStatus(app)).json()).toEqual({ status: "none" });
    free = needed;
    expect((await requestMonth(app, "2025-06")).status).toBe(202);
    expect(await monthEntries()).toHaveLength(entriesBefore + 1);
  });

  it("answers a repeat of the person's running build with its view even once space runs low", async () => {
    const needed = SPACE_LOW_BYTES + TAX_OFFICE_ROOM_BYTES;
    let free = needed;
    const app = mount({
      render: countingRender().render,
      freeBytes: () => Promise.resolve(free),
    });
    const asked = await requestMonth(app, "2025-06");
    expect(asked.status).toBe(202);
    const view = (await asked.json()) as { id: string };
    free = needed - 1;
    const again = await requestMonth(app, "2025-06");
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(view);
    const otherMonth = await requestMonth(app, "2025-07");
    expect(otherMonth.status).toBe(507);
    expect(await otherMonth.json()).toMatchObject({ error: { code: "tax_office.space_low" } });
    await runBuild(app);
  });

  it("serves only the month whose id the save names, once another month replaced it", async () => {
    const app = mount({ render: countingRender().render });
    const asker = await sessionHolding(db(), ["invoice.inspect"]);
    expect((await requestMonth(app, "2026-01", { cookie: asker.cookie })).status).toBe(202);
    await runBuild(app);
    const january = (await (await monthStatus(app, asker.cookie)).json()) as { id: string };
    expect(january).toMatchObject({ status: "ready", month: "2026-01" });
    expect((await requestMonth(app, "2025-06", { cookie: asker.cookie })).status).toBe(202);
    await runBuild(app);
    const stale = await monthFile(app, { cookie: asker.cookie, id: january.id });
    expect(stale.status).toBe(404);
    expect(await stale.json()).toMatchObject({ error: { code: "tax_office.download_missing" } });
    const june = await monthFile(app, { cookie: asker.cookie });
    expect(june.status).toBe(200);
    expect(june.headers.get("content-disposition")).toBe(
      'attachment; filename="invoices-2025-06.zip"',
    );
    await june.body!.cancel();
    await vi.waitFor(() => expect(stillOpen()).toEqual([]));
  });

  it("reads free space before taking the write lock that sales wait behind", async () => {
    const seen: string[] = [];
    const app = mount({
      render: countingRender().render,
      freeBytes: async () => {
        seen.push(
          await Promise.race([
            db().withWriteLock(() => Promise.resolve("lock free")),
            new Promise<string>((resolve) => setTimeout(() => resolve("lock held"), 500)),
          ]),
        );
        return null;
      },
    });
    expect((await requestMonth(app, "2025-06")).status).toBe(202);
    expect(seen).toEqual(["lock free"]);
    await runBuild(app);
  });

  it("logs the system's error code when the file cannot be closed after sending", async () => {
    const logged: { event: string; fields?: Record<string, unknown> }[] = [];
    const app = mount({ render: countingRender().render }, (_level, event, fields) =>
      logged.push({ event, ...(fields === undefined ? {} : { fields }) }),
    );
    expect((await requestMonth(app, "2025-06")).status).toBe(202);
    await runBuild(app);
    files.whileOpening = (handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementationOnce(async () => {
        await close();
        throw Object.assign(new Error("input/output error"), { code: "EIO" });
      });
    };
    expect(Object.keys(await unzipped(await monthFile(app)))).toHaveLength(2);
    await vi.waitFor(() =>
      expect(logged).toContainEqual({
        event: "tax_office.file_close_failed",
        fields: { errno: "EIO" },
      }),
    );
  });

  it("finishes a build whose requesting session ended, for the same person's next session", async () => {
    const app = mount({ render: countingRender().render });
    const asker = await sessionHolding(db(), ["invoice.inspect"]);
    expect((await requestMonth(app, "2025-06", { cookie: asker.cookie })).status).toBe(202);
    await inTx(venue, (tx) => endManagementSession(tx, tokenOf(asker.cookie), "signed_out"));
    await runBuild(app);
    const next = await withNewSession(asker.personId);
    expect(await (await monthStatus(app, next)).json()).toMatchObject({ status: "ready" });
    const saved = await monthFile(app, { cookie: next });
    expect(saved.status).toBe(200);
    expect(Object.keys(await unzipped(saved))).toHaveLength(2);
  });
});

async function withNewSession(personId: string): Promise<string> {
  const session = await inTx(venue, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

describe("the month's CSV and README", () => {
  const row: TaxOfficeInvoice = {
    id: "00000000-0000-4000-8000-000000000001",
    number: "A/1",
    kind: "F2",
    issuedAt: "2026-01-12T11:00:00.000Z",
    issueDate: "2026-01-12",
    issueTime: "12:00:00",
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

  it("writes a cancellation's date as the venue's calendar day", () => {
    const voided = { ...row, cancelledAt: "2026-01-31T23:30:00.000Z" };
    const lineIn = (timeZone: string) =>
      new TextDecoder().decode(renderTaxOfficeCsv([voided], "en", timeZone)).split("\r\n")[1];
    expect(lineIn("Europe/Madrid")).toMatch(/,"2026-02-01"$/);
    expect(lineIn("UTC")).toMatch(/,"2026-01-31"$/);
  });

  it("guards a rate cell that is not a plain decimal against spreadsheet formulas", () => {
    const odd = { ...row, vat: [{ rate: "=1+1", base: "-1.00", tax: "-0.10" }] };
    const [, line] = new TextDecoder()
      .decode(renderTaxOfficeCsv([odd], "en", "Europe/Madrid"))
      .split("\r\n");
    expect(line).toContain('"\'=1+1","-1.00","-0.10"');
  });

  it("writes a credit note's negative amounts with the language's decimal mark", () => {
    const credit: TaxOfficeInvoice = {
      ...row,
      kind: "R5",
      vat: [{ rate: "5.5", base: "-2.84", tax: "-0.16" }],
      total: decimal("-3.00"),
    };
    const line = (language: "en" | "es") =>
      new TextDecoder()
        .decode(renderTaxOfficeCsv([credit], language, "Europe/Madrid"))
        .split("\r\n")[1];
    expect(line("en")).toContain('"5.5","-2.84","-0.16","-3.00"');
    expect(line("es")).toContain('"5,5","-2,84","-0,16","-3,00"');
  });

  it("leaves the venue's name out of the README when there is none", () => {
    const args = { venue: null, month: "2026-01", timeZone: "Europe/Madrid", date: "2026-02-01" };
    const firstLine = (text: string) => text.split("\r\n")[0]!;
    for (const words of [TAX_OFFICE_EXPORT_WORDS.en, TAX_OFFICE_EXPORT_WORDS.es]) {
      const named = firstLine(words.readme({ ...args, venue: "Harbour Bar" }));
      expect(named).toContain(" Harbour Bar ");
      expect(firstLine(words.readme(args))).toBe(named.replace(/ \S+ Harbour Bar/, ""));
    }
    expect(TAX_OFFICE_EXPORT_WORDS.en.readme(args)).toMatch(/^Invoices issued in 2026-01,/);
  });

  it("says in the README on which day the file was prepared", () => {
    const args = { venue: null, month: "2026-01", timeZone: "Europe/Madrid", date: "2026-02-01" };
    expect(TAX_OFFICE_EXPORT_WORDS.en.readme(args)).toContain("\r\nPrepared on 2026-02-01.\r\n");
    expect(TAX_OFFICE_EXPORT_WORDS.es.readme(args)).toContain("\r\nPreparado el 2026-02-01.\r\n");
  });

  it("says in the README what a failed.txt lists", () => {
    const args = { venue: null, month: "2026-01", timeZone: "Europe/Madrid", date: "2026-02-01" };
    for (const words of [TAX_OFFICE_EXPORT_WORDS.en, TAX_OFFICE_EXPORT_WORDS.es]) {
      expect(words.readme(args)).toContain("failed.txt");
      expect(words.failed(["A/1", "B/2"])).toMatch(/\r\nA\/1\r\nB\/2\r\n$/);
    }
  });
});
