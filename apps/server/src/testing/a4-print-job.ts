import { eq, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { claimInvoiceDelivery, reserveInvoiceDelivery } from "../invoice-delivery.js";
import {
  invoiceDeliveries,
  printAgents,
  printJobs,
  type Database,
  type Transaction,
  withTransaction,
} from "@waitron/db";

export async function dateA4Job(db: Database, jobId: string, at: Date) {
  const createdAt = at.toISOString();
  await withTransaction(db, async (tx) => {
    await tx
      .update(invoiceDeliveries)
      .set({ createdAt })
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
  return {
    ...delivery,
    attempts: job?.attempts ?? 0,
    claimedAt: job?.claimedAt ?? null,
    claimedBy: job?.claimedBy ?? null,
    claimTokenHash: job?.claimTokenHash ?? null,
    printerHold: job?.printerHold ?? null,
  };
}

export async function claimA4ForTest(tx: Transaction, saleId: string, personId: string, at: Date) {
  const [agent] = await tx
    .insert(printAgents)
    .values({ name: "Office print agent", tokenHash: randomUUID() })
    .returning({ id: printAgents.id });
  const pagePrinterId = await insertA4Printer(tx, { agentId: agent!.id });
  const delivery = await reserveInvoiceDelivery(tx, saleId, {
    medium: "a4",
    pagePrinterId,
    personId,
    requestKey: randomUUID(),
  });
  await tx
    .update(printJobs)
    .set({ createdAt: at.toISOString() })
    .where(eq(printJobs.id, delivery.printJobId!));
  if (!(await claimInvoiceDelivery(tx, delivery.id, agent!.id, at)))
    throw new Error("expected an A4 claim");
  return delivery;
}
