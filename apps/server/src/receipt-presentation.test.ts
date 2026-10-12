import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  invoiceSeries,
  sales,
  tenantReceipts,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  departmentReceipts,
  saleReceiptHeaders,
} from "@waitron/venue-service";
import { readReceiptPresentation } from "./receipt-presentation.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
async function fixture(header: "department" | "null" | "absent" = "department") {
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: randomUUID(),
      invoiceLocales: ["es-ES"],
      operationDescription: "Generic bootstrap",
      addressLine1: "Current street",
      city: "Madrid",
    })
    .returning();
  const cfg = { locationId: locationId(place!.id) };
  const nodeId = await seedNode(suite.db, cfg.locationId);
  const [department] = await suite.db
    .insert(departments)
    .values({ locationId: cfg.locationId, name: "Dining", tradingName: "Live brand" })
    .returning();
  const [series] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "F" }).returning();
  const [sale] = await suite.db
    .insert(sales)
    .values({
      source: "readiness_test",
      nodeId,
      seriesId: series!.id,
      invoiceNumber: 1,
      issuedAt: "2026-10-10T00:00:00Z",
      issuedOffsetMinutes: 0,
      total: 0,
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  if (header !== "absent")
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: sale!.id,
      departmentId: header === "null" ? null : department!.id,
      tradingName: "Recorded brand",
      printTradingName: true,
    });
  await suite.db.insert(tenantReceipts).values({
    receipt: {
      logo: `${"a".repeat(64)}.png`,
      headerSubtitle: "Retired subtitle",
      footerMessage: "Retired footer",
      phone: "Retired phone",
      email: "retired@example.test",
      printAddress: true,
    },
  });
  const authored = async (receipt: Record<string, unknown>) => {
    await suite.db
      .insert(departmentReceipts)
      .values({ departmentId: department!.id, receipt })
      .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
  };
  const read = (language = "es-ES") =>
    withTransaction(suite.db, (tx) => readReceiptPresentation(tx, cfg, sale!.id, language));
  return { cfg, departmentId: department!.id, read, authored };
}

describe("department-only on-screen receipt", () => {
  it.each(["department", "null", "absent"] as const)(
    "has no optional decoration for an empty %s context",
    async (header) => {
      const f = await fixture(header);
      if (header === "department") await f.authored({});
      const presentation = await f.read();
      expect(presentation.receiptTrim).toEqual({});
      expect(presentation).toHaveProperty("receiptSettings", { printAddress: false });
      expect(presentation).not.toHaveProperty("venueReceiptSettings");
      expect(presentation.receiptHeader).toEqual(
        header === "department"
          ? { departmentId: f.departmentId, tradingName: "Recorded brand", printTradingName: true }
          : undefined,
      );
    },
  );

  it.each([undefined, false, true])(
    "requires explicit address consent %j while keeping department wording",
    async (printAddress) => {
      const f = await fixture();
      await f.authored({
        ...(printAddress === undefined ? {} : { printAddress }),
        logo: `${"b".repeat(64)}.png`,
        phone: "910111111",
        email: "own@example.test",
        headerSubtitle: { "ca-ES": "Own Catalan", "es-ES": "Own Spanish" },
        footerMessage: { "es-ES": "Own footer" },
      });
      const presentation = await f.read("ca-ES");
      expect(presentation.receiptTrim).toEqual({
        logo: `${"b".repeat(64)}.png`,
        phone: "910111111",
        email: "own@example.test",
        headerSubtitle: "Own Catalan",
        footerMessage: "Own footer",
      });
      expect(presentation).toHaveProperty("receiptSettings", {
        printAddress: printAddress === true,
      });
      expect(presentation.venueAddress).toEqual(["Current street", "Madrid"]);
    },
  );

  it("reads a deleted department's stored language and clears optional values on a later answer", async () => {
    const f = await fixture();
    await f.authored({
      printAddress: true,
      headerSubtitle: { "eu-ES": "Retained Basque", "es-ES": "Spanish" },
      footerMessage: { "es-ES": "Own footer" },
    });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.departmentId));
    expect(await f.read("eu-ES")).toMatchObject({
      receiptTrim: { headerSubtitle: "Retained Basque", footerMessage: "Own footer" },
      receiptSettings: { printAddress: true },
    });
    await f.authored({});
    expect(await f.read("eu-ES")).toMatchObject({
      receiptTrim: {},
      receiptSettings: { printAddress: false },
    });
  });

  it.each(["venue", "department", "both"] as const)(
    "ignores retired storage and bounds diagnostics with %s storage absent",
    async (source) => {
      const f = await fixture();
      await f.authored({ printAddress: true, headerSubtitle: { "es-ES": "Own subtitle" } });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hiddenVenue = source !== "department";
      const hiddenDepartment = source !== "venue";
      try {
        if (hiddenVenue)
          await suite.db.execute(sql`alter table tenant_receipts rename to test_hidden_receipts`);
        if (hiddenDepartment)
          await suite.db.execute(
            sql`alter table department_receipts rename to test_hidden_department_receipts`,
          );
        const presentation = await f.read();
        expect(presentation.receiptTrim).toEqual(
          hiddenDepartment ? {} : { headerSubtitle: "Own subtitle" },
        );
        expect(presentation).toHaveProperty("receiptSettings", { printAddress: !hiddenDepartment });
        expect(warning.mock.calls).toEqual(
          hiddenDepartment
            ? [
                [
                  "receipt.optional_read_failed",
                  {
                    operation: "readPrintedDepartmentReceipt",
                    departmentId: f.departmentId,
                    code: "receipt.read_failed",
                  },
                ],
              ]
            : [],
        );
      } finally {
        if (hiddenDepartment)
          await suite.db.execute(
            sql`alter table test_hidden_department_receipts rename to department_receipts`,
          );
        if (hiddenVenue)
          await suite.db.execute(sql`alter table test_hidden_receipts rename to tenant_receipts`);
        warning.mockRestore();
      }
    },
  );
});
