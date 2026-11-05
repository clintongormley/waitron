import { asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { handoverActivations } from "./schema/index.js";

export type HandoverActivationRow = typeof handoverActivations.$inferInsert;
export type HandoverActivation = typeof handoverActivations.$inferSelect;

export async function insertHandoverActivationTx(
  tx: Transaction,
  row: HandoverActivationRow,
): Promise<void> {
  // `activated_at` is compared as text, so every row stores one spelling of a time.
  await tx
    .insert(handoverActivations)
    .values({ ...row, activatedAt: new Date(row.activatedAt).toISOString() });
}

export async function readHandoverActivation(
  db: Database | Transaction,
  operationId: string,
): Promise<HandoverActivation | null> {
  const [row] = await db
    .select()
    .from(handoverActivations)
    .where(eq(handoverActivations.operationId, operationId));
  return row ?? null;
}

/** The activations in which `destinationNodeId` took over, oldest first. */
export async function readActivationRows(
  db: Database | Transaction,
  destinationNodeId: string,
): Promise<HandoverActivation[]> {
  return db
    .select()
    .from(handoverActivations)
    .where(eq(handoverActivations.destinationNodeId, destinationNodeId))
    .orderBy(asc(handoverActivations.activatedAt));
}
