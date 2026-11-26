import type { Transaction } from "@waitron/db";
import {
  aLaCarteLineTotal,
  type GroupingLine,
} from "@waitron/orders-sales/set-menu-grouping-plan.js";
import {
  centsToDecimal,
  decimalToCents,
  decimalToThousandths,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";
import { familyAt, gross, type Row } from "./adjustment-rows.js";
import type { Plan } from "./adjustments-apply.js";
import { takesSetMenus, totalAfterAdjusting } from "./set-menu-regroup.js";

/** A row as a comp's or discount's writes leave it; `lineTotal` null keeps the stored one. */
interface Part {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  quantity: number;
  unit: number;
  list: number | null;
  lineTotal: number | null;
  released: boolean;
}

type Planned = Pick<Plan, "rows" | "released" | "stamped" | "carve" | "writes" | "reduction">;

/**
 * The bill's total now and once the plan is applied: less `cancelDrop` (a cancel's whole drop), or,
 * for a comp or discount, its rows as {@link applyAdjustment} writes them, grouped again; on a bill
 * with no set menus to group, less the plan's reduction.
 */
export async function billTotalOf(
  tx: Transaction,
  orderId: string,
  plan: Planned,
  cancelDrop: Decimal | null,
): Promise<{ before: Decimal; after: Decimal }> {
  const before = centsToDecimal(plan.rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0));
  if (cancelDrop !== null) return { before, after: subtractDecimal(before, cancelDrop) };
  if (
    !plan.rows.some(({ setMenuRole }) => setMenuRole !== null) &&
    !(await takesSetMenus(tx, orderId))
  ) {
    return { before, after: subtractDecimal(before, plan.reduction) };
  }
  return {
    before,
    after: centsToDecimal(await totalAfterAdjusting(tx, orderId, rowsAfter(plan))),
  };
}

/**
 * Each row as the plan's writes leave it: a released dish a la carte, the touched rows stamped with
 * their list price, the carved part split off its dish and extras, then each change's prices, its
 * second price split off. A split-off row's id is `<its row's id>#<part>`.
 */
function rowsAfter(plan: Planned): (line: GroupingLine) => GroupingLine[] {
  const { rows } = plan;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const released = new Set(plan.released);
  const touched = new Set([...plan.writes.map(({ row }) => row.id), ...plan.stamped]);
  let lastLineNo = Math.max(0, ...rows.map(({ lineNo }) => lineNo));
  const parts = new Map<string, Part[]>(
    rows.map((row) => {
      const part: Part = {
        id: row.id,
        lineNo: row.lineNo,
        parentLineId: row.parentLineId,
        quantity: row.quantity,
        unit: row.unit,
        list: row.list,
        lineTotal: null,
        released: released.has(row.id),
      };
      if (part.released) {
        part.unit = row.aLaCarte!;
        part.list = null;
        part.lineTotal = aLaCarteLineTotal(row.aLaCarte!, row.quantity);
      }
      if (touched.has(row.id)) part.list ??= part.unit;
      return [row.id, [part]];
    }),
  );
  const totalOf = (row: Row, part: Part) => decimalToCents(gross(row, part.quantity, part.unit));
  const { carve } = plan;
  if (carve !== null && plan.writes.some(({ carved }) => carved)) {
    const dish = rows.find(({ lineNo }) => lineNo === carve.lineNo)!;
    const family = [dish, ...rows.filter(({ parentLineId }) => parentLineId === dish.id)];
    const carved = familyAt(family, carve.quantity);
    for (const row of family) {
      const [kept] = parts.get(row.id)!;
      const part: Part = {
        ...kept!,
        id: `${row.id}#carved`,
        lineNo: (lastLineNo += 1),
        parentLineId: row.parentLineId === null ? null : `${row.parentLineId}#carved`,
        quantity: carved.get(row.id)!,
      };
      kept!.quantity -= part.quantity;
      kept!.lineTotal = totalOf(row, kept!);
      part.lineTotal = totalOf(row, part);
      parts.get(row.id)!.push(part);
    }
  }
  for (const change of plan.writes) {
    const row = byId.get(change.row.id)!;
    const all = parts.get(row.id)!;
    const part = all.find(({ id }) => id === (change.carved ? `${row.id}#carved` : row.id))!;
    const [first, lower] = change.rows;
    if (lower !== undefined) {
      const second: Part = {
        ...part,
        id: `${part.id}#lower`,
        lineNo: (lastLineNo += 1),
        quantity: decimalToThousandths(lower.quantity),
        unit: decimalToCents(lower.unitGross),
      };
      second.lineTotal = totalOf(row, second);
      all.push(second);
    }
    part.quantity = decimalToThousandths(first!.quantity);
    part.unit = decimalToCents(first!.unitGross);
    part.lineTotal = totalOf(row, part);
  }
  return (line) =>
    parts.get(line.id)!.map((part) => ({
      ...line,
      ...(part.released ? { setMenuRole: null, setMenuLineId: null, setMenuPlace: null } : {}),
      id: part.id,
      lineNo: part.lineNo,
      parentLineId: part.parentLineId,
      quantity: part.quantity,
      unitPriceGross: part.unit,
      listUnitPriceGross: part.list,
      lineTotal: part.lineTotal ?? line.lineTotal,
    }));
}
