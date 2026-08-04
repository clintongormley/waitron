import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { sessions } from "./schema/sessions.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
import { verifyPin } from "./verify-pin.js";

export interface Override {
  personId: string;
  pin: string;
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
 * Throws `session.not_open`, `person.suspended`, `pin.invalid`, `authorization.not_permitted`.
 */
export async function authorize(
  tx: Transaction,
  args: { sessionId: string; permission: Permission; override?: Override },
): Promise<Authorization> {
  const [session] = await tx
    .select({ personId: sessions.personId })
    .from(sessions)
    .where(and(eq(sessions.id, args.sessionId), isNull(sessions.endedAt)));
  if (session === undefined) throw new AppError("session.not_open", { sessionId: args.sessionId });

  const [operator] = await tx
    .select({ role: persons.role })
    .from(persons)
    .where(eq(persons.id, session.personId));
  // A session cannot exist without its person (FK), and RLS scopes both to one tenant.
  if (
    operator !== undefined &&
    roleHasPermission(operator.role as PersonRoleValue, args.permission)
  ) {
    return { authorizedBy: session.personId, permission: args.permission, viaOverride: false };
  }

  if (args.override === undefined) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  const [sup] = await tx
    .select({ role: persons.role, status: persons.status, pinHash: persons.pinHash })
    .from(persons)
    .where(eq(persons.id, args.override.personId));
  if (sup === undefined)
    throw new AppError("person.not_found", { personId: args.override.personId });
  if (sup.status === "suspended")
    throw new AppError("person.suspended", { personId: args.override.personId });
  if (!verifyPin(args.override.pin, sup.pinHash)) throw new AppError("pin.invalid", {});
  if (!roleHasPermission(sup.role as PersonRoleValue, args.permission)) {
    throw new AppError("authorization.not_permitted", { permission: args.permission });
  }
  return { authorizedBy: args.override.personId, permission: args.permission, viaOverride: true };
}
