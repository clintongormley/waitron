import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { jsonFile } from "@waitron/module";
import { hashSessionToken, registerModulePermissions } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { civilDateOf } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import {
  mountInvoiceCustomerDataApi,
  type InvoiceCustomerDataDeps,
} from "./invoice-customer-data-api.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { ALL_MODULE_PERMISSIONS } from "./modules.js";
import { venuePlace } from "./personal-data-export-api.js";
import { invoiceCustomerReadme } from "./personal-data-readme.js";
import {
  expectedJordiFile,
  provisionInvoiceCustomerVenue,
  type InvoiceCustomerVenue,
} from "./testing/invoice-customer-fixture.js";

let fixture: InvoiceCustomerVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    fixture = await provisionInvoiceCustomerVenue(db);
  },
});

const DOWNLOAD = "/management-api/invoice-customers/personal-data/export";
const logger = vi.fn();
const at = new Date();

function ask(taxId: string, patch: Partial<InvoiceCustomerDataDeps> = {}) {
  const app = new Hono();
  mountInvoiceCustomerDataApi(
    app,
    {
      db: suite.db,
      backend: fixture.venue.backend,
      till: fixture.venue.cfg,
      nodeId: fixture.venue.cfg.nodeId,
      venueLocale: "es-ES",
      now: () => at,
      onMirror: () => false,
      ...patch,
    },
    logger,
  );
  return app.request(`${DOWNLOAD}?taxId=${encodeURIComponent(taxId)}`, {
    headers: { cookie: fixture.venue.adminDashboard },
  });
}

async function unzipped(response: Response): Promise<Record<string, Uint8Array>> {
  expect(response.status).toBe(200);
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
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

const venueDate = async () =>
  civilDateOf(
    at,
    (await suite.db.withWriteLock(() => venuePlace(suite.db, fixture.venue.cfg.nodeId))).timeZone,
  );

beforeAll(() => {
  registerModulePermissions(ALL_MODULE_PERMISSIONS);
});

beforeEach(() => {
  logger.mockClear();
});

describe("the invoice customer download, end to end", () => {
  it("sends Jordi's README, invoices.json and three PDFs, named for his newest invoice", async () => {
    const response = await ask("ES 12345678 z");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const date = await venueDate();
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="jordi-puig-electrician-${date}.zip"`,
    );
    const files = await unzipped(response);
    expect(Object.keys(files).sort()).toEqual(
      [
        "README.txt",
        "invoices.json",
        "invoices/FF-1.pdf",
        "invoices/FF-3.pdf",
        "invoices/FF-6.pdf",
      ].sort(),
    );
    const expected = await expectedJordiFile(fixture);
    const json = strFromU8(files["invoices.json"]!);
    expect(JSON.parse(json)).toEqual(expected);
    expect(json).toBe(jsonFile("invoices.json", expected).content);
    expect(strFromU8(files["README.txt"]!)).toBe(
      invoiceCustomerReadme({
        language: "es",
        venue: "Tarjetas SL",
        customer: "Jordi Puig Electrician",
        date,
        anyTaxRecord: expected.invoices.some((invoice) => invoice.taxRecord),
        anyEmail: expected.invoices.some((invoice) => invoice.emails.length > 0),
      }),
    );
  });

  it("gives the same invoices.json for each spelling of Jordi's number, and the company its own", async () => {
    const expected = await expectedJordiFile(fixture);
    for (const spelling of ["es 12345678z", "ES12345678Z", "12345678 Z"]) {
      const files = await unzipped(await ask(spelling));
      expect(JSON.parse(strFromU8(files["invoices.json"]!))).toEqual(expected);
    }
    const company = JSON.parse(
      strFromU8((await unzipped(await ask("es b76543214")))["invoices.json"]!),
    ) as { taxId: string; invoices: { invoice: string; name: string; taxId: string }[] };
    expect(company.taxId).toBe("B76543214");
    expect(company.invoices.map(({ invoice, name, taxId }) => ({ invoice, name, taxId }))).toEqual([
      { invoice: "FF/2", name: "Puig Electrical Ltd", taxId: "B76543214" },
    ]);
  });

  it("answers an opaque 500 and no file when one invoice cannot be read", async () => {
    const readDocument: typeof readInvoiceDocument = async (backend, tx, cfg, saleId) => {
      if (saleId === fixture.sales.j2) throw new AppError("invoice_delivery.not_found", {});
      return readInvoiceDocument(backend, tx, cfg, saleId);
    };
    const response = await ask("12345678Z", { readDocument });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    expect(logger).toHaveBeenCalledWith("error", "invoice_customer.pdf_failed", {
      saleId: fixture.sales.j2,
    });
  });

  it("holds no staff member's id or name and no session secret, in any file's text", async () => {
    const files = await unzipped(await ask("12345678Z"));
    const pdfs = Object.keys(files).filter((name) => name.endsWith(".pdf"));
    expect(pdfs).toHaveLength(3);
    const texts = [
      strFromU8(files["README.txt"]!),
      strFromU8(files["invoices.json"]!),
      ...(await Promise.all(pdfs.map((name) => pdfText(files[name]!)))),
    ];
    for (const text of texts) expect(text).toContain("Jordi Puig");
    const token = fixture.venue.adminDashboard.slice(`${MANAGEMENT_COOKIE}=`.length);
    const { venue } = fixture;
    const forbidden = [
      venue.operatorId,
      venue.adminId,
      venue.supervisorId,
      fixture.people.otherAdminId,
      fixture.people.managerId,
      token,
      hashSessionToken(token),
    ];
    // Staff names as whole words: "Ana" is also the start of the customer "Ana Garcia".
    const staffNames = [/\bAna\b/u, /\bAdministradora\b/u, /\bSofía\b/u, /\bOtto\b/u, /\bMia\b/u];
    for (const text of texts) {
      for (const value of forbidden) expect(text).not.toContain(value);
      for (const name of staffNames) expect(text).not.toMatch(name);
    }
  });
});
