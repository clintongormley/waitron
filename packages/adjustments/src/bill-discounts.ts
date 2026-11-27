import {
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  sumDecimals,
  subtractDecimal,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import {
  percentReduction,
  spreadBillDiscount,
  type PricedRow,
  type SpreadLine,
  type SpreadResult,
} from "./spread.js";

/** A row a discount prices: quantities in thousandths, money in cents. */
export interface PricedLine {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  quantity: number;
  priceQuantity: number;
  unit: number;
  unitPrecision: number | null;
}

/** `quantity` of `row` at `unitCents` a `priceQuantity`, rounded to the cent half up. */
export function lineGross(
  row: Pick<PricedLine, "unit" | "priceQuantity">,
  quantity: number,
  unitCents = row.unit,
): Decimal {
  return divideDecimal(
    multiplyDecimal(centsToDecimal(unitCents), thousandthsToDecimal(quantity)),
    thousandthsToDecimal(row.priceQuantity),
    MONEY_SCALE,
  );
}

/** `quantity` of `row`, a discount takes off: `exact` as {@link SpreadLine} takes it, and
 * `exactWhenShort` as {@link spreadReaching} takes it. */
export interface SpreadSubject<R extends PricedLine = PricedLine> {
  row: R;
  quantity: number;
  exact: boolean;
  exactWhenShort: boolean;
}

/**
 * Whether a row standing for `lines` takes its share exactly: only when each line is one unmeasured
 * unit, so each takes one of the row's prices whole and no line is split. A dish's row then does;
 * an extra's row only when the exact rows alone miss the discount.
 */
export function portionExactness(
  lines: readonly { row: Pick<PricedLine, "unitPrecision" | "parentLineId">; quantity: number }[],
): Pick<SpreadSubject, "exact" | "exactWhenShort"> {
  const oneUnitEach = lines.every(
    ({ row, quantity }) => (row.unitPrecision ?? 0) === 0 && quantity === 1000,
  );
  const dish = lines[0]!.row.parentLineId === null;
  return { exact: oneUnitEach && dish, exactWhenShort: oneUnitEach && !dish };
}

export type ShortSpreadLine = SpreadLine & { exactWhenShort: boolean };

/** {@link spreadBillDiscount} of `lines`; when it misses `discount`, spread again with the
 * `exactWhenShort` lines exact too. */
export function spreadReaching(
  lines: readonly ShortSpreadLine[],
  discount: Decimal,
): Map<string, SpreadResult> {
  const first = spreadBillDiscount(lines, discount);
  const taken = sumDecimals([...first.values()].map(({ reduction }) => reduction));
  if (compareDecimal(taken, discount) === 0 || !lines.some((line) => line.exactWhenShort)) {
    return first;
  }
  return spreadBillDiscount(
    lines.map((line) => ({ ...line, exact: line.exact || line.exactWhenShort })),
    discount,
  );
}

/** The line {@link spreadReaching} spreads over for `subject`. */
export function spreadLineOf({
  row,
  quantity,
  exact,
  exactWhenShort,
}: SpreadSubject): ShortSpreadLine {
  return {
    lineId: row.id,
    addedOrder: row.lineNo,
    gross: lineGross(row, quantity),
    quantity: thousandthsToDecimal(quantity),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    grossUnit: centsToDecimal(row.unit),
    exact,
    exactWhenShort,
  };
}

/** Bound portions spread as the one row they are filed as: at the first member's price and line
 * number, `members` in filing order. */
export function filedRowLine(members: readonly SpreadSubject[]): ShortSpreadLine {
  const { row, exact } = members[0]!;
  const each = portionExactness(members);
  return spreadLineOf({
    row,
    quantity: members.reduce((sum, member) => sum + member.quantity, 0),
    exact: exact || each.exact,
    exactWhenShort: each.exactWhenShort,
  });
}

/** What one member of a priced row is left at, and what that takes off it. */
export interface PricedShare<M> {
  member: M;
  rows: PricedRow[];
  reduction: Decimal;
}

type Measured = { row: Pick<PricedLine, "unit" | "priceQuantity">; quantity: number };

/** One line's priced rows handed to the lines standing for it, in the order given, each taking
 * its own quantity from the rows that are left, the higher price first. */
export function handOutRows<M extends Measured>(
  members: readonly M[],
  priced: readonly PricedRow[],
): PricedShare<M>[] {
  const pieces = priced.map((piece) => ({ ...piece, left: decimalToThousandths(piece.quantity) }));
  return members.map((member) => {
    const { row, quantity } = member;
    const rows: PricedRow[] = [];
    const cuts: Decimal[] = [];
    for (let need = quantity; need > 0;) {
      const piece = pieces.find((candidate) => candidate.left > 0)!;
      const take = Math.min(need, piece.left);
      piece.left -= take;
      need -= take;
      rows.push({ quantity: thousandthsToDecimal(take), unitGross: piece.unitGross });
      cuts.push(
        subtractDecimal(
          lineGross(row, take),
          lineGross(row, take, decimalToCents(piece.unitGross)),
        ),
      );
    }
    return { member, rows, reduction: sumDecimals(cuts) };
  });
}

/** A comp's rows: each one not already free is priced at exactly zero, never at a price whose
 * total merely rounds to nothing. */
export function zeroedRows<M extends Measured>(subjects: readonly M[]): PricedShare<M>[] {
  return subjects
    .filter(({ row }) => row.unit !== 0)
    .map((member) => ({
      member,
      rows: [{ quantity: thousandthsToDecimal(member.quantity), unitGross: decimal("0") }],
      reduction: lineGross(member.row, member.quantity),
    }));
}

/** A line of an open bill, as stored; `portion` names the filed row a bound portion, or an extra
 * of one, belongs to (an extra's ordinal is not read). */
export interface BillDiscountLine extends PricedLine {
  setMenuRole: "set_menu" | "dish" | null;
  setMenuLineId: string | null;
  lineTotal: number;
  portion: { group: string; ordinal: number } | null;
}

/** A dish or an extra (`line`), a set-menu row, null once the grouping deleted it, or the bill. */
export type BillDiscountTarget =
  { kind: "bill" } | { kind: "line"; lineId: string } | { kind: "set_menu"; lineId: string | null };

/** A discount given on an open bill, not yet written into its lines: `amount` in cents. */
export interface PendingBillDiscount {
  id: string;
  target: BillDiscountTarget;
  action: "comp" | "discount_percent" | "discount_amount";
  percentBp: number | null;
  amount: number | null;
  origin: "given" | "bill_share";
  position: number;
}

/** A row of a line after a discount; a part split off it is numbered after the bill's last line. */
export interface BillDiscountRow {
  id: string;
  lineNo: number;
  quantity: number;
  unit: number;
  total: number;
}

/**
 * What one discount takes off, in cents, and every row of each line whose price it moved.
 * `cut_down`: an amount larger than what its target costs, which takes the target to zero;
 * `set_menu_gone`: its set-menu row is gone, so it takes nothing.
 */
export interface WorkedBillDiscount {
  id: string;
  holds: "yes" | "set_menu_gone" | "cut_down";
  takes: number;
  lines: { lineId: string; rows: BillDiscountRow[] }[];
}

export interface WorkedBill {
  discounts: WorkedBillDiscount[];
  takes: number;
}

interface Part extends PricedLine {
  lineId: string;
  setMenuLineId: string | null;
  portion: BillDiscountLine["portion"];
}

type Subject = SpreadSubject<Part>;

const cents = (value: Decimal) => decimalToCents(value);
const weighed = (row: PricedLine) => (row.unitPrecision ?? 0) > 0;

function refuseValue(discount: PendingBillDiscount): void {
  const { action, percentBp, amount, target } = discount;
  const wrong =
    (action === "discount_percent" && percentBp === null) ||
    (action === "discount_amount" &&
      (amount === null || !Number.isSafeInteger(amount) || amount <= 0)) ||
    (action === "comp" && target.kind === "bill");
  if (wrong) throw new RangeError(`discount ${discount.id}'s value does not fit its action`);
}

/** Spec 7.2's order: extras, then dishes and shares of a bill, then set menus, then the bill. */
function stepOf(discount: PendingBillDiscount, lineOf: (id: string) => BillDiscountLine): number {
  const { target } = discount;
  if (target.kind === "bill") return 4;
  if (target.kind === "set_menu") return 3;
  const line = lineOf(target.lineId);
  return line.parentLineId !== null && discount.origin === "given" ? 1 : 2;
}

const targetKey = (target: BillDiscountTarget) =>
  target.kind === "bill" ? "bill" : `${target.kind}:${target.lineId}`;

/** `amount` shared over `quantities` by quantity, the cents left over one each from the first. */
function byQuantity(amount: number, quantities: readonly number[]): number[] {
  const whole = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const shares = quantities.map((quantity) => Math.floor((amount * quantity) / whole));
  let left = amount - shares.reduce((sum, share) => sum + share, 0);
  for (let index = 0; left > 0; index += 1, left -= 1) shares[index]! += 1;
  return shares;
}

/** {@link byQuantity}, no share above its part's cost: what a part cannot take is shared again
 * over the parts that still can. `amount` must not exceed the costs' sum. */
function byQuantityWithin(
  amount: number,
  quantities: readonly number[],
  costs: readonly number[],
): number[] {
  const shares = costs.map(() => 0);
  for (let left = amount; left > 0;) {
    const open = costs.flatMap((cost, index) => (shares[index]! < cost ? [index] : []));
    const offered = byQuantity(
      left,
      open.map((index) => quantities[index]!),
    );
    left = 0;
    open.forEach((index, at) => {
      const taken = Math.min(offered[at]!, costs[index]! - shares[index]!);
      shares[index]! += taken;
      left += offered[at]! - taken;
    });
  }
  return shares;
}

/**
 * The rows a bill files its subjects as, each listing the subjects it stands for in filing order.
 * `projectPortionSale` (`apps/server/src/portion-sale-projection.ts`) files bound dishes as one row
 * while they share a cohort, every filed field but quantity, and the same extras per dish (each
 * extra's fields and quantity); an extra of the first dish then files as one row with the first
 * unclaimed matching extra of each other dish. Here a portion group stands for the cohort and the
 * fields a discount leaves alone, so the price is compared beside it.
 */
function filedRows(subjects: readonly Subject[], lineOf: (id: string) => BillDiscountLine) {
  const extrasOf = new Map<string, Subject[]>();
  const dishes: Subject[] = [];
  for (const subject of subjects) {
    const { parentLineId } = subject.row;
    if (parentLineId === null) {
      dishes.push(subject);
      continue;
    }
    const extras = extrasOf.get(lineOf(parentLineId).id);
    if (extras === undefined) extrasOf.set(parentLineId, [subject]);
    else extras.push(subject);
  }
  const priced = ({ row }: Subject) => [row.unit, row.priceQuantity, row.unitPrecision];
  const extraKeys = new Map<Subject, string>();
  const extraKey = (subject: Subject) => {
    let key = extraKeys.get(subject);
    if (key === undefined) {
      key = JSON.stringify([
        subject.row.portion?.group ?? `line:${subject.row.id}`,
        ...priced(subject),
        subject.quantity,
      ]);
      extraKeys.set(subject, key);
    }
    return key;
  };
  const extrasOfDish = ({ row }: Subject) =>
    (row.id === row.lineId ? extrasOf.get(row.id) : undefined) ?? [];

  const dishRows: Subject[][] = [];
  const bound = new Map<string, Subject[]>();
  for (const dish of dishes) {
    const { portion } = dish.row;
    const key =
      portion === null
        ? null
        : JSON.stringify([portion.group, ...priced(dish), extrasOfDish(dish).map(extraKey).sort()]);
    const row = key === null ? undefined : bound.get(key);
    if (row !== undefined) {
      row.push(dish);
      continue;
    }
    const created = [dish];
    dishRows.push(created);
    if (key !== null) bound.set(key, created);
  }

  return dishRows.flatMap((members) => {
    const [first, ...others] = members as [Subject, ...Subject[]];
    const unclaimed = others.map((other) => [...extrasOfDish(other)]);
    const extraRows = extrasOfDish(first).map((extra) => {
      const key = extraKey(extra);
      return [
        extra,
        ...unclaimed.map(
          (extras) =>
            extras.splice(
              extras.findIndex((candidate) => extraKey(candidate) === key),
              1,
            )[0]!,
        ),
      ];
    });
    return [members, ...extraRows];
  });
}

/**
 * What each pending discount on a bill takes off and the rows it leaves each line at, worked out
 * in spec 7.2's order, each on its target as the earlier ones left it. Within a step, discounts
 * keep the order given, except that Free on a target comes before that target's other discounts.
 * A line one discount leaves at two prices is two parts for the next; a later discount on that
 * line is worked out once on each part, a percentage or Free as it is, an amount shared by
 * quantity (plan D10).
 */
export function workOutBillDiscounts(
  lines: readonly BillDiscountLine[],
  discounts: readonly PendingBillDiscount[],
): WorkedBill {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const lineOf = (id: string) => {
    const line = byId.get(id);
    if (line === undefined) throw new RangeError(`line ${id} is not on the bill`);
    return line;
  };
  for (const line of lines) {
    if (line.lineTotal !== cents(lineGross(line, line.quantity))) {
      throw new RangeError(`line ${line.id}'s total is not its unit price times its quantity`);
    }
  }
  // A new part is numbered above every other, so appending keeps both lists in line order.
  const parts: Part[] = [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line) => ({
      id: line.id,
      lineId: line.id,
      lineNo: line.lineNo,
      parentLineId: line.parentLineId,
      setMenuLineId: line.setMenuLineId,
      quantity: line.quantity,
      priceQuantity: line.priceQuantity,
      unit: line.unit,
      unitPrecision: line.unitPrecision,
      portion: line.portion,
    }));
  const partsByLine = new Map(parts.map((part) => [part.lineId, [part]]));
  let lastLineNo = Math.max(0, ...lines.map(({ lineNo }) => lineNo));
  const partsOf = (lineId: string) => partsByLine.get(lineId)!;

  const steps = discounts.map((discount) => {
    refuseValue(discount);
    return { discount, step: stepOf(discount, lineOf) };
  });
  const firstOnTarget = new Map<string, number>();
  for (const { discount, step } of steps) {
    const key = `${step}|${targetKey(discount.target)}`;
    firstOnTarget.set(key, Math.min(discount.position, firstOnTarget.get(key) ?? Infinity));
  }
  const ordered = steps
    .map(({ discount, step }) => {
      const later = Number(discount.action !== "comp");
      const at = later
        ? discount.position
        : firstOnTarget.get(`${step}|${targetKey(discount.target)}`)!;
      return { discount, step, at, later };
    })
    .sort(
      (a, b) =>
        a.step - b.step ||
        a.at - b.at ||
        a.later - b.later ||
        a.discount.position - b.discount.position,
    );

  /** Writes `shares` into the parts; a share taking nothing moves nothing unless `zeroed`, as Free
   * prices a row at zero even where its total was already nothing. */
  const apply = (shares: readonly PricedShare<Subject>[], zeroed: boolean): Set<string> => {
    const moved = new Set<string>();
    for (const { member, rows, reduction } of shares) {
      if (!zeroed && compareDecimal(reduction, centsToDecimal(0)) === 0) continue;
      const part = member.row;
      moved.add(part.lineId);
      const [first, ...rest] = rows;
      part.quantity = decimalToThousandths(first!.quantity);
      part.unit = cents(first!.unitGross);
      for (const row of rest) {
        lastLineNo += 1;
        const split = {
          ...part,
          id: `${part.lineId}#${lastLineNo}`,
          lineNo: lastLineNo,
          quantity: decimalToThousandths(row.quantity),
          unit: cents(row.unitGross),
        };
        parts.push(split);
        partsOf(part.lineId).push(split);
      }
    }
    return moved;
  };

  const lineSubjects = (family: readonly Part[], target: Part): Subject[] =>
    family.map((row) => {
      const each = portionExactness([{ row, quantity: row.quantity }]);
      const alone = family.length === 1 && target.parentLineId === null && !weighed(target);
      return {
        row,
        quantity: row.quantity,
        exact: alone || each.exact,
        exactWhenShort: each.exactWhenShort,
      };
    });

  /** The subjects of each piece a discount is worked out in, or null once its set menu is gone. */
  const copiesOf = ({ target, origin }: PendingBillDiscount): Subject[][] | null => {
    if (target.kind === "set_menu") {
      if (target.lineId === null || !byId.has(target.lineId)) return null;
      const menuId = target.lineId;
      const row = partsOf(menuId);
      const dishes = parts.filter(
        ({ setMenuLineId, unit }) => setMenuLineId === menuId && unit > 0,
      );
      return [lineSubjects([...row, ...dishes], row[0]!)];
    }
    if (target.kind === "line") {
      const extras =
        origin === "given" ? parts.filter((part) => part.parentLineId === target.lineId) : [];
      return partsOf(target.lineId).map((part) =>
        lineSubjects(part.id === target.lineId ? [part, ...extras] : [part], part),
      );
    }
    const families = new Set(parts.flatMap(({ parentLineId }) => parentLineId ?? []));
    return [
      parts.map((row) => {
        const each = portionExactness([{ row, quantity: row.quantity }]);
        return {
          row,
          quantity: row.quantity,
          exact:
            (row.parentLineId === null && !families.has(row.id) && !weighed(row)) || each.exact,
          exactWhenShort: each.exactWhenShort,
        };
      }),
    ];
  };

  /** What `wanted` cents, spread over `subjects` (whose spread lines are `spread`), leaves each
   * at; on a bill holding bound portions, over the rows the bill files, each handed out to its
   * portions by ordinal. */
  const spreadOver = (
    subjects: readonly Subject[],
    spread: readonly ShortSpreadLine[],
    wanted: number,
    filed: boolean,
  ): PricedShare<Subject>[] => {
    const discount = centsToDecimal(wanted);
    if (!filed) {
      const results = spreadReaching(spread, discount);
      return subjects.map((member) => ({ member, ...results.get(member.row.id)! }));
    }
    const ordinal = ({ row }: Subject) => (row.parentLineId === null ? row.portion!.ordinal : 0);
    const groups = filedRows(subjects, lineOf);
    const results = spreadReaching(groups.map(filedRowLine), discount);
    return groups.flatMap((group) =>
      handOutRows(
        [...group].sort((a, b) => ordinal(a) - ordinal(b)),
        results.get(group[0]!.row.id)!.rows,
      ),
    );
  };

  const worked: WorkedBillDiscount[] = ordered.map(({ discount }) => {
    const copies = copiesOf(discount);
    if (copies === null) return { id: discount.id, holds: "set_menu_gone", takes: 0, lines: [] };
    const spreads = copies.map((subjects) => subjects.map(spreadLineOf));
    const costs = spreads.map((spread) => spread.reduce((sum, { gross }) => sum + cents(gross), 0));
    const whole = costs.reduce((sum, cost) => sum + cost, 0);
    const comp = discount.action === "comp";
    const cut = discount.action === "discount_amount" && discount.amount! > whole;
    const amounts =
      discount.action === "discount_amount"
        ? byQuantityWithin(
            Math.min(discount.amount!, whole),
            copies.map((subjects) => subjects[0]?.quantity ?? 0),
            costs,
          )
        : null;
    const filed = discount.target.kind === "bill" && parts.some(({ portion }) => portion !== null);
    let takes = 0;
    const moved = new Set<string>();
    copies.forEach((subjects, index) => {
      const shares = comp
        ? zeroedRows(subjects)
        : spreadOver(
            subjects,
            spreads[index]!,
            amounts?.[index] ??
              cents(percentReduction(centsToDecimal(costs[index]!), discount.percentBp!)),
            filed,
          );
      takes += shares.reduce((sum, { reduction }) => sum + cents(reduction), 0);
      for (const lineId of apply(shares, comp)) moved.add(lineId);
    });
    return {
      id: discount.id,
      holds: cut ? "cut_down" : "yes",
      takes,
      lines: lines
        .filter(({ id }) => moved.has(id))
        .map(({ id }) => ({
          lineId: id,
          rows: partsOf(id).map((part) => ({
            id: part.id,
            lineNo: part.lineNo,
            quantity: part.quantity,
            unit: part.unit,
            total: cents(lineGross(part, part.quantity)),
          })),
        })),
    };
  });
  return { discounts: worked, takes: worked.reduce((sum, { takes }) => sum + takes, 0) };
}
