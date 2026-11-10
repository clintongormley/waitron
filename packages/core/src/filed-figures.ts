import type { Transaction } from "@waitron/db";
import type { FiscalBackend, FiledVersionFigures } from "@waitron/fiscal";
import { decimal, decimalToBasisPoints, decimalToCents, type SaleId } from "@waitron/shared";

type Split = readonly { rate: string; base: string; tax: string }[];

export interface StoredSaleFigures {
  id: string;
  /** Cents. */
  total: number;
  vatBreakdown: Split;
}

export interface MeasuredSale {
  id: string;
  /** The newest answered version's figures, else the stored ones; the total in cents. */
  measured: { total: number; vatBreakdown: Split };
  /** The newest filed version is not the measured one: a fix still waits for its answer. */
  differs: boolean;
}

/**
 * Each sale's figures as the regime holds them. Unreadable when the backend reads no filed figures,
 * or none or unreadable ones for any sale. `moved` when any measured figures differ from the stored
 * ones; `measuredRemaining` is the sum of every measured total, in cents.
 */
export async function measuredFigures(
  tx: Transaction,
  backend: FiscalBackend,
  stored: readonly StoredSaleFigures[],
): Promise<
  | { readable: false }
  | { readable: true; sales: MeasuredSale[]; moved: boolean; measuredRemaining: number }
> {
  if (!backend.filedFiguresFor) return { readable: false };
  const filed = await backend.filedFiguresFor(
    tx,
    stored.map((sale) => sale.id as SaleId),
  );
  const sales: MeasuredSale[] = [];
  for (const sale of stored) {
    const figures = filed.get(sale.id as SaleId);
    if (figures === undefined || !figures.readable) return { readable: false };
    const measured =
      figures.newestAnswered === null
        ? { total: sale.total, vatBreakdown: sale.vatBreakdown }
        : atCents(figures.newestAnswered);
    sales.push({ id: sale.id, measured, differs: !sameFigures(atCents(figures.newest), measured) });
  }
  return {
    readable: true,
    sales,
    moved: sales.some((sale, index) => !sameFigures(sale.measured, stored[index]!)),
    measuredRemaining: sales.reduce((sum, sale) => sum + sale.measured.total, 0),
  };
}

/** The same total, and at each rate the same base and VAT, to the cent. */
export function sameFigures(
  a: { total: number; vatBreakdown: Split },
  b: { total: number; vatBreakdown: Split },
): boolean {
  const splitOf = (split: Split) =>
    new Map(
      split.map((line) => [
        decimalToBasisPoints(decimal(line.rate)),
        [decimalToCents(decimal(line.base)), decimalToCents(decimal(line.tax))].join(),
      ]),
    );
  const left = splitOf(a.vatBreakdown);
  const right = splitOf(b.vatBreakdown);
  return (
    a.total === b.total &&
    left.size === right.size &&
    [...left].every(([rate, amounts]) => right.get(rate) === amounts)
  );
}

function atCents(version: FiledVersionFigures): { total: number; vatBreakdown: Split } {
  return {
    total: decimalToCents(version.total),
    vatBreakdown: version.vatBreakdown,
  };
}
