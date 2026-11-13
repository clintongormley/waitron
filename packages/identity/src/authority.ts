import type { BackupQuery } from "@waitron/store";
import type { PersonRoleValue } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { persons, personRole, type Database, type Transaction } from "@waitron/db";
import { isDeclaredPermission, permissionsForRole, type Permission } from "./permissions.js";

export interface PersonAuthority {
  readonly personId: string;
  readonly admin: boolean;
  readonly permissions: ReadonlySet<string>;
}

export async function readPersonAuthority(
  tx: Database | Transaction,
  personId: string,
): Promise<PersonAuthority> {
  const [person] = await tx
    .select({ role: persons.role })
    .from(persons)
    .where(eq(persons.id, personId));
  return {
    personId,
    admin: person?.role === "admin",
    permissions: new Set(person === undefined ? [] : permissionsForRole(person.role)),
  };
}

export function holds(authority: PersonAuthority, permission: Permission | (string & {})): boolean {
  return (
    isDeclaredPermission(permission) && (authority.admin || authority.permissions.has(permission))
  );
}

export async function holdsInCopy(
  query: BackupQuery,
  personId: string,
  permission: string,
): Promise<boolean> {
  for await (const row of query.rows("select role, status from persons where id = ?", [personId])) {
    const role = String(row.role);
    if (row.status !== "active" || !(personRole.enumValues as readonly string[]).includes(role))
      return false;
    return holds(
      {
        personId,
        admin: role === "admin",
        permissions: new Set(permissionsForRole(role as PersonRoleValue)),
      },
      permission,
    );
  }
  return false;
}
