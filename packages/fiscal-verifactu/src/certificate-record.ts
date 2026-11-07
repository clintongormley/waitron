import { readHistoryNodes, type Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";
import { desc, inArray } from "drizzle-orm";
import { fiscalCertificateInstalls } from "./schema/index.js";

export type InstallRow = typeof fiscalCertificateInstalls.$inferSelect;

/**
 * The newest install on this box or any box it took over from. Ordering by `installed_at` across
 * boxes is sound because every install is stamped by `nextInstalledAt` against this read, so an
 * install made after a takeover always sorts above the ones it inherited.
 */
export async function latestInstall(tx: Transaction, nodeId: string): Promise<InstallRow | null> {
  const history = await readHistoryNodes(tx, nodeId as NodeId);
  const [row] = await tx
    .select()
    .from(fiscalCertificateInstalls)
    .where(inArray(fiscalCertificateInstalls.nodeId, [...history]))
    .orderBy(desc(fiscalCertificateInstalls.installedAt))
    .limit(1);
  return row ?? null;
}

/**
 * When a new install is stamped: `now`, but never at or below `latest`, because `latestInstall`
 * orders by `installed_at` alone and a clock stepped back, or a box whose clock runs behind the one
 * it took over from, must not sort the new install below the one it replaces.
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
