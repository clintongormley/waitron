import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** The `(country, tax_id)` fiscal identity of one tenant — canonicalized by `planVenue` on write, so
 * the stored row and a fresh plan's `ensure-tenant` action compare byte-for-byte. */
export interface TenantIdentity {
  country: string;
  taxId: string;
}

/** The `(country, tax_id)` of every tenant in the target database. Both production tenant-creation
 * paths read this before applying and hand it to `assertNoForeignTenant`. Runs over the owner-admin
 * connection, which owns `tenants` and so may read it. */
export async function readTenantIdentities(target: Database): Promise<TenantIdentity[]> {
  const rows = await target.execute<{ country: string; tax_id: string }>(
    sql`select country, tax_id from tenants`,
  );
  return rows.rows.map((row) => ({ country: row.country, taxId: row.tax_id }));
}

/**
 * The one-tenant-per-database fiscal-safety DECISION, in ONE place. Both production tenant-creation
 * entry points — the setup-api provision handler (`provisionVenue`) and the `venue` CLI — call this
 * before stamping or applying: with row-level security dropped on the premise of one tenant per
 * database, `withTenant` no longer filters rows by tenant (`packages/db/src/tenancy.ts`), so a second
 * `(country, tax_id)` in the same database would expose one business's rows to the other — a
 * cross-tenant leak a hash-chained fiscal record (§5) cannot take back. Refuses if any EXISTING
 * identity differs from the one being applied; the SAME identity and an empty database both pass (the
 * caller decides what a same-identity match means). `applied` is the plan's canonicalized
 * `ensure-tenant` identity, so it compares like-for-like against the stored rows `present` carries.
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
