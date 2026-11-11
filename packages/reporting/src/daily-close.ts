import type { Transaction } from "@waitron/db";
import { validateBusinessDay, validateCutover, validateTimeZone } from "./business-day.js";
import { decimal } from "@waitron/shared";
import { computeDepartmentClosedBills } from "./closed-bills.js";
import { computeCashUp, computeDepartmentCashUp } from "./cash-up.js";
import { computeCloseCounts } from "./counts.js";
import { computeVatSummary } from "./vat-summary.js";
import type { DailyClose, DailyCloseInput, DepartmentTakings } from "./types.js";

/**
 * The daily close for a list of boxes — or the whole venue when `input.nodeIds` is omitted (the
 * venue-wide dashboard overview) — over one business day: a VAT summary (sales on their issue
 * day, a void on the day it was made) and an operational cash-up (settlement-anchored), plus record
 * counts and department subtotals. Each aggregate scopes by box only when a list is given. Inputs are validated
 * before any query runs.
 */
export async function computeDailyClose(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<DailyClose> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDay(input.businessDay);

  // Awaited in turn on the one transaction, never `Promise.all` (docs/developers/conventions-data.md).
  const vat = await computeVatSummary(tx, input);
  const cash = await computeCashUp(tx, input);
  const counts = await computeCloseCounts(tx, input);
  const departmentCash = await computeDepartmentCashUp(tx, input);
  const departmentBills = await computeDepartmentClosedBills(tx, input);
  const departments = new Map<string | null, DepartmentTakings>();
  for (const { line, ...department } of departmentCash) {
    let row = departments.get(department.departmentId);
    if (row === undefined) {
      row = { ...department, byMethod: [], billsClosed: { count: 0, total: decimal("0.00") } };
      departments.set(department.departmentId, row);
    }
    row.byMethod.push(line);
  }
  for (const department of departmentBills) {
    const row = departments.get(department.departmentId);
    if (row === undefined)
      departments.set(department.departmentId, { ...department, byMethod: [] });
    else row.billsClosed = department.billsClosed;
  }
  const departmentTakings = [...departments.values()].sort(
    (a, b) =>
      Number((a.departmentId ?? "") > (b.departmentId ?? "")) -
      Number((a.departmentId ?? "") < (b.departmentId ?? "")),
  );

  return {
    nodeId: input.nodeIds?.[0],
    businessDay: input.businessDay,
    timeZone: input.timeZone,
    vat,
    cash,
    counts,
    departmentTakings,
  };
}
