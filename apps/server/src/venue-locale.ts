// No `import "./errors.js"`: this file throws no AppError code (it reads two rows and defers to the
// shared `resolveVenueLocale`), so it is not in the throw graph the sibling route/config files load
// the registry for.
import { eq } from "drizzle-orm";
import { asAppUser, locations, tenants, withTenant, type Database } from "@waitron/db";
import { resolveVenueLocale, type SupportedLocale } from "@waitron/shared";

/**
 * The venue's default UI locale, resolved ONCE at boot from geography + an optional env override.
 * Reads the tenant's country and the till location's province under the app role (`withTenant` +
 * `asAppUser`, so RLS scopes both reads to this tenant), then applies the shared
 * `override → province → country → English` chain (`resolveVenueLocale`, which always returns a
 * SUPPORTED code, so nothing here post-processes its result).
 *
 * This is a DISPLAY value — the UI language the apps default to. It is DELIBERATELY separate from the
 * fiscal `cfg.locale` / `cfg.invoiceLocales`, which feed the receipt/invoice rendering and are
 * computed straight off `WAITRON_TILL_LOCALE` in `till-config.ts` (fiscal decision 2), unchanged.
 * The `override` here is the RAW `WAITRON_TILL_LOCALE` (`cfg.localeOverride`), NOT the defaulted
 * `cfg.locale` — the latter defaults to `es-ES`, which would mask the geography derivation entirely.
 * Called ONCE at boot (`boot.ts`), not per request: the venue default is static for the process, the
 * same "resolve provisioning-time config once, off the hot path" shape `readOrderFlow` follows.
 */
export async function readVenueLocale(
  db: Database,
  params: { tenantId: string; locationId: string; override?: string },
): Promise<SupportedLocale> {
  return withTenant(db, params.tenantId, async (tx) => {
    await asAppUser(tx);
    const [t] = await tx
      .select({ country: tenants.country })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId));
    const [loc] = await tx
      .select({ province: locations.province })
      .from(locations)
      .where(eq(locations.id, params.locationId));
    return resolveVenueLocale({
      override: params.override,
      province: loc?.province ?? null,
      country: t?.country ?? null,
    });
  });
}
