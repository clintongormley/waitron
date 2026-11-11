import "./errors.js";
import { managementSessions, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { resolveManagementSession } from "./management-session.js";

export async function requireFreshManagementSignIn(
  tx: Transaction,
  token: string,
  options: { allowRecoveryCode?: boolean } = {},
) {
  const session = await resolveManagementSession(tx, token, { touch: false });
  const [row] = await tx
    .select({ provedAt: managementSessions.provedAt, proofMethod: managementSessions.proofMethod })
    .from(managementSessions)
    .where(eq(managementSessions.id, session.sessionRowId));
  const age = Date.now() - Date.parse(row?.provedAt ?? "");
  if (!Number.isFinite(age) || age < 0 || age >= 15 * 60_000)
    throw new AppError("management_session.proof_required", {});
  if (
    options.allowRecoveryCode === false &&
    row?.proofMethod !== "password" &&
    row?.proofMethod !== "passkey"
  )
    throw new AppError("management_session.proof_required", {});
  return session;
}
