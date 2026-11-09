import { managementSessions, type Transaction } from "@waitron/db";
import { hashSessionToken } from "@waitron/identity";
import { eq } from "drizzle-orm";

export async function setFreshManagementSignIn(
  tx: Transaction,
  cookieOrToken: string,
  fresh = true,
): Promise<void> {
  const token = cookieOrToken.includes("=") ? cookieOrToken.split("=")[1]! : cookieOrToken;
  await tx
    .update(managementSessions)
    .set({ provedAt: fresh ? new Date().toISOString() : null })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
}
