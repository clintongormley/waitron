import { worstBand, type TimingBand } from "@waitron/shared";
import type { TableState } from "../api/client.js";
import { reminderDueAt } from "./release-reminder.js";

/**
 * A757 §4's order, most urgent first, for the states that exist today; Waiter called (row 5, A508)
 * goes between `fire` and `bill` when it is built.
 */
export const PRECEDENCE = [
  "forgotten",
  "overdue",
  "unavailable",
  "fire",
  "bill",
  "ready",
  "step",
  "not-sent",
  "waiting",
  "clearing",
  "held",
  "nothing-needed",
  "reserved",
  "free",
] as const;

export type TableStateKind = (typeof PRECEDENCE)[number];

/** The worse of the table's own band and its `long_wait` signal's. */
export function lateBand(table: TableState): TimingBand {
  const longWait = table.signals.find((signal) => signal.kind === "long_wait");
  return worstBand([table.timingBand, longWait?.band ?? "fresh"]);
}

/** Every state the table is in, in `PRECEDENCE` order. */
export function tableStates(table: TableState, now: number): TableStateKind[] {
  const has = (kind: TableState["signals"][number]["kind"]) =>
    table.signals.some((signal) => signal.kind === kind);
  const band = lateBand(table);
  const fire = table.party !== null && reminderDueAt(table.party.reminder) <= now;
  const active = new Set<TableStateKind>();
  if (band === "forgotten") active.add("forgotten");
  if (band === "overdue") active.add("overdue");
  if (has("held_unavailable")) active.add("unavailable");
  if (fire) active.add("fire");
  if (has("bill_requested")) active.add("bill");
  if (has("ready") || table.readyToServe > 0) active.add("ready");
  if (has("take_order")) active.add("step");
  if ((table.party?.unsentDrafts.length ?? 0) > 0) active.add("not-sent");
  if (band === "warm") active.add("waiting");
  if (table.condition === "needs_clearing") active.add("clearing");
  if (has("held") && !fire) active.add("held");
  if (table.party !== null && active.size === 0) active.add("nothing-needed");
  if (table.nextReservation !== null) active.add("reserved");
  if (table.state === "free" && table.condition === "free") active.add("free");
  return PRECEDENCE.filter((kind) => active.has(kind));
}

/** A stable sort by `PRECEDENCE`; items with no kind go after every kind. */
export function byPrecedence<T>(
  items: readonly T[],
  kindOf: (item: T) => TableStateKind | undefined,
): T[] {
  const rank = (item: T) => {
    const kind = kindOf(item);
    return kind === undefined ? PRECEDENCE.length : PRECEDENCE.indexOf(kind);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
