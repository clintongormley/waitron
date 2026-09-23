import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { purchaseInvoiceVat, purchaseInvoices, withTransaction } from "@waitron/db";
import { usePurchasingDb } from "../test/fixtures.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { hasCode, isAppError } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  updatePurchaseInvoice,
} from "./operations.js";
import type { CreatePurchaseInvoiceInput, PurchaseRegime } from "./types.js";

// A real SQLite venue database in a temporary directory, opened by the product's own opener
// (`packages/db/src/testing/venue-db.ts`) — not an in-memory one, so a suite gets the storage a box
// gets. There are no roles on this engine, and what these cases cover is the CRUD and validation
// logic.
const fx = usePurchasingDb();

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
  beforeEach(async () => {
    await seedTenant(fx.db);
  });

  async function asApp<T>(fn: Parameters<typeof withTransaction<T>>[1]): Promise<T> {
    return withTransaction(fx.db, async (tx) => {
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

  it("orders same-rate lines identically to the DB read-back (RETURNING sort ⇔ selectLines)", async () => {
    // Three lines at the SAME rate exercise the id tie-break in create's RETURNING sort. `created` is
    // built from RETURNING and sorted in JS; `fetched` is read back via selectLines' `orderBy(asc(rate),
    // asc(id))`. They must be line-for-line identical — which is what says the JS id compare
    // reproduces the order the database returns, the ordering the old insert-then-re-read gave.
    const { created, fetched } = await asApp(async (tx) => {
      const created = await createPurchaseInvoice(tx, {
        header: { ...baseInput().header, supplierInvoiceNumber: "SAME-RATE" },
        lines: [
          { rate: d("21.00"), base: d("200.00"), tax: d("42.00") },
          { rate: d("21.00"), base: d("10.00"), tax: d("2.10"), kind: "capital" },
          { rate: d("21.00"), base: d("30.00"), tax: d("6.30") },
        ],
      });
      return { created, fetched: await getPurchaseInvoice(tx, created.id) };
    });
    expect(created.lines).toHaveLength(3);
    expect(created.lines.map((l) => l.rate)).toEqual(["21.00", "21.00", "21.00"]);
    expect(fetched).toEqual(created);
  });

  it("stores the supplier's filed tax verbatim, not a recomputed base×rate", async () => {
    // A difference-method supplier VAT amount: 20.99, not round(100 × 21%) = 21.00. We file what they
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

  it("stores a money amount as a count of whole cents", async () => {
    // Reading the columns raw, because every assertion that goes through a purchasing function
    // round-trips both conversions and so passes whatever the units are. `rate` is read here too,
    // as the whole number it now is; what it stores is basis points rather than cents, which this
    // row cannot show — see the case below for what that distinction does and does not pin.
    const rows = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, baseInput());
      const [header] = await tx
        .select({ total: purchaseInvoices.total })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, c.id));
      const lines = await tx
        .select({
          rate: purchaseInvoiceVat.rate,
          base: purchaseInvoiceVat.base,
          tax: purchaseInvoiceVat.tax,
        })
        .from(purchaseInvoiceVat)
        .where(eq(purchaseInvoiceVat.purchaseInvoiceId, c.id));
      return { header, lines };
    });
    expect(rows.header).toEqual({ total: 24200 });
    expect(rows.lines).toEqual([{ rate: 2100, base: 20000, tax: 4200 }]);
  });

  it("reads a rate and the deductible proportion back as the exact decimal", async () => {
    // The round trip both rate columns take: a domain decimal in, the same decimal out, through
    // whatever the column holds. 10.50 is here because a rate that is not a whole percent is the
    // case a conversion built for whole percents would lose; 50.00 is a proportion the column's own
    // default, a full 100%, cannot stand in for.
    const { created, fetched } = await asApp(async (tx) => {
      const created = await createPurchaseInvoice(tx, {
        header: { ...baseInput().header, deductibleProportion: d("50.00") },
        lines: [
          { rate: d("21.00"), base: d("200.00"), tax: d("42.00") },
          { rate: d("10.50"), base: d("100.00"), tax: d("10.50"), kind: "capital" },
        ],
      });
      return { created, fetched: await getPurchaseInvoice(tx, created.id) };
    });
    // `created` comes from the INSERT's RETURNING, `fetched` from a re-read: two different crossings.
    expect(created.deductibleProportion).toBe("50.00");
    expect(created.lines.map((l) => l.rate)).toEqual(["10.50", "21.00"]);
    expect(fetched?.deductibleProportion).toBe("50.00");
    expect(fetched?.lines.map((l) => l.rate)).toEqual(["10.50", "21.00"]);
  });

  it("stores a rate and the deductible proportion as a count of whole basis points", async () => {
    // Raw column reads, for the reason the money case above gives: an assertion that goes through a
    // purchasing function round-trips both conversions and so passes whatever the units are.
    //
    // What these two numbers pin is that the column holds a whole count at two decimal places, so
    // 10.50 survives where a whole-percent column would round it away. What they do NOT pin is
    // WHICH conversion produced the count: a rate and an amount share the scale, so the two agree on
    // every value below 1000.00 and part only in what they refuse above it. Checked by substitution
    // — writing both rate columns with `decimalToCents` instead leaves every case in this file
    // passing — and nothing this package admits reaches the value where they part, because
    // `validateLines` and `validateProportion` refuse anything above 100 before the insert.
    const rows = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, {
        header: { ...baseInput().header, deductibleProportion: d("50.00") },
        lines: [{ rate: d("10.50"), base: d("100.00"), tax: d("10.50") }],
      });
      const [header] = await tx
        .select({ deductibleProportion: purchaseInvoices.deductibleProportion })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, c.id));
      const lines = await tx
        .select({ rate: purchaseInvoiceVat.rate })
        .from(purchaseInvoiceVat)
        .where(eq(purchaseInvoiceVat.purchaseInvoiceId, c.id));
      return { header, lines };
    });
    expect(rows.header).toEqual({ deductibleProportion: 5000 });
    expect(rows.lines).toEqual([{ rate: 1050 }]);
  });

  it("reads an unscaled rate literal back at two places", async () => {
    // The claim `insertLines` makes, checked rather than asserted: "21" in, "21.00" out. It is the
    // basis-point conversion that does this now — a rate column is an integer and has no scale of
    // its own — and `created` comes from the INSERT's RETURNING, so nothing re-read it either.
    const created = await asApp((tx) =>
      createPurchaseInvoice(tx, {
        header: { ...baseInput().header, deductibleProportion: d("50") },
        lines: [{ rate: d("21"), base: d("200.00"), tax: d("42.00") }],
      }),
    );
    expect(created.lines[0]?.rate).toBe("21.00");
    expect(created.deductibleProportion).toBe("50.00");
  });

  it("updates header fields without touching the lines", async () => {
    const after = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, baseInput());
      await updatePurchaseInvoice(tx, c.id, {
        header: {
          supplierName: "Renombrado SL",
          total: d("300.50"),
          deductibleProportion: d("50.00"),
          note: "prorrata",
        },
      });
      return getPurchaseInvoice(tx, c.id);
    });
    expect(after?.supplierName).toBe("Renombrado SL");
    // `total` is the patch's one money field and takes the update path's own conversion, separate
    // from create's.
    expect(after?.total).toBe("300.50");
    expect(after?.deductibleProportion).toBe("50.00");
    expect(after?.note).toBe("prorrata");
    expect(after?.lines).toHaveLength(1); // untouched
  });

  it("leaves the stored total and proportion alone when the patch omits them", async () => {
    const after = await asApp(async (tx) => {
      const c = await createPurchaseInvoice(tx, {
        ...baseInput(),
        header: { ...baseInput().header, total: d("300.50"), deductibleProportion: d("50.00") },
      });
      await updatePurchaseInvoice(tx, c.id, { header: { note: "solo la nota" } });
      return getPurchaseInvoice(tx, c.id);
    });
    expect(after?.note).toBe("solo la nota");
    expect(after?.total).toBe("300.50");
    expect(after?.deductibleProportion).toBe("50.00");
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
    // The rethrow branch of create's duplicate translation: a database refusal that is not a
    // duplicate must surface as itself, never as a spurious purchase.duplicate. The refusal used
    // here is a `regime` outside the column's vocabulary, which `createPurchaseInvoice` does not
    // validate — only the proportion and the lines are checked before the header insert — so it
    // reaches the database and comes back as a driver error rather than an AppError.
    //
    // It has been two other refusals before this one, and each was retired when the column stopped
    // refusing: an overflow on `total`, then an out-of-range date (`2026-02-30`). A day is text on
    // this engine and an amount is a 64-bit integer, so neither refuses anything the rest of the
    // system admits. What refuses here is the `purchase_invoices_regime_ck` CHECK, which the schema
    // carries because the engine has no enum type of its own
    // (`packages/db/src/schema/purchase-invoices.ts`). Measured, this insert alone against a
    // migrated file: `CHECK constraint failed: purchase_invoices_regime_ck`, extended result code
    // 275 — with the same row under a legal `regime` inserting as the control, so the refusal is
    // that one value's and not the row's shape.
    //
    // Caught OUTSIDE the transaction, so what is captured is the error `withTransaction` propagates
    // rather than one read mid-flight.
    const error = await captureThrown(() =>
      asApp((tx) =>
        createPurchaseInvoice(tx, {
          header: { ...baseInput().header, regime: "wombat" as PurchaseRegime },
          lines: baseInput().lines,
        }),
      ),
    );
    expect(isAppError(error)).toBe(false);
  });

  it("maps a duplicate supplier invoice to purchase.duplicate", async () => {
    // Two transactions, not one, and the refusal is caught outside the second: the duplicate is
    // refused by the database, and the capture belongs where the case above puts it.
    await asApp((tx) => createPurchaseInvoice(tx, baseInput()));
    const error = await captureAppError(() =>
      asApp((tx) => createPurchaseInvoice(tx, baseInput())),
    );
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
