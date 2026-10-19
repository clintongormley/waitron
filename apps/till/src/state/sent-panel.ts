import {
  type Decimal,
  MONEY_SCALE,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "@waitron/shared";
import { reminderDueAt } from "./release-reminder.js";
import { trimQuantity } from "../widgets/dish-format.js";
import type {
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  ReleaseReminder,
} from "../api/client.js";

export interface SentSlice {
  row: CurrentOrderRow;
  kind: "served" | "fired" | "held" | "cancelled_charged";
  quantity: string;
  amount: string;
}
export interface SentPanel {
  attention: boolean;
  served: SentSlice[];
  fired: SentSlice[];
  held: { group: CurrentOrderGroup; rows: SentSlice[]; companions: CurrentOrderRow[] }[];
  counts: { ready: string; firing: string; held: string; served: string };
  subtotals: { served: string; fired: string; held: string };
  reminder: ReleaseReminder | null;
}
const zero = decimal("0");
const positive = (value: Decimal) => compareDecimal(value, zero) > 0;
const bounded = (value: Decimal, max: Decimal): Decimal =>
  compareDecimal(value, zero) < 0 ? zero : compareDecimal(value, max) > 0 ? max : value;

function splitRow(row: CurrentOrderRow, held: boolean): SentSlice[] {
  const quantity = decimal(row.quantity);
  if (!positive(quantity)) return [];
  const cancelled = bounded(decimal(row.cancelledQuantity ?? "0"), quantity);
  const active = subtractDecimal(quantity, cancelled);
  const served = bounded(decimal(row.servedQuantity), active);
  const candidates: { kind: SentSlice["kind"]; quantity: Decimal }[] = [
    { kind: "cancelled_charged", quantity: cancelled },
    { kind: "served", quantity: served },
    { kind: held ? "held" : "fired", quantity: subtractDecimal(active, served) },
  ];
  const parts = candidates.filter((part) => positive(part.quantity));
  const total = decimal(row.netAmount);
  let remaining = total;
  return parts.map((part, index) => {
    // The last nonempty slice owns the rounding remainder of the stored family amount.
    const amount =
      index === parts.length - 1
        ? remaining
        : divideDecimal(multiplyDecimal(total, part.quantity), quantity, MONEY_SCALE);
    remaining = subtractDecimal(remaining, amount);
    return {
      row,
      kind: part.kind,
      quantity: trimQuantity(part.quantity),
      amount: toScale(amount, MONEY_SCALE),
    };
  });
}

export function sentPanel(current: CurrentOrders, billId: string, now: number): SentPanel {
  const served: SentSlice[] = [];
  const fired: SentSlice[] = [];
  const held: SentPanel["held"] = [];
  const take = (row: CurrentOrderRow, isHeld: boolean, heldRows: SentSlice[]) => {
    if (row.workingOrderId !== billId) return;
    for (const slice of splitRow(row, isHeld)) {
      if (slice.kind === "fired") fired.push(slice);
      else if (slice.kind === "held") heldRows.push(slice);
      else served.push(slice);
    }
  };
  for (const group of [...current.groups].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  )) {
    const rows: SentSlice[] = [];
    for (const row of group.rows) take(row, group.state === "held" && !row.released, rows);
    if (rows.length > 0)
      held.push({
        group,
        rows,
        companions: group.rows.filter(
          (row) =>
            row.workingOrderId !== billId &&
            splitRow(row, true).some((slice) => slice.kind === "held"),
        ),
      });
  }
  for (const row of current.ungrouped) take(row, false, []);
  const time = (value: string | null) =>
    value === null ? Number.POSITIVE_INFINITY : Date.parse(value);
  fired.sort((a, b) => {
    const aReady = a.row.readyAt !== null;
    const bReady = b.row.readyAt !== null;
    if (aReady !== bReady) return aReady ? -1 : 1;
    const order =
      time(aReady ? a.row.readyAt : a.row.firedAt) - time(bReady ? b.row.readyAt : b.row.firedAt);
    return order || a.row.lineId.localeCompare(b.row.lineId);
  });
  const heldRows = held.flatMap((group) => group.rows);
  const count = (rows: SentSlice[]) =>
    trimQuantity(sumDecimals(rows.map((slice) => decimal(slice.quantity))));
  const amount = (rows: SentSlice[]) =>
    toScale(sumDecimals(rows.map((slice) => decimal(slice.amount))), MONEY_SCALE);
  const ready = fired.filter((slice) => slice.row.readyAt !== null);
  return {
    attention: ready.length > 0 || reminderDueAt(current.reminder) <= now,
    served,
    fired,
    held,
    counts: {
      ready: count(ready),
      firing: trimQuantity(subtractDecimal(decimal(count(fired)), decimal(count(ready)))),
      held: count(heldRows),
      served: count(served),
    },
    subtotals: { served: amount(served), fired: amount(fired), held: amount(heldRows) },
    reminder: current.reminder,
  };
}
