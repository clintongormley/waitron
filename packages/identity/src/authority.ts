import type { BackupQuery } from "@waitron/store";
import type { PersonRoleValue } from "@waitron/shared";
import { and, eq } from "drizzle-orm";
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
  return authorityForRole(personId, person?.role);
}

export function authorityForRole(
  personId: string,
  role: PersonRoleValue | undefined,
): PersonAuthority {
  return {
    personId,
    admin: role === "admin",
    permissions: new Set(role === undefined ? [] : permissionsForRole(role)),
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
    return holds(authorityForRole(personId, role as PersonRoleValue), permission);
  }
  return false;
}

export async function listAdminHolders(
  tx: Database | Transaction | BackupQuery,
  options: { status?: "active" } = {},
): Promise<{ id: string; passwordHash: string | null }[]> {
  if ("rows" in tx) {
    const holders: { id: string; passwordHash: string | null }[] = [];
    for await (const row of tx.rows(
      options.status === undefined
        ? "select id, password_hash from persons where role = 'admin'"
        : "select id, password_hash from persons where role = 'admin' and status = 'active'",
    )) {
      holders.push({
        id: String(row.id),
        passwordHash: typeof row.password_hash === "string" ? row.password_hash : null,
      });
    }
    return holders;
  }
  return tx
    .select({ id: persons.id, passwordHash: persons.passwordHash })
    .from(persons)
    .where(
      and(
        eq(persons.role, "admin"),
        options.status === undefined ? undefined : eq(persons.status, options.status),
      ),
    );
}

export async function isAdminHolder(
  tx: Database | Transaction,
  personId: string,
): Promise<boolean> {
  return (await readPersonAuthority(tx, personId)).admin;
}
