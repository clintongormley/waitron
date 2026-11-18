import { eq, type SQL } from "drizzle-orm";
import { invoiceDeliveries, printJobs, type Database, withTransaction } from "@waitron/db";

export async function dateA4Job(db: Database, jobId: string, at: Date) {
  const createdAt = at.toISOString();
  await withTransaction(db, async (tx) => {
    await tx
      .update(invoiceDeliveries)
      .set({ createdAt, nextAttemptAt: createdAt })
      .where(eq(invoiceDeliveries.printJobId, jobId));
    await tx.update(printJobs).set({ createdAt }).where(eq(printJobs.id, jobId));
  });
}

export async function readDeliveryAndClaim(db: Database, matches: SQL) {
  const [row] = await db
    .select({ delivery: invoiceDeliveries, job: printJobs })
    .from(invoiceDeliveries)
    .leftJoin(printJobs, eq(printJobs.id, invoiceDeliveries.printJobId))
    .where(matches);
  if (row === undefined) throw new Error("expected invoice delivery");
  const { delivery, job } = row;
  if (job?.kind !== "a4") return delivery;
  return {
    ...delivery,
    attempts: job.attempts,
    claimedAt: job.claimedAt,
    claimedBy: job.claimedBy,
    claimedAgentId: job.claimedBy,
    claimTokenHash: job.claimTokenHash,
    printerHold: job.printerHold,
  };
}
