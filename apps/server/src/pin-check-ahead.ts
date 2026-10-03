import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@waitron/db";
import {
  checkPin,
  persons,
  roleHasPermission,
  sessions,
  type Permission,
  type PersonRoleValue,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";

/**
 * `checkPin`, run before the transaction opens so the key is derived outside the write lock.
 * Undefined, deriving nothing, when the wrong-PIN limit would refuse first: the transaction then
 * refuses it, as it would have without this.
 */
export async function checkPinAhead(
  db: Database,
  credential: { personId: string; pin: string },
  attempts: PinAttempts,
): Promise<SecretCheck | undefined> {
  try {
    attempts.throttle.check(attempts.slot, credential.personId);
  } catch {
    return undefined;
  }
  return checkPin(db, credential.personId, credential.pin);
}

/**
 * {@link checkPinAhead} on an override `authorize` will check: one sent by a session whose operator
 * lacks `permission`. Undefined otherwise, deriving nothing.
 */
export async function checkOverrideAhead(
  db: Database,
  authz: { sessionId: string; permission: Permission },
  override: { personId: string; pin: string } | undefined,
  attempts: PinAttempts,
): Promise<SecretCheck | undefined> {
  if (override === undefined) return undefined;
  const [operator] = await db
    .select({ role: persons.role })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(eq(sessions.id, authz.sessionId), isNull(sessions.endedAt)));
  if (
    operator === undefined ||
    roleHasPermission(operator.role as PersonRoleValue, authz.permission)
  ) {
    return undefined;
  }
  return checkPinAhead(db, override, attempts);
}

/** `override` carrying `checked`, which `authorize` uses instead of deriving the key again. */
export function withCheck<T extends { personId: string; pin: string }>(
  override: T | undefined,
  checked: SecretCheck | undefined,
): (T & { checked?: SecretCheck }) | undefined {
  return override === undefined || checked === undefined ? override : { ...override, checked };
}
