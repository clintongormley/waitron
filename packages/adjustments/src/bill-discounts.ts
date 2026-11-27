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

const ZERO = decimal("0");

/** A row a discount prices: quantities in thousandths, money in cents. */
export interface SpreadRow {
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
  row: Pick<SpreadRow, "unit" | "priceQuantity">,
  quantity: number,
  unitCents = row.unit,
): Decimal {
  return divideDecimal(
    multiplyDecimal(centsToDecimal(unitCents), thousandthsToDecimal(quantity)),
    thousandthsToDecimal(row.priceQuantity),
    MONEY_SCALE,
  );
}

const weighed = (row: Pick<SpreadRow, "unitPrecision">) => (row.unitPrecision ?? 0) > 0;

/**
 * The dishes a set-menu row's comp or discount covers with it (set-menus design of 24 November, section 6; A1515-3 plan D49): those placed
 * in it that are charged, which is what their supplements are; their paid extras are not covered.
 */
export function coveredBySetMenu<R extends { setMenuLineId: string | null; unit: number }>(
  menuId: string,
  rows: readonly R[],
): R[] {
  return rows.filter(({ setMenuLineId, unit }) => setMenuLineId === menuId && unit > 0);
}

/** `quantity` of `row`, a discount takes off: `exact` as {@link SpreadLine} takes it, and
 * `exactWhenShort` as {@link spreadReaching} takes it. */
export interface SpreadSubject<R extends SpreadRow = SpreadRow> {
  row: R;
  quantity: number;
  exact: boolean;
  exactWhenShort: boolean;
}

type Exactness = Pick<SpreadSubject, "exact" | "exactWhenShort">;

/**
 * Whether a row standing for `lines` takes its share exactly: only when each line is one unmeasured
 * unit, so each takes one of the row's prices whole and no line is split. A dish's row then does;
 * an extra's row only when the exact rows alone miss the discount.
 */
export function portionExactness(
  lines: readonly { row: Pick<SpreadRow, "unitPrecision" | "parentLineId">; quantity: number }[],
): Exactness {
  const oneUnitEach = lines.every(
    ({ row, quantity }) => (row.unitPrecision ?? 0) === 0 && quantity === 1000,
  );
  const dish = lines[0]!.row.parentLineId === null;
  return { exact: oneUnitEach && dish, exactWhenShort: oneUnitEach && !dish };
}

/** `lines` as a discount's subjects: each exact when `exactAnyway` holds for its row, and
 * otherwise as `exactness` reads it. */
export function withExactness<L extends { row: SpreadRow; quantity: number }>(
  lines: readonly L[],
  exactAnyway: (row: L["row"]) => boolean,
  exactness: (line: L) => Exactness = (line) => portionExactness([line]),
): (L & Exactness)[] {
  return lines.map((line) => {
    const each = exactness(line);
    return {
      ...line,
      exact: exactAnyway(line.row) || each.exact,
      exactWhenShort: each.exactWhenShort,
    };
  });
}

/** Whether a discount on one target takes `target` to the exact cent whatever it costs: a dish,
 * not weighed, priced on its own. */
export function takesAlone(
  family: readonly unknown[],
  target: Pick<SpreadRow, "parentLineId" | "unitPrecision">,
): boolean {
  return family.length === 1 && target.parentLineId === null && !weighed(target);
}

/** Which of `rows` a whole-bill discount takes to the exact cent whatever they cost: dishes, not
 * weighed, with no extras. */
export function exactOnWholeBill(
  rows: readonly Pick<SpreadRow, "parentLineId">[],
): (row: Pick<SpreadRow, "id" | "parentLineId" | "unitPrecision">) => boolean {
  const families = new Set(rows.flatMap(({ parentLineId }) => parentLineId ?? []));
  return (row) => row.parentLineId === null && !families.has(row.id) && !weighed(row);
}

type ShortSpreadLine = SpreadLine & { exactWhenShort: boolean };

/** {@link spreadBillDiscount} of `lines`; when it misses `discount`, spread again with the
 * `exactWhenShort` lines exact too. */
