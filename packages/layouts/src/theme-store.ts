import { nowIso, tenantThemes } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ThemeOverride } from "./canvas.js";
import { validateThemeOverride } from "./theme.js";

/**
 * `getTenantTheme` reads the document back without re-validating it: `putTenantTheme` validates
 * before it writes.
 * The `as` cast restores a type the JSON column does not carry: this package depends on
 * `@waitron/db`, so the column cannot name one of its types without a dependency cycle.
 */
export async function getTenantTheme(tx: Transaction): Promise<ThemeOverride | undefined> {
  const [row] = await tx.select({ theme: tenantThemes.theme }).from(tenantThemes);
  if (row === undefined) return undefined;
  return row.theme as ThemeOverride;
}

export async function putTenantTheme(
  tx: Transaction,
  input: { managementSessionId: string; theme: unknown },
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
      set: { theme, updatedAt: nowIso() },
    });
}
