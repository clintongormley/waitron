import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { jsonFile } from "@waitron/module";
import { hashSessionToken, registerModulePermissions } from "@waitron/identity";
import { savePrivacyContact } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  mountInvoiceCustomerDataApi,
  type InvoiceCustomerDataDeps,
} from "./invoice-customer-data-api.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { ALL_MODULE_PERMISSIONS } from "./modules.js";
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
// 00:30 on 27 October in the venue's Europe/Madrid, still 26 October in UTC: a download dated
// by any zone but the venue's gets the wrong day. Nothing on the download path compares this
// time with the records' times.
const at = new Date("2026-10-26T23:30:00Z");
const VENUE_DATE = "2026-10-27";

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
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="jordi-puig-electrician-${VENUE_DATE}.zip"`,
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
        date: VENUE_DATE,
        anyTaxRecord: expected.invoices.some((invoice) => invoice.taxRecord),
        anyEmail: expected.invoices.some((invoice) => invoice.emails.length > 0),
      }),
    );
  });

  it("ends the README with the venue's saved privacy page, and names none once it is cleared", async () => {
    const page = "https://example.com/privacy";
    const store = (privacyNoticeUrl: string | null) =>
      withTransaction(suite.db, (tx) => savePrivacyContact(tx, { privacyNoticeUrl }));
    onTestFinished(async () => {
      await store(null);
    });
    const readmeLines = async () =>
      strFromU8((await unzipped(await ask("12345678Z")))["README.txt"]!)
        .trimEnd()
        .split("\n");
    await store(page);
    expect((await readmeLines()).at(-1)!.endsWith(page)).toBe(true);
    await store(null);
    expect((await readmeLines()).some((line) => line.includes("https://"))).toBe(false);
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
    expect(logger.mock.calls).toEqual([
      ["error", "invoice_customer.pdf_failed", { saleId: fixture.sales.j2 }],
      ["error", "personal_data.failed", { errorCode: "unknown", requestId: undefined }],
    ]);
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
    const staffNames = [/\bAna\b/u, /\bAdministradora\b/u, /\bSofía\b/u, /\bOtto\b/u, /\bMia\b/u];
    for (const text of texts) {
      for (const value of forbidden) expect(text).not.toContain(value);
      for (const name of staffNames) expect(text).not.toMatch(name);
    }
  });
});
