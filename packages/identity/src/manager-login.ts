import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { normalizeEmail } from "./email.js";
import { hashPassword, verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { roleHasPermission, type Permission } from "./permissions.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

// A valid hash, computed once at load, to equalize timing on the person-not-found branch: without it
// an unknown email returns fast (no KDF) while a wrong password pays for the slow `verifyPassword`,
// and that difference is itself a user-enumeration oracle — the very thing the shared
// `password.invalid` code exists to deny. On not-found we run one `verifyPassword` against this dummy
// (result discarded) so both paths do the same KDF work. The plaintext is arbitrary; it is never a
// real credential and never matches a supplied password.
const DUMMY_PASSWORD_HASH = hashPassword("timing-equalization-dummy");

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
  // accounts. We run one `verifyPassword` against a dummy hash first so the not-found path costs the
  // same KDF work as a wrong-password path (see DUMMY_PASSWORD_HASH). (TOTP is past this point: the
  // caller has already proved the account exists. Suspension is NOT — `person.suspended` below is
  // thrown pre-password, so a suspended account IS revealed to an unauthenticated caller by design.)
  if (person === undefined) {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
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
