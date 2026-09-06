// `seedSales` — the demo-seed's historical-sales step (Phase 2, Task 10). Back-fills the last N days
// with real, hash-chained, PREPRODUCTION sales so the reports screens (VAT summary, cash-up, daily
// close) are non-blank when the demo restaurant is first opened. There is no data to preserve and no
// production chain in play: this is dev/demo seeding.
//
// FISCAL POSTURE (binding). This module writes IMMUTABLE, append-only `registros_facturacion` rows,
// but it does so ONLY by calling `recordSale` — it never touches the fiscal core (the chain, the
// huella, invoice numbering) and must not. Two rules keep it safe:
//
//   1. It stamps `preproduction`. The single `VerifactuBackend` is built with BOTH `environment` and
//      `deploymentEnvironment` set to `deploymentEnvironment(process.env)`, which resolves to
//      `preproduction` when `WAITRON_ENV` is unset — the safe default (config.ts). A demo seed must
//      never be pointed at a production chain; a wrong `entorno` stamp is unrecoverable (CLAUDE.md §5).
//   2. It never drains. The generator only calls `recordSale`; the resulting `envios` rows stay
//      `pendiente`. Nothing here imports or invokes the AEAT submit/drain path.
//
// Backend construction mirrors `record-one-sale.ts` / `till-sale.test.ts` exactly — `resolveClient`
// is supplied but never reached (`recordSale` never contacts AEAT), so its stub throws if it ever is.
//
// The one departure from `record-one-sale.ts` is the CLOCK: a settable, back-dating clock whose
// `now()` returns whatever past instant the generator last `set`, so `recordSale` files each sale —
// its `sales.issued_at`, its fiscal record's timestamp and its tender's `settled_at` — into the past.
//
// Reproducibility: a small seeded LCG drives the per-day counts, the service-window placement and
// the product/tender choices, so the same `days` always produces the same shape of demo — and the
// test is stable.
//
// All arithmetic goes through `@waitron/shared`'s decimal helpers; no SQL is built here at all (every
// write is `recordSale`'s, parameterised by Drizzle).

