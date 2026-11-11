import { eq } from "drizzle-orm";
import { managementSessions, type Transaction } from "@waitron/db";
import { hashSessionToken } from "@waitron/identity";

export async function setFreshManagementSignIn(tx: Transaction, token: string): Promise<void> {
  await tx
    .update(managementSessions)
    .set({ provedAt: new Date().toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
}
