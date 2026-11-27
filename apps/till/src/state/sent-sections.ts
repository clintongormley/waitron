import { MONEY_SCALE, decimal, sumDecimals, toScale } from "@waitron/shared";
import type { CurrentOrderGroup, CurrentOrderRow, CurrentOrders } from "../api/kitchen-api.js";
import { trimQuantity } from "../widgets/dish-format.js";
import type { SentRowPortionKey } from "./portion-groups.js";
import { type SentSlice, sentPanel } from "./sent-panel.js";

export type SentRowState =
  "held" | "ready" | "at_the_pass" | "fired" | "served" | "cancelled_charged";

/** One sent row: a dish's served and unserved portions together, or a cancelled-but-charged part. */
export interface SentRow {
  /** By line number, and within a line served before unserved. */
  slices: SentSlice[];
  /** The unserved slices, by line number. */
  left: SentSlice[];
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
  held: boolean;
  rows: SentRow[];
  /** Other bills' held dishes in the group, which Fire sends too. */
  companions: CurrentOrderRow[];
  title: SentSectionTitle;
}

const sum = (values: readonly string[]) => sumDecimals(values.map((value) => decimal(value)));
const time = (value: string | null) =>
  value === null ? Number.POSITIVE_INFINITY : Date.parse(value);

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
  for (const slice of slices) {
    const id = `${slice.kind === "cancelled_charged"}:${slice.row.lineId}`;
    units.set(id, [...(units.get(id) ?? []), slice]);
  }
  const groups: { key: SentRowPortionKey | null; slices: SentSlice[] }[] = [];
  for (const unit of units.values()) {
    const key = unit.length === 1 ? portionKey(unit[0]!) : null;
    const same = key && groups.find((group) => group.key && sameKey(group.key, key));
    if (same) same.slices.push(...unit);
    else groups.push({ key, slices: [...unit] });
  }
  for (const servedGroup of groups.filter((group) => group.key?.progress === null)) {
    const host = groups.find(
      (group) => group.key?.progress != null && group.key.dish === servedGroup.key!.dish,
    );
    if (host === undefined) continue;
    host.slices.push(...servedGroup.slices);
    groups.splice(groups.indexOf(servedGroup), 1);
  }
  return groups.map(({ slices: members }) => members.sort((a, b) => a.row.lineNo - b.row.lineNo));
}

const sameKey = (a: SentRowPortionKey, b: SentRowPortionKey) =>
  a.dish === b.dish && a.progress === b.progress;

function compareRows(a: SentRow, b: SentRow): number {
  const aLeft = a.left[0]?.row;
  const bLeft = b.left[0]?.row;
  if (aLeft === undefined || bLeft === undefined)
    return aLeft !== bLeft
      ? aLeft === undefined
        ? 1
        : -1
      : a.slices[0]!.row.lineNo - b.slices[0]!.row.lineNo;
  if (a.state === "held" && b.state === "held")
    return aLeft.lineNo - bLeft.lineNo || aLeft.lineId.localeCompare(bLeft.lineId);
  const aReady = aLeft.readyAt !== null;
  const bReady = bLeft.readyAt !== null;
  if (aReady !== bReady) return aReady ? -1 : 1;
  const order =
    time(aReady ? aLeft.readyAt : aLeft.firedAt) - time(bReady ? bLeft.readyAt : bLeft.firedAt);
  return order || aLeft.lineId.localeCompare(bLeft.lineId);
}

/**
 * The bill's sent dishes as the order screen lists them: one section per fire group in firing
 * order, then the rows sent outside any group. `portionKey` joins identical one-portion lines
 * into one row; without it each line is its own row.
 */
export function sentSections(
  current: CurrentOrders,
  billId: string,
  now: number,
  portionKey: (slice: SentSlice) => SentRowPortionKey | null = () => null,
): SentSection[] {
  const panel = sentPanel(current, billId, now);
  const groupOf = new Map<CurrentOrderRow, CurrentOrderGroup>();
  for (const group of current.groups) for (const row of group.rows) groupOf.set(row, group);
  const sliced = new Map<CurrentOrderGroup | null, SentSlice[]>();
  for (const slice of [...panel.served, ...panel.fired, ...panel.held.flatMap((g) => g.rows)]) {
    const group = groupOf.get(slice.row) ?? null;
    sliced.set(group, [...(sliced.get(group) ?? []), slice]);
  }
  const courseOrder = (id: string) =>
    current.retainedCourses.find((course) => course.id === id)?.displayOrder ?? -1;
  const ordered = [...current.groups].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const sections: SentSection[] = [];
  for (const group of [...ordered, null]) {
    const slices = sliced.get(group);
    if (slices === undefined) continue;
    const heldEntry = panel.held.find((entry) => entry.group === group);
    const rows = joinRows(slices, portionKey).map(toRow).sort(compareRows);
    const companions = heldEntry?.companions ?? [];
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
      held: heldEntry !== undefined,
      rows,
      companions,
      title: {
        courseIds,
        state:
          heldEntry !== undefined
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
