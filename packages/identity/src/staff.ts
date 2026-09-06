import "./errors.js";
import { eq } from "drizzle-orm";
import { isUniqueViolation, uniqueViolationConstraint } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, assertSupportedLocale } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { normalizeEmail, isValidEmail } from "./email.js";
import { authorizeManager } from "./manager-login.js";
import { hashPin } from "./verify-pin.js";
import { assertPasswordLength, hashPassword } from "./verify-password.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";

/**
 * Translate the ONE driver error the email write paths care about — a `persons_tenant_email_uq`
 * collision — into the domain `person.email_taken`, and re-throw anything else untouched. The
 * duplicate surfaces as SQLSTATE 23505 wrapped in Drizzle's `DrizzleQueryError`, so detection goes
 * through `@waitron/db`'s `isUniqueViolation` (a cause-chain walk), not a top-level `.code` read.
 *
 * It matches on the CONSTRAINT NAME, not merely on 23505: a different unique violation on `persons`
 * — the `id` PK, or any unique constraint added later — is re-thrown untouched, never mislabelled
 * `person.email_taken` (which would also break the `{ email }` param contract when `email` is null).
 * When the driver reports no constraint name (PGlite omits it), it falls back to translating: that
 * partial index is the only NON-PK unique constraint these write paths can hit, and a null-email PK
 * clash is a cryptographically-unreachable `defaultRandom()` collision.
 *
 * `email` is normalized before it reaches here, so the error carries the value that actually
 * collided. Exported for the crafted-error unit test in staff.test.ts, NOT from the package barrel.
 */
export function asEmailTaken(err: unknown, email: string): never {
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === undefined || constraint === "persons_tenant_email_uq") {
      throw new AppError("person.email_taken", { email });
    }
  }
  throw err;
}

/** Normalize a REQUIRED email and validate it, throwing `person.email_invalid` on a malformed value
 * BEFORE any write. The single source of the email write-boundary rule, shared by `screenEmail`
 * (create) and `setEmail` (edit) here, and — via the package barrel — by `apps/server`'s setup-api
 * onboarding boundary, so all three cannot drift. */
export function normalizeAndValidateEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw new AppError("person.email_invalid", {});
  return email;
}

/** Screen an OPTIONAL email input: `undefined` → `null` (no email); otherwise
 * `normalizeAndValidateEmail`. */
function screenEmail(raw: string | undefined): string | null {
  return raw === undefined ? null : normalizeAndValidateEmail(raw);
}

/** The shortest PIN accepted. Four digits is the floor a POS keypad expects; longer is allowed. */
export const MIN_PIN_LENGTH = 4;

/** Refuses a PIN below `MIN_PIN_LENGTH` with `pin.too_short` (carrying only the policy `min`, never
 * the PIN). Exported because provisioning's `venue` CLI seeds the FIRST admin outside this gated
 * path and applies the same floor — one implementation of the check, not two that can drift. */
export function assertPinLength(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) throw new AppError("pin.too_short", { min: MIN_PIN_LENGTH });
}

/**
 * Creates a staff member. Gated on `person.manage`: `authorizeManager` runs FIRST, so a caller
 * without the permission is rejected before any write. The PIN is length-checked, then stored
 * hashed — never plaintext. Bootstrapping the FIRST admin is provisioning's job, not this gated path.
 */
export async function createPerson(
  tx: Transaction,
  input: {
    tenantId: string;
    managementSessionId: string;
    displayName: string;
    role: PersonRoleValue;
    pin: string;
    email?: string;
  },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  const email = screenEmail(input.email);
  try {
    const [row] = await tx
      .insert(persons)
      .values({
        tenantId: input.tenantId,
        displayName: input.displayName,
        pinHash: hashPin(input.pin),
        role: input.role,
        email,
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (err) {
    // The insert can raise only two unique violations on `persons`: `persons_tenant_email_uq`, the
    // partial index that fires solely when `email` IS NOT NULL, and the `id` primary key. `asEmailTaken`
    // translates ONLY the email-index constraint (re-throwing a PK/other violation), and that index
    // can only fire with a non-null email — so whenever it translates, `email!` is genuinely non-null.
    // (A null-email PK clash is a cryptographically-unreachable `defaultRandom()` collision, re-thrown
    // untouched on a driver that reports the constraint name.)
    asEmailTaken(err, email!);
  }
}

/** Changes a person's role. Gated on `person.manage`. authorizeManager reads a role live (via
 * resolveManagementSession), so an open management session sees the change on its next call. */
export async function setRole(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; role: PersonRoleValue },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx.update(persons).set({ role: input.role }).where(eq(persons.id, input.personId));
}

/** Resets a person's PIN. Gated on `person.manage`; the new PIN is length-checked, then stored
 * hashed. */
export async function resetPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; pin: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set({ pinHash: hashPin(input.pin) })
    .where(eq(persons.id, input.personId));
}

/** Grants (or replaces) a person's dashboard password. Gated on `person.manage`:
 * `authorizeManager` runs FIRST, so a caller without the permission is rejected before any write.
 * The password is length-checked, then stored hashed — never plaintext. This is the general
 * admin-sets-password path; bootstrapping the FIRST admin's password is provisioning's job. */
export async function setPassword(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; password: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPasswordLength(input.password);
  await tx
    .update(persons)
    .set({ passwordHash: hashPassword(input.password) })
    .where(eq(persons.id, input.personId));
}

/** Sets (or replaces) a person's login email — the identifier for dashboard sign-in. Gated on
 * `person.manage`, mirroring `setPassword`: `authorizeManager` runs FIRST, so a caller without the
 * permission is rejected before any write. The email is normalized then screened (malformed →
 * `person.email_invalid`) before the UPDATE; a collision with another person's email in the same
 * tenant (the `persons_tenant_email_uq` index) surfaces as `person.email_taken`. */
export async function setEmail(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; email: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const email = normalizeAndValidateEmail(input.email);
  try {
    await tx.update(persons).set({ email }).where(eq(persons.id, input.personId));
  } catch (err) {
    asEmailTaken(err, email);
  }
}

/**
 * Sets a person's preferred UI language. Validates against the supported set (throws
 * `locale.unsupported`) so a bad code never reaches the row. Unlike every other mutator in this file
 * there is NO `authorizeManager` gate: a person sets their OWN locale, so the server routes pass the
 * SESSION's `personId` (never a body value). `tenantId` is retained for signature parity; the
 * UPDATE matches the person's id.
 */
export async function setPersonLocale(
  tx: Transaction,
  input: { tenantId: string; personId: string; locale: string },
): Promise<void> {
  const locale = assertSupportedLocale(input.locale);
  await tx.update(persons).set({ locale }).where(eq(persons.id, input.personId));
}

/** Suspends a person: keeps the row (and its history) while refusing login. Gated on
 * `person.manage`. */
export async function suspendPerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, input.personId));
}

