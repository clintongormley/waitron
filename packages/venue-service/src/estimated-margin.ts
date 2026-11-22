import { and, asc, eq, isNotNull } from "drizzle-orm";
import { AppError, basisPointsToDecimal, stringToBasisPoints } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { departments } from "@waitron/db";
import "./errors.js";

const MARGIN_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const MAX_MARGIN_BP = 10000;

/** A request's `estimatedMargin`: `null` clears it, a dot-decimal percent string from 0 to 100
 * with at most two places is whole basis points ("30.5" is 3050). */
export function requireEstimatedMargin(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "string" && MARGIN_PATTERN.test(value)) {
    const bp = stringToBasisPoints(value);
    if (bp <= MAX_MARGIN_BP) return bp;
  }
  throw new AppError("management.request_invalid", { field: "estimatedMargin" });
}

/** Each active department that has an estimated margin, as a two-place percent ("30.00"). */
export async function listEstimatedMarginByDepartment(
  tx: Transaction,
): Promise<Record<string, string>> {
  const rows = await tx
    .select({ id: departments.id, bp: departments.estimatedMarginBp })
    .from(departments)
    .where(and(eq(departments.active, true), isNotNull(departments.estimatedMarginBp)))
    .orderBy(asc(departments.id));
  return Object.fromEntries(rows.map((row) => [row.id, basisPointsToDecimal(row.bp!)]));
}
