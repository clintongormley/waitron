import "./errors.js";
import { desc } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ClockBehindLatestRecord } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { registrosFacturacion } from "./schema/registros.js";

/** A reading exactly this much earlier than the latest record still sells. */
export const CLOCK_BEHIND_MARGIN_MS = 60_000;

/** Reads every chain, not the reading's node's: a restored database may hold only an older
 * chain's records, and a new chain must not start before them. */
export async function clockBehindChain(
  tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<ClockBehindLatestRecord | null> {
  const [latest] = await tx
    .select({
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
      offsetMinutes: registrosFacturacion.offsetMinutos,
    })
    .from(registrosFacturacion)
    .orderBy(desc(registrosFacturacion.fechaHoraHusoGenRegistro))
    .limit(1);
  if (
    latest !== undefined &&
    reading.instant.getTime() < latest.at.getTime() - CLOCK_BEHIND_MARGIN_MS
  ) {
    return {
      clockAt: reading.instant.toISOString(),
      offsetMinutes: reading.offsetMinutes,
      lastRecordAt: latest.at.toISOString(),
      lastRecordOffsetMinutes: latest.offsetMinutes,
    };
  }
  return null;
}

/** `clock.unusable` before 28-10-2024, else `clock.behind_chain` while `clockBehindChain` answers. */
export async function refuseWhileClockBehind(
  tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<void> {
  refuseBeforeFirstIssueDate(reading);
  const behind = await clockBehindChain(tx, reading);
  if (behind !== null) throw new AppError("clock.behind_chain", behind);
}
