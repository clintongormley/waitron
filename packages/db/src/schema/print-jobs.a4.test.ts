import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { insertA4Printer } from "../testing/printers.js";
import { seedCashSale, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { printers } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let officeId: string;
let receiptId: string;
let saleId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  ({ saleId } = await seedCashSale(suite.db));
  officeId = await withTransaction(suite.db, insertA4Printer);
  const [receipt] = await suite.db
    .insert(printers)
    .values({ name: "Receipt", transport: "usb", localKey: "receipt-printer" })
    .returning({ id: printers.id });
  receiptId = receipt!.id;
});

function insert(
  kind: "a4" | "document" | "drawer",
  payload: Uint8Array | null,
  sale: string | null,
  hold?: string,
) {
  const printerId = kind === "a4" ? officeId : receiptId;
  return suite.db.execute(sql`
    insert into print_jobs (id, printer_id, kind, payload, sale_id, created_at, page_document
      ${hold === undefined ? sql`` : sql`, printer_hold`})
    values (${randomUUID()}, ${printerId}, ${kind}, ${payload}, ${sale}, '2026-11-19T00:00:00.000Z',
      ${kind === "a4" ? "invoice" : null}
      ${hold === undefined ? sql`` : sql`, ${hold}`})
    returning kind, payload is null as payload_missing, sale_id
  `);
}

it("accepts a payload-free office print for a sale and a receipt with bytes", async () => {
  const a4 = await insert("a4", null, saleId, "paper_out");
  expect(a4.rows).toEqual([{ kind: "a4", payload_missing: 1, sale_id: saleId }]);
  const receipt = await insert("document", Uint8Array.of(1), null);
  expect(receipt.rows).toEqual([{ kind: "document", payload_missing: 0, sale_id: null }]);
});

it("requires payloads on thermal jobs and forbids them on office jobs", async () => {
  for (const write of [
    () => insert("a4", Uint8Array.of(1), saleId),
    () => insert("document", null, null),
    () => insert("drawer", null, null),
  ]) {
    expect(engineErrorMessage(await captureError(write))).toBe(
      "CHECK constraint failed: print_jobs_payload_ck",
    );
  }
});

it("requires an office print to name a sale", async () => {
  expect(engineErrorMessage(await captureError(() => insert("a4", null, null)))).toBe(
    "CHECK constraint failed: print_jobs_a4_sale_ck",
  );
});

it("only accepts a recognised printer hold on an office print", async () => {
  const wrongKind = await captureError(() =>
    insert("document", Uint8Array.of(1), null, "paper_out"),
  );
  expect(engineErrorMessage(wrongKind)).toBe("CHECK constraint failed: print_jobs_a4_hold_ck");
  const unknownHold = await captureError(() => insert("a4", null, saleId, "invented"));
  expect(engineErrorMessage(unknownHold)).toBe(
    "CHECK constraint failed: print_jobs_printer_hold_ck",
  );
});
