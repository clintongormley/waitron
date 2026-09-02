import { layoutProfiles } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { and, asc, eq, sql } from "drizzle-orm";
import { DEFAULT_PROFILES } from "./default-profiles.js";
import type { FormFactor, ProfileDef } from "./profile.js";
import { validateProfile } from "./validate-profile.js";

/**
 * The list/get/create/update/delete service over `layout_profiles` (design §4, SP-A.2 §16.3). MANY
 * rows per tenant, keyed by `id`, names unique per tenant.
 *
 * Every function takes a `(tx, …)` the CALLER has already scoped — the management routes open it with
 * `withTenant(deps.db, tenantId, …)` + `asAppUser(tx)`, so the app role's tenant-isolation policy
 * supplies `current_tenant_id()` and no function here sets a GUC. Proven under that exact shape in
 * `profile-store.rls.test.ts` (real Postgres — RLS as the app role is a false pass on PGlite,
 * CLAUDE.md §4). Mirrors `store.ts` (till_layouts).
 *
 * The writers run, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateProfile` — fail-closed on an invalid
 * `definition` (throws `profile.invalid` before the write); (3) the drizzle write. `deleteProfile`
 * authorises but has no definition to validate. Reads cast the opaque jsonb back to `ProfileDef`
 * WITHOUT re-running `validateProfile` — the value was validated on the write that stored it and the
 * only writer is this service, the `getLayout` rationale (store.ts). The `as` cast re-attaches the
 * shape the plain-jsonb column drops (it is not `.$type<>()`-annotated, to avoid a
 * `@waitron/layouts` → `@waitron/db` circular dependency, see `packages/db/src/schema/layout-profiles.ts`).
 */

/** All of the current tenant's profiles. RLS scopes the read to the caller's tenant. */
export async function listProfiles(
  tx: Transaction,
  tenantId: string,
): Promise<{ id: string; name: string; definition: ProfileDef }[]> {
  const rows = await tx
    .select({
      id: layoutProfiles.id,
      name: layoutProfiles.name,
      definition: layoutProfiles.definition,
    })
    .from(layoutProfiles)
    .where(eq(layoutProfiles.tenantId, tenantId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    definition: row.definition as ProfileDef,
  }));
}

/** One profile by id, or `undefined` when the tenant has no such profile. */
export async function getProfile(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<{ id: string; name: string; definition: ProfileDef } | undefined> {
  const [row] = await tx
    .select({
      id: layoutProfiles.id,
      name: layoutProfiles.name,
      definition: layoutProfiles.definition,
    })
    .from(layoutProfiles)
    .where(and(eq(layoutProfiles.tenantId, tenantId), eq(layoutProfiles.id, id)));
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, definition: row.definition as ProfileDef };
}

/** Create a profile for the tenant, returning its generated id. Manager/admin only (`till.configure`). */
export async function createProfile(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; name: string; definition: unknown },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const definition = validateProfile(input.definition);
  const [row] = await tx
    .insert(layoutProfiles)
    .values({ tenantId: input.tenantId, name: input.name, definition })
    .returning({ id: layoutProfiles.id });
  return { id: row!.id };
}

/** Replace a profile's name + definition in place. Manager/admin only (`till.configure`). */
export async function updateProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    name: string;
    definition: unknown;
  },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const definition = validateProfile(input.definition);
  await tx
    .update(layoutProfiles)
    .set({ name: input.name, definition, updatedAt: sql`now()` })
    .where(and(eq(layoutProfiles.tenantId, input.tenantId), eq(layoutProfiles.id, input.id)));
}

/** Delete a profile. Manager/admin only (`till.configure`). No definition to validate. */
export async function deleteProfile(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  await tx
    .delete(layoutProfiles)
    .where(and(eq(layoutProfiles.tenantId, input.tenantId), eq(layoutProfiles.id, input.id)));
}

/**
 * The tenant's first stored profile of `formFactor`, else the built-in `DEFAULT_PROFILES[formFactor]`
 * — the "return-a-default-when-unauthored" precedent from getLayout (store.ts). The form factor is
 * carried inside the opaque `definition` jsonb (`->> 'formFactor'`), not a column; "first" is by
 * `created_at` for a stable pick when a tenant has several of one form factor.
 */
export async function getProfileForFormFactor(
  tx: Transaction,
  tenantId: string,
  formFactor: FormFactor,
): Promise<ProfileDef> {
  const [row] = await tx
    .select({ definition: layoutProfiles.definition })
    .from(layoutProfiles)
    .where(
      and(
        eq(layoutProfiles.tenantId, tenantId),
        eq(sql`${layoutProfiles.definition} ->> 'formFactor'`, formFactor),
      ),
    )
    .orderBy(asc(layoutProfiles.createdAt))
    .limit(1);
  if (row === undefined) return DEFAULT_PROFILES[formFactor];
  return row.definition as ProfileDef;
}
