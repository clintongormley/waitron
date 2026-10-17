import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
} from "../sql-state.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDevice, seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { saleReceiptGuests } from "./sale-receipt-guests.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";

async function seedSales(db: Database, count: number): Promise<string[]> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture" });
  await db.insert(locations).values({
    id: LOCATION,
    name: "Fixture",
    invoiceLocales: ["es"],
    operationDescription: "Hostelería",
  });
  const nodeId = await seedNode(db, brandLocationId(LOCATION));
  const { deviceId } = await seedDevice(db, { locationId: LOCATION });
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: n,
        issuedAt: "2026-10-02T09:00:00Z",
        issuedOffsetMinutes: 0,
        total: 100,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });
    ids.push(sale!.id);
  }
  return ids;
}

describe("sale receipt guests", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleIds: string[] = [];

  beforeEach(async () => {
    saleIds = await seedSales(suite.db, 4);
  });

  const insert = (saleId: string, guests: number | null) =>
    withTransaction(suite.db, (tx) => tx.insert(saleReceiptGuests).values({ saleId, guests }));

  it("stores a guest count of 4, 1 or 999, or none", async () => {
    await insert(saleIds[0]!, 4);
    await insert(saleIds[1]!, null);
    await insert(saleIds[2]!, 1);
    await insert(saleIds[3]!, 999);
    const rows = await suite.db
      .select({ saleId: saleReceiptGuests.saleId, guests: saleReceiptGuests.guests })
      .from(saleReceiptGuests);
    expect(new Map(rows.map((r) => [r.saleId, r.guests]))).toEqual(
      new Map([
        [saleIds[0]!, 4],
        [saleIds[1]!, null],
        [saleIds[2]!, 1],
        [saleIds[3]!, 999],
      ]),
    );
  });

  it("refuses an unknown sale", async () => {
    const error = await captureError(() => insert("ffffffff-0000-4000-8000-000000000001", 2));
    expect(FOREIGN_KEY_VIOLATION).toContain((error as { errcode: number }).errcode);
  });

  it("refuses a second row for one sale", async () => {
    await insert(saleIds[0]!, 2);
    const error = await captureError(() => insert(saleIds[0]!, 3));
    expect(UNIQUE_VIOLATION).toContain((error as { errcode: number }).errcode);
  });

  it.each([0, 1000, 2.5])("refuses a guest count of %s", async (guests) => {
    const error = await captureError(() => insert(saleIds[0]!, guests));
    expect(CHECK_VIOLATION).toContain((error as { errcode: number }).errcode);
  });

  it("refuses to update or delete a stored row, through the append-only triggers", async () => {
    await insert(saleIds[0]!, 2);
    const updated = await captureError(() =>
      suite.db
        .update(saleReceiptGuests)
        .set({ guests: 3 })
        .where(eq(saleReceiptGuests.saleId, saleIds[0]!)),
    );
    expect(isRefusal(updated, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(updated)).toBe("sale_receipt_guests is append-only");
    const deleted = await captureError(() =>
      suite.db.delete(saleReceiptGuests).where(eq(saleReceiptGuests.saleId, saleIds[0]!)),
    );
    expect(isRefusal(deleted, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(deleted)).toBe("sale_receipt_guests is append-only");
  });
});
