import { max } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ClockStepRequest } from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import { verifactuHistory } from "./schema/verifactu-history.js";

export interface HistoryEntry {
  kind: "clock.confirmed";
  nodeId: NodeId;
  at: Date;
  personId: string;
  data: {
    confirmedAt: string;
    stepMs: number;
    source: "admin" | "staff";
    reason: ClockStepRequest["reason"];
    proof: Record<string, unknown>;
  };
}

export async function appendHistory(
  tx: Transaction,
  entry: HistoryEntry,
): Promise<{ id: string; seq: number }> {
  const [latest] = await tx.select({ seq: max(verifactuHistory.seq) }).from(verifactuHistory);
  const seq = (latest?.seq ?? 0) + 1;
  const [row] = await tx
    .insert(verifactuHistory)
    .values({ ...entry, seq })
    .returning({ id: verifactuHistory.id });
  return { id: row!.id, seq };
}