function spreadReaching(
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
function spreadLineOf({ row, quantity, exact, exactWhenShort }: SpreadSubject): ShortSpreadLine {
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
function filedRowLine(members: readonly SpreadSubject[]): ShortSpreadLine {
  const { row, exact } = members[0]!;
  const each = portionExactness(members);
  return spreadLineOf({
    row,
    quantity: members.reduce((sum, member) => sum + member.quantity, 0),
    exact: exact || each.exact,
    exactWhenShort: each.exactWhenShort,
  });
}

/** A member of a priced row, with what it is left at and what that takes off it. */
export type PricedShare<M> = M & { rows: PricedRow[]; reduction: Decimal };

/** `discount` spread over `subjects`, each as a line of its own. */
export function spreadSubjects<S extends SpreadSubject>(
  subjects: readonly S[],
  discount: Decimal,
): PricedShare<S>[] {
  const results = spreadReaching(subjects.map(spreadLineOf), discount);
  return subjects.map((subject) => {
    const { rows, reduction } = results.get(subject.row.id)!;
    return { ...subject, rows, reduction };
  });
}

type Measured = { row: Pick<SpreadRow, "unit" | "priceQuantity">; quantity: number };

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
    return { ...member, rows, reduction: sumDecimals(cuts) };
  });
}

/**
 * `discount` spread over the rows a bill files, `groups` each listing the members one filed row
 * stands for in filing order: each group spread as that one row, then its priced `rows` handed to
 * its members in `ordinal` order.
 */
export function spreadOverFiledGroups<M extends SpreadSubject>(
  groups: readonly (readonly M[])[],
  discount: Decimal,
  ordinal: (member: M) => number,
): { rows: PricedRow[]; shares: PricedShare<M>[] }[] {
  const results = spreadReaching(groups.map(filedRowLine), discount);
  return groups.map((members) => {
    const { rows } = results.get(members[0]!.row.id)!;
    return {
      rows,
      shares: handOutRows(
        [...members].sort((a, b) => ordinal(a) - ordinal(b)),
        rows,
      ),
    };
  });
}

/** A comp's rows: each one not already free is priced at exactly zero, never at a price whose
 * total merely rounds to nothing. */
export function zeroedRows<M extends Measured>(subjects: readonly M[]): PricedShare<M>[] {
  return subjects
    .filter(({ row }) => row.unit !== 0)
    .map((member) => ({
      ...member,
      rows: [{ quantity: thousandthsToDecimal(member.quantity), unitGross: ZERO }],
      reduction: lineGross(member.row, member.quantity),
    }));
}

/** A line of an open bill, as stored; `portion` names the filed row a bound portion, or an extra
 * of one, belongs to (an extra's ordinal is not read). */
