// Side-effect only: keeps this host's `sale.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`config.ts` follow (a bare import, no value
// used here). See the note atop `errors.ts`.
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import { asAppUser, invoiceSeries, sales, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TillConfig } from "./till-config.js";

export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
}

/**
 * A walk-up sale as the counter till captures it: a basket of `{ productId, quantity }` and one cash
 * tender. Deliberately carries NO price of any kind — the server re-reads the catalogue and prices
 * authoritatively (`priceBasket`), so a browser cannot influence the filed total. `quantity` is a
 * count for an `each` product and a measured kg weight (e.g. "0.320") for a `weight` product.
 */
export interface TillSaleRequest {
  lines: { productId: string; quantity: string }[];
  tender: { method: "cash"; amount: string };
}

export interface TillSaleResult {
  /** `NumSerieFactura`-shaped "A/1", read back from the sale row + its series after filing. */
  invoiceNumber: string;
  /** The fiscal record's issuance instant, ISO-8601. */
  issuedAt: string;
  /** Taxable base + VAT, the authoritative figure the fiscal record carries. */
  total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  /** Cash to hand back: `tendered − total`, ≥ 0 (an under-tender is refused before this is read). */
  change: string;
  /** Where a customer can verify the record, or "" when the regime offers none. */
  qr: string;
}

/**
 * Ring one walk-up sale: re-read the catalogue, re-price with `priceBasket`, and file with
 * `recordSale`'s immediate cash settlement — all inside ONE `withTenant`/`asAppUser` transaction, so
 * the sale, its tenders, its settlement and its chained fiscal record commit as a single unit (or
 * roll back together). The server never trusts a browser-computed price; `req` carries none.
 *
 * `operatorId` is the person who rang the sale, for attribution — supplied by the session (Task 5);
 * a parameter here, `undefined` until the till wires it in.
 */
export async function recordTillSale(
  deps: TillSaleDeps,
  cfg: TillConfig,
  req: TillSaleRequest,
  operatorId?: string,
): Promise<TillSaleResult> {
  // Both refusals are made before any database work: an empty basket has nothing to price, and slice
  // 1 of the counter POS is cash-only. A `tender.method` narrowed to `"cash"` at the type level can
  // still arrive as anything at runtime (the till is a network boundary), so the guard is real.
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  if (req.tender.method !== "cash") {
    throw new AppError("sale.unsupported_tender", { method: req.tender.method });
  }

  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);

    const available = await listAvailableProducts(tx, cfg.locationId);
    const byId = new Map(available.map((p) => [p.id, p]));
    const items = req.lines.map((line) => {
      const product = byId.get(line.productId);
      if (product === undefined) {
        throw new AppError("sale.unknown_product", { productId: line.productId });
      }
      return { product, quantity: line.quantity };
    });

    const priced = priceBasket(items);

    // Cash may exceed the total (change is handed back); a tender BELOW the total is a shortfall.
    // `settleSale` (which `recordSale`'s immediate mode calls) demands EXACT coverage —
    // `sum(amount) = total` — so the tender it records settles the sale at the total, never at the
    // cash handed over: change is drawer cash, not a settled amount. When the cash falls short we
    // instead hand the raw amount straight through, so that single settlement implementation raises
    // `sale.tender_shortfall` itself — with the real `saleId` its param carries — rather than this
    // file duplicating the check before a sale id exists.
    const covered = compareDecimal(decimal(req.tender.amount), priced.total) >= 0;
    const settledAmount = covered ? priced.total : req.tender.amount;

    const { saleId, fiscal } = await recordSale(tx, deps.backend, {
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      nodeId: cfg.nodeId,
      seriesId: cfg.seriesId,
      // A walk-up counter sale (7a) carries NO parked working order, so `working_order_id` inserts
      // NULL — recordSale now WRITES this column and it is a real FK onto `working_orders` (7b), so a
      // fabricated id would FK-violate. Task 7's retrieve-and-file path supplies a REAL retrieved
      // working-order id here; until then this producer omits it, exactly like every other caller.
      locale: cfg.locale,
      invoiceLocales: cfg.invoiceLocales,
      total: priced.total,
      lines: priced.lines,
      vatBreakdown: priced.vatBreakdown,
      fiscalBackend: "verifactu",
      clock: deps.clock,
      operatorId,
      settlement: {
        kind: "immediate",
        tenders: [
          {
            method: "cash",
            amount: settledAmount,
            tipAmount: "0.00",
            settledAt: deps.clock.now().instant,
          },
        ],
      },
    });

    // Only reached once `recordSale` filed the sale — so the tender covered the total and this is ≥ 0.
    const change = subtractDecimal(decimal(req.tender.amount), priced.total);

    // `FiscalRecordRef` exposes no series code or invoice number (it is regime-opaque — see
    // `packages/fiscal/src/backend.ts`), so the human-facing "A/1" is read back from the sale row and
    // its series, in this same transaction. `recordSale` guarantees exactly one such row for
    // `saleId`, so the row is always present.
    const [issued] = await tx
      .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
      .from(sales)
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .where(eq(sales.id, saleId));

    return {
      invoiceNumber: formatInvoiceNumber(issued!.code, issued!.number),
      issuedAt: fiscal.issuedAt.toISOString(),
      total: priced.total,
      vatBreakdown: priced.vatBreakdown.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })),
      change,
      qr: fiscal.verificationUrl ?? "",
    };
  });
}
