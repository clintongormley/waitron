import { noteChange, type Transaction } from "@waitron/db";
import { FISCAL_SUBMISSION_QUEUED } from "@waitron/fiscal";
import { envios } from "./schema/envios.js";

export async function queueSubmission(tx: Transaction, values: typeof envios.$inferInsert) {
  await tx.insert(envios).values(values);
  await noteChange(tx, { resources: [{ type: FISCAL_SUBMISSION_QUEUED }] });
}
