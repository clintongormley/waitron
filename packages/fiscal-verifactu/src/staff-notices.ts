import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { StaffNotice, StaffNoticeReadContext, StaffNoticeSource } from "@waitron/module";
import { clockBehindChain } from "./clock-behind.js";
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

/** `clock.unusable` before the first issue date, else `clock.behind_chain` while the reading is
 * more than the margin before the latest record, else nothing. */
async function clockStopNotices(
  tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<StaffNotice[]> {
  const unusable = clockNotices(reading);
  if (unusable.length > 0) return unusable;
  const behind = await clockBehindChain(tx, reading);
  if (behind === null) return [];
  return [
    {
      key: "clock.behind_chain",
      code: "clock.behind_chain",
      severity: "error",
      params: { ...behind },
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
      ...(await clockStopNotices(tx, reading)),
      ...(await unsentNotices(tx, filing)),
    ],
  },
];
