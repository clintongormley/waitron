import { MONEY_SCALE, decimal, sumDecimals, toScale } from "@waitron/shared";
import type { CurrentOrderGroup, CurrentOrderRow, CurrentOrders } from "../api/kitchen-api.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { type SentRowPortionKey, sentRowId } from "./portion-groups.js";
import { type SentSlice, byFiringOrder, sentPanel, time, waitsForFire } from "./sent-panel.js";

export type SentRowState =
  "held" | "ready" | "at_the_pass" | "fired" | "served" | "cancelled_charged";

/** One sent row: a dish's served and unserved portions together, or a cancelled-but-charged part. */
export interface SentRow {
  /** By line number, and within a line served before unserved. */
  slices: SentSlice[];
  /** The unserved slices, by line number. */
  left: SentSlice[];
  /** The slice its information, hold and marks speak for: the first left, or else the first. */
  lead: SentSlice;
  /** Stable across reads: whether it is the cancelled-but-charged part, and its first line. */
  id: string;
  state: SentRowState;
  quantity: string;
  served: string;
  amount: string;
}

export interface SentSectionTitle {
  /** The course ids of its rows, in course order, those in no course left out. */
  courseIds: string[];
  state: "fired" | "at_the_pass" | "held";
  firedAt: string | null;
}

export interface SentSection {
  /** Null for the rows sent outside any group. */
  group: CurrentOrderGroup | null;
  rows: SentRow[];
  /** Other bills' held dishes in the group, which Fire sends too. */
  companions: CurrentOrderRow[];
  title: SentSectionTitle;
}

const sum = (values: readonly string[]) => sumDecimals(values.map((value) => decimal(value)));
const unitId = (slice: SentSlice) => `${slice.kind === "cancelled_charged"}:${slice.row.lineId}`;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function stateOf(slices: readonly SentSlice[], left: readonly SentSlice[]): SentRowState {
  if (slices[0]!.kind === "cancelled_charged") return "cancelled_charged";
  const first = left[0];
  if (first === undefined) return "served";
  if (first.kind === "held") return "held";
  const { row } = first;
  if (!row.released) return "held";
  if (row.readyAt !== null) return "ready";
  return row.firedAt === null && row.requestedAt !== null ? "at_the_pass" : "fired";
}

function toRow(slices: SentSlice[]): SentRow {
  const left = slices.filter((slice) => slice.kind === "fired" || slice.kind === "held");
  return {
    slices,
    left,
    lead: left[0] ?? slices[0]!,
    id: unitId(slices[0]!),
    state: stateOf(slices, left),
    quantity: trimQuantity(sum(slices.map((slice) => slice.quantity))),
    served: trimQuantity(
      sum(slices.filter((slice) => slice.kind === "served").map((slice) => slice.quantity)),
    ),
    amount: toScale(sum(slices.map((slice) => slice.amount)), MONEY_SCALE),
  };
}

/** A line's served and unserved slices as one unit, its cancelled-but-charged part as another;
 * then units of identical one-portion lines joined, a served unit with the first unserved one
 * whose dish it shares. */
