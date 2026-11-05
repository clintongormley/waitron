import {
  type Decimal,
  MONEY_SCALE,
  compareDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import type { BillBalance, Draft, PartyBill, SplitSelection, TabLine } from "../api/client.js";
import { owing, shownBills } from "./bill-state.js";
import {
  type PickGroups,
  type PickRow,
  type Picks,
  pickGroups,
  pickRows,
  pickedLineIds,
  pickedTotal,
  tidyPicks,
} from "./portion-selection.js";

export type { SplitSelection };

export interface SplitSource {
  bill: PartyBill;
  groups: PickGroups;
  /** Someone else's unsent dishes hold it: no new tick until taken over; an existing tick stays
   * (D21). `ownerName` is null for a holder the server has no name for. `takenFromYou`: the holder
   * took the order from this person. */
  held: {
    draftId: string;
    revision: number;
    ownerName: string | null;
    takenFromYou: boolean;
  } | null;
  /** This person's own unsent dishes on it: a saved draft, or dishes recalled on screen. */
  ownUnsent: boolean;
}

export interface SplitPicks {
  whole: ReadonlySet<string>;
  picks: ReadonlyMap<string, Picks>;
}

/** What the leaving table takes and the staying table keeps, each in number order. */
export interface SplitSummary {
  takes: {
    whole: SplitSource[];
    loose: { source: SplitSource; count: number }[];
    amount: Decimal;
  };
  keeps: {
    whole: SplitSource[];
    /** Bills that keep what was not picked from them. */
    rest: SplitSource[];
    amount: Decimal;
  };
}

const NO_PICKS: Picks = new Set();

const ZERO = decimal("0");

const idOf = (source: SplitSource) => source.bill.workingOrderId;

const picksOn = (source: SplitSource, split: SplitPicks) =>
  split.picks.get(idOf(source)) ?? NO_PICKS;

const presented = (source: SplitSource) => source.bill.status === "placed";

function inNumberOrder(sources: readonly SplitSource[]): SplitSource[] {
  const byId = new Map(sources.map((source) => [idOf(source), source]));
  return shownBills(sources.map((source) => source.bill)).map((bill) =>
    byId.get(bill.workingOrderId)!,
  );
}

export function billTick(source: SplitSource, split: SplitPicks): "none" | "some" | "all" {
  if (split.whole.has(idOf(source))) return "all";
  return picksOn(source, split).size > 0 ? "some" : "none";
}

/** A copy of the selection with the bill's tick and picks gone. */
function without(split: SplitPicks, id: string): { whole: Set<string>; picks: Map<string, Picks> } {
  const whole = new Set(split.whole);
  const picks = new Map(split.picks);
  whole.delete(id);
  picks.delete(id);
  return { whole, picks };
}

/** Whole keeps the bill's number, name and payments, so a paid dish or this person's unsent dishes,
 * which go only if the whole bill is chosen, leave the picks as picks. */
function picksEveryDish(source: SplitSource, picks: Picks): boolean {
  return (
    !source.ownUnsent &&
    source.groups.groups.every(
      (group) => !group.paid && group.members.every((member) => picks.has(member.id)),
    )
  );
}

function place(
  into: { whole: Set<string>; picks: Map<string, Picks> },
  source: SplitSource,
  picks: Picks,
): void {
  if (picks.size === 0) return;
  if (picksEveryDish(source, picks)) into.whole.add(idOf(source));
  else into.picks.set(idOf(source), picks);
}

export function toggleBill(source: SplitSource, split: SplitPicks): SplitPicks {
  const tick = billTick(source, split);
  if (source.held !== null && tick === "none") return split;
  const next = without(split, idOf(source));
  if (source.held === null && tick !== "all") next.whole.add(idOf(source));
  return next;
}

export function pickOnBill(source: SplitSource, split: SplitPicks, next: Picks): SplitPicks {
  if (source.held !== null || presented(source)) return split;
  const out = without(split, idOf(source));
  const { groups } = source;
  place(out, source, tidyPicks(pickRows(groups, next), groups, next));
  return out;
}

/** A held bill's rows are still returned: the screen hides them, and `tidySplit` needs them as its
 * `before` to bring the picks back when the order goes. */
export function rowsOf(source: SplitSource, split: SplitPicks): PickRow[] {
  if (presented(source))
    return pickRows(source.groups, NO_PICKS).map((row) => ({
      ...row,
      limit: 0,
      blocked: { reason: "presented" },
    }));
  if (split.whole.has(idOf(source)))
    return pickRows(source.groups, NO_PICKS).map((row) =>
      row.blocked?.reason === "floor" ? { ...row, blocked: null } : row,
    );
  return pickRows(source.groups, picksOn(source, split));
}

export function toSelection(sources: readonly SplitSource[], split: SplitPicks): SplitSelection {
  const ordered = inNumberOrder(sources);
  return {
    wholeBillIds: ordered.filter((source) => split.whole.has(idOf(source))).map(idOf),
    loose: ordered.flatMap((source) => {
      if (split.whole.has(idOf(source))) return [];
      const lineIds = pickedLineIds(rowsOf(source, split), picksOn(source, split));
      return lineIds.length === 0 ? [] : [{ billId: idOf(source), lineIds }];
    }),
  };
}

const stays = (source: SplitSource, split: SplitPicks) =>
  owing(source.bill) && !split.whole.has(idOf(source));

export function nothingStays(sources: readonly SplitSource[], split: SplitPicks): boolean {
  return (
    sources.some((source) => split.whole.has(idOf(source))) &&
    sources.every(
      (source) =>
        !stays(source, split) ||
        (source.groups.groups.length === 0 && !source.ownUnsent && source.held === null),
    )
  );
}

/** Selected bills someone else's unsent order now holds, in number order (D21). */
export function heldSelected(sources: readonly SplitSource[], split: SplitPicks): SplitSource[] {
  return inNumberOrder(sources).filter(
    (source) => source.held !== null && billTick(source, split) !== "none",
  );
}

export const billTotal = (source: SplitSource) =>
  source.groups.floor?.total ?? decimal(source.bill.total);

const pickedFrom = (source: SplitSource, split: SplitPicks) =>
  pickedTotal(source.groups, picksOn(source, split));

const money = (values: readonly Decimal[]) => toScale(sumDecimals(values), MONEY_SCALE);

export function splitSummary(sources: readonly SplitSource[], split: SplitPicks): SplitSummary {
  const ordered = inNumberOrder(sources);
  const whole = ordered.filter((source) => split.whole.has(idOf(source)));
  const loose = ordered.flatMap((source) => {
    if (split.whole.has(idOf(source))) return [];
    const count = pickedLineIds(rowsOf(source, split), picksOn(source, split)).length;
    return count === 0 ? [] : [{ source, count }];
  });
  const rest = loose.map(({ source }) => source);
  const staying = ordered.filter((source) => stays(source, split) && !rest.includes(source));
  const pickedOf = (source: SplitSource) => pickedFrom(source, split);
  return {
    takes: {
      whole,
      loose,
      amount: money([...whole.map(billTotal), ...rest.map(pickedOf)]),
    },
    keeps: {
      whole: staying,
      rest,
      amount: money([
        ...staying.map(billTotal),
        ...rest.map((source) => subtractDecimal(billTotal(source), pickedOf(source))),
      ]),
    },
  };
}

/**
 * Whether the staying table owes nothing once the split is pressed: every bill staying owes nothing
 * and one has money received, here or on a paid bill (`anyPaid`). Money received is
 * `floor.received`, so a card in progress does not count. An untouched bill must hold money of its
 * own, which an empty one does not. A bill with unsent dishes counts as owing, as the server leaves
 * it open (`issueIfFullyPaid`), and so does a pick left on a bill paid since, which the split does
 * not finish.
 */
export function leftWithNothingToPay(
  sources: readonly SplitSource[],
  split: SplitPicks,
  anyPaid: boolean,
): boolean {
  const { whole, rest } = splitSummary(sources, split).keeps;
  const received = (source: SplitSource) => source.groups.floor?.received ?? ZERO;
  const holdsMoney = (source: SplitSource) => compareDecimal(received(source), ZERO) > 0;
  const covers = (source: SplitSource, left: Decimal) =>
    !source.ownUnsent && source.held === null && compareDecimal(left, received(source)) <= 0;
  return (
    (anyPaid || [...whole, ...rest].some(holdsMoney)) &&
    whole.every((source) => holdsMoney(source) && covers(source, billTotal(source))) &&
    rest.every(
      (source) =>
        owing(source.bill) &&
        covers(source, subtractDecimal(billTotal(source), pickedFrom(source, split))),
    )
  );
}

/** Which note Everything ticked shows; `anyPaid`: a paid bill stays in the party or its family. */
export function anywayNote(
  sources: readonly SplitSource[],
  split: SplitPicks,
  anyPaid: boolean,
): "empty" | "paid" {
  return anyPaid && !sources.some((source) => stays(source, split)) ? "paid" : "empty";
}

/**
 * The panel's rows from the read (D11), the party's bills, every draft of the party and this person.
 * A bill the bills list does not hold is left out until the next read. `recalled` is the bill on
 * screen's unsaved recalls, which no draft read has yet.
 */
export function splitSourcesFrom(
  read: { bills: readonly { billId: string; lines: readonly TabLine[]; balance: BillBalance }[] },
  bills: readonly PartyBill[],
  drafts: readonly Draft[],
  personId: string,
  recalled: ReadonlySet<string>,
  keyFor: (lines: readonly TabLine[], balance: BillBalance) => (dish: TabLine) => string | null,
): SplitSource[] {
  const billById = new Map(bills.map((bill) => [bill.workingOrderId, bill]));
  const inAnyDraft = new Set(recalled);
  const foreign = new Map<string, Draft>();
  const withOwnDraft = new Set<string>();
  for (const draft of drafts) {
    for (const line of draft.lines)
      if (line.sourceLineId !== null) inAnyDraft.add(line.sourceLineId);
    if (draft.ownerId === personId) withOwnDraft.add(draft.billId);
    else foreign.set(draft.billId, draft);
  }
  const sources = read.bills.flatMap(({ billId, lines, balance }): SplitSource[] => {
    const bill = billById.get(billId);
    if (bill === undefined) return [];
    const holder = foreign.get(billId);
    return [
      {
        bill,
        groups: pickGroups(lines, keyFor(lines, balance), balance, inAnyDraft),
        held:
          holder === undefined
            ? null
            : {
                draftId: holder.id,
                revision: holder.revision,
                // The server sends "" for a person it has no name for (`order-drafts.ts`).
                ownerName: holder.ownerName === "" ? null : holder.ownerName,
                takenFromYou: holder.takenOverFrom?.personId === personId,
              },
        ownUnsent: withOwnDraft.has(billId) || lines.some((line) => recalled.has(line.id)),
      },
    ];
  });
  return inNumberOrder(sources);
}

/** After a read (D21). `gone`: selected bills the read no longer lists. `changed`: bills still listed
 * that lost a pick or whose picks became the whole bill. A held bill is in neither: it stays selected.
 * Both in the order of `before`. */
export function tidySplit(
  before: ReadonlyMap<string, readonly PickRow[]>,
  sources: readonly SplitSource[],
  split: SplitPicks,
): { split: SplitPicks; gone: string[]; changed: string[] } {
  const byId = new Map(sources.map((source) => [idOf(source), source]));
  const out = { whole: new Set<string>(), picks: new Map<string, Picks>() };
  const gone: string[] = [];
  const changed: string[] = [];
  for (const id of new Set([...before.keys(), ...split.whole, ...split.picks.keys()])) {
    const isWhole = split.whole.has(id);
    const old = split.picks.get(id) ?? NO_PICKS;
    if (!isWhole && old.size === 0) continue;
    const source = byId.get(id);
    if (source === undefined) gone.push(id);
    else if (isWhole) out.whole.add(id);
    else if (source.held !== null) out.picks.set(id, old);
    else {
      const next = presented(source)
        ? NO_PICKS
        : tidyPicks(before.get(id) ?? [], source.groups, old);
      place(out, source, next);
      if (out.whole.has(id) || [...old].some((pick) => !next.has(pick))) changed.push(id);
    }
  }
  return { split: out, gone, changed };
}
