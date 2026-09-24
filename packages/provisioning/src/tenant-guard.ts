import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** Canonicalized by `planVenue` on write, so the stored row and a fresh plan's `ensure-tenant`
 * action compare byte-for-byte. */
export interface TenantIdentity {
  country: string;
  taxId: string;
}

export async function readTenantIdentities(target: Database): Promise<TenantIdentity[]> {
  const rows = await target.execute<{ country: string; tax_id: string }>(
    sql`select country, tax_id from tenants`,
  );
  return rows.rows.map((row) => ({ country: row.country, taxId: row.tax_id }));
}

export async function readOperationalVenueIds(target: Database): Promise<string[]> {
  const rows = await target.execute<{ id: string }>(sql`select id from locations order by id`);
  return rows.rows.map((row) => row.id);
}

export function assertSingleOperationalVenue(
  presentVenueIds: readonly string[],
  configuredVenueId: string,
): void {
  if (presentVenueIds.length !== 1 || presentVenueIds[0] !== configuredVenueId) {
    throw new AppError("provisioning.second_venue", {});
  }
}

export function assertNoOperationalVenue(presentVenueIds: readonly string[]): void {
  if (presentVenueIds.length > 0) throw new AppError("provisioning.second_venue", {});
}

/**
 * The one-tenant-per-database decision, in ONE place: `provisionVenue`, the `venue` CLI and
 * `adoptFromPrimary` all call this before stamping or applying. The SAME identity and an empty
 * database both pass; the caller decides what a same-identity match means.
 */
export function assertNoForeignTenant(
  present: readonly TenantIdentity[],
  applied: TenantIdentity,
  database: string,
): void {
  if (present.some((t) => t.country !== applied.country || t.taxId !== applied.taxId)) {
    throw new AppError("provisioning.foreign_tenant", { database });
  }
}
