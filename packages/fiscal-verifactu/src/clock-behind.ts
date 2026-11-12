import "./errors.js";
import { desc, max } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { registrosFacturacion } from "./schema/registros.js";

/** How far a stored record's time may run ahead of the reading it is compared with. */
export const CLOCK_BEHIND_MARGIN_MS = 60_000;

export interface LatestRecord {
  id: string;
  at: Date;
  offsetMinutes: number;
}

/** The query {@link latestRecord} runs. */
export function latestRecordQuery(tx: Transaction) {
  return tx
    .select({
      id: registrosFacturacion.id,
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
      offsetMinutes: registrosFacturacion.offsetMinutos,
    })
    .from(registrosFacturacion)
    .orderBy(desc(registrosFacturacion.fechaHoraHusoGenRegistro), desc(registrosFacturacion.id))
    .limit(1);
}

/** The latest record in any chain, ties broken by the larger id. */
export async function latestRecord(tx: Transaction): Promise<LatestRecord | undefined> {
  const [latest] = await latestRecordQuery(tx);
  return latest;
}

/** Every chain's node and the largest `secuencia` it holds now. */
export async function chainHeads(tx: Transaction): Promise<Record<string, number>> {
  const rows = await tx
    .select({ node: registrosFacturacion.nodeId, head: max(registrosFacturacion.secuencia) })
    .from(registrosFacturacion)
    .groupBy(registrosFacturacion.nodeId);
  return Object.fromEntries(rows.map((row) => [row.node, Number(row.head)]));
}

/** `clock.unusable` before 28-10-2024. The append calls it under this name (`chain.ts`). */
export async function refuseWhileClockBehind(
  _tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<void> {
  refuseBeforeFirstIssueDate(reading);
}
