import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { normalizeEmail } from "./email.js";
import { hashPassword, verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { consumeRecoveryCode, decryptTotpSecret, type TotpKeyRing } from "./mfa.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
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

// The person columns both login entry points read to check a credential. Named once so the email
// lookup (`loginManager`) and the id lookup (`loginManagerById`) select the identical shape and share
// `completeManagerLogin` below.
const PERSON_LOGIN_COLUMNS = {
  id: persons.id,
  status: persons.status,
  passwordHash: persons.passwordHash,
  totpSecret: persons.totpSecret,
};
// The base SELECT both entry points run (each appends its own WHERE). Extracted so `PersonLoginRow` is
// INFERRED from the query rather than hand-declared: that keeps `status` as its pgEnum literal union
// (`"pending" | "active" | "suspended"`), so `completeManagerLogin`'s active-status gate is checked
// against the real values — a typo would not compile — rather than a widened `string`. This is the
// infer-the-row-shape-from-the-query idiom the codebase already uses for such column sets.
function selectPersonLogin(tx: Transaction) {
  return tx.select(PERSON_LOGIN_COLUMNS).from(persons);
}
type PersonLoginRow = Awaited<ReturnType<typeof selectPersonLogin>>[number];

// The credential check + session mint for a person that has ALREADY been found, shared by both entry
// points. The public email entry point screens suspended accounts before reaching this helper; the
// trusted by-id entry point keeps the distinct suspension result used by its operator flow.
async function completeManagerLogin(
  tx: Transaction,
  input: {
    tenantId: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpKeyRing?: TotpKeyRing;
  },
  person: PersonLoginRow,
  missingFactorCode: "totp.required" | "totp.invalid",
): Promise<ManagementSession> {
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: person.id });
  if (person.status !== "active") {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
  let passwordOk = false;
  if (person.passwordHash === null) {
    // A found person with NO dashboard password (for example, before activation) still runs one KDF
    // against the dummy hash
    // before failing, so it can't be told apart by response time from a wrong-password attempt — the
    // same enumeration-timing class the not-found branch closes. A short-circuit here would leak "this
    // email names an account awaiting password setup" by latency. Result unused: a null-password
    // person can never sign in with a password.
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
  } else {
    passwordOk = verifyPassword(input.password, person.passwordHash);
  }
  if (!passwordOk) throw new AppError("password.invalid", {});
  if (person.totpSecret !== null) {
    if (input.totp === undefined && input.recoveryCode === undefined) {
      throw new AppError(missingFactorCode, {});
    }
    const secret = decryptTotpSecret(person.totpSecret, input.totpKeyRing);
    const totpOk =
      input.totp !== undefined && secret !== null && verifyTotp(input.totp, secret.secret);
    const recoveryOk =
      !totpOk &&
      input.recoveryCode !== undefined &&
      (await consumeRecoveryCode(tx, input.tenantId, person.id, input.recoveryCode));
    if (!totpOk && !recoveryOk) {
      throw new AppError("totp.invalid", {});
    }
  }
  // Verifier seam: password (+ TOTP when enrolled) is one way to mint a management session; slice 1d's
  // finishPasskeyAuthentication is a sibling entry point that likewise ends in startManagementSession.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: person.id });
}

export async function loginManager(
  tx: Transaction,
  input: {
    tenantId: string;
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpKeyRing?: TotpKeyRing;
  },
): Promise<ManagementSession> {
  // Dashboard sign-in resolves the person by EMAIL, not by a client-supplied id. The lookup matches
  // the same normalised (trim + lowercase) form the write boundary stores under the per-tenant
  // case-insensitive unique index (persons_tenant_email_uq), so `lower(email)` here mirrors the index
  // and login is case-insensitive.
  const email = normalizeEmail(input.email);
  const [person] = await selectPersonLogin(tx).where(
    and(eq(persons.tenantId, input.tenantId), eq(sql`lower(${persons.email})`, email)),
  );
  // Enumeration hardening: an unknown email is indistinguishable from a wrong password on the public
  // login form — both throw `password.invalid`, so the response never reveals which addresses have
  // accounts. We run one `verifyPassword` against a dummy hash first so the not-found path costs the
  // same KDF work as a wrong-password path (see DUMMY_PASSWORD_HASH).
  if (person === undefined) {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
  // The email login is public. Spend the same KDF work and return the same result as an unknown
  // account, so suspension cannot be discovered by entering somebody else's address. The trusted
  // by-id entry point below retains `person.suspended` for its operator-facing server flow.
  if (person.status === "suspended") {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
  return completeManagerLogin(tx, input, person, "totp.required");
}

export async function loginManagerById(
  tx: Transaction,
  input: {
    tenantId: string;
    personId: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpKeyRing?: TotpKeyRing;
  },
): Promise<ManagementSession> {
  // The C2b mirror-bundle route (`apps/server/src/mirror-bundle-api.ts`) authenticates the primary's
  // ADMIN by id, NOT by email — the mirror is a trusted server-to-server flow over the primary's
  // first-contact TLS, carrying an id the operator typed, not an email login form. Every human admin
  // now carries an email, but this path deliberately does not use it. There is no enumeration
  // surface to hide here — a caller either holds a valid primary admin id or does not — so an unknown
  // id is a straight `person.not_found` (no dummy-KDF equalisation). Everything after the lookup is
  // identical to `loginManager`, via `completeManagerLogin`.
  const [person] = await selectPersonLogin(tx).where(
    and(eq(persons.tenantId, input.tenantId), eq(persons.id, input.personId)),
  );
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  return completeManagerLogin(tx, input, person, "totp.invalid");
}

export async function authorizeManager(
  tx: Transaction,
  // `permission` widens past the closed core `Permission` union so a module's OWN permission string
  // (registerModulePermissions, e.g. bookings' booking.manage) type-checks here; `Permission` stays
  // the closed core union everywhere else. `roleHasPermission` resolves either kind.
  args: { managementSessionId: string; permission: Permission | (string & {}) },
): Promise<{ authorizedBy: string; tenantId: string; role: PersonRoleValue }> {
  const { personId, role, tenantId } = await resolveManagementSession(tx, args.managementSessionId);
  if (!roleHasPermission(role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId, tenantId, role };
}
