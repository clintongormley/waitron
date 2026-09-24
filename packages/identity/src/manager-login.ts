import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { loginEmailKey, persons } from "./schema/persons.js";
import { normalizeEmail } from "./email.js";
import { foldForUniqueness } from "./fold.js";
import { hashPassword, verifyPassword } from "./verify-password.js";
import { verifyTotp } from "./totp.js";
import { consumeRecoveryCode, decryptTotpSecret, type TotpKeyRing } from "./mfa.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

// Checked against on the paths that refuse without a real hash, so they cost the same KDF work as a
// wrong password: a faster refusal would be a user-enumeration oracle.
const DUMMY_PASSWORD_HASH = hashPassword("timing-equalization-dummy");

const PERSON_LOGIN_COLUMNS = {
  id: persons.id,
  status: persons.status,
  passwordHash: persons.passwordHash,
  totpSecret: persons.totpSecret,
};
// Extracted so `PersonLoginRow` is INFERRED from the query, keeping `status` the column's literal
// union rather than a widened `string`.
function selectPersonLogin(tx: Transaction) {
  return tx.select(PERSON_LOGIN_COLUMNS).from(persons);
}
type PersonLoginRow = Awaited<ReturnType<typeof selectPersonLogin>>[number];

// The public email entry point screens suspended accounts before reaching this helper; the trusted
// by-id entry point keeps the distinct suspension result used by its operator flow.
async function completeManagerLogin(
  tx: Transaction,
  input: {
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
    // Same KDF work as a wrong password, so an account awaiting password setup does not stand out
    // by its KDF time.
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
      (await consumeRecoveryCode(tx, person.id, input.recoveryCode));
    if (!totpOk && !recoveryOk) {
      throw new AppError("totp.invalid", {});
    }
  }
  return startManagementSession(tx, { personId: person.id });
}

export async function loginManager(
  tx: Transaction,
  input: {
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpKeyRing?: TotpKeyRing;
  },
): Promise<ManagementSession> {
  // `loginEmailKey()` is the SAME expression `persons_tenant_email_uq` is declared over, so the
  // address that signs in is exactly the one the index treats as taken.
  const email = normalizeEmail(input.email);
  const [person] = await selectPersonLogin(tx).where(eq(loginEmailKey(), foldForUniqueness(email)));
  // An unknown email gets the same error, after the same KDF work, as a wrong password, so the
  // response does not say which addresses have accounts.
  if (person === undefined) {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
  // The email login is public, so suspension must not be discoverable by entering somebody else's
  // address.
  if (person.status === "suspended") {
    verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError("password.invalid", {});
  }
  return completeManagerLogin(tx, input, person, "totp.required");
}

export async function loginManagerById(
  tx: Transaction,
  input: {
    personId: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
    totpKeyRing?: TotpKeyRing;
  },
): Promise<ManagementSession> {
  // For trusted server-to-server flows, not a public login form: there is no enumeration surface to
  // hide here, so an unknown id is a straight `person.not_found`.
  const [person] = await selectPersonLogin(tx).where(eq(persons.id, input.personId));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  return completeManagerLogin(tx, input, person, "totp.invalid");
}

export async function authorizeManager(
  tx: Transaction,
  // `permission` widens past the core `Permission` union so a module's OWN permission string
  // type-checks. `touch: false` leaves the session's last-seen time alone.
  args: { managementSessionId: string; permission: Permission | (string & {}); touch?: boolean },
): Promise<{ authorizedBy: string; role: PersonRoleValue }> {
  const { personId, role } = await resolveManagementSession(tx, args.managementSessionId, {
    touch: args.touch,
  });
  if (!roleHasPermission(role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId, role };
}
