import type { printers, Transaction } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { sql } from "drizzle-orm";

export async function readPrinterJobSummaries(
  tx: Transaction,
  kind: typeof printers.$inferSelect.kind,
) {
  // Aggregated over the full history, unlike the job list's bounded completed history.
  // `max(delivered_at)` is the latest instant only because every writer stores the canonical
  // `toISOString()` spelling.
  const summaries = await tx.execute<{
    printer_id: string;
    pending_jobs: number;
    last_print_at: string | null;
    last_print_agent_id: string | null;
  }>(sql`
    select printer_id,
      cast(count(*) filter (where status in ('queued', 'printing')
        or (kind = 'document' and status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS})) as int) as pending_jobs,
      max(delivered_at) as last_print_at,
      (select latest.claimed_by from print_jobs latest
        where latest.printer_id = jobs.printer_id and latest.delivered_at is not null
        order by latest.delivered_at desc, latest.id desc limit 1) as last_print_agent_id
    from print_jobs jobs
    where printer_id in (select id from printers where kind = ${kind} and deleted_at is null)
    group by printer_id`);
  return new Map(
    summaries.rows.map((row) => [
      row.printer_id,
      {
        pendingJobs: row.pending_jobs,
        lastPrintAgentId: row.last_print_agent_id,
        lastPrintAt: row.last_print_at === null ? null : new Date(row.last_print_at).toISOString(),
      },
    ]),
  );
}
