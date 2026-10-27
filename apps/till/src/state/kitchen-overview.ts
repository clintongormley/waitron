import { stringToThousandths } from "@waitron/shared";

/** One dish for the Overview, in whatever read it came from. */
export interface OverviewDish {
  /** The kitchen name the card shows; rows are one per name. */
  name: string;
  /** How much it counts, in thousandths of a dish: {@link dishThousandths}. */
  thousandths: number;
  /** "making": fired and Waiting or Preparing; "held": held, or fired and waiting for the pass. */
  stage: "making" | "held";
}

/** One Overview row; `making` and `held` are in thousandths of a dish. */
export interface OverviewRow {
  name: string;
  making: number;
  held: number;
}

/** A dish whose unit shows counts as one; otherwise its quantity. */
export function dishThousandths(
  quantity: string,
  unitName: Record<string, string> | null | undefined,
  soldInEach: boolean | undefined,
): number {
  const unitShows = unitName != null && soldInEach !== true;
  return unitShows ? 1000 : stringToThousandths(quantity);
}

/** Rows with something to make first, then held-only rows; each group in first-appearance order. */
export function overviewRows(dishes: Iterable<OverviewDish>): OverviewRow[] {
  const byName = new Map<string, OverviewRow>();
  for (const dish of dishes) {
    let row = byName.get(dish.name);
    if (row === undefined) {
      row = { name: dish.name, making: 0, held: 0 };
      byName.set(dish.name, row);
    }
    row[dish.stage] += dish.thousandths;
  }
  const rows = [...byName.values()];
  return [
    ...rows.filter((row) => row.making > 0),
    ...rows.filter((row) => row.making === 0 && row.held > 0),
  ];
}

/** The rows with something to make: Overview's count. */
export function rowsToMake(rows: readonly OverviewRow[]): number {
  return rows.filter((row) => row.making > 0).length;
}