export interface BillDiscountLine extends SpreadRow {
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

interface Part extends SpreadRow {
  lineId: string;
  setMenuLineId: string | null;
  portion: BillDiscountLine["portion"];
}

type Subject = SpreadSubject<Part>;

function refuseValue(discount: PendingBillDiscount): void {
  const { action, percentBp, amount, target } = discount;
  const wrong =
    (action === "discount_percent" && percentBp === null) ||
    (action === "discount_amount" &&
      (amount === null || !Number.isSafeInteger(amount) || amount <= 0)) ||
    (action === "comp" && target.kind === "bill");
  if (wrong) throw new RangeError(`discount ${discount.id}'s value does not fit its action`);
}

/** Spec 7.2's order, with a share of a bill (plan D8) in the dishes' step: extras, then dishes and
 * shares of a bill, then set menus, then the bill. */
function stepOf(discount: PendingBillDiscount, lineOf: (id: string) => BillDiscountLine): number {
  const { target } = discount;
  if (target.kind === "bill") return 4;
  if (target.kind === "set_menu") return 3;
  const line = lineOf(target.lineId);
  return line.parentLineId !== null && discount.origin === "given" ? 1 : 2;
}

const targetKey = (target: BillDiscountTarget) =>
  target.kind === "bill" ? "bill" : `${target.kind}:${target.lineId}`;

/** `amount` shared over `quantities` by quantity, the cents left over one each from the first
 * (plan D10's copy on a split, unlike `shareByWeight`). */
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
 * The rows a bill files `members` as, each listing the members it stands for in filing order.
 * `projectPortionSale` (`apps/server/src/portion-sale-projection.ts`) files bound dishes as one row
 * while they share a cohort, every filed field but quantity, and the same extras per dish (each
 * extra's fields and quantity); an extra of the first dish then files as one row with the first
 * unclaimed matching extra of each other dish. Here a portion group stands for the cohort and the
 * fields a discount leaves alone, so the price is compared beside it.
 */
function filedRows<M extends { row: Part; quantity: number }>(members: readonly M[]): M[][] {
  const extrasOf = new Map<string, M[]>();
  const dishes: M[] = [];
  for (const member of members) {
    const { parentLineId } = member.row;
    if (parentLineId === null) {
      dishes.push(member);
      continue;
    }
    const extras = extrasOf.get(parentLineId);
    if (extras === undefined) extrasOf.set(parentLineId, [member]);
    else extras.push(member);
  }
  const priced = ({ row }: M) => [row.unit, row.priceQuantity, row.unitPrecision];
  const extraKeys = new Map<M, string>();
  const extraKey = (member: M) => {
    let key = extraKeys.get(member);
    if (key === undefined) {
      key = JSON.stringify([
        member.row.portion?.group ?? `line:${member.row.id}`,
        ...priced(member),
        member.quantity,
      ]);
      extraKeys.set(member, key);
    }
    return key;
  };
  const extrasOfDish = ({ row }: M) =>
    (row.id === row.lineId ? extrasOf.get(row.id) : undefined) ?? [];

  const dishRows: M[][] = [];
  const bound = new Map<string, M[]>();
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

  return dishRows.flatMap((group) => {
    const [first, ...others] = group as [M, ...M[]];
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
    return [group, ...extraRows];
  });
}

/** A piece of a discount's target, what it costs and how a share of the discount spreads over it. */
interface Piece {
  cost: number;
  spread: (cents: number) => PricedShare<Subject>[];
}

const ordinal = ({ row }: Subject) => (row.parentLineId === null ? row.portion!.ordinal : 0);

/** `subjects` as one piece, each a line of its own. */
function linePiece(subjects: readonly Subject[]): Piece {
  return {
    cost: subjects.reduce(
      (sum, { row, quantity }) => sum + decimalToCents(lineGross(row, quantity)),
      0,
    ),
    spread: (cents) => spreadSubjects(subjects, centsToDecimal(cents)),
  };
}

/** `subjects` as the rows the bill files, each spread as one row and handed to its members by
 * ordinal. */
function filedPiece(subjects: readonly Subject[]): Piece {
  const groups = filedRows(subjects);
  return {
    cost: subjects.reduce(
      (sum, { row, quantity }) => sum + decimalToCents(lineGross(row, quantity)),
      0,
    ),
    spread: (cents) =>
      spreadOverFiledGroups(groups, centsToDecimal(cents), ordinal).flatMap(({ shares }) => shares),
  };
}

/**
 * What each pending discount on a bill takes off and the rows it leaves each line at, worked out
 * in spec 7.2's order, each on its target as the earlier ones left it. Within a step, discounts
 * keep the order given, except that Free on a target comes before that target's other discounts.
 * A line one discount leaves at two prices is two parts for the next; a later discount on that
 * line is worked out once on each part, a percentage or Free as it is, an amount shared by
 * quantity (plan D10). On a bill holding bound portions, a whole-bill discount is spread over the
 * rows the bill files.
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
    if (line.lineTotal !== decimalToCents(lineGross(line, line.quantity))) {
      throw new RangeError(`line ${line.id}'s total is not its unit price times its quantity`);
    }
    if (line.parentLineId !== null && !byId.has(line.parentLineId)) {
      throw new RangeError(`line ${line.id}'s dish is not on the bill`);
    }
  }
  const bound = lines.some(({ portion }) => portion !== null);
  // A new part is numbered above every other, so appending keeps every list in line order.
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
  const extrasByDish = new Map<string, Part[]>();
  const dishesBySetMenu = new Map<string, Part[]>();
  const listUnder = (into: Map<string, Part[]>, key: string | null, part: Part) => {
    if (key === null) return;
    const list = into.get(key);
    if (list === undefined) into.set(key, [part]);
    else list.push(part);
  };
  const file = (part: Part) => {
    listUnder(extrasByDish, part.parentLineId, part);
    listUnder(dishesBySetMenu, part.setMenuLineId, part);
  };
  parts.forEach(file);
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
    for (const { row: part, rows, reduction } of shares) {
      if (!zeroed && compareDecimal(reduction, ZERO) === 0) continue;
      moved.add(part.lineId);
      const [first, ...rest] = rows;
      part.quantity = decimalToThousandths(first!.quantity);
      part.unit = decimalToCents(first!.unitGross);
      for (const row of rest) {
        lastLineNo += 1;
        const split = {
          ...part,
          id: `${part.lineId}#${lastLineNo}`,
          lineNo: lastLineNo,
          quantity: decimalToThousandths(row.quantity),
          unit: decimalToCents(row.unitGross),
        };
        parts.push(split);
        partsOf(part.lineId).push(split);
        file(split);
      }
    }
    return moved;
  };

  const subjectsOf = (rows: readonly Part[], exactAnyway: (row: Part) => boolean): Subject[] =>
    withExactness(
      rows.map((row) => ({ row, quantity: row.quantity })),
      exactAnyway,
    );
  const lineSubjects = (family: readonly Part[], target: Part) =>
    subjectsOf(family, () => takesAlone(family, target));

  /** The subjects of each piece a discount is worked out in, or null once its set menu is gone. */
  const copiesOf = ({ target, origin }: PendingBillDiscount): Subject[][] | null => {
    if (target.kind === "set_menu") {
      if (target.lineId === null || !byId.has(target.lineId)) return null;
      const menuId = target.lineId;
      const row = partsOf(menuId);
      const covered = coveredBySetMenu(menuId, dishesBySetMenu.get(menuId) ?? []);
      return [lineSubjects([...row, ...covered], row[0]!)];
    }
    if (target.kind === "line") {
      const extras = origin === "given" ? (extrasByDish.get(target.lineId) ?? []) : [];
      return partsOf(target.lineId).map((part) =>
        lineSubjects(part.id === target.lineId ? [part, ...extras] : [part], part),
      );
    }
    return [subjectsOf(parts, exactOnWholeBill(parts))];
  };

  /** Each copy's shares of `discount`, and whether an amount was cut down to what they cost. */
  const sharesOf = (discount: PendingBillDiscount, copies: readonly Subject[][]) => {
    if (discount.action === "comp") return { cut: false, shares: copies.flatMap(zeroedRows) };
    const pieces =
      discount.target.kind === "bill" && bound ? [filedPiece(copies[0]!)] : copies.map(linePiece);
    const costs = pieces.map(({ cost }) => cost);
    const whole = costs.reduce((sum, cost) => sum + cost, 0);
    const amounts =
      discount.action === "discount_amount"
        ? byQuantityWithin(
            Math.min(discount.amount!, whole),
            copies.map((subjects) => subjects[0]?.quantity ?? 0),
            costs,
          )
        : null;
    return {
      cut: discount.action === "discount_amount" && discount.amount! > whole,
      shares: pieces.flatMap((piece, index) =>
        piece.spread(
          amounts?.[index] ??
            decimalToCents(percentReduction(centsToDecimal(piece.cost), discount.percentBp!)),
        ),
      ),
    };
  };

  const worked: WorkedBillDiscount[] = ordered.map(({ discount }) => {
    const copies = copiesOf(discount);
    if (copies === null) return { id: discount.id, holds: "set_menu_gone", takes: 0, lines: [] };
    const { cut, shares } = sharesOf(discount, copies);
    const moved = apply(shares, discount.action === "comp");
    const takes = shares.reduce((sum, { reduction }) => sum + decimalToCents(reduction), 0);
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
            total: decimalToCents(lineGross(part, part.quantity)),
          })),
        })),
    };
  });
  return { discounts: worked, takes: worked.reduce((sum, { takes }) => sum + takes, 0) };
}
