import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { roleHasPermission, type Permission } from "./permissions.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

export async function loginManager(
  tx: Transaction,
  input: { tenantId: string; personId: string; password: string; totp?: string },
): Promise<ManagementSession> {
  const [person] = await tx
    .select({
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .where(and(eq(persons.id, input.personId), eq(persons.tenantId, input.tenantId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: input.personId });
  if (person.passwordHash === null || !verifyPassword(input.password, person.passwordHash)) {
    throw new AppError("password.invalid", {});
  }
  if (person.totpSecret !== null) {
    if (input.totp === undefined || !verifyTotp(input.totp, person.totpSecret)) {
      throw new AppError("totp.invalid", {});
    }
  }
  // Verifier seam: password (+ TOTP when enrolled) is one way to mint a management session; slice 1d's
  // finishPasskeyAuthentication is a sibling entry point that likewise ends in startManagementSession.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: input.personId });
}

export async function authorizeManager(
  tx: Transaction,
  args: { managementSessionId: string; permission: Permission },
): Promise<{ authorizedBy: string }> {
  const { personId, role } = await resolveManagementSession(tx, args.managementSessionId);
  if (!roleHasPermission(role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId };
}
