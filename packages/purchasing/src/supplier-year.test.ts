import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isUniqueViolation, purchaseInvoices, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { decimal } from "@waitron/shared";
import { usePurchasingDb } from "../test/fixtures.js";
import { createPurchaseInvoice, getPurchaseInvoice, updatePurchaseInvoice } from "./operations.js";

const suite = usePurchasingDb();
beforeEach(() => seedTenant(suite.db));

function input(issuedOn: string, receivedOn = "2027-02-01") {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Supplier Ltd",
      supplierInvoiceNumber: "001",
      issuedOn,
      receivedOn,
      total: decimal("121.00"),
    },
    lines: [{ rate: decimal("21.00"), base: decimal("100.00"), tax: decimal("21.00") }],
  };
}

describe("supplier invoice numbers by issue year", () => {
  it("accepts the same number across New Year, even with the same receipt date", async () => {
    const old = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2026-12-31")),
    );
    const next = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2027-01-01")),
    );
    expect(next.id).not.toBe(old.id);
    expect(next.lines).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }]);
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, old.id))).toEqual(old);
  });

  it("refuses two issue dates in one year even when their receipt years differ", async () => {
    await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2026-01-01", "2026-01-02")),
    );
    await expect(
      withTransaction(suite.db, (tx) => createPurchaseInvoice(tx, input("2026-12-31"))),
    ).rejects.toMatchObject({ code: "purchase.duplicate" });
  });

  it("lets an edit move a number to an unoccupied issue year", async () => {
    const first = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2026-01-01")),
    );
    const other = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, {
        ...input("2026-06-01"),
        header: { ...input("2026-06-01").header, supplierInvoiceNumber: "002" },
      }),
    );
    await withTransaction(suite.db, (tx) =>
      updatePurchaseInvoice(tx, other.id, {
        header: { supplierInvoiceNumber: "001", issuedOn: "2027-01-01" },
      }),
    );
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, other.id))).toEqual({
      ...other,
      supplierInvoiceNumber: "001",
      issuedOn: "2027-01-01",
    });
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, first.id))).toEqual(
      first,
    );
  });

  it("refuses an issue-year edit onto an occupied number and preserves both invoices and VAT lines", async () => {
    const first = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2026-12-31")),
    );
    const next = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2027-01-01")),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        updatePurchaseInvoice(tx, next.id, {
          header: { issuedOn: "2026-01-01" },
          lines: [{ rate: decimal("10.00"), base: decimal("200.00"), tax: decimal("20.00") }],
        }),
      ),
    ).rejects.toMatchObject({ code: "purchase.duplicate" });
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, next.id))).toEqual(next);
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, first.id))).toEqual(
      first,
    );
  });

  it("enforces the year boundary for direct database writes too", async () => {
    const first = await withTransaction(suite.db, (tx) =>
      createPurchaseInvoice(tx, input("2026-12-31")),
    );
    await suite.db.insert(purchaseInvoices).values({ ...input("2027-01-01").header, total: 12100 });
    await expect(
      withTransaction(suite.db, (tx) =>
        tx
          .update(purchaseInvoices)
          .set({ issuedOn: "2027-12-31" })
          .where(eq(purchaseInvoices.id, first.id)),
      ),
    ).rejects.toSatisfy(isUniqueViolation);
    expect(await withTransaction(suite.db, (tx) => getPurchaseInvoice(tx, first.id))).toEqual(
      first,
    );
  });
});
