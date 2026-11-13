import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons, sessions } from "@waitron/db";
import type { Permission } from "./permissions.js";
import { readPersonAuthority, holds } from "./authority.js";
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
  tx: Database | Transaction,
  args: { sessionId: string; permission: Permission | (string & {}); override?: Override },
  attempts?: PinAttempts,
): Promise<Authorization> {
  // `sessions` declares no key to `persons` (why: `packages/db/src/schema/identity/sessions.ts`),
  // so a session whose person row is gone is absent from this join and reads as `session.not_open`,
  // which fails closed.
  const [row] = await tx
    .select({ personId: sessions.personId })
    .from(sessions)
    .innerJoin(persons, eq(persons.id, sessions.personId))
    .where(and(eq(sessions.id, args.sessionId), isNull(sessions.endedAt)));
  if (row === undefined) throw new AppError("session.not_open", { sessionId: args.sessionId });

  if (holds(await readPersonAuthority(tx, row.personId), args.permission)) {
    return { authorizedBy: row.personId, permission: args.permission, viaOverride: false };
  }

  if (args.override === undefined) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  const { personId, pin, checked } = args.override;
  const cred = await (attempts === undefined
    ? verifyPersonCredential(tx, personId, pin, checked)
    : verifyThrottledCredential(tx, personId, pin, attempts, checked));
  if (!holds(cred.authority, args.permission)) {
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
  if (!holds(cred.authority, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: personId, permission: args.permission, viaOverride: true };
}

/** Refused `authorization.not_permitted` unless `personId` is an active person who holds
 * `permission` now. Reads only. `viaOverride` is false: this does not know whether the earlier
 * approval was an override (`invoice_corrections.via_override` does). */
export async function authorizeApproval(
  tx: Transaction,
  args: { personId: string; permission: Permission | (string & {}) },
): Promise<Authorization> {
  const [person] = await tx
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, args.personId));
  if (
    person?.status !== "active" ||
    !holds(await readPersonAuthority(tx, args.personId), args.permission)
  ) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: args.personId, permission: args.permission, viaOverride: false };
}
