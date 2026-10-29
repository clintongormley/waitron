import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceSeries } from "@waitron/db";
import { getCountryPack } from "@waitron/country-packs";
import { recordSale } from "@waitron/core";
import {
  AppError,
  diskFullIn,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { zipArchive } from "./download-archive.js";
import { readInvoiceDocument } from "./invoice-document.js";
import {
  INVOICE_CUSTOMER_FILE,
  buildInvoiceCustomerFiles,
  findInvoiceCustomerSales,
  type InvoiceCustomerFilesDeps,
} from "./invoice-customer-data.js";
import type { Logger } from "./logger.js";
import { inTx } from "./testing/bill-venue.js";
import {
  provisionInvoiceCustomerVenue,
  type InvoiceCustomerVenue,
} from "./testing/invoice-customer-fixture.js";
import { parked } from "./testing/order-venue.js";

let fixture: InvoiceCustomerVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    fixture = await provisionInvoiceCustomerVenue(db);
  },
});

const quiet: Logger = () => {};

function search(taxId: string) {
  return suite.db.withWriteLock(() => findInvoiceCustomerSales(suite.db, taxId));
}

function deps(overrides: Partial<InvoiceCustomerFilesDeps> = {}): InvoiceCustomerFilesDeps {
  return {
    db: suite.db,
    backend: fixture.venue.backend,
    tradingContext: fixture.venue.cfg,
    log: quiet,
    ...overrides,
  };
}

type Files = Awaited<ReturnType<typeof buildInvoiceCustomerFiles>>["files"];

function invoicesFile(files: Files): { invoices: { pdf: string }[] } {
  const file = files.find((f) => f.name === INVOICE_CUSTOMER_FILE)!;
  return JSON.parse(file.content as string) as { invoices: { pdf: string }[] };
}

function pdfsOf(files: Files): Map<string, Uint8Array> {
  return new Map(
    files
      .filter((file) => file.name !== INVOICE_CUSTOMER_FILE)
      .map((file) => [file.name, file.content as Uint8Array]),
  );
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const parts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    return parts.join(" ");
  } finally {
    await loading.destroy();
  }
}

const startsAsPdf = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

/** A full invoice in Jordi's name under `taxId`, a number no fixture row holds, in `seriesId`. */
async function jordiInvoiceIn(seriesId: string, taxId = "01234567L"): Promise<string> {
  expect(getCountryPack("ES")!.taxIdentifier!.validate(taxId).valid).toBe(true);
  const { venue } = fixture;
  const billId = await parked(venue, "Caña");
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(seriesId),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: venue.cfg.invoiceLocales,
      counterparty: { taxId, legalName: "Jordi Puig", countryCode: "ES" },
      recipientAddress: "12 Harbour Road, 46023 Valencia",
      total: "3.00",
      lines: [
        {
          lineNo: 1,
          name: "Beer",
          descriptions: { [venue.cfg.locale]: "Draught beer" },
          quantity: "1",
          unitPrice: "3.00",
          vatRate: "10",
          lineTotal: "3.00",
        },
      ],
      clock: venue.clock,
      settlement: { kind: "deferred" },
      operatorId: venue.operatorId,
    }),
  );
  return saleId;
}