function joinRows(
  slices: readonly SentSlice[],
  portionKey: (slice: SentSlice) => SentRowPortionKey | null,
): SentSlice[][] {
  const units = new Map<string, SentSlice[]>();
  for (const slice of slices) push(units, unitId(slice), slice);
  const groups: { key: SentRowPortionKey | null; slices: SentSlice[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const unit of units.values()) {
    const key = unit.length === 1 ? portionKey(unit[0]!) : null;
    const id = key && sentRowId(key);
    const same = id ? byKey.get(id) : undefined;
    if (same) {
      same.slices.push(...unit);
      continue;
    }
    const group = { key, slices: [...unit] };
    if (id) byKey.set(id, group);
    groups.push(group);
  }
  const hosts = new Map<string, (typeof groups)[number]>();
  for (const group of groups)
    if (group.key?.progress != null && !hosts.has(group.key.dish)) hosts.set(group.key.dish, group);
  const joined = groups.filter((group) => {
    const host = group.key?.progress === null ? hosts.get(group.key.dish) : undefined;
    if (host === undefined) return true;
    host.slices.push(...group.slices);
    return false;
  });
  return joined.map(({ slices: members }) => members.sort((a, b) => a.row.lineNo - b.row.lineNo));
}

const byNumber = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

/** Each row's place: something left before nothing left; among the rows with something left,
 * ready, then the other released rows, then held rows, which have no time to sort by. */
function rank(row: SentRow): number {
  const left = row.left[0]?.row;
  if (left === undefined) return 3;
  if (row.state === "held") return 2;
  return left.readyAt === null ? 1 : 0;
}

function compareRows(
  a: SentRow,
  b: SentRow,
  readOrder: Map<CurrentOrderRow, number>,
  when: Map<SentRow, number>,
): number {
  const order = rank(a) - rank(b);
  if (order !== 0) return order;
  if (rank(a) === 3)
    return a.slices[0]!.row.lineNo - b.slices[0]!.row.lineNo || a.id.localeCompare(b.id);
  const aLeft = a.left[0]!.row;
  const bLeft = b.left[0]!.row;
  if (rank(a) === 2) return readOrder.get(aLeft)! - readOrder.get(bLeft)!;
  return byNumber(when.get(a)!, when.get(b)!) || aLeft.lineId.localeCompare(bLeft.lineId);
}

/**
 * The bill's sent dishes as the order screen lists them: one section per fire group in firing
 * order, then the rows sent outside any group. `portionKey` joins identical one-portion lines
 * into one row; without it each line is its own row.
 */
export function sentSections(
  current: CurrentOrders,
  billId: string,
  portionKey: (slice: SentSlice) => SentRowPortionKey | null = () => null,
): SentSection[] {
  const panel = sentPanel(current, billId);
  const groupOf = new Map<CurrentOrderRow, CurrentOrderGroup>();
  const readOrder = new Map<CurrentOrderRow, number>();
  for (const group of current.groups)
    for (const row of group.rows) {
      groupOf.set(row, group);
      readOrder.set(row, readOrder.size);
    }
  for (const row of current.ungrouped) readOrder.set(row, readOrder.size);
  const sliced = new Map<CurrentOrderGroup | null, SentSlice[]>();
  for (const slice of [...panel.served, ...panel.fired, ...panel.held.flatMap((g) => g.rows)])
    push(sliced, groupOf.get(slice.row) ?? null, slice);
  const displayOrder = new Map<string, number>();
  for (const course of current.retainedCourses)
    if (!displayOrder.has(course.id)) displayOrder.set(course.id, course.displayOrder);
  const courseOrder = (id: string) => displayOrder.get(id) ?? -1;
  const ordered = [...current.groups].sort(byFiringOrder);
  const sections: SentSection[] = [];
  for (const group of [...ordered, null]) {
    const slices = sliced.get(group);
    if (slices === undefined) continue;
    const rows = joinRows(slices, portionKey).map(toRow);
    const when = new Map(
      rows.map((row) => [row, time(row.left[0]?.row.readyAt ?? row.left[0]?.row.firedAt ?? null)]),
    );
    rows.sort((a, b) => compareRows(a, b, readOrder, when));
    const holding = group?.state === "held" && group.rows.some(waitsForFire);
    const companions = holding
      ? group.rows.filter((row) => row.workingOrderId !== billId && waitsForFire(row))
      : [];
    const courseIds = [
      ...new Set([...slices.map((slice) => slice.row), ...companions].map((row) => row.courseId)),
    ]
      .filter((id) => id !== null)
      .sort((a, b) => courseOrder(a) - courseOrder(b));
    const waiting = rows.filter((row) => row.left.length > 0);
    const firedAt =
      group === null
        ? (slices
            .map((slice) => slice.row.firedAt)
            .filter((value) => value !== null)
            .sort((a, b) => time(a) - time(b))[0] ?? null)
        : group.firedAt;
    sections.push({
      group,
      rows,
      companions,
      title: {
        courseIds,
        state: holding
          ? "held"
          : waiting.length > 0 && waiting.every((row) => row.state === "at_the_pass")
            ? "at_the_pass"
            : "fired",
        firedAt,
      },
    });
  }
  return sections;
}
