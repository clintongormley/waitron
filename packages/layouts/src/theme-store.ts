import { tenantThemes } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { sql } from "drizzle-orm";
import type { ThemeOverride } from "./canvas.js";
import { validateThemeOverride } from "./theme.js";

/**
 * The get/put service over `tenant_themes` (design §4/§9, SP-A.2 §16.3). ONE row, keyed on `id = 1`,
 * which doubles as the `ON CONFLICT` target — the `putReceipt` shape.
 *
 * Every function takes the caller's transaction, opened with
 * `withTransaction(deps.db, …)` + `asAppUser(tx)`. Exercised in
 * `theme-store.test.ts` (real Postgres, as a non-superuser `app_user` member — PGlite holds every
 * grant, CLAUDE.md §4).
 *
 * `putTenantTheme` runs, in order: (1) `authorizeManager(..., "layout.configure")` — the write gate,
 * before any DB write, proven by-deletion in the suite; (2) `validateThemeOverride` — fail-closed on
 * an invalid `theme` (throws `theme.invalid` before the write); (3) an `INSERT … ON CONFLICT
 * (id) DO UPDATE`. `getTenantTheme` casts the opaque jsonb back to `ThemeOverride` WITHOUT
 * re-validating (the write validated it, the only writer is this service — the same
 * return-a-typed-shape rationale `canvas-store.ts` documents). The `as` cast re-attaches the shape the plain-jsonb column drops (it is not
 * `.$type<>()`-annotated, to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/tenant-themes.ts`).
 */

/** The authored theme override, or `undefined` when nobody has picked one (get-with-default
 * = undefined; the caller falls back to the design-system defaults, no row is seeded — design §9). */
export async function getTenantTheme(
  tx: Transaction,
  tenantId: string,
): Promise<ThemeOverride | undefined> {
  void tenantId;
  const [row] = await tx.select({ theme: tenantThemes.theme }).from(tenantThemes);
  if (row === undefined) return undefined;
  return row.theme as ThemeOverride;
}

/** Author (create or replace) the base theme. Manager/admin only (`layout.configure`). */
export async function putTenantTheme(
  tx: Transaction,
  input: { managementSessionId: string; tenantId?: string; theme: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const theme = validateThemeOverride(input.theme);
  await tx
    .insert(tenantThemes)
    .values({ theme })
    .onConflictDoUpdate({
      target: tenantThemes.id,
      set: { theme, updatedAt: sql`now()` },
    });
}
