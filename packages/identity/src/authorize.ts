import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { sessions } from "./schema/sessions.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
import { verifyPersonCredential } from "./credential.js";

export interface Override {
  personId: string;
  pin: string;
}
export interface AuthzInput {
  sessionId: string;
  override?: Override;
}
export interface Authorization {
  authorizedBy: string;
  permission: Permission;
  viaOverride: boolean;
}

/**
 * Satisfied EITHER by the session's operator holding `permission`, OR by a supervisor `override` (a
 * second person's PIN, who must hold it). Returns the authorizing person for the caller to record.
 *
 * Throws `session.not_open`, `person.not_found`, `person.suspended`, `pin.invalid`,
 * `authorization.not_permitted`.
 */
export async function authorize(
  tx: Transaction,
  args: { sessionId: string; permission: Permission; override?: Override },
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
  const cred = await verifyPersonCredential(tx, args.override.personId, args.override.pin);
  if (!roleHasPermission(cred.role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: args.override.personId, permission: args.permission, viaOverride: true };
}
