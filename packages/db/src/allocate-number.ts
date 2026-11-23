import { eq, getTableName, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import { AppError } from "@waitron/shared";
// Side-effect only — nothing here is used as a value. This is what keeps `series.not_found`
// (declared in ./errors.ts via `declare module "@waitron/shared"`) visible outside this package;
// nothing in this package's own checks would catch its removal. The rule is in
// packages/shared/src/errors.ts's design comment.
import "./errors.js";
import type { Transaction } from "./client.js";
import { invoiceSeries } from "./schema/series.js";

/** Qualify the outer column so SQLite resolves it outside the sales subquery. */
export function nextInvoiceNumberOf(seriesId: AnyColumn | string): SQL<number> {
  const series =
    typeof seriesId === "string"
      ? sql`${seriesId}`
      : sql`${sql.identifier(getTableName(seriesId.table))}.${sql.identifier(seriesId.name)}`;
  return sql<number>`(
    select coalesce(max("sales"."invoice_number"), 0) + 1
    from "sales" where "sales"."series_id" = ${series}
  )`;
}

/**
 * Insert the sale under this number before allocating again in the same transaction. A
 * rollback leaves the number available. The unique series-and-number key on sales
 * refuses reuse of a recorded number.
 */
export async function allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number> {
  const [row] = await tx
    .select({ allocated: nextInvoiceNumberOf(seriesId) })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, seriesId));
  if (row === undefined) {
    throw new AppError("series.not_found", { seriesId });
  }
  return row.allocated;
}
