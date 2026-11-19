import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { insertA4Printer } from "../testing/printers.js";
import { seedCashSale, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { printers } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let saleId: string;
let office: string;
let thermal: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  ({ saleId } = await seedCashSale(suite.db));
  office = await insertA4Printer(suite.db);
  const [printer] = await suite.db
    .insert(printers)
    .values({ name: "Receipt", transport: "usb", localKey: "receipt-printer" })
    .returning({ id: printers.id });
  thermal = printer!.id;
});

function insert(
  document: string | null,
  language: string | null = null,
  designation: string | null = null,
  kind: "a4" | "document" = "a4",
) {
  return suite.db.execute(sql`
    insert into print_jobs (id, printer_id, kind, payload, sale_id, created_at,
      page_document, page_language, page_designation)
    values (${randomUUID()}, ${kind === "a4" ? office : thermal}, ${kind},
      ${kind === "a4" ? null : Uint8Array.of(1)}, ${saleId}, '2026-11-19T00:00:00.000Z',
      ${document}, ${language}, ${designation})
    returning page_document, page_language, page_designation
  `);
}

it("stores an invoice page with no receipt language or designation", async () => {
  expect((await insert("invoice")).rows).toEqual([
    { page_document: "invoice", page_language: null, page_designation: null },
  ]);
});

it("stores a receipt page with its language and designation", async () => {
  expect((await insert("receipt", "es", "duplicate")).rows).toEqual([
    { page_document: "receipt", page_language: "es", page_designation: "duplicate" },
  ]);
});

it.each([
  [null, null, null, "a4"],
  ["invoice", null, null, "document"],
  ["invoice", "es", null, "a4"],
  ["invoice", null, "original", "a4"],
  ["receipt", null, "original", "a4"],
  ["receipt", "es", null, "a4"],
] as const)(
  "refuses inconsistent page details (%s, %s, %s, %s)",
  async (document, language, designation, kind) => {
    expect(
      engineErrorMessage(await captureError(() => insert(document, language, designation, kind))),
    ).toBe("CHECK constraint failed: print_jobs_page_ck");
  },
);

it.each([
  ["invented", null, null, "print_jobs_page_document_ck"],
  ["receipt", "es", "invented", "print_jobs_page_designation_ck"],
] as const)(
  "refuses unknown page details (%s, %s, %s)",
  async (document, language, designation, check) => {
    expect(
      engineErrorMessage(await captureError(() => insert(document, language, designation))),
    ).toBe(`CHECK constraint failed: ${check}`);
  },
);
