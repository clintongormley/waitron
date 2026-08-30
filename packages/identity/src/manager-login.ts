import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { normalizeEmail } from "./email.js";
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
  input: { tenantId: string; email: string; password: string; totp?: string },
): Promise<ManagementSession> {
  // Dashboard sign-in resolves the person by EMAIL, not by a client-supplied id. The lookup matches
  // the same normalised (trim + lowercase) form the write boundary stores under the per-tenant
  // case-insensitive unique index (persons_tenant_email_uq), so `lower(email)` here mirrors the index
  // and login is case-insensitive.
  const email = normalizeEmail(input.email);
  const [person] = await tx
    .select({
      id: persons.id,
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .where(and(eq(persons.tenantId, input.tenantId), eq(sql`lower(${persons.email})`, email)));
  // Enumeration hardening: an unknown email is indistinguishable from a wrong password on the public
  // login form — both throw `password.invalid`, so the response never reveals which addresses have
  // accounts. (Suspension and TOTP are past that point: the caller already proved the account exists.)
  if (person === undefined) throw new AppError("password.invalid", {});
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: person.id });
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
  return startManagementSession(tx, { tenantId: input.tenantId, personId: person.id });
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
