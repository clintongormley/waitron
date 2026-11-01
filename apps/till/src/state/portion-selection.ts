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

/**
 * The bill's dishes as Move dishes… offers them. A dish recalled into a draft is left out; a dish
 * with any quantity paid is blocked `paid`; and a pick that would leave the bill's total below what
 * it has received or reserved is blocked `floor`. With no balance read, nothing is blocked.
 */
export function pickRows(
  lines: readonly TabLine[],
  keyOf: (dish: TabLine) => string | null,
  balance: BillBalance | null,
  recalled: ReadonlySet<string>,
  picks: Picks,
): PickRow[] {
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
  const groups = portionGroups(dishes, keyOf, (row) => row.lineNo).map((members) => ({
    members,
    each: billGross([members[0]!, ...(extras.get(members[0]!.lineNo) ?? [])]),
    paid:
      paid !== null &&
      members.some((member) => compareDecimal(decimal(paid.get(member.lineNo) ?? "0"), ZERO) > 0),
  }));
  const pickedOf = (members: readonly TabLine[]) =>
    members.filter((member) => picks.has(member.id)).length;
  const pickedTotal = sumDecimals(
    groups
      .filter((group) => !group.paid)
      .map((group) => times(group.each, pickedOf(group.members))),
  );
  const kept = balance === null ? null : moneyPlus(balance.received, balance.reserved);
  return groups.map(({ members, each, paid: isPaid }): PickRow => {
    const picked = pickedOf(members);
    let limit = members.length;
    if (isPaid) limit = 0;
    else if (balance !== null && kept !== null) {
      let left = subtractDecimal(
        decimal(balance.total),
        subtractDecimal(pickedTotal, times(each, picked)),
      );
      limit = 0;
      while (limit < members.length) {
        left = subtractDecimal(left, each);
        if (compareDecimal(left, kept) < 0) break;
        limit++;
      }
    }
    let blocked: PickRow["blocked"] = null;
    if (isPaid) blocked = { reason: "paid" };
    else if (kept !== null && (picked > limit || (picked < members.length && picked >= limit)))
      blocked = { reason: "floor", kept };
    return { members, counted: members.length > 1, each, limit, blocked };
  });
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
 * The picks after a re-read. `before` is the rows last drawn; `rowsFor` draws the re-read bill's
 * rows over a set of picks, grouping them the same whatever the picks. Each row read before hands
 * its count to the unpaid row now holding most of its members (on a tie, the one drawn first), and
 * counts handed to one row add up. The rows then take their counts in the order they are drawn,
 * each its first members and never more than its limit over the picks already placed: together
 * they keep within the floor the rows' limits work out, and a row left short could not take one
 * more. An id in no row now (gone, or recalled into a draft) is dropped, and its row's count
 * stays, taken from the members left.
 */
export function tidyPicks(
  before: readonly PickRow[],
  rowsFor: (picks: Picks) => readonly PickRow[],
  picks: Picks,
): Picks {
  const after = rowsFor(new Set());
  const counts = new Map<string, number>();
  for (const old of before) {
    const count = pickedCount(old, picks);
    if (count === 0) continue;
    const ids = new Set(old.members.map((member) => member.id));
    let home: PickRow | undefined;
    let shared = 0;
    for (const row of after) {
      if (row.blocked?.reason === "paid") continue;
      const held = row.members.filter((member) => ids.has(member.id)).length;
      if (held > shared) {
        home = row;
        shared = held;
      }
    }
    if (home !== undefined) {
      const key = home.members[0]!.id;
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }
  let next: Picks = new Set();
  for (const { members } of after) {
    const count = counts.get(members[0]!.id);
    if (count === undefined) continue;
    const row = rowsFor(next).find((drawn) => drawn.members[0]!.id === members[0]!.id)!;
    next = setCount(row, count, next);
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
