import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "./runtime.js";

/** The `last_error` of a job {@link endDeletedPrinterJobs} ended: a code the dashboard words. */
export const PRINTER_DELETED = "printer.deleted";

/** Every job of the printer still waiting or out with an agent, whoever claimed it and however
 * long ago: a deleted printer's claim never comes back as an outcome that counts. */
function printerDeleteJobPredicate(printerId: string): SQL {
  return sql`printer_id = ${printerId} and (
    status in ('queued', 'printing') or
    (status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS}))`;
}

export async function readPrinterDeleteJobIds(
  tx: Transaction,
  printerId: string,
): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    select id from print_jobs where ${printerDeleteJobPredicate(printerId)}`);
  return result.rows.map((row) => row.id);
}

/** Ends the jobs {@link readPrinterDeleteJobIds} reads, unbatched, leaving their claim as it was. */
export async function endDeletedPrinterJobs(tx: Transaction, printerId: string): Promise<string[]> {
  const ended = await tx.execute<{ id: string }>(sql`
    update print_jobs set status = 'failed', attempts = ${MAX_DELIVERY_ATTEMPTS},
      last_error = ${PRINTER_DELETED}
    where ${printerDeleteJobPredicate(printerId)} returning id`);
  return ended.rows.map((row) => row.id);
}
