import { and, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import {
  persons,
  personRoles,
  roles,
  recordActivity,
  type Database,
  type Transaction,
} from "@waitron/db";
import "./errors.js";
import { AppError } from "@waitron/shared";
import { foldForUniqueness } from "./fold.js";
import { isDeclaredPermission, defaultPermissionsFor, type BuiltInRoleKey } from "./permissions.js";

export const BUILT_IN_ROLE_KEYS = ["staff", "supervisor", "manager", "admin"] as const;

export async function ensureBuiltInRoles(tx: Transaction): Promise<Record<BuiltInRoleKey, string>> {
  const rows = await tx
    .select({ id: roles.id, key: roles.builtInKey })
    .from(roles)
    .where(isNotNull(roles.builtInKey));
  const found = new Map(rows.map((row) => [row.key!, row.id]));
  const missing = BUILT_IN_ROLE_KEYS.filter((key) => !found.has(key));
  if (missing.length > 0) {
    const added = await tx
      .insert(roles)
      .values(
        missing.map((key) => ({
          builtInKey: key,
          permissions: key === "admin" ? [] : defaultPermissionsFor(key),
        })),
      )
      .returning({ id: roles.id, key: roles.builtInKey });
    for (const row of added) found.set(row.key!, row.id);
  }
  return Object.fromEntries(found) as Record<BuiltInRoleKey, string>;
}

export async function setBuiltInMembership(
  tx: Transaction,
  personId: string,
  key: BuiltInRoleKey,
): Promise<void> {
  const builtIns = await ensureBuiltInRoles(tx);
  await tx
    .delete(personRoles)
    .where(
      and(eq(personRoles.personId, personId), inArray(personRoles.roleId, Object.values(builtIns))),
    );
  await tx.insert(personRoles).values({ personId, roleId: builtIns[key] });
}

export async function heldBuiltInKey(
  tx: Database | Transaction,
  personId: string,
): Promise<BuiltInRoleKey | null> {
  const [row] = await tx
    .select({ key: roles.builtInKey })
    .from(personRoles)
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .innerJoin(persons, eq(persons.id, personRoles.personId))
    .where(and(eq(personRoles.personId, personId), isNotNull(roles.builtInKey)))
    .orderBy(desc(eq(roles.builtInKey, "admin")));
  return row?.key ?? null;
}

export async function prepareAccessRoleImport(
  tx: Transaction,
  administratorIds: readonly string[],
): Promise<void> {
  const builtIns = await ensureBuiltInRoles(tx);
  await tx.delete(personRoles).where(notInArray(personRoles.personId, [...administratorIds]));
  await tx.delete(personRoles).where(notInArray(personRoles.roleId, [builtIns.admin]));
  await tx.delete(roles).where(isNull(roles.builtInKey));
}

export async function importAccessRole(
  tx: Transaction,
  source: Record<string, unknown>,
): Promise<string> {
  let permissions: unknown;
  try {
    permissions = JSON.parse(String(source.permissions));
  } catch {
    permissions = null;
  }
  if (
    !Array.isArray(permissions) ||
    permissions.some(
      (permission) => typeof permission !== "string" || !isDeclaredPermission(permission),
    )
  )
    throw new AppError("setup.request_invalid", { field: "roles.permissions" });
  if (source.built_in_key !== null) {
    const builtIns = await ensureBuiltInRoles(tx);
    const key = source.built_in_key as BuiltInRoleKey;
    if (!BUILT_IN_ROLE_KEYS.includes(key))
      throw new AppError("setup.request_invalid", { field: "roles.built_in_key" });
    if (key !== "admin")
      await tx.update(roles).set({ permissions }).where(eq(roles.id, builtIns[key]));
    return builtIns[key];
  }
  const [role] = await tx
    .insert(roles)
    .values({
      name: (source.name as string).trim(),
      nameFolded: foldForUniqueness(source.name as string),
      permissions,
      createdAt: source.created_at as string,
    })
    .returning({ id: roles.id });
  return role!.id;
}

export async function importAccessRoleMembership(
  tx: Transaction,
  personId: string,
  roleId: string,
): Promise<void> {
  await tx.insert(personRoles).values({ personId, roleId });
  const [role] = await tx.select().from(roles).where(eq(roles.id, roleId));
  await recordActivity(tx, {
    kind: "access_role.member_added",
    personId: null,
    subjectId: personId,
    data: { roleId, builtInKey: role!.builtInKey, name: role!.name },
  });
}