/** Reactivates a suspended person, restoring login. Gated on `person.manage`. */
export async function reactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx.update(persons).set({ status: "active" }).where(eq(persons.id, input.personId));
}

/** One entry in the pre-login roster: the id the lock screen logs in with, and the name it shows. */
export interface StaffListEntry {
  personId: string;
  displayName: string;
}

/**
 * Pre-login roster for the till lock screen. This read has no tenant predicate. The deployment
 * holds one tenant per database. Unlike the rest of this file it is NOT gated on `authorize` — it
 * runs before any session exists — and returns only `{ personId, displayName }` for `active`
 * persons. No PIN material, no role, no status: nothing that is unsafe to show before anyone has
 * logged in. Suspended persons are excluded — a `status = 'active'` filter, which the suite
 * checks.
 */
export async function listActiveStaff(tx: Transaction): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows.map((r) => ({ personId: r.personId, displayName: r.displayName }));
}

/**
 * The active persons whose ROLE holds `permission`, in the same `{ personId, displayName }` shape
 * `listActiveStaff` returns. This is the roster a till surfaces when an operator must pick an
 * authorizing supervisor for a privileged action under a gated policy (the cash-drawer override —
 * cash-drawer-authorization §5): the eligible authorizers are exactly the active persons whose
 * role holds the action's permission. The active-person read has no tenant predicate. The
 * deployment holds one tenant per database.
 *
 * Like `listActiveStaff` it returns ONLY `{ personId, displayName }` — no PIN material, role or status: the
 * caller shows the picker before the authorizing supervisor has entered a credential, so nothing
 * unsafe to show may travel. The role→permission map stays authoritative in permissions.ts: this
 * fetches every active person + their role and keeps those `roleHasPermission(role, permission)`
 * accepts, so which roles hold a permission is decided in one place, never hardcoded here.
 */
export async function listActivePersonsWithPermission(
  tx: Transaction,
  permission: Permission,
): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName, role: persons.role })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows
    .filter((r) => roleHasPermission(r.role as PersonRoleValue, permission))
    .map((r) => ({ personId: r.personId, displayName: r.displayName }));
}

/** One row of the admin roster (Task 10). Carries the person's role and status plus credential
 * BOOLEANS — never the hash or secret behind them. */
export interface PersonSummary {
  personId: string;
  displayName: string;
  /** The person's login email (dashboard sign-in identifier), or null for till-only PIN staff. */
  email: string | null;
  role: PersonRoleValue;
  status: "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
}

/**
 * Admin roster for the dashboard staff screen. Gated on `person.manage`: `authorizeManager` runs
 * FIRST, so a caller without the permission is rejected before anything is selected. Returns EVERY
 * person of the tenant (suspended included, unlike the pre-login `listActiveStaff`), ordered by name.
 *
 * `password_hash`/`totp_secret` are selected only to derive `hasPassword`/`hasTotp`; the returned
 * `PersonSummary` carries the booleans and never the hash, the secret, or the PIN — a leak the suite
 * pins by asserting `JSON.stringify` of the roster contains no `scrypt$` (the credential-hash prefix).
 */
export async function listPersons(
  tx: Transaction,
  args: { managementSessionId: string },
): Promise<PersonSummary[]> {
  await authorizeManager(tx, {
    managementSessionId: args.managementSessionId,
    permission: "person.manage",
  });
  const rows = await tx
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      email: persons.email,
      role: persons.role,
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .orderBy(persons.displayName);
  return rows.map((r) => ({
    personId: r.personId,
    displayName: r.displayName,
    email: r.email,
    role: r.role as PersonRoleValue,
    status: r.status as "active" | "suspended",
    hasPassword: r.passwordHash !== null,
    hasTotp: r.totpSecret !== null,
  }));
}
