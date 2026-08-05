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
/**
 * The authorization context a gated write threads through to `authorize`: the open session that
 * identifies the operator, plus an optional supervisor `override` (a second person's PIN). Declared
 * here and shared by the core write paths (`recordVoid`, `recordCorrection`) so the shape is stated
 * once rather than retyped inline at each call site.
 */
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
 * Decides whether a privileged action is permitted, and by whom. Satisfied EITHER by the session's
 * operator holding `permission`, OR by a supervisor `override` (a second person's PIN, who must hold
 * it). Returns the authorizing person for the caller to record. The gate is intrinsic: a gated write
 * calls this itself, so it cannot be performed without a credential this function accepts.
 *
 * Throws `session.not_open`, `person.not_found`, `person.suspended`, `pin.invalid`,
 * `authorization.not_permitted`.
 */
export async function authorize(
  tx: Transaction,
  args: { sessionId: string; permission: Permission; override?: Override },
): Promise<Authorization> {
  // One round-trip, not two: the open-session lookup and the operator's role are resolved by a
  // single innerJoin. `sessions_person_fk` (restrict) guarantees a session cannot exist without its
  // person, and RLS scopes both tables to one tenant, so the join matches whenever the session does
  // — the row is absent ONLY when there is no open session, which is exactly `session.not_open`.
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
  // Same credential gate as login (not_found → suspended → pin.invalid), then the override person
  // must ALSO hold the permission. `verifyPersonCredential` owns the first three checks in order.
  const cred = await verifyPersonCredential(tx, args.override.personId, args.override.pin);
  if (!roleHasPermission(cred.role, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: args.override.personId, permission: args.permission, viaOverride: true };
}