describe("buildInvoiceCustomerFiles' PDFs", () => {
  it("renders each invoice at the path invoices.json names, as the duplicate", async () => {
    const built = await buildInvoiceCustomerFiles(deps(), "12345678Z", await search("12345678Z"));
    const paths = invoicesFile(built.files).invoices.map((invoice) => invoice.pdf);
    expect(paths).toEqual(["invoices/FF-1.pdf", "invoices/FF-3.pdf", "invoices/FF-6.pdf"]);
    const pdfs = pdfsOf(built.files);
    expect([...pdfs.keys()]).toEqual(paths);
    for (const bytes of pdfs.values()) expect(startsAsPdf(bytes)).toBe(true);
    const text = await pdfText(pdfs.get("invoices/FF-3.pdf")!);
    expect(text).toContain("3 Port Avenue, 46024 Valencia");
    expect(text).toContain("112,40");
    expect(text).toContain("DUPLICADO");
  });

  it("holds nothing of another customer in any PDF's text", async () => {
    const built = await buildInvoiceCustomerFiles(deps(), "12345678Z", await search("12345678Z"));
    const forbidden = [
      "Puig Electrical",
      "B76543214",
      "X1234567L",
      "E12345674",
      "310.07",
      "310,07",
      "23,18",
      "75,55",
      "office@puig-electrical.example.test",
      "board@mainstreet.example.test",
      fixture.venue.operatorId,
    ];
    const texts = await Promise.all([...pdfsOf(built.files).values()].map(pdfText));
    expect(texts).toHaveLength(3);
    // Positive control: his own name is read from every PDF.
    for (const text of texts) {
      expect(text).toContain("Jordi Puig");
      for (const value of forbidden) expect(text).not.toContain(value);
    }
  });

  it("gives two invoices with one file name a free -2, -3 suffix in issue order", async () => {
    const { venue } = fixture;
    const created = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values([
          { nodeId: venue.cfg.nodeId, code: "F/A", purpose: "full" },
          { nodeId: venue.cfg.nodeId, code: "F_A", purpose: "full" },
          { nodeId: venue.cfg.nodeId, code: "F_A-1", purpose: "full", nextNumber: 2 },
          { nodeId: venue.cfg.nodeId, code: "F/A-1", purpose: "full", nextNumber: 2 },
        ])
        .returning({ id: invoiceSeries.id, code: invoiceSeries.code }),
    );
    const idOf = (code: string) => created.find((row) => row.code === code)!.id;
    await jordiInvoiceIn(idOf("F/A"));
    await jordiInvoiceIn(idOf("F_A"));
    await jordiInvoiceIn(idOf("F_A-1"));
    await jordiInvoiceIn(idOf("F/A-1"));

    const found = await search("01234567L");
    expect(found.map((sale) => sale.invoice)).toEqual(["F/A/1", "F_A/1", "F_A-1/2", "F/A-1/2"]);
    const built = await buildInvoiceCustomerFiles(deps(), "01234567L", found);
    // The fourth's own name and its -2 are both held, so it takes -3.
    const names = [
      "invoices/F_A-1.pdf",
      "invoices/F_A-1-2.pdf",
      "invoices/F_A-1-2-2.pdf",
      "invoices/F_A-1-2-3.pdf",
    ];
    expect(invoicesFile(built.files).invoices.map((invoice) => invoice.pdf)).toEqual(names);
    const pdfs = pdfsOf(built.files);
    expect([...pdfs.keys()]).toEqual(names);
    // Each name holds its own invoice, not a neighbour's.
    const printed = ["F/A/1", "F_A/1", "F_A-1/2", "F/A-1/2"];
    for (const [index, name] of names.entries()) {
      expect(await pdfText(pdfs.get(name)!)).toContain(printed[index]);
    }
    const zipped = unzipSync(zipArchive(built.files, new Date()));
    expect(Object.keys(zipped).filter((name) => name.endsWith(".pdf"))).toEqual(names);
    for (const name of names) expect(startsAsPdf(zipped[name]!)).toBe(true);
  });

  it("treats a name differing only in letter case as taken", async () => {
    // A case-insensitive disk (macOS, Windows) would unpack fa-1.pdf and FA-1.pdf as one file.
    const { venue } = fixture;
    const created = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values([
          { nodeId: venue.cfg.nodeId, code: "fa", purpose: "full" },
          { nodeId: venue.cfg.nodeId, code: "FA", purpose: "full" },
        ])
        .returning({ id: invoiceSeries.id, code: invoiceSeries.code }),
    );
    for (const code of ["fa", "FA"]) {
      await jordiInvoiceIn(created.find((row) => row.code === code)!.id, "87654321X");
    }
    const found = await search("87654321X");
    expect(found.map((sale) => sale.invoice)).toEqual(["fa/1", "FA/1"]);
    const built = await buildInvoiceCustomerFiles(deps(), "87654321X", found);
    const names = ["invoices/fa-1.pdf", "invoices/FA-1-2.pdf"];
    expect(invoicesFile(built.files).invoices.map((invoice) => invoice.pdf)).toEqual(names);
    expect([...pdfsOf(built.files).keys()]).toEqual(names);
  });

  describe("an invoice that cannot be made", () => {
    function recording(): { log: Logger; events: [string, string, unknown][] } {
      const events: [string, string, unknown][] = [];
      return { log: (level, event, fields) => events.push([level, event, fields]), events };
    }

    async function failure(overrides: Partial<InvoiceCustomerFilesDeps>): Promise<unknown> {
      const sales = await search("12345678Z");
      return buildInvoiceCustomerFiles(deps(overrides), "12345678Z", sales).then(
        () => expect.fail("the build should have failed"),
        (error: unknown) => error,
      );
    }

    it("fails the whole build, opaquely, when an invoice's document cannot be read", async () => {
      const { j2 } = fixture.sales;
      const original = new AppError("invoice_delivery.not_found", {});
      const { log, events } = recording();
      const error = await failure({
        log,
        readDocument: (backend, tx, tradingContext, saleId) =>
          saleId === j2
            ? Promise.reject(original)
            : readInvoiceDocument(backend, tx, tradingContext, saleId),
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect((error as Error).cause).toBe(original);
      expect(events.filter(([, event]) => event === "invoice_customer.pdf_failed")).toEqual([
        ["error", "invoice_customer.pdf_failed", { saleId: j2 }],
      ]);
    });

    it("fails the whole build, opaquely, when an invoice's PDF cannot be rendered", async () => {
      const { j2 } = fixture.sales;
      const original = new AppError("invoice_delivery.not_found", {});
      const { log, events } = recording();
      const stub = new TextEncoder().encode("%PDF-stub");
      const error = await failure({
        log,
        render: (document) =>
          document.result.total === "112.40" ? Promise.reject(original) : Promise.resolve(stub),
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect((error as Error).cause).toBe(original);
      expect(events.filter(([, event]) => event === "invoice_customer.pdf_failed")).toEqual([
        ["error", "invoice_customer.pdf_failed", { saleId: j2 }],
      ]);
    });

    it("keeps a full disk findable in the failure's cause chain", async () => {
      const { j2 } = fixture.sales;
      const error = await failure({
        readDocument: (backend, tx, tradingContext, saleId) =>
          saleId === j2
            ? Promise.reject(new AppError("storage.disk_full", {}))
            : readInvoiceDocument(backend, tx, tradingContext, saleId),
      });
      expect(error).not.toBeInstanceOf(AppError);
      expect(diskFullIn(error)).toBe(true);
    });
  });
});
