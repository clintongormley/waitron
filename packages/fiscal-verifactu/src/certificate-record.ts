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

/**
 * When a new install is stamped: `now`, but never at or below `latest`, because `latestInstall`
 * orders by `installed_at` alone and a clock stepped back must not sort the new install below the
 * one it replaces.
 */
export function nextInstalledAt(latest: InstallRow | null, now: Date): Date {
  if (latest === null) return now;
  return new Date(Math.max(now.getTime(), latest.installedAt.getTime() + 1));
}

export async function recordInstall(
  tx: Transaction,
  row: typeof fiscalCertificateInstalls.$inferInsert,
): Promise<void> {
  await tx.insert(fiscalCertificateInstalls).values(row);
}
