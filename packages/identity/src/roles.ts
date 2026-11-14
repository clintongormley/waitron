import { and, count, eq, inArray, isNotNull, isNull, ne, notInArray } from "drizzle-orm";
import { persons, personRoles, roles, recordActivity, type Transaction } from "@waitron/db";
import "./errors.js";
import { AppError, BUILT_IN_ROLE_NAMES } from "@waitron/shared";
import { foldForUniqueness } from "./fold.js";
import {
  declaredPermissions,
  isDeclaredPermission,
  defaultPermissionsFor,
  type BuiltInRoleKey,
} from "./permissions.js";
import { resolveManagementSession } from "./management-session.js";
import { holds, type PersonAuthority } from "./authority.js";
import { authorizeManager } from "./manager-login.js";
import { requireFreshManagementSignIn } from "./fresh-sign-in.js";
import { assertUsableAdminRemains } from "./admin-anchor.js";
import { queueRoleMembershipMail } from "./role-mail.js";

export const BUILT_IN_ROLE_KEYS = ["staff", "supervisor", "manager", "admin"] as const;

export async function listAccessRoles(tx: Transaction, managementSessionId: string) {
  const session = await resolveManagementSession(tx, managementSessionId, { touch: false });
  if (!holds(session.authority, "person.manage") && !holds(session.authority, "person.admin"))
    throw new AppError("authorization.not_permitted", { permission: "person.manage" });
  const rows = await tx
    .select({
      id: roles.id,
      builtInKey: roles.builtInKey,
      name: roles.name,
      permissions: roles.permissions,
      holderCount: count(personRoles.personId),
    })
    .from(roles)
    .leftJoin(personRoles, eq(personRoles.roleId, roles.id))
    .groupBy(roles.id);
  return rows
    .sort((a, b) => {
      if (a.builtInKey !== null || b.builtInKey !== null)
        return (
          (a.builtInKey === null ? 4 : BUILT_IN_ROLE_KEYS.indexOf(a.builtInKey)) -
          (b.builtInKey === null ? 4 : BUILT_IN_ROLE_KEYS.indexOf(b.builtInKey))
        );
      return a.name!.localeCompare(b.name!, session.locale ?? "en");
    })
    .map((role) => ({
      ...role,
      permissions:
        role.builtInKey === "admin"
          ? declaredPermissions()
          : role.permissions.filter(isDeclaredPermission),
    }));
}

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
      ...(await checkedRoleName(tx, source.name as string)),
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

async function roleEditor(tx: Transaction, managementSessionId: string) {
  const actor = await authorizeManager(tx, { managementSessionId, permission: "person.admin" });
  await requireFreshManagementSignIn(tx, managementSessionId);
  return actor;
}

async function accessRole(tx: Transaction, roleId: string) {
  const [role] = await tx.select().from(roles).where(eq(roles.id, roleId));
  if (role === undefined) throw new AppError("role.not_found", { roleId });
  return role;
}

function effectivePermissions(role: typeof roles.$inferSelect): string[] {
  return role.builtInKey === "admin"
    ? declaredPermissions()
    : role.permissions.filter(isDeclaredPermission);
}

function requireRoleGrants(
  authority: PersonAuthority,
  permissions: readonly string[],
  roleId?: string,
) {
  if (permissions.some((permission) => !holds(authority, permission)))
    throw new AppError("role.not_permitted", roleId === undefined ? {} : { roleId });
}

function checkedPermissions(permissions: readonly string[]): string[] {
  for (const permission of permissions)
    if (!isDeclaredPermission(permission))
      throw new AppError("role.permission_unknown", { permission });
  return [...new Set(permissions)];
}

const RESERVED_ROLE_NAMES = new Set(
  Object.values(BUILT_IN_ROLE_NAMES)
    .flatMap((names) => Object.values(names))
    .map(foldForUniqueness),
);

async function checkedRoleName(tx: Transaction, input: string, roleId?: string) {
  const name = input.trim();
  if (name.length === 0) throw new AppError("role.name_required", {});
  const nameFolded = foldForUniqueness(name);
  if (RESERVED_ROLE_NAMES.has(nameFolded)) throw new AppError("role.name_taken", { name });
  const [duplicate] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        eq(roles.nameFolded, nameFolded),
        roleId === undefined ? undefined : ne(roles.id, roleId),
      ),
    );
  if (duplicate !== undefined) throw new AppError("role.name_taken", { name });
  return { name, nameFolded };
}

