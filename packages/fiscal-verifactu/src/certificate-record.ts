import type { Transaction } from "@waitron/db";
import { desc, eq } from "drizzle-orm";
import { fiscalCertificateInstalls } from "./schema/index.js";

export type InstallRow = typeof fiscalCertificateInstalls.$inferSelect;

export async function latestInstall(tx: Transaction, nodeId: string): Promise<InstallRow | null> {
  const [row] = await tx
    .select()
    .from(fiscalCertificateInstalls)
    .where(eq(fiscalCertificateInstalls.nodeId, nodeId))
    .orderBy(desc(fiscalCertificateInstalls.installedAt))
    .limit(1);
  return row ?? null;
}

export async function recordInstall(
  tx: Transaction,
  row: typeof fiscalCertificateInstalls.$inferInsert,
): Promise<void> {
  await tx.insert(fiscalCertificateInstalls).values(row);
}
