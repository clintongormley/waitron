import "./errors.js";
import { max } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { registrosFacturacion } from "./schema/registros.js";

/** How far a stored record's time may run ahead of the reading it is compared with. */
export const CLOCK_BEHIND_MARGIN_MS = 60_000;

/** Every chain's node and the largest `secuencia` it holds now. */
export async function chainHeads(tx: Transaction): Promise<Record<string, number>> {
  const rows = await tx
    .select({ node: registrosFacturacion.nodeId, head: max(registrosFacturacion.secuencia) })
    .from(registrosFacturacion)
    .groupBy(registrosFacturacion.nodeId);
  return Object.fromEntries(rows.map((row) => [row.node, Number(row.head)]));
}

/** `clock.unusable` before 28-10-2024. The append calls it under this name (`chain.ts`). */
export async function refuseUntilRecordable(
  _tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<void> {
  refuseBeforeFirstIssueDate(reading);
}
