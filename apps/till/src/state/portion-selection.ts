import {
  type Decimal,
  compareDecimal,
  decimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
} from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { billGross } from "./adjust-target.js";
import { moneyPlus, paidQuantities } from "./bill-payment.js";
import { portionGroups } from "./portion-groups.js";

/** One row of Move dishes…: identical whole portions as one row with a count, anything else alone. */
export interface PickRow {
  /** Members in line order on this bill; one member for a line that stands alone. */
  members: readonly TabLine[];
  /** A row of several whole portions of a unit dish, which takes a count. False for a row of one: a
   * weighed or unbound line, which has a tick only, or a single portion. */
  counted: boolean;
  /** The money one member takes off the bill, its extras included, at the money scale. */
  each: string;
  /** The most members of this row that can be picked while the other rows' picks stay as they are:
   * none for a paid row, and never so many that the bill would hold less than it has received or
   * reserved. */
  limit: number;
  /** Why no (more) member of this row can be picked, or why it holds more picks than its limit;
   * null when one more can be, or when all are picked within the limit. */
  blocked: { reason: "paid" } | { reason: "floor"; kept: string } | null;
}

export type Picks = ReadonlySet<string>;

const ZERO = decimal("0");

const times = (each: Decimal, count: number) => multiplyDecimal(each, decimal(String(count)));

/** One group of {@link PickGroups}: what its row is drawn from whatever the picks. */
interface PickGroup {
  members: readonly TabLine[];
  each: Decimal;
  paid: boolean;
}

/** A bill's dishes grouped into Move dishes…' rows. The grouping does not depend on the picks, so
 * one grouping serves every drawing of the rows until the bill is read again. */
export interface PickGroups {
  readonly groups: readonly PickGroup[];
  /** The bill's total and what it has received or reserved; null with no balance read. */
  readonly floor: { total: Decimal; kept: Decimal } | null;
}

/**
 * The bill's dishes as Move dishes… offers them. A dish recalled into a draft is left out, and a
 * dish with any quantity paid makes its row paid.
 */
export function pickGroups(
  lines: readonly TabLine[],
  keyOf: (dish: TabLine) => string | null,
  balance: BillBalance | null,
  recalled: ReadonlySet<string>,
): PickGroups {
  const dishes = lines.filter(
    (row) => (row.parentLineNo ?? null) === null && !recalled.has(row.id),
  );
  const extras = new Map<number, TabLine[]>();
  for (const row of lines) {
    const parent = row.parentLineNo ?? null;
    if (parent === null) continue;
    const siblings = extras.get(parent);
    if (siblings === undefined) extras.set(parent, [row]);
    else siblings.push(row);
  }
  const paid = balance === null ? null : paidQuantities(balance);
  const groups = portionGroups(dishes, keyOf, (row) => row.lineNo).map((members): PickGroup => ({
    members,
    each: billGross([members[0]!, ...(extras.get(members[0]!.lineNo) ?? [])]),
    paid:
      paid !== null &&
      members.some((member) => compareDecimal(decimal(paid.get(member.lineNo) ?? "0"), ZERO) > 0),
  }));
  return {
    groups,
    floor:
      balance === null
        ? null
        : {
            total: decimal(balance.total),
            kept: moneyPlus(balance.received, balance.reserved),
          },
  };
}

const pickedOf = (members: readonly TabLine[], picks: Picks) =>
  members.filter((member) => picks.has(member.id)).length;

/** What the picks on unpaid rows take off the bill. */
function pickedTotal(bill: PickGroups, picks: Picks): Decimal {
  return sumDecimals(
    bill.groups
      .filter((group) => !group.paid)
      .map((group) => times(group.each, pickedOf(group.members, picks))),
  );
}

function rowOf(bill: PickGroups, group: PickGroup, picks: Picks, total: Decimal): PickRow {
  const { members, each, paid } = group;
  const picked = pickedOf(members, picks);
  const floor = bill.floor;
  let limit = members.length;
  if (paid) limit = 0;
  else if (floor !== null) {
    let left = subtractDecimal(floor.total, subtractDecimal(total, times(each, picked)));
    limit = 0;
    while (limit < members.length) {
      left = subtractDecimal(left, each);
      if (compareDecimal(left, floor.kept) < 0) break;
      limit++;
    }
  }
  let blocked: PickRow["blocked"] = null;
  if (paid) blocked = { reason: "paid" };
  else if (floor !== null && (picked > limit || (picked < members.length && picked >= limit)))
    blocked = { reason: "floor", kept: floor.kept };
  return { members, counted: members.length > 1, each, limit, blocked };
}

/**
 * The rows drawn over a set of picks: a paid row is blocked `paid`, and a pick that would leave the
 * bill's total below what it has received or reserved is blocked `floor`. With no balance read,
 * nothing is blocked.
 */
export function pickRows(bill: PickGroups, picks: Picks): PickRow[] {
  const total = pickedTotal(bill, picks);
  return bill.groups.map((group) => rowOf(bill, group, picks, total));
}

export function pickedCount(row: PickRow, picks: Picks): number {
  return row.members.filter((member) => picks.has(member.id)).length;
}

/** The row's first `count` members picked and the rest dropped, never more than its limit. */
export function setCount(row: PickRow, count: number, picks: Picks): Picks {
  const next = new Set(picks);
  for (const member of row.members) next.delete(member.id);
  const take = Math.max(0, Math.min(count, row.limit));
  for (const member of row.members.slice(0, take)) next.add(member.id);
  return next;
}

/** None picked → every member the limit allows; any picked → none. */
export function toggleRow(row: PickRow, picks: Picks): Picks {
  return setCount(row, pickedCount(row, picks) > 0 ? 0 : row.members.length, picks);
}

/**
 * The picks after a re-read. `before` is the rows last drawn; `bill` is the re-read bill's groups.
 * Each row read before hands its count to the unpaid row now holding most of its members (on a tie,
 * the one drawn first), and counts handed to one row add up. The rows then take their counts in
 * the order they are drawn, each its first members and never more than its limit over the picks
 * already placed: together they keep within the floor the rows' limits work out, and a row left
 * short could not take one more. An id in no row now (gone, or recalled into a draft) is dropped,
 * and its row's count stays, taken from the members left.
 */
export function tidyPicks(before: readonly PickRow[], bill: PickGroups, picks: Picks): Picks {
  const counts = new Map<PickGroup, number>();
  for (const old of before) {
    const count = pickedCount(old, picks);
    if (count === 0) continue;
    const ids = new Set(old.members.map((member) => member.id));
    let home: PickGroup | undefined;
    let shared = 0;
    for (const group of bill.groups) {
      if (group.paid) continue;
      const held = group.members.filter((member) => ids.has(member.id)).length;
      if (held > shared) {
        home = group;
        shared = held;
      }
    }
    if (home !== undefined) counts.set(home, (counts.get(home) ?? 0) + count);
  }
  let next: Picks = new Set();
  for (const group of bill.groups) {
    const count = counts.get(group);
    if (count === undefined) continue;
    next = setCount(rowOf(bill, group, next, pickedTotal(bill, next)), count, next);
  }
  return next;
}

/** The picked dishes' line ids, in line order, leaving out a pick on a paid row. */
export function pickedLineIds(rows: readonly PickRow[], picks: Picks): string[] {
  return rows
    .filter((row) => row.blocked?.reason !== "paid")
    .flatMap((row) => row.members.filter((member) => picks.has(member.id)))
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((member) => member.id);
}
