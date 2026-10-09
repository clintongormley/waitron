import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { sessions } from "./schema/sessions.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
import {
  verifyPersonCredential,
  verifyThrottledCredential,
  type PinAttempts,
} from "./credential.js";
import type { SecretCheck } from "./secret-check.js";

export interface Override {
  personId: string;
  pin: string;
  /** From `checkPin` on this person and PIN, taken before the transaction opened. */
  checked?: SecretCheck;
}
export interface AuthzInput {
  sessionId: string;
  override?: Override;
}
export interface Authorization {
  authorizedBy: string;
  permission: Permission | (string & {});
  viaOverride: boolean;
}

/**
 * Satisfied EITHER by the session's operator holding `permission`, OR by a supervisor `override` (a
 * second person's PIN, who must hold it). Returns the authorizing person for the caller to record.
 *
 * With `attempts`, the override's PIN is checked under that wrong-PIN limit; an override that is never
 * checked, because the operator holds the permission, neither counts nor clears it.
 *
 * Throws `session.not_open`, `pin.invalid` (for any override that cannot sign in), `pin.throttled`
 * (only with `attempts`), `authorization.not_permitted`.
 */
export async function authorize(
  tx: Transaction,
  args: { sessionId: string; permission: Permission | (string & {}); override?: Override },
  attempts?: PinAttempts,
): Promise<Authorization> {
  // `sessions` declares no key to `persons` (why: `schema/sessions.ts`), so a session whose person
  // row is gone is absent from this join and reads as `session.not_open`, which fails closed.
  const [row] = await tx
    .select({ personId: sessions.personId, role: persons.role })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(eq(sessions.id, args.sessionId), isNull(sessions.endedAt)));
  if (row === undefined) throw new AppError("session.not_open", { sessionId: args.sessionId });

  if (roleHasPermission(row.role as PersonRoleValue, args.permission)) {
    return { authorizedBy: row.personId, permission: args.permission, viaOverride: false };
  }

  if (args.override === undefined) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  const { personId, pin, checked } = args.override;
  const cred = await (attempts === undefined
    ? verifyPersonCredential(tx, personId, pin, checked)
    : verifyThrottledCredential(tx, personId, pin, attempts, checked));
  if (!roleHasPermission(cred.role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: args.override.personId, permission: args.permission, viaOverride: true };
}

export async function authorizeByPin(
  tx: Transaction,
  args: { permission: Permission | (string & {}); override: Override },
  attempts: PinAttempts,
): Promise<Authorization> {
  const { personId, pin, checked } = args.override;
  const cred = await verifyThrottledCredential(tx, personId, pin, attempts, checked);
  if (!roleHasPermission(cred.role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId, permission: args.permission, viaOverride: true };
}
