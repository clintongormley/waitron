import { tenantThemes } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { eq, sql } from "drizzle-orm";
import type { ThemeOverride } from "./profile.js";
import { validateThemeOverride } from "./theme.js";

/**
 * The get/put service over `tenant_themes` (design §4/§9, SP-A.2 §16.3). ONE row per tenant, keyed on
 * `tenant_id`, which doubles as the `ON CONFLICT` target — the `putReceipt`/till_layouts shape.
 *
 * Every function takes a `(tx, …)` the CALLER has already scoped — the management routes open it with
 * `withTenant(deps.db, tenantId, …)` + `asAppUser(tx)`, so the app role's tenant-isolation policy
 * supplies `current_tenant_id()` and no function here sets a GUC. Proven under that exact shape in
 * `theme-store.rls.test.ts` (real Postgres — RLS as the app role is a false pass on PGlite,
 * CLAUDE.md §4).
 *
 * `putTenantTheme` runs, in order: (1) `authorizeManager(..., "till.configure")` — the write gate,
 * before any DB write, proven by-deletion in the suite; (2) `validateThemeOverride` — fail-closed on
 * an invalid `theme` (throws `theme.invalid` before the write); (3) an `INSERT … ON CONFLICT
 * (tenant_id) DO UPDATE`. `getTenantTheme` casts the opaque jsonb back to `ThemeOverride` WITHOUT
 * re-validating (the write validated it, the only writer is this service — the `getLayout` rationale
 * in store.ts). The `as` cast re-attaches the shape the plain-jsonb column drops (it is not
 * `.$type<>()`-annotated, to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/tenant-themes.ts`).
 */

/** The tenant's authored theme override, or `undefined` when it has never picked one (get-with-default
 * = undefined; the caller falls back to the design-system defaults, no row is seeded — design §9). */
export async function getTenantTheme(
  tx: Transaction,
  tenantId: string,
): Promise<ThemeOverride | undefined> {
  const [row] = await tx
    .select({ theme: tenantThemes.theme })
    .from(tenantThemes)
    .where(eq(tenantThemes.tenantId, tenantId));
  if (row === undefined) return undefined;
  return row.theme as ThemeOverride;
}

/** Author (create or replace) the tenant's base theme. Manager/admin only (`till.configure`). */
export async function putTenantTheme(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; theme: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const theme = validateThemeOverride(input.theme);
  await tx
    .insert(tenantThemes)
    .values({ tenantId: input.tenantId, theme })
    .onConflictDoUpdate({
      target: tenantThemes.tenantId,
      set: { theme, updatedAt: sql`now()` },
    });
}
