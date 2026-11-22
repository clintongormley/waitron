import { noteChange, type Transaction } from "@waitron/db";
import { FISCAL_SUBMISSION_QUEUED } from "@waitron/fiscal";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";

export async function queueSubmission(tx: Transaction, values: typeof verifactuSubmissions.$inferInsert) {
  await tx.insert(verifactuSubmissions).values(values);
  await noteChange(tx, { resources: [{ type: FISCAL_SUBMISSION_QUEUED }] });
}
