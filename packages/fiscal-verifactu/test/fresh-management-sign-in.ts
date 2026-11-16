import { eq } from "drizzle-orm";
import { dashboardSessions, type Transaction } from "@waitron/db";
import { hashSessionToken } from "@waitron/identity";

export async function setFreshManagementSignIn(tx: Transaction, token: string): Promise<void> {
  await tx
    .update(dashboardSessions)
    .set({ provedAt: new Date().toISOString() })
    .where(eq(dashboardSessions.tokenHash, hashSessionToken(token)));
}
