import type { BackupQuery } from "@waitron/store";
import { and, eq } from "drizzle-orm";
import { persons, personRoles, roles, type Database, type Transaction } from "@waitron/db";
import { declaredPermissions, isDeclaredPermission, type Permission } from "./permissions.js";
import { BUILT_IN_ROLE_KEYS } from "./roles.js";

export interface PersonAuthority {
  readonly personId: string;
  readonly admin: boolean;
  readonly roleIds: readonly string[];
  readonly permissions: ReadonlySet<string>;
}

type HeldRole = Pick<typeof roles.$inferSelect, "id" | "builtInKey" | "permissions">;

export function authorityForRoles(personId: string, held: readonly HeldRole[]): PersonAuthority {
  const admin = held.some((role) => role.builtInKey === "admin");
  return {
    personId,
    admin,
    roleIds: held.map((role) => role.id),
    permissions: new Set(
      admin
        ? declaredPermissions()
        : held.flatMap((role) => role.permissions).filter(isDeclaredPermission),
    ),
  };
}

export async function readPersonAuthority(
  tx: Database | Transaction,
  personId: string,
): Promise<PersonAuthority> {
  const held = await tx
    .select({ id: roles.id, builtInKey: roles.builtInKey, permissions: roles.permissions })
    .from(personRoles)
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .where(eq(personRoles.personId, personId));
  return authorityForRoles(personId, held);
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
  const held: HeldRole[] = [];
  for await (const row of query.rows(
    `select roles.id, roles.built_in_key, roles.permissions from persons
    join person_roles on person_roles.person_id = persons.id
    join roles on roles.id = person_roles.role_id where persons.id = ? and persons.status = 'active'`,
    [personId],
  )) {
    if (
      row.built_in_key !== null &&
      !(BUILT_IN_ROLE_KEYS as readonly unknown[]).includes(row.built_in_key)
    )
      return false;
    const permissions: unknown = JSON.parse(String(row.permissions));
    if (!Array.isArray(permissions) || permissions.some((value) => typeof value !== "string"))
      return false;
    held.push({
      id: String(row.id),
      builtInKey: row.built_in_key as HeldRole["builtInKey"],
      permissions,
    });
  }
  return holds(authorityForRoles(personId, held), permission);
}

export async function listAdminHolders(
  tx: Database | Transaction | BackupQuery,
  options: { status?: "active" } = {},
): Promise<{ id: string; passwordHash: string | null }[]> {
  if ("rows" in tx) {
    const holders: { id: string; passwordHash: string | null }[] = [];
    for await (const row of tx.rows(
      `select persons.id, persons.password_hash from persons
      join person_roles on person_roles.person_id = persons.id join roles on roles.id = person_roles.role_id
      where roles.built_in_key = 'admin' and (? is null or persons.status = ?)`,
      [options.status ?? null, options.status ?? null],
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
    .innerJoin(personRoles, eq(personRoles.personId, persons.id))
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .where(
      and(
        eq(roles.builtInKey, "admin"),
        options.status === undefined ? undefined : eq(persons.status, options.status),
      ),
    );
}
