import { readHistoryNodes, type Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";
import { desc, inArray } from "drizzle-orm";
import { fiscalCertificateInstalls } from "./schema/index.js";

export type InstallRow = typeof fiscalCertificateInstalls.$inferSelect;

/** The newest install on this box or any box it took over from. */
export async function latestInstall(tx: Transaction, nodeId: string): Promise<InstallRow | null> {
  return latestInstallAmong(tx, await readHistoryNodes(tx, nodeId as NodeId));
}

/**
 * The newest install among `history`, as `readHistoryNodes` lists it. Ordering by `installed_at`
 * across boxes is sound because `recordInstall` stamps every install after the newest one this read
 * finds.
 */
export async function latestInstallAmong(
  tx: Transaction,
  history: readonly NodeId[],
): Promise<InstallRow | null> {
  const [row] = await tx
    .select()
    .from(fiscalCertificateInstalls)
    .where(inArray(fiscalCertificateInstalls.nodeId, [...history]))
    .orderBy(desc(fiscalCertificateInstalls.installedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Writes an install, taking `installedAt` as the writer's clock: the row is stamped then, but never
 * at or below the newest install `latestInstall` finds, so a clock stepped back, or a box whose
 * clock runs behind the one it took over from, cannot sort the new install below the one it
 * replaces.
 */
export async function recordInstall(
  tx: Transaction,
  row: typeof fiscalCertificateInstalls.$inferInsert,
): Promise<void> {
  const latest = await latestInstall(tx, row.nodeId);
  const now = row.installedAt.getTime();
  const installedAt =
    latest === null ? row.installedAt : new Date(Math.max(now, latest.installedAt.getTime() + 1));
  await tx.insert(fiscalCertificateInstalls).values({ ...row, installedAt });
}
