import type { Transaction } from "@waitron/db";
import { validateBusinessDay, validateCutover, validateTimeZone } from "./business-day.js";
import { computeCashUp } from "./cash-up.js";
import { computeCloseCounts } from "./counts.js";
import { computeVatSummary } from "./vat-summary.js";
import type { DailyClose, DailyCloseInput } from "./types.js";

/**
 * The daily close for one (tenant, node) — or the whole tenant when `input.nodeId` is omitted (the
 * venue-wide dashboard overview) — over one business day: a VAT summary (issuance-anchored) and an
 * operational cash-up (settlement-anchored), plus record counts. Its three sub-aggregates each scope
 * by node only when one is given (`nodeScopeClause`). A pure, deterministic read over immutable
 * commercial records — recomputes identically once the day has passed (design §6). Inputs are
 * validated up front so a bad timezone/cutover fails before any query runs.
 */
export async function computeDailyClose(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<DailyClose> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDay(input.businessDay);

  const [vat, cash, counts] = await Promise.all([
    computeVatSummary(tx, input),
    computeCashUp(tx, input),
    computeCloseCounts(tx, input),
  ]);

  return {
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    timeZone: input.timeZone,
    vat,
    cash,
    counts,
  };
}
