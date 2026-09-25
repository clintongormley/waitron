// Back-fills the last N days with hash-chained sales through `recordSale`, so the report screens
// are non-blank when the demo is first opened. It writes fiscal records ONLY through `recordSale`
// and never drains: the resulting `envios` rows stay pending.
//
// The `entorno` stamp comes from `deploymentEnvironment(process.env)`, which is `preproduction`
// when `WAITRON_ENV` is unset; `demoSeedEnvironment` refuses `production` before any write, because
// a wrong stamp on a production chain is unrecoverable (CLAUDE.md §5).
//
// A settable clock files each sale — its `issued_at` and its fiscal record's timestamp — into
// the past.

import { recordSale } from "@waitron/core";
import type { RecordSaleInput, RecordSaleLine } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock, VatBreakdownLine } from "@waitron/fiscal";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  customerPresentationText,
  resolveVatRate,
  toInvoiceLineDescriptions,
} from "@waitron/catalogue";
import type { VatClass } from "@waitron/catalogue";
import {
  AppError,
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  percentOf,
  sumDecimals,
  toScale,
  MONEY_SCALE,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { deploymentEnvironment } from "../../src/config.js";
import type { DeploymentEnvironment } from "../../src/config.js";
import "../../src/errors.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

/** `seriesId` is the standard series, the first of `applyVenue`'s `seriesIds`. */
export interface SeedSalesVenue {
  tillId: string;
  nodeId: string;
  seriesId: string;
}

/** `id` is NOT written anywhere: `sales`/`sale_lines` carry no product FK and snapshot the
 *  description, price and rate instead. */
export interface SeedSalesProduct {
  id: string;
  name: string;
  /** `null` or all blank falls back to `name`. */
  customerName: Record<string, string> | null;
  /** GROSS (VAT-inclusive). */
  unitPrice: string;
  vatClass: VatClass;
}

export interface BackDatingClock {
  clock: TrustedClock;
  set: (instant: Date, offsetMinutes: number) => void;
}

export interface SeedSalesInput {
  venue: SeedSalesVenue;
  locale: SeedLocale;
  /** How many trailing days to fill. `0` writes nothing and returns `{ count: 0 }`. */
  days: number;
  /** The pool of items sales are drawn from — must be non-empty when `days > 0`. */
  products: readonly SeedSalesProduct[];
  clock?: BackDatingClock;
}

const HUNDRED = decimal("100");
const DAY_MS = 24 * 60 * 60 * 1000;

/** `anchor`/`currentAnchor` are never called by `recordSale`, so they throw / return null. */
function backDatingClock(): BackDatingClock {
  let instant = new Date();
  let offsetMinutes = -instant.getTimezoneOffset();
  const clock: TrustedClock = {
    now: () => ({
      instant,
      offsetMinutes,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("seed-sales: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
  return {
    clock,
    set: (i, o) => {
      instant = i;
      offsetMinutes = o;
    },
  };
}

/** A deterministic LCG yielding `[0, 1)`, never `Math.random()`, so the demo's shape is
 *  reproducible. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** Inclusive integer in `[min, max]`. */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Restates `@waitron/catalogue`'s package-private `baseFromGross`. */
function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  return divideDecimal(multiplyDecimal(gross, HUNDRED), addDecimal(HUNDRED, rate), MONEY_SCALE);
}

/** Restates `@waitron/core`'s `buildVatBreakdown`, which is not on core's public barrel. */
function breakdownOf(lines: readonly RecordSaleLine[]): VatBreakdownLine[] {
  const bases = new Map<Decimal, Decimal>();
  for (const line of lines) {
    const rate = decimal(line.vatRate);
    const base = decimal(line.lineTotal);
    const existing = bases.get(rate);
    bases.set(rate, existing === undefined ? base : addDecimal(existing, base));
  }
  return [...bases.entries()].map(([rate, base]) => ({ rate, base, tax: percentOf(base, rate) }));
}

function totalOf(breakdown: readonly VatBreakdownLine[]): Decimal {
  return sumDecimals(breakdown.flatMap((g) => [g.base, g.tax]));
}

/** The environment demo data may be written under. Production is refused before any write. */
export function demoSeedEnvironment(env: NodeJS.ProcessEnv): DeploymentEnvironment {
  const environment = deploymentEnvironment(env);
  if (environment === "production") {
    throw new AppError("deployment.demo_data_refused", { environment });
  }
  return environment;
}

/** Returns how many sales were recorded. */
export async function seedSales(
  db: Database,
  { venue, locale, days, products, clock }: SeedSalesInput,
): Promise<{ count: number }> {
  const environment = demoSeedEnvironment(process.env);
  if (days <= 0) {
    return { count: 0 };
  }
  if (products.length === 0) {
    throw new Error("seedSales: products must be non-empty when days > 0");
  }

  // A filed sale takes the FULL tag (`es-ES`), not the bare content locale.
  const invoiceLocale = SEED_INVOICE_LOCALE[locale];

  const backDating = clock ?? backDatingClock();
  const backend = new VerifactuBackend({
    clock: backDating.clock,
    db,
    environment,
    deploymentEnvironment: environment,
    // Never reached: `recordSale` does not contact AEAT.
    resolveClient: () =>
      Promise.reject(new Error("seed-sales: resolveClient must never be called by recordSale")),
  });

  const tillId = brandTillId(venue.tillId);
  const nodeId = brandNodeId(venue.nodeId);
  const seriesId = brandSeriesId(venue.seriesId);

  const rng = makeLcg(0x9e3779b9);
  const now = Date.now();
  let count = 0;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    // The calendar date `dayIndex` days ago (UTC). Sales are placed at UTC hours safely inside the
    // Madrid business day (after the 05:00 cutover, before the next), so the civil date the reports
    // bucket on equals this UTC date.
    const dayDate = new Date(now - dayIndex * DAY_MS);
    const year = dayDate.getUTCFullYear();
    const month = dayDate.getUTCMonth();
    const date = dayDate.getUTCDate();
    const dow = dayDate.getUTCDay();
    const weekend = dow === 0 || dow === 6;

    // The minimum is positive so every day, including yesterday, which the test reports on, is
    // populated.
    const perDay = (weekend ? 16 : 9) + randInt(rng, 0, 8);

    for (let s = 0; s < perDay; s += 1) {
      // Service windows in UTC: lunch 11:00-13:59, dinner 18:00-20:59, both inside one Madrid
      // business day.
      const dinner = rng() < 0.55;
      const hour = dinner ? randInt(rng, 18, 20) : randInt(rng, 11, 13);
      const instant = new Date(
        Date.UTC(year, month, date, hour, randInt(rng, 0, 59), randInt(rng, 0, 59)),
      );
      // Today's later slots may fall after `now`; never file a future sale.
      if (instant.getTime() >= now) {
        continue;
      }

      // `lineNo` tracks `lines.length` rather than the loop index, because `RecordSaleLine` allows
      // a dish to expand into more than one row.
      const lineCount = randInt(rng, 1, 4);
      const lines: RecordSaleLine[] = [];
      for (let l = 0; l < lineCount; l += 1) {
        const product = products[randInt(rng, 0, products.length - 1)]!;
        const gross = toScale(decimal(product.unitPrice), MONEY_SCALE);
        const rate = resolveVatRate(product.vatClass);
        const base = baseFromGross(gross, rate);
        lines.push({
          lineNo: lines.length + 1,
          name: product.name,
          descriptions: toInvoiceLineDescriptions(
            customerPresentationText(
              {
                name: product.name,
                customerName: product.customerName,
                kitchenName: null,
                variantName: null,
                variantCustomerName: null,
                variantKitchenName: null,
              },
              invoiceLocale,
            ).product,
            [invoiceLocale],
            invoiceLocale,
          ),
          quantity: "1",
          unitPrice: base,
          vatRate: rate,
          lineTotal: base,
        });
      }

      const vatBreakdown = breakdownOf(lines);
      const total = totalOf(vatBreakdown);
      const method = rng() < 0.6 ? "cash" : "card";

      backDating.set(instant, -instant.getTimezoneOffset());

      const input: RecordSaleInput = {
        tillId,
        nodeId,
        seriesId,
        locale: invoiceLocale,
        invoiceLocales: [invoiceLocale],
        total,
        lines,
        // Derived from the same lines as `total`, so `recordSale`'s reconciliation check passes.
        vatBreakdown,
        settlement: {
          kind: "immediate",
          tenders: [{ method, amount: total, tipAmount: "0.00", settledAt: instant }],
        },
        clock: backDating.clock,
      };

      await withTransaction(db, (tx) => recordSale(tx, backend, input));
      count += 1;
    }
  }

  return { count };
}
