import type { Transaction } from "@waitron/db";
import { openFilingCase } from "./filing-cases.js";
import type { LookupConflictEvidence } from "./conflict-types.js";
import { appendHistory, historyNodeForRecord } from "./history.js";

export async function retainLookupConflict(
  tx: Transaction,
  registroId: string,
  evidence: LookupConflictEvidence,
  now: Date,
): Promise<void> {
  await openFilingCase(tx, {
    registroId,
    cause: "fiscal.huella_divergente",
    evidence: { codigo: null, mensaje: null, csv: null },
    now,
  });
  await appendHistory(
    tx,
    {
      kind: "conflict.lookup",
      nodeId: await historyNodeForRecord(tx, registroId),
      registroId,
      at: now,
      data: { evidence },
    },
    { ifAbsent: true },
  );
}
