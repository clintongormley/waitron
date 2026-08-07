import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { authorizeManager } from "./manager-login.js";
import { hashPin } from "./verify-pin.js";
import { assertPasswordLength, hashPassword } from "./verify-password.js";
import type { PersonRoleValue } from "./permissions.js";

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
  },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  const [row] = await tx
    .insert(persons)
    .values({
      tenantId: input.tenantId,
      displayName: input.displayName,
      pinHash: hashPin(input.pin),
      role: input.role,
    })
    .returning({ id: persons.id });
  return { id: row!.id };
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
 * Pre-login roster for the till lock screen. Unlike the rest of this file it is NOT gated on
 * `authorize` — it runs before any session exists — so it is deliberately tenant-scoped by RLS via
 * the caller's transaction (opened under `withTenant`) and returns only `{ personId, displayName }`
 * for `active` persons. No PIN material, no role, no status: nothing that is unsafe to show before
 * anyone has logged in. Suspended persons are excluded — a `status = 'active'` filter, which the
 * suite proves load-bearing by flipping it.
 */
export async function listActiveStaff(tx: Transaction): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows.map((r) => ({ personId: r.personId, displayName: r.displayName }));
}

/** One row of the admin roster (Task 10). Carries the person's role and status plus credential
 * BOOLEANS — never the hash or secret behind them. */
export interface PersonSummary {
  personId: string;
  displayName: string;
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
    role: r.role as PersonRoleValue,
    status: r.status as "active" | "suspended",
    hasPassword: r.passwordHash !== null,
    hasTotp: r.totpSecret !== null,
  }));
}
