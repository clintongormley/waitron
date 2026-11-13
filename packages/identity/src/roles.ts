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
import { authorizeManager } from "./manager-login.js";
import { requireFreshManagementSignIn } from "./fresh-sign-in.js";
import { assertUsableAdminRemains } from "./admin-anchor.js";
import { queueRoleMembershipMail } from "./role-mail.js";

export const BUILT_IN_ROLE_KEYS = ["staff", "supervisor", "manager", "admin"] as const;

export async function setPersonAccessRoles(
  tx: Transaction,
  input: {
    managementSessionId: string;
    personId: string;
    roleIds: readonly string[];
    expectedRoleIds: readonly string[];
  },
): Promise<{ roleIds: string[] }> {
  const { authorizedBy, authority } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.admin",
  });
  await requireFreshManagementSignIn(tx, input.managementSessionId);
  const [person] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.id, input.personId));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  const next = new Set(input.roleIds);
  if (next.size !== input.roleIds.length)
    throw new AppError("management.request_invalid", { field: "roleIds" });
  const held = await tx
    .select({ id: personRoles.roleId })
    .from(personRoles)
    .where(eq(personRoles.personId, person.id));
  const current = new Set(held.map((row) => row.id));
  const expected = new Set(input.expectedRoleIds);
  if (current.size !== expected.size || [...current].some((id) => !expected.has(id)))
    throw new AppError("person.roles_changed", {});
  const ids = [...new Set([...current, ...next])];
  const roleRows =
    ids.length === 0 ? [] : await tx.select().from(roles).where(inArray(roles.id, ids));
  const byId = new Map(roleRows.map((role) => [role.id, role]));
  for (const id of next) if (!byId.has(id)) throw new AppError("role.not_found", { roleId: id });
  const changes = roleRows.filter((role) => current.has(role.id) !== next.has(role.id));
  for (const role of changes) {
    if (
      role.builtInKey === "admin"
        ? !authority.admin
        : role.permissions.some(
            (permission) =>
              isDeclaredPermission(permission) && !authority.permissions.has(permission),
          )
    )
      throw new AppError("role.not_permitted", { roleId: role.id });
  }
  if (changes.length > 0) {
    const [editor] = await tx
      .select({ name: persons.displayName })
      .from(persons)
      .where(eq(persons.id, authorizedBy));
    for (const role of changes) {
      const change = next.has(role.id) ? "added" : "removed";
      if (change === "added")
        await tx.insert(personRoles).values({ personId: person.id, roleId: role.id });
      else
        await tx
          .delete(personRoles)
          .where(and(eq(personRoles.personId, person.id), eq(personRoles.roleId, role.id)));
      const activity = await recordActivity(tx, {
        kind: change === "added" ? "access_role.member_added" : "access_role.member_removed",
        personId: authorizedBy,
        subjectId: person.id,
        data: { roleId: role.id, builtInKey: role.builtInKey, name: role.name },
      });
      await queueRoleMembershipMail(tx, {
        activityId: activity.id,
        personId: person.id,
        actorId: authorizedBy,
        change,
        roleId: role.id,
        builtInKey: role.builtInKey,
        roleName: role.name,
        editorName: editor!.name,
        at: activity.at,
      });
    }
    await assertUsableAdminRemains(tx);
  }
  return { roleIds: [...next] };
}

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
