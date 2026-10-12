import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { invoicePdfDownloads } from "./invoice-pdf-downloads.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000002";
const PERSON = "cccccccc-0000-4000-8000-000000000002";

describe("invoice PDF download record", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  it("refuses an unknown sale, keeps a known one's row, and refuses any change to it", async () => {
    const db = suite.db;
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
      .values({ nodeId, code: "F", purpose: "full" })
      .returning({ id: invoiceSeries.id });
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: "2026-10-12T09:00:00Z",
        issuedOffsetMinutes: 0,
        total: 100,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });

    const missing = await captureError(() =>
      withTransaction(db, (tx) =>
        tx
          .insert(invoicePdfDownloads)
          .values({ saleId: "ffffffff-0000-4000-8000-000000000002", personId: PERSON }),
      ),
    );
    expect(FOREIGN_KEY_VIOLATION).toContain((missing as { errcode: number }).errcode);

    const [row] = await withTransaction(db, (tx) =>
      tx.insert(invoicePdfDownloads).values({ saleId: sale!.id, personId: PERSON }).returning(),
    );
    expect(row).toMatchObject({ saleId: sale!.id, personId: PERSON });
    expect(Number.isNaN(Date.parse(row!.requestedAt))).toBe(false);

    const changed = await captureError(() =>
      withTransaction(db, (tx) =>
        tx
          .update(invoicePdfDownloads)
          .set({ personId: sale!.id })
          .where(eq(invoicePdfDownloads.id, row!.id)),
      ),
    );
    expect(triggerRaised(changed, "invoice_pdf_downloads is append-only")).toBe(true);
    const removed = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.delete(invoicePdfDownloads).where(eq(invoicePdfDownloads.id, row!.id)),
      ),
    );
    expect(triggerRaised(removed, "invoice_pdf_downloads is append-only")).toBe(true);
  });
});