import { recordSale } from "@waitron/core";
import type { RecordSaleInput, RecordSaleLine } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock, VatBreakdownLine } from "@waitron/fiscal";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { resolveVatRate, toInvoiceLineDescriptions } from "@waitron/catalogue";
import type { ResolvedOptionGroup, ResolvedOptionItem, VatClass } from "@waitron/catalogue";
import {
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
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { deploymentEnvironment } from "../../src/config.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

/** The venue a seed run files against — the ids `applyVenue` returns (with `seriesId` picked from
 *  its `seriesIds`, the standard series being first). */
export interface SeedSalesVenue {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
}

/** A sellable item the generator can draw a line from. `id` is carried for the caller's convenience
 *  (the Task 6 product map passes straight through) and for debugging, but is NOT written anywhere:
 *  `sales`/`sale_lines` carry no product FK and snapshot the description, price and rate instead. */
export interface SeedSalesProduct {
  id: string;
  /** BARE content locale -> text (e.g. `{ es: "Café" }`), as `listAvailableProducts` returns it.
   *  Re-keyed to the venue's full invoice tag before it lands on a line's `descriptions`. */
  descriptions: Record<string, string>;
  /** GROSS (VAT-inclusive) unit price — the same figure `products.unit_price` stores. */
  unitPrice: string;
  vatClass: VatClass;
  /** The product's attached ACTIVE option groups (ordering modifiers, Phase 4), exactly as
   *  `listAvailableProducts` resolves them — `[]`/absent for the common case of a product with none.
   *  When present, the generator resolves a selection (see {@link selectOptions}) and emits each
   *  selected item as a CHILD `RecordSaleLine` (`parentLineNo` naming the dish), so the demo's reports
   *  and receipt screens carry real modifier sub-lines drawn through this same `recordSale` path. */
  optionGroups?: ResolvedOptionGroup[];
}

/** A settable, back-dating clock. `clock` is what `recordSale` and `VerifactuBackend` read; `set`
 *  moves the instant it reports before each sale is recorded. */
export interface BackDatingClock {
  clock: TrustedClock;
  set: (instant: Date, offsetMinutes: number) => void;
}

export interface SeedSalesInput {
  venue: SeedSalesVenue;
  /** The venue's BARE content locale (e.g. `es`). The sale/line fiscal fields are filed under the
   *  FULL tag it maps to (`SEED_INVOICE_LOCALE`, e.g. `es-ES`) — content authored bare, filed full. */
  locale: SeedLocale;
  /** How many trailing days to fill. `0` writes nothing and returns `{ count: 0 }`. */
  days: number;
  /** The pool of items sales are drawn from — must be non-empty when `days > 0`. */
  products: readonly SeedSalesProduct[];
  /** Optional injected clock controller. The demo lets `seedSales` build its own; a caller that
   *  wants full control (or determinism beyond the seeded PRNG) can supply one. */
  clock?: BackDatingClock;
}

const HUNDRED = decimal("100");
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a settable, back-dating clock. `now()` reports the instant last handed to `set` as already
 * confident and anchored — the same one-shot shape `record-one-sale.ts`'s `systemClock` documents,
 * except the instant is settable rather than "right now". `anchor`/`currentAnchor` are never called
 * by `recordSale`, so they throw / return null.
 */
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

/**
 * A small deterministic LCG (Numerical Recipes constants) yielding `[0, 1)`. Seeded so the same
 * `days` produces the same demo and the test is stable — never `Math.random()`.
 */
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

/**
 * Resolve which option-group items a dish selects on one draw: every REQUIRED group always
 * contributes exactly one item — a real order can never leave one unsatisfied, so a demo sale ringing
 * a product that carries one must resolve it the same way the till would force — while each OPTIONAL
 * group only occasionally contributes anything (a coin-flip to skip it entirely, then 1..`maxSelect`
 * distinct items), so the demo's modifier sub-lines vary sale to sale rather than firing every time.
 * Driven by the same seeded LCG as the rest of the generator, so a given `days` always reproduces the
 * same demo. `[]` for a product with no attached groups — the common case, and the whole function is a
 * no-op then, matching this generator's line-for-line-identical-when-empty style elsewhere in the file.
 */
function selectOptions(
  rng: () => number,
  groups: readonly ResolvedOptionGroup[] | undefined,
): ResolvedOptionItem[] {
  if (groups === undefined || groups.length === 0) return [];
  const selected: ResolvedOptionItem[] = [];
  for (const group of groups) {
    const items = group.items;
    if (items.length === 0) continue;
    if (group.required) {
      selected.push(items[randInt(rng, 0, items.length - 1)]!);
      continue;
    }
    if (rng() < 0.5) continue; // optional group: skip it half the time
    const pickCount = Math.min(items.length, randInt(rng, 1, Math.max(1, group.maxSelect)));
    const pool = [...items];
    for (let i = 0; i < pickCount; i += 1) {
      const idx = randInt(rng, 0, pool.length - 1);
      selected.push(pool[idx]!);
      pool.splice(idx, 1);
    }
  }
  return selected;
}

/**
 * The VAT-exclusive base of a gross price: `base = gross ÷ (1 + rate/100)`, one rounded division at
 * money scale — the ruling's reversal, matching `@waitron/catalogue`'s own `baseFromGross` (which is
 * package-private, so it is restated here rather than deep-imported).
 */
function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  return divideDecimal(multiplyDecimal(gross, HUNDRED), addDecimal(HUNDRED, rate), MONEY_SCALE);
}

/**
 * Groups lines by rate and derives each group's tax with `percentOf` (the direct method, matching
 * `@waitron/core`'s `buildVatBreakdown` — not the catalogue's difference method). `buildVatBreakdown`
 * is not on core's public barrel, so the same grouping is restated here.
 */
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

/** The taxable total that reconciles with `breakdown`: Σ(base + tax) across rates — computed exactly
 *  the way `recordSale` re-checks a supplied `vatBreakdown` against `total`, so the check passes by
 *  construction (fail-loud only if this math ever drifts). */
function totalOf(breakdown: readonly VatBreakdownLine[]): Decimal {
  return sumDecimals(breakdown.flatMap((g) => [g.base, g.tax]));
}

/**
 * Back-fill the last `days` days of the given venue with reproducible, back-dated, preproduction
 * sales through the real `recordSale` path. Returns how many sales were recorded.
 *
 * Each sale is 1-4 lines, one product per line at quantity 1; the line's base is reversed out of the
 * product's gross price (ruling), the desglose is grouped per rate, and the sale's `total` and
 * `vatBreakdown` are handed to `recordSale` together so it asserts they reconcile (`sale.total_mismatch`
 * otherwise). One tender per sale (`cash`|`card`) covers the whole total; tips are always "0.00".
 */