export async function createAccessRole(
  tx: Transaction,
  input: {
    managementSessionId: string;
    name: string;
    permissions: readonly string[];
    copiedFrom?: string;
  },
): Promise<{ id: string }> {
  const actor = await roleEditor(tx, input.managementSessionId);
  const source =
    input.copiedFrom === undefined ? undefined : await accessRole(tx, input.copiedFrom);
  const permissions =
    source === undefined ? checkedPermissions(input.permissions) : effectivePermissions(source);
  requireRoleGrants(actor.authority, permissions, source?.id);
  const name = await checkedRoleName(tx, input.name);
  const [role] = await tx
    .insert(roles)
    .values({ ...name, permissions })
    .returning({ id: roles.id });
  await recordActivity(tx, {
    kind: "access_role.created",
    personId: actor.authorizedBy,
    subjectId: role!.id,
    data: { name: name.name, permissions, copiedFromRoleId: source?.id ?? null },
  });
  return role!;
}

export async function renameAccessRole(
  tx: Transaction,
  input: {
    managementSessionId: string;
    roleId: string;
    name: string;
    expectedName: string;
  },
): Promise<void> {
  const actor = await roleEditor(tx, input.managementSessionId);
  const role = await accessRole(tx, input.roleId);
  if (role.builtInKey !== null) throw new AppError("role.built_in", { roleId: role.id });
  requireRoleGrants(actor.authority, effectivePermissions(role), role.id);
  if (role.name !== input.expectedName) throw new AppError("role.changed", {});
  const name = await checkedRoleName(tx, input.name, role.id);
  if (name.name === role.name) return;
  await tx.update(roles).set(name).where(eq(roles.id, role.id));
  await recordActivity(tx, {
    kind: "access_role.renamed",
    personId: actor.authorizedBy,
    subjectId: role.id,
    data: { from: role.name!, to: name.name },
  });
}

export async function setAccessRolePermissions(
  tx: Transaction,
  input: {
    managementSessionId: string;
    roleId: string;
    permissions: readonly string[];
    expectedPermissions: readonly string[];
  },
): Promise<void> {
  const actor = await roleEditor(tx, input.managementSessionId);
  const role = await accessRole(tx, input.roleId);
  if (role.builtInKey === "admin") throw new AppError("role.built_in", { roleId: role.id });
  const before = new Set(effectivePermissions(role));
  requireRoleGrants(actor.authority, [...before], role.id);
  const expected = new Set(input.expectedPermissions);
  if (before.size !== expected.size || [...before].some((permission) => !expected.has(permission)))
    throw new AppError("role.changed", {});
  const permissions = checkedPermissions(input.permissions);
  requireRoleGrants(actor.authority, permissions, role.id);
  const after = new Set(permissions);
  const removed = [...new Set(role.permissions)].filter((permission) => !after.has(permission));
  const added = permissions.filter((permission) => !before.has(permission));
  await tx.update(roles).set({ permissions }).where(eq(roles.id, role.id));
  for (const permission of removed)
    await recordActivity(tx, {
      kind: "access_role.permission_removed",
      personId: actor.authorizedBy,
      subjectId: role.id,
      data: { permission },
    });
  for (const permission of added)
    await recordActivity(tx, {
      kind: "access_role.permission_added",
      personId: actor.authorizedBy,
      subjectId: role.id,
      data: { permission },
    });
}

export async function deleteAccessRole(
  tx: Transaction,
  input: {
    managementSessionId: string;
    roleId: string;
  },
): Promise<{ removedFrom: number }> {
  const actor = await roleEditor(tx, input.managementSessionId);
  const role = await accessRole(tx, input.roleId);
  if (role.builtInKey !== null) throw new AppError("role.built_in", { roleId: role.id });
  const permissions = effectivePermissions(role);
  requireRoleGrants(actor.authority, permissions, role.id);
  const members = await tx
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .where(eq(personRoles.roleId, role.id));
  const [editor] = await tx
    .select({ name: persons.displayName })
    .from(persons)
    .where(eq(persons.id, actor.authorizedBy));
  for (const member of members) {
    await tx
      .delete(personRoles)
      .where(and(eq(personRoles.roleId, role.id), eq(personRoles.personId, member.personId)));
    const activity = await recordActivity(tx, {
      kind: "access_role.member_removed",
      personId: actor.authorizedBy,
      subjectId: member.personId,
      data: { roleId: role.id, builtInKey: null, name: role.name },
    });
    await queueRoleMembershipMail(tx, {
      activityId: activity.id,
      personId: member.personId,
      actorId: actor.authorizedBy,
      change: "removed",
      roleId: role.id,
      builtInKey: null,
      roleName: role.name,
      editorName: editor!.name,
      at: activity.at,
    });
  }
  await tx.delete(roles).where(eq(roles.id, role.id));
  await recordActivity(tx, {
    kind: "access_role.deleted",
    personId: actor.authorizedBy,
    subjectId: role.id,
    data: { name: role.name!, permissions },
  });
  await assertUsableAdminRemains(tx);
  return { removedFrom: members.length };
}
