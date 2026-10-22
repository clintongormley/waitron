import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { StaffNotice, StaffNoticeReadContext, StaffNoticeSource } from "@waitron/module";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";

/** The clock notice for one reading: a `clock.unusable` notice before the first issue date
 * `@waitron/verifactu` accepts, judged in the reading's own offset; nothing on or after it. */
export function clockNotices(reading: { instant: Date; offsetMinutes: number }): StaffNotice[] {
  if (!isBeforeFirstIssueDate(reading)) return [];
  return [
    {
      key: "clock.unusable",
      code: "clock.unusable",
      severity: "error",
      params: { clockAt: reading.instant.toISOString(), offsetMinutes: reading.offsetMinutes },
    },
  ];
}

/** The unsent-records notice: while records wait to reach AEAT, once one of them carries the
 * drain's mark of a send that did not land, or while the drain's technical incident is open. */
export async function unsentNotices(
  tx: Transaction,
  filing: StaffNoticeReadContext["filing"],
): Promise<StaffNotice[]> {
  if (filing?.enabled !== true) return [];
  const { rows } = await tx.execute<{
    n: number;
    held: number;
    failed: number;
    open: number | null;
  }>(sql`
    select count(*) as n,
           coalesce(sum(estado = 'retenido'), 0) as held,
           coalesce(max(incidencia or technical_incidence), 0) as failed,
           (select technical_incident_token is not null from envio_flujo where id = 1) as open
    from envios
    where estado in ('pendiente', 'enviando', 'detenido', 'retenido')
  `);
  const { n, held, failed, open } = rows[0]!;
  if (n === 0 || (failed !== 1 && open !== 1)) return [];
  return [
    {
      key: "fiscal.records_unsent",
      code: "fiscal.records_unsent",
      severity: "notice",
      params: { count: n, held },
    },
  ];
}

export const FISCAL_STAFF_NOTICES: readonly StaffNoticeSource[] = [
  {
    read: async ({ tx, reading, filing }) => [
      ...clockNotices(reading),
      ...(await unsentNotices(tx, filing)),
    ],
  },
];
