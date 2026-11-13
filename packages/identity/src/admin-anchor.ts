import "./errors.js";
import { AppError } from "@waitron/shared";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { persons, personRoles, roles, webauthnCredentials, type Transaction } from "@waitron/db";
import type { PersonAuthority } from "./authority.js";

export function assertActorCovers(actor: PersonAuthority, target: PersonAuthority): void {
  if (
    (!actor.admin && target.admin) ||
    [...target.permissions].some((permission) => !actor.permissions.has(permission))
  )
    throw new AppError("person.holds_more", { personId: target.personId });
}

export async function assertUsableAdminRemains(tx: Transaction): Promise<void> {
  const [admin] = await tx
    .select({ id: persons.id })
    .from(persons)
    .innerJoin(personRoles, eq(personRoles.personId, persons.id))
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .leftJoin(webauthnCredentials, eq(webauthnCredentials.personId, persons.id))
    .where(
      and(
        eq(roles.builtInKey, "admin"),
        eq(persons.status, "active"),
        or(
          isNotNull(persons.passwordHash),
          isNotNull(persons.googleSubject),
          isNotNull(webauthnCredentials.id),
        ),
      ),
    )
    .limit(1);
  if (admin === undefined) throw new AppError("person.last_admin", {});
}
