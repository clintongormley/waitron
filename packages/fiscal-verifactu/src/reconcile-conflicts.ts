import type { Transaction } from "@waitron/db";
import { openFilingCase } from "./filing-cases.js";
import type { LookupConflictEvidence } from "./conflict-types.js";
import { fiscalLookupConflicts } from "./schema/lookup-conflicts.js";

export async function retainLookupConflict(
  tx: Transaction,
  registroId: string,
  evidence: LookupConflictEvidence,
  now: Date,
): Promise<void> {
  const opened = await openFilingCase(tx, {
    registroId,
    cause: "fiscal.huella_divergente",
    evidence: { codigo: null, mensaje: null, csv: null },
    now,
  });
  await tx
    .insert(fiscalLookupConflicts)
    .values({ registroId, caseId: opened.id, evidence, recordedAt: now })
    .onConflictDoNothing({ target: fiscalLookupConflicts.registroId });
}
