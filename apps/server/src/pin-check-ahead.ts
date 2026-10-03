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
import { inTurn } from "./attempt-turns.js";

/**
 * Runs `transaction` with `checkPin`'s verdict on `credential`, derived before the transaction opens
 * so the key is not derived under the write lock. Attempts on the same person and slot take turns
 * from the check until their transaction settles, so each is checked only once the outcomes before
 * it are counted. No check, and no turn, when there is no credential or the wrong-PIN limit would
 * refuse first: the transaction then answers as it would without this. A check that fails hands the
 * transaction none, still in turn: it refuses what it would refuse first, and otherwise derives the
 * key itself.
 */
export async function withPinCheckAhead<T>(
  db: Database,
  credential: { personId: string; pin: string } | undefined,
  attempts: PinAttempts,
  transaction: (checked: SecretCheck | undefined) => Promise<T>,
): Promise<T> {
  const refused = (personId: string) => attempts.throttle.wouldRefuse(attempts.slot, personId);
  if (credential === undefined || refused(credential.personId)) return transaction(undefined);
  const { personId, pin } = credential;
  return inTurn(attempts.throttle, JSON.stringify([attempts.slot, personId]), async () => {
    const checked = refused(personId)
      ? undefined
      : await checkPin(db, personId, pin).catch(() => undefined);
    return transaction(checked);
  });
}

/**
 * The override `authorize` will check: one sent by a session whose operator lacks `permission`, or,
 * with `checkedAnyway`, by any open session (the caller checks the same PIN itself when `authorize`
 * does not). Undefined otherwise. Reads without writing.
 */
export async function overrideToCheck<T extends { personId: string; pin: string }>(
  db: Database,
  authz: { sessionId: string; permission: Permission },
  override: T | undefined,
  checkedAnyway = false,
): Promise<T | undefined> {
  if (override === undefined) return undefined;
  const [operator] = await db
    .select({ role: persons.role })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(eq(sessions.id, authz.sessionId), isNull(sessions.endedAt)));
  if (
    operator === undefined ||
    (!checkedAnyway && roleHasPermission(operator.role as PersonRoleValue, authz.permission))
  ) {
    return undefined;
  }
  return override;
}

/** `override` carrying `checked`, which `authorize` uses instead of deriving the key again. */
export function withCheck<T extends { personId: string; pin: string }>(
  override: T | undefined,
  checked: SecretCheck | undefined,
): (T & { checked?: SecretCheck }) | undefined {
  return override === undefined || checked === undefined ? override : { ...override, checked };
}