export async function seedSales(
  db: Database,
  { venue, locale, days, products, clock }: SeedSalesInput,
): Promise<{ count: number }> {
  // Guard by deletion: nothing is built, constructed or written for a zero/negative horizon.
  if (days <= 0) {
    return { count: 0 };
  }
  if (products.length === 0) {
    throw new Error("seedSales: products must be non-empty when days > 0");
  }

  // Content is authored bare (`es`); a filed sale is fiscal, so its `locale`/`invoice_locales` and its
  // line `descriptions` are the FULL tag (`es-ES`) that bare content files under — the same re-key the
  // live sale path applies at `priceOrderLines`, here on the direct `recordSale` path the seed uses.
  const invoiceLocale = SEED_INVOICE_LOCALE[locale];

  const backDating = clock ?? backDatingClock();
  const backend = new VerifactuBackend({
    clock: backDating.clock,
    db,
    // Both fields resolve to `preproduction` when WAITRON_ENV is unset (config.ts's one irreversible
    // default). `environment` picks the QR validation host (never contacted here); `deploymentEnvironment`
    // is stamped onto `entorno` (never hashed). See this file's header.
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    // Never reached — `recordSale` does not contact AEAT (that is `drain`'s job, which this seed never
    // runs). A rejection here would surface a bug, not a real submission.
    resolveClient: () =>
      Promise.reject(new Error("seed-sales: resolveClient must never be called by recordSale")),
  });

  const tenantId = brandTenantId(venue.tenantId);
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

    // Weekends busier; a lunch and a dinner peak. Minimum is comfortably positive so every day —
    // including yesterday, which the test reports on — is populated.
    const perDay = (weekend ? 16 : 9) + randInt(rng, 0, 8);

    for (let s = 0; s < perDay; s += 1) {
      // Service windows in UTC: lunch 11:00-13:59 (Madrid 13:00-15:59), dinner 18:00-20:59 (Madrid
      // 20:00-22:59) — both comfortably inside one Madrid business day. Dinner is the busier service.
      const dinner = rng() < 0.55;
      const hour = dinner ? randInt(rng, 18, 20) : randInt(rng, 11, 13);
      const instant = new Date(
        Date.UTC(year, month, date, hour, randInt(rng, 0, 59), randInt(rng, 0, 59)),
      );
      // Keep every sale strictly in the past: today's later slots may fall after `now`, so skip them
      // rather than file a future sale.
      if (instant.getTime() >= now) {
        continue;
      }

      // `lineCount` is the number of DISHES (1-4 per sale); a dish carrying selected modifiers expands
      // to a parent line plus one child line per selected option, so `lineNo` tracks `lines.length`
      // (the actual row count) rather than the dish loop index `l`.
      const lineCount = randInt(rng, 1, 4);
      const lines: RecordSaleLine[] = [];
      for (let l = 0; l < lineCount; l += 1) {
        const product = products[randInt(rng, 0, products.length - 1)]!;
        const gross = toScale(decimal(product.unitPrice), MONEY_SCALE);
        const rate = resolveVatRate(product.vatClass);
        const base = baseFromGross(gross, rate);
        const parentLineNo = lines.length + 1;
        lines.push({
          lineNo: parentLineNo,
          descriptions: toInvoiceLineDescriptions(product.descriptions, [invoiceLocale]),
          quantity: "1",
          unitPrice: base,
          vatRate: rate,
          lineTotal: base,
        });

        // Modifier sub-lines (Phase 4): each selected option becomes its own child row, priced by the
        // SAME `baseFromGross` this file already uses for the parent — quantity always "1" here, so
        // the option's gross delta reverses to its net base exactly like a top-level line does.
        for (const option of selectOptions(rng, product.optionGroups)) {
          const optionGross = toScale(decimal(option.priceDelta), MONEY_SCALE);
          const optionRate = option.vatClass === null ? rate : resolveVatRate(option.vatClass);
          const optionBase = baseFromGross(optionGross, optionRate);
          lines.push({
            lineNo: lines.length + 1,
            descriptions: toInvoiceLineDescriptions(option.name, [invoiceLocale]),
            quantity: "1",
            unitPrice: optionBase,
            vatRate: optionRate,
            lineTotal: optionBase,
            parentLineNo,
          });
        }
      }

      const vatBreakdown = breakdownOf(lines);
      const total = totalOf(vatBreakdown);
      const method = rng() < 0.6 ? "cash" : "card";

      backDating.set(instant, -instant.getTimezoneOffset());

      const input: RecordSaleInput = {
        tenantId,
        tillId,
        nodeId,
        seriesId,
        locale: invoiceLocale,
        invoiceLocales: [invoiceLocale],
        total,
        lines,
        // Supplied verbatim AND derived from the same lines, so `recordSale`'s reconciliation check
        // passes by construction — a fail-loud defence for an unrepairable record, never a fudge.
        vatBreakdown,
        settlement: {
          kind: "immediate",
          tenders: [{ method, amount: total, tipAmount: "0.00", settledAt: instant }],
        },
        clock: backDating.clock,
      };

      await withTenant(db, tenantId, (tx) => recordSale(tx, backend, input));
      count += 1;
    }
  }

  return { count };
}
