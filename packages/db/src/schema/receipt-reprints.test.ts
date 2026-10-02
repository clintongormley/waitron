import { describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { receiptReprints } from "./receipt-reprints.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL = "aaaaaaaa-0000-4000-8000-000000000011";
const PERSON = "cccccccc-0000-4000-8000-000000000001";

describe("receipt reprint record", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  it("refuses an unknown sale and a second record of the same job", async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture" });
    await db
      .insert(locations)
      .values({
        id: LOCATION,
        name: "Fixture",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      });
    await db.insert(tills).values({ id: TILL, locationId: LOCATION, name: "Till" });
    const nodeId = await seedNode(db, brandLocationId(LOCATION));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    const [printer] = await db
      .insert(printers)
      .values({ locationId: LOCATION, name: "Printer", transport: "network_tcp", host: "10.0.0.5" })
      .returning({ id: printers.id });
    const [job] = await db
      .insert(printJobs)
      .values({ locationId: LOCATION, printerId: printer!.id, payload: new Uint8Array([1]) })
      .returning({ id: printJobs.id });
    const [sale] = await db
      .insert(sales)
      .values({
        tillId: TILL,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
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

    const missing = await captureError(() =>
      withTransaction(db, (tx) =>
        tx
          .insert(receiptReprints)
          .values({
            saleId: "ffffffff-0000-4000-8000-000000000001",
            printJobId: job!.id,
            personId: PERSON,
          }),
      ),
    );
    expect(FOREIGN_KEY_VIOLATION).toContain((missing as { errcode: number }).errcode);
    await withTransaction(db, (tx) =>
      tx
        .insert(receiptReprints)
        .values({ saleId: sale!.id, printJobId: job!.id, personId: PERSON }),
    );
    const duplicate = await captureError(() =>
      withTransaction(db, (tx) =>
        tx
          .insert(receiptReprints)
          .values({ saleId: sale!.id, printJobId: job!.id, personId: PERSON }),
      ),
    );
    expect(UNIQUE_VIOLATION).toContain((duplicate as { errcode: number }).errcode);
  });
});
