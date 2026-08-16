import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { hasCode, isAppError } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  updatePurchaseInvoice,
} from "./operations.js";
import type { CreatePurchaseInvoiceInput } from "./types.js";

// PGlite (a WASM PostgreSQL): hermetic and fast, and the RIGHT target for the pure CRUD/validation
// logic here — nothing in these tests depends on running under the non-superuser deployment role or
// on concurrency, which is what would force real Postgres (CLAUDE.md §4). The tenant-isolation policy
// and the app_user grants are proven on real Postgres in purchase-invoices.rls.test.ts instead.
const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

const d = (s: string): Decimal => s as Decimal;

function baseInput(): CreatePurchaseInvoiceInput {
  return {
    header: {
      supplierTaxId: "B12345678",
      supplierName: "Proveedor SL",
      supplierInvoiceNumber: "F-2026/001",
      issuedOn: "2026-08-03",
      receivedOn: "2026-08-05",
      total: d("242.00"),
    },
    lines: [{ rate: d("21.00"), base: d("200.00"), tax: d("42.00") }],
  };
}

describe("purchase-invoice operations", () => {
  let tenantId: TenantId;
  beforeEach(async () => {
    tenantId = await seedTenant(fx.db);
  });

  async function asApp<T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> {
    return withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  it("creates an invoice with lines and reads it back", async () => {
    const { created, fetched } = await asApp(async (tx) => {
      const created = await createPurchaseInvoice(tx, {
        header: {
          supplierTaxId: "B12345678",
          supplierName: "Proveedor SL",
          supplierInvoiceNumber: "F-2026/001",
          issuedOn: "2026-08-03",
          receivedOn: "2026-08-05",
          total: d("284.00"),
          note: "café y leche",
        },
        lines: [
          { rate: d("21.00"), base: d("200.00"), tax: d("42.00") },
          { rate: d("10.00"), base: d("40.00"), tax: d("4.00"), kind: "capital" },
        ],
      });
      return { created, fetched: await getPurchaseInvoice(tx, created.id) };
    });

    expect(created.supplierName).toBe("Proveedor SL");
    expect(created.regime).toBe("general"); // default
    expect(created.deductibleProportion).toBe("100.00"); // default
    expect(created.note).toBe("café y leche");
    expect(created.lines).toHaveLength(2);
    // Lines come back in a stable order (rate asc): the 10% capital-goods line first, then the 21%.
    expect(created.lines.map((l) => l.rate)).toEqual(["10.00", "21.00"]);
    expect(created.lines.map((l) => l.kind)).toEqual(["capital", "ordinary"]);
    // Read-back equals what create returned.
    expect(fetched).toEqual(created);
  });

  it("stores the supplier's filed tax verbatim, not a recomputed base×rate", async () => {
    // A difference-method supplier cuota: 20.99, not round(100 × 21%) = 21.00. We file what they
    // charged (the exactness rule the sales/output side follows).
    const fetched = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, {
        header: {
          supplierTaxId: "B99999999",
          supplierName: "Otro SL",
          supplierInvoiceNumber: "X1",
          issuedOn: "2026-08-01",
          receivedOn: "2026-08-01",
          total: d("120.99"),
        },
        lines: [{ rate: d("21.00"), base: d("100.00"), tax: d("20.99") }],
      });
      return getPurchaseInvoice(tx, c.id);
    });
    expect(fetched?.lines[0]?.tax).toBe("20.99");
  });

  it("lists invoices, optionally filtered by received_on", async () => {
    await asApp(async (tx) => {
      await createPurchaseInvoice(tx, {
        header: { ...baseInput().header, supplierInvoiceNumber: "JUL", receivedOn: "2026-07-31" },
        lines: baseInput().lines,
      });
      await createPurchaseInvoice(tx, {
        header: { ...baseInput().header, supplierInvoiceNumber: "AUG", receivedOn: "2026-08-15" },
        lines: baseInput().lines,
      });
    });
    const { all, augustOnly } = await asApp(async (tx) => ({
      all: await listPurchaseInvoices(tx),
      augustOnly: await listPurchaseInvoices(tx, { from: "2026-08-01", to: "2026-09-01" }),
    }));
    expect(all.map((i) => i.supplierInvoiceNumber).sort()).toEqual(["AUG", "JUL"]);
    expect(augustOnly.map((i) => i.supplierInvoiceNumber)).toEqual(["AUG"]);
    // The listed invoices carry their lines too.
    expect(augustOnly[0]?.lines).toHaveLength(1);
  });

  it("updates header fields without touching the lines", async () => {
    const after = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, baseInput());
      await updatePurchaseInvoice(tx, c.id, {
        header: {
          supplierName: "Renombrado SL",
          deductibleProportion: d("50.00"),
          note: "prorrata",
        },
      });
      return getPurchaseInvoice(tx, c.id);
    });
    expect(after?.supplierName).toBe("Renombrado SL");
    expect(after?.deductibleProportion).toBe("50.00");
    expect(after?.note).toBe("prorrata");
    expect(after?.lines).toHaveLength(1); // untouched
  });

  it("replaces the VAT lines when the update supplies them (fix a mis-keyed rate)", async () => {
    const after = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, baseInput());
      await updatePurchaseInvoice(tx, c.id, {
        lines: [
          { rate: d("10.00"), base: d("200.00"), tax: d("20.00") },
          { rate: d("21.00"), base: d("10.00"), tax: d("2.10"), kind: "capital" },
        ],
      });
      return getPurchaseInvoice(tx, c.id);
    });
    expect(after?.lines).toHaveLength(2);
    expect(after?.lines.map((l) => l.rate)).toEqual(["10.00", "21.00"]);
  });

  it("deletes an invoice and cascades to its VAT lines", async () => {
    const gone = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, baseInput());
      await deletePurchaseInvoice(tx, c.id);
      return getPurchaseInvoice(tx, c.id);
    });
    expect(gone).toBeNull();
  });

  it("returns an empty list when the tenant has no invoices", async () => {
    expect(await asApp((tx) => listPurchaseInvoices(tx))).toEqual([]);
  });

  it("returns null from getPurchaseInvoice for an unknown id", async () => {
    const fetched = await asApp((tx) =>
      getPurchaseInvoice(tx, "00000000-0000-0000-0000-000000000000"),
    );
    expect(fetched).toBeNull();
  });

  it("throws purchase.not_found updating or deleting an unknown id", async () => {
    const unknown = "00000000-0000-0000-0000-000000000000";
    const onUpdate = await asApp((tx) =>
      captureAppError(() => updatePurchaseInvoice(tx, unknown, { header: { note: "x" } })),
    );
    expect(hasCode(onUpdate, "purchase.not_found") && onUpdate.params.id).toBe(unknown);
    const onDelete = await asApp((tx) => captureAppError(() => deletePurchaseInvoice(tx, unknown)));
    expect(hasCode(onDelete, "purchase.not_found")).toBe(true);
  });

  it("rejects an invoice with no VAT lines (purchase.invalid: no_lines)", async () => {
    const error = await asApp((tx) =>
      captureAppError(() => createPurchaseInvoice(tx, { header: baseInput().header, lines: [] })),
    );
    expect(hasCode(error, "purchase.invalid") && error.params.reason).toBe("no_lines");
  });

  it("rejects a negative base, a negative tax, and an out-of-range rate", async () => {
    const negBase = await asApp((tx) =>
      captureAppError(() =>
        createPurchaseInvoice(tx, {
          header: baseInput().header,
          lines: [{ rate: d("21.00"), base: d("-1.00"), tax: d("0.00") }],
        }),
      ),
    );
    expect(hasCode(negBase, "purchase.invalid") && negBase.params.reason).toBe("negative_base");

    const negTax = await asApp((tx) =>
      captureAppError(() =>
        createPurchaseInvoice(tx, {
          header: baseInput().header,
          lines: [{ rate: d("21.00"), base: d("1.00"), tax: d("-0.01") }],
        }),
      ),
    );
    expect(hasCode(negTax, "purchase.invalid") && negTax.params.reason).toBe("negative_tax");

    const badRate = await asApp((tx) =>
      captureAppError(() =>
        createPurchaseInvoice(tx, {
          header: baseInput().header,
          lines: [{ rate: d("101.00"), base: d("1.00"), tax: d("0.00") }],
        }),
      ),
    );
    expect(hasCode(badRate, "purchase.invalid") && badRate.params.reason).toBe("rate_out_of_range");
  });

  it("rejects a deductible_proportion outside 0..100 (purchase.invalid)", async () => {
    const error = await asApp((tx) =>
      captureAppError(() =>
        createPurchaseInvoice(tx, {
          header: { ...baseInput().header, deductibleProportion: d("150.00") },
          lines: baseInput().lines,
        }),
      ),
    );
    expect(hasCode(error, "purchase.invalid") && error.params.reason).toBe(
      "proportion_out_of_range",
    );
  });

  it("propagates a non-unique DB error from the header insert (not swallowed as a duplicate)", async () => {
    // The rethrow branch of create's 23505 translation: a numeric overflow on `total` (> 12 integer
    // digits for numeric(12,2)) is a 22003, not a 23505, so it must surface as itself, never as a
    // spurious purchase.duplicate. Lines are valid, so validation passes and the header insert is
    // reached.
    const error = await asApp((tx) =>
      captureThrown(() =>
        createPurchaseInvoice(tx, {
          header: { ...baseInput().header, total: d("1000000000000.00") },
          lines: baseInput().lines,
        }),
      ),
    );
    expect(isAppError(error)).toBe(false);
  });

  it("maps a duplicate supplier invoice to purchase.duplicate", async () => {
    const error = await asApp(async (tx) => {
      await createPurchaseInvoice(tx, baseInput());
      return captureAppError(() => createPurchaseInvoice(tx, baseInput()));
    });
    expect(hasCode(error, "purchase.duplicate") && error.params.supplierInvoiceNumber).toBe(
      "F-2026/001",
    );
  });
});

/** Runs `fn`, returning the AppError it throws — failing loudly if it does not throw one. */
async function captureAppError(
  fn: () => Promise<unknown>,
): Promise<import("@waitron/shared").AppError> {
  const error = await captureThrown(fn);
  if (isAppError(error)) return error;
  throw error instanceof Error ? error : new Error("expected an AppError to be thrown");
}

/** Runs `fn`, returning whatever it threw — failing loudly if it did not throw. */
async function captureThrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}
